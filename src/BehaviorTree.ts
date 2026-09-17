//!native
//!optimize 2

import type { FSM } from "./FSM";
import type { Goap } from "./Goap";

/**
 * BTree: a shared-tree behavior tree.
 *
 * One tree is built once from node factories and shared by every agent. Agents are integer slots
 * handed out by the tree. Every node is a pair of closures, `Tick(slot, dt, tree)` and `Halt(slot, tree)`,
 * with its per-agent state held in Struct-of-Maps tables keyed by slot (`cursor[slot]`, `time_left[slot]`).
 * An absent key means "idle for that agent", so an agent that never reaches a node costs nothing there,
 * and nothing is allocated per tick in steady state.
 *
 * Halting is an explicit cascade: a parent knows which child is running for an agent and halts exactly
 * that one when it stops ticking it. A node's `Halt` is only ever called while the node is RUNNING for
 * that slot. The two nodes that keep a child running while reporting a non-RUNNING status themselves
 * (FireAndForget, RunningGate) register the child with the tree, which halts it at the end of the first
 * tick in which it was not visited.
 *
 * There is no OnBecameActivated / OnBecameInactive. A leaf's `OnStart` / `OnHalt` bracket the span in which
 * it is running; wrapped in FireAndForget with an `OnTick` that returns RUNNING they bracket the span in
 * which its branch is visited.
 *
 * Per-agent user data is Struct-of-Maps too: `tree.Field<T>()` returns a `Map<Slot, T>` that the tree clears
 * when the agent is removed.
 *
 * Do not place the same node instance at two positions of a tree: its per-slot state would be shared.
 * Build it twice instead.
 */
export namespace BTree {
	export const enum ENodeStatus {
		SUCCESS,
		FAILURE,
		RUNNING,
	}

	export const enum EParallelPolicy {
		ONE = "ONE",
		ALL = "ALL",
	}

	export const enum ERepeatCondition {
		ALWAYS = "ALWAYS",
		SUCCESS = "SUCCESS",
		FAILURE = "FAILURE",
	}

	export const enum ETimeoutBehavior {
		FAILURE = "FAILURE",
		SUCCESS = "SUCCESS",
	}

	// Returned from locals rather than as literals: `return SUCCESS` compiles to an upvalue read.
	const SUCCESS = ENodeStatus.SUCCESS;
	const FAILURE = ENodeStatus.FAILURE;
	const RUNNING = ENodeStatus.RUNNING;

	/** Agent handle: a small positive integer handed out by the tree. */
	export type Slot = number;
	export type StateMap = Map<Slot, unknown>;
	export type TickFn = (slot: Slot, dt: number, tree: BehaviorTree) => ENodeStatus;
	export type HaltFn = (slot: Slot, tree: BehaviorTree) => void;

	/** A built node. Only Tick and Halt are touched at run time. */
	export interface Node {
		readonly Name: string;
		/** Advances the node for one agent, starting it if idle. */
		readonly Tick: TickFn;
		/** Interrupts the node for one agent. Only called while the node is RUNNING for that slot. */
		readonly Halt: HaltFn;
		/** Every per-agent state map of this node and its descendants; the tree clears them on RemoveAgent. */
		readonly Maps: StateMap[];
	}

	const NOOP: HaltFn = () => {};

	function MakeNode(name: string, tick: TickFn, halt: HaltFn, maps: StateMap[]): Node {
		return { Name: name, Tick: tick, Halt: halt, Maps: maps };
	}

	/** Build time: children -> parallel closure arrays, collecting their state maps. */
	function Children(children: Node[], maps: StateMap[]) {
		const n = children.size();
		const ticks = new Array<TickFn>(n);
		const halts = new Array<HaltFn>(n);
		for (let i = 0; i < n; i++) {
			const child = children[i];
			ticks[i] = child.Tick;
			halts[i] = child.Halt;
			for (const m of child.Maps) maps.push(m);
		}
		return { n, ticks, halts };
	}

	function Adopt(child: Node, maps: StateMap[]) {
		for (const m of child.Maps) maps.push(m);
	}

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Composites
	// ─────────────────────────────────────────────────────────────────────────────────────────────

	/** Runs children in order until one fails. Resumes at the running child. */
	export function Sequence(...children: Node[]): Node {
		const cursor = new Map<Slot, number>();
		const maps: StateMap[] = [cursor];
		const { n, ticks, halts } = Children(children, maps);
		return MakeNode(
			"Sequence",
			(slot, dt, tree) => {
				let i = cursor.get(slot);
				const resumed = i !== undefined;
				if (i === undefined) i = 0;
				while (i < n) {
					const s = ticks[i](slot, dt, tree);
					if (s === RUNNING) {
						cursor.set(slot, i);
						return RUNNING;
					}
					if (s === FAILURE) {
						if (resumed) cursor.delete(slot);
						return FAILURE;
					}
					i++;
				}
				if (resumed) cursor.delete(slot);
				return SUCCESS;
			},
			(slot, tree) => {
				const i = cursor.get(slot)!;
				cursor.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	/** Runs children in order until one succeeds. Resumes at the running child. */
	export function Fallback(...children: Node[]): Node {
		const cursor = new Map<Slot, number>();
		const maps: StateMap[] = [cursor];
		const { n, ticks, halts } = Children(children, maps);
		return MakeNode(
			"Fallback",
			(slot, dt, tree) => {
				let i = cursor.get(slot);
				const resumed = i !== undefined;
				if (i === undefined) i = 0;
				while (i < n) {
					const s = ticks[i](slot, dt, tree);
					if (s === RUNNING) {
						cursor.set(slot, i);
						return RUNNING;
					}
					if (s === SUCCESS) {
						if (resumed) cursor.delete(slot);
						return SUCCESS;
					}
					i++;
				}
				if (resumed) cursor.delete(slot);
				return FAILURE;
			},
			(slot, tree) => {
				const i = cursor.get(slot)!;
				cursor.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	/**
	 * Like Sequence, but remembers the child that failed and retries from it next tick.
	 * The memory resets when the node was not visited in the previous tick.
	 */
	export function MemorySequence(...children: Node[]): Node {
		const cursor = new Map<Slot, number>();
		const last_seen = new Map<Slot, number>();
		const maps: StateMap[] = [cursor, last_seen];
		const { n, ticks, halts } = Children(children, maps);
		return MakeNode(
			"MemorySequence",
			(slot, dt, tree) => {
				const now = tree.TickCount;
				let i = cursor.get(slot);
				if (i !== undefined && last_seen.get(slot) !== now - 1) i = undefined; // was inactive: reset
				last_seen.set(slot, now);
				if (i === undefined) i = 0;
				while (i < n) {
					const s = ticks[i](slot, dt, tree);
					if (s === RUNNING) {
						cursor.set(slot, i);
						return RUNNING;
					}
					if (s === FAILURE) {
						cursor.set(slot, i); // retry from here next tick
						return FAILURE;
					}
					i++;
				}
				cursor.delete(slot);
				return SUCCESS;
			},
			(slot, tree) => {
				const i = cursor.get(slot)!;
				cursor.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	/** Re-evaluates every child from the first each tick; a RUNNING child halts the previously running one. */
	export function ReactiveSequence(...children: Node[]): Node {
		const running = new Map<Slot, number>(); // the one child running from last tick
		const maps: StateMap[] = [running];
		const { n, ticks, halts } = Children(children, maps);
		return MakeNode(
			"ReactiveSequence",
			(slot, dt, tree) => {
				let prev = running.get(slot);
				let i = 0;
				while (i < n) {
					const s = ticks[i](slot, dt, tree);
					if (s === RUNNING) {
						if (prev !== i) {
							if (prev !== undefined) halts[prev](slot, tree);
							running.set(slot, i);
						}
						return RUNNING;
					}
					if (prev === i) {
						prev = undefined; // it finished this tick
						running.delete(slot);
					}
					if (s === FAILURE) {
						if (prev !== undefined) {
							running.delete(slot);
							halts[prev](slot, tree);
						}
						return FAILURE;
					}
					i++;
				}
				return SUCCESS;
			},
			(slot, tree) => {
				const i = running.get(slot)!;
				running.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	/** Re-evaluates every child from the first each tick; a SUCCESS or RUNNING child halts the previously running one. */
	export function ReactiveFallback(...children: Node[]): Node {
		const running = new Map<Slot, number>();
		const maps: StateMap[] = [running];
		const { n, ticks, halts } = Children(children, maps);
		return MakeNode(
			"ReactiveFallback",
			(slot, dt, tree) => {
				let prev = running.get(slot);
				let i = 0;
				while (i < n) {
					const s = ticks[i](slot, dt, tree);
					if (s === RUNNING) {
						if (prev !== i) {
							if (prev !== undefined) halts[prev](slot, tree);
							running.set(slot, i);
						}
						return RUNNING;
					}
					if (prev === i) {
						prev = undefined;
						running.delete(slot);
					}
					if (s === SUCCESS) {
						if (prev !== undefined) {
							running.delete(slot);
							halts[prev](slot, tree);
						}
						return SUCCESS;
					}
					i++;
				}
				return FAILURE;
			},
			(slot, tree) => {
				const i = running.get(slot)!;
				running.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	/**
	 * Ticks every child each tick. Completed children keep their result until the Parallel finishes.
	 * ONE: the first SUCCESS (or FAILURE) halts the others and returns. ALL: waits for every child.
	 * At most 32 children.
	 */
	export function Parallel(
		success_policy: EParallelPolicy,
		failure_policy: EParallelPolicy,
		...children: Node[]
	): Node {
		const done = new Map<Slot, number>(); // bitmask of completed children
		const succ = new Map<Slot, number>(); // bitmask of successful children
		const run = new Map<Slot, number>(); // bitmask of running children
		const maps: StateMap[] = [done, succ, run];
		const { n, ticks, halts } = Children(children, maps);
		if (n > 32) throw "Parallel supports at most 32 children";
		const success_one = success_policy === EParallelPolicy.ONE;
		const failure_one = failure_policy === EParallelPolicy.ONE;
		const bits = new Array<number>(n);
		for (let i = 0; i < n; i++) bits[i] = bit32.lshift(1, i);
		const band = bit32.band;
		const bor = bit32.bor;
		const bnot = bit32.bnot;

		const HaltRunning = (r: number, slot: Slot, tree: BehaviorTree) => {
			let i = 0;
			while (i < n) {
				if (band(r, bits[i]) !== 0) halts[i](slot, tree);
				i++;
			}
		};
		const Clear = (slot: Slot) => {
			done.delete(slot);
			succ.delete(slot);
			run.delete(slot);
		};

		return MakeNode(
			"Parallel",
			(slot, dt, tree) => {
				let d = done.get(slot) ?? 0;
				let sc = succ.get(slot) ?? 0;
				let r = run.get(slot) ?? 0;
				let nsucc = 0;
				let nfail = 0;
				let i = 0;
				while (i < n) {
					const bit = bits[i];
					if (band(d, bit) !== 0) {
						if (band(sc, bit) !== 0) nsucc++;
						else nfail++;
					} else {
						const s = ticks[i](slot, dt, tree);
						if (s === RUNNING) {
							r = bor(r, bit);
						} else {
							r = band(r, bnot(bit));
							d = bor(d, bit);
							if (s === SUCCESS) {
								nsucc++;
								sc = bor(sc, bit);
								if (success_one) {
									Clear(slot);
									HaltRunning(r, slot, tree);
									return SUCCESS;
								}
							} else {
								nfail++;
								if (failure_one) {
									Clear(slot);
									HaltRunning(r, slot, tree);
									return FAILURE;
								}
							}
						}
					}
					i++;
				}
				if (!success_one && nsucc === n) {
					Clear(slot);
					return SUCCESS;
				}
				if (!failure_one && nfail === n) {
					Clear(slot);
					return FAILURE;
				}
				done.set(slot, d);
				succ.set(slot, sc);
				run.set(slot, r);
				return RUNNING;
			},
			(slot, tree) => {
				const r = run.get(slot) ?? 0;
				Clear(slot);
				HaltRunning(r, slot, tree);
			},
			maps,
		);
	}

	/**
	 * Evaluates the condition when starting; runs the THEN branch on SUCCESS, the ELSE branch on FAILURE.
	 * A running branch is continued without re-evaluating the condition.
	 */
	export function IfThenElse(condition: Node, then_node: Node, else_node?: Node): Node {
		const branch = new Map<Slot, number>(); // 0 = condition running, 1 = then running, 2 = else running
		const maps: StateMap[] = [branch];
		Adopt(condition, maps);
		Adopt(then_node, maps);
		if (else_node) Adopt(else_node, maps);
		const ct = condition.Tick;
		const chalt = condition.Halt;
		const tt = then_node.Tick;
		const th = then_node.Halt;
		const et = else_node?.Tick;
		const eh = else_node?.Halt;
		return MakeNode(
			"IfThenElse",
			(slot, dt, tree) => {
				let b = branch.get(slot);
				if (b === undefined || b === 0) {
					const c = ct(slot, dt, tree);
					if (c === RUNNING) {
						branch.set(slot, 0);
						return RUNNING;
					}
					if (c === SUCCESS) {
						b = 1;
					} else {
						if (et === undefined) {
							branch.delete(slot);
							return FAILURE;
						}
						b = 2;
					}
				}
				const s = b === 1 ? tt(slot, dt, tree) : et!(slot, dt, tree);
				if (s === RUNNING) branch.set(slot, b);
				else branch.delete(slot);
				return s;
			},
			(slot, tree) => {
				const b = branch.get(slot)!;
				branch.delete(slot);
				if (b === 0) chalt(slot, tree);
				else if (b === 1) th(slot, tree);
				else eh!(slot, tree);
			},
			maps,
		);
	}

	/**
	 * Re-evaluates the condition every tick; runs the DO branch while it succeeds and the ELSE branch while it
	 * fails, halting the other branch on a switch. While the condition itself is RUNNING no branch runs.
	 */
	export function WhileDoElse(condition: Node, do_node: Node, else_node?: Node): Node {
		const branch = new Map<Slot, number>(); // 0 = condition running, 1 = do running, 2 = else running
		const maps: StateMap[] = [branch];
		Adopt(condition, maps);
		Adopt(do_node, maps);
		if (else_node) Adopt(else_node, maps);
		const ct = condition.Tick;
		const chalt = condition.Halt;
		const dt_ = do_node.Tick;
		const dh = do_node.Halt;
		const et = else_node?.Tick;
		const eh = else_node?.Halt;
		return MakeNode(
			"WhileDoElse",
			(slot, dt, tree) => {
				const current = branch.get(slot);
				const c = ct(slot, dt, tree);
				if (c === RUNNING) {
					if (current === 1) dh(slot, tree);
					else if (current === 2) eh!(slot, tree);
					branch.set(slot, 0);
					return RUNNING;
				}
				const expected = c === SUCCESS ? 1 : 2;
				if (current !== undefined && current !== 0 && current !== expected) {
					if (current === 1) dh(slot, tree);
					else eh!(slot, tree);
				}
				if (expected === 2 && et === undefined) {
					branch.delete(slot);
					return FAILURE;
				}
				const s = expected === 1 ? dt_(slot, dt, tree) : et!(slot, dt, tree);
				if (s === RUNNING) branch.set(slot, expected);
				else branch.delete(slot);
				return s;
			},
			(slot, tree) => {
				const b = branch.get(slot)!;
				branch.delete(slot);
				if (b === 0) chalt(slot, tree);
				else if (b === 1) dh(slot, tree);
				else eh!(slot, tree);
			},
			maps,
		);
	}

	/** Runs TRY; on FAILURE runs CATCH; always runs FINALLY (its result is ignored). */
	export function TryCatch(try_node: Node, catch_node: Node, finally_node?: Node): Node {
		const phase = new Map<Slot, number>(); // 0 = try running, 1 = catch running, 2 = finally running
		const pending = new Map<Slot, ENodeStatus>(); // result to report after FINALLY
		const maps: StateMap[] = [phase, pending];
		Adopt(try_node, maps);
		Adopt(catch_node, maps);
		if (finally_node) Adopt(finally_node, maps);
		const tt = try_node.Tick;
		const th = try_node.Halt;
		const ct = catch_node.Tick;
		const ch = catch_node.Halt;
		const ft = finally_node?.Tick;
		const fh = finally_node?.Halt;

		const EnterFinally = (result: ENodeStatus, slot: Slot, dt: number, tree: BehaviorTree) => {
			if (ft === undefined) {
				phase.delete(slot);
				return result;
			}
			const s = ft(slot, dt, tree);
			if (s === RUNNING) {
				phase.set(slot, 2);
				pending.set(slot, result);
				return RUNNING;
			}
			phase.delete(slot);
			return result;
		};

		return MakeNode(
			"TryCatch",
			(slot, dt, tree) => {
				const p = phase.get(slot);
				if (p === 2) {
					const s = ft!(slot, dt, tree);
					if (s === RUNNING) return RUNNING;
					phase.delete(slot);
					const result = pending.get(slot)!;
					pending.delete(slot);
					return result;
				}
				if (p === 1) {
					const s = ct(slot, dt, tree);
					if (s === RUNNING) return RUNNING;
					return EnterFinally(s, slot, dt, tree);
				}
				const t = tt(slot, dt, tree);
				if (t === RUNNING) {
					phase.set(slot, 0);
					return RUNNING;
				}
				if (t === SUCCESS) return EnterFinally(SUCCESS, slot, dt, tree);
				const c = ct(slot, dt, tree);
				if (c === RUNNING) {
					phase.set(slot, 1);
					return RUNNING;
				}
				return EnterFinally(c, slot, dt, tree);
			},
			(slot, tree) => {
				const p = phase.get(slot)!;
				phase.delete(slot);
				if (p === 0) th(slot, tree);
				else if (p === 1) ch(slot, tree);
				else {
					pending.delete(slot);
					fh!(slot, tree);
				}
			},
			maps,
		);
	}

	/**
	 * Selects a case by the value the selector returns when the node starts, then runs that child to
	 * completion. FAILURE when no case and no default matches.
	 */
	export function Switch<K>(
		selector: (slot: Slot, tree: BehaviorTree) => K | undefined,
		cases: Map<K, Node>,
		default_node?: Node,
	): Node {
		const active = new Map<Slot, number>();
		const maps: StateMap[] = [active];
		const case_index = new Map<K, number>();
		const ticks: TickFn[] = [];
		const halts: HaltFn[] = [];
		for (const [key, node] of cases) {
			case_index.set(key, ticks.size());
			ticks.push(node.Tick);
			halts.push(node.Halt);
			Adopt(node, maps);
		}
		let default_index: number | undefined;
		if (default_node) {
			default_index = ticks.size();
			ticks.push(default_node.Tick);
			halts.push(default_node.Halt);
			Adopt(default_node, maps);
		}
		return MakeNode(
			"Switch",
			(slot, dt, tree) => {
				let i = active.get(slot);
				if (i === undefined) {
					const key = selector(slot, tree);
					i = key !== undefined ? case_index.get(key) : undefined;
					if (i === undefined) {
						if (default_index === undefined) return FAILURE;
						i = default_index;
					}
				}
				const s = ticks[i](slot, dt, tree);
				if (s === RUNNING) active.set(slot, i);
				else active.delete(slot);
				return s;
			},
			(slot, tree) => {
				const i = active.get(slot)!;
				active.delete(slot);
				halts[i](slot, tree);
			},
			maps,
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Decorators
	// ─────────────────────────────────────────────────────────────────────────────────────────────

	/** Swaps SUCCESS and FAILURE. */
	export function Inverter(child: Node): Node {
		const ct = child.Tick;
		return MakeNode(
			"Inverter",
			(slot, dt, tree) => {
				const s = ct(slot, dt, tree);
				if (s === SUCCESS) return FAILURE;
				if (s === FAILURE) return SUCCESS;
				return RUNNING;
			},
			child.Halt,
			child.Maps,
		);
	}

	/** SUCCESS unless the child is RUNNING. */
	export function ForceSuccess(child: Node): Node {
		const ct = child.Tick;
		return MakeNode(
			"ForceSuccess",
			(slot, dt, tree) => (ct(slot, dt, tree) === RUNNING ? RUNNING : SUCCESS),
			child.Halt,
			child.Maps,
		);
	}

	/** FAILURE unless the child is RUNNING. */
	export function ForceFailure(child: Node): Node {
		const ct = child.Tick;
		return MakeNode(
			"ForceFailure",
			(slot, dt, tree) => (ct(slot, dt, tree) === RUNNING ? RUNNING : FAILURE),
			child.Halt,
			child.Maps,
		);
	}

	/** Ticks the child (restarting it whenever it completes) and always returns RUNNING. */
	export function ForceRunning(child: Node): Node {
		const child_running = new Map<Slot, true>();
		const maps: StateMap[] = [child_running];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		return MakeNode(
			"ForceRunning",
			(slot, dt, tree) => {
				if (ct(slot, dt, tree) === RUNNING) child_running.set(slot, true);
				else child_running.delete(slot);
				return RUNNING;
			},
			(slot, tree) => {
				if (child_running.has(slot)) {
					child_running.delete(slot);
					ch(slot, tree);
				}
			},
			maps,
		);
	}

	/**
	 * Ticks the child and always returns SUCCESS. A child left RUNNING is halted by the tree at the end of the
	 * first tick in which this node is not visited, so `OnStart` / `OnHalt` of an always-running leaf inside
	 * bracket the span in which the branch is visited.
	 */
	export function FireAndForget(child: Node): Node {
		const child_running = new Map<Slot, true>();
		const last_seen = new Map<Slot, number>();
		const maps: StateMap[] = [child_running, last_seen];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		const halt: HaltFn = (slot, tree) => {
			if (child_running.has(slot)) {
				child_running.delete(slot);
				ch(slot, tree);
			}
		};
		return MakeNode(
			"FireAndForget",
			(slot, dt, tree) => {
				if (ct(slot, dt, tree) === RUNNING) {
					child_running.set(slot, true);
					tree.DetachRunning(last_seen, halt, slot);
				} else {
					child_running.delete(slot);
				}
				return SUCCESS;
			},
			halt,
			maps,
		);
	}

	export interface IScopeConfig {
		Name?: string;
		/** The first tick the node is visited after not being visited. */
		OnEnter?: (slot: Slot, tree: BehaviorTree) => void;
		/** End of the first tick in which the node is not visited (also on Halt / RemoveAgent). */
		OnExit?: (slot: Slot, tree: BehaviorTree) => void;
	}

	/**
	 * Brackets the span in which this position of the tree is visited: `OnEnter` when visits begin, `OnExit`
	 * when they stop. Always returns SUCCESS, so it can sit at the start of any branch. This is the replacement
	 * for the old OnBecameActivated / OnBecameInactive pair, as a node you opt into.
	 */
	export function Scope(config: IScopeConfig): Node {
		const { OnEnter, OnExit } = config;
		const inside = new Map<Slot, true>();
		const last_seen = new Map<Slot, number>();
		const halt: HaltFn = (slot, tree) => {
			if (inside.has(slot)) {
				inside.delete(slot);
				if (OnExit) OnExit(slot, tree);
			}
		};
		return MakeNode(
			config.Name ?? "Scope",
			(slot, dt, tree) => {
				if (!inside.has(slot)) {
					inside.set(slot, true);
					if (OnEnter) OnEnter(slot, tree);
				}
				tree.DetachRunning(last_seen, halt, slot);
				return SUCCESS;
			},
			halt,
			[inside, last_seen],
		);
	}

	/**
	 * Like Scope, but around a subtree: `OnEnter` before the child's first tick of a visited span, `OnExit`
	 * when visits stop. The child's status passes through unchanged.
	 */
	export function Scoped(config: IScopeConfig, child: Node): Node {
		const { OnEnter, OnExit } = config;
		const inside = new Map<Slot, true>();
		const child_running = new Map<Slot, true>();
		const last_seen = new Map<Slot, number>();
		const maps: StateMap[] = [inside, child_running, last_seen];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		const halt: HaltFn = (slot, tree) => {
			if (child_running.has(slot)) {
				child_running.delete(slot);
				ch(slot, tree);
			}
			if (inside.has(slot)) {
				inside.delete(slot);
				if (OnExit) OnExit(slot, tree);
			}
		};
		return MakeNode(
			config.Name ?? "Scoped",
			(slot, dt, tree) => {
				if (!inside.has(slot)) {
					inside.set(slot, true);
					if (OnEnter) OnEnter(slot, tree);
				}
				const s = ct(slot, dt, tree);
				if (s === RUNNING) {
					// The parent's halt cascade reaches us while RUNNING, so the detached list is not needed,
					// but the stamp must still say "visited this tick" for an entry made by an earlier tick.
					child_running.set(slot, true);
					last_seen.set(slot, tree.TickCount);
				} else {
					child_running.delete(slot);
					tree.DetachRunning(last_seen, halt, slot);
				}
				return s;
			},
			halt,
			maps,
		);
	}

	/** Passes SUCCESS / FAILURE through and turns RUNNING into FAILURE. The child keeps running (see FireAndForget). */
	export function RunningGate(child: Node): Node {
		const child_running = new Map<Slot, true>();
		const last_seen = new Map<Slot, number>();
		const maps: StateMap[] = [child_running, last_seen];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		const halt: HaltFn = (slot, tree) => {
			if (child_running.has(slot)) {
				child_running.delete(slot);
				ch(slot, tree);
			}
		};
		return MakeNode(
			"RunningGate",
			(slot, dt, tree) => {
				const s = ct(slot, dt, tree);
				if (s === RUNNING) {
					child_running.set(slot, true);
					tree.DetachRunning(last_seen, halt, slot);
					return FAILURE;
				}
				child_running.delete(slot);
				return s;
			},
			halt,
			maps,
		);
	}

	/** Halts the child and returns `behavior` when it has been running longer than `seconds`. */
	export function Timeout(
		seconds: number,
		child: Node,
		behavior: ETimeoutBehavior = ETimeoutBehavior.FAILURE,
	): Node {
		const time_left = new Map<Slot, number>();
		const maps: StateMap[] = [time_left];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		const expired = behavior === ETimeoutBehavior.FAILURE ? FAILURE : SUCCESS;
		return MakeNode(
			"Timeout",
			(slot, dt, tree) => {
				const started = time_left.get(slot);
				const t = (started ?? seconds) - dt;
				if (t <= 0) {
					if (started !== undefined) ch(slot, tree); // the child was running
					time_left.delete(slot);
					return expired;
				}
				const s = ct(slot, dt, tree);
				if (s === RUNNING) time_left.set(slot, t);
				else time_left.delete(slot);
				return s;
			},
			(slot, tree) => {
				time_left.delete(slot);
				ch(slot, tree);
			},
			maps,
		);
	}

	/** Retries the child until it succeeds; FAILURE after `max_attempts` failures (-1 = unlimited). */
	export function KeepRunningUntilSuccess(child: Node, max_attempts = -1): Node {
		const attempts = new Map<Slot, number>();
		const child_running = new Map<Slot, true>();
		const maps: StateMap[] = [attempts, child_running];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		return MakeNode(
			"KeepRunningUntilSuccess",
			(slot, dt, tree) => {
				const s = ct(slot, dt, tree);
				if (s === RUNNING) {
					child_running.set(slot, true);
					return RUNNING;
				}
				child_running.delete(slot);
				if (s === SUCCESS) {
					attempts.delete(slot);
					return SUCCESS;
				}
				const a = (attempts.get(slot) ?? 0) + 1;
				if (max_attempts > 0 && a >= max_attempts) {
					attempts.delete(slot);
					return FAILURE;
				}
				attempts.set(slot, a);
				return RUNNING;
			},
			(slot, tree) => {
				attempts.delete(slot);
				if (child_running.has(slot)) {
					child_running.delete(slot);
					ch(slot, tree);
				}
			},
			maps,
		);
	}

	/** Retries the child until it fails; SUCCESS after `max_attempts` successes (-1 = unlimited). */
	export function KeepRunningUntilFailure(child: Node, max_attempts = -1): Node {
		const attempts = new Map<Slot, number>();
		const child_running = new Map<Slot, true>();
		const maps: StateMap[] = [attempts, child_running];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		return MakeNode(
			"KeepRunningUntilFailure",
			(slot, dt, tree) => {
				const s = ct(slot, dt, tree);
				if (s === RUNNING) {
					child_running.set(slot, true);
					return RUNNING;
				}
				child_running.delete(slot);
				if (s === FAILURE) {
					attempts.delete(slot);
					return FAILURE;
				}
				const a = (attempts.get(slot) ?? 0) + 1;
				if (max_attempts > 0 && a >= max_attempts) {
					attempts.delete(slot);
					return SUCCESS;
				}
				attempts.set(slot, a);
				return RUNNING;
			},
			(slot, tree) => {
				attempts.delete(slot);
				if (child_running.has(slot)) {
					child_running.delete(slot);
					ch(slot, tree);
				}
			},
			maps,
		);
	}

	/** Runs the child `count` times, one completion per tick; RUNNING in between, SUCCESS at the end. */
	export function Repeat(
		count: number,
		child: Node,
		condition: ERepeatCondition = ERepeatCondition.ALWAYS,
	): Node {
		const done = new Map<Slot, number>();
		const child_running = new Map<Slot, true>();
		const maps: StateMap[] = [done, child_running];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		const only_success = condition === ERepeatCondition.SUCCESS;
		const only_failure = condition === ERepeatCondition.FAILURE;
		return MakeNode(
			"Repeat",
			(slot, dt, tree) => {
				const d = done.get(slot) ?? 0;
				if (d >= count) {
					done.delete(slot);
					return SUCCESS;
				}
				const s = ct(slot, dt, tree);
				if (s === RUNNING) {
					child_running.set(slot, true);
					if (d > 0) done.set(slot, d);
					return RUNNING;
				}
				child_running.delete(slot);
				if ((only_success && s !== SUCCESS) || (only_failure && s !== FAILURE) || d + 1 >= count) {
					done.delete(slot);
					return SUCCESS;
				}
				done.set(slot, d + 1);
				return RUNNING;
			},
			(slot, tree) => {
				done.delete(slot);
				if (child_running.has(slot)) {
					child_running.delete(slot);
					ch(slot, tree);
				}
			},
			maps,
		);
	}

	/**
	 * FAILURE while the cooldown runs; otherwise ticks the child, and starts the cooldown when it completes.
	 * With `reset_on_halt`, being halted also starts the cooldown. Time only passes while the node is ticked.
	 */
	export function Cooldown(seconds: number, child: Node, reset_on_halt = false): Node {
		const time_left = new Map<Slot, number>(); // absent = ready
		const maps: StateMap[] = [time_left];
		Adopt(child, maps);
		const ct = child.Tick;
		const ch = child.Halt;
		return MakeNode(
			"Cooldown",
			(slot, dt, tree) => {
				const left = time_left.get(slot);
				if (left !== undefined) {
					const t = left - dt;
					if (t > 0) {
						time_left.set(slot, t);
						return FAILURE;
					}
					time_left.delete(slot);
				}
				const s = ct(slot, dt, tree);
				if (s !== RUNNING) time_left.set(slot, seconds);
				return s;
			},
			(slot, tree) => {
				ch(slot, tree);
				if (reset_on_halt) time_left.set(slot, seconds);
			},
			maps,
		);
	}

	/**
	 * Runs the child once and returns its result on every later tick without re-running it.
	 * With `reset_on_inactive`, the result is forgotten when the node was not visited in the previous tick.
	 */
	export function OneShot(child: Node, reset_on_inactive = false): Node {
		const result = new Map<Slot, ENodeStatus>();
		const maps: StateMap[] = [result];
		Adopt(child, maps);
		const ct = child.Tick;
		if (!reset_on_inactive) {
			return MakeNode(
				"OneShot",
				(slot, dt, tree) => {
					const r = result.get(slot);
					if (r !== undefined) return r;
					const s = ct(slot, dt, tree);
					if (s !== RUNNING) result.set(slot, s);
					return s;
				},
				child.Halt,
				maps,
			);
		}
		const last_seen = new Map<Slot, number>();
		maps.push(last_seen);
		return MakeNode(
			"OneShot",
			(slot, dt, tree) => {
				const now = tree.TickCount;
				let r = result.get(slot);
				if (r !== undefined && last_seen.get(slot) !== now - 1) {
					result.delete(slot);
					r = undefined;
				}
				last_seen.set(slot, now);
				if (r !== undefined) return r;
				const s = ct(slot, dt, tree);
				if (s !== RUNNING) result.set(slot, s);
				return s;
			},
			child.Halt,
			maps,
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Leaves
	// ─────────────────────────────────────────────────────────────────────────────────────────────

	export interface ILeafConfig {
		Name?: string;
		/** Called when the leaf starts a run (idle -> running), before OnTick in the same tick. */
		OnStart?: (slot: Slot, tree: BehaviorTree) => void;
		/** Called every tick the leaf is visited. */
		OnTick: TickFn;
		/** Called when a RUNNING leaf is interrupted. */
		OnHalt?: (slot: Slot, tree: BehaviorTree) => void;
		OnSuccess?: (slot: Slot, tree: BehaviorTree) => void;
		OnFailure?: (slot: Slot, tree: BehaviorTree) => void;
		/** Called after OnSuccess / OnFailure, and after OnHalt with status RUNNING. */
		OnExit?: (status: ENodeStatus, slot: Slot, tree: BehaviorTree) => void;
		/**
		 * Visit-span hooks (see Scope): OnEnter on the first tick this leaf is visited, OnLeave at the end of the
		 * first tick it is not visited (and on halt / RemoveAgent). A span covers any number of runs.
		 */
		OnEnter?: (slot: Slot, tree: BehaviorTree) => void;
		OnLeave?: (slot: Slot, tree: BehaviorTree) => void;
	}

	/** A leaf with optional lifecycle hooks. Hooks are resolved once here; absent hooks cost nothing per tick. */
	export function Leaf(config: ILeafConfig): Node {
		const leaf = RunLeaf(config);
		if (config.OnEnter === undefined && config.OnLeave === undefined) return leaf;
		return Scoped({ Name: leaf.Name, OnEnter: config.OnEnter, OnExit: config.OnLeave }, leaf);
	}

	/** The run-level part of Leaf (everything but OnEnter / OnLeave). */
	function RunLeaf(config: ILeafConfig): Node {
		const { OnStart, OnTick, OnHalt, OnSuccess, OnFailure, OnExit } = config;
		const name = config.Name ?? "Leaf";
		const has_exit = OnSuccess !== undefined || OnFailure !== undefined || OnExit !== undefined;

		if (OnStart === undefined && !has_exit) {
			// No state at all: the node is the user's OnTick.
			return MakeNode(name, OnTick, OnHalt ?? NOOP, []);
		}

		const halt: HaltFn = (slot, tree) => {
			if (OnHalt) OnHalt(slot, tree);
			if (OnExit) OnExit(RUNNING, slot, tree);
		};

		if (OnStart === undefined) {
			return MakeNode(
				name,
				(slot, dt, tree) => {
					const s = OnTick(slot, dt, tree);
					if (s !== RUNNING) {
						if (s === SUCCESS) {
							if (OnSuccess) OnSuccess(slot, tree);
						} else if (OnFailure) OnFailure(slot, tree);
						if (OnExit) OnExit(s, slot, tree);
					}
					return s;
				},
				halt,
				[],
			);
		}

		const started = new Map<Slot, true>();
		return MakeNode(
			name,
			(slot, dt, tree) => {
				if (!started.has(slot)) {
					started.set(slot, true);
					OnStart(slot, tree);
				}
				const s = OnTick(slot, dt, tree);
				if (s !== RUNNING) {
					started.delete(slot);
					if (has_exit) {
						if (s === SUCCESS) {
							if (OnSuccess) OnSuccess(slot, tree);
						} else if (OnFailure) OnFailure(slot, tree);
						if (OnExit) OnExit(s, slot, tree);
					}
				}
				return s;
			},
			(slot, tree) => {
				started.delete(slot);
				halt(slot, tree);
			},
			[started],
		);
	}

	/** Runs the callback each tick and returns its status. */
	export function Action(action: TickFn, name = "Action"): Node {
		return MakeNode(name, action, NOOP, []);
	}

	/** SUCCESS when the predicate holds, otherwise FAILURE. */
	export function Condition(
		condition: (slot: Slot, dt: number, tree: BehaviorTree) => boolean,
		name = "Condition",
	): Node {
		return MakeNode(
			name,
			(slot, dt, tree) => (condition(slot, dt, tree) ? SUCCESS : FAILURE),
			NOOP,
			[],
		);
	}

	/** Runs the callback and returns SUCCESS. */
	export function Callback(
		callback: (slot: Slot, dt: number, tree: BehaviorTree) => void,
		name = "Callback",
	): Node {
		return MakeNode(
			name,
			(slot, dt, tree) => {
				callback(slot, dt, tree);
				return SUCCESS;
			},
			NOOP,
			[],
		);
	}

	/** Always returns the given status. */
	export function Plug(status: ENodeStatus = ENodeStatus.SUCCESS): Node {
		return MakeNode("Plug", () => status, NOOP, []);
	}

	/** Prints the message and returns SUCCESS. */
	export function Log(message: string): Node {
		return MakeNode(
			"Log",
			() => {
				print(message);
				return SUCCESS;
			},
			NOOP,
			[],
		);
	}

	/** RUNNING for `seconds`, then SUCCESS. */
	export function Wait(seconds: number): Node {
		const time_left = new Map<Slot, number>();
		return MakeNode(
			"Wait",
			(slot, dt) => {
				const t = (time_left.get(slot) ?? seconds) - dt;
				if (t <= 0) {
					time_left.delete(slot);
					return SUCCESS;
				}
				time_left.set(slot, t);
				return RUNNING;
			},
			(slot) => time_left.delete(slot),
			[time_left],
		);
	}

	/**
	 * FAILURE until `seconds` of visited ticks have passed, then SUCCESS and the timer restarts.
	 * The timer also restarts when the node was not visited in the previous tick.
	 */
	export function WaitGate(seconds: number): Node {
		const time_left = new Map<Slot, number>();
		const last_seen = new Map<Slot, number>();
		return MakeNode(
			"WaitGate",
			(slot, dt, tree) => {
				const now = tree.TickCount;
				let t = time_left.get(slot);
				if (t === undefined || last_seen.get(slot) !== now - 1) t = seconds;
				last_seen.set(slot, now);
				t -= dt;
				if (t <= 0) {
					time_left.set(slot, seconds);
					return SUCCESS;
				}
				time_left.set(slot, t);
				return FAILURE;
			},
			NOOP,
			[time_left, last_seen],
		);
	}

	/** Counts a per-agent field down by dt; SUCCESS once it reaches zero, FAILURE while positive or absent. */
	export function Timer(field: Map<Slot, number>): Node {
		return MakeNode(
			"Timer",
			(slot, dt) => {
				const t = field.get(slot);
				if (t === undefined) return FAILURE;
				const left = t - dt;
				field.set(slot, left);
				return left <= 0 ? SUCCESS : FAILURE;
			},
			NOOP,
			[],
		);
	}

	/**
	 * SUCCESS when any of the fields changed for the agent since the previous visited tick. On the first
	 * visit after a gap it reports SUCCESS, or FAILURE with `skip_first`, and takes a snapshot.
	 */
	export function WasFieldUpdated(fields: Map<Slot, unknown>[], skip_first = false): Node {
		const k = fields.size();
		const prev = new Array<Map<Slot, unknown>>(k);
		for (let i = 0; i < k; i++) prev[i] = new Map<Slot, unknown>();
		const last_seen = new Map<Slot, number>();
		const maps: StateMap[] = [last_seen];
		for (const m of prev) maps.push(m);
		return MakeNode(
			"WasFieldUpdated",
			(slot, dt, tree) => {
				const now = tree.TickCount;
				const fresh = last_seen.get(slot) !== now - 1;
				last_seen.set(slot, now);
				let changed = false;
				let i = 0;
				if (fresh) {
					changed = !skip_first;
					while (i < k) {
						prev[i].set(slot, fields[i].get(slot));
						i++;
					}
				} else {
					while (i < k) {
						const v = fields[i].get(slot);
						if (v !== prev[i].get(slot)) {
							changed = true;
							prev[i].set(slot, v);
						}
						i++;
					}
				}
				return changed ? SUCCESS : FAILURE;
			},
			NOOP,
			maps,
		);
	}

	/** Runs a per-agent FSM as a leaf: Start on start, Update each tick (always RUNNING), Stop on halt. */
	export function FSMConnector(get_fsm: (slot: Slot, tree: BehaviorTree) => FSM.FSM): Node {
		return Leaf({
			Name: "FSMConnector",
			OnStart: (slot, tree) => get_fsm(slot, tree).Start(),
			OnTick: (slot, dt, tree) => {
				get_fsm(slot, tree).Update(dt);
				return RUNNING;
			},
			OnHalt: (slot, tree) => get_fsm(slot, tree).Stop(),
		});
	}

	/** Runs a per-agent GOAP agent as a leaf: Update each tick (always RUNNING), Reset on halt. */
	export function GoapConnector(get_agent: (slot: Slot, tree: BehaviorTree) => Goap.Agent): Node {
		return Leaf({
			Name: "GoapConnector",
			OnTick: (slot, dt, tree) => {
				get_agent(slot, tree).Update(dt);
				return RUNNING;
			},
			OnHalt: (slot, tree) => get_agent(slot, tree).Reset(),
		});
	}

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Tree
	// ─────────────────────────────────────────────────────────────────────────────────────────────

	/** One shared tree plus the agents that run on it. */
	export class BehaviorTree {
		/** Number of Tick() calls so far. Nodes stamp per-agent state with it; do not modify. */
		TickCount = 0;

		private readonly status_ = new Map<Slot, ENodeStatus>();
		private readonly live_: Slot[] = [];
		private readonly pos_ = new Map<Slot, number>(); // slot -> index in live_ (-1 while pending)
		private readonly free_: Slot[] = []; // recyclable slots (allocating mode only)
		private next_slot_ = 1;
		private readonly external_ids_: boolean;
		private readonly fields_: StateMap[] = [];
		private readonly field_cleanups_ = new Map<StateMap, (slot: Slot, value: never) => void>();
		private readonly removed_callbacks_: ((slot: Slot, tree: BehaviorTree) => void)[] = [];
		private readonly maps_: StateMap[];

		// Children left running by FireAndForget / RunningGate: two count-tracked lists swapped each tick.
		private readonly det_stamps_: Map<Slot, number>[][] = [[], []];
		private readonly det_halts_: HaltFn[][] = [[], []];
		private readonly det_slots_: Slot[][] = [[], []];
		private readonly det_count_ = [0, 0];
		private det_cur_ = 0;

		private ticking_ = false;
		private readonly pending_add_: Slot[] = [];
		private readonly pending_remove_: Slot[] = [];

		/**
		 * @param options.external_ids  When true, agents are identified by ids you pass to AddAgent (for example
		 * ECS entity ids) and the tree never allocates any. When false (default), the tree allocates dense slots
		 * and AddAgent takes no argument. The two styles cannot be mixed on one tree, so ids can never collide.
		 */
		constructor(
			private readonly root_: Node,
			options?: { external_ids?: boolean },
		) {
			this.maps_ = root_.Maps;
			this.external_ids_ = options?.external_ids === true;
		}

		/** Whether this tree takes external ids (ECS mode) rather than allocating its own slots. */
		UsesExternalIds(): boolean {
			return this.external_ids_;
		}

		/**
		 * Creates a per-agent field. The tree clears the agent's entry when it is removed; `cleanup`, if given,
		 * runs first with the value the agent had (only when it had one).
		 */
		Field<T>(cleanup?: (slot: Slot, value: T) => void): Map<Slot, T> {
			const field = new Map<Slot, T>();
			this.RegisterField(field, cleanup);
			return field;
		}

		/** Registers an existing per-agent map so RemoveAgent clears it, with an optional cleanup for the value. */
		RegisterField<T>(field: Map<Slot, T>, cleanup?: (slot: Slot, value: T) => void): void {
			this.fields_.push(field as StateMap);
			if (cleanup)
				this.field_cleanups_.set(field as StateMap, cleanup as (slot: Slot, value: never) => void);
		}

		/**
		 * Called for every removed agent after its running nodes were halted and before its fields are cleared,
		 * so field values are still readable. Callbacks run in registration order.
		 */
		OnAgentRemoved(callback: (slot: Slot, tree: BehaviorTree) => void): void {
			this.removed_callbacks_.push(callback);
		}

		/**
		 * Adds an agent and returns its slot.
		 *
		 * Allocating mode (default): call with no argument; the tree hands out a small dense slot and recycles it
		 * after removal. External-id mode (`external_ids: true`): pass the id (an ECS entity id); it must be a
		 * positive integer and must not be live, or this throws. The tree never reuses an external id on its own.
		 */
		AddAgent(id?: Slot): Slot {
			let slot: Slot;
			if (this.external_ids_) {
				if (id === undefined)
					throw "BTree: this tree uses external ids; pass the entity id to AddAgent";
				if (id !== id || id < 1 || id % 1 !== 0) {
					throw `BTree: agent id must be a positive integer, got ${id}`;
				}
				if (this.pos_.has(id)) throw `BTree: agent ${id} already exists`;
				slot = id;
			} else {
				if (id !== undefined) {
					throw "BTree: this tree allocates its own slots; create it with { external_ids: true } to pass ids";
				}
				const recycled = this.free_.pop();
				if (recycled !== undefined) {
					slot = recycled;
				} else {
					slot = this.next_slot_;
					this.next_slot_ += 1;
				}
			}
			this.pos_.set(slot, -1);
			if (this.ticking_) this.pending_add_.push(slot);
			else this.Activate_(slot);
			return slot;
		}

		/** Halts everything running for the agent, clears its state in every node and field, frees the slot. */
		RemoveAgent(slot: Slot): void {
			if (!this.pos_.has(slot)) return;
			if (this.ticking_) this.pending_remove_.push(slot);
			else this.Deactivate_(slot);
		}

		HasAgent(slot: Slot): boolean {
			return this.pos_.has(slot);
		}

		/** Live slots, in tick order. Do not modify. */
		GetAgents(): readonly Slot[] {
			return this.live_;
		}

		GetAgentCount(): number {
			return this.live_.size();
		}

		/** Ticks every live agent once. Agents added or removed from callbacks take effect after the tick. */
		Tick(dt: number): void {
			this.TickCount += 1;
			this.ticking_ = true;
			const tick = this.root_.Tick;
			const status = this.status_;
			for (const slot of this.live_) {
				status.set(slot, tick(slot, dt, this));
			}
			this.ticking_ = false;
			const prev = 1 - this.det_cur_;
			if (this.det_count_[prev] > 0) this.SweepDetached_();
			this.det_cur_ = prev;
			if (this.pending_add_.size() > 0) {
				for (const slot of this.pending_add_) this.Activate_(slot);
				this.pending_add_.clear();
			}
			if (this.pending_remove_.size() > 0) {
				for (const slot of this.pending_remove_) this.Deactivate_(slot);
				this.pending_remove_.clear();
			}
		}

		/**
		 * Ticks one agent instead of all of them, for drivers that own their own update loop (FSM / GOAP
		 * connectors). Do not mix with Tick() for the same agent in the same frame. Not allowed during Tick().
		 */
		TickAgent(slot: Slot, dt: number): ENodeStatus {
			if (this.ticking_) throw "BTree: TickAgent cannot be called during Tick";
			if (!this.pos_.has(slot)) throw `BTree: agent ${slot} does not exist`;
			this.TickCount += 1;
			this.ticking_ = true;
			const s = this.root_.Tick(slot, dt, this);
			this.status_.set(slot, s);
			this.ticking_ = false;
			const prev = 1 - this.det_cur_;
			if (this.det_count_[prev] > 0) this.SweepDetached_();
			this.det_cur_ = prev;
			if (this.pending_add_.size() > 0) {
				for (const p of this.pending_add_) this.Activate_(p);
				this.pending_add_.clear();
			}
			if (this.pending_remove_.size() > 0) {
				for (const p of this.pending_remove_) this.Deactivate_(p);
				this.pending_remove_.clear();
			}
			return s;
		}

		/** Root status of the agent from the latest tick. */
		GetStatus(slot: Slot): ENodeStatus | undefined {
			return this.status_.get(slot);
		}

		/** Halts everything running for one agent without removing it. It restarts from the root next tick. */
		Halt(slot: Slot): void {
			if (this.ticking_) throw "BTree: Halt cannot be called during Tick";
			this.HaltSlot_(slot);
		}

		/** Halts every agent. */
		HaltAll(): void {
			if (this.ticking_) throw "BTree: HaltAll cannot be called during Tick";
			for (const slot of this.live_) this.HaltSlot_(slot);
		}

		GetRoot(): Node {
			return this.root_;
		}

		/**
		 * For nodes that leave a child running while not being RUNNING themselves. The tree halts the child
		 * (via `halt`) at the end of the first tick in which the node is not visited for that slot.
		 */
		DetachRunning(last_seen: Map<Slot, number>, halt: HaltFn, slot: Slot): void {
			last_seen.set(slot, this.TickCount);
			const cur = this.det_cur_;
			const n = this.det_count_[cur];
			this.det_stamps_[cur][n] = last_seen;
			this.det_halts_[cur][n] = halt;
			this.det_slots_[cur][n] = slot;
			this.det_count_[cur] = n + 1;
		}

		private Activate_(slot: Slot): void {
			this.pos_.set(slot, this.live_.push(slot) - 1);
		}

		private Deactivate_(slot: Slot): void {
			if (!this.pos_.has(slot)) return; // queued twice during one tick
			this.HaltSlot_(slot);
			for (const m of this.maps_) m.delete(slot);
			for (const callback of this.removed_callbacks_) callback(slot, this);
			for (const m of this.fields_) {
				const cleanup = this.field_cleanups_.get(m);
				if (cleanup !== undefined) {
					const value = m.get(slot);
					if (value !== undefined) cleanup(slot, value as never);
				}
				m.delete(slot);
			}
			const live = this.live_;
			const p = this.pos_.get(slot)!;
			const last = live.pop()!;
			if (last !== slot) {
				live[p] = last;
				this.pos_.set(last, p);
			}
			this.pos_.delete(slot);
			if (!this.external_ids_) this.free_.push(slot);
		}

		private HaltSlot_(slot: Slot): void {
			if (this.status_.get(slot) === RUNNING) this.root_.Halt(slot, this);
			this.status_.delete(slot);
			for (let list = 0; list < 2; list++) {
				const slots = this.det_slots_[list];
				const halts = this.det_halts_[list];
				const n = this.det_count_[list];
				for (let i = 0; i < n; i++) {
					if (slots[i] === slot) {
						slots[i] = 0;
						halts[i](slot, this);
					}
				}
			}
		}

		/** Halts detached children recorded last tick that were not re-detached this tick. */
		private SweepDetached_(): void {
			const prev = 1 - this.det_cur_;
			const n = this.det_count_[prev];
			const stamps = this.det_stamps_[prev];
			const halts = this.det_halts_[prev];
			const slots = this.det_slots_[prev];
			const now = this.TickCount;
			let i = 0;
			while (i < n) {
				const slot = slots[i];
				if (slot !== 0 && stamps[i].get(slot) !== now) halts[i](slot, this);
				i++;
			}
			this.det_count_[prev] = 0;
		}
	}
}

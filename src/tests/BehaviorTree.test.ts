import { testInit, test, expect, runTests } from "@rbxts/tester";
import { BTree } from "BehaviorTree";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const FAILURE = BTree.ENodeStatus.FAILURE;
const RUNNING = BTree.ENodeStatus.RUNNING;

testInit(() => {
	print("BehaviorTree tests initialized");
});

// Helper: one tree with one agent; returns a tick function that yields the root status.
function makeTree(root: BTree.Node) {
	const tree = new BTree.BehaviorTree(root);
	const slot = tree.AddAgent();
	const tick = (dt: number) => {
		tree.Tick(dt);
		return tree.GetStatus(slot)!;
	};
	return { tree, slot, tick };
}

// Helper: the message of a caught error, without the "file:line: " prefix error() adds. (The tester's
// toContainSubstring never fails on a string, so tests compare the whole message instead.)
function message(err: unknown) {
	return tostring(err).gsub("^.-:%d+: ", "")[0];
}

// ── Plug (stub node) ─────────────────────────────────────────────────

test("Plug always returns SUCCESS", () => {
	expect(makeTree(BTree.Plug(SUCCESS)).tick(0)).toBe(SUCCESS);
});

test("Plug always returns FAILURE", () => {
	expect(makeTree(BTree.Plug(FAILURE)).tick(0)).toBe(FAILURE);
});

test("Plug always returns RUNNING", () => {
	expect(makeTree(BTree.Plug(RUNNING)).tick(0)).toBe(RUNNING);
});

// ── Action / Condition / Callback ────────────────────────────────────

test("Action executes callback and returns its status", () => {
	expect(makeTree(BTree.Action(() => SUCCESS)).tick(0)).toBe(SUCCESS);
});

test("Action receives slot, dt and tree", () => {
	let received_dt = 0;
	let received_slot = 0;
	let received_tree: BTree.BehaviorTree | undefined;
	const { tree, slot, tick } = makeTree(
		BTree.Action((s, dt, t) => {
			received_slot = s;
			received_dt = dt;
			received_tree = t;
			return SUCCESS;
		}),
	);
	tick(0.5);
	expect(received_dt).toBe(0.5);
	expect(received_slot).toBe(slot);
	expect(received_tree).toBe(tree);
});

test("Condition returns SUCCESS when true and FAILURE when false", () => {
	expect(makeTree(BTree.Condition(() => true)).tick(0)).toBe(SUCCESS);
	expect(makeTree(BTree.Condition(() => false)).tick(0)).toBe(FAILURE);
});

test("Callback node executes and returns SUCCESS", () => {
	let called = false;
	const { tick } = makeTree(
		BTree.Callback(() => {
			called = true;
		}),
	);
	expect(tick(0)).toBe(SUCCESS);
	expect(called).toBeTruthy();
});

// ── Fields ───────────────────────────────────────────────────────────

test("Fields are per agent and cleared on RemoveAgent with cleanup", () => {
	const tree = new BTree.BehaviorTree(BTree.Plug(SUCCESS));
	const cleaned: number[] = [];
	const hp = tree.Field<number>((slot, value) => cleaned.push(value));
	const a = tree.AddAgent();
	const b = tree.AddAgent();
	hp.set(a, 10);
	hp.set(b, 20);
	tree.RemoveAgent(a);
	expect(hp.has(a)).toBeFalsy();
	expect(hp.get(b)).toBe(20);
	expect(cleaned.size()).toBe(1);
	expect(cleaned[0]).toBe(10);
});

// ── Sequence ─────────────────────────────────────────────────────────

test("Sequence returns SUCCESS when all children succeed", () => {
	const seq = BTree.Sequence(BTree.Plug(SUCCESS), BTree.Plug(SUCCESS), BTree.Plug(SUCCESS));
	expect(makeTree(seq).tick(0)).toBe(SUCCESS);
});

test("Sequence returns FAILURE on first failing child", () => {
	let third_called = false;
	const seq = BTree.Sequence(
		BTree.Plug(SUCCESS),
		BTree.Plug(FAILURE),
		BTree.Action(() => {
			third_called = true;
			return SUCCESS;
		}),
	);
	expect(makeTree(seq).tick(0)).toBe(FAILURE);
	expect(third_called).toBeFalsy();
});

test("Sequence returns RUNNING and resumes from the running child", () => {
	let call_count_a = 0;
	let call_count_b = 0;
	const seq = BTree.Sequence(
		BTree.Action(() => {
			call_count_a++;
			return call_count_a === 1 ? RUNNING : SUCCESS;
		}),
		BTree.Action(() => {
			call_count_b++;
			return SUCCESS;
		}),
	);
	const { tick } = makeTree(seq);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(SUCCESS);
	expect(call_count_a).toBe(2);
	expect(call_count_b).toBe(1);
});

// ── Fallback ─────────────────────────────────────────────────────────

test("Fallback returns SUCCESS on first succeeding child", () => {
	let third_called = false;
	const fb = BTree.Fallback(
		BTree.Plug(FAILURE),
		BTree.Plug(SUCCESS),
		BTree.Action(() => {
			third_called = true;
			return SUCCESS;
		}),
	);
	expect(makeTree(fb).tick(0)).toBe(SUCCESS);
	expect(third_called).toBeFalsy();
});

test("Fallback returns FAILURE when all children fail", () => {
	expect(makeTree(BTree.Fallback(BTree.Plug(FAILURE), BTree.Plug(FAILURE))).tick(0)).toBe(FAILURE);
});

test("Fallback returns RUNNING and resumes", () => {
	let count_a = 0;
	const fb = BTree.Fallback(
		BTree.Action(() => {
			count_a++;
			return count_a === 1 ? RUNNING : SUCCESS;
		}),
		BTree.Plug(SUCCESS),
	);
	const { tick } = makeTree(fb);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(SUCCESS);
});

// ── ReactiveSequence ─────────────────────────────────────────────────

test("ReactiveSequence restarts from first child each tick and halts a skipped running child", () => {
	let count_first = 0;
	let halted = false;
	let gate = true;
	const rs = BTree.ReactiveSequence(
		BTree.Condition(() => {
			count_first++;
			return gate;
		}),
		BTree.Leaf({
			OnTick: () => RUNNING,
			OnHalt: () => {
				halted = true;
			},
		}),
	);
	const { tick } = makeTree(rs);
	tick(0);
	tick(0);
	expect(count_first).toBe(2);
	gate = false;
	expect(tick(0)).toBe(FAILURE);
	expect(halted).toBeTruthy();
});

// ── Decorators ───────────────────────────────────────────────────────

test("Inverter inverts SUCCESS/FAILURE and passes RUNNING", () => {
	expect(makeTree(BTree.Inverter(BTree.Plug(SUCCESS))).tick(0)).toBe(FAILURE);
	expect(makeTree(BTree.Inverter(BTree.Plug(FAILURE))).tick(0)).toBe(SUCCESS);
	expect(makeTree(BTree.Inverter(BTree.Plug(RUNNING))).tick(0)).toBe(RUNNING);
});

test("ForceSuccess / ForceFailure / ForceRunning", () => {
	expect(makeTree(BTree.ForceSuccess(BTree.Plug(FAILURE))).tick(0)).toBe(SUCCESS);
	expect(makeTree(BTree.ForceSuccess(BTree.Plug(RUNNING))).tick(0)).toBe(RUNNING);
	expect(makeTree(BTree.ForceFailure(BTree.Plug(SUCCESS))).tick(0)).toBe(FAILURE);
	expect(makeTree(BTree.ForceFailure(BTree.Plug(RUNNING))).tick(0)).toBe(RUNNING);
	expect(makeTree(BTree.ForceRunning(BTree.Plug(SUCCESS))).tick(0)).toBe(RUNNING);
});

test("FireAndForget returns SUCCESS regardless of child", () => {
	expect(makeTree(BTree.FireAndForget(BTree.Plug(FAILURE))).tick(0)).toBe(SUCCESS);
});

test("RunningGate returns FAILURE when child is RUNNING, passes SUCCESS", () => {
	expect(makeTree(BTree.RunningGate(BTree.Plug(RUNNING))).tick(0)).toBe(FAILURE);
	expect(makeTree(BTree.RunningGate(BTree.Plug(SUCCESS))).tick(0)).toBe(SUCCESS);
});

// ── Wait / WaitGate ──────────────────────────────────────────────────

test("Wait returns RUNNING until duration elapses", () => {
	const { tick } = makeTree(BTree.Wait(1.0));
	expect(tick(0.3)).toBe(RUNNING);
	expect(tick(0.3)).toBe(RUNNING);
	expect(tick(0.5)).toBe(SUCCESS);
});

test("WaitGate returns FAILURE until duration elapses then SUCCESS", () => {
	const { tick } = makeTree(BTree.WaitGate(1.0));
	expect(tick(0.4)).toBe(FAILURE);
	expect(tick(0.4)).toBe(FAILURE);
	expect(tick(0.4)).toBe(SUCCESS);
});

// ── IfThenElse ───────────────────────────────────────────────────────

test("IfThenElse executes THEN branch on condition SUCCESS", () => {
	const ite = BTree.IfThenElse(BTree.Plug(SUCCESS), BTree.Plug(SUCCESS), BTree.Plug(FAILURE));
	expect(makeTree(ite).tick(0)).toBe(SUCCESS);
});

test("IfThenElse executes ELSE branch on condition FAILURE", () => {
	let then_called = false;
	const ite = BTree.IfThenElse(
		BTree.Plug(FAILURE),
		BTree.Action(() => {
			then_called = true;
			return SUCCESS;
		}),
		BTree.Plug(SUCCESS),
	);
	expect(makeTree(ite).tick(0)).toBe(SUCCESS);
	expect(then_called).toBeFalsy();
});

test("IfThenElse without else returns FAILURE when condition fails", () => {
	expect(makeTree(BTree.IfThenElse(BTree.Plug(FAILURE), BTree.Plug(SUCCESS))).tick(0)).toBe(
		FAILURE,
	);
});

// ── Parallel ─────────────────────────────────────────────────────────

test("Parallel with ALL/ALL succeeds when all children succeed", () => {
	const par = BTree.Parallel(
		BTree.EParallelPolicy.ALL,
		BTree.EParallelPolicy.ALL,
		BTree.Plug(SUCCESS),
		BTree.Plug(SUCCESS),
	);
	expect(makeTree(par).tick(0)).toBe(SUCCESS);
});

test("Parallel with ONE success policy succeeds when first child succeeds and halts the rest", () => {
	let halted = false;
	const par = BTree.Parallel(
		BTree.EParallelPolicy.ONE,
		BTree.EParallelPolicy.ONE,
		BTree.Leaf({
			OnTick: () => RUNNING,
			OnHalt: () => {
				halted = true;
			},
		}),
		BTree.Plug(SUCCESS),
	);
	expect(makeTree(par).tick(0)).toBe(SUCCESS);
	expect(halted).toBeTruthy();
});

test("Parallel returns RUNNING while children are running", () => {
	const par = BTree.Parallel(
		BTree.EParallelPolicy.ALL,
		BTree.EParallelPolicy.ALL,
		BTree.Plug(SUCCESS),
		BTree.Plug(RUNNING),
	);
	expect(makeTree(par).tick(0)).toBe(RUNNING);
});

test("Parallel ALL/ALL fails once every child has finished with mixed results, and starts over", () => {
	const ALL = BTree.EParallelPolicy.ALL;
	expect(makeTree(BTree.Parallel(ALL, ALL, BTree.Plug(SUCCESS), BTree.Plug(FAILURE))).tick(0)).toBe(
		FAILURE,
	);
	let ticked_b = 0;
	const par = BTree.Parallel(
		ALL,
		ALL,
		BTree.Wait(1.0),
		BTree.Action(() => {
			ticked_b++;
			return FAILURE;
		}),
	);
	const { tick } = makeTree(par);
	expect(tick(0.5)).toBe(RUNNING);
	expect(tick(0.6)).toBe(FAILURE); // the Wait finished: every child is done, neither policy met
	expect(ticked_b).toBe(1); // finished children are not ticked again while the Parallel runs
	expect(tick(0.5)).toBe(RUNNING); // state cleared: both children start over
	expect(ticked_b).toBe(2);
});

test("Parallel finishes once every child has finished, for every policy pair and with no children", () => {
	const ONE = BTree.EParallelPolicy.ONE;
	const ALL = BTree.EParallelPolicy.ALL;
	// [success policy, failure policy, child results, expected]
	const cases: [
		BTree.EParallelPolicy,
		BTree.EParallelPolicy,
		BTree.ENodeStatus[],
		BTree.ENodeStatus,
	][] = [
		[ALL, ALL, [], SUCCESS],
		[ALL, ONE, [], SUCCESS],
		[ONE, ALL, [], FAILURE],
		[ONE, ONE, [], FAILURE],
		[ALL, ALL, [SUCCESS, SUCCESS], SUCCESS],
		[ALL, ALL, [FAILURE, FAILURE], FAILURE],
		[ALL, ALL, [SUCCESS, FAILURE], FAILURE],
		[ALL, ALL, [FAILURE, SUCCESS], FAILURE],
		[ALL, ONE, [SUCCESS, SUCCESS], SUCCESS],
		[ALL, ONE, [SUCCESS, FAILURE], FAILURE],
		[ONE, ALL, [FAILURE, FAILURE], FAILURE],
		[ONE, ALL, [FAILURE, SUCCESS], SUCCESS],
		[ONE, ONE, [SUCCESS, FAILURE], SUCCESS],
		[ONE, ONE, [FAILURE, SUCCESS], FAILURE],
	];
	for (const [sp, fp, results, expected] of cases) {
		const label = `${sp}/${fp} [${results.join(",")}]`;
		// Every child finishes in the first tick.
		const same = new Array<BTree.Node>();
		// Child i runs for i ticks first, so later children finish in later ticks.
		const staggered = new Array<BTree.Node>();
		results.forEach((result, i) => {
			same.push(BTree.Plug(result));
			let t = 0;
			staggered.push(
				BTree.Leaf({ OnStart: () => (t = 0), OnTick: () => (t++ < i ? RUNNING : result) }),
			);
		});
		for (const children of [same, staggered]) {
			const { tick } = makeTree(BTree.Parallel(sp, fp, ...children));
			const ticks = math.max(results.size(), 1);
			for (let run = 0; run < 2; run++) {
				// By the tick in which the last child finishes, the Parallel has finished too (twice: it starts over).
				let s = tick(0);
				let n = 1;
				while (s === RUNNING && n < ticks) {
					s = tick(0);
					n++;
				}
				expect(`${label} -> ${s}`).toBe(`${label} -> ${expected}`);
			}
		}
	}
});

// ── Repeat ───────────────────────────────────────────────────────────

test("Repeat executes child N times then returns SUCCESS", () => {
	let count = 0;
	const rep = BTree.Repeat(
		3,
		BTree.Action(() => {
			count++;
			return SUCCESS;
		}),
	);
	const { tick } = makeTree(rep);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(SUCCESS);
	expect(count).toBe(3);
});

// ── OneShot ──────────────────────────────────────────────────────────

test("OneShot executes child once and caches result", () => {
	let count = 0;
	const os = BTree.OneShot(
		BTree.Action(() => {
			count++;
			return SUCCESS;
		}),
	);
	const { tick } = makeTree(os);
	expect(tick(0)).toBe(SUCCESS);
	expect(tick(0)).toBe(SUCCESS);
	expect(count).toBe(1);
});

// ── KeepRunningUntil* ────────────────────────────────────────────────

test("KeepRunningUntilSuccess retries until child succeeds", () => {
	let count = 0;
	const krus = BTree.KeepRunningUntilSuccess(
		BTree.Action(() => {
			count++;
			return count < 3 ? FAILURE : SUCCESS;
		}),
	);
	const { tick } = makeTree(krus);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(SUCCESS);
});

test("KeepRunningUntilSuccess fails after max attempts", () => {
	const { tick } = makeTree(BTree.KeepRunningUntilSuccess(BTree.Plug(FAILURE), 2));
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(FAILURE);
});

test("KeepRunningUntilFailure retries until child fails", () => {
	let count = 0;
	const kruf = BTree.KeepRunningUntilFailure(
		BTree.Action(() => {
			count++;
			return count < 3 ? SUCCESS : FAILURE;
		}),
	);
	const { tick } = makeTree(kruf);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(RUNNING);
	expect(tick(0)).toBe(FAILURE);
});

// ── Timeout / Cooldown ───────────────────────────────────────────────

test("Timeout returns FAILURE after time expires and halts the child", () => {
	let halted = false;
	const timeout = BTree.Timeout(
		1.0,
		BTree.Leaf({
			OnTick: () => RUNNING,
			OnHalt: () => {
				halted = true;
			},
		}),
	);
	const { tick } = makeTree(timeout);
	expect(tick(0.5)).toBe(RUNNING);
	expect(tick(0.6)).toBe(FAILURE);
	expect(halted).toBeTruthy();
});

test("Timeout returns SUCCESS when configured", () => {
	const timeout = BTree.Timeout(1.0, BTree.Plug(RUNNING), BTree.ETimeoutBehavior.SUCCESS);
	const { tick } = makeTree(timeout);
	expect(tick(0.5)).toBe(RUNNING);
	expect(tick(0.6)).toBe(SUCCESS);
});

test("Cooldown blocks execution during cooldown period", () => {
	let count = 0;
	const cooldown = BTree.Cooldown(
		1.0,
		BTree.Action(() => {
			count++;
			return SUCCESS;
		}),
	);
	const { tick } = makeTree(cooldown);
	expect(tick(0)).toBe(SUCCESS);
	expect(count).toBe(1);
	expect(tick(0.5)).toBe(FAILURE);
	expect(count).toBe(1);
	expect(tick(0.6)).toBe(SUCCESS);
	expect(count).toBe(2);
});

// ── Leaf lifecycle ───────────────────────────────────────────────────

test("Leaf OnStart fires once per run and OnHalt on interruption", () => {
	const log: string[] = [];
	let status: BTree.ENodeStatus = RUNNING;
	const leaf = BTree.Leaf({
		OnStart: () => log.push("start"),
		OnTick: () => status,
		OnHalt: () => log.push("halt"),
		OnExit: (s) => log.push(`exit${s}`),
	});
	const { tree, slot, tick } = makeTree(leaf);
	tick(0);
	tick(0);
	status = SUCCESS;
	tick(0);
	expect(log.join(",")).toBe("start,exit0");
	status = RUNNING;
	tick(0);
	tree.Halt(slot);
	expect(log.join(",")).toBe("start,exit0,start,halt,exit2");
});

test("Scope brackets the visited span", () => {
	const log: string[] = [];
	let gate = true;
	const root = BTree.Fallback(
		BTree.Sequence(
			BTree.Condition(() => gate),
			BTree.Scope({ OnEnter: () => log.push("enter"), OnExit: () => log.push("exit") }),
			BTree.Plug(SUCCESS),
		),
		BTree.Plug(SUCCESS),
	);
	const { tick } = makeTree(root);
	tick(0);
	tick(0);
	expect(log.join(",")).toBe("enter");
	gate = false;
	tick(0);
	expect(log.join(",")).toBe("enter,exit");
});

// ── Switch ───────────────────────────────────────────────────────────

test("Switch selects a case by selector value with default fallback", () => {
	const tree = new BTree.BehaviorTree(
		BTree.Switch(
			(slot) => (slot === 1 ? "a" : undefined),
			new Map<string, BTree.Node>([["a", BTree.Plug(SUCCESS)]]),
			BTree.Plug(FAILURE),
		),
	);
	const a = tree.AddAgent();
	const b = tree.AddAgent();
	tree.Tick(0);
	expect(tree.GetStatus(a)).toBe(SUCCESS);
	expect(tree.GetStatus(b)).toBe(FAILURE);
});

// ── A throwing OnHalt caused mid-tick ────────────────────────────────

// Helper: a leaf that runs until halted and whose OnHalt throws; logs "<name>+" on start, "<name>-" on halt.
function throwingLeaf(log: string[], name: string) {
	return BTree.Leaf({
		OnStart: () => log.push(`${name}+`),
		OnTick: () => RUNNING,
		OnHalt: () => {
			log.push(`${name}-`);
			throw `${name} boom`;
		},
	});
}

test("A reactive composite completes a switch or a finish when the halted child's OnHalt throws", () => {
	// [name, factory, what the first child returns to let the second one run]
	const cases: [string, (...children: BTree.Node[]) => BTree.Node, BTree.ENodeStatus][] = [
		["ReactiveSequence", BTree.ReactiveSequence, SUCCESS],
		["ReactiveFallback", BTree.ReactiveFallback, FAILURE],
	];
	for (const [name, reactive, pass] of cases) {
		const stop = pass === SUCCESS ? FAILURE : SUCCESS; // ends the composite from the first child
		// Switch: the first child starts running while the second one runs.
		{
			const log: string[] = [];
			let flip = false;
			const { tree, slot, tick } = makeTree(
				reactive(
					BTree.Leaf({
						OnStart: () => log.push("A+"),
						OnTick: () => (flip ? RUNNING : pass),
						OnHalt: () => log.push("A-"),
					}),
					BTree.Sequence(throwingLeaf(log, "B")),
				),
			);
			tick(0);
			flip = true;
			const [ok, err] = pcall(() => tick(0));
			expect(`${name}: ${ok ? "ok" : message(err)}`).toBe(`${name}: B boom`);
			// Before the fix, every later tick halted the idle Sequence again and threw an internal error.
			const [ok2, err2] = pcall(() => tick(0));
			expect(`${name}: ${ok2 ? "ok" : message(err2)}`).toBe(`${name}: ok`);
			tree.RemoveAgent(slot); // halts A, which the switch started
			expect(`${name}: ${log.join(",")}`).toBe(`${name}: A+,B+,A+,B-,A-`);
		}
		// Finish: the first child ends the composite while the second one runs.
		{
			const log: string[] = [];
			let flip = false;
			const { tree, slot, tick } = makeTree(
				reactive(
					BTree.Action(() => (flip ? stop : pass)),
					BTree.Sequence(throwingLeaf(log, "B")),
				),
			);
			tick(0);
			flip = true;
			const [ok, err] = pcall(() => tick(0));
			expect(`${name}: ${ok ? "ok" : message(err)}`).toBe(`${name}: B boom`);
			expect(`${name}: ${tree.GetStatus(slot)}`).toBe(`${name}: ${stop}`); // finished in that tick
			// Before the fix, the agent stayed RUNNING and this halted the idle composite: an internal error.
			const [ok2, err2] = pcall(() => tree.Halt(slot));
			expect(`${name}: ${ok2 ? "ok" : message(err2)}`).toBe(`${name}: ok`);
			expect(`${name}: ${log.join(",")}`).toBe(`${name}: B+,B-`);
		}
	}
});

test("WhileDoElse and Timeout complete their tick when the child they halt throws in OnHalt", () => {
	// WhileDoElse: [what the condition turns to while the DO branch runs, expected log]
	const cases: [BTree.ENodeStatus, string][] = [
		[FAILURE, "D+,D-,E+,E-"], // switch to the ELSE branch, halted on removal
		[RUNNING, "D+,D-"], // the condition itself runs: no branch
	];
	for (const [after, expected] of cases) {
		const log: string[] = [];
		let cond = SUCCESS;
		const { tree, slot, tick } = makeTree(
			BTree.WhileDoElse(
				BTree.Action(() => cond),
				BTree.Sequence(throwingLeaf(log, "D")),
				BTree.Leaf({
					OnStart: () => log.push("E+"),
					OnTick: () => RUNNING,
					OnHalt: () => log.push("E-"),
				}),
			),
		);
		tick(0);
		cond = after;
		const [ok, err] = pcall(() => tick(0));
		expect(`${after}: ${ok ? "ok" : message(err)}`).toBe(`${after}: D boom`);
		// Before the fix, every later tick halted the idle DO branch again and threw an internal error.
		const [ok2, err2] = pcall(() => tick(0));
		expect(`${after}: ${ok2 ? "ok" : message(err2)}`).toBe(`${after}: ok`);
		tree.RemoveAgent(slot);
		expect(`${after}: ${log.join(",")}`).toBe(`${after}: ${expected}`);
	}
	const log: string[] = [];
	const { tree, slot, tick } = makeTree(BTree.Timeout(1, BTree.Sequence(throwingLeaf(log, "T"))));
	tick(0.5);
	const [ok, err] = pcall(() => tick(0.6));
	expect(ok ? "ok" : message(err)).toBe("T boom");
	expect(tree.GetStatus(slot)).toBe(FAILURE); // expired in that tick
	expect(tick(0.5)).toBe(RUNNING); // a new run; before the fix, an internal error on every tick
	expect(log.join(",")).toBe("T+,T-,T+");
});

// ── Tree: agents ─────────────────────────────────────────────────────

test("Agents on one tree have independent state", () => {
	const tree = new BTree.BehaviorTree(BTree.Wait(1.0));
	const a = tree.AddAgent();
	tree.Tick(0.6);
	const b = tree.AddAgent();
	tree.Tick(0.6);
	expect(tree.GetStatus(a)).toBe(SUCCESS);
	expect(tree.GetStatus(b)).toBe(RUNNING);
});

test("Halt halts running nodes for one agent", () => {
	let halted = 0;
	const tree = new BTree.BehaviorTree(
		BTree.Leaf({
			OnTick: () => RUNNING,
			OnHalt: () => {
				halted++;
			},
		}),
	);
	const a = tree.AddAgent();
	tree.AddAgent();
	tree.Tick(0);
	tree.Halt(a);
	expect(halted).toBe(1);
	expect(tree.GetStatus(a)).toBe(undefined);
	tree.HaltAll();
	expect(halted).toBe(2);
});

test("RemoveAgent halts and frees; removal during Tick is deferred", () => {
	let halted = 0;
	let tree: BTree.BehaviorTree;
	tree = new BTree.BehaviorTree(
		BTree.Sequence(
			BTree.Callback((slot) => {
				if (slot === 1) tree.RemoveAgent(1);
			}),
			BTree.Leaf({
				OnTick: () => RUNNING,
				OnHalt: () => {
					halted++;
				},
			}),
		),
	);
	tree.AddAgent();
	tree.AddAgent();
	tree.Tick(0);
	expect(tree.GetAgentCount()).toBe(1);
	expect(tree.HasAgent(1)).toBeFalsy();
	expect(halted).toBe(1);
});

test("Tick throws when called during Tick or TickAgent", () => {
	let tree: BTree.BehaviorTree;
	let visits = 0;
	let inside = false; // one nested call per visit, so a Tick that does re-enter cannot recurse forever
	const nested: string[] = [];
	tree = new BTree.BehaviorTree(
		BTree.Action(() => {
			visits++;
			if (!inside) {
				inside = true;
				const [ok, err] = pcall(() => tree.Tick(0));
				inside = false;
				nested.push(ok ? "ok" : message(err));
			}
			return RUNNING;
		}),
	);
	const a = tree.AddAgent();
	tree.Tick(0);
	expect(visits).toBe(1); // not re-entered
	expect(tree.TickCount).toBe(1);
	expect(nested[0]).toBe("BTree: Tick cannot be called during Tick");
	expect(tree.TickAgent(a, 0)).toBe(RUNNING);
	expect(visits).toBe(2);
	expect(nested[1]).toBe("BTree: Tick cannot be called during Tick");
	tree.Halt(a); // the tree is not left ticking
	expect(tree.GetStatus(a)).toBe(undefined);
});

test("TickAgent throws for an agent whose halt is in flight", () => {
	const log: string[] = [];
	const nested: string[] = [];
	const tree = new BTree.BehaviorTree(
		BTree.Parallel(
			BTree.EParallelPolicy.ALL,
			BTree.EParallelPolicy.ALL,
			BTree.Leaf({
				OnTick: () => RUNNING,
				OnHalt: (slot, t) => {
					const [ok, err] = pcall(() => t.TickAgent(slot, 0));
					nested.push(ok ? "ok" : message(err));
				},
			}),
			BTree.Sequence(
				BTree.Leaf({
					OnStart: () => log.push("start"),
					OnTick: () => RUNNING,
					OnHalt: () => log.push("halt"),
				}),
			),
		),
	);
	const a = tree.AddAgent();
	tree.TickAgent(a, 0);
	tree.Halt(a);
	expect(nested[0]).toBe(`BTree: agent ${a} is being halted`);
	expect(tree.GetStatus(a)).toBe(undefined); // not restarted from inside its own halt
	tree.Halt(a); // nothing left running, so no node is halted while idle
	expect(tree.TickAgent(a, 0)).toBe(RUNNING);
	expect(log.join(",")).toBe("start,halt,start");
});

test("TickAgent throws for an agent whose end-of-frame sweep is in flight", () => {
	const log: string[] = [];
	const nested: string[] = [];
	let gate = true;
	const tree = new BTree.BehaviorTree(
		BTree.ReactiveSequence(
			BTree.ForceSuccess(
				BTree.ReactiveSequence(
					BTree.Condition(() => gate),
					BTree.FireAndForget(
						BTree.Leaf({
							OnTick: () => RUNNING,
							OnHalt: (slot, t) => {
								const [ok, err] = pcall(() => t.TickAgent(slot, 0));
								nested.push(ok ? "ok" : message(err));
							},
						}),
					),
				),
			),
			BTree.FireAndForget(
				BTree.Leaf({
					OnStart: () => log.push("start"),
					OnTick: () => RUNNING,
					OnHalt: () => log.push("halt"),
				}),
			),
			BTree.Plug(RUNNING),
		),
	);
	const a = tree.AddAgent();
	tree.TickAgent(a, 0);
	gate = false; // the first FireAndForget is not visited: its child is halted at the end of the frame
	tree.TickAgent(a, 0);
	tree.TickAgent(a, 0);
	expect(nested.size()).toBe(1);
	expect(nested[0]).toBe(`BTree: agent ${a} is being halted`);
	expect(log.join(",")).toBe("start"); // the second one is visited every frame: never halted
});

test("External-id trees use the given id and reject duplicates", () => {
	const tree = new BTree.BehaviorTree(BTree.Plug(SUCCESS), { external_ids: true });
	expect(tree.AddAgent(5000)).toBe(5000);
	expect(() => tree.AddAgent(5000)).toThrow();
	expect(() => tree.AddAgent()).toThrow();
	const plain = new BTree.BehaviorTree(BTree.Plug(SUCCESS));
	expect(() => plain.AddAgent(3)).toThrow();
});

test("nested Sequence + Fallback works correctly", () => {
	const root = BTree.Sequence(
		BTree.Plug(SUCCESS),
		BTree.Fallback(BTree.Plug(FAILURE), BTree.Plug(SUCCESS)),
	);
	expect(makeTree(root).tick(0)).toBe(SUCCESS);
});

runTests();

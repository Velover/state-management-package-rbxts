// The examples from docs/custom-nodes.md, verified: each node here is copied into the guide verbatim.
import { testInit, test, expect, runTests } from "@rbxts/tester";
import { BTree } from "BehaviorTree";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const FAILURE = BTree.ENodeStatus.FAILURE;
const RUNNING = BTree.ENodeStatus.RUNNING;

testInit(() => {
	print("CustomNodes tests initialized");
});

function makeTree(root: BTree.Node) {
	const tree = new BTree.BehaviorTree(root);
	const slot = tree.AddAgent();
	const tick = (dt: number) => {
		tree.Tick(dt);
		return tree.GetStatus(slot)!;
	};
	return { tree, slot, tick };
}

/** A leaf that records its lifecycle, used to check the halting rule under the custom nodes. */
function probe(log: string[], name: string, status: () => BTree.ENodeStatus): BTree.Node {
	return BTree.Leaf({
		Name: name,
		OnStart: () => log.push(`${name}:start`),
		OnTick: () => status(),
		OnHalt: () => log.push(`${name}:halt`),
	});
}

// ── Example 1: a pass-through decorator with no state of its own ──────────────────────────────

function Trace(label: string, child: BTree.Node, out: string[]): BTree.Node {
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "Trace",
		Tick: (slot, dt, tree) => {
			const s = tick(slot, dt, tree);
			if (s !== RUNNING) out.push(`${label}:${s === SUCCESS ? "success" : "failure"}`);
			return s;
		},
		// We are running exactly when the child is running, so a halt is always the child's halt.
		Halt: halt,
		Maps: child.Maps,
	};
}

test("Trace passes status through and its halt is the child's halt", () => {
	const out: string[] = [];
	const log: string[] = [];
	let status = RUNNING;
	const gate = { open: true };
	const { tree, slot, tick } = makeTree(
		BTree.ReactiveSequence(
			BTree.Condition(() => gate.open),
			Trace("work", probe(log, "leaf", () => status), out),
		),
	);
	expect(tick(0)).toBe(RUNNING);
	status = SUCCESS;
	expect(tick(0)).toBe(SUCCESS);
	expect(out.join(",")).toBe("work:success");
	status = RUNNING;
	tick(0);
	gate.open = false;
	expect(tick(0)).toBe(FAILURE); // the ReactiveSequence halts through Trace into the leaf
	expect(log.join(",")).toBe("leaf:start,leaf:start,leaf:halt");
	tree.RemoveAgent(slot);
	expect(tree.GetAgentCount()).toBe(0);
});

// ── Example 2: a decorator with per-agent state ───────────────────────────────────────────────

function Gate(pred: (slot: BTree.Slot, tree: BTree.BehaviorTree) => boolean, child: BTree.Node): BTree.Node {
	const child_running = new Map<BTree.Slot, true>();
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "Gate",
		Tick: (slot, dt, tree) => {
			if (!pred(slot, tree)) {
				// Closing the gate on a running child: we stop ticking it, so we must halt it (halting rule).
				if (child_running.has(slot)) {
					child_running.delete(slot);
					halt(slot, tree);
				}
				return FAILURE;
			}
			const s = tick(slot, dt, tree);
			if (s === RUNNING) child_running.set(slot, true);
			else child_running.delete(slot);
			return s;
		},
		Halt: (slot, tree) => {
			// Only called while we are RUNNING, which means the child is running: clear, then halt it.
			child_running.delete(slot);
			halt(slot, tree);
		},
		Maps: [child_running, ...child.Maps],
	};
}

test("Gate blocks the child, halts it when it closes mid-run, and halts it on tree.Halt", () => {
	const log: string[] = [];
	const open = new Map<BTree.Slot, boolean>();
	let status = RUNNING;
	const { tree, slot, tick } = makeTree(Gate((s) => open.get(s) === true, probe(log, "leaf", () => status)));
	expect(tick(0)).toBe(FAILURE);
	expect(log.size()).toBe(0);
	open.set(slot, true);
	expect(tick(0)).toBe(RUNNING);
	open.set(slot, false);
	expect(tick(0)).toBe(FAILURE);
	expect(log.join(",")).toBe("leaf:start,leaf:halt");
	open.set(slot, true);
	tick(0);
	tree.Halt(slot);
	expect(log.join(",")).toBe("leaf:start,leaf:halt,leaf:start,leaf:halt");
	tick(0);
	tree.RemoveAgent(slot);
	expect(log.join(",")).toBe("leaf:start,leaf:halt,leaf:start,leaf:halt,leaf:start,leaf:halt");
});

// ── Example 3: a composite with a cursor ──────────────────────────────────────────────────────

function RoundRobin(...children: BTree.Node[]): BTree.Node {
	const n = children.size();
	const ticks = new Array<BTree.TickFn>(n);
	const halts = new Array<BTree.HaltFn>(n);
	const start_at = new Map<BTree.Slot, number>(); // child the next run starts with; lives across runs
	const cursor = new Map<BTree.Slot, number>(); // child running now; absent when idle
	const maps: BTree.StateMap[] = [start_at, cursor];
	for (let i = 0; i < n; i++) {
		ticks[i] = children[i].Tick;
		halts[i] = children[i].Halt;
		for (const m of children[i].Maps) maps.push(m);
	}
	return {
		Name: "RoundRobin",
		Tick: (slot, dt, tree) => {
			let i = cursor.get(slot);
			if (i === undefined) {
				i = start_at.get(slot) ?? 0;
				start_at.set(slot, (i + 1) % n);
			}
			const s = ticks[i](slot, dt, tree);
			if (s === RUNNING) cursor.set(slot, i);
			else cursor.delete(slot);
			return s;
		},
		Halt: (slot, tree) => {
			const i = cursor.get(slot)!;
			cursor.delete(slot);
			halts[i](slot, tree);
		},
		Maps: maps,
	};
}

test("RoundRobin advances per run, resumes a running child, and clears state on removal", () => {
	const log: string[] = [];
	let b_status = RUNNING;
	const root = RoundRobin(
		probe(log, "a", () => SUCCESS),
		probe(log, "b", () => b_status),
		probe(log, "c", () => FAILURE),
	);
	const { tree, slot, tick } = makeTree(root);
	expect(tick(0)).toBe(SUCCESS); // a
	expect(tick(0)).toBe(RUNNING); // b starts
	expect(tick(0)).toBe(RUNNING); // b resumed, not c
	b_status = SUCCESS;
	expect(tick(0)).toBe(SUCCESS); // b completes
	expect(tick(0)).toBe(FAILURE); // c
	expect(tick(0)).toBe(SUCCESS); // a again
	expect(log.join(",")).toBe("a:start,b:start,c:start,a:start");
	b_status = RUNNING;
	tick(0); // b running
	tree.Halt(slot);
	expect(log[log.size() - 1]).toBe("b:halt");
	tick(0); // c (next after b), fails
	tree.RemoveAgent(slot);
	for (const m of root.Maps) expect(m.size()).toBe(0);
});

// ── Example 4: "was I visited last tick" with the tick stamp ──────────────────────────────────

function Streak(n: number): BTree.Node {
	const count = new Map<BTree.Slot, number>();
	const last_seen = new Map<BTree.Slot, number>();
	return {
		Name: "Streak",
		Tick: (slot, _dt, tree) => {
			const now = tree.TickCount;
			const c = (last_seen.get(slot) === now - 1 ? (count.get(slot) ?? 0) : 0) + 1;
			last_seen.set(slot, now);
			count.set(slot, c);
			return c >= n ? SUCCESS : FAILURE;
		},
		Halt: () => {}, // never RUNNING, so never halted
		Maps: [count, last_seen],
	};
}

test("Streak counts consecutive visited ticks and resets on a gap", () => {
	const gate = { open: true };
	const { tick } = makeTree(BTree.Sequence(BTree.Condition(() => gate.open), Streak(3)));
	expect(tick(0)).toBe(FAILURE);
	expect(tick(0)).toBe(FAILURE);
	expect(tick(0)).toBe(SUCCESS);
	expect(tick(0)).toBe(SUCCESS);
	gate.open = false;
	expect(tick(0)).toBe(FAILURE); // not visited
	gate.open = true;
	expect(tick(0)).toBe(FAILURE); // streak restarted
	expect(tick(0)).toBe(FAILURE);
	expect(tick(0)).toBe(SUCCESS);
});

// ── Example 5: a hook after halting a child (HaltChild) ───────────────────────────────────────

function OnInterrupt(callback: (slot: BTree.Slot, tree: BTree.BehaviorTree) => void, child: BTree.Node): BTree.Node {
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "OnInterrupt",
		Tick: tick, // nothing to add on the tick path: our Tick is the child's
		Halt: (slot, tree) => {
			// Guarded, so a throwing hook inside the child cannot skip the callback.
			tree.HaltChild(halt, slot);
			callback(slot, tree);
		},
		Maps: child.Maps,
	};
}

test("OnInterrupt fires only when the child is interrupted, and even if the child's OnHalt throws", () => {
	const log: string[] = [];
	const gate = { open: true, throws: false };
	let status = RUNNING;
	const leaf = BTree.Leaf({
		OnTick: () => status,
		OnHalt: () => {
			log.push("halt");
			if (gate.throws) throw "boom";
		},
	});
	const { tree, slot, tick } = makeTree(
		BTree.ReactiveSequence(
			BTree.Condition(() => gate.open),
			OnInterrupt(() => log.push("interrupted"), leaf),
		),
	);
	tick(0);
	status = SUCCESS;
	tick(0); // completes: no callback
	expect(log.size()).toBe(0);
	status = RUNNING;
	tick(0);
	gate.open = false;
	tick(0);
	expect(log.join(",")).toBe("halt,interrupted");
	gate.open = true;
	tick(0);
	gate.throws = true;
	const [ok, err] = pcall(() => tree.Halt(slot));
	expect(ok).toBe(false);
	expect(tostring(err).find("boom")[0] !== undefined).toBe(true);
	expect(log.join(",")).toBe("halt,interrupted,halt,interrupted");
	expect(tree.GetStatus(slot)).toBe(undefined);
});

runTests();

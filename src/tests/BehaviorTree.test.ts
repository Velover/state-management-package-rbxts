import { testInit, beforeEach, test, expect, runTests } from "@rbxts/tester";
import { BTree } from "BehaviorTree";
import { Blackboard } from "Blackboard";

testInit(() => {
	print("BehaviorTree tests initialized");
});

let bb: Blackboard;

beforeEach(() => {
	bb = new Blackboard({});
});

// Helper: create a BehaviorTree wrapper for convenient ticking
function makeTree(root: BTree.Node): BTree.BehaviorTree {
	return new BTree.BehaviorTree(root, bb);
}

// ── Plug (stub node) ─────────────────────────────────────────────────

test("Plug always returns SUCCESS", () => {
	const tree = makeTree(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Plug always returns FAILURE", () => {
	const tree = makeTree(new BTree.Plug(BTree.ENodeStatus.FAILURE));
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

test("Plug always returns RUNNING", () => {
	const tree = makeTree(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── Action ───────────────────────────────────────────────────────────

test("Action executes callback and returns its status", () => {
	const action = new BTree.Action(() => BTree.ENodeStatus.SUCCESS);
	const tree = makeTree(action);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Action passes blackboard to callback", () => {
	bb.SetWild("visited", false);
	const action = new BTree.Action((blackboard) => {
		blackboard.SetWild("visited", true);
		return BTree.ENodeStatus.SUCCESS;
	});
	makeTree(action).Tick(0);
	expect(bb.GetWild<boolean>("visited")).toBeTruthy();
});

test("Action passes dt to callback", () => {
	let received_dt = 0;
	const action = new BTree.Action((_bb, dt) => {
		received_dt = dt;
		return BTree.ENodeStatus.SUCCESS;
	});
	makeTree(action).Tick(0.5);
	expect(received_dt).toBe(0.5);
});

// ── Condition ────────────────────────────────────────────────────────

test("Condition returns SUCCESS when true", () => {
	const cond = new BTree.Condition(() => true);
	const tree = makeTree(cond);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Condition returns FAILURE when false", () => {
	const cond = new BTree.Condition(() => false);
	const tree = makeTree(cond);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

// ── Callback ─────────────────────────────────────────────────────────

test("Callback node executes and returns SUCCESS", () => {
	let called = false;
	const cb = new BTree.Callback(() => {
		called = true;
	});
	const tree = makeTree(cb);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(called).toBeTruthy();
});

// ── Sequence ─────────────────────────────────────────────────────────

test("Sequence returns SUCCESS when all children succeed", () => {
	const seq = new BTree.Sequence()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(seq).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Sequence returns FAILURE on first failing child", () => {
	let third_called = false;
	const seq = new BTree.Sequence()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE))
		.AddChild(
			new BTree.Action(() => {
				third_called = true;
				return BTree.ENodeStatus.SUCCESS;
			}),
		);
	expect(makeTree(seq).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
	expect(third_called).toBeFalsy();
});

test("Sequence returns RUNNING and resumes from correct index", () => {
	let call_count_a = 0;
	let call_count_b = 0;
	const seq = new BTree.Sequence()
		.AddChild(
			new BTree.Action(() => {
				call_count_a++;
				return call_count_a === 1 ? BTree.ENodeStatus.RUNNING : BTree.ENodeStatus.SUCCESS;
			}),
		)
		.AddChild(
			new BTree.Action(() => {
				call_count_b++;
				return BTree.ENodeStatus.SUCCESS;
			}),
		);

	const tree = makeTree(seq);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(call_count_a).toBe(2);
	expect(call_count_b).toBe(1);
});

// ── Fallback (Selector) ─────────────────────────────────────────────

test("Fallback returns SUCCESS on first succeeding child", () => {
	let third_called = false;
	const fb = new BTree.Fallback()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(
			new BTree.Action(() => {
				third_called = true;
				return BTree.ENodeStatus.SUCCESS;
			}),
		);
	expect(makeTree(fb).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(third_called).toBeFalsy();
});

test("Fallback returns FAILURE when all children fail", () => {
	const fb = new BTree.Fallback()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE));
	expect(makeTree(fb).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

test("Fallback returns RUNNING and resumes", () => {
	let count_a = 0;
	const fb = new BTree.Fallback()
		.AddChild(
			new BTree.Action(() => {
				count_a++;
				return count_a === 1 ? BTree.ENodeStatus.RUNNING : BTree.ENodeStatus.SUCCESS;
			}),
		)
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS));

	const tree = makeTree(fb);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── ReactiveSequence ─────────────────────────────────────────────────

test("ReactiveSequence restarts from first child each tick", () => {
	let count_first = 0;
	const rs = new BTree.ReactiveSequence()
		.AddChild(
			new BTree.Action(() => {
				count_first++;
				return BTree.ENodeStatus.SUCCESS;
			}),
		)
		.AddChild(new BTree.Plug(BTree.ENodeStatus.RUNNING));

	const tree = makeTree(rs);
	tree.Tick(0); // runs child 0 (SUCCESS) then child 1 (RUNNING)
	tree.Tick(0); // should restart from child 0
	expect(count_first).toBe(2);
});

// ── Inverter ─────────────────────────────────────────────────────────

test("Inverter inverts SUCCESS to FAILURE", () => {
	const inv = new BTree.Inverter(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(inv).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

test("Inverter inverts FAILURE to SUCCESS", () => {
	const inv = new BTree.Inverter(new BTree.Plug(BTree.ENodeStatus.FAILURE));
	expect(makeTree(inv).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Inverter passes RUNNING through", () => {
	const inv = new BTree.Inverter(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(makeTree(inv).Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── ForceSuccess ─────────────────────────────────────────────────────

test("ForceSuccess converts FAILURE to SUCCESS", () => {
	const fs = new BTree.ForceSuccess(new BTree.Plug(BTree.ENodeStatus.FAILURE));
	expect(makeTree(fs).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("ForceSuccess keeps SUCCESS as SUCCESS", () => {
	const fs = new BTree.ForceSuccess(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(fs).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("ForceSuccess passes RUNNING through", () => {
	const fs = new BTree.ForceSuccess(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(makeTree(fs).Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── ForceFailure ─────────────────────────────────────────────────────

test("ForceFailure converts SUCCESS to FAILURE", () => {
	const ff = new BTree.ForceFailure(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(ff).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

test("ForceFailure passes RUNNING through", () => {
	const ff = new BTree.ForceFailure(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(makeTree(ff).Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── ForceRunning ─────────────────────────────────────────────────────

test("ForceRunning always returns RUNNING", () => {
	const fr = new BTree.ForceRunning(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(fr).Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── FireAndForget ────────────────────────────────────────────────────

test("FireAndForget returns SUCCESS regardless of child", () => {
	const faf = new BTree.FireAndForget(new BTree.Plug(BTree.ENodeStatus.FAILURE));
	expect(makeTree(faf).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── RunningGate ──────────────────────────────────────────────────────

test("RunningGate returns FAILURE when child is RUNNING", () => {
	const rg = new BTree.RunningGate(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(makeTree(rg).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

test("RunningGate passes SUCCESS through", () => {
	const rg = new BTree.RunningGate(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(rg).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── Wait ─────────────────────────────────────────────────────────────

test("Wait returns RUNNING until duration elapses", () => {
	const wait = new BTree.Wait(1.0);
	const tree = makeTree(wait);
	expect(tree.Tick(0.3)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0.3)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0.5)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── WaitGate ─────────────────────────────────────────────────────────

test("WaitGate returns FAILURE until duration elapses then SUCCESS", () => {
	const wg = new BTree.WaitGate(1.0);
	const tree = makeTree(wg);
	expect(tree.Tick(0.4)).toBe(BTree.ENodeStatus.FAILURE);
	expect(tree.Tick(0.4)).toBe(BTree.ENodeStatus.FAILURE);
	expect(tree.Tick(0.4)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── IfThenElse ───────────────────────────────────────────────────────

test("IfThenElse executes THEN branch on condition SUCCESS", () => {
	const ite = new BTree.IfThenElse()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS)) // condition
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS)) // then
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE)); // else
	expect(makeTree(ite).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("IfThenElse executes ELSE branch on condition FAILURE", () => {
	let then_called = false;
	const ite = new BTree.IfThenElse()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE)) // condition
		.AddChild(
			new BTree.Action(() => {
				then_called = true;
				return BTree.ENodeStatus.SUCCESS;
			}),
		) // then
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS)); // else
	expect(makeTree(ite).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(then_called).toBeFalsy();
});

test("IfThenElse with 2 children returns FAILURE when condition fails and no else", () => {
	const ite = new BTree.IfThenElse()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(ite).Tick(0)).toBe(BTree.ENodeStatus.FAILURE);
});

// ── Parallel ─────────────────────────────────────────────────────────

test("Parallel with ALL/ALL succeeds when all children succeed", () => {
	const par = new BTree.Parallel(BTree.EParallelPolicy.ALL, BTree.EParallelPolicy.ALL)
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS));
	expect(makeTree(par).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Parallel with ONE success policy succeeds when first child succeeds", () => {
	const par = new BTree.Parallel(BTree.EParallelPolicy.ONE, BTree.EParallelPolicy.ONE)
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	expect(makeTree(par).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

test("Parallel returns RUNNING while children are running", () => {
	let count = 0;
	const par = new BTree.Parallel(BTree.EParallelPolicy.ALL, BTree.EParallelPolicy.ALL)
		.AddChild(
			new BTree.Action(() => {
				count++;
				return count <= 1 ? BTree.ENodeStatus.RUNNING : BTree.ENodeStatus.SUCCESS;
			}),
		)
		.AddChild(new BTree.Plug(BTree.ENodeStatus.RUNNING));
	const tree = makeTree(par);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
});

// ── Repeat ───────────────────────────────────────────────────────────

test("Repeat executes child N times then returns SUCCESS", () => {
	let count = 0;
	const repeatNode = new BTree.Repeat(
		new BTree.Action(() => {
			count++;
			return BTree.ENodeStatus.SUCCESS;
		}),
		3,
	);
	const tree = makeTree(repeatNode);
	// First tick: child returns SUCCESS, count=1, not done yet → RUNNING
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(count).toBe(3);
});

// ── OneShot ──────────────────────────────────────────────────────────

test("OneShot executes child once and caches result", () => {
	let count = 0;
	const os = new BTree.OneShot(
		new BTree.Action(() => {
			count++;
			return BTree.ENodeStatus.SUCCESS;
		}),
	);
	const tree = makeTree(os);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS); // cached
	expect(count).toBe(1);
});

// ── KeepRunningUntilSuccess ──────────────────────────────────────────

test("KeepRunningUntilSuccess retries until child succeeds", () => {
	let count = 0;
	const krus = new BTree.KeepRunningUntilSuccess(
		new BTree.Action(() => {
			count++;
			return count < 3 ? BTree.ENodeStatus.FAILURE : BTree.ENodeStatus.SUCCESS;
		}),
	);
	const tree = makeTree(krus);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING); // fail 1
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING); // fail 2
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS); // success 3
});

test("KeepRunningUntilSuccess fails after max attempts", () => {
	const krus = new BTree.KeepRunningUntilSuccess(new BTree.Plug(BTree.ENodeStatus.FAILURE), 2);
	const tree = makeTree(krus);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING); // attempt 1
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.FAILURE); // max reached
});

// ── KeepRunningUntilFailure ──────────────────────────────────────────

test("KeepRunningUntilFailure retries until child fails", () => {
	let count = 0;
	const kruf = new BTree.KeepRunningUntilFailure(
		new BTree.Action(() => {
			count++;
			return count < 3 ? BTree.ENodeStatus.SUCCESS : BTree.ENodeStatus.FAILURE;
		}),
	);
	const tree = makeTree(kruf);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING); // success 1
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.RUNNING); // success 2
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.FAILURE); // fail 3
});

// ── BehaviorTree Halt ────────────────────────────────────────────────

test("BehaviorTree.Halt halts running nodes", () => {
	let halted = false;
	const action = new BTree.Action(() => BTree.ENodeStatus.RUNNING);
	const tree = makeTree(action);
	tree.Tick(0);
	expect(action.IsRunning()).toBeTruthy();
	tree.Halt();
	expect(action.IsRunning()).toBeFalsy();
});

// ── Complex tree: Sequence with nested Fallback ──────────────────────

test("nested Sequence + Fallback works correctly", () => {
	const tree_struct = new BTree.Sequence()
		.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS))
		.AddChild(
			new BTree.Fallback()
				.AddChild(new BTree.Plug(BTree.ENodeStatus.FAILURE))
				.AddChild(new BTree.Plug(BTree.ENodeStatus.SUCCESS)),
		);
	expect(makeTree(tree_struct).Tick(0)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── Timeout ──────────────────────────────────────────────────────────

test("Timeout returns FAILURE after time expires", () => {
	const timeout = new BTree.Timeout(new BTree.Plug(BTree.ENodeStatus.RUNNING), 1.0);
	const tree = makeTree(timeout);
	expect(tree.Tick(0.5)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0.6)).toBe(BTree.ENodeStatus.FAILURE);
});

test("Timeout returns SUCCESS when configured", () => {
	const timeout = new BTree.Timeout(
		new BTree.Plug(BTree.ENodeStatus.RUNNING),
		1.0,
		BTree.ETimeoutBehavior.SUCCESS,
	);
	const tree = makeTree(timeout);
	expect(tree.Tick(0.5)).toBe(BTree.ENodeStatus.RUNNING);
	expect(tree.Tick(0.6)).toBe(BTree.ENodeStatus.SUCCESS);
});

// ── Cooldown ─────────────────────────────────────────────────────────

test("Cooldown blocks execution during cooldown period", () => {
	let count = 0;
	const cooldown = new BTree.Cooldown(
		new BTree.Action(() => {
			count++;
			return BTree.ENodeStatus.SUCCESS;
		}),
		1.0,
	);
	const tree = makeTree(cooldown);
	expect(tree.Tick(0)).toBe(BTree.ENodeStatus.SUCCESS); // executes, cooldown starts
	expect(count).toBe(1);
	expect(tree.Tick(0.5)).toBe(BTree.ENodeStatus.FAILURE); // cooldown active
	expect(count).toBe(1);
	expect(tree.Tick(0.6)).toBe(BTree.ENodeStatus.SUCCESS); // cooldown expired
	expect(count).toBe(2);
});

runTests();

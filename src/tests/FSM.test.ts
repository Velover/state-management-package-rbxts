import { testInit, beforeEach, test, expect, runTests } from "@rbxts/tester";
import { FSM } from "FSM";
import { Blackboard } from "Blackboard";

testInit(() => {
	print("FSM tests initialized");
});

// Helper: create a simple mock state
function mockState(): FSM.IFSMState & { entered: boolean; exited: boolean; updated: boolean } {
	return {
		entered: false,
		exited: false,
		updated: false,
		OnEnter() {
			this.entered = true;
		},
		OnExit() {
			this.exited = true;
		},
		Update() {
			this.updated = true;
		},
	};
}

// ── Basic lifecycle ──────────────────────────────────────────────────

test("FSM starts in default state", () => {
	const fsm = new FSM.FSM("idle");
	const state = mockState();
	fsm.RegisterState("idle", state);
	fsm.Start();
	expect(fsm.GetCurrentState()).toBe("idle");
	expect(state.entered).toBeTruthy();
});

test("FSM Stop calls OnExit on current state", () => {
	const fsm = new FSM.FSM("idle");
	const state = mockState();
	fsm.RegisterState("idle", state);
	fsm.Start();
	fsm.Stop();
	expect(state.exited).toBeTruthy();
});

test("FSM Update calls Update on current state", () => {
	const fsm = new FSM.FSM("idle");
	const state = mockState();
	fsm.RegisterState("idle", state);
	fsm.Start();
	fsm.Update(0.1);
	expect(state.updated).toBeTruthy();
});

// ── Transitions ──────────────────────────────────────────────────────

test("FSM transitions when condition is met", () => {
	const bb = new Blackboard({ shouldMove: false });
	const fsm = new FSM.FSM("idle", bb);
	const idleState = mockState();
	const moveState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("move", moveState);
	fsm.AddTransition("idle", "move", 0, (b) => b.GetWild<boolean>("shouldMove")!);

	fsm.Start();
	expect(fsm.GetCurrentState()).toBe("idle");

	// Condition not met
	fsm.Update(0.1);
	expect(fsm.GetCurrentState()).toBe("idle");

	// Trigger transition
	bb.Set("shouldMove", true);
	fsm.Update(0.1);
	expect(fsm.GetCurrentState()).toBe("move");
	expect(idleState.exited).toBeTruthy();
	expect(moveState.entered).toBeTruthy();
});

test("FSM does not allow transition to self via AddTransition", () => {
	const fsm = new FSM.FSM("idle");
	fsm.RegisterState("idle", mockState());
	expect(() => fsm.AddTransition("idle", "idle", 0)).toThrow();
});

// ── Any transitions ──────────────────────────────────────────────────

test("FSM any-transition fires from any state", () => {
	const bb = new Blackboard({ emergency: false });
	const fsm = new FSM.FSM("idle", bb);
	const idleState = mockState();
	const alertState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("alert", alertState);
	fsm.AddAnyTransition("alert", 0, (b) => b.GetWild<boolean>("emergency")!);

	fsm.Start();
	expect(fsm.GetCurrentState()).toBe("idle");

	bb.Set("emergency", true);
	fsm.Update(0.1);
	expect(fsm.GetCurrentState()).toBe("alert");
});

// ── Event transitions ────────────────────────────────────────────────

test("FSM HandleEvent triggers event transition", () => {
	const fsm = new FSM.FSM("idle");
	const idleState = mockState();
	const attackState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("attack", attackState);
	fsm.AddEventTransition("idle", "attack", "see_enemy", 0);

	fsm.Start();
	fsm.HandleEvent("see_enemy");
	expect(fsm.GetCurrentState()).toBe("attack");
});

test("FSM HandleEvent with condition not met does not transition", () => {
	const bb = new Blackboard({ hasAmmo: false });
	const fsm = new FSM.FSM("idle", bb);
	const idleState = mockState();
	const attackState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("attack", attackState);
	fsm.AddEventTransition("idle", "attack", "see_enemy", 0, (b) => b.GetWild<boolean>("hasAmmo")!);

	fsm.Start();
	fsm.HandleEvent("see_enemy");
	expect(fsm.GetCurrentState()).toBe("idle");
});

test("FSM any-event transition fires from any state", () => {
	const fsm = new FSM.FSM("idle");
	const idleState = mockState();
	const deadState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("dead", deadState);
	fsm.AddAnyEventTransition("dead", "die", 0);

	fsm.Start();
	fsm.HandleEvent("die");
	expect(fsm.GetCurrentState()).toBe("dead");
});

test("FSM HandleEvent ignores unknown event", () => {
	const fsm = new FSM.FSM("idle");
	const state = mockState();
	fsm.RegisterState("idle", state);
	fsm.Start();
	fsm.HandleEvent("unknown");
	expect(fsm.GetCurrentState()).toBe("idle");
});

// ── ForceSetState ────────────────────────────────────────────────────

test("FSM ForceSetState changes state immediately", () => {
	const fsm = new FSM.FSM("idle");
	const idleState = mockState();
	const patrolState = mockState();
	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("patrol", patrolState);
	fsm.Start();
	fsm.ForceSetState("patrol");
	expect(fsm.GetCurrentState()).toBe("patrol");
	expect(idleState.exited).toBeTruthy();
	expect(patrolState.entered).toBeTruthy();
});

test("FSM ForceSetState with skip_if_same does nothing", () => {
	const fsm = new FSM.FSM("idle");
	const state = mockState();
	fsm.RegisterState("idle", state);
	fsm.Start();
	state.exited = false; // reset
	fsm.ForceSetState("idle", true);
	expect(fsm.GetCurrentState()).toBe("idle");
	expect(state.exited).toBeFalsy();
});

// ── Bindings ─────────────────────────────────────────────────────────

test("FSM BindOnEnter is called on start", () => {
	let called = false;
	const fsm = new FSM.FSM("idle");
	fsm.RegisterState("idle", mockState());
	fsm.BindOnEnter(() => {
		called = true;
	});
	fsm.Start();
	expect(called).toBeTruthy();
});

test("FSM BindOnExit is called on stop", () => {
	let called = false;
	const fsm = new FSM.FSM("idle");
	fsm.RegisterState("idle", mockState());
	fsm.BindOnExit(() => {
		called = true;
	});
	fsm.Start();
	fsm.Stop();
	expect(called).toBeTruthy();
});

test("FSM BindUpdate is called during Update", () => {
	let called = false;
	const fsm = new FSM.FSM("idle");
	fsm.RegisterState("idle", mockState());
	fsm.BindUpdate(() => {
		called = true;
	});
	fsm.Start();
	fsm.Update(0.1);
	expect(called).toBeTruthy();
});

// ── Multi-state sequence ─────────────────────────────────────────────

test("FSM walks through idle → patrol → idle sequence", () => {
	let tick = 0;
	const bb = new Blackboard({ tick: 0 });
	const fsm = new FSM.FSM("idle", bb);

	const idleState: FSM.IFSMState = {
		OnEnter() {},
		OnExit() {},
		Update(_dt, b) {
			tick++;
			b.SetWild("tick", tick);
		},
	};

	const patrolState: FSM.IFSMState = {
		OnEnter() {},
		OnExit() {},
		Update(_dt, b) {
			tick++;
			b.SetWild("tick", tick);
		},
	};

	fsm.RegisterState("idle", idleState);
	fsm.RegisterState("patrol", patrolState);
	fsm.AddTransition("idle", "patrol", 0, (b) => (b.GetWild<number>("tick") ?? 0) >= 2);

	fsm.Start();
	fsm.Update(0); // tick=1, condition not checked yet (tick updates after transition check)
	expect(fsm.GetCurrentState()).toBe("idle");
	fsm.Update(0); // tick=2, still checked at 1
	expect(fsm.GetCurrentState()).toBe("idle");
	fsm.Update(0); // now check sees tick=2, transitions to patrol
	expect(fsm.GetCurrentState()).toBe("patrol");
});

runTests();

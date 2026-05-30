import { testInit, beforeEach, test, expect, runTests } from "@rbxts/tester";
import { Goap } from "Goap";

testInit(() => {
	print("GOAP tests initialized");
});

// ── Helpers ──────────────────────────────────────────────────────────

/** Concrete action for testing */
class TestAction extends Goap.Action {
	constructor(
		private requirements_: Map<string, Goap.Requirement>,
		private effects_: Map<string, Goap.Effect>,
		private cost_: number = 1,
		private tick_result_: Goap.EActionStatus = Goap.EActionStatus.SUCCESS,
	) {
		super();
	}

	GetStaticRequirements(): Map<string, Goap.Requirement> {
		return this.requirements_;
	}
	GetStaticEffects(): Map<string, Goap.Effect> {
		return this.effects_;
	}
	GetCost(): number {
		return this.cost_;
	}

	protected OnTick(): Goap.EActionStatus {
		return this.tick_result_;
	}
}

// ── WorldState ───────────────────────────────────────────────────────

test("WorldState SetWild / GetWild round-trip", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("hp", 100);
	expect(ws.GetWild<number>("hp")).toBe(100);
});

test("WorldState SatisfiesRequirements returns true when met", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("hasKey", true);
	const reqs = new Map<string, Goap.Requirement>();
	reqs.set("hasKey", Goap.Comparison.Eq(true));
	expect(ws.SatisfiesRequirements(reqs)).toBeTruthy();
});

test("WorldState SatisfiesRequirements returns false when not met", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("hp", 10);
	const reqs = new Map<string, Goap.Requirement>();
	reqs.set("hp", Goap.Comparison.GreaterThan(50));
	expect(ws.SatisfiesRequirements(reqs)).toBeFalsy();
});

test("WorldState ApplyEffects modifies values", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("gold", 10);
	const effects = new Map<string, Goap.Effect>();
	effects.set("gold", Goap.Effect.Increment(5));
	ws.ApplyEffects(effects);
	expect(ws.GetWild<number>("gold")).toBe(15);
});

test("WorldState Clone creates independent copy", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("x", 1);
	const clone = ws.Clone();
	clone.SetWild("x", 999);
	expect(ws.GetWild<number>("x")).toBe(1);
	expect(clone.GetWild<number>("x")).toBe(999);
});

test("WorldState Equals returns true for identical states", () => {
	const a = new Goap.WorldState({} as Record<string, unknown>);
	a.SetWild("hp", 100);
	a.SetWild("mp", 50);
	const b = new Goap.WorldState({} as Record<string, unknown>);
	b.SetWild("hp", 100);
	b.SetWild("mp", 50);
	expect(a.Equals(b)).toBeTruthy();
});

test("WorldState Equals returns false for different states", () => {
	const a = new Goap.WorldState({} as Record<string, unknown>);
	a.SetWild("hp", 100);
	const b = new Goap.WorldState({} as Record<string, unknown>);
	b.SetWild("hp", 50);
	expect(a.Equals(b)).toBeFalsy();
});

test("WorldState Size returns number of entries", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("a", 1);
	ws.SetWild("b", 2);
	expect(ws.Size()).toBe(2);
});

// ── Goal ─────────────────────────────────────────────────────────────

test("Goal IsSatisfied when requirements met", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("atExit", true);
	const goal = new Goap.Goal("escape").AddRequirement("atExit", Goap.Comparison.Eq(true));
	expect(goal.IsSatisfied(ws)).toBeTruthy();
});

test("Goal IsSatisfied returns false when not met", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("atExit", false);
	const goal = new Goap.Goal("escape").AddRequirement("atExit", Goap.Comparison.Eq(true));
	expect(goal.IsSatisfied(ws)).toBeFalsy();
});

test("Goal GetPriority returns fixed value", () => {
	const goal = new Goap.Goal("test", 5);
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const agent = new Goap.Agent(ws);
	expect(goal.GetPriority(ws, agent)).toBe(5);
});

test("Goal GetPriority uses function when provided", () => {
	const goal = new Goap.Goal("test", (ws, _agent) => {
		return ws.GetWild<number>("urgency") ?? 0;
	});
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("urgency", 7);
	const agent = new Goap.Agent(ws);
	expect(goal.GetPriority(ws, agent)).toBe(7);
});

test("Goal CalculateDistance returns weighted distance", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("a", 1);
	ws.SetWild("b", 2);
	const goal = new Goap.Goal("test")
		.AddRequirement("a", Goap.Comparison.Eq(99), 2) // not satisfied, weight 2
		.AddRequirement("b", Goap.Comparison.Eq(2), 3); // satisfied
	expect(goal.CalculateDistance(ws)).toBe(2);
});

// ── Comparison utilities ─────────────────────────────────────────────

test("Comparison.GreaterThan", () => {
	expect(Goap.Comparison.GreaterThan(10)(15)).toBeTruthy();
	expect(Goap.Comparison.GreaterThan(10)(5)).toBeFalsy();
});

test("Comparison.LessThan", () => {
	expect(Goap.Comparison.LessThan(10)(5)).toBeTruthy();
	expect(Goap.Comparison.LessThan(10)(15)).toBeFalsy();
});

test("Comparison.GreaterOrEq", () => {
	expect(Goap.Comparison.GreaterOrEq(10)(10)).toBeTruthy();
	expect(Goap.Comparison.GreaterOrEq(10)(9)).toBeFalsy();
});

test("Comparison.LessOrEq", () => {
	expect(Goap.Comparison.LessOrEq(10)(10)).toBeTruthy();
	expect(Goap.Comparison.LessOrEq(10)(11)).toBeFalsy();
});

test("Comparison.Eq", () => {
	expect(Goap.Comparison.Eq(42)(42)).toBeTruthy();
	expect(Goap.Comparison.Eq(42)(43)).toBeFalsy();
});

test("Comparison.NEq", () => {
	expect(Goap.Comparison.NEq(42)(43)).toBeTruthy();
	expect(Goap.Comparison.NEq(42)(42)).toBeFalsy();
});

test("Comparison.Is", () => {
	expect(Goap.Comparison.Is()(true)).toBeTruthy();
	expect(Goap.Comparison.Is()(false)).toBeFalsy();
});

test("Comparison.IsNot", () => {
	expect(Goap.Comparison.IsNot()(false)).toBeTruthy();
	expect(Goap.Comparison.IsNot()(true)).toBeFalsy();
});

test("Comparison.InRange", () => {
	expect(Goap.Comparison.InRange(1, 10)(5)).toBeTruthy();
	expect(Goap.Comparison.InRange(1, 10)(0)).toBeFalsy();
	expect(Goap.Comparison.InRange(1, 10)(11)).toBeFalsy();
});

test("Comparison.Exists", () => {
	expect(Goap.Comparison.Exists()(42)).toBeTruthy();
	expect(Goap.Comparison.Exists()(undefined)).toBeFalsy();
});

// ── Effect utilities ─────────────────────────────────────────────────

test("Effect.Increment", () => {
	expect(Goap.Effect.Increment(5)(10)).toBe(15);
});

test("Effect.Decrement", () => {
	expect(Goap.Effect.Decrement(3)(10)).toBe(7);
});

test("Effect.IncrementClamp respects max", () => {
	expect(Goap.Effect.IncrementClamp(50, 0, 100)(80)).toBe(100);
});

test("Effect.IncrementClamp respects min", () => {
	expect(Goap.Effect.IncrementClamp(50, 0, 100)(-80)).toBe(0);
});

test("Effect.DecrementClamp respects min", () => {
	expect(Goap.Effect.DecrementClamp(50, 0, 100)(30)).toBe(0);
});

test("Effect.DecrementClamp respects max", () => {
	expect(Goap.Effect.DecrementClamp(1, 0, 100)(102)).toBe(100);
});

test("Effect.Set", () => {
	expect(Goap.Effect.Set(42)(0)).toBe(42);
});

test("Effect.Toggle", () => {
	expect(Goap.Effect.Toggle()(true)).toBe(false);
	expect(Goap.Effect.Toggle()(false)).toBe(true);
});

// ── Action Tick lifecycle ────────────────────────────────────────────

test("Action Tick returns SUCCESS immediately when OnStart succeeds", () => {
	const reqs = new Map<string, Goap.Requirement>();
	const effects = new Map<string, Goap.Effect>();
	const action = new TestAction(reqs, effects, 1, Goap.EActionStatus.SUCCESS);
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const active = new Set<Goap.Action>();
	expect(action.Tick(0, ws, active)).toBe(Goap.EActionStatus.SUCCESS);
});

test("Action Tick returns RUNNING then SUCCESS", () => {
	let tick_count = 0;
	const reqs = new Map<string, Goap.Requirement>();
	const effects = new Map<string, Goap.Effect>();

	class RunningThenSuccessAction extends Goap.Action {
		GetStaticRequirements() {
			return reqs;
		}
		GetStaticEffects() {
			return effects;
		}
		GetCost() {
			return 1;
		}
		protected OnTick(): Goap.EActionStatus {
			tick_count++;
			return tick_count < 2 ? Goap.EActionStatus.RUNNING : Goap.EActionStatus.SUCCESS;
		}
	}

	const action = new RunningThenSuccessAction();
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const active = new Set<Goap.Action>();

	expect(action.Tick(0, ws, active)).toBe(Goap.EActionStatus.RUNNING);
	expect(action.IsRunning()).toBeTruthy();
	expect(action.Tick(0, ws, active)).toBe(Goap.EActionStatus.SUCCESS);
	expect(action.IsRunning()).toBeFalsy();
});

// ── Planner ──────────────────────────────────────────────────────────

test("Planner creates a plan to reach goal", () => {
	const current = new Goap.WorldState({} as Record<string, unknown>);
	current.SetWild("atDoor", false);

	const goal = new Goap.Goal("reach_exit").AddRequirement("atDoor", Goap.Comparison.Eq(true));

	const move_to_door = new TestAction(
		new Map<string, Goap.Requirement>(), // no requirements
		new Map<string, Goap.Effect>([["atDoor", Goap.Effect.Set(true)]]),
		1,
	);

	const planner = new Goap.Planner();
	const plan = planner.CreatePlan(current, goal, [move_to_door]);

	expect(plan).never.toBeNil();
	expect(plan!.IsEmpty()).toBeFalsy();
	expect(plan!.Actions.size()).toBe(1);
	expect(plan!.Cost).toBe(1);
});

test("Planner returns undefined when goal is unreachable", () => {
	const current = new Goap.WorldState({} as Record<string, unknown>);
	current.SetWild("hasKey", false);

	const goal = new Goap.Goal("open_door").AddRequirement("doorOpen", Goap.Comparison.Eq(true));

	// Needs key to open door, but no way to get key
	const open_door = new TestAction(
		new Map<string, Goap.Requirement>([["hasKey", Goap.Comparison.Eq(true)]]),
		new Map<string, Goap.Effect>([["doorOpen", Goap.Effect.Set(true)]]),
		1,
	);

	const planner = new Goap.Planner();
	const plan = planner.CreatePlan(current, goal, [open_door]);
	expect(plan).toBeNil();
});

test("Planner chains multiple actions", () => {
	const current = new Goap.WorldState({} as Record<string, unknown>);
	current.SetWild("hasKey", false);
	current.SetWild("doorOpen", false);

	const goal = new Goap.Goal("escape").AddRequirement("doorOpen", Goap.Comparison.Eq(true));

	const get_key = new TestAction(
		new Map<string, Goap.Requirement>(),
		new Map<string, Goap.Effect>([["hasKey", Goap.Effect.Set(true)]]),
		1,
	);

	const open_door = new TestAction(
		new Map<string, Goap.Requirement>([["hasKey", Goap.Comparison.Eq(true)]]),
		new Map<string, Goap.Effect>([["doorOpen", Goap.Effect.Set(true)]]),
		2,
	);

	const planner = new Goap.Planner();
	const plan = planner.CreatePlan(current, goal, [get_key, open_door]);

	expect(plan).never.toBeNil();
	expect(plan!.Actions.size()).toBe(2);
	expect(plan!.Cost).toBe(3); // 1 + 2
});

test("Planner returns empty plan when goal already satisfied", () => {
	const current = new Goap.WorldState({} as Record<string, unknown>);
	current.SetWild("done", true);

	const goal = new Goap.Goal("done").AddRequirement("done", Goap.Comparison.Eq(true));

	const planner = new Goap.Planner();
	const plan = planner.CreatePlan(current, goal, []);
	expect(plan).never.toBeNil();
	expect(plan!.IsEmpty()).toBeTruthy();
});

// ── Agent ────────────────────────────────────────────────────────────

test("Agent creates plan and executes actions", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("reachedGoal", false);

	const goal = new Goap.Goal("reach_goal", 1);
	goal.AddRequirement("reachedGoal", Goap.Comparison.Eq(true));

	const move_action = new TestAction(
		new Map<string, Goap.Requirement>(),
		new Map<string, Goap.Effect>([["reachedGoal", Goap.Effect.Set(true)]]),
		1,
	);

	const agent = new Goap.Agent(ws, [move_action], [goal]);
	agent.SetPlanningInterval(0);

	agent.Update(0.1);

	// After one update, the action should have completed and goal should be satisfied
	expect(ws.GetWild<boolean>("reachedGoal")).toBeTruthy();
	expect(agent.IsIdle()).toBeTruthy();
});

test("Agent AddGoal and GetGoals work", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const agent = new Goap.Agent(ws);
	const goal = new Goap.Goal("test");
	agent.AddGoal(goal);
	expect(agent.GetGoals().size()).toBe(1);
	expect(agent.GetGoals()[0].Name).toBe("test");
});

test("Agent RemoveGoal removes goal", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const agent = new Goap.Agent(ws);
	agent.AddGoal(new Goap.Goal("test"));
	agent.RemoveGoal("test");
	expect(agent.GetGoals().size()).toBe(0);
});

test("Agent GetWorldState returns the world state", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const agent = new Goap.Agent(ws);
	expect(agent.GetWorldState()).toBe(ws);
});

test("Agent Reset clears plan and goals tracking", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	const agent = new Goap.Agent(ws);
	agent.AddGoal(new Goap.Goal("g"));
	agent.Reset();
	expect(agent.GetCurrentGoal()).toBeNil();
	expect(agent.GetCurrentPlan()).toBeNil();
});

// ── WorldStateSet ────────────────────────────────────────────────────

test("WorldStateSet Add and Has", () => {
	const set = new Goap.WorldStateSet();
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("x", 1);
	set.Add(ws);
	expect(set.Has(ws)).toBeTruthy();
});

test("WorldStateSet Has matches equal but different instance", () => {
	const set = new Goap.WorldStateSet();
	const a = new Goap.WorldState({} as Record<string, unknown>);
	a.SetWild("x", 1);
	set.Add(a);
	const b = new Goap.WorldState({} as Record<string, unknown>);
	b.SetWild("x", 1);
	expect(set.Has(b)).toBeTruthy();
});

test("WorldStateSet Delete removes entry", () => {
	const set = new Goap.WorldStateSet();
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("x", 1);
	set.Add(ws);
	expect(set.Delete(ws)).toBeTruthy();
	expect(set.Has(ws)).toBeFalsy();
});

// ── Composite goals ──────────────────────────────────────────────────

test("Composite goal IsSatisfied when all sub-goals met", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("a", true);
	ws.SetWild("b", true);

	const composite = new Goap.Goal("composite", 1, true);
	composite.AddSubGoal(new Goap.Goal("sub1").AddRequirement("a", Goap.Comparison.Eq(true)));
	composite.AddSubGoal(new Goap.Goal("sub2").AddRequirement("b", Goap.Comparison.Eq(true)));

	expect(composite.IsSatisfied(ws)).toBeTruthy();
});

test("Composite goal not satisfied when one sub-goal unmet", () => {
	const ws = new Goap.WorldState({} as Record<string, unknown>);
	ws.SetWild("a", true);
	ws.SetWild("b", false);

	const composite = new Goap.Goal("composite", 1, true);
	composite.AddSubGoal(new Goap.Goal("sub1").AddRequirement("a", Goap.Comparison.Eq(true)));
	composite.AddSubGoal(new Goap.Goal("sub2").AddRequirement("b", Goap.Comparison.Eq(true)));

	expect(composite.IsSatisfied(ws)).toBeFalsy();
});

// ── Plan ─────────────────────────────────────────────────────────────

test("Plan PopAction removes first action", () => {
	const goal = new Goap.Goal("test");
	const reqs = new Map<string, Goap.Requirement>();
	const effects = new Map<string, Goap.Effect>();
	const a1 = new TestAction(reqs, effects, 1);
	const a2 = new TestAction(reqs, effects, 1);
	const plan = new Goap.Plan(goal, [a1, a2], 2);
	expect(plan.GetNextAction()).toBe(a1);
	plan.PopAction();
	expect(plan.GetNextAction()).toBe(a2);
	expect(plan.Actions.size()).toBe(1);
});

test("Plan Clone creates independent copy", () => {
	const goal = new Goap.Goal("test");
	const reqs = new Map<string, Goap.Requirement>();
	const effects = new Map<string, Goap.Effect>();
	const action = new TestAction(reqs, effects, 1);
	const plan = new Goap.Plan(goal, [action], 1);
	const clone = plan.Clone();
	clone.PopAction();
	expect(plan.Actions.size()).toBe(1);
	expect(clone.Actions.size()).toBe(0);
});

runTests();

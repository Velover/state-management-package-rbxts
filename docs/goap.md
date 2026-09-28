# Goal Oriented Action Planning (GOAP)

With GOAP you don't script **how** an agent reaches a goal. It works that out by itself. You describe three things:

- **The world**, as key-value facts: `hasWeapon = false`, `enemyVisible = true`.
- **Actions**, each with **requirements** (facts that must hold before it can run), **effects** (how it changes the facts) and a **cost**.
- **Goals**: the facts the agent wants to be true, and how important each goal is.

The agent picks the most important goal that isn't met yet, searches (with A\*) for the cheapest chain of actions whose effects make it true, and runs those actions one by one.

## Core concepts

- **`WorldState`**: the facts, a key-value store (it extends [`Blackboard`](blackboard.md)).
- **`Action`**: a class you extend. It declares requirements, effects and a cost for the planner, and does the actual work in `OnTick`.
- **`Goal`**: a set of requirements on the world state, plus a priority. A higher priority is more important.
- **`Agent`**: owns the world state, the available actions and the goals. Call its `Update(dt)` every frame.

## Basic usage

```typescript
import { Goap } from "@rbxts/state-management";

type WorldData = {
	hasWeapon: boolean;
	enemyVisible: boolean;
	isSafe: boolean;
};

const worldState = new Goap.WorldState<WorldData>({
	hasWeapon: false,
	enemyVisible: false,
	isSafe: true,
});

class PickupWeaponAction extends Goap.Action {
	GetStaticRequirements(_ws: Goap.WorldState) {
		return new Map<string, Goap.Requirement>([["isSafe", Goap.Comparison.Is()]]);
	}
	GetStaticEffects(_ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>([["hasWeapon", Goap.Effect.Set(true)]]);
	}
	GetCost(_ws: Goap.WorldState) {
		return 1;
	}
	protected OnTick() {
		print("Picking up weapon...");
		return Goap.EActionStatus.SUCCESS;
	}
}

class AttackEnemyAction extends Goap.Action {
	GetStaticRequirements(_ws: Goap.WorldState) {
		return new Map<string, Goap.Requirement>()
			.set("hasWeapon", Goap.Comparison.Is())
			.set("enemyVisible", Goap.Comparison.Is());
	}
	GetStaticEffects(_ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>()
			.set("enemyVisible", Goap.Effect.Set(false))
			.set("isSafe", Goap.Effect.Set(true));
	}
	GetCost(_ws: Goap.WorldState) {
		return 2;
	}
	protected OnTick() {
		print("Attacking enemy...");
		return Goap.EActionStatus.SUCCESS;
	}
}

// Goal: no enemy in sight.
const combatGoal = new Goap.Goal("Combat", 10).AddRequirement(
	"enemyVisible",
	Goap.Comparison.IsNot(),
);

const agent = new Goap.Agent(
	worldState,
	[new PickupWeaponAction(), new AttackEnemyAction()],
	[combatGoal],
);

game.GetService("RunService").Heartbeat.Connect((dt) => agent.Update(dt));

// Nothing to do yet: no enemy is visible, so the goal is already met.
// Once one shows up, the agent plans PickupWeapon -> AttackEnemy and runs it.
worldState.Set("enemyVisible", true);
```

Neither action changes the world state itself. When an action returns `SUCCESS`, the agent applies its effects for you. Your `OnTick` only does the in-game work.

## How the agent runs

Each `Update(dt)`:

1. **Replans if needed.** The agent replans when it has no plan, when the plan is finished, when the current goal is already met, or when the planning interval has passed (1 second by default). Replanning halts the running action (its `OnHalt` runs) and picks the highest-priority goal that isn't met.
2. **Checks the next action's requirements** against the world state. If they no longer hold, it drops the plan and replans on the next `Update`.
3. **Ticks the action.** On `SUCCESS`, its effects are applied to the world state and the plan moves on to the next action. On `FAILURE`, the plan is dropped. On `RUNNING`, it continues next frame.

> **Long actions and the planning interval.** Because a replan halts the running action, an action that takes longer than the planning interval is interrupted and started over again and again, and never finishes. With the default interval of 1 second, a 3-second action never completes. Set the interval longer than your longest action with `agent.SetPlanningInterval(seconds)`.

Things to keep in mind:

- `Comparison.Is()` and `IsNot()` throw if the value isn't a boolean, and the number comparisons throw if it isn't a number, **including when the key was never set**. Give every key the planner looks at a starting value.
- The planner only plans for the single most important unmet goal, and gives up after 1000 search steps. If no chain of actions reaches that goal, the agent does nothing that frame and plans again on the next `Update`. It doesn't fall back to a less important goal.

## Goals

### Priority

A higher number is more important. A goal created without a priority gets `1`.

```typescript
const patrol = new Goap.Goal("Patrol", 5).AddRequirement("atWaypoint", Goap.Comparison.Is());
```

Pass a function instead of a number to compute the priority from the current world state. It is called each time the agent chooses a goal:

```typescript
const combat = new Goap.Goal("Combat", (worldState, agent) => {
	return worldState.GetWild<boolean>("enemyVisible") ? 20 : 5;
}).AddRequirement("enemyVisible", Goap.Comparison.IsNot());
```

### Requirement weights

`AddRequirement(key, requirement, weight = 1)`. The planner estimates how far a world state is from the goal by adding up the weights of the unmet requirements. A higher weight makes the planner try harder to meet that requirement first.

```typescript
goal.AddRequirement("criticalKey", Goap.Comparison.Is(), 5);
```

### Composite goals

A composite goal is a list of sub-goals, planned and run in order. Pass `true` as the third constructor argument, then add the sub-goals:

```typescript
const survival = new Goap.Goal("Survival", 15, true)
	.AddSubGoal(new Goap.Goal("GetWeapon", 10).AddRequirement("hasWeapon", Goap.Comparison.Is()))
	.AddSubGoal(combatGoal);
```

A composite goal counts as met when all of its sub-goals are met; requirements added to it directly are ignored.

## Actions

Extend `Goap.Action` and implement:

| Method                        | Purpose                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `GetStaticRequirements(ws)`   | The facts that must hold before the action can run, as a `Map<key, Requirement>` |
| `GetStaticEffects(ws)`        | How the action changes the facts when it succeeds, as a `Map<key, Effect>`       |
| `GetCost(ws)`                 | How expensive the action is. The planner looks for the cheapest chain            |
| `OnTick(dt, ws, activeNodes)` | Does the work, every frame while the action runs. Returns an `EActionStatus`     |

All three `Get...` methods receive a world state, so they can depend on it. During planning that is the planner's simulated state, not the real one:

```typescript
class ShootAction extends Goap.Action {
	GetStaticRequirements(ws: Goap.WorldState) {
		const reqs = new Map<string, Goap.Requirement>([["ammo", Goap.Comparison.GreaterThan(0)]]);
		if (ws.GetWild<boolean>("isNight")) reqs.set("hasTorch", Goap.Comparison.Is());
		return reqs;
	}
	GetStaticEffects(_ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>([["ammo", Goap.Effect.Decrement(1)]]);
	}
	GetCost(_ws: Goap.WorldState) {
		return 1;
	}
	protected OnTick() {
		return Goap.EActionStatus.SUCCESS;
	}
}
```

### Lifecycle hooks

| Method                        | When it runs                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `OnStart(ws)`                 | Before the first `OnTick`. Return `SUCCESS` or `FAILURE` to finish right away, `RUNNING` to go on. The default returns `RUNNING`. |
| `OnTick(dt, ws, activeNodes)` | Every frame while the action runs, starting in the same frame as `OnStart`. **Required.**                                         |
| `OnFinish(status, ws)`        | After the action succeeds or fails.                                                                                               |
| `OnHalt()`                    | When the action is interrupted, for example by a replan.                                                                          |

## Requirements (`Goap.Comparison`)

| Factory                        | Passes when the value…                     |
| ------------------------------ | ------------------------------------------ |
| `Comparison.Is()`              | is `true` (must be a boolean)              |
| `Comparison.IsNot()`           | is `false` (must be a boolean)             |
| `Comparison.Eq(value)`         | `=== value`                                |
| `Comparison.NEq(value)`        | `!== value`                                |
| `Comparison.GreaterThan(n)`    | is a number `> n`                          |
| `Comparison.GreaterOrEq(n)`    | is a number `>= n`                         |
| `Comparison.LessThan(n)`       | is a number `< n`                          |
| `Comparison.LessOrEq(n)`       | is a number `<= n`                         |
| `Comparison.InRange(min, max)` | is a number from `min` to `max`, inclusive |
| `Comparison.IsIn(values)`      | is one of `values`                         |
| `Comparison.IsNotIn(values)`   | is none of `values`                        |
| `Comparison.Exists()`          | is not `undefined`                         |

## Effects (`Goap.Effect`)

| Factory                              | New value                                                            |
| ------------------------------------ | -------------------------------------------------------------------- |
| `Effect.Set(value)`                  | `value`                                                              |
| `Effect.Toggle()`                    | Flips a boolean; turns a number `0` into `1`, anything else into `0` |
| `Effect.Increment(n = 1)`            | Old value `+ n` (a missing value counts as `0`)                      |
| `Effect.Decrement(n = 1)`            | Old value `- n` (a missing value counts as `0`)                      |
| `Effect.IncrementClamp(n, min, max)` | Old value `+ n`, kept between `min` and `max`                        |
| `Effect.DecrementClamp(n, min, max)` | Old value `- n`, kept between `min` and `max`                        |
| `Effect.Multiply(n)`                 | Old value `* n`                                                      |
| `Effect.Divide(n)`                   | Old value `/ n`                                                      |
| `Effect.Insert(value)`               | The array, with `value` pushed onto it                               |
| `Effect.Remove(value)`               | The array, with `value` removed from it                              |

> **Caution:** `Insert` and `Remove` change the array in place. The planner's simulated world states share arrays with the real one, so an action the planner merely considers already changes the real array. Until this is fixed, avoid these two in actions the planner can choose.

## Connectors

To run an FSM or a behavior tree as a GOAP action, extend one of these. They are abstract: you still implement `GetStaticRequirements`, `GetStaticEffects` and `GetCost`.

- **`Goap.FSMConnector`**, constructed with `(fsm)`: starts the FSM when the action starts, updates it every frame, and stops it when the action is halted.
- **`Goap.BTConnector`**, constructed with `(tree, slot)`: ticks that agent of a [behavior tree](behavior-tree.md) with `tree.TickAgent(slot, dt)` every frame, and halts it when the action is halted. Don't also call `tree.Tick()` on that tree ([why](behavior-tree.md#tick-or-tickagent-not-both)).

Both always return `RUNNING`, so they never succeed: their effects are never applied, and they only stop when the agent replans or resets. Each replan restarts them, so with the default planning interval the FSM or tree starts over every second. Raise the interval if that isn't what you want.

## Agent API

| Method                                         | Description                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `new Goap.Agent(worldState, actions?, goals?)` | Creates an agent                                                                             |
| `Update(dt)`                                   | Replans if needed, then runs the current plan. See [How the agent runs](#how-the-agent-runs) |
| `AddAction(action)`                            | Adds an available action                                                                     |
| `AddGoal(goal)`                                | Adds a goal                                                                                  |
| `RemoveGoal(name)`                             | Removes a goal by name, and drops the plan if it was the current goal                        |
| `GetGoals()`                                   | A copy of the goals list                                                                     |
| `GetCurrentGoal()`                             | The goal being pursued, or `undefined`                                                       |
| `GetCurrentPlan()`                             | The current plan, or `undefined`                                                             |
| `GetWorldState()`                              | The world state                                                                              |
| `IsIdle()`                                     | `true` when there is no plan or it is finished                                               |
| `SetPlanningInterval(seconds)`                 | How often the agent replans while a plan is running (default 1)                              |
| `Reset()`                                      | Halts the running action and drops the plan and goal                                         |

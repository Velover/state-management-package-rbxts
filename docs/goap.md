# Goal Oriented Action Planning (GOAP)

GOAP lets an agent automatically plan a sequence of actions to satisfy a goal, using an A\* search over a world state. The agent re-plans whenever the current plan fails or a better goal becomes available.

## Core Concepts

- **WorldState**: A key-value store (extends `Blackboard`) representing the current state of the world.
- **Action**: A unit of work with preconditions (`Requirements`) and effects (`Effects`). The planner chains actions whose effects satisfy the next action's requirements.
- **Goal**: A set of requirements on the world state. Goals have priorities; the agent always pursues the highest-priority unsatisfied goal.
- **Agent**: Owns the world state, a list of available actions, and a list of goals. Ticked every frame.

## Basic Usage

```typescript
import { Goap, Blackboard } from "@rbxts/state-management";

interface WorldData {
	hasWeapon: boolean;
	enemyVisible: boolean;
	isSafe: boolean;
}

const worldState = new Goap.WorldState<WorldData>({
	hasWeapon: false,
	enemyVisible: false,
	isSafe: true,
});

class PickupWeaponAction extends Goap.Action {
	GetStaticEffects(_ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>([["hasWeapon", Goap.Effect.Set(true)]]);
	}
	GetStaticRequirements(_ws: Goap.WorldState) {
		return new Map<string, Goap.Requirement>([["isSafe", Goap.Comparison.Is()]]);
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
	GetStaticEffects(_ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>()
			.set("enemyVisible", Goap.Effect.Set(false))
			.set("isSafe", Goap.Effect.Set(true));
	}
	GetStaticRequirements(_ws: Goap.WorldState) {
		return new Map<string, Goap.Requirement>()
			.set("hasWeapon", Goap.Comparison.Is())
			.set("enemyVisible", Goap.Comparison.Is());
	}
	GetCost(_ws: Goap.WorldState) {
		return 2;
	}

	protected OnTick() {
		print("Attacking enemy...");
		return Goap.EActionStatus.SUCCESS;
	}
}

const combatGoal = new Goap.Goal("Combat", 10).AddRequirement(
	"enemyVisible",
	Goap.Comparison.IsNot(),
);

const agent = new Goap.Agent(
	worldState,
	[new PickupWeaponAction(), new AttackEnemyAction()],
	[combatGoal],
);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	agent.Update(dt);
});
```

## Goals

### Static Priority

```typescript
const goal = new Goap.Goal("Patrol", 5).AddRequirement("atWaypoint", Goap.Comparison.Is());
```

### Dynamic Priority

Pass a function instead of a number; it receives the current world state and the agent.

```typescript
const combatGoal = new Goap.Goal("Combat", (worldState, agent) => {
	return worldState.GetWild<boolean>("enemyVisible") ? 20 : 5;
}).AddRequirement("enemyVisible", Goap.Comparison.IsNot(), /* weight */ 3);
```

### Weighted Requirements

The weight affects the heuristic distance calculation during planning — higher weight makes an unsatisfied requirement cost more, nudging the planner to satisfy it first.

```typescript
goal.AddRequirement("criticalKey", Goap.Comparison.Is(), 5); // weight: 5
```

### Hierarchical (Composite) Goals

A composite goal decomposes into sub-goals that are planned and executed in order.

```typescript
const survivalGoal = new Goap.Goal("Survival", 15, /* isComposite */ true)
	.AddSubGoal(new Goap.Goal("GetWeapon", 10).AddRequirement("hasWeapon", Goap.Comparison.Is()))
	.AddSubGoal(combatGoal);
```

## Actions

### Lifecycle

| Method                                | Description                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `OnStart(worldState)`                 | Called before first `OnTick`. Return `SUCCESS`/`FAILURE` to finish immediately. |
| `OnTick(dt, worldState, activeNodes)` | Called every frame while running. **Must be implemented.**                      |
| `OnFinish(status, worldState)`        | Called when the action completes or fails.                                      |
| `OnHalt()`                            | Called when the action is interrupted.                                          |

### Requirements & Effects

Both methods receive the current `WorldState` at planning time, allowing dynamic behavior.

```typescript
class ConditionalAction extends Goap.Action {
	GetStaticRequirements(ws: Goap.WorldState) {
		const reqs = new Map<string, Goap.Requirement>();
		reqs.set("hasAmmo", Goap.Comparison.GreaterThan(0));
		if (ws.GetWild<boolean>("isNight")) {
			reqs.set("hasTorch", Goap.Comparison.Is());
		}
		return reqs;
	}
	GetStaticEffects(ws: Goap.WorldState) {
		return new Map<string, Goap.Effect>([["ammoUsed", Goap.Effect.Increment(1)]]);
	}
	GetCost(_ws: Goap.WorldState) {
		return 1;
	}
	protected OnTick() {
		return Goap.EActionStatus.SUCCESS;
	}
}
```

## Comparison (Requirement Factories)

| Factory                        | Description                     |
| ------------------------------ | ------------------------------- |
| `Comparison.Is()`              | Value must be `true` (boolean)  |
| `Comparison.IsNot()`           | Value must be `false` (boolean) |
| `Comparison.Eq(value)`         | Strict equality                 |
| `Comparison.NEq(value)`        | Strict inequality               |
| `Comparison.GreaterThan(n)`    | Number > n                      |
| `Comparison.GreaterOrEq(n)`    | Number >= n                     |
| `Comparison.LessThan(n)`       | Number < n                      |
| `Comparison.LessOrEq(n)`       | Number <= n                     |
| `Comparison.InRange(min, max)` | Number in [min, max]            |
| `Comparison.IsIn(values)`      | Value is in the array           |
| `Comparison.IsNotIn(values)`   | Value is not in the array       |
| `Comparison.Exists()`          | Value is not `undefined`        |

## Effect Factories

| Factory                              | Description                  |
| ------------------------------------ | ---------------------------- |
| `Effect.Set(value)`                  | Set to a fixed value         |
| `Effect.Toggle()`                    | Flip boolean or toggle 0/1   |
| `Effect.Increment(n?)`               | Add `n` (default 1)          |
| `Effect.Decrement(n?)`               | Subtract `n` (default 1)     |
| `Effect.IncrementClamp(n, min, max)` | Add with min/max bounds      |
| `Effect.DecrementClamp(n, min, max)` | Subtract with min/max bounds |
| `Effect.Multiply(n)`                 | Multiply by `n`              |
| `Effect.Divide(n)`                   | Divide by `n`                |
| `Effect.Insert(value)`               | Push into an array           |
| `Effect.Remove(value)`               | Remove from an array         |

## Agent API

| Method                   | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `Update(dt)`             | Main loop — re-plans if needed, then executes the current plan |
| `AddAction(action)`      | Add an action at runtime                                       |
| `AddGoal(goal)`          | Add a goal at runtime                                          |
| `RemoveGoal(name)`       | Remove a goal by name                                          |
| `GetGoals()`             | Get a copy of the goals list                                   |
| `GetCurrentGoal()`       | Get the goal currently being pursued                           |
| `GetCurrentPlan()`       | Get the current plan                                           |
| `GetWorldState()`        | Get the world state                                            |
| `IsIdle()`               | True when there's no active plan                               |
| `SetPlanningInterval(s)` | How often (in seconds) the agent re-evaluates its plan         |
| `Reset()`                | Halt actions and clear the current plan                        |

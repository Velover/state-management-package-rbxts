# Behavior Tree (BTree)

Behavior Trees model complex hierarchical AI decision-making. Each tick, the tree walks its nodes and returns `SUCCESS`, `FAILURE`, or `RUNNING`.

## Basic Usage

```typescript
import { BTree, Blackboard } from "@rbxts/state-management";

const blackboard = new Blackboard({
	hasTarget: false,
	energyLevel: 100,
});

const findTargetSequence = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("energyLevel") > 20))
	.AddChild(
		new BTree.Action((bb) => {
			if (math.random() > 0.7) {
				bb.Set("hasTarget", true);
				return BTree.ENodeStatus.SUCCESS;
			}
			return BTree.ENodeStatus.FAILURE;
		}),
	);

const attackSequence = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("hasTarget") === true))
	.AddChild(
		new BTree.Cooldown(
			new BTree.Action((bb) => {
				bb.Set("energyLevel", bb.Get("energyLevel") - 10);
				bb.Set("hasTarget", false);
				return BTree.ENodeStatus.SUCCESS;
			}),
			2.0, // 2 second cooldown
		),
	);

const root = new BTree.Fallback()
	.AddChild(attackSequence)
	.AddChild(findTargetSequence)
	.AddChild(
		new BTree.Action((bb) => {
			bb.Set("energyLevel", bb.Get("energyLevel") + 1);
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

const tree = new BTree.BehaviorTree(root, blackboard);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	tree.Tick(dt);
});
```

## Node Status

| Value                 | Description                 |
| --------------------- | --------------------------- |
| `ENodeStatus.SUCCESS` | Node completed successfully |
| `ENodeStatus.FAILURE` | Node failed                 |
| `ENodeStatus.RUNNING` | Node is still in progress   |

## Composite Nodes

Composite nodes have one or more children.

### Sequence

Runs children left-to-right. Returns `FAILURE` as soon as one child fails; returns `SUCCESS` when all succeed.

```typescript
new BTree.Sequence().AddChild(conditionNode).AddChild(actionNode);
```

### ReactiveSequence

Like `Sequence` but re-evaluates all children from the beginning every tick (not just the running one).

### MemorySequence

Like `Sequence` but remembers which child was running and resumes from there next tick. Index resets when the node becomes inactive.

### Fallback

Runs children left-to-right. Returns `SUCCESS` as soon as one child succeeds; returns `FAILURE` when all fail.

```typescript
new BTree.Fallback().AddChild(primaryAction).AddChild(fallbackAction);
```

### ReactiveFallback

Like `Fallback` but re-evaluates all children from the beginning every tick.

### Parallel

Runs all children simultaneously each tick.

```typescript
new BTree.Parallel(
	BTree.EParallelPolicy.ONE, // succeed when ONE child succeeds
	BTree.EParallelPolicy.ALL, // fail when ALL children fail
)
	.AddChild(monitorNode)
	.AddChild(actionNode);
```

`EParallelPolicy.ALL` — require all children to succeed/fail.
`EParallelPolicy.ONE` — require one child to succeed/fail.

### IfThenElse

2–3 children: `[condition, then, else?]`. Evaluates the condition on start; runs the `then` branch if `SUCCESS`, the `else` branch if `FAILURE`.

```typescript
new BTree.IfThenElse()
	.AddChild(new BTree.Condition((bb) => bb.Get("energyLevel") > 50))
	.AddChild(aggressiveBehavior)
	.AddChild(defensiveBehavior);
```

### WhileDoElse

2–3 children: `[condition, do, else?]`. Re-evaluates the condition every tick; runs the `do` branch while the condition is `SUCCESS`, the `else` branch while it is `FAILURE`.

```typescript
new BTree.WhileDoElse()
	.AddChild(new BTree.Condition((bb) => bb.GetWild<boolean>("onDuty") ?? true))
	.AddChild(patrolBehavior)
	.AddChild(restBehavior);
```

### TryCatch

3 children: `[try, catch, finally?]`. Runs `try`; on `FAILURE` runs `catch`; always runs `finally` (if present).

### Switch

Selects a child based on a blackboard key value.

```typescript
new BTree.Switch<string>("currentWeapon")
	.Case("sword", swordBehavior)
	.Case("bow", bowBehavior)
	.Default(unarmedBehavior);
```

## Decorator Nodes

Decorators wrap a single child node and modify its behavior.

### Inverter

Swaps `SUCCESS` ↔ `FAILURE`. `RUNNING` passes through unchanged.

```typescript
new BTree.Inverter(new BTree.Condition((bb) => bb.Get("enemyNearby")));
```

### ForceSuccess / ForceFailure

Override the child's result to always be `SUCCESS` or `FAILURE` (unless `RUNNING`).

```typescript
new BTree.ForceSuccess(actionThatMightFail);
new BTree.ForceFailure(actionThatMightSucceed);
```

### FireAndForget

Runs the child but always returns `SUCCESS`, ignoring the child's result.

### RunningGate

Returns `FAILURE` if the child would return `RUNNING`. Useful to prevent a node from blocking.

### Timeout

Fails (or succeeds) the child if it has been running longer than a duration.

```typescript
new BTree.Timeout(longRunningNode, 10.0, BTree.ETimeoutBehavior.FAILURE);
```

### Cooldown

Enforces a cooldown after the child finishes. Returns `FAILURE` while on cooldown.

```typescript
new BTree.Cooldown(attackNode, 2.0, /* resetOnHalt */ false);
```

### Repeat

Repeats the child a fixed number of times.

```typescript
new BTree.Repeat(
	patrolStep,
	5, // repeat 5 times
	BTree.ERepeatCondition.SUCCESS, // only repeat on success
);
```

`ERepeatCondition`: `ALWAYS`, `SUCCESS`, `FAILURE`.

### KeepRunningUntilSuccess / KeepRunningUntilFailure

Retries the child until it succeeds (or fails), with an optional max attempt count.

```typescript
new BTree.KeepRunningUntilSuccess(unreliableAction, 5); // max 5 attempts
new BTree.KeepRunningUntilFailure(monitorAction, -1); // unlimited
```

## Leaf Nodes

### Action

Runs a callback each tick while `RUNNING`.

```typescript
new BTree.Action((bb, dt) => {
	// return SUCCESS, FAILURE, or RUNNING
	return BTree.ENodeStatus.SUCCESS;
});
```

### Condition

Checks a boolean predicate. Returns `SUCCESS` or `FAILURE`.

```typescript
new BTree.Condition((bb, dt) => bb.Get("hasTarget") === true);
```

### Callback

Runs a void callback and always returns `SUCCESS`.

```typescript
new BTree.Callback((bb, dt) => {
	bb.SetWild("lastUpdateTime", tick());
});
```

### Wait

Waits for a duration, returning `RUNNING` until elapsed, then `SUCCESS`.

```typescript
new BTree.Wait(2.0); // 2 seconds
```

### WaitGate

Like `Wait` but returns `FAILURE` until the duration elapses, then `SUCCESS`. Does not return `RUNNING`.

```typescript
new BTree.WaitGate(1.0);
```

### WasEntryUpdated

Returns `SUCCESS` if any of the specified blackboard keys have changed since the last tick, otherwise `FAILURE`. Pass `true` for `skipFirst` to snapshot the current values on activation so the first tick only reports genuine changes.

```typescript
new BTree.WasEntryUpdated(["targetPosition", "alertLevel"]); // react to any change
new BTree.WasEntryUpdated(["targetPosition"], true); // skip the first-tick diff
```

### Timer

Reads a blackboard key as a countdown timer. Returns `SUCCESS` when the value reaches zero or below.

```typescript
new BTree.Timer<{ alertTimeLeft: number }>("alertTimeLeft");
```

### FullAction

A convenience leaf node with all lifecycle callbacks in one config object.

```typescript
new BTree.FullAction({
	OnStart: (bb) => BTree.ENodeStatus.RUNNING,
	OnTick: (dt, bb) => BTree.ENodeStatus.SUCCESS,
	OnHalt: (bb) => {},
	OnSuccess: (bb) => {},
	OnFailure: (bb) => {},
	OnExit: (status, bb) => {},
	OnActivated: (bb) => {},
	OnDeactivated: (bb) => {},
});
```

## Node Lifecycle

When subclassing `BTree.Node`, the following methods can be overridden:

| Method                  | When called                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `OnStart(bb)`           | First tick after the node becomes active. Return `RUNNING` to continue to `OnTick`, or `SUCCESS`/`FAILURE` to finish immediately. |
| `OnTick(dt, bb, ...)`   | Every subsequent tick while the node is running. **Must be implemented.**                                                         |
| `OnExit(status, bb)`    | Called when `OnTick` returns `SUCCESS` or `FAILURE`.                                                                              |
| `OnSuccess(bb)`         | Called when `OnTick` returns `SUCCESS`.                                                                                           |
| `OnFailure(bb)`         | Called when `OnTick` returns `FAILURE`.                                                                                           |
| `OnHalt(bb)`            | Called when the node is interrupted by `Halt()`.                                                                                  |
| `OnBecameActivated(bb)` | Called when the node wasn't active last tick but is now.                                                                          |
| `OnBecameInactive(bb)`  | Called when the node was active last tick but is no longer.                                                                       |

```typescript
class CustomPatrolNode extends BTree.Node {
	protected OnStart(bb: Blackboard): BTree.ENodeStatus {
		bb.SetWild("patrolStartTime", tick());
		return BTree.ENodeStatus.RUNNING;
	}

	protected OnTick(dt: number, bb: Blackboard): BTree.ENodeStatus {
		const elapsed = tick() - (bb.GetWild<number>("patrolStartTime") ?? 0);
		return elapsed > 10 ? BTree.ENodeStatus.SUCCESS : BTree.ENodeStatus.RUNNING;
	}

	protected OnExit(status: BTree.ENodeStatus, bb: Blackboard): void {
		bb.SetWild("patrolEndTime", tick());
	}

	protected OnHalt(bb: Blackboard): void {
		bb.SetWild("patrolInterrupted", true);
	}

	OnBecameActivated(bb: Blackboard): void {
		print("Patrol node became active");
	}

	OnBecameInactive(bb: Blackboard): void {
		print("Patrol node became inactive");
	}
}
```

## Active Node Tracking

`BehaviorTree` tracks which nodes were active in the last tick. Use this for debugging or driving animations.

```typescript
const tree = new BTree.BehaviorTree(root, blackboard);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	const status = tree.Tick(dt);
	const activeNodes = tree.GetActiveNodes();
	print(`Active: ${activeNodes.size()}, Status: ${status}`);
});
```

## Cross-System Connectors

### FSMConnector

Runs an `FSM` as a behavior tree node. Starts the FSM on `OnStart`, ticks it on `OnTick`, and halts it on `OnHalt`.

```typescript
const fsmConnector = new BTree.FSMConnector(guardFSM);

new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("shouldActivateGuard")))
	.AddChild(fsmConnector);
```

### GoapConnector

Runs a GOAP `Agent` as a behavior tree node.

```typescript
const goapConnector = new BTree.GoapConnector(combatAgent);

new BTree.Fallback().AddChild(goapConnector).AddChild(simpleFallbackAction);
```

### SubTree

Embeds another `BehaviorTree` as a node.

```typescript
const combatSubTree = new BTree.BehaviorTree(combatRoot, blackboard);

new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("inCombat")))
	.AddChild(new BTree.SubTree(combatSubTree));
```

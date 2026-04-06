# BTCreator

`BTCreator` builds a `BehaviorTree` from a JSON description. You register named actions, conditions, callbacks, and sub-trees, then call `Build()` to produce the tree. This lets you design tree structures in an external tool and load them at runtime.

## JSON Schema

The JSON must contain a `name`, `baked_at`, `version`, and a `structure` map of node objects. One node must be named `"EntryPoint"` — it is the root of the tree.

```json
{
	"name": "MyTree",
	"baked_at": "2026-01-01",
	"version": "1",
	"structure": {
		"root": {
			"name": "EntryPoint",
			"children": ["seq_0"]
		},
		"seq_0": {
			"name": "Sequence",
			"children": ["cond_0", "act_0"]
		},
		"cond_0": {
			"name": "Condition",
			"children": [],
			"parameters": { "conditionName": "HasTarget" }
		},
		"act_0": {
			"name": "Action",
			"children": [],
			"parameters": { "actionName": "AttackTarget" }
		}
	}
}
```

A `Switch` node uses a `switch_case` block instead of `parameters`:

```json
{
	"name": "Switch",
	"children": [],
	"switch_case": {
		"parameter_name": "currentWeapon",
		"cases": {
			"sword": "sword_node_id",
			"bow": "bow_node_id"
		},
		"default": "unarmed_node_id"
	}
}
```

## Usage

```typescript
import { BTCreator, Blackboard, BTree } from "@rbxts/state-management";

const blackboard = new Blackboard({ hasTarget: false });
const creator = new BTCreator();

// Register named actions
creator.RegisterAction("AttackTarget", (bb, dt) => {
	print("Attacking!");
	return BTree.ENodeStatus.SUCCESS;
});

// Register named conditions
creator.RegisterCondition("HasTarget", (bb, dt) => {
	return bb.Get("hasTarget") === true;
});

// Register named callbacks (always returns SUCCESS)
creator.RegisterCallback("LogState", (bb, dt) => {
	print("State logged");
});

// Register a sub-tree factory
creator.RegisterSubTree("CombatTree", (bb) => {
	const root = new BTree.Action((_b) => BTree.ENodeStatus.SUCCESS);
	return new BTree.BehaviorTree(root, bb);
});

// Register a custom node type
creator.AddNodeCreator("MyCustomNode", (c) => {
	const label = c.GetCurrentNodeParameter("label", "string");
	return new BTree.Action((bb) => {
		print(label);
		return BTree.ENodeStatus.SUCCESS;
	});
});

// Load JSON and build
creator.LoadData(jsonString); // throws if schema is invalid
const tree = creator.Build(blackboard);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	tree.Tick(dt);
});
```

## Custom Node Creators

Inside a creator callback, use the `BTCreator` argument to inspect the current node:

| Method                                  | Description                                                     |
| --------------------------------------- | --------------------------------------------------------------- |
| `c.GetCurrentNodeId()`                  | ID of the node being built                                      |
| `c.GetCurrentNodeData()`                | Raw node data (`name`, `children`, `parameters`, `switch_case`) |
| `c.GetCurrentNodeParameter(name, type)` | Read a typed parameter (`"string"` or `"number"`)               |
| `c.GetCurrentBlackboard()`              | The blackboard passed to `Build()`                              |
| `c.GetCreatedNode(id)`                  | Retrieve an already-built child node by ID                      |

## Built-in Node Types

| Node name           | Parameters                                                               | Description                                      |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `Sequence`          | —                                                                        | Runs children in order until one fails           |
| `ReactiveSequence`  | —                                                                        | Like Sequence, restarts from beginning each tick |
| `MemorySequence`    | —                                                                        | Remembers which child was running                |
| `Fallback`          | —                                                                        | Runs children until one succeeds                 |
| `ReactiveFallback`  | —                                                                        | Like Fallback, restarts each tick                |
| `Parallel`          | `successPolicy` (`ALL`/`ONE`), `failurePolicy` (`ALL`/`ONE`)             | Runs all children simultaneously                 |
| `IfThenElse`        | —                                                                        | 2–3 children: condition, then, else              |
| `WhileDoElse`       | —                                                                        | 2–3 children: condition, do, else                |
| `Inverter`          | —                                                                        | Inverts SUCCESS/FAILURE                          |
| `ForceSuccess`      | —                                                                        | Always SUCCESS unless RUNNING                    |
| `ForceFailure`      | —                                                                        | Always FAILURE unless RUNNING                    |
| `FireAndForget`     | —                                                                        | Executes child, ignores its result               |
| `RunningGate`       | —                                                                        | Returns FAILURE if child would be RUNNING        |
| `Timeout`           | `timeoutSeconds` (number), `timeoutBehavior` (`FAILURE`/`SUCCESS`)       | Fails/succeeds child after timeout               |
| `Cooldown`          | `cooldownSeconds` (number), `resetOnHalt` (`TRUE`/`FALSE`)               | Enforces cooldown after execution                |
| `Repeat`            | `repeatCount` (number), `repeatCondition` (`ALWAYS`/`SUCCESS`/`FAILURE`) | Repeats child N times                            |
| `RetryUntilSuccess` | `maxAttempts` (number)                                                   | Retries child until it succeeds                  |
| `RetryUntilFailure` | `maxAttempts` (number)                                                   | Retries child until it fails                     |
| `OneShot`           | `resetOnBecomeInactive` (`TRUE`/`FALSE`)                                 | Runs child once, caches result on repeat ticks   |
| `Plug`              | `Status` (`SUCCESS`/`FAILURE`/`RUNNING`)                                 | Always returns a fixed status                    |
| `Action`            | `actionName` (string)                                                    | Calls a registered action                        |
| `Condition`         | `conditionName` (string)                                                 | Calls a registered condition                     |
| `Callback`          | `callbackName` (string)                                                  | Calls a registered callback                      |
| `Wait`              | `duration` (number)                                                      | Waits N seconds (returns RUNNING)                |
| `WaitGate`          | `duration` (number)                                                      | Waits N seconds (returns FAILURE until elapsed)  |
| `Timer`             | `timerName` (string)                                                     | Checks a blackboard timer key                    |
| `Switch`            | `switch_case` block                                                      | Selects child by blackboard value                |
| `SubTree`           | `treeName` (string)                                                      | Runs a registered sub-tree                       |

## API Reference

| Method                        | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `LoadData(json)`              | Parse and validate JSON; throws on invalid schema  |
| `Build(bb)`                   | Instantiate all nodes and return a `BehaviorTree`  |
| `RegisterAction(name, fn)`    | Register an action callback                        |
| `RegisterCondition(name, fn)` | Register a condition callback                      |
| `RegisterCallback(name, fn)`  | Register a void callback                           |
| `RegisterSubTree(name, fn)`   | Register a sub-tree factory                        |
| `AddNodeCreator(name, fn)`    | Register a custom node type                        |
| `GetCreatedNode(id)`          | Get a built node by ID (only valid during `Build`) |
| `GetNodeData(id)`             | Get raw node data by ID                            |

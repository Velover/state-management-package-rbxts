# BTCreator

`BTCreator` builds a shared `BTree.BehaviorTree` from a JSON description. You register named actions, conditions, callbacks, fields and sub-trees, then call `Build()` to produce the tree once; agents are then added to it with `AddAgent`. This lets you design tree structures in an external tool and load them at runtime.

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
import { BTCreator, BTree } from "@rbxts/state-management";

const creator = new BTCreator(); // or new BTCreator({ external_ids: true }) for ECS entity ids

// Fields: per-agent data the JSON can refer to by name (Timer, WasEntryUpdated, Switch).
// They are registered on the built tree, so RemoveAgent clears them.
const hasTarget = creator.RegisterField<boolean>("hasTarget");
const weapon = creator.RegisterField<string>("currentWeapon");
const alertTimer = creator.RegisterField<number>("alertTimeLeft");

// Register named actions
creator.RegisterAction("AttackTarget", (slot, dt, tree) => {
	print(`agent ${slot} attacking`);
	return BTree.ENodeStatus.SUCCESS;
});

// Register named conditions
creator.RegisterCondition("HasTarget", (slot) => hasTarget.get(slot) === true);

// Register named callbacks (Callback nodes always return SUCCESS; Scope nodes use them as OnEnter/OnExit)
creator.RegisterCallback("LogState", (slot) => print(`state logged for ${slot}`));

// Register a sub-tree factory: returns the root node to embed
creator.RegisterSubTree("CombatTree", () => BTree.Action(() => BTree.ENodeStatus.SUCCESS));

// A Switch whose parameter_name is not a field can use a named selector instead
creator.RegisterSelector("weaponKind", (slot) => weapon.get(slot));

// Register a custom node type
creator.AddNodeCreator("MyCustomNode", (c) => {
	const label = c.GetCurrentNodeParameter("label", "string");
	return BTree.Callback(() => print(label));
});

// Load JSON and build once
creator.LoadData(jsonString); // throws if schema is invalid
const tree = creator.Build();

const slot = tree.AddAgent();
hasTarget.set(slot, true);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	tree.Tick(dt); // ticks every agent
});
```

To embed one baked file inside another, build its root with `BuildRoot()` and register that as a sub-tree.

## Custom Node Creators

Inside a creator callback, use the `BTCreator` argument to inspect the current node:

| Method                                  | Description                                                     |
| --------------------------------------- | --------------------------------------------------------------- |
| `c.GetCurrentNodeId()`                  | ID of the node being built                                      |
| `c.GetCurrentNodeData()`                | Raw node data (`name`, `children`, `parameters`, `switch_case`) |
| `c.GetCurrentNodeParameter(name, type)` | Read a typed parameter (`"string"` or `"number"`)               |
| `c.GetCurrentNodeOptionalString(name)`  | Read a string parameter that may be absent                      |
| `c.GetCurrentChildren()`                | The already-built children of the current node, in order        |
| `c.GetCurrentChild()`                   | The already-built first child (decorators)                      |
| `c.GetCreatedNode(id)`                  | Retrieve an already-built child node by ID                      |
| `c.GetField(name)`                      | A registered field by name                                      |

## Built-in Node Types

| Node name           | Parameters                                                               | Description                                                                 |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `Sequence`          | —                                                                        | Runs children in order until one fails                                      |
| `ReactiveSequence`  | —                                                                        | Like Sequence, restarts from beginning each tick                            |
| `MemorySequence`    | —                                                                        | Remembers which child was running                                           |
| `Fallback`          | —                                                                        | Runs children until one succeeds                                            |
| `ReactiveFallback`  | —                                                                        | Like Fallback, restarts each tick                                           |
| `Parallel`          | `successPolicy` (`ALL`/`ONE`), `failurePolicy` (`ALL`/`ONE`)             | Runs all children simultaneously                                            |
| `IfThenElse`        | —                                                                        | 2–3 children: condition, then, else                                         |
| `WhileDoElse`       | —                                                                        | 2–3 children: condition, do, else                                           |
| `Inverter`          | —                                                                        | Inverts SUCCESS/FAILURE                                                     |
| `ForceSuccess`      | —                                                                        | Always SUCCESS unless RUNNING                                               |
| `ForceFailure`      | —                                                                        | Always FAILURE unless RUNNING                                               |
| `FireAndForget`     | —                                                                        | Executes child, ignores its result                                          |
| `RunningGate`       | —                                                                        | Returns FAILURE if child would be RUNNING                                   |
| `Timeout`           | `timeoutSeconds` (number), `timeoutBehavior` (`FAILURE`/`SUCCESS`)       | Fails/succeeds child after timeout                                          |
| `Cooldown`          | `cooldownSeconds` (number), `resetOnHalt` (`TRUE`/`FALSE`)               | Enforces cooldown after execution                                           |
| `Repeat`            | `repeatCount` (number), `repeatCondition` (`ALWAYS`/`SUCCESS`/`FAILURE`) | Repeats child N times                                                       |
| `RetryUntilSuccess` | `maxAttempts` (number)                                                   | Retries child until it succeeds                                             |
| `RetryUntilFailure` | `maxAttempts` (number)                                                   | Retries child until it fails                                                |
| `OneShot`           | `resetOnBecomeInactive` (`TRUE`/`FALSE`)                                 | Runs child once, caches result on repeat ticks                              |
| `Plug`              | `Status` (`SUCCESS`/`FAILURE`/`RUNNING`)                                 | Always returns a fixed status                                               |
| `Action`            | `actionName` (string)                                                    | Calls a registered action                                                   |
| `Condition`         | `conditionName` (string)                                                 | Calls a registered condition                                                |
| `Callback`          | `callbackName` (string)                                                  | Calls a registered callback                                                 |
| `Wait`              | `duration` (number)                                                      | Waits N seconds (returns RUNNING)                                           |
| `WaitGate`          | `duration` (number)                                                      | Waits N seconds (returns FAILURE until elapsed)                             |
| `Timer`             | `timerName` (string)                                                     | Counts down the registered field of that name                               |
| `Switch`            | `switch_case` block                                                      | Selects child by the registered field or selector named in `parameter_name` |
| `SubTree`           | `treeName` (string)                                                      | Embeds the root node from a registered sub-tree                             |
| `TryCatch`          | —                                                                        | 2–3 children: try, catch, finally (v2)                                      |
| `WasEntryUpdated`   | `entries` (comma-separated field names), `skipFirst` (`TRUE`/`FALSE`)    | SUCCESS when any listed field changed (v2)                                  |
| `Log`               | `message` (string)                                                       | Prints and returns SUCCESS (v2)                                             |
| `ForceRunning`      | —                                                                        | Always RUNNING, child restarts on completion (v2)                           |
| `Scope`             | `onEnter` (callback name, optional), `onExit` (callback name, optional)  | Brackets the visited span of its branch (v2)                                |

## API Reference

| Method                        | Description                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `new BTCreator(options?)`     | `options` are passed to the built tree (`{ external_ids: true }` for ECS ids)              |
| `LoadData(json)`              | Parse and validate JSON; throws on invalid schema                                          |
| `Build()`                     | Instantiate all nodes once and return a `BehaviorTree` with the registered fields attached |
| `BuildRoot()`                 | Instantiate the nodes and return the root node only (for embedding)                        |
| `RegisterAction(name, fn)`    | Register `(slot, dt, tree) => status`                                                      |
| `RegisterCondition(name, fn)` | Register `(slot, dt, tree) => boolean`                                                     |
| `RegisterCallback(name, fn)`  | Register `(slot, dt, tree) => void`                                                        |
| `RegisterField(name, map?)`   | Register a per-agent `Map<Slot, T>` by name; returns it                                    |
| `RegisterSelector(name, fn)`  | Register `(slot, tree) => key` for `Switch` nodes                                          |
| `RegisterSubTree(name, fn)`   | Register a factory returning a root node                                                   |
| `AddNodeCreator(name, fn)`    | Register a custom node type                                                                |
| `GetCreatedNode(id)`          | Get a built node by ID (only valid during `Build`)                                         |
| `GetNodeData(id)`             | Get raw node data by ID                                                                    |

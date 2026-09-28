# BTCreator

`BTCreator` builds a [`BTree.BehaviorTree`](behavior-tree.md) from a JSON file. You can design a tree in the visual editor ([BTCreatorApp](../external/BTCreatorApp/)) and load it at runtime instead of writing it in code.

The JSON only names things: "a `Condition` called `HasTarget`", "an `Action` called `AttackTarget`". Your code supplies what those names mean. The steps:

1. **Register** the game code the file refers to: actions, conditions, callbacks, fields, selectors, sub-trees and any custom node types.
2. **Load** the file with `LoadData(json)`. It is parsed and checked, and it throws if something is malformed.
3. **Build** with `Build()`. The nodes are created once, and you get back a normal `BehaviorTree`.
4. **Use** it like any other tree: `AddAgent()` per NPC, `Tick(dt)` every frame.

## Example

```typescript
import { BTCreator, BTree } from "@rbxts/state-management";

const creator = new BTCreator(); // or new BTCreator({ external_ids: true }) for ECS entity ids

// Fields: per-agent data the file can refer to by name (used by Timer, WasEntryUpdated and Switch nodes).
// Build() registers them on the tree, so RemoveAgent clears them.
const hasTarget = creator.RegisterField<boolean>("hasTarget");
const weapon = creator.RegisterField<string>("currentWeapon");

// The names used by Action, Condition and Callback nodes in the file
creator.RegisterAction("AttackTarget", (slot, dt, tree) => {
	print(`agent ${slot} attacks`);
	return BTree.ENodeStatus.SUCCESS;
});
creator.RegisterCondition("HasTarget", (slot) => hasTarget.get(slot) === true);
creator.RegisterCallback("LogState", (slot) => print(`agent ${slot} logged`));

// Load and build once
creator.LoadData(jsonString); // throws if the file is invalid
const tree = creator.Build();

// Then use it like any tree
const slot = tree.AddAgent();
hasTarget.set(slot, true);
game.GetService("RunService").Heartbeat.Connect((dt) => tree.Tick(dt));
```

The order of registration and `LoadData` doesn't matter, as long as both happen before `Build()`.

## The JSON format

```json
{
	"name": "MyTree",
	"baked_at": "2026-01-01",
	"version": "2.0.0",
	"structure": {
		"root": { "name": "EntryPoint", "children": ["seq_0"] },
		"seq_0": { "name": "Sequence", "children": ["cond_0", "act_0"] },
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

- **`name`, `baked_at`, `version`** are strings, and all three are required.
- **`version`** decides which node types you can use: `"2.0.0"` or `"1.0.0"` add their own sets on top of the common ones (see [Built-in node types](#built-in-node-types)). Any other value gives the common set only. The editor writes this for you.
- **`structure`** maps a node id (any string) to a node:
  - `name`: the node type, such as `"Sequence"` or `"Condition"`, or the name of a custom type you registered.
  - `children`: the ids of the child nodes, in order. Use `[]` for leaves.
  - `parameters`: the node's settings. Values are strings or numbers. On/off settings are the strings `"TRUE"` and `"FALSE"`.
- **Exactly one node must be named `"EntryPoint"`.** It is a marker, not a node of the tree: give it a single child, and that child becomes the root.

A `Switch` node uses a `switch_case` block instead of `parameters`, with its cases instead of `children`:

```json
{
	"name": "Switch",
	"children": [],
	"switch_case": {
		"parameter_name": "currentWeapon",
		"cases": { "sword": "sword_node_id", "bow": "bow_node_id" },
		"default": "unarmed_node_id"
	}
}
```

`parameter_name` is the name of a selector registered with `RegisterSelector`, or of a registered field; selectors are looked up first. The value it returns for the agent picks the case. `default` is optional.

## Built-in node types

Each node is described in full in the [node reference](behavior-tree.md#node-reference). Parameters are required unless marked optional.

### Every version

| Node type          | Parameters                                                                                | What it does                                                 |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Sequence`         | —                                                                                         | Children in order; stops at the first failure                |
| `Fallback`         | —                                                                                         | Children in order; stops at the first success                |
| `ReactiveSequence` | —                                                                                         | Like `Sequence`, but starts from the first child every frame |
| `ReactiveFallback` | —                                                                                         | Like `Fallback`, but starts from the first child every frame |
| `MemorySequence`   | —                                                                                         | Like `Sequence`, but retries from the child that failed      |
| `Parallel`         | `successPolicy`, `failurePolicy`: `"ALL"` or `"ONE"` (anything but `"ALL"` means `"ONE"`) | Ticks all children at once                                   |
| `IfThenElse`       | —                                                                                         | 2–3 children: condition, then, else                          |
| `WhileDoElse`      | —                                                                                         | 2–3 children: condition, do, else                            |
| `Switch`           | `switch_case` block (see above)                                                           | Picks a child by a field's or selector's value               |
| `Inverter`         | —                                                                                         | Swaps `SUCCESS` and `FAILURE`                                |
| `ForceSuccess`     | —                                                                                         | `SUCCESS` once the child finishes                            |
| `ForceFailure`     | —                                                                                         | `FAILURE` once the child finishes                            |
| `FireAndForget`    | —                                                                                         | Starts the child and returns `SUCCESS` right away            |
| `RunningGate`      | —                                                                                         | Reports a running child as `FAILURE`                         |
| `Timeout`          | `timeoutSeconds` (number), `timeoutBehavior`: `"FAILURE"` or `"SUCCESS"`                  | Halts the child after a time limit                           |
| `Cooldown`         | `cooldownSeconds` (number), `resetOnHalt`: `"TRUE"` or `"FALSE"`                          | `FAILURE` for a while after the child finishes               |
| `Repeat`           | `repeatCount` (number), `repeatCondition`: `"ALWAYS"`, `"SUCCESS"` or `"FAILURE"`         | Runs the child N times                                       |
| `OneShot`          | `resetOnBecomeInactive`: `"TRUE"` or `"FALSE"`                                            | Runs the child once, then repeats its result                 |
| `Action`           | `actionName`: a name registered with `RegisterAction`                                     | Runs your action                                             |
| `Condition`        | `conditionName`: a name registered with `RegisterCondition`                               | Runs your condition                                          |
| `Callback`         | `callbackName`: a name registered with `RegisterCallback`                                 | Runs your callback, returns `SUCCESS`                        |
| `Wait`             | `duration` (number)                                                                       | `RUNNING` for N seconds, then `SUCCESS`                      |
| `WaitGate`         | `duration` (number)                                                                       | `FAILURE` until N seconds have passed, then `SUCCESS` once   |
| `Timer`            | `timerName`: a field registered with `RegisterField`                                      | Counts that field down; `SUCCESS` at zero                    |
| `Plug`             | `status`: `"SUCCESS"`, `"FAILURE"` or `"RUNNING"`                                         | Always returns that status                                   |
| `SubTree`          | `treeName`: a name registered with `RegisterSubTree`                                      | Inserts that sub-tree here                                   |

### Only in `"2.0.0"` files

| Node type                 | Parameters                                                                    | What it does                                          |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| `KeepRunningUntilSuccess` | `maxAttempts` (number, `-1` for unlimited)                                    | Retries the child until it succeeds                   |
| `KeepRunningUntilFailure` | `maxAttempts` (number, `-1` for unlimited)                                    | Retries the child until it fails                      |
| `TryCatch`                | —                                                                             | 2–3 children: try, catch, finally                     |
| `WasEntryUpdated`         | `entries`: comma-separated field names; `skipFirst`: `"TRUE"` or `"FALSE"`    | `SUCCESS` when any of those fields changed            |
| `Log`                     | `message` (string)                                                            | Prints the message, returns `SUCCESS`                 |
| `ForceRunning`            | —                                                                             | Always `RUNNING`; restarts the child when it finishes |
| `Scope`                   | `onEnter`, `onExit` (both optional): names registered with `RegisterCallback` | Calls them when its branch is entered and left        |

A callback used by `Scope` receives `0` as its `dt`.

### Only in `"1.0.0"` files

| Node type           | Parameters             | What it does                                |
| ------------------- | ---------------------- | ------------------------------------------- |
| `RetryUntilSuccess` | `maxAttempts` (number) | The 1.0.0 name of `KeepRunningUntilSuccess` |
| `RetryUntilFailure` | `maxAttempts` (number) | The 1.0.0 name of `KeepRunningUntilFailure` |

The node set is chosen by the **first** file you load into a `BTCreator`. To load files with different versions, use one creator per file.

## Sub-trees

`RegisterSubTree(name, factory)` lets a `SubTree` node insert a tree built elsewhere. The factory is called once for **each** `SubTree` node that uses the name, and must return **new** nodes every time, because a node object can only sit at one position of one tree.

To embed one baked file inside another, give the inner file its own creator and use `BuildRoot()`, which builds fresh nodes on every call:

```typescript
const combat = new BTCreator();
combat.RegisterAction("Swing", swing);
combat.LoadData(combatJson);

const creator = new BTCreator();
creator.RegisterSubTree("Combat", () => combat.BuildRoot());
creator.LoadData(mainJson);
const tree = creator.Build();
```

Only the outer creator's fields are registered on the built tree. If the inner file uses fields, pass the same map to both creators, for example `const target = creator.RegisterField("target")` and then `combat.RegisterField("target", target)`, so `RemoveAgent` clears it.

## Custom node types

Register your own node type with `AddNodeCreator(name, fn)`. A node in the JSON whose `name` matches is built by calling `fn`. The name must not be one of the built-in types.

```typescript
// A node with a string parameter: { "name": "Say", "children": [], "parameters": { "text": "hi" } }
creator.AddNodeCreator("Say", (c) => {
	const text = c.GetCurrentNodeParameter("text", "string");
	return BTree.Callback(() => print(text));
});

// A decorator: its child is already built
creator.AddNodeCreator("Invert", (c) => BTree.Inverter(c.GetCurrentChild()));
```

Children are built before their parent, so a creator can use them right away. Inside `fn`, the creator (`c`) gives access to the node being built:

| Method                                  | Returns                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `c.GetCurrentNodeParameter(name, type)` | A parameter as `"string"` or `"number"`; throws if missing or the wrong type |
| `c.GetCurrentNodeOptionalString(name)`  | A string parameter, or `undefined` if it is missing or empty                 |
| `c.GetCurrentChildren()`                | The node's built children, in order                                          |
| `c.GetCurrentChild()`                   | The first built child (for decorators)                                       |
| `c.GetField(name)`                      | A field registered with `RegisterField`                                      |
| `c.GetCurrentNodeId()`                  | The id of the node being built                                               |
| `c.GetCurrentNodeData()`                | The raw JSON of the node (`name`, `children`, `parameters`, `switch_case`)   |
| `c.GetCreatedNode(id)`                  | An already-built node, by id                                                 |

To make the type available in the visual editor, add it to the palette in `external/BTCreatorApp/frontend/src/Features/BehaviorTree/Resources/NodeTypes.ts`. [custom-nodes.md](custom-nodes.md#registering-a-node-with-btcreator) shows how to register nodes you wrote yourself.

## API reference

| Method                        | Description                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `new BTCreator(options?)`     | `options` go to every tree it builds, e.g. `{ external_ids: true }` for ECS ids                     |
| `LoadData(json)`              | Parses and checks the JSON string; throws if it is invalid                                          |
| `Build()`                     | Creates the nodes and returns a `BehaviorTree` with every registered field registered on it         |
| `BuildRoot()`                 | Creates the nodes and returns only the root node (for embedding as a sub-tree)                      |
| `RegisterAction(name, fn)`    | `fn: (slot, dt, tree) => status`, for `Action` nodes                                                |
| `RegisterCondition(name, fn)` | `fn: (slot, dt, tree) => boolean`, for `Condition` nodes                                            |
| `RegisterCallback(name, fn)`  | `fn: (slot, dt, tree) => void`, for `Callback` and `Scope` nodes                                    |
| `RegisterField(name, map?)`   | Registers a per-agent `Map<Slot, T>` under a name (creates one if you don't pass it) and returns it |
| `RegisterSelector(name, fn)`  | `fn: (slot, tree) => string \| undefined`, for `Switch` nodes                                       |
| `RegisterSubTree(name, fn)`   | `fn: () => Node`, for `SubTree` nodes                                                               |
| `AddNodeCreator(name, fn)`    | Registers a custom node type                                                                        |
| `GetNodeData(id)`             | The raw JSON of a node, by id                                                                       |

Each `Register...` method and `AddNodeCreator` throws if the name is already taken.

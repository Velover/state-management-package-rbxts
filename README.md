# @rbxts/state-management

AI and game-logic building blocks for [roblox-ts](https://roblox-ts.com/): finite state machines, behavior trees, goal-oriented action planning, and a shared blackboard.

## Installation

```bash
npm install @rbxts/state-management
# or
bun add @rbxts/state-management
```

## Which one do I need?

| If you want…                                                                                       | Use                                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| An entity with a few clear modes and explicit rules for switching (a door, a weapon, a simple NPC) | [FSM](docs/fsm.md)                     |
| NPC AI that reacts to its surroundings with priorities and fallbacks, for many NPCs at once        | [Behavior Tree](docs/behavior-tree.md) |
| Agents that work out for themselves which actions reach a goal                                     | [GOAP](docs/goap.md)                   |
| Behavior trees designed in a visual editor and loaded from JSON                                    | [BTCreator](docs/btcreator.md)         |
| A key-value store shared between states or systems                                                 | [Blackboard](docs/blackboard.md)       |

They combine: an FSM state, a behavior tree leaf or a GOAP action can each run one of the others (see the Connectors section of each guide).

## Quick start

A behavior tree for a guard that fights when it has a target and patrols otherwise. One tree serves every guard:

```typescript
import { BTree } from "@rbxts/state-management";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const RUNNING = BTree.ENodeStatus.RUNNING;
const targets = new Map<BTree.Slot, Model>();

const tree = new BTree.BehaviorTree(
	BTree.ReactiveFallback(
		BTree.ReactiveSequence(
			BTree.Condition((slot) => targets.has(slot)),
			BTree.Action((slot) => (moveToTarget(slot) ? SUCCESS : RUNNING)),
			BTree.Callback((slot) => hitTarget(slot)),
		),
		BTree.Sequence(
			BTree.Action((slot) => (walkToNextWaypoint(slot) ? SUCCESS : RUNNING)),
			BTree.Wait(2),
		),
	),
);
tree.RegisterField(targets);

const guard = tree.AddAgent(); // one agent per NPC
game.GetService("RunService").Heartbeat.Connect((dt) => tree.Tick(dt));
```

The [behavior tree guide](docs/behavior-tree.md) walks through this example step by step.

## Documentation

| Guide                                   | Export       | What's inside                                                                    |
| --------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| [Behavior Tree](docs/behavior-tree.md)  | `BTree`      | How behavior trees work, a first tree, every node, agents and per-agent data     |
| [Custom BT nodes](docs/custom-nodes.md) | `BTree`      | Writing your own composites and decorators, with tested examples                 |
| [BTCreator](docs/btcreator.md)          | `BTCreator`  | Building behavior trees from JSON: the file format, node types, registering code |
| [FSM](docs/fsm.md)                      | `FSM`        | States, condition / event / any-state transitions, priorities, nesting           |
| [GOAP](docs/goap.md)                    | `Goap`       | World state, actions, goals, how the agent plans and replans                     |
| [Blackboard](docs/blackboard.md)        | `Blackboard` | Typed and untyped ("wild") keys                                                  |

```typescript
import { BTree, BTCreator, FSM, Goap, Blackboard } from "@rbxts/state-management";
```

## BTCreator App

[external/BTCreatorApp](external/BTCreatorApp/) is the visual editor that produces the JSON files `BTCreator` loads (Wails + React). Run it with `wails dev` from that folder; its [baking docs](external/BTCreatorApp/docs/BakingSystem.md) describe the file format.

## Changelog

| Version                                                                              | Highlights                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [0.4.1](docs/Changelog/0-4-1.md)                                                     | BehaviorTree fixes: TickAgent with several agents, removal/halt re-entrancy, throwing hooks no longer disable the tree |
| [0.4.0](docs/Changelog/0-4-0.md)                                                     | BehaviorTree rewritten as a shared tree (10–30x faster, zero garbage); BTCreator and connectors updated (breaking)     |
| [0.3.6](docs/Changelog/0-3-6.md#036--new-nodes-plug-and-oneshot)                     | New `Plug` and `OneShot` BehaviorTree nodes; BTCreator versioned schema support                                        |
| [0.3.5](docs/Changelog/0-3-6.md#035--bug-fix-behaviortreehalt-incomplete-teardown)   | Fixed `BehaviorTree.Halt()` not cleaning up all running/active nodes                                                   |
| [0.3.4](docs/Changelog/0-3-6.md#034--btcreator-versioned-schemas)                    | BTCreator versioned node loading (`1.0.0` / `2.0.0` schemas)                                                           |
| [0.3.3](docs/Changelog/0-3-6.md#033--new-node-wasentryupdated)                       | New `WasEntryUpdated` node — blackboard change detection                                                               |
| [0.3.2](docs/Changelog/0-3-6.md#032--fullaction--ifullactionconfig-naming-alignment) | `IFullActionConfig` key renames to match lifecycle API                                                                 |
| [0.3.1](docs/Changelog/0-3-6.md#031--bug-fix-max-attempts-semantics)                 | Fixed `KeepRunningUntilSuccess/Failure` max attempts logic                                                             |
| [0.3.0](docs/Changelog/0-3-0.md)                                                     | BehaviorTree lifecycle refactor; FSM `ForceSetState` & any-event transitions; separate docs                            |

## License

MIT

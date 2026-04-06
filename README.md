# @rbxts/state-management

A comprehensive state management library for [roblox-ts](https://roblox-ts.com/). Provides modular, type-safe primitives for building AI and game logic: finite state machines, behavior trees, goal-oriented action planning, and a shared blackboard.

## Installation

```bash
npm install @rbxts/state-management
# or
bun add @rbxts/state-management
```

## Modules

```
docs/
├── blackboard.md      — Key-value store shared across AI systems
├── fsm.md             — Finite State Machine with priority transitions and events
├── behavior-tree.md   — Behavior Tree nodes, composites, decorators, and lifecycle
├── goap.md            — Goal Oriented Action Planning with A* planner
└── btcreator.md       — Data-driven BehaviorTree builder from JSON
```

| Module                                 | Export       | Description                                                                  |
| -------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| [Blackboard](docs/blackboard.md)       | `Blackboard` | Typed + untyped key-value store for sharing data between systems             |
| [FSM](docs/fsm.md)                     | `FSM`        | Finite state machine with condition, event, and any-state transitions        |
| [Behavior Tree](docs/behavior-tree.md) | `BTree`      | 20+ node types — composites, decorators, leaves, and cross-system connectors |
| [GOAP](docs/goap.md)                   | `Goap`       | A\*-based action planner with hierarchical goals and weighted requirements   |
| [BTCreator](docs/btcreator.md)         | `BTCreator`  | Build behavior trees from JSON with a registry-based node factory            |

## Quick Start

```typescript
import { BTree, FSM, Goap, Blackboard, BTCreator } from "@rbxts/state-management";
```

## Changelog

| Version                                                                              | Highlights                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [0.3.6](docs/Changelog/0-3-6.md#036--new-nodes-plug-and-oneshot)                     | New `Plug` and `OneShot` BehaviorTree nodes; BTCreator versioned schema support             |
| [0.3.5](docs/Changelog/0-3-6.md#035--bug-fix-behaviortreehalt-incomplete-teardown)   | Fixed `BehaviorTree.Halt()` not cleaning up all running/active nodes                        |
| [0.3.4](docs/Changelog/0-3-6.md#034--btcreator-versioned-schemas)                    | BTCreator versioned node loading (`1.0.0` / `2.0.0` schemas)                                |
| [0.3.3](docs/Changelog/0-3-6.md#033--new-node-wasentryupdated)                       | New `WasEntryUpdated` node — blackboard change detection                                    |
| [0.3.2](docs/Changelog/0-3-6.md#032--fullaction--ifullactionconfig-naming-alignment) | `IFullActionConfig` key renames to match lifecycle API                                      |
| [0.3.1](docs/Changelog/0-3-6.md#031--bug-fix-max-attempts-semantics)                 | Fixed `KeepRunningUntilSuccess/Failure` max attempts logic                                  |
| [0.3.0](docs/Changelog/0-3-0.md)                                                     | BehaviorTree lifecycle refactor; FSM `ForceSetState` & any-event transitions; separate docs |

## License

MIT

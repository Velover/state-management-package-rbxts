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

## License

MIT

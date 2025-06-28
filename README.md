# @rbxts/state-management

A comprehensive state management library for [roblox-ts](https://roblox-ts.com/), featuring:

- **Finite State Machines (FSM)**: Manage discrete states and transitions.
- **Behavior Trees (BT)**: Create complex, hierarchical AI behaviors.
- **Goal Oriented Action Planning (GOAP)**: Implement intelligent agents that can plan sequences of actions to achieve goals.
- **Blackboard**: A shared data-storage system for communication between different AI components or systems.

## Features

- **Modular Design**: Use FSMs, BTs, GOAP, and Blackboards independently or together.
- **Type-Safe**: Leverages TypeScript for robust and maintainable code.
- **Extensible**: Easily create custom states, nodes, actions, and goals.
- **Connectors**: Seamlessly integrate FSMs with Behavior Trees or GOAP agents, and vice versa.
- **Performance Optimized**: Native compilation support with optimize pragmas.
- **Enhanced GOAP**: Hierarchical goals, weighted requirements, and composite goal support.
- **Rich Behavior Tree Nodes**: Extended set of composite, decorator, and utility nodes.

## Installation

1.  Install the package using npm or yarn:

    ```bash
    npm install @rbxts/state-management
    # or
    bun add @rbxts/state-management
    ```

2.  Ensure your `tsconfig.json` includes the necessary paths if you're using it in a roblox-ts project.

## Usage

### Blackboard

The `Blackboard` is a key-value store that can be used to share data between different parts of your AI or game logic.

```typescript
import { Blackboard } from "@rbxts/state-management";

// Define a type for your blackboard data (optional but recommended)
interface MyAgentBlackboard {
	health: number;
	target?: Instance;
	isAlert: boolean;
}

// Create a blackboard with initial data
const blackboard = new Blackboard<MyAgentBlackboard>({
	health: 100,
	isAlert: false,
});

// Set values
blackboard.Set("health", 90);
blackboard.Set("target", game.Workspace.FindFirstChild("Enemy"));

// Get values
const currentHealth = blackboard.Get("health");
print(currentHealth); // 90

// Use wild keys for dynamic data
blackboard.SetWild("lastKnownPosition", new Vector3(10, 0, 5));
const pos = blackboard.GetWild<Vector3>("lastKnownPosition");

// Update values with callbacks
const newHealth = blackboard.UpdateWild<number>("health", (current) => (current ?? 100) - 10);
print(newHealth); // 80
```

### Finite State Machine (FSM)

FSMs are used to manage an entity's state and transitions between states.

```typescript
import { FSM, Blackboard } from "@rbxts/state-management";

// Define some states
class IdleState implements FSM.IFSMState {
	OnEnter(bb: Blackboard) {
		print("Entering Idle State");
	}
	Update(dt: number, bb: Blackboard) {
		/* Idle logic */
	}
	OnExit(bb: Blackboard) {
		print("Exiting Idle State");
	}
}

class PatrolState implements FSM.IFSMState {
	OnEnter(bb: Blackboard) {
		print("Entering Patrol State");
	}
	Update(dt: number, bb: Blackboard) {
		/* Patrol logic */
	}
	OnExit(bb: Blackboard) {
		print("Exiting Patrol State");
	}
}

const blackboard = new Blackboard({ enemySpotted: false });
const fsm = new FSM.FSM("Idle", blackboard);

fsm.RegisterState("Idle", new IdleState());
fsm.RegisterState("Patrol", new PatrolState());

// Add transitions
fsm.AddTransition("Idle", "Patrol", 1, (bb) => {
	return bb.Get("enemySpotted") === true;
});

fsm.AddTransition("Patrol", "Idle", 1, (bb) => {
	return bb.Get("enemySpotted") === false;
});

fsm.Start();

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	fsm.Update(dt);
});
```

### Behavior Tree (BT)

Behavior Trees allow for creating complex, hierarchical behaviors with enhanced node types.

```typescript
import { BTree, Blackboard } from "@rbxts/state-management";

const blackboard = new Blackboard({
	hasTarget: false,
	energyLevel: 100,
	cooldownTimer: 0,
});

// Create a behavior tree with enhanced nodes
const root = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("hasTarget") === true))
	.AddChild(
		new BTree.Cooldown(
			new BTree.Action((bb) => {
				print("Attacking target!");
				bb.Set("energyLevel", bb.Get("energyLevel") - 10);
				return BTree.ENodeStatus.SUCCESS;
			}),
			2.0, // 2 second cooldown
		),
	);

// Enhanced parallel execution
const patrolBehavior = new BTree.Parallel(
	BTree.EParallelPolicy.ONE, // Success policy: one child succeeds
	BTree.EParallelPolicy.ONE, // Failure policy: one child fails
)
	.AddChild(
		new BTree.Action((bb) => {
			// Patrol movement logic
			return BTree.ENodeStatus.RUNNING;
		}),
	)
	.AddChild(new BTree.Condition((bb) => bb.Get("hasTarget") === true));

const behaviorTree = new BTree.BehaviorTree(root, blackboard);

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	behaviorTree.Tick(dt);
});
```

### Goal Oriented Action Planning (GOAP)

Enhanced GOAP with hierarchical goals, weighted requirements, and improved planning.

```typescript
import { Goap, Blackboard } from "@rbxts/state-management";

// Define a world state with typed support
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

// Define actions with enhanced features
class PickupWeaponAction extends Goap.Action {
	GetStaticEffects() {
		return new Map<string, Goap.Effect>().set("hasWeapon", Goap.Effect.Set(true));
	}
	GetStaticRequirements() {
		return new Map<string, Goap.Requirement>().set("isSafe", Goap.Comparison.Is()); // Only pick up when safe
	}
	GetCost() {
		return 1;
	}

	protected OnTick() {
		print("Picking up weapon...");
		// Simulate time to pick up
		return Goap.EActionStatus.SUCCESS;
	}
}

class AttackEnemyAction extends Goap.Action {
	GetStaticEffects() {
		return new Map<string, Goap.Effect>()
			.set("enemyVisible", Goap.Effect.Set(false))
			.set("isSafe", Goap.Effect.Set(true));
	}
	GetStaticRequirements() {
		return new Map<string, Goap.Requirement>()
			.set("hasWeapon", Goap.Comparison.Is())
			.set("enemyVisible", Goap.Comparison.Is());
	}
	GetCost() {
		return 2;
	}

	protected OnTick() {
		print("Attacking enemy...");
		return Goap.EActionStatus.SUCCESS;
	}
}

// Enhanced goals with weighted requirements and dynamic priorities
const combatGoal = new Goap.Goal("Combat", (worldState, agent) => {
	// Dynamic priority based on world state
	const enemyVisible = worldState.GetWild<boolean>("enemyVisible");
	return enemyVisible ? 20 : 5;
})
	.AddRequirement("enemyVisible", Goap.Comparison.IsNot(), 3) // Weight: 3
	.AddRequirement("isSafe", Goap.Comparison.Is(), 1); // Weight: 1

// Hierarchical goal support
const survivalGoal = new Goap.Goal("Survival", 15, true) // Composite goal
	.AddSubGoal(new Goap.Goal("GetWeapon", 10).AddRequirement("hasWeapon", Goap.Comparison.Is()))
	.AddSubGoal(combatGoal);

// Create agent with enhanced features
const agent = new Goap.Agent(
	worldState,
	[new PickupWeaponAction(), new AttackEnemyAction()],
	[survivalGoal, combatGoal],
);

// Enhanced effects with clamping and default values
worldState.SetWild("playerHealth", 100);
const healthEffect = Goap.Effect.DecrementClamp(10, 0, 100);
const newHealth = healthEffect(worldState.GetWild("playerHealth"));

game.GetService("RunService").Heartbeat.Connect((dt) => {
	// Simulate world changes
	if (math.random() < 0.01) {
		worldState.SetWild("enemyVisible", true);
	}

	agent.Update(dt);
});
```

## Enhanced Features

### Behavior Tree Enhancements

- **Timer Node**: `Timer` - Manages countdown timers stored in blackboard.
- **Enhanced Parallel**: Uses `EParallelPolicy` enum for clearer success/failure policies.
- **Improved Cooldown**: `Cooldown` decorator with configurable reset behavior.
- **Memory Sequences**: Better state management for interrupted sequences.

### GOAP Enhancements

- **Typed WorldState**: Generic support for typed world state data.
- **Weighted Requirements**: Goals can have weighted requirements for better planning.
- **Hierarchical Goals**: Composite goals that decompose into sub-goals.
- **Dynamic Priorities**: Goal priorities can be functions of world state and agent.
- **Enhanced Effects**: New effects like `IncrementClamp`, `DecrementClamp` with bounds.
- **Performance Optimization**: Improved planning algorithms and state management.

### Cross-System Integration

- **FSMConnector**: Use FSMs within GOAP actions or Behavior Tree nodes.
- **BTConnector**: Embed Behavior Trees in GOAP actions.
- **GoapConnector**: Run GOAP agents as Behavior Tree nodes or FSM states.

## Modules

- **`Blackboard`**: Enhanced data store with update callbacks and type safety.
- **`FSM`**: Complete finite state machine with priority-based transitions.
- **`BTree`**: Comprehensive behavior tree implementation with 20+ node types.
- **`Goap`**: Advanced goal-oriented action planning with hierarchical goals.

## Performance

This library is optimized for Roblox with:

- Native compilation hints (`//native`, `//optimize 2`)
- Efficient data structures and algorithms
- Minimal garbage collection impact
- Optimized A\* pathfinding for GOAP planning

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.

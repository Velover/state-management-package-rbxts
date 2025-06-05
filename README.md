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
- **Connectors**: Seamlessly integrate FSMs with Behavior Trees or GOAP agents, and Behavior Trees with FSMs or GOAP agents.

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

const target = blackboard.Get("target");
if (target) {
	print(`Target is ${target.Name}`);
}

// Use wild keys for dynamic data
blackboard.SetWild("lastKnownPosition", new Vector3(10, 0, 5));
const pos = blackboard.GetWild<Vector3>("lastKnownPosition");
print(pos);
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
fsm.AddTransition("Idle", "Patrol", 1, () => {
	// Condition to transition from Idle to Patrol
	return blackboard.Get("enemySpotted") === true;
});

fsm.AddTransition("Patrol", "Idle", 1, () => {
	// Condition to transition from Patrol to Idle
	return blackboard.Get("enemySpotted") === false;
});

fsm.Start();

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	// Example: Spot an enemy
	// blackboard.Set("enemySpotted", true);
	fsm.Update(dt);
});
```

### Behavior Tree (BT)

Behavior Trees allow for creating complex, hierarchical behaviors.

```typescript
import { BTree, Blackboard } from "@rbxts/state-management";

const blackboard = new Blackboard({ hasTarget: false, energyLevel: 100 });

// Create a simple behavior tree
const root = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("hasTarget") === true))
	.AddChild(
		new BTree.Action((bb) => {
			print("Attacking target!");
			bb.Set("energyLevel", bb.Get("energyLevel") - 10);
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

const behaviorTree = new BTree.BehaviorTree(root, blackboard);

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	// Example: Aquire a target
	// blackboard.Set("hasTarget", true);
	behaviorTree.Tick(dt);
});
```

### Goal Oriented Action Planning (GOAP)

GOAP allows agents to create plans to achieve goals based on the current world state and available actions.

```typescript
import { Goap, Blackboard } from "@rbxts/state-management";

// Define a world state
const worldState = new Goap.WorldState(
	{},
	{
		hasWeapon: false,
		enemyVisible: false,
		isSafe: true,
	},
);

// Define actions
class PickupWeaponAction extends Goap.Action {
	GetStaticEffects() {
		return new Map<string, Goap.Effect>().set("hasWeapon", Goap.Effect.Set(true));
	}
	GetStaticRequirements() {
		return new Map<string, Goap.Requirement>(); // No specific requirements to pick up
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
		// Example: could set enemyHealth, or enemyIsDead
		return new Map<string, Goap.Effect>().set("enemyVisible", Goap.Effect.Set(false));
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

// Define goals
const killEnemyGoal = new Goap.Goal("KillEnemy", 10).AddRequirement(
	"enemyVisible",
	Goap.Comparison.IsNot(),
); // Goal is to make enemy not visible (defeated)

// Create agent
const agent = new Goap.Agent(
	worldState,
	[new PickupWeaponAction(), new AttackEnemyAction()],
	[killEnemyGoal],
);

// Simulate world changes and update agent
// worldState.SetWild("enemyVisible", true); // Enemy appears

game.GetService("RunService").Heartbeat.Connect((dt) => {
	agent.Update(dt);
	// worldState changes can happen here, e.g., enemy becomes visible
	// worldState.SetWild("enemyVisible", true);
});
```

## Modules

- **`Blackboard`**: A flexible data store.
- **`FSM`**:
  - `FSM`: The main state machine class.
  - `IFSMState`: Interface for states.
  - `BehaviorTreeConnector`: An FSM state that runs a Behavior Tree.
  - `GOAPConnector`: An FSM state that runs a GOAP Agent.
- **`BTree`**:
  - `Node`, `Composite`, `Decorator`: Base classes for tree nodes.
  - `Sequence`, `ReactiveSequence`, `MemorySequence`: Execute children sequentially.
  - `Fallback`, `MemoryFallback`, `ReactiveFallback`: Execute children until one succeeds.
  - `Parallel`: Execute children concurrently.
  - `Inverter`, `ForceSuccess`, `ForceFailure`, `Timeout`, `RetryUntilSuccess`, `RetryUntilFailure`, `Repeat`, `Cooldown`: Decorator nodes.
  - `Action`, `Condition`: Leaf nodes for performing actions and checking conditions.
  - `IfThenElse`, `WhileDoElse`, `Switch`: Control flow nodes.
  - `Wait`: Pauses execution.
  - `SubTree`: Embed another Behavior Tree.
  - `FSMConnector`: A Behavior Tree node that runs an FSM.
  - `GoapConnector`: A Behavior Tree node that runs a GOAP Agent.
  - `BehaviorTree`: The main Behavior Tree runner.
- **`Goap`**:
  - `WorldState`: Represents the state of the world.
  - `Goal`: Defines what an agent wants to achieve.
  - `Action`: Defines an operation an agent can perform.
  - `Planner`: Creates plans (sequences of actions) to achieve goals.
  - `Agent`: Manages goals, actions, and executes plans.
  - `Comparison`, `Effect`: Utility functions for defining requirements and effects.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License.

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
		// Idle logic
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
		// Patrol logic - move between waypoints
		const currentWaypoint = bb.GetWild<number>("currentWaypoint") ?? 0;
		// ... patrol movement logic
	}
	OnExit(bb: Blackboard) {
		print("Exiting Patrol State");
	}
}

class AlertState implements FSM.IFSMState {
	OnEnter(bb: Blackboard) {
		print("Entering Alert State");
		bb.SetWild("alertTime", 5.0); // Alert for 5 seconds
	}
	Update(dt: number, bb: Blackboard) {
		const alertTime = bb.UpdateWild<number>("alertTime", (current) => (current ?? 0) - dt);
		if (alertTime <= 0) {
			bb.SetWild("alertFinished", true);
		}
	}
	OnExit(bb: Blackboard) {
		print("Exiting Alert State");
		bb.SetWild("alertFinished", false);
	}
}

const blackboard = new Blackboard({ enemySpotted: false });
const fsm = new FSM.FSM("Idle", blackboard);

fsm.RegisterState("Idle", new IdleState());
fsm.RegisterState("Patrol", new PatrolState());
fsm.RegisterState("Alert", new AlertState());

// Regular condition-based transitions (checked every frame)
fsm.AddTransition("Idle", "Patrol", 1, (bb) => {
	return bb.GetWild<boolean>("enemySpotted") === false;
});

fsm.AddTransition("Alert", "Idle", 1, (bb) => {
	return bb.GetWild<boolean>("alertFinished") === true;
});

// Event-based transitions (triggered by specific events)
fsm.AddEventTransition("Idle", "Alert", "enemySighted", 1);
fsm.AddEventTransition("Patrol", "Alert", "enemySighted", 1);

// Any-state transitions (can trigger from any state)
fsm.AddAnyTransition("Alert", 2, (bb) => {
	return bb.GetWild<boolean>("emergencyAlert") === true;
});

// Start the FSM
fsm.Start();

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	fsm.Update(dt);
});

// Trigger events when specific conditions are met
game.GetService("UserInputService").InputBegan.Connect((input) => {
	if (input.KeyCode === Enum.KeyCode.E) {
		// Simulate enemy sighting
		fsm.HandleEvent("enemySighted");
	}
});
```

#### FSM Transition Types

The FSM supports three types of transitions:

1. **Condition Transitions**: Checked every frame during Update()

   ```typescript
   fsm.AddTransition("FromState", "ToState", priority, (bb) => {
   	return bb.Get("someCondition") === true;
   });
   ```

2. **Event Transitions**: Triggered by specific events

   ```typescript
   fsm.AddEventTransition("FromState", "ToState", "eventName", priority, (bb) => {
   	// Optional condition - if omitted, event always triggers transition
   	return bb.Get("canTransition") === true;
   });

   // Later, trigger the event
   fsm.HandleEvent("eventName");
   ```

3. **Any-State Transitions**: Can trigger from any current state
   ```typescript
   fsm.AddAnyTransition("ToState", priority, (bb) => {
   	return bb.Get("globalCondition") === true;
   });
   ```

#### FSM Features

- **Priority-based transitions**: Higher priority transitions are checked first
- **Event-driven state changes**: Use `HandleEvent()` for immediate state changes
- **Conditional transitions**: All transition types support optional conditions
- **Blackboard integration**: Share data between states using the blackboard
- **State lifecycle**: `OnEnter()`, `Update()`, and `OnExit()` methods for each state

### Behavior Tree (BT)

Behavior Trees allow for creating complex, hierarchical behaviors with an extensive set of nodes and advanced features.

#### Basic Behavior Tree Example

```typescript
import { BTree, Blackboard } from "@rbxts/state-management";

const blackboard = new Blackboard({
	hasTarget: false,
	energyLevel: 100,
	isPatrolling: false,
	alertLevel: 0,
});

// Create composite nodes for complex behaviors
const findTargetSequence = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("energyLevel") > 20))
	.AddChild(
		new BTree.Action((bb) => {
			print("Searching for target...");
			// Simulate target detection
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
		// Cooldown decorator prevents spamming attacks
		new BTree.Cooldown(
			new BTree.Action((bb) => {
				print("Attacking target!");
				bb.Set("energyLevel", bb.Get("energyLevel") - 10);
				bb.Set("hasTarget", false); // Target defeated
				return BTree.ENodeStatus.SUCCESS;
			}),
			2.0, // 2 second cooldown
		),
	);

// Main behavior with fallback between different strategies
const mainBehavior = new BTree.Fallback()
	.AddChild(attackSequence)
	.AddChild(findTargetSequence)
	.AddChild(
		new BTree.Action((bb) => {
			print("Idling...");
			bb.Set("energyLevel", bb.Get("energyLevel") + 1);
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

const behaviorTree = new BTree.BehaviorTree(mainBehavior, blackboard);

// In your game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	behaviorTree.Tick(dt);
});
```

#### Advanced Behavior Tree Features

```typescript
// Enhanced Parallel execution with policies
const combatBehavior = new BTree.Parallel(
	BTree.EParallelPolicy.ONE, // Success when one child succeeds
	BTree.EParallelPolicy.ALL, // Failure when all children fail
)
	.AddChild(
		// Monitor for threats while doing other actions
		new BTree.Action((bb) => {
			if (bb.GetWild<number>("alertLevel", 0) > 50) {
				bb.SetWild("emergencyRetreat", true);
				return BTree.ENodeStatus.SUCCESS;
			}
			return BTree.ENodeStatus.RUNNING;
		}),
	)
	.AddChild(
		// Main combat actions
		new BTree.Sequence().AddChild(new BTree.Condition((bb) => bb.Get("hasTarget"))).AddChild(
			new BTree.Action((bb) => {
				print("Engaging in combat!");
				return BTree.ENodeStatus.SUCCESS;
			}),
		),
	);

// Conditional execution with IfThenElse
const tacticalDecision = new BTree.IfThenElse()
	.AddChild(new BTree.Condition((bb) => bb.Get("energyLevel") > 50)) // Condition
	.AddChild(
		// Then: Aggressive strategy
		new BTree.Action((bb) => {
			print("Using aggressive tactics");
			return BTree.ENodeStatus.SUCCESS;
		}),
	)
	.AddChild(
		// Else: Defensive strategy
		new BTree.Action((bb) => {
			print("Using defensive tactics");
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

// Enhanced retry mechanisms
const robustAction = new BTree.RetryUntilSuccess(
	new BTree.Action((bb) => {
		// Action that might fail but should be retried
		if (math.random() > 0.3) {
			print("Action succeeded!");
			return BTree.ENodeStatus.SUCCESS;
		}
		print("Action failed, retrying...");
		return BTree.ENodeStatus.FAILURE;
	}),
	5, // Max 5 attempts
);

// Timer-based behaviors
const patrolWithTimeout = new BTree.Timeout(
	new BTree.Action((bb) => {
		print("Patrolling...");
		return BTree.ENodeStatus.RUNNING; // Continues until timeout
	}),
	10.0, // 10 second timeout
	BTree.ETimeoutBehavior.SUCCESS, // Succeed when timeout occurs
);

// Switch node for state-based decisions
const weaponSwitch = new BTree.Switch<string>("currentWeapon")
	.Case(
		"sword",
		new BTree.Action((bb) => {
			print("Using sword combat");
			return BTree.ENodeStatus.SUCCESS;
		}),
	)
	.Case(
		"bow",
		new BTree.Action((bb) => {
			print("Using ranged combat");
			return BTree.ENodeStatus.SUCCESS;
		}),
	)
	.Default(
		new BTree.Action((bb) => {
			print("Using unarmed combat");
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

// Repeat with conditions
const patrolLoop = new BTree.Repeat(
	new BTree.Sequence()
		.AddChild(
			new BTree.Action((bb) => {
				print("Moving to next waypoint");
				return BTree.ENodeStatus.SUCCESS;
			}),
		)
		.AddChild(new BTree.Wait(2.0)), // Wait 2 seconds at each waypoint
	5, // Repeat 5 times
	BTree.ERepeatCondition.SUCCESS, // Only repeat on success
);

// Timer node for countdown mechanics
const alertTimer = new BTree.Timer<{ alertTimeLeft: number }>("alertTimeLeft");

// WhileDoElse for continuous monitoring
const guardBehavior = new BTree.WhileDoElse()
	.AddChild(new BTree.Condition((bb) => bb.GetWild<boolean>("onDuty", true))) // While on duty
	.AddChild(
		// Do: Guard actions
		new BTree.Sequence()
			.AddChild(
				new BTree.Action((bb) => {
					print("Patrolling area");
					return BTree.ENodeStatus.SUCCESS;
				}),
			)
			.AddChild(new BTree.Wait(3.0)),
	)
	.AddChild(
		// Else: Off duty actions
		new BTree.Action((bb) => {
			print("Taking a break");
			return BTree.ENodeStatus.SUCCESS;
		}),
	);
```

#### Node Lifecycle and Active Node Tracking

```typescript
// Custom node with full lifecycle
class CustomPatrolNode extends BTree.Node {
	protected OnStart(bb: Blackboard): BTree.ENodeStatus {
		print("Starting patrol");
		bb.SetWild("patrolStartTime", tick());
		return BTree.ENodeStatus.RUNNING;
	}

	protected OnTick(dt: number, bb: Blackboard): BTree.ENodeStatus {
		const elapsed = tick() - bb.GetWild<number>("patrolStartTime", 0);
		print(`Patrolling for ${elapsed} seconds`);

		if (elapsed > 10) {
			return BTree.ENodeStatus.SUCCESS;
		}
		return BTree.ENodeStatus.RUNNING;
	}

	protected OnFinish(status: BTree.ENodeStatus, bb: Blackboard): void {
		print(`Patrol finished with status: ${status}`);
		bb.SetWild("patrolEndTime", tick());
	}

	protected OnHalt(bb: Blackboard): void {
		print("Patrol was interrupted");
		bb.SetWild("patrolInterrupted", true);
	}

	public OnActivated(bb: Blackboard): void {
		print("Patrol node activated");
	}

	public OnDeactivated(bb: Blackboard): void {
		print("Patrol node deactivated");
	}
}

// Track active nodes for debugging
const behaviorTree = new BTree.BehaviorTree(mainBehavior, blackboard);

game.GetService("RunService").Heartbeat.Connect((dt) => {
	const status = behaviorTree.Tick(dt);
	const activeNodes = behaviorTree.GetActiveNodes();
	print(`Active nodes: ${activeNodes.size()}, Tree status: ${status}`);
});
```

#### Cross-System Integration with Connectors

```typescript
// Embed FSM within Behavior Tree
const fsmConnector = new BTree.FSMConnector(guardFSM);

const guardWithFSM = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("shouldActivateGuard")))
	.AddChild(fsmConnector); // FSM runs as a behavior tree node

// Embed GOAP agent within Behavior Tree
const goapConnector = new BTree.GoapConnector(combatAgent);

const tacticalBehavior = new BTree.Fallback()
	.AddChild(goapConnector) // GOAP planning for complex scenarios
	.AddChild(
		// Fallback to simple behavior if GOAP fails
		new BTree.Action((bb) => {
			print("Using simple fallback behavior");
			return BTree.ENodeStatus.SUCCESS;
		}),
	);

// SubTree for modular behavior composition
const combatSubTree = new BTree.BehaviorTree(combatBehavior, blackboard);
const mainBehaviorWithSubTree = new BTree.Sequence()
	.AddChild(new BTree.Condition((bb) => bb.Get("inCombat")))
	.AddChild(new BTree.SubTree(combatSubTree));
```

#### Enhanced Decorators

```typescript
// Force nodes to always succeed or fail
const alwaysSucceed = new BTree.ForceSuccess(
	new BTree.Action((bb) => {
		// This might fail, but ForceSuccess ensures SUCCESS
		return math.random() > 0.5 ? BTree.ENodeStatus.SUCCESS : BTree.ENodeStatus.FAILURE;
	}),
);

// Fire and forget for side effects
const logAction = new BTree.FireAndForget(
	new BTree.Action((bb) => {
		print("This action runs but its result is ignored");
		return BTree.ENodeStatus.FAILURE; // Result ignored
	}),
);

// Invert results
const invertedCondition = new BTree.Inverter(
	new BTree.Condition((bb) => bb.Get("enemyNearby")), // Returns true when enemy NOT nearby
);

// Callback for simple side effects
const simpleCallback = new BTree.Callback((bb, dt) => {
	bb.SetWild("lastUpdateTime", tick());
	print("Callback executed");
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
		return new Map<string, Goap.Effect>([["hasWeapon", Goap.Effect.Set(true)]]);
	}

	GetStaticRequirements() {
		return new Map<string, Goap.Requirement>([
			["isSafe", Goap.Comparison.Is()], // Only pick up when safe
		]);
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

### FSM Enhancements

- **Event Transitions**: Trigger state changes with specific events using `AddEventTransition()` and `HandleEvent()`
- **Any-State Transitions**: Global transitions that can trigger from any state
- **Priority System**: Higher priority transitions are evaluated first
- **Conditional Events**: Event transitions can include optional conditions
- **State Lifecycle**: Complete OnEnter/Update/OnExit lifecycle for all states

### Behavior Tree Enhancements

- **Complete Node Set**: 20+ node types including advanced composites, decorators, and utility nodes
- **Node Lifecycle**: Full `OnStart()`, `OnTick()`, `OnFinish()`, `OnHalt()`, `OnActivated()`, `OnDeactivated()` lifecycle
- **Active Node Tracking**: Monitor which nodes are currently active for debugging and analysis
- **Enhanced Parallel**: Configurable success/failure policies with `EParallelPolicy`
- **Advanced Decorators**: `Timeout`, `Cooldown`, `Retry`, `Inverter`, `ForceSuccess/Failure`, and more
- **Control Flow Nodes**: `IfThenElse`, `WhileDoElse`, `Switch`, `Repeat` for complex logic
- **Timer Management**: `Timer` and `Wait` nodes for time-based behaviors
- **Memory Sequences**: Better state management for interrupted sequences
- **SubTree Support**: Compose behaviors from multiple behavior trees

### GOAP Enhancements

- **Typed WorldState**: Generic support for typed world state data
- **Weighted Requirements**: Goals can have weighted requirements for better planning
- **Hierarchical Goals**: Composite goals that decompose into sub-goals
- **Dynamic Priorities**: Goal priorities can be functions of world state and agent
- **Enhanced Effects**: New effects like `IncrementClamp`, `DecrementClamp` with bounds
- **Performance Optimization**: Improved planning algorithms and state management

### Cross-System Integration

- **FSMConnector**: Use FSMs within GOAP actions or Behavior Tree nodes
- **BTConnector**: Embed Behavior Trees in GOAP actions
- **GoapConnector**: Run GOAP agents as Behavior Tree nodes or FSM states
- **SubTree**: Compose complex behaviors from multiple behavior trees

## Modules

- **`Blackboard`**: Enhanced data store with update callbacks and type safety
- **`FSM`**: Complete finite state machine with priority-based transitions
- **`BTree`**: Comprehensive behavior tree implementation with 20+ node types
- **`Goap`**: Advanced goal-oriented action planning with hierarchical goals

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

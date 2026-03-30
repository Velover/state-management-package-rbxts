# Finite State Machine (FSM)

The `FSM` manages an entity's discrete states and transitions between them. It supports condition-based transitions, event-driven transitions, any-state transitions, and priority ordering.

## Basic Usage

```typescript
import { FSM, Blackboard } from "@rbxts/state-management";

// Define states by implementing IFSMState
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
		bb.SetWild("alertTime", 5.0);
	}
	Update(dt: number, bb: Blackboard) {
		const alertTime = bb.UpdateWild<number>("alertTime", (current) => (current ?? 0) - dt);
		if (alertTime <= 0) bb.SetWild("alertFinished", true);
	}
	OnExit(bb: Blackboard) {
		bb.SetWild("alertFinished", false);
	}
}

const blackboard = new Blackboard({ enemySpotted: false });
const fsm = new FSM.FSM("Idle", blackboard);

fsm.RegisterState("Idle", new IdleState());
fsm.RegisterState("Patrol", new PatrolState());
fsm.RegisterState("Alert", new AlertState());

fsm.Start();

// Game loop
game.GetService("RunService").Heartbeat.Connect((dt) => {
	fsm.Update(dt);
});
```

## Transition Types

### 1. Condition Transitions

Checked every frame during `Update()`. The first passing transition (by priority) wins.

```typescript
fsm.AddTransition("Idle", "Patrol", 1, (bb) => {
	return bb.GetWild<boolean>("enemySpotted") === false;
});

fsm.AddTransition("Alert", "Idle", 1, (bb) => {
	return bb.GetWild<boolean>("alertFinished") === true;
});
```

### 2. Event Transitions

Triggered explicitly by calling `HandleEvent()`. Useful for immediate reactions to game events.

```typescript
// Register the transition
fsm.AddEventTransition("Idle", "Alert", "enemySighted", 1);
fsm.AddEventTransition("Patrol", "Alert", "enemySighted", 1);

// Optional condition
fsm.AddEventTransition("Alert", "Flee", "damageTaken", 1, (bb) => {
	return (bb.GetWild<number>("health") ?? 100) < 20;
});

// Trigger the event
fsm.HandleEvent("enemySighted");
```

### 3. Any-State Transitions

Can trigger from any currently active state. Useful for global interrupts.

```typescript
fsm.AddAnyTransition("Alert", 2, (bb) => {
	return bb.GetWild<boolean>("emergencyAlert") === true;
});

fsm.AddAnyEventTransition("Dead", "killed", 10);
```

## Force State Change

Use `ForceSetState()` to immediately jump to a state, bypassing transition conditions. Safe to call from inside `Update()` — it will be applied at the end of the current tick.

```typescript
fsm.ForceSetState("Idle");
```

## Binding Callbacks

You can bind global callbacks on the FSM object itself (useful when the FSM is used as a nested state inside another FSM):

```typescript
fsm.BindOnEnter((bb) => print("FSM entered"));
fsm.BindOnExit((bb) => print("FSM exited"));
fsm.BindUpdate((dt, bb) => print("FSM updating"));
```

## Connectors

### BehaviorTreeConnector

Embed a `BehaviorTree` as an FSM state:

```typescript
const btConnector = new FSM.BehaviorTreeConnector(myBehaviorTree);
fsm.RegisterState("Combat", btConnector);
```

### GOAPConnector

Embed a GOAP `Agent` as an FSM state:

```typescript
const goapConnector = new FSM.GOAPConnector(myGoapAgent);
fsm.RegisterState("Planning", goapConnector);
```

## API Reference

| Method                                                      | Description                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `RegisterState(name, state)`                                | Register a state implementation                                      |
| `Start()`                                                   | Start the FSM (enters default state)                                 |
| `Stop()`                                                    | Stop the FSM (exits current state)                                   |
| `Update(dt)`                                                | Tick the FSM — checks transitions and calls current state's `Update` |
| `AddTransition(from, to, priority, condition?)`             | Add a condition-based transition                                     |
| `AddAnyTransition(to, priority, condition?)`                | Add a transition from any state                                      |
| `AddEventTransition(from, to, event, priority, condition?)` | Add an event-based transition                                        |
| `AddAnyEventTransition(to, event, priority, condition?)`    | Add a global event transition                                        |
| `HandleEvent(event)`                                        | Fire an event, triggering matching event transitions                 |
| `ForceSetState(state)`                                      | Immediately switch to a state                                        |
| `BindOnEnter(fn)`                                           | Bind a callback for when the FSM enters                              |
| `BindOnExit(fn)`                                            | Bind a callback for when the FSM exits                               |
| `BindUpdate(fn)`                                            | Bind a callback called after each Update                             |

# Finite State Machine (FSM)

A finite state machine keeps an entity in exactly one **state** at a time (Idle, Patrol, Alert…) and moves it between states through **transitions**. It fits things with a few clear modes and clear rules for switching between them: a door, a weapon, a simple NPC.

Each state is an object with three methods:

- `OnEnter(bb)`: called when the FSM switches into the state
- `Update(dt, bb)`: called every frame while it is the current state
- `OnExit(bb)`: called when the FSM leaves it

`bb` is the FSM's [`Blackboard`](blackboard.md), a key-value store all states share.

## Basic usage

```typescript
import { FSM, Blackboard } from "@rbxts/state-management";

class IdleState implements FSM.IFSMState {
	OnEnter(bb: Blackboard) {
		print("Idle");
	}
	Update(dt: number, bb: Blackboard) {}
	OnExit(bb: Blackboard) {}
}

class AlertState implements FSM.IFSMState {
	OnEnter(bb: Blackboard) {
		print("Alert!");
		bb.SetWild("alertTime", 5);
	}
	Update(dt: number, bb: Blackboard) {
		// Count down; the transition below returns to Idle when it reaches zero.
		bb.UpdateWild<number>("alertTime", (t) => (t ?? 0) - dt);
	}
	OnExit(bb: Blackboard) {}
}

const blackboard = new Blackboard({ enemySpotted: false });
const fsm = new FSM.FSM("Idle", blackboard); // "Idle" is the state it starts in

fsm.RegisterState("Idle", new IdleState());
fsm.RegisterState("Alert", new AlertState());

// Idle -> Alert when an enemy is spotted; Alert -> Idle when the timer runs out.
fsm.AddTransition("Idle", "Alert", 1, (bb) => bb.GetWild<boolean>("enemySpotted") === true);
fsm.AddTransition("Alert", "Idle", 1, (bb) => (bb.GetWild<number>("alertTime") ?? 0) <= 0);

fsm.Start(); // enters "Idle"

game.GetService("RunService").Heartbeat.Connect((dt) => fsm.Update(dt));
```

## What `Update` does each frame

1. Checks the current state's transitions, highest priority first. If none of them passes, checks the any-state transitions the same way. The first one that passes switches the state: the old state's `OnExit` runs, then the new state's `OnEnter`.
2. Calls `Update` on the current state (the new one, if it just switched).
3. If `ForceSetState` or `HandleEvent` asked for a state change during this `Update`, switches to that state now.
4. Calls the `BindUpdate` callback, if you set one.

## Transitions

Every transition has a **priority**, and a **higher number is checked first**. A state's own transitions are always checked before any-state transitions, whatever their priorities: an any-state transition only fires when none of the current state's transitions passes.

The condition is optional. A transition without one always passes. A transition from a state to itself isn't allowed (`AddTransition` and `AddEventTransition` assert), and any-state transitions into the current state are skipped.

### Condition transitions

Checked on every `Update()`.

```typescript
fsm.AddTransition("Patrol", "Chase", 2, (bb) => bb.GetWild<boolean>("enemySpotted") === true);
fsm.AddTransition("Patrol", "Rest", 1, (bb) => (bb.GetWild<number>("stamina") ?? 0) < 10);
// With both true, Patrol -> Chase wins (priority 2 is checked before priority 1).
```

### Event transitions

Checked only when you call `HandleEvent(name)`. Use them to react right away to something that happened in the game.

```typescript
fsm.AddEventTransition("Idle", "Alert", "enemySighted", 1);
fsm.AddEventTransition("Patrol", "Alert", "enemySighted", 1);

// With a condition: only flee from damage when health is low.
fsm.AddEventTransition("Alert", "Flee", "damageTaken", 1, (bb) => {
	return (bb.GetWild<number>("health") ?? 100) < 20;
});

fsm.HandleEvent("enemySighted");
```

`HandleEvent` checks the current state's transitions for that event first, then the any-state ones. It switches immediately, or at the end of the current `Update` if you call it from inside one.

### Any-state transitions

These can fire from whatever state is current. Use them for global interrupts.

```typescript
fsm.AddAnyTransition("Alert", 2, (bb) => bb.GetWild<boolean>("emergencyAlert") === true);
fsm.AddAnyEventTransition("Dead", "killed", 10);
```

Remember that the current state's own transitions win over these, even with a lower priority.

## Changing state directly

```typescript
fsm.ForceSetState("Idle");
```

Switches right away, without checking any transition. The state must be registered (it asserts). If the FSM is already in that state, nothing happens; pass `false` as the second argument to exit and re-enter it anyway. Called from inside `Update` (for example from a state's `Update`), the switch happens at the end of that `Update`.

## Nesting an FSM inside another

`FSM` implements `IFSMState` itself, so an FSM can be registered as a state of another FSM:

```typescript
const combat = new FSM.FSM("Aim");
// ...register Aim, Shoot, Reload and their transitions on `combat`
parent.RegisterState("Combat", combat);
```

Each time the parent enters `"Combat"`, the inner FSM starts over from its default state. It uses its own blackboard, not the parent's. Use `BindOnEnter`, `BindOnExit` and `BindUpdate` to run code when the inner FSM is entered, exited or updated:

```typescript
combat.BindOnEnter((bb) => print("combat started"));
combat.BindOnExit((bb) => print("combat ended"));
combat.BindUpdate((dt, bb) => {}); // after every Update of the inner FSM
```

`BindOnEnter` and `BindOnExit` also run on `Start()` and `Stop()`, and each `Bind...` replaces the previous callback.

## Connectors

### BehaviorTreeConnector

Runs one agent of a [behavior tree](behavior-tree.md) as an FSM state. While the state is active, each `Update` ticks that agent with `tree.TickAgent(slot, dt)`. When the state exits, the agent is halted, so it starts over from the root next time.

```typescript
const slot = tree.AddAgent();
fsm.RegisterState("Combat", new FSM.BehaviorTreeConnector(tree, slot));
```

The agent is driven by `TickAgent`, so **don't also call `tree.Tick()` on that tree**: it would tick the agent a second time each frame, and a tree's agents should all be driven one way ([why](behavior-tree.md#tick-or-tickagent-not-both)). Use a separate tree for agents you tick with `tree.Tick()`.

### GOAPConnector

Runs a [GOAP](goap.md) agent as an FSM state. Each `Update` calls the agent's `Update(dt)`, and exiting the state calls its `Reset()`.

```typescript
fsm.RegisterState("Planning", new FSM.GOAPConnector(myGoapAgent));
```

## API reference

| Method                                                      | Description                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `new FSM.FSM(defaultState, blackboard?)`                    | Creates an FSM that starts in `defaultState`. Creates an empty blackboard if none given       |
| `RegisterState(name, state)`                                | Registers a state object (anything implementing `IFSMState`, including another `FSM`)         |
| `Start()`                                                   | Enters the default state (asserts it is registered)                                           |
| `Stop()`                                                    | Exits the current state                                                                       |
| `Update(dt)`                                                | Checks transitions, then updates the current state. See [above](#what-update-does-each-frame) |
| `GetCurrentState()`                                         | The name of the current state                                                                 |
| `AddTransition(from, to, priority, condition?)`             | Adds a transition checked on every `Update`                                                   |
| `AddAnyTransition(to, priority, condition?)`                | Adds a transition from any state, checked on every `Update`                                   |
| `AddEventTransition(from, to, event, priority, condition?)` | Adds a transition checked when `event` is handled                                             |
| `AddAnyEventTransition(to, event, priority, condition?)`    | Adds a transition from any state, checked when `event` is handled                             |
| `HandleEvent(event)`                                        | Fires an event                                                                                |
| `ForceSetState(state, skipIfSame = true)`                   | Switches to a state without checking transitions                                              |
| `BindOnEnter(fn)`                                           | `fn(bb)` runs when the FSM starts or is entered as a nested state                             |
| `BindOnExit(fn)`                                            | `fn(bb)` runs when the FSM stops or is exited as a nested state                               |
| `BindUpdate(fn)`                                            | `fn(dt, bb)` runs at the end of every `Update`                                                |

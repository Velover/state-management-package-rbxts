# Behavior Tree (`BTree`)

A behavior tree decides what an AI agent does each frame. You build it out of small nodes: **conditions** ("do I have a target?"), **actions** ("walk to the next waypoint") and **composites** that combine them ("try to fight; if that fails, patrol").

`BTree` is built for games with many agents. You build **one** tree, add every NPC to it as an **agent**, and tick the tree once per frame. All agents walk the same nodes, and each one keeps its own progress.

**On this page**

- [How a behavior tree works](#how-a-behavior-tree-works)
- [Your first tree](#your-first-tree)
- [Core concepts](#core-concepts): agents, per-agent data, interruptions, leaf hooks, Scope
- [Node reference](#node-reference), starting with [which node do I need?](#which-node-do-i-need)
- [BehaviorTree API](#behaviortree-api)
- [Rules and edge cases](#rules-and-edge-cases)
- [Writing custom nodes](#writing-custom-nodes)
- [Migrating from 0.3](#migrating-from-03)
- [Performance](#performance)

---

## How a behavior tree works

Every frame, the tree starts at the root and walks down. Each node it reaches does its work and reports one of three statuses to its parent:

| Status    | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| `SUCCESS` | Finished, and it worked.                                 |
| `FAILURE` | Finished, and it didn't work (or a condition was false). |
| `RUNNING` | Not finished yet. Tick me again next frame.              |

Composites look at their children's statuses to decide what to do next. The two you will use most:

- **`Sequence`** runs its children in order and stops at the first one that fails. It succeeds only if all of them succeed. Read it as "do A, then B, then C".
- **`Fallback`** runs its children in order and stops at the first one that succeeds. It fails only if all of them fail. Read it as "try A; if that doesn't work, try B".

When a child returns `RUNNING`, its composite returns `RUNNING` too, and next frame it picks up at that same child.

Here is a guard NPC drawn as a tree:

```
Fallback                              try each branch until one works
├── Sequence                          1. fight
│   ├── Condition  has a target?
│   ├── Action     move to it         RUNNING until close enough
│   └── Callback   hit it
└── Sequence                          2. otherwise, patrol
    ├── Action     walk to waypoint   RUNNING until it arrives
    └── Wait       2 seconds
```

With no target, the condition fails, so the fight `Sequence` fails and the `Fallback` moves on to the patrol. With a target, the fight `Sequence` succeeds or keeps running, so the `Fallback` never gets to the patrol.

---

## Your first tree

The guard above, in code:

```typescript
import { BTree } from "@rbxts/state-management";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const RUNNING = BTree.ENodeStatus.RUNNING;

// Per-agent data: a Map keyed by the agent's slot (see "Per-agent data" below).
const targets = new Map<BTree.Slot, Model>();

// 1. Build the tree once. Every guard runs through these same nodes.
const root = BTree.Fallback(
	// Fight: if we have a target, move to it, then hit it.
	BTree.Sequence(
		BTree.Condition((slot) => targets.has(slot)),
		BTree.Action((slot) => (moveToTarget(slot) ? SUCCESS : RUNNING)),
		BTree.Callback((slot) => hitTarget(slot)),
	),
	// Otherwise patrol: walk to the next waypoint, then wait 2 seconds.
	BTree.Sequence(
		BTree.Action((slot) => (walkToNextWaypoint(slot) ? SUCCESS : RUNNING)),
		BTree.Wait(2),
	),
);

const tree = new BTree.BehaviorTree(root);
tree.RegisterField(targets); // removing an agent will delete its entry

// 2. Add one agent per NPC. AddAgent returns the agent's slot, a number that identifies it.
const slot = tree.AddAgent();

// 3. Tick every agent once per frame.
game.GetService("RunService").Heartbeat.Connect((dt) => tree.Tick(dt));

// 4. When the NPC despawns, remove its agent.
tree.RemoveAgent(slot);
```

`moveToTarget`, `hitTarget` and `walkToNextWaypoint` stand for your own game code. Each receives the agent's slot, and the two movement functions return `true` once the agent has arrived.

This is what the tree does for one guard with no target, frame by frame:

| Frame      | What happens                                                                                             | Root returns |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| 1          | The condition fails, so the fight branch fails. The `Fallback` tries the patrol branch; the walk starts. | `RUNNING`    |
| 2, 3, …    | The `Fallback` and the patrol `Sequence` pick up at the walk.                                            | `RUNNING`    |
| Arrival    | The walk returns `SUCCESS`, and `Wait(2)` starts in the same frame.                                      | `RUNNING`    |
| 2 s later  | The wait finishes, so the patrol branch succeeds, and so does the `Fallback`.                            | `SUCCESS`    |
| Next frame | The root finished last frame, so the tree starts again from the top, with the target check.              | …            |

Two things to notice:

- A node that finishes lets its parent move on **in the same frame**. The walk only stops early at a node that returns `RUNNING`.
- While the patrol is running, the guard **does not look for targets**. The `Fallback` picks up at the running patrol branch and skips the fight branch until the patrol is over. The next section fixes that.

### Making the guard react: reactive composites

For a new target to interrupt the patrol, make the root a `ReactiveFallback`. A reactive composite starts from its **first** child every frame instead of picking up at the running one. If an earlier child now succeeds or starts running, the later child that was running is **halted** (interrupted).

The fight branch has the same problem. Once "move to it" is running, a plain `Sequence` never checks "has a target?" again. A `ReactiveSequence` checks it every frame and halts the movement as soon as the target is gone.

```typescript
const root = BTree.ReactiveFallback(
	BTree.ReactiveSequence(
		BTree.Condition((slot) => targets.has(slot)),
		BTree.Action((slot) => (moveToTarget(slot) ? SUCCESS : RUNNING)),
		BTree.Callback((slot) => hitTarget(slot)),
	),
	BTree.Sequence(
		BTree.Action((slot) => (walkToNextWaypoint(slot) ? SUCCESS : RUNNING)),
		BTree.Wait(2),
	),
);
```

|                           | Picks up at the running child | Starts from the first child every frame |
| ------------------------- | ----------------------------- | --------------------------------------- |
| All must succeed ("and")  | `Sequence`                    | `ReactiveSequence`                      |
| First success wins ("or") | `Fallback`                    | `ReactiveFallback`                      |

Use the reactive version when the earlier children are **conditions that can change** while a later child runs. Put only quick checks before the child that runs: a reactive composite ticks every child before it again, every frame.

---

## Core concepts

### Agents and slots

An **agent** is one thing running the tree, usually one NPC. `tree.AddAgent()` adds an agent and returns its **slot**, a small positive integer that identifies it in this tree. Every callback receives the slot, and that is how your code knows which NPC it is acting for.

Keep the slot with your NPC (for example in a `Map<Model, BTree.Slot>`), and call `tree.RemoveAgent(slot)` when the NPC goes away. The tree reuses freed slots for later agents.

`tree.GetAgents()` returns the tree's own list of slots, not a copy, and `RemoveAgent` reorders that list. To remove agents while looping over them, loop over a copy, or about half of them get skipped:

```typescript
for (const slot of [...tree.GetAgents()]) tree.RemoveAgent(slot);
```

#### Using your own ids (ECS)

If your agents already have integer ids, such as ECS entity ids, create the tree with `external_ids: true` and pass the id to `AddAgent`. The id becomes the slot:

```typescript
const tree = new BTree.BehaviorTree(root, { external_ids: true });
world.OnEntityAdded((entity) => tree.AddAgent(entity));
world.OnEntityRemoved((entity) => tree.RemoveAgent(entity));
```

- Ids must be positive integers. `AddAgent` throws if that id is already in the tree.
- In this mode the tree never picks or reuses ids. After `RemoveAgent(entity)`, you decide when that number comes back.
- A tree either picks its own slots or takes your ids, and that is fixed when you create it. The two can't be mixed, so your ids can't collide with slots the tree picked.
- Dense ids (1, 2, 3, … like typical ECS entity indices) are fastest. Sparse ids such as `Player.UserId` work, but they measured 1.3–2.3x slower per agent and use about 1.8x the memory, because each node's per-agent table can no longer use Luau's fast array storage.

### Per-agent data: fields

All agents share the same nodes, so a node can't hold "this guard's target". Keep per-agent data in a `Map` keyed by slot, one map per value. (`BTree` doesn't use a `Blackboard`; a map per value is also the fastest lookup.)

Register your maps with the tree, and `RemoveAgent` deletes the agent's entries for you:

```typescript
const ammo = tree.Field<number>(); // creates a Map<Slot, number> and registers it
const anger = new Map<BTree.Slot, number>();
tree.RegisterField(anger); // registers a map you already have

// Read and write them from any callback:
BTree.Condition((slot) => (ammo.get(slot) ?? 0) > 0);
BTree.Callback((slot) => ammo.set(slot, ammo.get(slot)! - 1));
```

A field can own a resource. Give it a cleanup function, and when an agent that has a value is removed, the function runs with that value:

```typescript
const models = tree.Field<Model>((slot, model) => model.Destroy());
```

For cleanup that isn't tied to one field, use `tree.OnAgentRemoved((slot, tree) => ...)`. It runs for every removed agent while its field values can still be read.

A few built-in nodes read a field directly: [`Timer`](#timer) and [`WasFieldUpdated`](#wasfieldupdated).

### Interruptions (halting)

When a node is `RUNNING` and its parent decides not to tick it again, the parent **halts** it. The halt travels down the running path, so every running leaf underneath gets its `OnHalt` hook, however deep it is. Use `OnHalt` to undo what `OnStart` began: stop an animation, cancel a path, release a reservation.

The tree guarantees that a node that was running at the end of a frame is, in the next frame, either ticked again or halted. It is never silently dropped (the one exception is a frame in which one of your tick hooks throws; see [When a hook throws](#when-a-hook-throws)). These halt a running node:

- a `ReactiveSequence` or `ReactiveFallback` switching away from a running child
- `WhileDoElse` switching branches, `Timeout` running out, `Parallel` finishing while other children still run
- `tree.Halt(slot)`, `tree.HaltAll()` and `tree.RemoveAgent(slot)`, which halt from the root down

After `tree.Halt(slot)`, the agent stays in the tree and starts over from the root on its next tick.

### Leaves and their hooks

Leaves are where your code runs. Pick the simplest one that fits:

| Leaf            | Your function                 | Returns                             |
| --------------- | ----------------------------- | ----------------------------------- |
| `Condition(fn)` | `(slot, dt, tree) => boolean` | `SUCCESS` if true, `FAILURE` if not |
| `Callback(fn)`  | `(slot, dt, tree) => void`    | always `SUCCESS`                    |
| `Action(fn)`    | `(slot, dt, tree) => status`  | whatever you return                 |
| `Leaf({...})`   | `OnTick` plus optional hooks  | whatever `OnTick` returns           |

Use `Leaf` when something must happen as the action starts, finishes or gets interrupted:

```typescript
BTree.Leaf({
	Name: "Attack",
	OnStart: (slot) => playAnimation(slot, "Attack"),
	OnTick: (slot) => (animationFinished(slot, "Attack") ? SUCCESS : RUNNING),
	OnHalt: (slot) => stopAnimation(slot, "Attack"), // interrupted before it finished
});
```

Every hook is optional except `OnTick`:

| Hook                         | Called when                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `OnStart(slot, tree)`        | A run begins (the leaf wasn't running). Called just before `OnTick`, in the same frame.            |
| `OnTick(slot, dt, tree)`     | Every frame the leaf is ticked. Returns the status.                                                |
| `OnSuccess(slot, tree)`      | `OnTick` returned `SUCCESS`.                                                                       |
| `OnFailure(slot, tree)`      | `OnTick` returned `FAILURE`.                                                                       |
| `OnHalt(slot, tree)`         | The leaf was running and got interrupted.                                                          |
| `OnExit(status, slot, tree)` | Any run ended: after `OnSuccess` / `OnFailure` with that status, or after `OnHalt` with `RUNNING`. |
| `OnEnter(slot, tree)`        | The leaf is reached, and it wasn't reached the frame before.                                       |
| `OnLeave(slot, tree)`        | At the end of the first frame the leaf isn't reached, or right away when it is halted or removed.  |

The first six hooks are about one **run**, from start to finish. `OnEnter` and `OnLeave` are about the **visit**: the stretch of consecutive frames in which the leaf is reached, which can hold many runs.

For example, take an `Attack` leaf that needs two frames per attack, under `ReactiveSequence(Condition(inRange), Attack)`:

| Frame | Situation                                                     | Hooks called                                         |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------- |
| 1     | In range; the first attack starts                             | `OnEnter`, `OnStart`, `OnTick` → `RUNNING`           |
| 2     | The first attack lands                                        | `OnTick` → `SUCCESS`, `OnSuccess`, `OnExit(SUCCESS)` |
| 3     | Still in range; the second attack starts                      | `OnStart`, `OnTick` → `RUNNING`                      |
| 4     | Out of range: the `ReactiveSequence` halts the running attack | `OnHalt`, `OnExit(RUNNING)`, `OnLeave`               |

Hooks you leave out cost nothing. A leaf with only `OnTick` is just your function.

### Running code when a branch starts or stops: Scope

To run code when an agent enters or leaves a part of the tree ("start the combat music when combat begins, stop it when combat ends"), wrap that part in `Scoped`:

```typescript
BTree.Sequence(
	BTree.Condition((slot) => inCombat.get(slot) === true),
	BTree.Scoped(
		{
			OnEnter: (slot) => playCombatMusic(slot), // first frame the branch is reached
			OnExit: (slot) => stopCombatMusic(slot), // first frame it isn't (or on halt / removal)
		},
		combatBehavior,
	),
);
```

`Scoped` passes its child's status through unchanged. `OnEnter` fires on the first frame it is reached. `OnExit` fires at the end of the first frame it is **not** reached, and also when it is halted or its agent is removed.

`Scope({ OnEnter, OnExit })` is the same idea as a leaf. It has no child and always returns `SUCCESS`. Because it only notices the frames in which it is ticked, it has to sit somewhere that is reached **every frame** while the branch is active, such as inside a `ReactiveSequence`. Inside a plain `Sequence`, a `Scope` placed before a child that keeps running is skipped while that child runs (the `Sequence` picks up at the running child), so its `OnExit` fires on the next frame although the branch is still active. When in doubt, use `Scoped`.

Each `Scope` or `Scoped` costs about 30–40 ns and ~70 bytes per agent that reaches it, roughly one extra leaf visit. Add them where you need the events, not around every composite.

---

## Node reference

Decorators take their settings first and the child last: `Timeout(10, child)`, `Cooldown(2, child)`.

### Which node do I need?

| I want to…                                           | Use                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Do steps in order, stop at the first failure         | [`Sequence`](#sequence)                                                                             |
| Try options in order until one works                 | [`Fallback`](#fallback)                                                                             |
| Keep checking conditions while an action runs        | [`ReactiveSequence`](#reactivesequence--reactivefallback)                                           |
| Let a higher-priority option interrupt a running one | [`ReactiveFallback`](#reactivesequence--reactivefallback)                                           |
| Retry a sequence from the step that failed           | [`MemorySequence`](#memorysequence)                                                                 |
| Run several children at the same time                | [`Parallel`](#parallel)                                                                             |
| Pick a branch once, when starting                    | [`IfThenElse`](#ifthenelse), [`Switch`](#switch)                                                    |
| Pick a branch again every frame                      | [`WhileDoElse`](#whiledoelse)                                                                       |
| Run a fallback step and a cleanup step               | [`TryCatch`](#trycatch)                                                                             |
| Flip or override a result                            | [`Inverter`](#inverter), [`ForceSuccess` / `ForceFailure`](#forcesuccess--forcefailure)             |
| Give up after some time                              | [`Timeout`](#timeout)                                                                               |
| Stop something from happening too often              | [`Cooldown`](#cooldown)                                                                             |
| Do something N times, or retry until it works        | [`Repeat`](#repeat), [`KeepRunningUntilSuccess`](#keeprunninguntilsuccess--keeprunninguntilfailure) |
| Do something only once                               | [`OneShot`](#oneshot)                                                                               |
| Wait a few seconds                                   | [`Wait`](#wait)                                                                                     |
| Let a branch through every N seconds                 | [`WaitGate`](#waitgate)                                                                             |
| Count down a per-agent timer                         | [`Timer`](#timer)                                                                                   |
| React when a value changes                           | [`WasFieldUpdated`](#wasfieldupdated)                                                               |
| Run code when a branch starts or stops               | [`Scoped`](#scoped), [`Scope`](#scope)                                                              |
| Start something and move on without waiting for it   | [`FireAndForget`](#fireandforget)                                                                   |
| Run an FSM or GOAP agent inside the tree             | [`FSMConnector` / `GoapConnector`](#fsmconnector--goapconnector)                                    |

### Composites

#### Sequence

```typescript
BTree.Sequence(...children);
```

Ticks the children left to right. Returns `FAILURE` as soon as one fails and `SUCCESS` when all succeed. When a child returns `RUNNING`, the next frame picks up at that child without checking the ones before it again.

#### Fallback

```typescript
BTree.Fallback(...children);
```

Ticks the children left to right. Returns `SUCCESS` as soon as one succeeds and `FAILURE` when all fail. Like `Sequence`, it picks up at a `RUNNING` child.

#### ReactiveSequence / ReactiveFallback

```typescript
BTree.ReactiveSequence(...children);
BTree.ReactiveFallback(...children);
```

Like `Sequence` and `Fallback`, but they start from the first child every frame. When an earlier child's result changes, the child that was running is halted. See [Making the guard react](#making-the-guard-react-reactive-composites).

#### MemorySequence

```typescript
BTree.MemorySequence(...children);
```

Like `Sequence`, but when a child fails, the next frame retries **from that child** instead of from the first one, so steps that already succeeded don't run again. It forgets the failed step when the whole sequence succeeds, or when it wasn't ticked in the previous frame.

#### Parallel

```typescript
BTree.Parallel(successPolicy, failurePolicy, ...children);
```

Ticks every unfinished child each frame. A child that has finished keeps its result until the `Parallel` itself finishes. The two policies say when that happens:

- `EParallelPolicy.ONE`: as soon as one child succeeds (for the success policy) or fails (for the failure policy).
- `EParallelPolicy.ALL`: once every child has succeeded (or failed).

If every child has finished and neither policy was met, for example `ALL`/`ALL` with one success and one failure, it returns `FAILURE`. With no children, it returns `SUCCESS` when the success policy is `ALL` and `FAILURE` otherwise.

If the `Parallel` finishes while some children are still running, they are halted. It takes at most 32 children.

```typescript
// Walk and scan at the same time: succeed when either one succeeds, fail only if both fail.
BTree.Parallel(BTree.EParallelPolicy.ONE, BTree.EParallelPolicy.ALL, walkToGoal, scanForEnemies);
```

#### IfThenElse

```typescript
BTree.IfThenElse(condition, thenBranch, elseBranch?);
```

Checks `condition` when it starts, then runs `thenBranch` if the condition succeeded or `elseBranch` if it failed (or returns `FAILURE` if there is no `elseBranch`). The chosen branch runs until it finishes **without the condition being checked again**. Use `WhileDoElse` if it should be.

```typescript
BTree.IfThenElse(
	BTree.Condition((slot) => energy.get(slot)! > 50),
	aggressiveBehavior,
	defensiveBehavior,
);
```

#### WhileDoElse

```typescript
BTree.WhileDoElse(condition, doBranch, elseBranch?);
```

Checks `condition` **every frame**. Runs `doBranch` while it succeeds and `elseBranch` while it fails, and halts the other branch when the result flips. With no `elseBranch`, returns `FAILURE` whenever the condition fails. While the condition itself returns `RUNNING`, neither branch runs.

#### TryCatch

```typescript
BTree.TryCatch(tryBranch, catchBranch, finallyBranch?);
```

Runs `tryBranch`. If it fails, runs `catchBranch`, and the `TryCatch` reports that branch's result. Either way, `finallyBranch` runs last if you gave one; its result is ignored. If the `TryCatch` is halted before `finallyBranch` starts, `finallyBranch` doesn't run.

#### Switch

```typescript
BTree.Switch(selector, cases, default?);
```

When it starts, calls `selector(slot, tree)` and runs the child stored under the returned value in `cases`. If nothing matches, it runs `default`, or returns `FAILURE` when there is no default. The selector isn't called again until the chosen child finishes.

```typescript
BTree.Switch(
	(slot) => weapon.get(slot),
	new Map([
		["sword", swordBehavior],
		["bow", bowBehavior],
	]),
	unarmedBehavior,
);
```

### Decorators

A decorator wraps one child and changes how it runs or what it reports.

#### Inverter

`BTree.Inverter(child)` turns `SUCCESS` into `FAILURE` and `FAILURE` into `SUCCESS`. `RUNNING` passes through.

#### ForceSuccess / ForceFailure

`BTree.ForceSuccess(child)` reports `SUCCESS` when the child finishes, whatever its result. `BTree.ForceFailure(child)` reports `FAILURE`. `RUNNING` passes through.

#### ForceRunning

`BTree.ForceRunning(child)` always reports `RUNNING`. The child starts over each time it finishes, so the branch loops until something halts it.

#### Timeout

```typescript
BTree.Timeout(seconds, child, behavior = ETimeoutBehavior.FAILURE);
```

If the child is still running after `seconds`, halts it and returns `behavior`: `FAILURE` by default, or `SUCCESS` with `ETimeoutBehavior.SUCCESS`.

```typescript
BTree.Timeout(10, walkToGoal); // give up on the walk after 10 seconds
```

#### Cooldown

```typescript
BTree.Cooldown(seconds, child, resetOnHalt = false);
```

Once the child finishes (success or failure), returns `FAILURE` for `seconds` without ticking it. With `resetOnHalt`, being interrupted also starts the cooldown. The cooldown only counts down on frames in which the node is ticked: while the agent is busy elsewhere in the tree, the timer is paused.

```typescript
BTree.Cooldown(2, attackBehavior); // at most one attack every 2 seconds
```

#### Repeat

```typescript
BTree.Repeat(count, child, condition = ERepeatCondition.ALWAYS);
```

Runs the child `count` times, then returns `SUCCESS`. Each run takes at least one frame, and `Repeat` returns `RUNNING` between runs. The optional condition can end the loop early:

- `ERepeatCondition.SUCCESS`: keep going only while the child succeeds.
- `ERepeatCondition.FAILURE`: keep going only while the child fails.

A loop that ends early still returns `SUCCESS`.

```typescript
BTree.Repeat(5, patrolStep, BTree.ERepeatCondition.SUCCESS); // up to 5 steps; stop at the first failed one
```

#### KeepRunningUntilSuccess / KeepRunningUntilFailure

```typescript
BTree.KeepRunningUntilSuccess(child, maxAttempts = -1);
BTree.KeepRunningUntilFailure(child, maxAttempts = -1);
```

`KeepRunningUntilSuccess` retries the child after each failure, with the next attempt on the next frame, and returns `SUCCESS` once the child succeeds. After `maxAttempts` failures it gives up and returns `FAILURE`; `-1` means it never gives up. `KeepRunningUntilFailure` is the mirror image.

#### OneShot

```typescript
BTree.OneShot(child, resetOnInactive = false);
```

Runs the child once. After that, returns the same result every frame without ticking the child again, until the agent is removed. With `resetOnInactive`, the result is forgotten whenever the `OneShot` wasn't ticked in the previous frame, so the child runs again the next time the branch is entered.

#### FireAndForget

```typescript
BTree.FireAndForget(child);
```

Ticks the child and returns `SUCCESS` right away, so the parent moves on. If the child returned `RUNNING`, it stays running and is ticked again each time the `FireAndForget` is ticked. It is halted at the end of the first frame in which the `FireAndForget` isn't ticked.

That last rule matters. In a plain `Sequence`, a `FireAndForget` placed before a child that keeps running is not ticked again while that child runs (the `Sequence` picks up at the running child), so its own child is halted one frame later. `FireAndForget` works as you'd expect in a place that is reached every frame, such as inside a reactive composite.

#### RunningGate

```typescript
BTree.RunningGate(child);
```

Passes `SUCCESS` and `FAILURE` through, but reports `RUNNING` as `FAILURE`. A running child keeps running under the same rule as `FireAndForget`: it is halted at the end of the first frame in which the `RunningGate` isn't ticked.

#### Scoped

```typescript
BTree.Scoped({ OnEnter?, OnExit? }, child);
```

Runs the child and passes its status through. `OnEnter` fires on the first frame it is reached, and `OnExit` at the end of the first frame it isn't (and on halt or removal). A running child is halted before `OnExit`. See [Running code when a branch starts or stops](#running-code-when-a-branch-starts-or-stops-scope).

### Leaves

#### Action

`BTree.Action((slot, dt, tree) => status, name?)` calls your function every frame it is ticked and returns its status.

#### Condition

`BTree.Condition((slot, dt, tree) => boolean, name?)` returns `SUCCESS` when your function returns `true`, and `FAILURE` otherwise.

#### Callback

`BTree.Callback((slot, dt, tree) => void, name?)` calls your function and returns `SUCCESS`.

#### Leaf

`BTree.Leaf({ Name?, OnTick, OnStart?, OnHalt?, OnSuccess?, OnFailure?, OnExit?, OnEnter?, OnLeave? })` is a leaf with lifecycle hooks. See [Leaves and their hooks](#leaves-and-their-hooks).

#### Scope

`BTree.Scope({ OnEnter?, OnExit? })` always returns `SUCCESS`. `OnEnter` fires on the first frame it is ticked, and `OnExit` at the end of the first frame it isn't (and on halt or removal). It must be ticked every frame the branch is active; see [Running code when a branch starts or stops](#running-code-when-a-branch-starts-or-stops-scope).

```typescript
BTree.ReactiveSequence(
	BTree.Condition((slot) => alerted.get(slot) === true),
	BTree.Scope({
		OnEnter: (slot) => (highlights.get(slot)!.Enabled = true),
		OnExit: (slot) => (highlights.get(slot)!.Enabled = false),
	}),
	searchBehavior,
);
```

#### Wait

`BTree.Wait(seconds)` returns `RUNNING` for `seconds`, then `SUCCESS`.

#### WaitGate

`BTree.WaitGate(seconds)` returns `FAILURE` until it has been ticked for `seconds` without a break, then returns `SUCCESS` once, and the timer starts over. A frame in which it isn't ticked also restarts the timer. It never returns `RUNNING`, so it never holds up its parent.

#### Timer

`BTree.Timer(field)` counts the agent's value in `field` down by `dt` on every frame it is ticked. It returns `SUCCESS` once the value reaches zero (and keeps returning `SUCCESS` until you set a new value), and `FAILURE` while the value is still positive or the agent has none. Start or restart the timer by setting the field.

```typescript
const alertTime = tree.Field<number>();
alertTime.set(slot, 5); // start a 5-second timer for this agent

BTree.Timer(alertTime); // the node, somewhere in the tree
```

#### WasFieldUpdated

`BTree.WasFieldUpdated([field, ...], skipFirst = false)` returns `SUCCESS` when any of the fields changed for this agent since the last frame it was ticked, and `FAILURE` otherwise. Values are compared with `===`, so storing a new value counts as a change, but changing a table in place doesn't. When the node is ticked after a gap (or for the first time), it records the current values and returns `SUCCESS`, or `FAILURE` with `skipFirst`.

#### Plug

`BTree.Plug(status = SUCCESS)` always returns `status`. It is useful as a placeholder for a branch you haven't written yet, and in tests.

#### Log

`BTree.Log(message)` prints `message` and returns `SUCCESS`.

#### FSMConnector / GoapConnector

```typescript
BTree.FSMConnector((slot, tree) => fsm);
BTree.GoapConnector((slot, tree) => goapAgent);
```

Run an agent's FSM or GOAP agent as a leaf. Both always return `RUNNING`, so they keep going until something halts them.

- `FSMConnector` calls the FSM's `Start()` when it starts, `Update(dt)` every frame, and `Stop()` when halted.
- `GoapConnector` calls the GOAP agent's `Update(dt)` every frame and `Reset()` when halted.

They take a function instead of the FSM itself because the node is shared, while each agent has its own FSM:

```typescript
const fsms = tree.Field<FSM.FSM>();
BTree.FSMConnector((slot) => fsms.get(slot)!);
```

---

## BehaviorTree API

| Member                             | Description                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `new BehaviorTree(root, options?)` | Creates a tree from a built root node. Pass `{ external_ids: true }` to [use your own ids](#using-your-own-ids-ecs).                  |
| `AddAgent(id?)`                    | Adds an agent and returns its slot. Takes no argument, or the entity id in external-id mode (throws if it is already added).          |
| `RemoveAgent(slot)`                | Halts the agent, clears its state in every node and registered field, and frees the slot. [Details](#what-removeagent-does-in-order). |
| `Tick(dt)`                         | Ticks every agent once.                                                                                                               |
| `TickAgent(slot, dt)`              | Ticks one agent and returns its status. See [Tick or TickAgent](#tick-or-tickagent-not-both).                                         |
| `GetStatus(slot)`                  | The root's status from the agent's latest tick. `undefined` before its first tick and after a halt.                                   |
| `Halt(slot)` / `HaltAll()`         | Interrupts one agent (or all) without removing it; it starts over from the root on its next tick. Throws during a tick.               |
| `Field<T>(cleanup?)`               | Creates and registers a per-agent `Map<Slot, T>`. `cleanup(slot, value)` runs on removal if the agent has a value.                    |
| `RegisterField(map, cleanup?)`     | Registers a per-agent map you already have, with the same optional cleanup.                                                           |
| `OnAgentRemoved(callback)`         | Registers `callback(slot, tree)`, called for every removed agent while its field values are still readable.                           |
| `HasAgent(slot)`                   | Whether the agent is in the tree.                                                                                                     |
| `GetAgents()`                      | The slots of all agents, in tick order: the tree's own list, so don't modify it ([removing in a loop](#agents-and-slots)).            |
| `GetAgentCount()`                  | The number of agents.                                                                                                                 |
| `UsesExternalIds()`                | Whether the tree was created with `external_ids: true`.                                                                               |
| `GetRoot()`                        | The root node.                                                                                                                        |
| `TickCount`                        | The frame counter nodes use to tell whether they were ticked last frame. Don't modify it.                                             |

`DetachRunning` and `HaltChild` are for custom nodes; see [custom-nodes.md](custom-nodes.md).

---

## Rules and edge cases

### Build each node once per position

A node stores every agent's progress inside itself. That gives two rules:

- **Don't place the same node object at two positions in a tree.** Both positions would share one copy of each agent's progress. Build it twice instead; a small factory function makes that easy:

  ```typescript
  const makeAttack = () => BTree.Cooldown(2, BTree.Action(attack));

  BTree.Fallback(
  	BTree.Sequence(BTree.Condition(seesPlayer), makeAttack()),
  	BTree.Sequence(BTree.Condition(heardNoise), makeAttack()),
  );
  ```

- **Don't share a node between two trees.** Both trees hand out slots 1, 2, 3…, so their agents would overwrite each other's progress, and `RemoveAgent` on one tree would clear the other tree's agent. Build a separate copy for each tree. (Two external-id trees whose ids never overlap are the one safe exception.)

### Tick or TickAgent, not both

- `tree.Tick(dt)` ticks every agent. Most games call it once per frame.
- `tree.TickAgent(slot, dt)` ticks a single agent, for when something else runs the update loop. The FSM `BehaviorTreeConnector` and the GOAP `BTConnector` use it. Each call counts as one frame for that agent.

Pick one per tree:

- Don't call `tree.Tick()` on a tree whose agents are driven by `TickAgent()`. `Tick()` ticks every agent, including those.
- Don't move an agent from one to the other. If you have to, call `tree.Halt(slot)` first, so the agent starts over under the new one.
- On a tree driven by `Tick()`, don't call `TickAgent()` from a halt or removal callback, not even for another agent.

The reason: the two count frames separately. Nodes that remember whether they were ticked last frame (`MemorySequence`, `OneShot`, `WaitGate`, `WasFieldUpdated`, and `FireAndForget`, `RunningGate`, `Scope` and `Scoped`, which track children they leave running) see a switch as a gap. A `MemorySequence`, for example, then forgets its place without halting the child that was running there, and that child never gets `OnHalt`.

### Calling the tree from callbacks

Your callbacks and hooks receive the tree. This is what you may call while the tree is in the middle of something:

| Call                            | During a tick (`Tick` / `TickAgent`)   | During a halt or removal                                                                     |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `AddAgent`, `RemoveAgent`       | Allowed; applied after the tick's walk | Allowed; a `RemoveAgent` is applied after the current halt or removal                        |
| `Halt`, `HaltAll`               | Throws                                 | Allowed for other agents; does nothing for the agent being halted                            |
| `Tick`                          | Throws                                 | Throws                                                                                       |
| `TickAgent`                     | Throws                                 | Only on a tree driven by `TickAgent`, and not for the agent being halted or removed (throws) |
| `GetStatus`, `HasAgent`, fields | Fine                                   | Fine                                                                                         |

For `TickAgent`, the end-of-frame halt of what `FireAndForget`, `RunningGate`, `Scope` and `Scoped` leave running counts as a halt of that agent, so `TickAgent` of that agent throws there. `Halt` doesn't count it: a `Halt` of that agent from there halts everything the agent has running.

An agent removed during a tick still finishes that tick. Its running leaves get `OnHalt` before the `Tick` call returns. A leaf that removes its own agent should still return a status.

### What RemoveAgent does, in order

1. Halts everything running for the agent (leaf `OnHalt` hooks fire), including children left running by `FireAndForget` or `RunningGate`.
2. Clears the agent's state in every node.
3. Runs the `OnAgentRemoved` callbacks. Field values can still be read here.
4. For each registered field, in registration order: runs its cleanup with the agent's value (if it has one), then deletes the entry.
5. Frees the slot for reuse.

### When a hook throws

An error in one of your hooks never leaves the tree stuck. The tree finishes what it was doing, and then the outermost tree call (`Tick`, `TickAgent`, `Halt`, `HaltAll` or `RemoveAgent`) rethrows the first error.

- **During a tick** (`OnTick`, `OnStart`, `OnEnter`, `OnSuccess`, `OnFailure`, `OnExit`): that agent stops for this frame and keeps the status from its previous tick. Its nodes keep whatever progress they made. The other agents are still ticked, and queued adds and removals are still applied. Because the agent stopped partway through its tick, the tree can lose track of what that agent has running. A node that started in that frame may never be halted, not even by `RemoveAgent`. A later `Halt` or `RemoveAgent` may reach a node that already finished in that frame: a leaf then gets an `OnHalt` without a run to end, or the call throws an error from inside the tree.
- **During a halt or removal** (`OnHalt`, `OnLeave`, an `OnAgentRemoved` callback, a field cleanup): the rest of the halt or removal still happens. The remaining hooks still run, and the agent still ends up fully halted or removed. This includes an `OnHalt` caused mid-tick: a reactive composite or `WhileDoElse` switching branch, a `Timeout` running out, a `Parallel` finishing early. The halt completes, and the tick then carries on as if the hook had returned normally.
- A `TickAgent` called from inside another tree call returns `FAILURE` if its walk throws, and leaves the rethrow to the outer call.

---

## Writing custom nodes

For your own game logic you never need a custom node: `Action`, `Condition`, `Callback` and `Leaf` cover that. Write a custom node when you need **control flow** the built-ins don't have, such as a new way of choosing children or reacting to a child's status.

A node is a plain object:

```typescript
interface Node {
	readonly Name: string;
	readonly Tick: (slot: Slot, dt: number, tree: BehaviorTree) => ENodeStatus;
	readonly Halt: (slot: Slot, tree: BehaviorTree) => void; // only called while it is running for that slot
	readonly Maps: Map<Slot, unknown>[]; // every per-agent table of this node and its descendants
}
```

[custom-nodes.md](custom-nodes.md) is the full guide: the rules a node must follow, five tested examples (a pass-through decorator, a decorator with state, a composite, "was I ticked last frame", a hook after a halt), leaving a child running, performance tips, BTCreator registration, and how to test a node.

---

## Migrating from 0.3

Version 0.4 replaced the class-based tree, which created one set of node objects per agent, with the shared tree described on this page. On the same trees it is 10–30x faster per agent, allocates nothing per tick, and uses about 30x less memory per agent. See [Performance](#performance) for the numbers.

| 0.3                                            | 0.4                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `new BTree.Sequence().AddChild(a).AddChild(b)` | `BTree.Sequence(a, b)`                                                                |
| `new BTree.Timeout(child, 10)`                 | `BTree.Timeout(10, child)` (settings first, child last, for every decorator)          |
| `new BTree.BehaviorTree(root, bb)` per agent   | One `new BTree.BehaviorTree(root)`, then `AddAgent()` per agent                       |
| `tree.Tick(dt)` per agent                      | `tree.Tick(dt)` once for all agents                                                   |
| `(bb, dt) => ...` callbacks                    | `(slot, dt, tree) => ...`                                                             |
| `bb.Get("hp")`                                 | `hp.get(slot)`, with `const hp = tree.Field<number>()`                                |
| `class X extends BTree.Node`                   | A function returning `{ Name, Tick, Halt, Maps }` ([guide](custom-nodes.md))          |
| `FullAction({...})`                            | `Leaf({...})`                                                                         |
| `OnBecameActivated` / `OnBecameInactive`       | `Scoped({ OnEnter, OnExit }, subtree)`, or `Leaf`'s `OnEnter` / `OnLeave` (see below) |
| `Switch<T>("key").Case(v, node)`               | `Switch((slot) => key.get(slot), new Map([[v, node]]), default?)`                     |
| `Timer("key")`                                 | `Timer(field)`                                                                        |
| `WasEntryUpdated(["a", "b"])`                  | `WasFieldUpdated([a, b])`                                                             |
| `SubTree(other)`                               | Put the subtree's root node in the parent tree directly (a node belongs to one tree)  |
| `FSMConnector(fsm)`                            | `FSMConnector((slot) => fsms.get(slot)!)`                                             |
| `node.IsRunning()`                             | Not available on nodes. For the root, use `tree.GetStatus(slot) === RUNNING`          |

**Where `OnBecameActivated` / `OnBecameInactive` went.** Tracking "was this node reached last frame" for every node is a large part of what made 0.3 slow, so it is now opt-in: wrap the part of the tree you care about in [`Scoped`](#scoped), or give a `Leaf` `OnEnter` / `OnLeave` hooks. Only agents that pass through those nodes pay for it. `MemorySequence`, `WaitGate`, `OneShot` and `WasFieldUpdated`, which used the old hooks internally, now track this themselves.

`BTCreator` builds the new trees; its registration API changed too, see [btcreator.md](btcreator.md).

---

## Performance

Measured on the same trees in Roblox Studio (`--!optimize 2`), in µs per agent per tick; `native` means `--!native`:

| Tree (agents)                | 0.3 native | 0.4 native | 0.3 interpreter | 0.4 interpreter |
| ---------------------------- | ---------: | ---------: | --------------: | --------------: |
| 21-node NPC tree (1000)      |       2.87 |       0.19 |            3.54 |            0.39 |
| Wide fallback, 49 (1000)     |       8.01 |       0.57 |            9.55 |            0.94 |
| 10 stacked decorators (1000) |       5.83 |       0.21 |            6.81 |            0.35 |
| Reactive + timeout (1000)    |       2.25 |       0.09 |            3.11 |            0.14 |

Garbage per agent per tick: 0.3 allocated 224–1120 bytes; 0.4 allocates none. Memory per agent: 0.3 used 4–21 KB; 0.4 uses 0.1–0.3 KB.

Where the difference comes from, largest first:

1. One tree for all agents, instead of one per agent.
2. No per-tick bookkeeping sets; the halting guarantee replaces them.
3. Closures instead of metatable method calls.
4. Leaves specialised when they are built, so hooks you leave out cost nothing.
5. Dense slots, which keep the per-agent tables in Luau's fast array storage.

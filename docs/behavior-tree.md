# Behavior Tree (BTree)

`BTree` is a behavior tree built for many agents on one tree. You build the tree once, add agents to it, and tick the tree once per frame; every agent walks the same nodes with its own state.

Version 0.4.0 replaced the previous class-based tree (one node object per agent) with this shared-tree design: on the same trees it is 10–30x faster per agent per tick, allocates nothing per tick, and uses about 30x less memory per agent. The numbers are in [Performance](#performance); the API differences are in [Migrating from 0.3](#migrating-from-03).

## Basic Usage

```typescript
import { BTree } from "@rbxts/state-management";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const FAILURE = BTree.ENodeStatus.FAILURE;
const RUNNING = BTree.ENodeStatus.RUNNING;

// Per-agent data: one Map per field, keyed by slot. Registered with the tree below so RemoveAgent clears them.
const hp = new Map<BTree.Slot, number>();
const target = new Map<BTree.Slot, Model>();
const models = new Map<BTree.Slot, Model>();

const root = BTree.Fallback(
	BTree.Sequence(
		BTree.Condition((slot) => target.has(slot)),
		BTree.Cooldown(
			2.0,
			BTree.Leaf({
				OnStart: (slot) => playAnimation(models.get(slot)!, "Attack"),
				OnTick: (slot, dt) => (attackFinished(models.get(slot)!) ? SUCCESS : RUNNING),
				OnHalt: (slot) => stopAnimation(models.get(slot)!, "Attack"),
			}),
		),
	),
	BTree.Sequence(
		BTree.Condition((slot) => hp.get(slot)! < 30),
		BTree.Action((slot, dt) => (fleeStep(models.get(slot)!, dt) ? SUCCESS : RUNNING)),
	),
	BTree.Wait(1.0),
);

const tree = new BTree.BehaviorTree(root);
tree.RegisterField(hp);
tree.RegisterField(target);
tree.RegisterField(models, (slot, model) => model.Destroy()); // cleanup runs when the agent is removed
tree.OnAgentRemoved((slot) => leaderboard.Remove(slot));

function Spawn(model: Model) {
	const slot = tree.AddAgent();
	models.set(slot, model);
	hp.set(slot, 100);
	return slot;
}

game.GetService("RunService").Heartbeat.Connect((dt) => tree.Tick(dt));

// later
tree.RemoveAgent(slot); // halts its running nodes, calls OnAgentRemoved, destroys the model, clears hp/target/models
```

## Concepts

### One tree, many agents

A `BTree` tree is shared. Each node is a pair of functions, `Tick(slot, dt, tree)` and `Halt(slot, tree)`, and nodes hold their per-agent state in tables keyed by **slot**: `cursor[slot]`, `time_left[slot]`. An agent that never reaches a node has no entry in that node's tables, so it costs nothing there.

Because nodes are shared, **never place the same node instance at two positions of a tree**: both positions would share the same per-agent state. Build it twice.

### Slots

An agent is a positive integer called a slot. A tree runs in one of two modes, chosen when it is created:

- **Allocating** (default): `tree.AddAgent()` hands out a small dense slot from a free list and recycles it after removal. Dense slots keep the state tables in Luau's fast array part.
- **External ids** (`new BTree.BehaviorTree(root, { external_ids: true })`): `tree.AddAgent(entity)` uses your id as the slot. It must be a positive integer, and it throws if that id is already live, since two entities can never share a number. The tree never allocates or recycles ids in this mode; after `RemoveAgent(entity)` only you decide when the number is used again.

The modes cannot be mixed on one tree, so an id can never collide with an allocated slot. Wiring an ECS:

```typescript
const tree = new BTree.BehaviorTree(root, { external_ids: true });
world.OnEntityAdded((entity) => tree.AddAgent(entity));
world.OnEntityRemoved((entity) => tree.RemoveAgent(entity));
```

Every per-agent lookup is one table read keyed by the slot, so the density of your ids is the cost: measured on the benchmark trees, sparse or negative ids run 1.3–2.3x slower per agent-tick and use about 1.8x the memory of dense ones. Typical ECS entity indices are dense; something like `Player.UserId` is not.

### Status

| Value                 | Meaning                     |
| --------------------- | --------------------------- |
| `ENodeStatus.SUCCESS` | Node completed successfully |
| `ENodeStatus.FAILURE` | Node failed                 |
| `ENodeStatus.RUNNING` | Node is still in progress   |

Callbacks receive `(slot, dt, tree)` and return a status. Return the enum members (or locals holding them) rather than raw numbers.

### Fields: per-agent data

There is no `Blackboard` object. Per-agent data is a `Map<Slot, T>` per field, one lookup per access:

```typescript
const ammo = tree.Field<number>(); // created and registered
const anger = new Map<BTree.Slot, number>();
tree.RegisterField(anger); // an existing map, registered so RemoveAgent clears it

BTree.Condition((slot) => (ammo.get(slot) ?? 0) > 0);
BTree.Callback((slot) => ammo.set(slot, ammo.get(slot)! - 1));
```

Registered fields lose the agent's entry when it is removed. A field can own a resource: pass a cleanup and it runs with the agent's value before the entry is cleared, only if the agent had one.

```typescript
const models = tree.Field<Model>((slot, model) => model.Destroy());
const highlights = tree.Field<Highlight>((slot, h) => h.Destroy());
```

For teardown that is not tied to one field, `tree.OnAgentRemoved((slot, tree) => ...)` runs for every removed agent while its field values are still readable.

Nodes that need a value from you take a field: `Timer(field)`, `WasFieldUpdated([field, ...])`, and `Switch(selector, ...)` takes a function.

### Running and halting

Per (node, agent) a node is either idle or running. A node starts running the first time it is ticked while idle, and goes idle when it returns `SUCCESS` or `FAILURE`.

**Halting rule.** If a node is running for an agent at the end of a tick, then in the next tick it is either ticked again or halted. Never neither, never both. A parent that decides not to tick a child it left running halts it instead: a `ReactiveFallback` whose earlier child now succeeds halts the later one, `Parallel` with a `ONE` policy halts its siblings, `Timeout` halts its child when time runs out, and `RemoveAgent` and `Halt` halt from the root down.

Halting cascades along the running path, so a leaf's `OnHalt` always fires when its run is interrupted, no matter how deep it is.

### Leaf lifecycle

`Leaf` is the only node with user hooks. All are optional except `OnTick`.

| Hook                         | When                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `OnStart(slot, tree)`        | The leaf starts a run (idle → running), before `OnTick` in the same tick.                       |
| `OnTick(slot, dt, tree)`     | Every tick the leaf is visited. Returns the status.                                             |
| `OnSuccess(slot, tree)`      | `OnTick` returned `SUCCESS`.                                                                    |
| `OnFailure(slot, tree)`      | `OnTick` returned `FAILURE`.                                                                    |
| `OnHalt(slot, tree)`         | A running leaf was interrupted.                                                                 |
| `OnExit(status, slot, tree)` | After `OnSuccess` / `OnFailure`, and after `OnHalt` with `RUNNING` as the status.               |
| `OnEnter(slot, tree)`        | First tick the leaf is visited after not being visited. A visit span covers any number of runs. |
| `OnLeave(slot, tree)`        | End of the first tick the leaf is not visited, and on halt / `RemoveAgent`.                     |

Hooks are resolved once when the leaf is built. A leaf with only `OnTick` has no wrapper and no state at all; its `Tick` is your function. Only leaves with `OnStart` or exit hooks carry a `started` table, and only leaves with `OnEnter` / `OnLeave` carry the visit stamp (they are the same thing as wrapping the leaf in [Scoped](#scoped)).

Run hooks and visit hooks answer different questions. `OnStart` / `OnHalt` bracket one run of the leaf: an attack that completes and starts again gets `OnStart` twice. `OnEnter` / `OnLeave` bracket the whole span in which the leaf keeps being reached, across runs, until its branch is abandoned.

### Where OnBecameActivated / OnBecameInactive went

They are no longer hooks on every node. Tracking "was this node visited last tick" for every node is what the old tree's per-tick sets paid for, so in `BTree` it is a node you opt into: `Scope` brackets the span in which a position of the tree is visited, and only agents that pass through it pay for the stamp.

```typescript
BTree.Sequence(
	BTree.Condition((slot) => inCombat.get(slot) === true),
	BTree.Scope({
		OnEnter: (slot) => playCombatMusic(slot), // first visited tick
		OnExit: (slot) => stopCombatMusic(slot), // end of the first tick not visited
	}),
	// ...combat actions
);
```

`Scope` always returns `SUCCESS`. `Scoped(config, child)` does the same around a subtree and passes the child's status through, and a `Leaf` accepts the same pair as `OnEnter` / `OnLeave`. `OnExit` also fires on `Halt`, `HaltAll` and `RemoveAgent`.

Prefer `Scope` at the head of a branch, or `Scoped` around it, when the event is about the branch: a leaf's own visit span depends on where the leaf sits (later children of a `Fallback` are only visited when earlier ones fail).

Cost: about 30–40 ns per agent per tick and ~70 bytes per agent, only where the node sits and only for agents that reach it; the rest of the tree is unaffected. That is roughly one extra leaf visit, so place it where you need the enter/exit events rather than at every composite (16 of them on the wide benchmark tree doubled its tick time).

The same effect without a dedicated node is an always-running leaf inside `FireAndForget` (`OnStart` / `OnHalt` then bracket the visited span). Nodes that used the old hooks internally (`MemorySequence`, `WaitGate`, `OneShot`, `WasFieldUpdated`) detect the gap themselves with a per-agent tick stamp.

## Composite Nodes

### Sequence

Runs children left to right. `FAILURE` as soon as one child fails; `SUCCESS` when all succeed. Resumes at the running child next tick.

```typescript
BTree.Sequence(conditionNode, actionNode, anotherNode);
```

### Fallback

Runs children left to right. `SUCCESS` as soon as one child succeeds; `FAILURE` when all fail. Resumes at the running child.

### MemorySequence

Like `Sequence`, but a failing child is remembered and the sequence retries from it next tick instead of from the first child. The memory resets when the node was not visited in the previous tick.

### ReactiveSequence / ReactiveFallback

Re-evaluate every child from the first each tick. When a child returns `RUNNING` (or `SUCCESS`, for `ReactiveFallback`), the previously running child is halted if it is a different one.

### Parallel

Ticks every child each tick. Completed children keep their result until the `Parallel` finishes; running children are halted on an early exit. At most 32 children.

```typescript
BTree.Parallel(
	BTree.EParallelPolicy.ONE, // succeed when ONE child succeeds
	BTree.EParallelPolicy.ALL, // fail only when ALL children fail
	monitorNode,
	actionNode,
);
```

### IfThenElse

`IfThenElse(condition, then, else?)`. Evaluates the condition when starting; runs `then` on `SUCCESS`, `else` on `FAILURE` (`FAILURE` when there is no `else`). A running branch continues without re-evaluating the condition.

```typescript
BTree.IfThenElse(
	BTree.Condition((slot) => energy.get(slot)! > 50),
	aggressiveBehavior,
	defensiveBehavior,
);
```

### WhileDoElse

`WhileDoElse(condition, do, else?)`. Re-evaluates the condition every tick; runs `do` while it succeeds, `else` while it fails, halting the other branch on a switch. No branch runs while the condition itself is `RUNNING`.

### TryCatch

`TryCatch(try, catch, finally?)`. Runs `try`; on `FAILURE` runs `catch`; always runs `finally` when present, whose result is ignored.

### Switch

`Switch(selector, cases, default?)`. Calls `selector(slot, tree)` when starting, looks the value up in `cases`, and runs that child to completion; `default` when nothing matches, `FAILURE` when there is no default either.

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

## Decorator Nodes

Decorators take the child as an argument, after their parameters.

### Inverter

Swaps `SUCCESS` and `FAILURE`. `RUNNING` passes through.

### ForceSuccess / ForceFailure

Override the child's result unless it is `RUNNING`.

### ForceRunning

Ticks the child, restarting it whenever it completes, and always returns `RUNNING`.

### FireAndForget

Ticks the child and always returns `SUCCESS`. A child left `RUNNING` keeps running and is halted by the tree at the end of the first tick in which this node is not visited. See [Where OnBecameActivated went](#where-onbecameactivated--onbecameinactive-went).

### Scoped

`Scoped({ OnEnter?, OnExit? }, child)`. Runs the child and passes its status through; `OnEnter` fires on the first tick of a visited span, `OnExit` at the end of the first tick in which this node is not visited (and on halt). A running child is halted before `OnExit`. See [Scope](#scope) for the leaf form.

### RunningGate

Passes `SUCCESS` / `FAILURE` through and turns `RUNNING` into `FAILURE`. The child keeps running the same way as with `FireAndForget`.

### Timeout

`Timeout(seconds, child, behavior?)`. Halts the child and returns `behavior` (`ETimeoutBehavior.FAILURE` by default) once the child has been running longer than `seconds`.

```typescript
BTree.Timeout(10, longRunningNode, BTree.ETimeoutBehavior.SUCCESS);
```

### Cooldown

`Cooldown(seconds, child, reset_on_halt?)`. `FAILURE` while the cooldown runs; otherwise ticks the child and starts the cooldown when it completes. With `reset_on_halt`, being halted also starts the cooldown. Time only passes while the node is ticked.

```typescript
BTree.Cooldown(2.0, attackNode);
```

### Repeat

`Repeat(count, child, condition?)`. Runs the child `count` times, one completion per tick, returning `RUNNING` in between and `SUCCESS` at the end. `ERepeatCondition.SUCCESS` / `FAILURE` stop early (with `SUCCESS`) when the child returns anything else.

```typescript
BTree.Repeat(5, patrolStep, BTree.ERepeatCondition.SUCCESS);
```

### KeepRunningUntilSuccess / KeepRunningUntilFailure

`KeepRunningUntilSuccess(child, max_attempts = -1)`. Retries the child until it succeeds; `FAILURE` after `max_attempts` failures. `-1` means unlimited. The `Failure` variant mirrors it.

### OneShot

`OneShot(child, reset_on_inactive = false)`. Runs the child once and returns the cached result on every later tick. With `reset_on_inactive`, the result is forgotten when the node was not visited in the previous tick.

## Leaf Nodes

### Leaf

The general leaf with the full [lifecycle](#leaf-lifecycle).

```typescript
BTree.Leaf({
	Name: "Patrol",
	OnStart: (slot, tree) => {
		/* begin */
	},
	OnTick: (slot, dt, tree) => RUNNING,
	OnHalt: (slot, tree) => {
		/* interrupted */
	},
	OnSuccess: (slot, tree) => {},
	OnFailure: (slot, tree) => {},
	OnExit: (status, slot, tree) => {},
	OnEnter: (slot, tree) => {
		/* the leaf started being visited */
	},
	OnLeave: (slot, tree) => {
		/* the leaf stopped being visited */
	},
});
```

### Action

`Action((slot, dt, tree) => status, name?)`. Runs the callback each tick and returns its status. Equivalent to a `Leaf` with only `OnTick`.

### Condition

`Condition((slot, dt, tree) => boolean, name?)`. `SUCCESS` when the predicate holds, otherwise `FAILURE`.

### Callback

`Callback((slot, dt, tree) => void, name?)`. Runs the callback and returns `SUCCESS`.

### Scope

`Scope({ OnEnter?, OnExit? })`. Always returns `SUCCESS`. `OnEnter` fires on the first tick of a visited span, `OnExit` at the end of the first tick in which the node is not visited, and on `Halt` / `RemoveAgent`. The replacement for `OnBecameActivated` / `OnBecameInactive`; put it at the start of the branch whose visits you want to observe.

```typescript
BTree.Scope({
	OnEnter: (slot) => (highlights.get(slot)!.Enabled = true),
	OnExit: (slot) => (highlights.get(slot)!.Enabled = false),
});
```

### Plug

`Plug(status = SUCCESS)`. Always returns the given status. Useful for stubbing branches and for tests.

### Log

`Log(message)`. Prints the message and returns `SUCCESS`.

### Wait

`Wait(seconds)`. `RUNNING` for the duration, then `SUCCESS`.

### WaitGate

`WaitGate(seconds)`. `FAILURE` until `seconds` of visited ticks have passed, then `SUCCESS` and the timer restarts. The timer also restarts when the node was not visited in the previous tick. Never returns `RUNNING`.

### Timer

`Timer(field)`. Counts the agent's entry in `field` down by `dt` each tick; `SUCCESS` once it reaches zero, `FAILURE` while positive or absent.

```typescript
const alert = tree.Field<number>();
alert.set(slot, 5); // 5 seconds
BTree.Timer(alert);
```

### WasFieldUpdated

`WasFieldUpdated([field, ...], skip_first = false)`. `SUCCESS` when any of the fields changed for the agent since the previous visited tick. The first visit after a gap reports `SUCCESS` and takes a snapshot, or `FAILURE` with `skip_first`.

### FSMConnector / GoapConnector

`FSMConnector((slot, tree) => FSM.FSM)` starts the agent's FSM on start, updates it each tick (always `RUNNING`), and stops it on halt. `GoapConnector((slot, tree) => Goap.Agent)` updates the agent each tick and resets it on halt. Both take a getter because the FSM or GOAP agent is per agent while the node is shared.

```typescript
const fsms = tree.Field<FSM.FSM>();
BTree.FSMConnector((slot) => fsms.get(slot)!);
```

## BehaviorTree

| Member                             | Description                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `new BehaviorTree(root, options?)` | Creates a tree over a built root node. `options.external_ids: true` switches to external-id mode.                                |
| `UsesExternalIds()`                | Whether the tree is in external-id mode.                                                                                         |
| `AddAgent(id?)`                    | Adds an agent and returns its slot. Allocating mode: no argument. External-id mode: the entity id; throws if it is already live. |
| `RemoveAgent(slot)`                | Halts everything running for the agent, clears its entry in every node and registered field, frees the slot.                     |
| `Tick(dt)`                         | Ticks every live agent once.                                                                                                     |
| `GetStatus(slot)`                  | Root status of the agent from the latest tick, or `undefined`.                                                                   |
| `Halt(slot)` / `HaltAll()`         | Halt an agent (or all) without removing it; it restarts from the root next tick. Not allowed during `Tick`.                      |
| `Field<T>(cleanup?)`               | Creates and registers a per-agent `Map<Slot, T>`; `cleanup(slot, value)` runs on removal when the agent has a value.             |
| `RegisterField(map, cleanup?)`     | Registers an existing per-agent map so `RemoveAgent` clears it, with the same optional cleanup.                                  |
| `OnAgentRemoved(callback)`         | Registers `callback(slot, tree)`, run for every removed agent after halting and before its fields are cleared.                   |
| `HasAgent(slot)`                   | Whether the slot is live.                                                                                                        |
| `GetAgents()`                      | Live slots in tick order. Do not modify.                                                                                         |
| `GetAgentCount()`                  | Number of live agents.                                                                                                           |
| `GetRoot()`                        | The root node.                                                                                                                   |
| `TickCount`                        | Number of ticks so far. Nodes stamp per-agent state with it; do not modify.                                                      |

### What RemoveAgent does, in order

1. Halts everything running for the agent (leaf `OnHalt` hooks fire), including children detached by `FireAndForget` / `RunningGate`.
2. Clears the agent's entry in every node's state tables.
3. Runs the `OnAgentRemoved` callbacks. Field values are still readable here.
4. For each registered field in registration order: runs its cleanup with the value if the agent has one, then deletes the entry.
5. Frees the slot for reuse.

### Adding and removing during Tick

`AddAgent` and `RemoveAgent` may be called from callbacks. During a tick they are queued and applied after the walk: a removed agent is still ticked to the end of the current frame, and its running leaves receive `OnHalt` inside the same `Tick` call, after the walk. A leaf that removes its own agent should still return a status for the current tick. `Halt` and `HaltAll` throw during a tick.

## Writing Custom Nodes

A node is a table with `Name`, `Tick`, `Halt`, and `Maps`:

```typescript
interface Node {
	readonly Name: string;
	readonly Tick: (slot: Slot, dt: number, tree: BehaviorTree) => ENodeStatus;
	readonly Halt: (slot: Slot, tree: BehaviorTree) => void; // only called while running for that slot
	readonly Maps: Map<Slot, unknown>[]; // every per-agent table of this node and its descendants
}
```

The rules:

1. Keep per-agent state in `Map<Slot, ...>` tables captured by the closures. A missing key means idle. Reset state when a run starts, not when it ends, so a halted run cannot leak stale values.
2. Snapshot the children's `Tick` and `Halt` functions into locals or arrays at build time and call those.
3. `Halt` may assume the node is running for that slot. It must halt the child (or children) it left running, then clear its own entries.
4. `Maps` must list your own tables plus every child's `Maps`, so `RemoveAgent` can clear them.
5. A node that reports a non-`RUNNING` status while leaving a child running must call `tree.DetachRunning(last_seen, halt, slot)` each tick (see `FireAndForget` in the source) so the tree can halt the child when the node stops being visited.

A decorator that ticks its child only every N-th visit:

```typescript
function EveryNth(n: number, child: BTree.Node): BTree.Node {
	const count = new Map<BTree.Slot, number>();
	const child_running = new Map<BTree.Slot, true>();
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "EveryNth",
		Tick: (slot, dt, tree) => {
			if (child_running.has(slot)) {
				// finish the current child run before counting again
				const s = tick(slot, dt, tree);
				if (s !== RUNNING) child_running.delete(slot);
				return s;
			}
			const c = (count.get(slot) ?? 0) + 1;
			if (c < n) {
				count.set(slot, c);
				return FAILURE;
			}
			count.delete(slot);
			const s = tick(slot, dt, tree);
			if (s === RUNNING) child_running.set(slot, true);
			return s;
		},
		Halt: (slot, tree) => {
			count.delete(slot);
			if (child_running.has(slot)) {
				child_running.delete(slot);
				halt(slot, tree);
			}
		},
		Maps: [count, child_running, ...child.Maps],
	};
}
```

## Migrating from 0.3

| 0.3                                            | 0.4                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `new BTree.Sequence().AddChild(a).AddChild(b)` | `BTree.Sequence(a, b)`                                                                              |
| `new BTree.Timeout(child, 10)`                 | `BTree.Timeout(10, child)` (parameters first, child last, for every decorator)                      |
| `new BTree.BehaviorTree(root, bb)` per agent   | One `new BTree.BehaviorTree(root)`, then `AddAgent()` per agent                                     |
| `tree.Tick(dt)` per agent                      | `tree.Tick(dt)` once for all agents                                                                 |
| `(bb, dt) => ...` callbacks                    | `(slot, dt, tree) => ...`                                                                           |
| `bb.Get("hp")`                                 | `hp.get(slot)` with `const hp = tree.Field<number>()`                                               |
| `class X extends BTree.Node`                   | A factory returning `{ Name, Tick, Halt, Maps }`                                                    |
| `FullAction({...})`                            | `Leaf({...})`                                                                                       |
| `OnBecameActivated` / `OnBecameInactive`       | `Scope({ OnEnter, OnExit })` at the start of the branch, or `Scoped(config, subtree)`               |
| `Switch<T>("key").Case(v, node)`               | `Switch((slot) => key.get(slot), new Map([[v, node]]), default?)`                                   |
| `Timer("key")`                                 | `Timer(field)`                                                                                      |
| `WasEntryUpdated(["a", "b"])`                  | `WasFieldUpdated([a, b])`                                                                           |
| `SubTree(other)`                               | Use the other tree's root node directly (nodes are shareable, but not at two positions of one tree) |
| `FSMConnector(fsm)`                            | `FSMConnector((slot) => fsms.get(slot)!)`                                                           |
| `node.IsRunning()`                             | Not available on nodes; `tree.GetStatus(slot) === RUNNING` for the root                             |

`BTCreator` builds the new trees; see [btcreator.md](btcreator.md) for the changed registration API.

## Performance

Measured on the same trees in Roblox Studio (`--!optimize 2`, µs per agent per tick; `native` is `--!native`):

| Tree (agents)                | 0.3 native | 0.4 native | 0.3 interpreter | 0.4 interpreter |
| ---------------------------- | ---------: | ---------: | --------------: | --------------: |
| 21-node NPC tree (1000)      |       2.87 |       0.19 |            3.54 |            0.39 |
| Wide fallback, 49 (1000)     |       8.01 |       0.57 |            9.55 |            0.94 |
| 10 stacked decorators (1000) |       5.83 |       0.21 |            6.81 |            0.35 |
| Reactive + timeout (1000)    |       2.25 |       0.09 |            3.11 |            0.14 |

Garbage per agent per tick: 0.3 allocated 224–1120 bytes, 0.4 allocates 0. Memory per agent: 0.3 used 4–21 KB, 0.4 uses 0.1–0.3 KB.

What makes the difference, in order: one tree instead of one per agent; no per-tick sets (the halting rule replaces them); closures instead of metatable method dispatch; leaves specialised at build time so absent hooks cost nothing; dense slots keeping state tables in the array part.

# Writing Custom Behavior Tree Nodes

How to add your own composites and decorators to `BTree`. For leaves you never need this: `Leaf`, `Action`, `Condition` and `Callback` cover user code that runs per tick. Custom nodes are for **control flow** the built-ins don't have: a different way of choosing children, a different way of reacting to a child's status, a node that keeps its own per-agent counters or timers.

Every complete node in this guide is copied from [`src/tests/CustomNodes.test.ts`](../src/tests/CustomNodes.test.ts), where it is run by the test suite.

---

## The shape of a node

```typescript
interface Node {
	readonly Name: string;
	readonly Tick: (slot: Slot, dt: number, tree: BehaviorTree) => ENodeStatus;
	readonly Halt: (slot: Slot, tree: BehaviorTree) => void;
	readonly Maps: Map<Slot, unknown>[];
}
```

A node is a plain object with two functions and a list of tables. There is no class to extend and no registration step: build the object and place it in a tree.

The thing to hold in mind while writing one: **there is one instance of your node, and every agent runs through it.** Nothing about "this agent" lives on the node object; it lives in `Map<Slot, ...>` tables that the node's closures capture, keyed by the agent's slot. An agent that has never reached your node has no entries anywhere, and that is what "idle" means.

The types you use are all exported from `BTree`: `Node`, `Slot`, `TickFn`, `HaltFn`, `StateMap` (`Map<Slot, unknown>`), and `ENodeStatus`. Put the three statuses in module-level constants once; they read as upvalues, which is cheaper than the enum member each time:

```typescript
import { BTree } from "@rbxts/state-management";

const SUCCESS = BTree.ENodeStatus.SUCCESS;
const FAILURE = BTree.ENodeStatus.FAILURE;
const RUNNING = BTree.ENodeStatus.RUNNING;
```

`Map<Slot, T>` compiles to a plain Luau table: `get`, `set`, `has` and `delete` are table indexing, not calls. A per-agent map costs nothing until an agent gets an entry.

---

## The contract

These are the rules the tree relies on. Break one and the symptom is usually a leaf whose `OnHalt` never fires, or state that survives into an agent's next run.

**1. Per (node, agent), you are either idle or running.** You start running the first time `Tick` is called while idle, and you go idle when `Tick` returns `SUCCESS` or `FAILURE`. While running you own something: a child you left `RUNNING`, or state of your own (a timer, a cursor). An absent map key means idle.

**2. `Halt` is called only while you are running for that slot.** So `Halt` may assume its state is there: `cursor.get(slot)!` is fine. It must halt the child (or children) you left running and clear your own entries. Clear first, then halt, so a child hook that throws leaves nothing behind in your tables.

**3. The halting rule.** If a child was running at the end of a tick, then in the next tick you either tick it again or halt it. Never neither. A node that decides not to tick its running child (a gate that closed, a selector that chose another branch) halts it right there, in the same `Tick`. The tree does this from the root on `Halt` / `RemoveAgent`; between those, it is your job. The exception is a node that *deliberately* leaves a child running while reporting a non-`RUNNING` status; see [DetachRunning](#leaving-a-child-running-detachrunning).

**4. `Maps` lists every per-agent table of yours plus every child's `Maps`.** `RemoveAgent` walks this list and deletes the agent's key from each. Forget one and a recycled slot inherits the old agent's state.

**5. Snapshot children at build time.** Read `child.Tick` and `child.Halt` into locals (or parallel arrays) when the node is built, and call those. Never index `children[i].Tick` inside `Tick`.

**6. Reset state when a run starts, not when it ends.** A halted run may not get to its "end" code. If your `Tick` starts by writing the fresh value for a new run, a stale entry can never leak into the next one.

---

## Example 1: a pass-through decorator

A node with nothing of its own. It ticks its child and passes the status through, doing something on the way:

```typescript
function Trace(label: string, child: BTree.Node, out: string[]): BTree.Node {
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "Trace",
		Tick: (slot, dt, tree) => {
			const s = tick(slot, dt, tree);
			if (s !== RUNNING) out.push(`${label}:${s === SUCCESS ? "success" : "failure"}`);
			return s;
		},
		// We are running exactly when the child is running, so a halt is always the child's halt.
		Halt: halt,
		Maps: child.Maps,
	};
}
```

The invariant that makes this correct: `Trace` is `RUNNING` if and only if its child is. So when the tree halts `Trace`, the child is running and `child.Halt` is the right thing to call; passing the child's `Halt` through directly is the whole implementation. `Inverter`, `ForceSuccess` and `Log` in the built-ins are this shape.

---

## Example 2: a decorator with per-agent state

A gate that only lets the child run while a predicate holds, and interrupts it when the predicate stops holding:

```typescript
function Gate(pred: (slot: BTree.Slot, tree: BTree.BehaviorTree) => boolean, child: BTree.Node): BTree.Node {
	const child_running = new Map<BTree.Slot, true>();
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "Gate",
		Tick: (slot, dt, tree) => {
			if (!pred(slot, tree)) {
				// Closing the gate on a running child: we stop ticking it, so we must halt it (halting rule).
				if (child_running.has(slot)) {
					child_running.delete(slot);
					halt(slot, tree);
				}
				return FAILURE;
			}
			const s = tick(slot, dt, tree);
			if (s === RUNNING) child_running.set(slot, true);
			else child_running.delete(slot);
			return s;
		},
		Halt: (slot, tree) => {
			// Only called while we are RUNNING, which means the child is running: clear, then halt it.
			child_running.delete(slot);
			halt(slot, tree);
		},
		Maps: [child_running, ...child.Maps],
	};
}
```

Two things to notice. `child_running` exists only for the "gate closes while the child runs" case: without it the node could not know whether there is anything to halt. And the `Halt` path deletes its entry before halting the child (rule 2), so if the child's `OnHalt` throws, `Gate` has already left a clean state.

Why not `Sequence(Condition(pred), child)`? A plain `Sequence` resumes at its running child without re-checking earlier ones; `ReactiveSequence(Condition(pred), child)` does re-check, and is what you would normally use. `Gate` is the same behaviour written as a decorator, which is the point of the example.

---

## Example 3: a composite with a cursor

Composites hold their children in parallel arrays of `Tick` and `Halt` functions, and remember which child is running in a `cursor` map. This one starts each run one child further than the last:

```typescript
function RoundRobin(...children: BTree.Node[]): BTree.Node {
	const n = children.size();
	const ticks = new Array<BTree.TickFn>(n);
	const halts = new Array<BTree.HaltFn>(n);
	const start_at = new Map<BTree.Slot, number>(); // child the next run starts with; lives across runs
	const cursor = new Map<BTree.Slot, number>(); // child running now; absent when idle
	const maps: BTree.StateMap[] = [start_at, cursor];
	for (let i = 0; i < n; i++) {
		ticks[i] = children[i].Tick;
		halts[i] = children[i].Halt;
		for (const m of children[i].Maps) maps.push(m);
	}
	return {
		Name: "RoundRobin",
		Tick: (slot, dt, tree) => {
			let i = cursor.get(slot);
			if (i === undefined) {
				i = start_at.get(slot) ?? 0;
				start_at.set(slot, (i + 1) % n);
			}
			const s = ticks[i](slot, dt, tree);
			if (s === RUNNING) cursor.set(slot, i);
			else cursor.delete(slot);
			return s;
		},
		Halt: (slot, tree) => {
			const i = cursor.get(slot)!;
			cursor.delete(slot);
			halts[i](slot, tree);
		},
		Maps: maps,
	};
}
```

`cursor` and `start_at` are both per-agent, but they have different lifetimes. `cursor` is *run* state: set while a child is running, deleted when the run ends or is halted. `start_at` is meant to outlive runs; it is only ever cleared by `RemoveAgent`, through `Maps`. Both kinds are fine; just be clear which is which, and make sure `Halt` clears the run state.

`Sequence`, `Fallback` and `MemorySequence` in the source are this pattern with a loop over the children instead of a single pick.

---

## Example 4: "was I visited last tick"

Some nodes need to know whether the agent reached them in the previous tick: `MemorySequence` forgets its memory after a gap, `WaitGate` restarts its timer, `OneShot(reset)` re-arms. The tree provides `tree.TickCount` for this. Stamp it on every visit and compare with `now - 1`:

```typescript
function Streak(n: number): BTree.Node {
	const count = new Map<BTree.Slot, number>();
	const last_seen = new Map<BTree.Slot, number>();
	return {
		Name: "Streak",
		Tick: (slot, _dt, tree) => {
			const now = tree.TickCount;
			const c = (last_seen.get(slot) === now - 1 ? (count.get(slot) ?? 0) : 0) + 1;
			last_seen.set(slot, now);
			count.set(slot, c);
			return c >= n ? SUCCESS : FAILURE;
		},
		Halt: () => {}, // never RUNNING, so never halted
		Maps: [count, last_seen],
	};
}
```

`Streak(3)` returns `SUCCESS` from the third consecutive visited tick on, and starts over after any tick in which its branch was not reached.

`TickCount` is the frame number of whatever drives the agent: the tree's own counter under `Tick()`, and that agent's counter under `TickAgent()`. You do not need to care which, as long as an agent keeps one driver for its life (see "Tick or TickAgent, not both" in [behavior-tree.md](behavior-tree.md#tick-or-tickagent-not-both)). Do not write to it.

A node that never returns `RUNNING` is never halted, so its `Halt` can be a no-op. It still lists its maps.

---

## Example 5: a hook after halting a child (`HaltChild`)

Sometimes a node wants to do something *after* halting its child: notify, clean up, play an "interrupted" animation. If the child's `OnHalt` throws, plain `halt(slot, tree)` would unwind past your code. `tree.HaltChild(halt, slot)` runs the halt under `pcall`, records the error for the tree to rethrow once the cascade is complete, and returns normally:

```typescript
function OnInterrupt(callback: (slot: BTree.Slot, tree: BTree.BehaviorTree) => void, child: BTree.Node): BTree.Node {
	const tick = child.Tick;
	const halt = child.Halt;
	return {
		Name: "OnInterrupt",
		Tick: tick, // nothing to add on the tick path: our Tick is the child's
		Halt: (slot, tree) => {
			// Guarded, so a throwing hook inside the child cannot skip the callback.
			tree.HaltChild(halt, slot);
			callback(slot, tree);
		},
		Maps: child.Maps,
	};
}
```

Use `HaltChild` when you halt **more than one** child in a row (as `Parallel` does: a throw in the first would otherwise skip the rest), or when **code of yours follows** the halt. When `Halt` does nothing but halt one child, call the child's `Halt` directly: the cascade above you is already guarded, and the `pcall` would be wasted.

Note `Tick: tick`. When your node adds nothing on the tick path, hand the child's function through instead of wrapping it; that is the difference between a free node and one that costs a call per visit.

---

## Leaving a child running (`DetachRunning`)

The halting rule assumes that whoever leaves a child running is `RUNNING` too, so the tree's cascade reaches it. `FireAndForget` breaks that on purpose: it returns `SUCCESS` while its child keeps running, so its parent moves on and would never tell it to halt the child. For that case the tree keeps a list of *detached* children and halts them itself at the end of the first tick in which the detaching node was not visited. The node has to tell the tree each tick, which is what `DetachRunning` is. This is `FireAndForget`, as in the source but written with the public API (the source uses two internal helpers for the node object and the maps):

```typescript
export function FireAndForget(child: Node): Node {
	const child_running = new Map<Slot, true>();
	const last_seen = new Map<Slot, number>();
	const maps: StateMap[] = [child_running, last_seen, ...child.Maps];
	const ct = child.Tick;
	const ch = child.Halt;
	const halt: HaltFn = (slot, tree) => {
		if (child_running.has(slot)) {
			child_running.delete(slot);
			ch(slot, tree);
		}
	};
	return {
		Name: "FireAndForget",
		Tick: (slot, dt, tree) => {
			if (ct(slot, dt, tree) === RUNNING) {
				child_running.set(slot, true);
				tree.DetachRunning(last_seen, halt, slot); // "halt this for me if I am not visited next tick"
			} else {
				child_running.delete(slot);
			}
			return SUCCESS;
		},
		Halt: halt,
		Maps: maps,
	};
}
```

`DetachRunning(last_seen, halt, slot)` stamps `last_seen[slot]` with the current tick and records `(last_seen, halt, slot)`. At the end of the next frame the tree looks at the stamp: if the node was visited again it re-recorded itself and nothing happens; if not, the tree calls `halt(slot, tree)`. The `halt` you pass must be safe to call whether or not the child is still running (hence the `child_running` check), because `Halt` / `RemoveAgent` may reach it first.

This costs about 90 ns per visit natively in Studio (roughly eight plain node visits) and about twice that on the interpreter, so only reach for it when the node really needs to report a status different from its child's while the child keeps going. `FireAndForget`, `RunningGate`, `Scope` and `Scoped` are the built-ins that do.

---

## Calling the tree from inside a node

Your `Tick` and `Halt` receive the tree, and hooks you run receive it too. What is allowed while the tree is inside a call:

| Call | During `Tick` / `TickAgent` | During a halt or removal cascade |
| --- | --- | --- |
| `AddAgent`, `RemoveAgent` | queued, applied after the walk | queued, applied after the cascade |
| `Halt`, `HaltAll` | throws | allowed for another agent; a no-op for the one being halted |
| `Tick` | throws | throws |
| `TickAgent` | throws | allowed for another agent on a `TickAgent`-driven tree; throws for the agent being removed |
| `GetStatus`, `HasAgent`, fields | fine | fine |

An error thrown from your node or from a hook it runs does not corrupt the tree: the walk, halt or removal it interrupted completes and the outermost tree call rethrows the first error. The full rules are under "When a hook throws" in [behavior-tree.md](behavior-tree.md#when-a-hook-throws). Prefer not to throw from tick paths anyway; the agent whose walk threw keeps the state its walk reached, and only its next tick moves it on.

---

## Resolve options at build time

`Tick` runs per agent per frame; the factory runs once. Move every decision that does not depend on the agent out of `Tick`:

```typescript
function Countdown(seconds: number, child: BTree.Node, on_expire?: (slot: BTree.Slot) => void): BTree.Node {
	// ...
	// Pick the closure once, instead of testing `on_expire` on every tick:
	const expire = on_expire !== undefined
		? (slot: BTree.Slot) => { time_left.delete(slot); on_expire(slot); }
		: (slot: BTree.Slot) => { time_left.delete(slot); };
	// ...
}
```

And when a configuration makes your node a no-op, return the child itself: `Repeat(1, child)` has nothing to add, so returning `child` gives a tree with one node fewer. `Leaf` does exactly this: a leaf with only `OnTick` *is* the user's function, with no wrapper and no state.

---

## Performance notes

The built-in nodes tick at 10–30 ns each natively. Yours can too; these are the things that make the difference, in the order they usually matter.

- **No allocation in `Tick`.** Map writes to a key that exists don't allocate; the first write for a new agent does (once, and `RemoveAgent` frees it). What does allocate every time: creating a closure or table, `...children`-style spreads, string interpolation, and `pcall`'s error path. Deleting and re-setting the same key each tick is fine (`Sequence` does it with its cursor). The bench harness in `luau-bench/` measures bytes per agent-tick; a correct node reads 0.
- **`for (let i = 0; i < n; i++)` is not a numeric for.** roblox-ts cannot prove `n` is constant, so it emits a `while true` loop with a `_shouldIncrement` flag. Fine at build time (the `RoundRobin` example does it there); in a `Tick` that loops over children write `let i = 0; while (i < n) { ...; i++; }` as the built-in composites do.
- **Return the constants.** `return SUCCESS` (a module-level `const`) compiles to an upvalue read; `return BTree.ENodeStatus.SUCCESS` is a table lookup.
- **Don't pre-check.** `if (m.has(slot)) { const v = m.get(slot)! ... }` is two lookups; `const v = m.get(slot); if (v !== undefined) ...` is one. Probing an absent key costs ~7 ns natively; a guard to avoid it costs the same.
- **Few maps.** Every map entry is 40–60 bytes per agent that reaches the node. Two booleans can be one map holding a small integer; a "started" flag and a cursor can often be the same map.
- **Measure.** `luau-bench/README.md` describes the Lune harness and the Studio runner; `luau-bench/tests/btree_extra.luau` shows how to require the built package from a Lune script. A micro tree of `Sequence(YourNode(...), Plug(SUCCESS))` with 1000 agents ticked 200 frames gives a stable ns-per-visit number in a few seconds.

---

## Registering a node with BTCreator

`BTCreator` builds trees from JSON by node kind. Add yours with `AddNodeCreator`; the creator receives the `BTCreator` positioned on the node being built, with helpers for its children and parameters:

```typescript
const creator = new BTCreator();

// A composite: children only.
creator.AddNodeCreator("RoundRobin", (c) => RoundRobin(...c.GetCurrentChildren()));

// A leaf-like node with a numeric parameter (`"parameters": { "count": 3 }` in the JSON).
creator.AddNodeCreator("Streak", (c) => Streak(c.GetCurrentNodeParameter("count", "number")));

// A decorator whose predicate reads a registered field (`"parameters": { "field": "can_attack" }`).
creator.AddNodeCreator("Gate", (c) => {
	const field = c.GetField<boolean>(c.GetCurrentNodeParameter("field", "string"));
	return Gate((slot) => field.get(slot) === true, c.GetCurrentChild());
});
```

The helpers: `GetCurrentChildren()` / `GetCurrentChild()` (already built), `GetCurrentNodeParameter(name, "string" | "number")`, `GetCurrentNodeOptionalString(name)`, `GetField(name)`. Register the kind before `Build()` / `BuildRoot()`, which is when creators are looked up; the kind name is what the JSON node's `"name"` must match. To place it from the visual editor, add the kind to the palette in `external/BTCreatorApp/frontend/src/Features/BehaviorTree/Resources/NodeTypes.ts`; see [btcreator.md](btcreator.md).

---

## Testing a node

The examples above are tested in [`src/tests/CustomNodes.test.ts`](../src/tests/CustomNodes.test.ts); copy its shape. A `probe` leaf that logs `OnStart` / `OnHalt` under your node lets you assert the three things that matter:

1. **Statuses** over a sequence of ticks, including a resumed run.
2. **The halting rule**: put the node under a `ReactiveSequence(Condition(flag), ...)`, flip the flag while a child is running, and assert the probe logged `halt` exactly once. Also `tree.Halt(slot)` and `tree.RemoveAgent(slot)` mid-run.
3. **Cleanup**: after `RemoveAgent`, every map in `node.Maps` has `size() === 0`.

Run the suite under Lune without Studio: `bun run build && bun x rbxtsc -p tsconfig.tests.json && lune run luau-bench/tests/run_rbxts_tests.luau CustomNodes`.

---

## Checklist

- [ ] Per-agent state is in `Map<Slot, ...>` tables captured by the closures; absent key = idle.
- [ ] Children's `Tick` / `Halt` are snapshotted at build time.
- [ ] `Tick` halts any running child it decides not to tick again (or uses `DetachRunning` on purpose).
- [ ] `Halt` clears own entries first, then halts the running child; `HaltChild` if more than one thing is halted or code follows.
- [ ] `Maps` lists every own table and every child's `Maps`.
- [ ] Nothing allocates per tick; hot loops are `while` loops; statuses are returned from constants.
- [ ] Tested: statuses, one `OnHalt` on interruption, empty maps after `RemoveAgent`.

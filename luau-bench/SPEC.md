# Behavior tree rework: design bench

This folder is a Lune test bed for redesigning `BTree` (`src/BehaviorTree.ts`). Nothing here ships;
it exists to measure design alternatives against the current implementation before any TypeScript is
written. `baseline/BehaviorTree.luau` is the current implementation compiled by roblox-ts.

## What is wrong with the current design

- One node **object per agent**: every agent owns a full tree instance. Memory scales with agents × nodes.
- Every `BehaviorTree:Tick` allocates two fresh sets (`running_nodes`, `active_nodes`) and diffs them
  against last tick's sets. Steady-state garbage every frame.
- Method dispatch through metatable `__index` chains (Leaf → Decorator/Composite → Node), five hook calls
  per node per tick even when the hooks are empty no-ops.
- Five tick arguments threaded through every call.

## Goals of the rework

1. **One handler per node.** The tree is built once; every node exists once and is shared by all agents.
   Agents are integer ids. Per-agent state lives in **Struct-of-Maps** tables keyed by agent id
   (`time_left[agent]`, `cursor[agent]`), held by the node (closure upvalues or a per-node table).
   The same factory can be registered many times (two Sequences in a tree are two nodes), but never
   once per agent.
2. **Fast and allocation free in steady state.** No per-tick sets. Nothing allocated per tick once agents
   exist. Must be good for 1 agent and for 1000 agents on one tree.
3. **Easy API.** Nodes are declared by factories. Adding a new node kind must be small. Leaves have three
   optional hooks: `on_start(agent)`, `on_tick(agent, dt) -> status`, `on_halt(agent)`.
   `OnBecameActivated` / `OnBecameInactive` are dropped: the same effect is a leaf that does its work in
   `on_start`, returns RUNNING from `on_tick`, and undoes it in `on_halt` (wrapped in a Parallel or
   ForceRunning-style node so it stays running while the branch is visited).
4. **Per-agent storage besides node state: SoM blackboard.** A blackboard is a table of per-field maps
   keyed by agent id (`bb.health[agent]`), not SoA with dense indices (painful to keep compact on
   add/remove). The harness's own blackboard is SoM (`ctx.bb.last_attack[agent]`). Node-internal state
   should use the same pattern. Dense-index storage (`buffer`, flat arrays) is allowed as an experiment
   inside a node, but report what it costs in bookkeeping.
5. Ids are chosen by the caller (the harness) and may be reused after removal. Keep no assumption that
   ids are dense or small, but do exploit that they are integers (array part when dense).

## Status codes

`SUCCESS = 0`, `FAILURE = 1`, `RUNNING = 2` (`harness/status.luau`). Leaves return these numbers.

## Semantics (the differential test enforces these against the baseline)

Per (node, agent) a node is either idle or running.

**Tick(node, agent, dt)**
- If idle: the node becomes running and *starts*: a leaf calls `on_start(agent)` if present; composites and
  decorators reset their per-agent cursor/timer. Then, in the **same tick**, the node ticks.
- Leaf tick returns SUCCESS / FAILURE / RUNNING. On SUCCESS or FAILURE the node goes idle (its next tick
  starts again). Composite tick ticks children as described in the catalogue.

**Halt(node, agent)**, only if the node is running for this agent: halt every child that is running for
this agent (recursively), call the leaf's `on_halt(agent)` if present, node goes idle. A halted node
produces no result.

**The halting rule.** If node X is running for agent A at the end of tick T, then during tick T+1
exactly one of these happens to X for A: it is ticked, or it is halted. Never neither, never both.
Consequences:
- a composite that skips a child that is running (reactive restarts, Parallel early-out, Timeout) halts it;
- `remove_agent` halts the root for that agent, so every running leaf gets `on_halt`;
- an implementation may halt mid-tick (when the parent decides to skip) or at end of tick (sweep):
  the test compares the **multiset** of leaf events per tick, not their order.

**Node catalogue** (baseline behaviour; timers count down exactly `time_left -= dt`):

| Node | Behaviour |
|---|---|
| Sequence | start: cursor = 1. Tick children from the cursor: RUNNING → remember cursor, return RUNNING; FAILURE → FAILURE; all SUCCESS → SUCCESS. |
| Fallback | Same with SUCCESS / FAILURE swapped. |
| ReactiveSequence / ReactiveFallback | No cursor: every tick starts at child 1. When a child returns RUNNING (or SUCCESS for ReactiveFallback), halt every *other* running child and return that status. |
| Parallel(success_policy, failure_policy), policies ALL or ONE | Each tick, tick every child that has not completed during this run; completed children keep their result until the Parallel finishes. ONE: the first SUCCESS (or FAILURE) per policy halts the other children and returns. ALL: SUCCESS when all succeeded, FAILURE when all failed, else RUNNING. The completed set clears on start and exit. |
| Inverter / ForceSuccess / ForceFailure | Map the child's result. RUNNING passes through. |
| Repeat(count) | start: n = 0. Tick child: RUNNING → RUNNING; else n += 1; n >= count → SUCCESS else RUNNING (one child run per tick). |
| Wait(seconds) | start: time_left = seconds. Tick: time_left -= dt; time_left <= 0 → SUCCESS else RUNNING. |
| Timeout(seconds) | start: time_left = seconds. Tick: time_left -= dt; if <= 0 → halt child, return FAILURE; else return the child's tick. |
| Cooldown(seconds) | Per-agent time_left starts at 0 and persists across runs. Tick: time_left -= dt; if > 0 → FAILURE without ticking the child; else tick the child and return its result. When the child returned SUCCESS or FAILURE and time_left <= 0, set time_left = seconds. Halt changes nothing. |
| Leaf | `{ kind = "Leaf", name, on_start?, on_tick, on_halt? }`. Hooks are optional; a design should not pay for absent hooks. |

Not needed here: Log, Switch, IfThenElse, WhileDoElse, TryCatch, KeepRunningUntil*, OneShot,
WasEntryUpdated, Timer, SubTree, FSM/GOAP connectors. Mention in your report how they would map.

## Adapter contract

`cases/<name>.luau` returns:

```lua
{
  name = "<name>",
  new_world = function(spec) -> world      -- build the shared tree once from the spec (harness/scenarios.luau)
  add_agent = function(world, id)          -- id: positive integer chosen by the harness, may be reused later
  remove_agent = function(world, id)       -- halts everything running for id (on_halt fires), frees its state
  tick = function(world, dt)               -- ticks every live agent, any order or batching
  get_status = function(world, id) -> root status for id from the latest tick
}
```

Spec format and scenario trees: `harness/scenarios.luau`. Reference adapter: `harness/baseline_adapter.luau`.

## Running

```
lune run luau-bench/harness/runner.luau <case> [<case>...] [--quick] [--no-check] [--no-bench]
                                        [--agents=1,10,100,1000] [--scenario=npc|wide|deep|reactive]
```

`baseline` is a valid case name. The differential correctness test (4 scenarios × 80 ticks with agent
add / remove / id reuse, dt = 0.125 so timer arithmetic is exact) runs first; benchmarks run only for
cases that pass. Run from the repo root.

Metrics:
- **us/agent-tick**: best of 3 reps of `ticks × agents` (60k agent-ticks per rep, 15k with `--quick`).
- **B/agent-tick**: median of per-tick heap deltas. A 32 MB pad keeps GC sweeps rare so the median is
  the true allocation (validated to the byte on synthetic loads).
- **KB/agent (add + 1st tick)**: bytes allocated by `add_agent` plus the first tick, per agent. For the
  baseline this is the per-agent tree; for shared-tree designs it is per-agent state growth.

Lune 0.10 compiles required modules with Luau **native codegen** (verified: a sqrt loop runs at ~2 ns/iter
through `require` vs ~21 ns through `luau.load` with `codegenEnabled = false`), so the runner's numbers
correspond to Roblox `--!native`, which is how this package is compiled. `results/microbench.md` measures
every micro-op in both modes; under the plain interpreter calls are relatively cheaper and indexing
relatively dearer, but the orderings that matter (dense vs sparse keys, metatable chains, absent-key
probes, per-tick allocation) hold in both.

## Deliverables per case

1. `cases/<name>.luau` that passes correctness. Variants go in `cases/<name>_<variant>.luau` and are run the
   same way.
2. `results/<name>.md`: the runner's table for your case(s) and `baseline` from the same run; the variants
   you tried with their numbers; an API sketch (how a user declares a tree, a leaf, and a new composite);
   how halting works; pros/cons; a verdict on the hypothesis.

Rules: do not edit `harness/`, `baseline/`, or other cases. If the harness or the spec looks wrong, say so in
the report with a minimal repro rather than working around it. No node instances per agent.

# Behavior tree rework: what the experiments say

Six parallel experiments, each a full implementation of the SPEC.md node catalogue that passes the
differential test against the current tree (4 scenarios × 80 ticks, agent add/remove/id reuse).
Full per-case reports: `oop_shared.md`, `closure_single.md`, `closure_batch.md`, `flat_dispatch.md`,
`flat_batch.md`, `microbench.md`. Final consolidated run (one quiet process, all cases together):
`_final_run.txt`. Reproduce: `lune run luau-bench/harness/runner.luau baseline oop_shared_alias closure_single closure_batch flat_dispatch_pernode flat_batch flat_batch_buffer`.

All numbers are **Luau native codegen** numbers: Lune 0.10.5 compiles required modules natively
(verified: 2.0 ns/iter through `require` vs 21 ns with codegen disabled). That matches how this package
ships (`//!native`). `microbench.md` has every micro-op in both modes.

## Final table (µs per agent-tick; garbage B per agent-tick; KB per agent)

| case | npc 1 | npc 1000 | wide 1 | wide 1000 | deep 1 | deep 1000 | reactive 1 | reactive 1000 | garbage | KB/agent (1000) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (current) | 1.95 | 2.51 | 5.41 | 7.17 | 4.66 | 5.29 | 1.62 | 1.79 | 224–1120 | 4.3–20 |
| oop_shared_alias | 0.194 | 0.184 | 0.525 | 0.618 | 0.408 | 0.367 | 0.233 | 0.203 | 0 | 0.14–1.1 |
| **closure_single** | **0.113** | 0.175 | **0.304** | 0.505 | **0.197** | 0.168 | **0.100** | 0.074 | 0 | **0.08–0.27** |
| closure_batch | 0.246 | **0.134** | 0.620 | 0.470 | 0.265 | **0.060** | 0.158 | **0.050** | 0 | 0.13–0.35 |
| flat_dispatch_pernode | 0.200 | 0.197 | 0.432 | 0.539 | 0.375 | 0.293 | 0.131 | 0.104 | 0 | 0.10–0.61 |
| flat_batch | 0.353 | 0.149 | 0.845 | 0.545 | 0.428 | 0.122 | 0.263 | 0.057 | 0 | 0.11–0.53 |
| flat_batch_buffer | 0.386 | 0.120 | 0.901 | **0.367** | 0.465 | 0.114 | 0.268 | 0.066 | 0 | 0.13–0.81 |

Scenarios: `npc` 21 nodes / depth 4, `wide` fallback over 16 sequences, `deep` 10 stacked decorators,
`reactive` reactive composites + timeout with heavy halting.

## Findings, in order of how much they matter

1. **Sharing the tree and dropping the per-tick sets is the win.** The control experiment kept the
   baseline's classes and metatables and changed only "tree per agent" → "one tree + Struct-of-Maps state"
   and "two fresh sets per tick" → "explicit halt cascade": 7–14x faster, zero garbage, 15x less memory
   per agent, 50–80x cheaper agent creation. Everything else is layered on top of that.
2. **Closures per node beat classes and flat arrays.** A closure call, a `node.tick` call, `handlers[kind]`
   and `fns[id]` all cost ~7 ns; a 2-level `__index` chain costs 43 ns and codegen does not fix it. Flat
   node arrays make the same number of calls as closures and add 2–5 ns of index reads per visit, so they
   are never faster and are 1.5–1.7x slower at 1 agent. Calls are the budget: ~10 ns per call vs ~1 ns per
   array read.
3. **Specialize leaves at build time.** A leaf with only `on_tick` must *be* the user's function (no
   wrapper, no state). Probing a node table for an absent hook costs 6.7 ns each (15x a present key,
   natively); `if fn then fn() end` with a nil local is free. Not doing this cost up to +94% on the
   reactive scenario. Return status codes from upvalues/locals, not literals (+3.9 ns per return).
4. **Halting = explicit cascade via cursors.** A parent that returns RUNNING has exactly one running child
   (Sequence/Fallback/decorators) or a bitmask of them (Parallel); halting walks that path. This is the
   "RUNNING propagates upward" idea and it needs no sets. The epoch-stamp + sweep alternative is 20–57%
   slower, costs 2x memory, and cannot express Parallel ONE preempting a sibling that already ran this
   tick. Gotchas: Repeat can be RUNNING with an idle child (needs its own flag); reset per-agent state on
   start, not on exit, or halted runs leak stale state.
5. **Dense slots for per-agent state.** All cases were measured with dense ids 1..N. With sparse ids
   (entity ids) the same SoM read costs 9.8 ns instead of 0.9 ns and 2x the memory; a 20-node tree would
   pay ~380 ns per agent-tick in hash lookups, more than batching can ever win back. The tree must hand
   out a dense slot on `AddAgent` (free-listed on remove) and key every map by slot.
6. **Batching is real but modest, and it costs node authors.** Over the same closure nodes walked per
   agent, node-major batching gains 1.1–1.35x on the realistic trees and 2.75x on the decorator chain at
   1000 agents, loses below ~32 agents (crossover ≈100 vs the best per-agent design), and a batched
   IfThenElse is ~70 lines against ~15. Out-lists handed down by the parent beat a shared status array
   (2x on deep); level-synchronous worklists are a dead end. A batched leaf hook would add another
   15–35%. The batch wins come from amortizing per-node work; cursors that drop RUNNING/failed agents
   are what shrink the batch, so they limit batching rather than enable it.
7. **`buffer` state** only pays on the wide tree (1.3x) and needs sentinel values instead of nil. With
   dense slots already in the design its bookkeeping is small, so it stays an optional micro-optimization
   for composite cursors, not a foundation.
8. **SoM beats AoS for per-agent state** (5–12% faster, 4x less memory, 5x cheaper add).

## Recommended direction

`closure_single` as the core, with the slot rule from (5):

- A tree is built once from factories: `Sequence{...}`, `Fallback{...}`, `Parallel(..)`, `Wait(s)`,
  `Cooldown(s, child)`, `Leaf{on_start?, on_tick, on_halt?}`. A node is `{tick(slot, dt) -> status,
  halt(slot), maps}`; composites copy children into parallel closure arrays at build time.
- Per-agent state is one small map per field per node, keyed by slot, lazily filled; `maps` lets
  `RemoveAgent(slot)` clear a slot everywhere after halting the root for it.
- `AddAgent(entity) -> slot`; leaves receive the slot and the tree keeps `entities[slot]`.
- The user blackboard is SoM keyed by slot: fields registered with the tree/world (`Field<T>()` returning
  a plain map) so removal clears them; each access is one array read instead of a string-keyed hash
  lookup.
- No `OnBecameActivated/Inactive`; `on_start`/`on_halt` bracket the running span.
- Batching stays an opt-in second runtime for crowd use if ever needed; keep leaf hook signatures
  compatible with a future `on_tick_batch`.

Rough per-frame cost for 1000 agents on the npc tree: 2.5 ms and 480 KB of garbage today; 0.17 ms and
0 B with the recommended design; 0.13 ms batched.

## Harness caveats

- `KB/agent (add + 1st tick)` is a single positive-delta sample; trust the 1000-agent column, not 1.
- `B/agent-tick` is a median, so a rare allocation (e.g. a map growing) does not show.
- Windows Luau build; ratios are what matter.

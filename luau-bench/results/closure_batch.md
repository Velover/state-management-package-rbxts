# closure_batch — node-major batch processing

Hypothesis under test: a node processes an **array of agents per tick** (`process(agents, n, dt)`)
instead of being called once per agent; a parent forwards subsets of the batch to its children, agents
resume at their per-agent cursor, halting is driven by "running last tick, not forwarded this tick".

**Verdict up front:** the batch idea is real but narrow. It buys **1.2x–2.8x over the identical per-agent
closure design at 1000 agents** and **15x–91x over the baseline**, but it only pays once the batch stops
fragmenting: the crossover is ~4 agents on `deep`, ~16 on `reactive`, ~32–64 on `wide` and ~100 on `npc`,
and below that it is 1.2x–1.7x *slower* than per-agent recursion. All cases are allocation free in steady
state (0 B/agent-tick). Details, and the cost of the added node-author complexity, below.

## Cases in this folder

| file | result channel | Sequence/Fallback cursor handling | note |
|---|---|---|---|
| `cases/closure_batch.luau` | out-lists (b) | bucketed (c) | **main**, best at every N >= 100 |
| `cases/closure_batch_scan.luau` | out-lists (b) | one filter pass per child | isolates (c) |
| `cases/closure_batch_status.luau` | shared `status[agent]` (a) | bucketed (c) | isolates (a) vs (b) |
| `cases/closure_batch_status_scan.luau` | shared `status[agent]` (a) | one filter pass per child | the naive way to write it |
| `cases/closure_batch_control.luau` | return value | — | **control**: same factories/semantics, walked recursively once per agent |

`closure_batch_control` was written before `cases/closure_single.luau` appeared; both are in the table.
`closure_single` is another agent's per-agent design; `closure_batch_control` is *my* node code with only
the calling convention changed, so the `closure_batch` vs `closure_batch_control` delta isolates batching
and nothing else. The two agree within ~10% nearly everywhere, which is a useful cross-check.

## 1. Final full run

`lune run luau-bench/harness/runner.luau baseline closure_single closure_batch_control closure_batch
closure_batch_scan closure_batch_status closure_batch_status_scan --no-check`, run twice back to back,
best of the two per cell (the machine is shared with other agents' benchmark runs; the worst cell-to-cell
difference between the two runs was 27%, most were under 5%). All five of my cases pass the differential
correctness test on all four scenarios.

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 2.063 | 480 | 10.62 |
| closure_single | npc | 1 | 0.239 | 0 | 0.14 |
| closure_batch_control | npc | 1 | 0.216 | 0 | 0.14 |
| closure_batch | npc | 1 | 0.362 | 0 | 0.25 |
| closure_batch_scan | npc | 1 | 0.336 | 0 | 0.28 |
| closure_batch_status | npc | 1 | 0.310 | 0 | 0.19 |
| closure_batch_status_scan | npc | 1 | 0.307 | 0 | 0.22 |
| baseline | npc | 10 | 2.032 | 480 | 4.68 |
| closure_single | npc | 10 | 0.164 | 0 | 0.20 |
| closure_batch_control | npc | 10 | 0.163 | 0 | 0.21 |
| closure_batch | npc | 10 | 0.208 | 0 | 0.29 |
| closure_batch_scan | npc | 10 | 0.193 | 0 | 0.34 |
| closure_batch_status | npc | 10 | 0.230 | 0 | 0.24 |
| closure_batch_status_scan | npc | 10 | 0.195 | 0 | 0.29 |
| baseline | npc | 100 | 2.318 | 481 | 8.67 |
| closure_single | npc | 100 | 0.165 | 0 | 0.24 |
| closure_batch_control | npc | 100 | 0.169 | 0 | 0.23 |
| closure_batch | npc | 100 | 0.165 | 0 | 0.31 |
| closure_batch_scan | npc | 100 | 0.175 | 0 | 0.35 |
| closure_batch_status | npc | 100 | 0.173 | 0 | 0.27 |
| closure_batch_status_scan | npc | 100 | 0.187 | 0 | 0.30 |
| baseline | npc | 1000 | 2.422 | 480 | 8.66 |
| closure_single | npc | 1000 | 0.157 | 0 | 0.27 |
| closure_batch_control | npc | 1000 | 0.169 | 0 | 0.26 |
| closure_batch | npc | 1000 | 0.123 | 0 | 0.35 |
| closure_batch_scan | npc | 1000 | 0.133 | 0 | 0.38 |
| closure_batch_status | npc | 1000 | 0.138 | 0 | 0.30 |
| closure_batch_status_scan | npc | 1000 | 0.151 | 0 | 0.33 |
| baseline | wide | 1 | 5.855 | 224 | 21.64 |
| closure_single | wide | 1 | 0.460 | 0 | 0.09 |
| closure_batch_control | wide | 1 | 0.460 | 0 | 0.11 |
| closure_batch | wide | 1 | 0.799 | 0 | 0.17 |
| closure_batch_scan | wide | 1 | 0.696 | 0 | 0.31 |
| closure_batch_status | wide | 1 | 0.585 | 0 | 0.14 |
| closure_batch_status_scan | wide | 1 | 0.646 | 0 | 0.27 |
| baseline | wide | 10 | 6.307 | 224 | 21.42 |
| closure_single | wide | 10 | 0.447 | 0 | 0.16 |
| closure_batch_control | wide | 10 | 0.519 | 0 | 0.19 |
| closure_batch | wide | 10 | 0.530 | 0 | 0.25 |
| closure_batch_scan | wide | 10 | 0.642 | 0 | 0.42 |
| closure_batch_status | wide | 10 | 0.517 | 0 | 0.22 |
| closure_batch_status_scan | wide | 10 | 0.611 | 0 | 0.36 |
| baseline | wide | 100 | 6.568 | 224 | 21.46 |
| closure_single | wide | 100 | 0.533 | 0 | 0.18 |
| closure_batch_control | wide | 100 | 0.540 | 0 | 0.20 |
| closure_batch | wide | 100 | 0.473 | 0 | 0.28 |
| closure_batch_scan | wide | 100 | 0.630 | 0 | 0.47 |
| closure_batch_status | wide | 100 | 0.534 | 0 | 0.24 |
| closure_batch_status_scan | wide | 100 | 0.695 | 0 | 0.41 |
| baseline | wide | 1000 | 7.494 | 224 | 21.45 |
| closure_single | wide | 1000 | 0.545 | 0 | 0.14 |
| closure_batch_control | wide | 1000 | 0.620 | 0 | 0.16 |
| closure_batch | wide | 1000 | 0.501 | 0 | 0.22 |
| closure_batch_scan | wide | 1000 | 0.640 | 0 | 0.40 |
| closure_batch_status | wide | 1000 | 0.541 | 0 | 0.19 |
| closure_batch_status_scan | wide | 1000 | 0.678 | 0 | 0.35 |
| baseline | deep | 1 | 5.018 | 1120 | 8.12 |
| closure_single | deep | 1 | 0.333 | 0 | 0.08 |
| closure_batch_control | deep | 1 | 0.298 | 0 | 0.09 |
| closure_batch | deep | 1 | 0.401 | 0 | 0.12 |
| closure_batch_scan | deep | 1 | 0.363 | 0 | 0.14 |
| closure_batch_status | deep | 1 | 0.376 | 0 | 0.11 |
| closure_batch_status_scan | deep | 1 | 0.381 | 0 | 0.11 |
| baseline | deep | 10 | 5.081 | 1120 | 2.18 |
| closure_single | deep | 10 | 0.189 | 0 | 0.12 |
| closure_batch_control | deep | 10 | 0.183 | 0 | 0.15 |
| closure_batch | deep | 10 | 0.104 | 0 | 0.20 |
| closure_batch_scan | deep | 10 | 0.097 | 0 | 0.23 |
| closure_batch_status | deep | 10 | 0.170 | 0 | 0.17 |
| closure_batch_status_scan | deep | 10 | 0.160 | 0 | 0.17 |
| baseline | deep | 100 | 5.204 | 1120 | 4.39 |
| closure_single | deep | 100 | 0.162 | 0 | 0.10 |
| closure_batch_control | deep | 100 | 0.172 | 0 | 0.12 |
| closure_batch | deep | 100 | 0.063 | 0 | 0.16 |
| closure_batch_scan | deep | 100 | 0.065 | 0 | 0.18 |
| closure_batch_status | deep | 100 | 0.124 | 0 | 0.14 |
| closure_batch_status_scan | deep | 100 | 0.118 | 0 | 0.14 |
| baseline | deep | 1000 | 5.388 | 1120 | 4.38 |
| closure_single | deep | 1000 | 0.162 | 0 | 0.08 |
| closure_batch_control | deep | 1000 | 0.164 | 0 | 0.10 |
| closure_batch | deep | 1000 | 0.059 | 0 | 0.13 |
| closure_batch_scan | deep | 1000 | 0.056 | 0 | 0.14 |
| closure_batch_status | deep | 1000 | 0.118 | 0 | 0.11 |
| closure_batch_status_scan | deep | 1000 | 0.124 | 0 | 0.11 |
| baseline | reactive | 1 | 1.772 | 352 | 4.36 |
| closure_single | reactive | 1 | 0.236 | 0 | 0.08 |
| closure_batch_control | reactive | 1 | 0.196 | 0 | 0.09 |
| closure_batch | reactive | 1 | 0.308 | 0 | 0.12 |
| closure_batch_scan | reactive | 1 | 0.286 | 0 | 0.14 |
| closure_batch_status | reactive | 1 | 0.229 | 0 | 0.11 |
| closure_batch_status_scan | reactive | 1 | 0.231 | 0 | 0.12 |
| baseline | reactive | 10 | 1.715 | 294 | 4.33 |
| closure_single | reactive | 10 | 0.090 | 0 | 0.10 |
| closure_batch_control | reactive | 10 | 0.090 | 0 | 0.12 |
| closure_batch | reactive | 10 | 0.087 | 0 | 0.14 |
| closure_batch_scan | reactive | 10 | 0.089 | 0 | 0.16 |
| closure_batch_status | reactive | 10 | 0.089 | 0 | 0.13 |
| closure_batch_status_scan | reactive | 10 | 0.096 | 0 | 0.15 |
| baseline | reactive | 100 | 1.726 | 289 | 4.31 |
| closure_single | reactive | 100 | 0.073 | 0 | 0.10 |
| closure_batch_control | reactive | 100 | 0.073 | 0 | 0.12 |
| closure_batch | reactive | 100 | 0.059 | 0 | 0.17 |
| closure_batch_scan | reactive | 100 | 0.068 | 0 | 0.19 |
| closure_batch_status | reactive | 100 | 0.059 | 0 | 0.14 |
| closure_batch_status_scan | reactive | 100 | 0.064 | 0 | 0.16 |
| baseline | reactive | 1000 | 1.939 | 288 | 4.30 |
| closure_single | reactive | 1000 | 0.070 | 0 | 0.08 |
| closure_batch_control | reactive | 1000 | 0.070 | 0 | 0.10 |
| closure_batch | reactive | 1000 | 0.052 | 0 | 0.14 |
| closure_batch_scan | reactive | 1000 | 0.057 | 0 | 0.15 |
| closure_batch_status | reactive | 1000 | 0.052 | 0 | 0.11 |
| closure_batch_status_scan | reactive | 1000 | 0.064 | 0 | 0.13 |

### Headline ratios (1000 agents, from the table above)

| scenario | baseline | closure_single (per-agent) | closure_batch | batch vs baseline | batch vs per-agent |
|---|---:|---:|---:|---:|---:|
| npc | 2.422 | 0.157 | 0.123 | 19.7x | 1.28x |
| wide | 7.494 | 0.545 | 0.501 | 15.0x | 1.09x |
| deep | 5.388 | 0.162 | 0.059 | 91x | 2.75x |
| reactive | 1.939 | 0.070 | 0.052 | 37x | 1.35x |

### KEY QUESTION: at which agent count does batch beat per-agent recursion, and by how much?

`closure_batch` vs `closure_single`, ratio of us/agent-tick (>1 means batch is faster). Rows 2–64 are an
extra sweep (`--agents=2,4,8,16,32,64`), the rest come from the table above.

| agents | npc | wide | deep | reactive |
|---:|---:|---:|---:|---:|
| 1 | 0.66x | 0.58x | 0.83x | 0.77x |
| 2 | 0.75x | 0.61x | 1.08x | 0.88x |
| 4 | 0.91x | 0.71x | 1.32x | 0.85x |
| 8 | 0.70x | 0.75x | 1.65x | 0.96x |
| 16 | 0.75x | 0.79x | 1.99x | 1.10x |
| 32 | 0.89x | 0.98x | 2.04x | 1.07x |
| 64 | 0.91x | 1.02x | 2.45x | 1.20x |
| 100 | 1.00x | 1.13x | 2.57x | 1.24x |
| 1000 | 1.28x | 1.09x | 2.75x | 1.35x |

**Crossover: ~4 agents (deep), ~16 (reactive), ~32-64 (wide), ~100 (npc).** Past the crossover the
speedup saturates fast — ~90% of it is already reached at 64 agents — because what batching removes is a
fixed number of calls per agent-tick, not something that keeps growing with N.

### Why: measured amortisation

Instrumented copy of `closure_batch` (a wrapper counting `process` calls and agents visited; 200 ticks,
steady state, dt = 1/60):

| scenario | node-visits / agent-tick | `process` calls / agent-tick @N=1000 | avg batch size @N=1000 | `halt` calls / agent-tick @N=1000 (avg batch) |
|---|---:|---:|---:|---:|
| npc | 3.77 | 0.012 | 316 / 1000 | 0.001 (41) |
| wide | 11.00 | 0.041 | 268 / 1000 | 0 |
| deep | 12.34 | 0.012 | 1000 / 1000 | 0 |
| reactive | 3.33 | 0.004 | 833 / 1000 | 0.002 (111) |

Node-visits per agent-tick are identical in both designs (same semantics, same skipping); the only thing
batching changes is that 3.8–12.3 *calls* per agent-tick become 0.004–0.041. The speedup tracks the
average batch size almost exactly: `deep` never fragments (a chain — every node sees the whole batch) and
gets 2.75x; `wide` fragments hardest (avg batch 27% of N, spread over 11 node-visits) and gets 1.09x.

### What a batched leaf API would additionally buy

The harness leaf API is per-agent, so a leaf is still one closure call per agent — in `wide` that is 5.25
of the 11 node-visits per agent-tick. Micro-benchmark of the harness `cond` leaf body, called per agent
from inside a batch node vs. an `on_tick_batch(agents, n, dt, so, sn, fo, fn)` that partitions itself:

```
N=   1  per-agent 0.0203 us/agent   batched 0.0194 us/agent   1.05x
N=  10  per-agent 0.0186 us/agent   batched 0.0070 us/agent   2.66x
N= 100  per-agent 0.0172 us/agent   batched 0.0078 us/agent   2.21x
N=1000  per-agent 0.0182 us/agent   batched 0.0079 us/agent   2.30x
```

~10 ns saved per leaf-agent (the call itself, plus hoisting upvalue reads such as `ctx.tick` out of the
loop). Measured leaf `on_tick` calls per agent-tick at dt=1/60: npc 0.59, wide 5.25, deep 1.35,
reactive 1.00 — so an optional `on_tick_batch` would be worth roughly **10% on `wide`, 19% on `deep` and
`reactive`, 4% on `npc`** on top of the numbers above. Worth offering as an *optional* hook (condition
leaves that read one blackboard field per agent are exactly where it pays), but it must stay optional: it
is the one place where the design forces user code to write a loop instead of a scalar function.

## 2. Variants and what each one changed

All at 1000 agents, us/agent-tick (lower is better), same run:

| | npc | wide | deep | reactive |
|---|---:|---:|---:|---:|
| **(b)+(c)** out-lists + bucketed — `closure_batch` | **0.123** | **0.501** | 0.059 | **0.052** |
| **(b)** out-lists + scan — `closure_batch_scan` | 0.133 | 0.640 | **0.056** | 0.057 |
| **(a)** status array + bucketed — `closure_batch_status` | 0.138 | 0.541 | 0.118 | **0.052** |
| **(a)** status array + scan — `closure_batch_status_scan` | 0.151 | 0.678 | 0.124 | 0.064 |

**(a) shared `status[agent]` vs (b) parent-provided out-lists.** Out-lists win everywhere and by 2x on
`deep`. With a status array every composite must make one extra pass over its batch per child to read the
results back (`status[a]` load + branch + compaction store, per agent per child). With out-lists the
child *partitions* the batch into the three lists the parent hands it, and the parent hands down the list
each result belongs in, so results move zero-copy: for a Sequence the child's FAILURE list **is** the
Sequence's FAILURE list and the RUNNING list **is** its RUNNING list; only the SUCCESS list is redirected
into the next child's input buffer. The parent then touches only the agents that *stopped* (to write
their cursor), never the whole batch. The extreme case is `Inverter`, which becomes a pure argument
permutation with **zero per-agent work**:

```lua
process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
    local a, b, c = cp(agents, n, dt, fo, fn, so, sn, ro, rn) -- hand the child my lists, swapped
    return b, a, c
end
```

That is why `deep` (10 stacked decorators, 7 of them Inverters) halves: 0.118 -> 0.059. The cost of (b)
is 9 arguments and 3 return values per node call, which is why it is slightly *worse* at N=1 (`deep/1`:
0.401 vs 0.376) and why `ForceSuccess`/`ForceFailure` need a temp list plus a copy of the mapped agents
(two out-slots cannot alias one list, they carry separate counts).

**(c) one filter pass per child vs pre-bucketing by cursor.** Bucketing wins 1.28x on `wide`
(0.501 vs 0.640) and 1.08x on `npc`, ties on `reactive`, and loses ~5% on `deep`. Scanning is
O(batch x children): for each child i > 1 the node re-scans its whole input looking for
`cursor[a] == i`, so a 16-child Fallback scans up to 16 x 1000 entries per tick. Bucketing does one entry
pass that drops each agent either into the child-1 buffer or into `bucket[cursor[a]]`; each child's input
is then "the survivors of child i-1, plus `bucket[i]` appended". Cost: one extra write per parked agent
and `nc` bucket arrays per node. On `deep` (3 children, one always parked) scanning is marginally cheaper
because there is only one extra pass to save.

On top of (c), `closure_batch` keeps an `n_deep` counter (how many agents are parked past child 1). When
it is 0 — every agent entering fresh — the entry pass is skipped entirely and **the parent's array goes
straight into child 1 with no copy at all**. The counter needs zero per-agent bookkeeping: every agent
parked at the end of a tick had its cursor written during that tick's `process`, so the count is rebuilt
from the sizes of the RUNNING slices (`n_deep += rn - rn0`), minus what the entry pass bucketed, minus
what `halt` clears. An earlier version maintained it per agent (an extra `cursor[a]` read for every
RUNNING and every stopping agent) and was 10–20% slower on `deep` and `wide` (`wide/1000`: 0.505 -> 0.464
in intermediate runs). The same "read the parent's array in place, do not copy" trick applies to
ReactiveSequence/ReactiveFallback, which always start at child 1 with the whole batch.

## 3. API sketch

Declaring a tree (factories; every node exists once and is shared by all agents):

```lua
local tree = BT.Fallback {
    BT.Sequence {
        BT.Leaf { name = "see_enemy", on_tick = function(agent, dt) return ... end },
        BT.Cooldown(1.0) { BT.Leaf {
            name     = "attack",
            on_start = function(agent) progress[agent] = 0 end,   -- optional
            on_tick  = function(agent, dt) ... return RUNNING end,
            on_halt  = function(agent) progress[agent] = nil end, -- optional
        } },
    },
    BT.Parallel("ALL", "ONE") { ... },
    BT.ForceSuccess { BT.Leaf { name = "idle", on_tick = ... } },
}

local world = BT.World.new(tree)   -- builds the closures once
world:AddAgent(id)                 -- id: any positive integer, may be reused after Remove
world:Tick(dt)                     -- ticks every live agent in one pass
world:RemoveAgent(id)              -- halts everything running for id, frees its state
world:GetStatus(id)
```

A leaf's three hooks stay **per agent** — user code never sees the batch. A leaf with only `on_tick`
(every condition) carries no per-agent state at all and its `halt` is a no-op, so absent hooks are free:
the factory picks a different closure at build time instead of testing `on_start ~= nil` every tick.

A new composite kind is a factory returning `{ process, halt, clear? }`. Real example — `IfThenElse`
(2 or 3 children) in batch form, in the main case's out-list convention:

```lua
local function make_if_then_else(children)
    local cp, chalt = children[1].process, children[1].halt  -- condition
    local tp, thalt = children[2].process, children[2].halt  -- then
    local ep, ehalt                                          -- else (optional)
    if children[3] then ep, ehalt = children[3].process, children[3].halt end

    local branch = {}                  -- SoM: branch[agent] = 1|2|3, the child running for that agent
    local ask, run2, run3 = {}, {}, {} -- per-node scratch, reused, explicit counts, never `#`

    return {
        process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
            -- 1. split the batch: resume a branch, or (re)ask the condition
            local na, n2, n3 = 0, 0, 0
            for i = 1, n do
                local a = agents[i]
                local b = branch[a]
                if b == nil or b == 1 then na += 1; ask[na] = a
                elseif b == 2 then n2 += 1; run2[n2] = a
                else n3 += 1; run3[n3] = a end
            end

            -- 2. the condition partitions its batch straight into the two branch batches
            if na > 0 then
                local s0, f0, r0 = n2, n3, rn
                n2, n3, rn = cp(ask, na, dt, run2, n2, run3, n3, ro, rn)
                for i = s0 + 1, n2 do branch[run2[i]] = 2 end
                for i = f0 + 1, n3 do branch[run3[i]] = 3 end
                for i = r0 + 1, rn do branch[ro[i]] = 1 end   -- condition itself is RUNNING
            end

            -- 3. a branch's result is ours; only its RUNNING agents stay parked
            if n2 > 0 then
                local s0, f0, r0 = sn, fn, rn
                sn, fn, rn = tp(run2, n2, dt, so, sn, fo, fn, ro, rn)
                for i = s0 + 1, sn do branch[so[i]] = nil end
                for i = f0 + 1, fn do branch[fo[i]] = nil end
                for i = r0 + 1, rn do branch[ro[i]] = 2 end
            end
            if n3 > 0 then
                if ep == nil then                             -- no else child: FAILURE, as the baseline
                    for i = 1, n3 do
                        local a = run3[i]
                        branch[a] = nil
                        fn += 1; fo[fn] = a
                    end
                else
                    local s0, f0, r0 = sn, fn, rn
                    sn, fn, rn = ep(run3, n3, dt, so, sn, fo, fn, ro, rn)
                    for i = s0 + 1, sn do branch[so[i]] = nil end
                    for i = f0 + 1, fn do branch[fo[i]] = nil end
                    for i = r0 + 1, rn do branch[ro[i]] = 3 end
                end
            end
            return sn, fn, rn
        end,

        halt = function(agents, n)
            local n1, n2, n3 = 0, 0, 0
            for i = 1, n do
                local a = agents[i]
                local b = branch[a]
                if b ~= nil then
                    branch[a] = nil
                    if b == 1 then n1 += 1; ask[n1] = a
                    elseif b == 2 then n2 += 1; run2[n2] = a
                    else n3 += 1; run3[n3] = a end
                end
            end
            if n1 > 0 then chalt(ask, n1) end
            if n2 > 0 then thalt(run2, n2) end
            if n3 > 0 and ehalt then ehalt(run3, n3) end
        end,
    }
end
```

The same node in the per-agent design is ~15 lines and reads like the spec text. That gap **is** the cost
of the hypothesis: a batch composite is a bucketing pass plus one slice-walk per outcome per child, and
the author has to know the buffer discipline (§4).

## 4. Halting and per-agent state

The halting rule ("running at the end of tick T => ticked or halted during T+1, never both, never
neither") becomes: **a parent halts a child for exactly the agents that were parked in it and are not
forwarded to it this tick.** Every node knows which child is parked per agent, so halting is precise
rather than a sweep, and it is batched too — in `reactive` at 1000 agents there are 0.002 halt calls per
agent-tick carrying 111 agents each.

- `Sequence`/`Fallback`: `cursor[agent]` is both the resume point and the "running here" flag. An agent
  in the batch always reaches its cursor child, so `process` never halts anything; `halt(agents, n)`
  groups the batch by cursor and forwards one sub-batch per child index.
- `ReactiveSequence`/`ReactiveFallback`: `active[agent]` = the child that was RUNNING last tick. When an
  agent stops at child `i`, a halt is needed only if `active[agent] > i` (children before `i` were ticked
  in this pass and went idle by themselves). Those agents accumulate in per-child halt lists that are
  flushed once at the end of the node's `process` — one call per child instead of one per agent.
- `Parallel`: `done[agent]` and `succ[agent]` are bitmasks of completed / succeeded children (up to 32
  children; beyond that, a table). A ONE policy firing puts the agent on a `finished` list; after all
  children have run, every child is halted once for that whole list. Halts are **guarded** inside the
  child (`if run[a] == nil then skip`), exactly like the baseline's `Halt` state check, so a parent is
  allowed to over-approximate.
- Decorators: `Inverter`/`ForceSuccess`/`ForceFailure` hold no per-agent state and their `halt` *is* the
  child's `halt`. `Wait`/`Timeout` use `time_left[agent]` as their own running flag, `Repeat` uses
  `n_done[agent]`, `Cooldown` holds a `time_left[agent]` that **survives** a halt and therefore needs the
  extra `clear(agent)` hook called by `remove_agent` (all `clear` closures are collected into one flat
  list at build time, so removal does not walk the tree twice).
- Leaves: `run[agent]` exists only if the leaf has `on_start` or `on_halt`.
- `remove_agent(id)` calls `root.halt({id}, 1)` — a one-element batch, the same code path — then the
  `clear` list. Every `on_halt` fires exactly once, which the differential test checks at ticks 30/60/70.

Buffer discipline, the one rule a node author must not break: **a node never writes into its input
array** (it belongs to the parent); it reads it and writes into its own scratch. Compacting a batch in
place is safe only when the write index can never pass the read index — which is why a Sequence may
compact its own carry buffer but not the parent's array. Each node owns its scratch, so recursion is
safe, but a node reachable twice in one tree (a shared SubTree) needs one buffer set per use site.

## 5. Memory

Measured with `collectgarbage("count")` around a warm world (200 ticks), 32 MB pad, dt = 1/60:

| | npc N=1000 | wide N=1000 |
|---|---:|---:|
| `add_agent` itself | 33 B/agent | 33 B/agent |
| first 200 ticks (SoM keys + scratch growth), batch | 461 B/agent | 245 B/agent |
| first 200 ticks, per-agent control | 205 B/agent | 131 B/agent |
| => scratch buffers attributable to batching | **~256 B/agent** | **~114 B/agent** |
| next 200 ticks (steady state) | **0 B/agent** | **0 B/agent** |
| freed by removing all 1000 agents | ~0 | ~0 |
| re-adding the **same** ids + 200 ticks | 25 B/agent | 0 B/agent |
| re-adding **fresh** ids + 200 ticks | 172 B/agent | 49 B/agent |

- **Steady state is allocation free** (`B/agent-tick` = 0 for all five cases, versus 224–1120 for the
  baseline), and `KB/agent (add + 1st tick)` is 0.13–0.35 KB against the baseline's 4.3–21.6 KB — a
  25x–60x reduction, because there is no node instance per agent.
- `add_agent` is O(1): two writes (`live[n] = id`, `slot[id] = n`). Per-agent *node* state is created
  lazily, only in the nodes an agent actually reaches, and only while it is running there.
- `remove_agent` is O(depth of the running path) for the halt cascade plus O(#`clear` nodes). The SoM
  tables keep their hash nodes (Luau only reclaims dead keys on rehash), which is why removing 1000
  agents frees nothing and re-adding the same ids costs ~0: **id reuse is free, fresh ids are not**. That
  argues for the caller recycling ids, and against keying per-agent state on anything wider than an int.
- **Scratch is the price of batching: ~114–256 B/agent**, i.e. 7–16 table slots of 16 bytes. It is
  proportional to (nodes that can see the whole batch) x (high-water batch size) and it never shrinks. In
  the worst case (a chain like `deep`) every node's buffer holds N entries. Two consequences: a node that
  only ever sees 3 agents keeps a 3-slot buffer (fine), while a tree with 1000 agents and 20 full-batch
  nodes reserves ~320 KB of scratch that outlives every agent; and buffers keep dead agent ids reachable
  above the current count until overwritten. A `reserve(n)`/`shrink()` hook would fix both, at the cost
  of a fourth method on every node.

## 6. Pros, cons, verdict

**Pros**
- 15x–91x over the baseline at 1000 agents, 0 B/agent-tick, no node instance per agent.
- 1.2x–2.8x over an otherwise identical per-agent closure design once the batch is >= ~32 agents, and the
  win is largest exactly where per-agent recursion is worst: deep decorator chains (10 decorators cost 10
  calls per agent there, 10 calls *in total* here).
- Halting batches as well, and the cursor/bucket machinery a Sequence needs is reused by Switch,
  IfThenElse, WhileDoElse, TryCatch and OneShot.
- Pass-through decorators become free (an argument permutation); timers and cooldowns hoist `dt` and
  their constants out of the loop.

**Cons**
- Below ~32 agents it is 1.2x–1.7x *slower* than per-agent recursion, and a single-agent tree (a boss, a
  UI controller, a tutorial NPC) is the worst case at 0.58x–0.83x.
- Node authoring is materially harder: every composite is a bucketing pass plus slice-walks, under a
  buffer-aliasing rule (§4) that is easy to break and that no type system will catch. `IfThenElse` is
  ~70 lines batched against ~15 per-agent.
- Out-lists (the fastest channel) mean 9 arguments and 3 return values per node call plus a convention
  ("the list I hand you is where your result belongs") that has to be documented precisely.
- ~114–256 B/agent of scratch that never shrinks, plus buffers pinning dead ids.
- Debugging: a stack trace no longer tells you which agent you are in.

**Verdict.** Node-major batching works and is the fastest design in this family, but its advantage over
plain per-agent recursion *over the same shared-tree closure nodes* is only 1.09x–1.35x on three of the
four scenarios, reaching 2.75x just on the decorator chain, while costing a real step in node-author
complexity and being 1.2x–1.7x slower below ~32 agents. Almost all of the 15x–91x win over the current
implementation comes from the *shared tree + Struct-of-Maps + closure-per-node* part of the design, not
from batching: the per-agent control alone gets 13x–34x. Batching's actual mechanism is turning 4–12
calls per agent-tick into ~0.01, so it pays in proportion to how little the batch fragments (measured:
`deep` keeps 100% of the batch and wins 2.75x, `wide` keeps 27% and wins 1.09x). I would ship the
per-agent form as the default and keep batching as an opt-in "one tree, many agents" mode for crowds; if
only one form can exist, the batch form is defensible only together with an optional batched leaf hook
(another 4–19%) and a documented buffer discipline.

### On "RUNNING propagating upward lets a parent avoid pushing agents to irrelevant children"

True and measurable, but it is not a batching effect. In `wide` the cursor cuts node-visits per agent-tick
from ~19 (what a memoryless Fallback would do: on average 8.5 conditions before the true one, every tick)
to the measured **11.0** — an agent parked in sequence *i* re-enters at *i* and never touches conditions
1..i-1. That saving is identical in the per-agent design, since both have the cursor, so it does not
favour batching. What it does *to* batching is the opposite of the hypothesis: dropping RUNNING and
FAILED agents out of the batch is precisely what makes the batch shrink, so the later children of a wide
composite are called with 27% of N (`wide`) instead of 100% (`deep`), and the amortisation that justifies
the whole design erodes. The hypothesis is right that a parent should not push agents into irrelevant
children; it is wrong that this helps the batch — it is the main thing limiting it.

## 7. The node kinds not in the bench

- **Switch(key)** — the bucketing pass *is* the implementation: one pass reading `bb[key][agent]` drops
  each agent into `bucket[case]`, then each case child is called once with its bucket. Per-agent state is
  `active[agent]` (the case that is running); halting reuses the Sequence's group-by-cursor halt. This is
  the node the batch form suits best; per-agent it is a chain of comparisons per agent.
- **IfThenElse** — written out in §3.
- **WhileDoElse** — IfThenElse plus re-evaluating the condition for the *whole* batch every tick (like a
  ReactiveSequence's child 1); agents whose branch flipped go into the per-branch halt lists that
  `make_reactive` already has, and then into the other branch's batch in the same tick.
- **TryCatch** — `phase[agent]` in {TRY, CATCH, FINALLY} plus `pending[agent]`; bucket by phase exactly
  like Switch. Phase transitions are driven from the child's out-list slices, so the TRY failure list
  becomes the CATCH batch with no copy.
- **KeepRunningUntilSuccess / KeepRunningUntilFailure** — stateless; map one out-list onto the RUNNING
  list. It cannot be a pure permutation like `Inverter` (two out-slots would have to alias one list with
  separate counts), so it takes the `ForceSuccess` shape: one temp list and a copy of the remapped
  agents, no per-agent state.
- **OneShot** — `res[agent]` memo; one pass splits the batch into "already decided" (pushed straight onto
  the matching out-list) and "undecided" (forwarded). Needs a `clear(agent)` like Cooldown, because the
  memo survives halts.
- **SubTree** — an alias node: `process = other_root.process`, `halt = other_root.halt`; zero cost, the
  batch crosses the boundary untouched. The one restriction is that the parent-owns-its-buffer rule
  forbids re-entering a subtree while it is on the stack, so a subtree used at two sites must be built
  twice (or given a depth-indexed buffer pool).
- **Log / Timer / WasEntryUpdated** — leaf-shaped loops; exactly the nodes that would want the optional
  `on_tick_batch` hook, since their body is 2-3 instructions and the call dominates.
- **FSM / GOAP connectors** — leaf-shaped, one call per agent; no batch form unless the connected machine
  itself becomes batch-major.

## Notes on the harness

No bugs found. Two things worth recording for whoever reads several of these reports:

- `B/agent-tick` is the median of per-tick heap deltas, so a design that allocates on only a few ticks out
  of many (e.g. a buffer growing) still reports 0. I cross-checked with explicit `collectgarbage("count")`
  sums over 200-tick windows (§5) and the steady state really is 0.
- `KB/agent (add + 1st tick)` charges first-tick scratch growth to the agents, so for batch designs it
  mixes a per-agent cost with a per-node one; at N=1 it is a single noisy sample (I saw 0.12 and 3.25 KB
  for the same case in two runs).

# flat_batch — flat node arrays + node-major batch processing

**Hypothesis under test:** one batch handler per node *kind*, `process(id, agents, n, dt)`, looping over an
agent-id array node-major, writing into a shared `status[agent]`, forwarding filtered agent lists to
children through preallocated per-node scratch arrays. Flat SoA node data (`kids[i]`, `st[i]`, `sA[i]`, …),
Struct-of-Maps per-agent state, cursor-driven halting, no per-tick allocation.

**Verdict up front: the batch half of the hypothesis is right, the flat-array half is not.** Batching is worth
2.0–3.2× over an identical per-agent traversal from ~10 agents up; flat node arrays cost ~1.5× at 1 agent
versus per-node closures and buy nothing at 1000. Details in §7.

Cases (all four pass the differential test, 4 scenarios × 80 ticks):

| file | what it is |
|---|---|
| `cases/flat_batch.luau` | e1, the main case: recursive batch, parent handler calls the child handler with its filtered list |
| `cases/flat_batch_worklist.luau` | e2: level-synchronous inboxes, push-down / pull-up sweeps, fixpoint rounds |
| `cases/flat_batch_buffer.luau` | e3: same as e1 but state in `buffer`s with an id→slot map and a free list |
| `cases/flat_batch_control.luau` | control: same flat arrays, same state, **per-agent** recursion — isolates batching |

---

## 1. Final full run

`lune run luau-bench/harness/runner.luau baseline flat_batch flat_batch_control flat_batch_worklist flat_batch_buffer --no-check`
(Lune 0.10.5, Luau interpreter, no native codegen. Other agents were benchmarking on the same machine;
run-to-run spread on a repeat of this exact command was ≤5% except `wide` at ±10%, and no ordering changed.)

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 2.003 | 480 | 10.62 |
| flat_batch | npc | 1 | 0.485 | 0 | 0.31 |
| flat_batch_control | npc | 1 | 0.323 | 0 | 0.20 |
| flat_batch_worklist | npc | 1 | 1.567 | 0 | 0.52 |
| flat_batch_buffer | npc | 1 | 0.496 | 0 | 0.19 |
| baseline | npc | 10 | 2.062 | 480 | 8.67 |
| flat_batch | npc | 10 | 0.223 | 0 | 0.36 |
| flat_batch_control | npc | 10 | 0.250 | 0 | 0.23 |
| flat_batch_worklist | npc | 10 | 0.816 | 0 | 0.49 |
| flat_batch_buffer | npc | 10 | 0.233 | 0 | 0.23 |
| baseline | npc | 100 | 2.065 | 482 | 8.67 |
| flat_batch | npc | 100 | 0.170 | 0 | 0.37 |
| flat_batch_control | npc | 100 | 0.263 | 0 | 0.26 |
| flat_batch_worklist | npc | 100 | 0.381 | 0 | 0.52 |
| flat_batch_buffer | npc | 100 | 0.146 | 0 | 0.50 |
| baseline | npc | 1000 | 2.371 | 482 | 8.66 |
| flat_batch | npc | 1000 | 0.134 | 0 | 0.41 |
| flat_batch_control | npc | 1000 | 0.267 | 0 | 0.29 |
| flat_batch_worklist | npc | 1000 | 0.249 | 0 | 0.59 |
| flat_batch_buffer | npc | 1000 | 0.119 | 0 | 0.47 |
| baseline | wide | 1 | 5.477 | 224 | 21.64 |
| flat_batch | wide | 1 | 1.005 | 0 | 0.39 |
| flat_batch_control | wide | 1 | 0.599 | 0 | 0.23 |
| flat_batch_worklist | wide | 1 | 2.652 | 0 | 0.70 |
| flat_batch_buffer | wide | 1 | 1.035 | 0 | 0.23 |
| baseline | wide | 10 | 5.960 | 224 | 21.42 |
| flat_batch | wide | 10 | 0.749 | 0 | 0.55 |
| flat_batch_control | wide | 10 | 0.866 | 0 | 0.23 |
| flat_batch_worklist | wide | 10 | 1.280 | 0 | 0.86 |
| flat_batch_buffer | wide | 10 | 0.597 | 0 | 0.31 |
| baseline | wide | 100 | 6.131 | 224 | 21.46 |
| flat_batch | wide | 100 | 0.588 | 0 | 0.63 |
| flat_batch_control | wide | 100 | 1.176 | 0 | 0.20 |
| flat_batch_worklist | wide | 100 | 0.712 | 0 | 1.01 |
| flat_batch_buffer | wide | 100 | 0.398 | 0 | 0.92 |
| baseline | wide | 1000 | 6.893 | 224 | 19.64 |
| flat_batch | wide | 1000 | 0.544 | 0 | 0.53 |
| flat_batch_control | wide | 1000 | 1.734 | 0 | 0.16 |
| flat_batch_worklist | wide | 1000 | 0.621 | 0 | 0.87 |
| flat_batch_buffer | wide | 1000 | 0.358 | 0 | 0.81 |
| baseline | deep | 1 | 4.647 | 1120 | 8.12 |
| flat_batch | deep | 1 | 0.515 | 0 | 0.11 |
| flat_batch_control | deep | 1 | 0.430 | 0 | 0.09 |
| flat_batch_worklist | deep | 1 | 1.376 | 0 | 0.47 |
| flat_batch_buffer | deep | 1 | 0.561 | 0 | 0.09 |
| baseline | deep | 10 | 4.878 | 1120 | 2.67 |
| flat_batch | deep | 10 | 0.176 | 0 | 0.17 |
| flat_batch_control | deep | 10 | 0.318 | 0 | 0.15 |
| flat_batch_worklist | deep | 10 | 0.334 | 0 | 0.75 |
| flat_batch_buffer | deep | 10 | 0.186 | 0 | 0.15 |
| baseline | deep | 100 | 5.048 | 1120 | 0.13 |
| flat_batch | deep | 100 | 0.122 | 0 | 0.14 |
| flat_batch_control | deep | 100 | 0.301 | 0 | 0.12 |
| flat_batch_worklist | deep | 100 | 0.204 | 0 | 0.60 |
| flat_batch_buffer | deep | 100 | 0.124 | 0 | 0.16 |
| baseline | deep | 1000 | 5.206 | 1120 | 4.38 |
| flat_batch | deep | 1000 | 0.113 | 0 | 0.11 |
| flat_batch_control | deep | 1000 | 0.286 | 0 | 0.10 |
| flat_batch_worklist | deep | 1000 | 0.183 | 0 | 0.48 |
| flat_batch_buffer | deep | 1000 | 0.115 | 0 | 0.09 |
| baseline | reactive | 1 | 1.717 | 352 | 4.36 |
| flat_batch | reactive | 1 | 0.377 | 0 | 0.14 |
| flat_batch_control | reactive | 1 | 0.274 | 0 | 0.09 |
| flat_batch_worklist | reactive | 1 | 0.722 | 0 | 0.20 |
| flat_batch_buffer | reactive | 1 | 0.376 | 0 | 0.11 |
| baseline | reactive | 10 | 1.620 | 294 | 4.33 |
| flat_batch | reactive | 10 | 0.117 | 0 | 0.18 |
| flat_batch_control | reactive | 10 | 0.168 | 0 | 0.12 |
| flat_batch_worklist | reactive | 10 | 0.198 | 0 | 0.23 |
| flat_batch_buffer | reactive | 10 | 0.122 | 0 | 0.16 |
| baseline | reactive | 100 | 1.676 | 289 | 4.31 |
| flat_batch | reactive | 100 | 0.067 | 0 | 0.18 |
| flat_batch_control | reactive | 100 | 0.152 | 0 | 0.12 |
| flat_batch_worklist | reactive | 100 | 0.087 | 0 | 0.26 |
| flat_batch_buffer | reactive | 100 | 0.068 | 0 | 0.28 |
| baseline | reactive | 1000 | 1.767 | 288 | 4.30 |
| flat_batch | reactive | 1000 | 0.059 | 0 | 0.14 |
| flat_batch_control | reactive | 1000 | 0.138 | 0 | 0.10 |
| flat_batch_worklist | reactive | 1000 | 0.072 | 0 | 0.21 |
| flat_batch_buffer | reactive | 1000 | 0.063 | 0 | 0.24 |

**flat_batch vs baseline, speedup (µs/agent-tick):**

| scenario | 1 agent | 10 | 100 | 1000 |
|---|---:|---:|---:|---:|
| npc | 4.1× | 9.2× | 12.1× | **17.7×** |
| wide | 5.4× | 8.0× | 10.4× | **12.7×** |
| deep | 9.0× | 27.7× | 41.4× | **46.1×** |
| reactive | 4.6× | 13.8× | 25.0× | **30.0×** |

Allocation: **0 B/agent-tick** in steady state for every variant (baseline: 224–1120 B). Per-agent footprint
0.11–0.63 KB vs the baseline's 4.3–21.6 KB, i.e. 20–40× less (the baseline's number is a whole tree per agent).

---

## 2. What each variant changed, in numbers

### e1 `flat_batch` (main) vs the per-agent control on the identical layout

`flat_batch_control` is the same file structure — same flat arrays, same `st[i][agent]` SoM state, same
handler-per-kind dispatch — walked once per agent returning a status. Everything except batching is held constant.

| scenario | 1 | 10 | 100 | 1000 |
|---|---:|---:|---:|---:|
| npc (control / batch) | 0.67× | 1.12× | 1.55× | **2.00×** |
| wide | 0.60× | 1.16× | 2.00× | **3.19×** |
| deep | 0.83× | 1.81× | 2.47× | **2.53×** |
| reactive | 0.73× | 1.44× | 2.27× | **2.34×** |

**The crossover is between 1 and 10 agents.** At 1 agent batching *loses* 20–40%: every handler pays a
prologue (hoist `st[i]`, `kids[i]`, `sA[i]`, the bucket arrays) and a partition pass over a list of length 1.
From 10 agents the prologue amortises and the inner loops win; by 1000 agents the control degrades further
(`wide`: 0.599 → 1.734 µs as N grows) because a per-agent walk touches 49 different node state tables per
agent, while the batch touches one node's table for 1000 consecutive agents.

### e2 `flat_batch_worklist` — level-synchronous. Slower everywhere, and semantically hostile.

| scenario | 1 | 10 | 100 | 1000 | rounds/tick |
|---|---:|---:|---:|---:|---:|
| npc (worklist / e1) | 3.23× | 3.66× | 2.24× | 1.86× | 7.26 |
| wide | 2.64× | 1.71× | 1.21× | 1.14× | 9.00 |
| deep | 2.67× | 1.90× | 1.67× | 1.62× | 1.33 |
| reactive | 1.92× | 1.69× | 1.30× | 1.22× | 2.00 |

(> 1 means worklist is slower. rounds/tick measured with 20 agents over 200 ticks.)

It never wins, and the gap only closes because the per-round sweep amortises over the batch. Three things
it had to grow before it was even correct, all worth recording:

1. **One push/pull pass pair is not enough.** A parent must stay pending while agents are still in flight
   below it (`nfl[i]`), otherwise a child subtree that needs several rounds silently loses its batch (the
   parent resolves an empty out-list and goes idle). This is the fixpoint, not an optimisation.
2. **Parallel cannot push all of its children in one round.** All children would write the same
   `status[agent]` slot before the parent reads it. It has to walk one child per round like a Reactive node
   — or every node needs per-(node, agent) result storage, which is the memory the rework is trying to avoid.
   The same aliasing bit me in the pull pass: a leaf's out-list *is* its inbox array, so children must be
   resolved in **descending** order (child c+1 consumed before child c writes its inbox).
3. **A node can be pushed to twice in one tick** (a Sequence hands its resumers to child *c* in round 1 and
   the agents advancing from child *c−1* in round 4). Per-agent nodes cope; a Parallel walks its children
   per *wave*, so the second wave has to be deferred in the inbox until the first finishes.

Sequence semantics are the core problem: an advance costs a whole round, so `wide` needs 9 rounds/tick and
`npc` 7.3, and the sweeps had to be bounded to a live id range (`ilo..ihi` / `plo..phi`) or the round loop
rescans the entire tree per advance. **Not sane for Sequence/Fallback semantics; don't do this.** The useful
idea buried in it — flatten the traversal into a precomputed instruction tape (`PUSH i,c` / `COLLECT i,c` in
DFS order) so there is one loop instead of one call per node — keeps e1's ordering and would be the thing to
try next; the level-synchronous fixpoint is not it.

### e3 `flat_batch_buffer` — dense slots in `buffer`s. A wash, except on the widest tree.

| scenario | 1 | 10 | 100 | 1000 |
|---|---:|---:|---:|---:|
| npc (e1 / buffer) | 0.98× | 0.96× | 1.16× | 1.13× |
| wide | 0.97× | 1.25× | **1.48×** | **1.52×** |
| deep | 0.92× | 0.95× | 0.98× | 0.98× |
| reactive | 1.00× | 0.96× | 0.99× | 0.94× |

(> 1 means buffer is faster.) State is one f64 row of `cap` slots per stateful node, `0` meaning idle
(cursors are ≥1, live timers >0, leaf liveness is 1, Repeat stores `count+1`, Parallel stores `mask+1`),
plus a u8 status row. It only pays where the SoM tables get big and cache-cold — `wide`, 49 nodes × 1000
agents — and there it is a real 1.5×.

**The management pain is real and is the reason I would not ship it:**
- `slot_of[id]` (hash) + `id_of[slot]` (array) both have to exist: ids are caller-chosen, and leaf hooks take
  the *id*, so every leaf tick pays an extra `id_of[sl]` indirection that the SoM version does not.
- Growth reallocates the whole state block and **every cached row offset changes** (`rowof`, `cdof`, `scof`,
  `fcof` all have to be recomputed; forget one and it silently reads another node's state).
- No `nil`. Every node kind needs a value that cannot occur while live, and `Repeat`/`Parallel` need a +1
  bias, which then has to be undone on every bit operation.
- `next(t) == nil` ("nothing is running in this subtree", the early-out that makes halting cheap) has no
  buffer equivalent, so each node maintains a hand-updated `lc[i]` live counter — an increment/decrement on
  every liveness transition in every handler, and an off-by-one is a silent halt leak.
- A freed slot must be scrubbed (`n_rows` writes) or a recycled id inherits the previous agent's Cooldown timer.
- Timers must be f64: f32 would halve the memory but changes the `time_left <= 0` arithmetic against the baseline.
- The scratch agent lists are still ordinary Lua arrays (16 B/entry). Only *state* is compressed; making the
  work lists buffers too would need u32 slot ids everywhere and another parallel set of offsets.

---

## 3. Against the other batch designs (same runner invocation, `--agents=1,1000`)

| case | npc 1 | npc 1000 | wide 1 | wide 1000 | deep 1 | deep 1000 | reactive 1 | reactive 1000 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 2.174 | 2.478 | 5.511 | 6.979 | 4.690 | 5.138 | 1.728 | 1.716 |
| **flat_batch** | 0.489 | 0.138 | 0.993 | 0.541 | 0.514 | 0.120 | 0.388 | 0.061 |
| closure_batch_status | 0.311 | 0.141 | 0.594 | 0.523 | 0.392 | 0.114 | 0.244 | 0.055 |
| closure_batch | 0.362 | 0.129 | 0.737 | 0.460 | 0.386 | **0.060** | 0.272 | 0.053 |

and versus per-agent traversal (`closure_single`, separate run):

| case | npc 1 | npc 10 | npc 100 | npc 1000 |
|---|---:|---:|---:|---:|
| flat_batch | 0.496 | 0.232 | 0.172 | 0.134 |
| closure_single | 0.224 | 0.155 | 0.173 | 0.173 |

Two clean conclusions, because these pairs differ in exactly one thing each:

- **`flat_batch` vs `closure_batch_status`** = same batching, same shared-status protocol, *different node
  representation* (flat parallel arrays + one handler per kind vs one closure pair per node). Closures win
  1.5–1.7× at 1 agent and tie at 1000 (0.138 vs 0.141, 0.541 vs 0.523, 0.120 vs 0.114). Flat SoA node data
  costs one array read per field per node per tick where a closure gets an upvalue for free; that cost is
  per node, not per agent, so it vanishes into the batch — **flat arrays buy nothing and cost at small N**.
- **`closure_batch` vs `closure_batch_status`** = same representation, different *result protocol*:
  partitioned out-lists (success/failure/running lists passed down) vs a shared `status[agent]` array.
  On `deep` (ten stacked decorators) out-lists are 1.9× faster at 1000 agents (0.060 vs 0.114), because an
  Inverter becomes an argument permutation instead of an O(n) remap loop. My hypothesis specified the shared
  status array; that is the wrong protocol for decorator-heavy trees.
- Against the best per-agent design, the crossover is **~100 agents** on npc (`closure_single` wins at 1 and
  10, ties at 100, loses at 1000), versus ~10 agents against my own per-agent control. Batching's advantage
  is real but it is smaller than the advantage of simply not being the baseline.

**Batched leaf API.** The harness leaf hook is per agent, so a leaf costs n calls per tick. A 2-argument Lua
call in this interpreter measures **9.8 ns** (20M iterations, call 12.1 ns vs inlined 2.3 ns). With 2–4 leaf
ticks per agent-tick in these scenarios that is 20–40 ns of pure call overhead, i.e. **15–35% of
flat_batch's 0.06–0.13 µs at 1000 agents**. An optional `on_tick_batch(agents, n, dt, out)` hook (falling back
to `on_tick` when absent) would recover most of it and is the single highest-value API change on this list —
it is also only available *because* the design is batched.

---

## 4. API sketch

**Declaring a tree** — same spec table the harness uses; compiled once, shared by every agent:

```lua
local tree = BT.compile({
    kind = "Fallback",
    children = {
        { kind = "Sequence", children = {
            see_enemy,                                              -- a leaf table (below)
            { kind = "Cooldown", seconds = 1.0, child = attack },
            mark_attack,
        } },
        { kind = "Parallel", success_policy = "ALL", failure_policy = "ONE", children = {
            look_around, { kind = "Wait", seconds = 0.5 }, { kind = "Inverter", child = danger },
        } },
        { kind = "ForceSuccess", child = idle },
    },
})

tree:add(agent_id)          -- integer id chosen by the caller, may be reused after remove
tree:tick(dt)               -- ticks every live agent, node-major
tree:status(agent_id)       -- root status from the latest tick
tree:remove(agent_id)       -- halts everything running for the agent, frees its state
```

**A leaf** — three optional hooks, absent hooks cost nothing (the builder picks one of three leaf handlers;
a hookless leaf gets no per-agent state table at all):

```lua
local progress = {}                              -- Struct-of-Maps, keyed by agent id
local attack = {
    kind = "Leaf", name = "attack",
    on_start = function(agent)      progress[agent] = 0 end,
    on_tick  = function(agent, dt)
        local p = progress[agent] + 1
        if p >= 3 then progress[agent] = nil return SUCCESS end
        progress[agent] = p
        return RUNNING
    end,
    on_halt  = function(agent)      progress[agent] = nil end,
}
```

**A new composite kind, in batch form.** A kind is a `process` + a `halt` over the world's flat arrays.
This `IfThenElse` is not a sketch: it is in `cases/flat_batch.luau` and is verified tick-for-tick against
`BTree.IfThenElse` (60 ticks × 5 agents, inside a ReactiveFallback so it gets halted too).

```lua
-- children = { condition, then, else? }
-- st[i][agent] is the child the agent is parked on: 1 = evaluating the condition, 2 = THEN, 3 = ELSE.
-- nil = idle. Halting is the stock halt_cursor: "halt the one child this agent is parked on".
local function proc_ite(i, agents, n, dt)
    local s = st[i]
    local bk, bc = bkt[i], bcn[i]         -- per-child scratch buckets + counts (never `#`)
    local cond = sA[i]                    -- this node's work list
    local kd, C = kids[i], nc[i]
    local cn = 0

    for k = 1, n do                       -- entry pass: park each agent on its cursor
        local a = agents[k]
        local c = s[a]
        if c == nil then s[a] = 1 c = 1 end
        if c == 1 then
            cn += 1 cond[cn] = a
        else
            local m = bc[c] + 1 bc[c] = m bk[c][m] = a
        end
    end

    if cn > 0 then                        -- one batched call for the condition
        local ch = kd[1]
        proc[ch](ch, cond, cn, dt)
        for k = 1, cn do
            local a = cond[k]
            local r = status[a]
            if r == SUCCESS then
                s[a] = 2
                local m = bc[2] + 1 bc[2] = m bk[2][m] = a
            elseif r == FAILURE then
                if C == 3 then
                    s[a] = 3
                    local m = bc[3] + 1 bc[3] = m bk[3][m] = a
                else
                    s[a] = nil            -- status is already FAILURE: nothing to write
                end
            end
            -- RUNNING: stays parked on the condition, status is already RUNNING
        end
    end

    for x = 2, C do                       -- one batched call per branch
        local m = bc[x]
        if m > 0 then
            bc[x] = 0
            local b, ch = bk[x], kd[x]
            proc[ch](ch, b, m, dt)
            for k = 1, m do
                local a = b[k]
                if status[a] ~= RUNNING then s[a] = nil end
            end
        end
    end
end
```

Registration is two table writes in the builder (`proc[i] = proc_ite`, `halth[i] = halt_cursor`) plus asking
for the scratch the kind needs. Note the two batch idioms the whole design leans on: **agents arriving from
different places merge by appending into the same per-child bucket**, and **a composite whose result equals
its child's result writes nothing** — `Sequence`, `Fallback`, `Parallel`-ONE and both branches of
`IfThenElse` never touch `status`.

---

## 5. Halting, and the per-agent state a node holds

There is **no end-of-tick running-set sweep** (that is the baseline's `running_nodes` diff and the source of
its steady-state garbage). The invariant is local and cursor-driven:

> a parent halts a child for exactly the agents that were live in that child and are not forwarded to it this tick.

- `Sequence` / `Fallback`: never halt during a normal tick. The only child that can be live for an agent is
  the one at its cursor, and that child is always ticked. On halt: bucket the agents by cursor, forward each
  bucket to its child.
- `ReactiveSequence` / `ReactiveFallback`: agents restart at child 1. Agents that drop out (FAILURE, or
  RUNNING at child *c*) accumulate in a drop list which is handed to every *subsequent* child before it is
  processed; children before the drop point returned a terminal status this tick and are idle, so the same
  unfiltered list is safe for all of them.
- `Parallel`: an agent leaving under a ONE policy is dropped, and at the end of the child loop the drop list
  is handed to **all** children — the child it left on is idle by then, so halting it is a no-op.
- `Timeout`: expired agents are halted in the child as a batch before FAILURE is written.
- `Cooldown`: the blocked path cannot have a live child (the timer is only positive after the child
  completed), so it halts nothing; it holds no liveness of its own and forwards halts straight down.
- `Inverter` / `ForceSuccess` / `ForceFailure`: **no per-agent state at all** — live iff the child is live, so
  a halt is a pure forward.
- `remove_agent(id)` halts the root for that one agent (so every running leaf gets `on_halt`) and then clears
  the id from every per-agent map.

Every halt handler is batched too — `halth[node](node, list, n)` — and starts with `if next(st[i]) == nil then
return end`, so halting a branch where nothing is running costs one C call per node instead of a subtree walk.

**Per-agent state, per node kind** (`st[i][agent]`; `nil` always means idle, so one map is both the value and
the liveness flag):

| kind | `st[i][agent]` | extra maps |
|---|---|---|
| Leaf (no hooks) | — none — | — |
| Leaf (on_start / on_halt) | `true` | — |
| Wait, Timeout | `time_left` (>0 while live) | — |
| Sequence, Fallback, IfThenElse | cursor (child index ≥1) | — |
| ReactiveSequence / Fallback | `true` | — |
| Repeat | iteration count (0 is live) | — |
| Parallel | bitmask of completed children | `psc[i]`, `pfc[i]` success/failure counts |
| Cooldown | — none — | `cdt[i]` timer (persists across runs) |
| Inverter / ForceSuccess / ForceFailure | — none — | — |

Parallel is capped at 32 children by the `bit32` mask (the builder errors above that); a second mask word
would lift it.

---

## 6. Memory, add / remove cost, scratch

**Per agent (measured, `KB/agent (add + 1st tick)`):** npc 0.41 KB, wide 0.53 KB, deep 0.11 KB,
reactive 0.14 KB — against the baseline's 8.7 / 19.6 / 4.4 / 4.3 KB. Nothing is allocated by `add_agent`
itself; the growth is the per-agent slot appearing in each node's SoM map (16 B per Luau array slot, and ids
stay in the array part when they are dense) plus the one-off growth of the scratch lists to their high-water
mark. For npc that is ~14 state maps + a status slot + the lists the agent actually flows through ≈ 420 B.

**`add_agent`: O(1)**, three writes (append to the agent array, id→index, no node state — state is created
lazily the first time a node sees the agent).
**`remove_agent`: O(live path + number of per-agent maps)** — a batched halt of the root for one agent, then
one delete per per-agent map (21 nodes → 14 maps for npc). No allocation, no reindexing; the agent array uses
swap-remove. Ids may be reused immediately: the purge is what makes a recycled id start with a zeroed
Cooldown timer, exactly like the baseline's fresh tree.

**Scratch per node** (all preallocated, reused, explicit counts, never `#`, never `table.clear`):
Sequence/Fallback/IfThenElse = 1 work list + 1 resume bucket per child; Reactive = work + drop; Parallel =
active + sub + drop; Timeout = work + expired; Cooldown = work; decorators and leaves = none. Each list grows
only to the largest batch that has ever reached it, so the *worst* case is (1 + #children) × N entries × 16 B
per composite and the typical case is far below it — the measured 0.41–0.63 KB/agent already includes it.
The `buffer` variant replaces the state maps with 8 B/node/agent (npc: 16 rows ≈ 128 B/agent) but leaves the
scratch lists as Lua arrays.

---

## 7. Pros / cons and verdict

**Pros**
- 12–46× the baseline at 1000 agents, 4–9× at 1 agent, **zero steady-state allocation**, 20–40× less memory
  per agent.
- Batching is worth a genuine 2.0–3.2× over the identical per-agent traversal once there are ≥10 agents, and
  the advantage *grows* with N while the per-agent walk degrades (cache).
- One handler per kind: a new node kind is one `process` + one `halt` function and a builder branch; adding
  `IfThenElse` was ~45 lines and reused the stock cursor halt.
- The shared status array makes most composites write nothing at all, and the "0 = idle" state map means one
  lookup per node per agent for both the value and liveness.
- Flat ids in preorder make subtrees contiguous ranges — handy for the worklist variant, for debug dumps, and
  for serialising a tree.

**Cons**
- Loses at 1 agent (0.67–0.83× of the per-agent control): prologue and partition passes over a list of one.
- Flat SoA node data is dead weight: 6–8 parallel arrays to index per handler entry, versus closures that get
  the same fields as upvalues and are 1.5–1.7× faster at N=1 and equal at N=1000.
- The shared `status[agent]` protocol costs an O(n) remap loop per decorator; out-lists make Inverter free
  and are 1.9× faster on a decorator chain.
- Handlers are harder to read than per-agent code: every one is an entry pass, a partition and a compaction,
  and the halting correctness argument ("this child cannot be live here") lives in comments, not in types.
- Scratch memory scales with (nodes × children × peak agents) in the worst case.

**Verdict.** The hypothesis is half right: node-major batch processing is the real win — 2.0–3.2× over the
same tree walked per agent, 12–46× over the baseline, and zero garbage — but its source is amortising the
per-node work over the batch and keeping one node's state hot, not the flat arrays. Flat node arrays with a
handler per kind are measurably *worse* than one closure pair per node at small agent counts and
indistinguishable at large ones, so the "maximal locality / minimal calls" part of the claim is not
supported: the calls saved are per node, not per agent, and the locality that matters comes from iterating
agents inside one node, which closures get too. Level-synchronous batching (e2) is a dead end — it needs an
in-flight counter, a wave queue and one round per Sequence advance, and it is slower everywhere. Dense
`buffer` slots (e3) only pay on the widest tree (1.5×) and cost the whole dense-index bookkeeping the brief
wanted to avoid. If I were to ship one thing from this experiment: **batch, with per-node closures and
partitioned out-lists rather than flat arrays and a shared status array, plus an optional batched leaf hook
(worth another 15–35%)**.

---

## 8. How the remaining baseline nodes map

| node | batch mapping |
|---|---|
| **IfThenElse** | done and verified (§4). Cursor 1/2/3 = condition / THEN / ELSE, `halt_cursor` unchanged. |
| **Switch(key)** | entry pass buckets the batch by `bb[key][agent]` into one list per case (plus default); one batched call per non-empty case. Per-agent state = the case index, chosen on start and pinned until the node goes idle (the baseline resolves the case in `OnStart`), so halting is `halt_cursor` again. Cost: one hash read per agent, then the same pipeline. |
| **WhileDoElse** | IfThenElse plus re-evaluation: agents parked on a branch go back through the condition first, and the ones whose branch changed become a drop list handed to `halth[old_branch]` before the new branch is ticked — the same drop-list mechanism the Reactive composites already use. |
| **TryCatch** | 3-phase cursor (TRY / CATCH / FINALLY) exactly like IfThenElse's, plus one extra SoM map `pending[agent]` for the result FINALLY must not overwrite. Three batched calls per tick at most. |
| **KeepRunningUntilSuccess / Failure** | decorator with a per-agent attempt counter: forward the whole batch to the child, then one pass rewriting the non-terminal status to RUNNING and bumping the counter, turning it terminal only when `max_attempts` is reached. Two passes over n, no child lists. |
| **OneShot** | per-agent `result[agent]` map: the entry pass splits the batch into "already resolved" (write the memoised status, child never called) and "not yet" (forward). Its baseline reset hook is `OnBecameInactive`, which the rework drops, so it needs an explicit policy — resetting in `halt` is the natural one. |
| **SubTree** | with flat ids a subtree is just a node range: inline it at build time and the SubTree node disappears (zero cost). Sharing one compiled subtree between several call sites would need per-(call site, agent) state, i.e. the per-agent instancing this rework removes — so inline, and keep `SubTree` as a build-time include rather than a runtime node. |
| **Log / Timer / WasEntryUpdated / Plug** | plain leaves; `Log` and `Plug` are hookless leaves and get the no-state handler. |
| **FSM / GOAP connectors** | leaves whose `on_tick` drives the other machine per agent; they would be the first users of a batched leaf hook, since one call per agent per tick is the whole cost. |

Nothing in the catalogue needs a mechanism the four scenarios did not already exercise: a per-agent cursor,
a bucket per child, a drop list, and one extra SoM map when a kind needs a second field.

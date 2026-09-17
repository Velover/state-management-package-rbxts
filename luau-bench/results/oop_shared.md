# oop_shared — control experiment: baseline OOP, shared tree, Struct-of-Maps state

Keep the baseline's class/metatable style (`Node → Composite|Decorator → concrete class`,
`node:Tick(agent, dt) -> status`, `node:Halt(agent)`). Change only what the hypothesis blames:
build the tree **once** for all agents, put per-agent state in **per-node maps keyed by agent id**
(`self.running[agent]`, `self.cursor[agent]`, `self.time_left[agent]`), and replace the two per-tick
sets with an **explicit halt cascade**.

Result: **6.8–14x faster per agent-tick, 0 B/agent-tick (was 224–1120 B), 14–19x less memory per
agent, 51–86x cheaper `add_agent`** — with the OOP dispatch left in place. The method dispatch was
not the problem.

Cases (all pass the differential test on all 4 scenarios):
`oop_shared` (main), `oop_shared_flat` (a), `oop_shared_hooks` (b), `oop_shared_aos` (c),
`oop_shared_alias` (bonus).

---

## 1. Final full run

`lune run luau-bench/harness/runner.luau baseline oop_shared oop_shared_flat oop_shared_hooks oop_shared_aos oop_shared_alias --no-check`
(correctness was verified separately in the same session; the full run was repeated twice, run-to-run
spread ≤ 5% — see §2).

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 2.025 | 480 | 10.62 |
| oop_shared | npc | 1 | 0.292 | 0 | 0.55 |
| oop_shared_flat | npc | 1 | 0.287 | 0 | 0.55 |
| oop_shared_hooks | npc | 1 | 0.313 | 0 | 0.55 |
| oop_shared_aos | npc | 1 | 0.305 | 0 | 2.38 |
| oop_shared_alias | npc | 1 | 0.308 | 0 | 0.52 |
| baseline | npc | 10 | 2.064 | 480 | 3.89 |
| oop_shared | npc | 10 | 0.201 | 0 | 0.88 |
| oop_shared_flat | npc | 10 | 0.203 | 0 | 0.88 |
| oop_shared_hooks | npc | 10 | 0.207 | 0 | 0.88 |
| oop_shared_aos | npc | 10 | 0.219 | 0 | 2.61 |
| oop_shared_alias | npc | 10 | 0.211 | 0 | 0.83 |
| baseline | npc | 100 | 2.123 | 482 | 8.67 |
| oop_shared | npc | 100 | 0.202 | 0 | 0.72 |
| oop_shared_flat | npc | 100 | 0.190 | 0 | 0.72 |
| oop_shared_hooks | npc | 100 | 0.204 | 0 | 0.72 |
| oop_shared_aos | npc | 100 | 0.231 | 0 | 0.56 |
| oop_shared_alias | npc | 100 | 0.196 | 0 | 0.68 |
| baseline | npc | 1000 | 2.300 | 480 | 8.10 |
| oop_shared | npc | 1000 | 0.197 | 0 | 0.59 |
| oop_shared_flat | npc | 1000 | 0.188 | 0 | 0.59 |
| oop_shared_hooks | npc | 1000 | 0.194 | 0 | 0.59 |
| oop_shared_aos | npc | 1000 | 0.210 | 0 | 2.42 |
| oop_shared_alias | npc | 1000 | 0.177 | 0 | 0.56 |
| baseline | wide | 1 | 5.439 | 224 | 21.64 |
| oop_shared | wide | 1 | 0.663 | 0 | 1.09 |
| oop_shared_flat | wide | 1 | 0.659 | 0 | 1.09 |
| oop_shared_hooks | wide | 1 | 0.749 | 0 | 1.09 |
| oop_shared_aos | wide | 1 | 0.662 | 0 | 0.03 |
| oop_shared_alias | wide | 1 | 0.690 | 0 | 1.09 |
| baseline | wide | 10 | 5.967 | 224 | 21.42 |
| oop_shared | wide | 10 | 0.647 | 0 | 1.75 |
| oop_shared_flat | wide | 10 | 0.603 | 0 | 1.75 |
| oop_shared_hooks | wide | 10 | 0.692 | 0 | 1.75 |
| oop_shared_aos | wide | 10 | 0.630 | 0 | 5.69 |
| oop_shared_alias | wide | 10 | 0.597 | 0 | 1.75 |
| baseline | wide | 100 | 6.496 | 224 | 18.17 |
| oop_shared | wide | 100 | 0.625 | 0 | 1.42 |
| oop_shared_flat | wide | 100 | 0.623 | 0 | 1.42 |
| oop_shared_hooks | wide | 100 | 0.823 | 0 | 1.42 |
| oop_shared_aos | wide | 100 | 0.729 | 0 | 5.44 |
| oop_shared_alias | wide | 100 | 0.647 | 0 | 1.42 |
| baseline | wide | 1000 | 7.575 | 224 | 21.45 |
| oop_shared | wide | 1000 | 0.706 | 0 | 1.14 |
| oop_shared_flat | wide | 1000 | 0.709 | 0 | 1.14 |
| oop_shared_hooks | wide | 1000 | 0.768 | 0 | 1.14 |
| oop_shared_aos | wide | 1000 | 0.748 | 0 | 5.22 |
| oop_shared_alias | wide | 1000 | 0.629 | 0 | 1.14 |
| baseline | deep | 1 | 4.627 | 1120 | 8.12 |
| oop_shared | deep | 1 | 0.552 | 0 | 0.30 |
| oop_shared_flat | deep | 1 | 0.555 | 0 | 0.30 |
| oop_shared_hooks | deep | 1 | 0.587 | 0 | 0.30 |
| oop_shared_aos | deep | 1 | 0.588 | 0 | 1.41 |
| oop_shared_alias | deep | 1 | 0.529 | 0 | 0.14 |
| baseline | deep | 10 | 4.852 | 1120 | 4.41 |
| oop_shared | deep | 10 | 0.418 | 0 | 0.47 |
| oop_shared_flat | deep | 10 | 0.408 | 0 | 0.47 |
| oop_shared_hooks | deep | 10 | 0.420 | 0 | 0.47 |
| oop_shared_aos | deep | 10 | 0.467 | 0 | 1.57 |
| oop_shared_alias | deep | 10 | 0.404 | 0 | 0.23 |
| baseline | deep | 100 | 5.064 | 1120 | 4.39 |
| oop_shared | deep | 100 | 0.401 | 0 | 0.38 |
| oop_shared_flat | deep | 100 | 0.402 | 0 | 0.38 |
| oop_shared_hooks | deep | 100 | 0.396 | 0 | 0.38 |
| oop_shared_aos | deep | 100 | 0.416 | 0 | 1.49 |
| oop_shared_alias | deep | 100 | 0.368 | 0 | 0.18 |
| baseline | deep | 1000 | 5.249 | 1120 | 4.38 |
| oop_shared | deep | 1000 | 0.377 | 0 | 0.30 |
| oop_shared_flat | deep | 1000 | 0.385 | 0 | 0.30 |
| oop_shared_hooks | deep | 1000 | 0.401 | 0 | 0.30 |
| oop_shared_aos | deep | 1000 | 0.423 | 0 | 1.41 |
| oop_shared_alias | deep | 1000 | 0.369 | 0 | 0.14 |
| baseline | reactive | 1 | 1.789 | 352 | 4.36 |
| oop_shared | reactive | 1 | 0.340 | 0 | 0.25 |
| oop_shared_flat | reactive | 1 | 0.316 | 0 | 0.25 |
| oop_shared_hooks | reactive | 1 | 0.367 | 0 | 0.25 |
| oop_shared_aos | reactive | 1 | 0.358 | 0 | 1.08 |
| oop_shared_alias | reactive | 1 | 0.341 | 0 | 0.25 |
| baseline | reactive | 10 | 1.624 | 294 | 2.01 |
| oop_shared | reactive | 10 | 0.233 | 0 | 0.40 |
| oop_shared_flat | reactive | 10 | 0.215 | 0 | 0.40 |
| oop_shared_hooks | reactive | 10 | 0.265 | 0 | 0.40 |
| oop_shared_aos | reactive | 10 | 0.245 | 0 | 1.20 |
| oop_shared_alias | reactive | 10 | 0.225 | 0 | 0.40 |
| baseline | reactive | 100 | 1.657 | 289 | 4.31 |
| oop_shared | reactive | 100 | 0.205 | 0 | 0.32 |
| oop_shared_flat | reactive | 100 | 0.191 | 0 | 0.32 |
| oop_shared_hooks | reactive | 100 | 0.227 | 0 | 0.32 |
| oop_shared_aos | reactive | 100 | 0.230 | 0 | 0.58 |
| oop_shared_alias | reactive | 100 | 0.203 | 0 | 0.32 |
| baseline | reactive | 1000 | 1.737 | 288 | 3.13 |
| oop_shared | reactive | 1000 | 0.209 | 0 | 0.26 |
| oop_shared_flat | reactive | 1000 | 0.191 | 0 | 0.26 |
| oop_shared_hooks | reactive | 1000 | 0.236 | 0 | 0.26 |
| oop_shared_aos | reactive | 1000 | 0.224 | 0 | 1.08 |
| oop_shared_alias | reactive | 1000 | 0.208 | 0 | 0.26 |

Headline ratios (baseline ÷ case, best of the two full runs):

| scenario | agents | baseline us | oop_shared us | speedup | baseline B/tick | oop_shared B/tick | baseline KB/agent | oop_shared KB/agent |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| npc | 1 | 2.03 | 0.29 | 6.9x | 480 | 0 | 10.6 | 0.55 |
| npc | 1000 | 2.30 | 0.20 | 11.7x | 480 | 0 | 8.1 | 0.59 |
| wide | 1000 | 7.58 | 0.65 | 11.6x | 224 | 0 | 21.5 | 1.14 |
| deep | 1000 | 5.25 | 0.38 | 13.9x | 1120 | 0 | 4.4 | 0.30 |
| reactive | 1000 | 1.74 | 0.21 | 8.3x | 288 | 0 | 3.1 | 0.26 |

Where the baseline's cost went (`npc`, 1000 agents, 2.30 → 0.20 us):

| removed | how | worth |
|---|---|---|
| 2 fresh sets + 2 set-diff sweeps per tree-tick, ~470 B of garbage every tick | parent halts the child it skips, using the cursor / `running` flag it already has | the whole 480 → 0 B/agent-tick, and the GC pressure behind it |
| 1 tree (21 node objects, 8.7 KB) per agent | one shared tree; agent = integer key into per-node maps | 8.1 → 0.59 KB/agent; `add_agent` 10.1 → 0.15 us |
| generic `Node:Tick` wrapper: 5 virtual hook calls per node per tick (`OnBecameActivated`, `OnStart`, `OnTick`, `OnSuccess`/`OnFailure`, `OnExit`) + a 3-level `__index` walk to find each | each class implements `Tick` itself; leaves keep 3 optional hooks | the bulk of the remaining time |
| 5 tick arguments (`dt, bb, running, new_active, old_active`) threaded everywhere | 2 (`agent, dt`) | small but on every call |
| OOP method dispatch through metatables | **kept** | see §2a: ~0–8% |

---

## 2. Variants

us/agent-tick, run 1 / run 2 of the full bench (same machine, other agents benchmarking
concurrently). Every case is allocation-free in steady state (0 B/agent-tick).

| scenario | agents | oop_shared | _flat (a) | _hooks (b) | _aos (c) | _alias (bonus) |
|---|---:|---:|---:|---:|---:|---:|
| npc | 1 | 0.292 / 0.307 | 0.287 / 0.328 | 0.313 / 0.301 | 0.305 / 0.328 | 0.308 / 0.298 |
| npc | 1000 | 0.197 / 0.212 | 0.188 / 0.184 | 0.194 / 0.200 | 0.210 / 0.209 | 0.177 / 0.200 |
| wide | 1 | 0.663 / 0.696 | 0.659 / 0.697 | 0.749 / 0.787 | 0.662 / 0.682 | 0.690 / 0.697 |
| wide | 1000 | 0.706 / 0.653 | 0.709 / 0.694 | 0.768 / 0.817 | 0.748 / 0.790 | 0.629 / 0.658 |
| deep | 1 | 0.552 / 0.559 | 0.555 / 0.543 | 0.587 / 0.583 | 0.588 / 0.625 | 0.529 / 0.561 |
| deep | 1000 | 0.377 / 0.392 | 0.385 / 0.383 | 0.401 / 0.390 | 0.423 / 0.426 | 0.369 / 0.367 |
| reactive | 1 | 0.340 / 0.346 | 0.316 / 0.320 | 0.367 / 0.359 | 0.358 / 0.376 | 0.341 / 0.350 |
| reactive | 1000 | 0.209 / 0.215 | 0.191 / 0.197 | 0.236 / 0.230 | 0.224 / 0.223 | 0.208 / 0.200 |

### (a) `oop_shared_flat` — `__index` chain depth: **0 to 8%, only where Halt is hot**

Identical code; the only difference is that each class table is `table.clone(base)` at definition
instead of `setmetatable({}, {__index = base})`, so every method is found in one table hit. In the
main case `Tick` is already defined on the concrete class (1 hop); what walks the chain is
`Halt` / `HaltOthers` / `HaltFrom`, which live on `Composite` / `Decorator` / `Node` (2 hops).

- `reactive` (halts on most ticks): **8% faster** consistently (0.191–0.197 vs 0.209–0.215 @1000).
- `npc`, `deep`, `wide`: inside run-to-run noise (±5%), no consistent winner.

So chain depth costs ~8% *on the halting path only*, i.e. ~1.5% of the baseline's excess. Flattening
is free to do (`table.clone` at class definition) and worth doing, but it is not where the 11x is.

### (b) `oop_shared_hooks` — always call an inherited no-op: **3–17% slower**

Main case: hooks are instance fields set to the function or `false`, tested with
`local f = self.on_start; if f then f(agent) end` (a rawget hit either way — never a metatable miss).
Variant: `Leaf.on_start = noop` on the class table, called unconditionally.

| scenario | main | hooks | delta |
|---|---:|---:|---:|
| wide @1000 | 0.706 / 0.653 | 0.768 / 0.817 | +9% / +25% |
| wide @1 | 0.663 | 0.749 | +13% |
| reactive @1000 | 0.209 | 0.236 | +13% |
| npc @1000 | 0.197 | 0.194 | ~0% |

`wide` is the worst case: 16 condition leaves with no `on_start`/`on_halt` at all, so the variant pays
a Luau call per skipped hook. `npc` barely notices because most of its leaves *have* hooks. Verdict:
test the hook, don't call a no-op — a taken branch is cheaper than a call, and the gap grows with the
fraction of hookless leaves. (Third option, *not* used: leaving the field `nil` on the instance. Then
`self.on_start` misses the instance **and** walks `Leaf → Node → nil` on every leaf tick — strictly
worse than storing `false`.)

### (c) `oop_shared_aos` — one state table per agent per node: **5–12% slower, 4x the memory**

Same tree, same cascade; `self.state[agent] = { running = false, cursor = 0 }` instead of
`self.cursor[agent]`.

| scenario | SoM KB/agent | AoS KB/agent | SoM us/add | AoS us/add | SoM us/tick @1000 | AoS us/tick @1000 |
|---|---:|---:|---:|---:|---:|---:|
| npc (21 nodes) | 0.59 | 2.42 | 0.15 | 0.70 | 0.197 | 0.210 |
| wide (49 nodes) | 1.14 | 5.22 | 0.30 | 1.68 | 0.706 | 0.748 |
| deep (14 nodes) | 0.30 | 1.41 | 0.09 | 0.40 | 0.377 | 0.423 |
| reactive (10 nodes) | 0.26 | 1.08 | 0.08 | 0.31 | 0.209 | 0.224 |

- **Memory: 4.1–4.7x worse.** A SoM slot is one `TValue` in a table's array part ≈ 16 B (measured
  17.6–20.8 B/slot with growth slack). An AoS record is a whole table (~100–118 B measured, incl. its
  slot in `state`) for 1–2 fields.
- **`add_agent`: 4.4–5.6x worse** — one table allocation per node per agent instead of one integer-keyed
  store per slot. Also the only variant whose add produces GC work.
- **Tick: 5–12% slower.** `self.state[agent].cursor` is two lookups (int key, then string key) where
  SoM is one (`self.cursor[agent]`, array part). It also makes the parent's "is this child running?"
  probe `c.state[agent].running` instead of `c.running[agent]` — that probe runs in every halt loop.
- The one thing AoS is better at: a node needing *k* fields costs 1 map slot + 1 table instead of
  *k* map slots. That only pays off above ~5 fields per node; no catalogue node has that many.

**SoM wins on every axis here.** Keep it.

### (bonus) `oop_shared_alias` — stateless pass-through decorators share the child's `running` map

`Inverter` / `ForceSuccess` / `ForceFailure` are running for an agent *exactly* when their child is,
so they don't need their own flag: `self.running = self.child.running` at build time. Their `Tick`
loses two map writes, their `Halt` becomes `self.child:Halt(agent)`, and they register no slot.

- `deep` (10 stacked decorators): **0.30 → 0.14 KB/agent (−53%)**, slots 15 → 5, add 0.09 → 0.06 us,
  tick ~2% faster (0.369 vs 0.377 @1000).
- `npc`: 0.59 → 0.56 KB/agent, tick equal-or-slightly-better.
- Free everywhere else (`wide`, `reactive` have no such decorators).

Cheap, safe (correctness passes), and it removes exactly the per-agent cost that deep decorator
stacks add. The rule generalises: *any* node whose running-ness is identical to its single child's can
alias. `Repeat`, `Timeout`, `Cooldown`, `KeepRunningUntil*` cannot (they stay running while the child
is idle).

---

## 3. API sketch

### Declaring a tree

A tree is plain data, compiled once, shared by every agent.

```lua
local tree = BT.compile({
    kind = "Fallback",
    children = {
        { kind = "Sequence", children = {
            { kind = "Leaf", name = "see_enemy",
              on_tick = function(agent, dt) return bb.target[agent] and SUCCESS or FAILURE end },
            { kind = "Cooldown", seconds = 1.0, child = attack_leaf },
        } },
        { kind = "Parallel", success_policy = "ALL", failure_policy = "ONE", children = { ... } },
        { kind = "Wait", seconds = 0.5 },
    },
})

tree:AddAgent(id)               -- one store per per-agent slot; 0.15 us for a 21-node tree
tree:Tick(id, dt)               -- or tree:TickAll(dt) over the world's dense id array
tree:RemoveAgent(id)            -- halts the root for id (every running on_halt fires), frees slots
```

### A leaf

```lua
local attack_leaf = {
    kind = "Leaf",
    name = "attack",
    on_start = function(agent) swing[agent] = 0 end,          -- optional
    on_tick  = function(agent, dt)                            -- required
        swing[agent] += dt
        return swing[agent] >= 0.4 and SUCCESS or RUNNING
    end,
    on_halt  = function(agent) swing[agent] = nil end,        -- optional
}
```

Absent hooks are stored as `false` on the node, so `if self.on_start then` is a rawget hit and an
untaken branch — never a call, never a metatable walk (§2b). Leaf per-agent state is the user's own
SoM table (`swing[agent]`), same pattern as the node's.

### A new composite kind

```lua
-- "Race": the first child to succeed wins; the others are halted.
local Race = setmetatable({}, { __index = BT.Composite })  -- Halt/HaltOthers/HaltFrom inherited
Race.__index = Race

function Race:Tick(agent, dt)
    local running = self.running
    running[agent] = true
    local children, n = self.children, self.n
    for i = 1, n do
        if children[i]:Tick(agent, dt) == SUCCESS then
            self:HaltOthers(agent, i)      -- explicit cascade; no sets
            running[agent] = false
            return SUCCESS
        end
    end
    return RUNNING
end

BT.register("Race", function(spec, reg)
    local self = setmetatable({}, Race)
    self.running = reg:slot(false)         -- per-agent map + the value add_agent writes into it
    -- reg:slot(0) / reg:slot(-1) for cursors, timers, counters
    return self                            -- children are built and attached by the framework
end)
```

Three rules a node kind must honour:

1. every per-agent field is a map obtained from `reg:slot(default)`, so `add_agent`/`remove_agent`
   can fill and clear it generically without knowing the node kind;
2. `self.running[agent]` is true exactly while the node is running for that agent (this is what
   parents probe);
3. if you skip a child that may be running, halt it in the same tick.

~20 lines for a new composite, ~10 for a decorator. `BT.Composite` already supplies `Halt`,
`HaltOthers(agent, except)` and `HaltFrom(agent, from)`.

---

## 4. Halting, and the per-agent state a node holds

**Explicit cascade, no sets.** A node is running for an agent iff `self.running[agent]`. A parent that
is about to skip a child it might have left running halts it *in the same tick*, before returning:

- `ReactiveSequence` / `ReactiveFallback`: when child *i* settles the tick, halt running children
  `i+1..n` (children `< i` were ticked this tick and are idle, so the loop starts at `i+1`, not 1).
- `Parallel` with an `ONE` policy: `HaltOthers(agent, winner)`.
- `Timeout` on expiry: halt its child.
- `Sequence` / `Fallback` never skip a running child — the cursor *is* the running child — so they
  halt nothing during a tick.
- `Node:Halt(agent)` recursion: composites halt every running child, decorators their child,
  leaves call `on_halt(agent)`. Callers probe `c.running[agent]` (one array-part read) before
  dispatching, so idle children cost no call.
- `remove_agent(id)` halts the root for `id`, which cascades to every running leaf.

The baseline gets the same effect by diffing two freshly-allocated sets at the end of each tree tick
(and relies on that sweep in one real case: `ReactiveSequence` returning FAILURE leaves its later
children running). Because the runner compares the **multiset of leaf events per tick**, mid-tick
explicit halting and end-of-tick sweeping are indistinguishable — verified on all 4 scenarios × 80
ticks including add/remove/id-reuse.

**Per-agent state per node kind** (every field is one SoM map on the node, `map[agent]`):

| node | maps | default at add |
|---|---|---|
| every node | `running` | `false` |
| Sequence, Fallback | `+ cursor` | `0` |
| ReactiveSequence, ReactiveFallback | — | |
| Parallel(n children) | `+ completed[1..n]` (one map per child, not a per-agent set) | `-1` |
| Repeat | `+ done` | `0` |
| Wait, Timeout, Cooldown | `+ time_left` | `0` |
| Inverter, ForceSuccess, ForceFailure | — (alias the child's `running` in `_alias`) | |
| Leaf | — (its own state is the user's SoM tables) | |

Slots are written with their default in `add_agent` and only set to `nil` in `remove_agent`, so
ticking never inserts or deletes a key → **0 B/agent-tick, measured**. With dense ids the maps stay in
the table's array part.

One real bug this design has that the baseline does not: state that is only written on the *resume*
path can go stale across a halted run. `Repeat` read `done[agent]` written by a previous run
(`Repeat:OnExit` resets it in the baseline); fixed by writing `done[agent] = 0` on the start path.
Anything persisted per (node, agent) must be reset at **start**, not at exit.

---

## 5. Memory, add and remove

Live-heap growth for 1000 agents (measured directly, see the harness note below), and best-of-3 timing:

| scenario | nodes | slots/agent | B/agent | B/slot | us/add | us/remove | baseline B/agent | baseline us/add |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| npc | 21 | 31 | 606 | 19.6 | 0.15 | 0.20 | 8871 (14.6x) | 10.10 (67x) |
| wide | 49 | 66 | 1163 | 17.6 | 0.30 | 0.42 | 21962 (18.9x) | 25.94 (86x) |
| deep | 14 | 15 | 311 | 20.8 | 0.09 | 0.11 | 4485 (14.4x) | 4.57 (51x) |
| reactive | 10 | 13 | 262 | 20.2 | 0.08 | 0.10 | 4401 (16.8x) | 5.04 (63x) |

- **Per agent** = (number of per-agent slots) × ~16 B (a `TValue` in the array part) plus table growth
  slack → ~18–21 B/slot measured. A node contributes 1 slot (most), 2 (cursor/timer/counter nodes) or
  1+n (Parallel).
- **The tree itself** is paid once: 21 node tables for `npc` (~9 KB total incl. the maps' headers),
  independent of agent count.
- **`add_agent`** = `nmaps` integer-keyed stores into pre-existing maps (a flat `maps[]`/`defaults[]`
  array built at compile time, so it is one tight loop, not a tree walk): 5 ns per slot. It allocates
  only when a map's array part has to grow.
- **`remove_agent`** = halt the root for the id (the only part that can call user code) + `nmaps`
  stores of `nil` + a swap-remove from the dense id array. ~0.1–0.4 us. Ids may be reused: re-adding
  refills the same slots.
- Scaling is flat: `npc` costs 0.20 us/agent-tick at 1000 agents and 0.29 at 1 (the 1-agent figure is
  worse only because per-tick fixed costs aren't amortised); the baseline goes the other way
  (2.03 → 2.30) as its per-agent trees stop fitting in cache.

---

## 6. Pros / cons and the verdict

**Pros.** Minimal diff from the shipped design — the same classes, the same `Tick`/`Halt` shape, the
same mental model, so existing node kinds port nearly line-for-line; `self.cursor[agent]` reads almost
like `self.current_index_`. Debugging is easy: a node is a real object you can print, and
`node.running[agent]` answers "what is agent 7 doing" directly. Adding a node kind is a subclass plus
a one-line registration. Zero steady-state allocation and flat scaling to 1000 agents.

**Cons.** Every per-agent field is a separate table, so per-node state is scattered across the heap
(the tick walks ~31 maps for `npc`); a closure-per-node design would fold those into upvalues and a
flat/batched design would make them contiguous. Method dispatch is still a metatable hop per node per
tick (~8% on halt-heavy trees, §2a) and `--!native` will not make calls cheaper. Node authors must
remember rule 3 (halt what you skip) and reset persisted state at *start* — the baseline's sweep
forgave both, at 480 B/tick.

**Verdict on the hypothesis: confirmed.** Keeping the baseline's OOP method dispatch entirely intact
and changing only "one tree per agent" → "one shared tree + SoM state" and "two per-tick sets" →
"explicit halt cascade" recovers **6.8–14x** of tick time, all **224–1120 B/agent-tick** of garbage,
**14–19x** of per-agent memory and **50–86x** of `add_agent` cost. The measurable price of the OOP
style itself is the `__index` chain (**0–8%**, and only on the halting path — flattening the class
tables removes it) plus one metatable hop for `Tick` that no variant here removes; the hook-call
overhead the spec also blames is real but small (**3–17%**, §2b) and is fixed by testing the hook
instead of calling a no-op, not by abandoning classes. Whatever a closure or flat-dispatch design
wins over this, it wins on top of an 11x that classes were never costing.

---

## 7. How the remaining baseline nodes map

All of them fit; none needs a set or a per-tick allocation.

| node | mapping |
|---|---|
| `Switch(key, cases)` | Composite + `chosen[agent]` (child index, `0` = none). Tick: read the key from the SoM blackboard, pick the case; if it differs from `chosen[agent]` and that child is running, halt it; store the new index, tick it. Same shape as `Sequence`'s cursor. |
| `IfThenElse` | Composite of 2–3 children + `branch[agent]`. Tick condition (child 1); if the branch it selects differs from `branch[agent]` and the old branch is running, halt it; remember and tick the new one. Reactive by construction, no set needed. |
| `WhileDoElse` | `IfThenElse` that re-evaluates the condition every tick instead of resuming `branch[agent]`; the flip halts the previously running branch through `branch[agent]`. |
| `TryCatch` | Composite + `cursor[agent]` ∈ {try, catch}: on the try child's FAILURE move the cursor to the catch child (the try child is already idle — nothing to halt) and tick it in the same tick, like `Fallback`. |
| `KeepRunningUntilSuccess` / `Failure` | Decorator, `running` only: map the child's non-matching result to RUNNING (the child then restarts next tick), pass the matching one through. **Cannot** alias the child's `running` map (§2 bonus) — it is running while the child is idle. |
| `OneShot` | Decorator + `fired[agent]` (boolean, default `false`) that persists across runs exactly like `Cooldown`'s `time_left`: if `fired[agent]` return the stored result without ticking the child; set it when the child completes. `Reset` writes `false`. |
| `SubTree` | The subtree's *spec* is compiled again per call site (build time only), so each call site gets its own nodes and its own slots; the node is then a plain pass-through decorator. Sharing one compiled subtree object between two call sites would make them share per-agent slots and clash — the shared-tree design trades that for the per-agent saving. Recursive subtrees need a depth bound or lazy compilation. |
| `Log`, `Plug`/`Callback` | Leaves/decorators with no per-agent state at all: `running` only (`Log` can even alias like `Inverter`). |
| `Timer`, `WasEntryUpdated` | Leaves reading the SoM blackboard (`bb.field[agent]`, `bb.field_version[agent]`); no node-side state beyond `running`. |
| `FSMConnector`, `GoapConnector` | Leaves delegating to an external per-agent machine keyed by the same integer id — the connector holds `machine[agent]` as one more SoM map, and `on_halt` stops it. |
| `MemorySequence` | `Sequence` whose cursor is *not* reset on start (`cursor` map, default 0, only reset on completion). |
| `FireAndForget`, `RunningGate`, `WaitGate`, `ForceRunning` | Decorators over `running` (+ `time_left` for `WaitGate`); direct translations. |
| `OnBecameActivated` / `OnBecameInactive` | Dropped per SPEC §3. The replacement is a leaf that acts in `on_start`, returns RUNNING from `on_tick` and undoes in `on_halt` — which the explicit cascade delivers on exactly the tick the branch stops being visited, same as the baseline's active-set diff. |

---

## Harness notes (no changes made, nothing looks wrong in the semantics)

The differential test caught every divergence I introduced, including a one-tick-off `Repeat` that
produced *identical* leaf events and only differed in the root status — a good sign for the test.

One measurement caveat, not a bug: the **`KB/agent (add + 1st tick)` column is unreliable at small
agent counts**. `alloc_of` sums only *positive* heap deltas, so an incremental GC step during the adds
silently erases real allocation. Repro from the two full runs in §1: `oop_shared_aos` on `wide` with
1 agent reports **0.03 KB/agent** in both runs, while the same case at 1000 agents reports 5.22 KB and
a direct live-heap measurement gives 5.2 KB; `baseline` on `wide` with 1 agent reports 21.64 KB in run
1 and 1.25 KB in run 2. The 1000-agent rows are stable and agree with direct measurement — I used
those in §5. The `us/agent-tick` and `B/agent-tick` columns were reproducible to ≤5% across runs.

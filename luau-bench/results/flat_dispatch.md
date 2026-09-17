# flat_dispatch — flat node graph in parallel arrays

Runtime: Lune 0.10.5+709, Luau interpreter, no native codegen. Machine was running other agents'
benchmarks concurrently, so every number below is from a run that includes `baseline`, and the
headline figures are the median of three full runs.

Cases (all pass the 4-scenario differential test against `baseline`):

| file | what it changes |
|---|---|
| `flat_dispatch` | **d1** one recursive `tick_node(id, agent, dt)`, if/elseif chain on a numeric `KIND[id]` |
| `flat_dispatch_handlers` | **d2** `H[KIND[c]].tick(c, agent, dt)` — one handler table per node kind |
| `flat_dispatch_pernode` | **d3** `TF[c](c, agent, dt)` — the kind's handler pre-resolved per node at build |
| `flat_dispatch_stack` | **d4** iterative traversal over a preallocated explicit frame stack |
| `flat_dispatch_buffer` | **d5** all per-agent node state in one f64 `buffer`, dense agent slot + free list |
| `flat_dispatch_inlineleaf` | extra: d1 but each recursion site inlines the hookless-leaf call |

---

## 1. Numbers first

### 1a. Headline: 1000 agents, median of 3 full runs (us/agent-tick)

| scenario | baseline | d1 flat | d2 handlers | d3 pernode | d4 stack | d5 buffer | inlineleaf |
|---|---:|---:|---:|---:|---:|---:|---:|
| npc | 2.278 | **0.206** | 0.210 | 0.193 | 0.254 | 0.210 | 0.211 |
| wide | 7.180 | **0.553** | 0.626 | 0.521 | 0.596 | 0.559 | 0.513 |
| deep | 5.260 | **0.274** | 0.409 | 0.297 | 0.294 | 0.273 | 0.288 |
| reactive | 1.749 | **0.116** | 0.128 | 0.106 | 0.134 | 0.122 | 0.112 |

Ratio to d1 (lower is better):

| scenario | d2 | d3 | d4 | d5 | inlineleaf | d1 speedup vs baseline |
|---|---:|---:|---:|---:|---:|---:|
| npc | 1.02 | 0.94 | 1.23 | 1.02 | 1.02 | 11.1x |
| wide | 1.13 | 0.94 | 1.08 | 1.01 | 0.93 | 13.0x |
| deep | **1.49** | 1.08 | 1.07 | 1.00 | 1.05 | 19.2x |
| reactive | 1.10 | 0.91 | 1.16 | 1.05 | 0.97 | 15.1x |

Every flat case allocates **0 B/agent-tick** in every scenario at every agent count. Baseline
allocates 224–1120 B/agent-tick.

### 1b. Per node visit

Node visits per agent-tick, measured by instrumenting d1 (average over 200 ticks x 20 agents):

| scenario | nodes | stateful state maps | visits / agent-tick |
|---|---:|---:|---:|
| npc | 21 | 17 | 3.72 |
| wide | 49 | 33 | 11.00 |
| deep | 14 | 2 | 12.34 |
| reactive | 10 | 8 | 3.33 |

ns per node visit at 1000 agents (includes the harness leaf callbacks, which dominate `npc`/`wide`
and are absent from `deep`, whose visits are almost all bare Inverter/ForceSuccess decorators):

| scenario | baseline | d1 | d2 | d3 | d4 | d5 | inlineleaf |
|---|---:|---:|---:|---:|---:|---:|---:|
| npc | 612 | 55.4 | 56.5 | 51.9 | 68.3 | 56.5 | 56.7 |
| wide | 652 | 50.3 | 56.9 | 47.4 | 54.2 | 50.8 | 46.6 |
| deep | 426 | **22.2** | 33.1 | 24.1 | 23.8 | 22.1 | 23.3 |
| reactive | 525 | 34.8 | 38.4 | 31.8 | 40.2 | 36.6 | 33.6 |

`deep` is the cleanest dispatch measurement: 22 ns for a whole decorator node visit (one call,
`KIND[id]`, a 4-deep compare chain, `FIRST[id]`, one recursive call, one status compare).

### 1c. Primitive costs in this interpreter (empty-loop subtracted, best of 5 x 20M ops)

| primitive | ns |
|---|---:|
| upvalue read | ~0.0 |
| `buffer.readf64(b, k)` | 0.6 |
| `t[i]`, dense integer key (array part) | 1.0 – 1.4 |
| `SA[id][agent]`, both dense (2x array part) | 2.4 – 2.6 |
| `t[k]`, sparse integer key (hash part) | **17 – 19** |
| `SA[id][sparse agent]` | **20 – 22** |
| if/elseif chain, per compare | ~0.35 |
| direct Lua call, 1 arg | 10.0 |
| direct Lua call, 3 args | 10.6 |
| direct Lua call, 4 args | 10.9 |
| `TF[id](id, a, dt)` (array read + indirect call) | 11.7 |
| `H[KIND[id]].tick(id, a, dt)` | 14.5 |

**The single most important number: a Lua call costs ~10.5 ns, an array index ~1.2 ns. One call is
worth eight to ten array reads.** Extra call arguments are nearly free (~0.25 ns each), which is why
d1 keeps `(id, agent, dt)` rather than hiding `agent`/`dt` in upvalues.

### 1d. add_agent / remove_agent cost (1000 agents, us per agent, best of 5)

| scenario | d1 add | d5 add | baseline add | d1 remove | d5 remove | baseline remove |
|---|---:|---:|---:|---:|---:|---:|
| npc (17 maps) | 0.114 | 0.069 | 13.04 | 0.288 | 0.212 | 2.75 |
| wide (33 maps) | 0.187 | 0.072 | 31.32 | 0.355 | 0.179 | 4.03 |
| deep (2 maps) | 0.038 | 0.061 | 4.49 | 0.229 | 0.235 | 4.65 |
| reactive (8 maps) | 0.062 | 0.065 | 6.22 | 0.115 | 0.096 | 1.34 |

SoM add is O(number of stateful nodes); the buffer's add is O(1) (one `buffer.fill` memset) and
flat across tree sizes. Both are 40–400x cheaper than building a tree per agent.

### 1e. Final full run (all agent counts, one run, `--no-check`)

```
runtime: Lune 0.10.5+709 (Luau interpreter, no native codegen)

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 2.036 | 480 | 10.62 |
| flat_dispatch | npc | 1 | 0.315 | 0 | 0.33 |
| flat_dispatch_handlers | npc | 1 | 0.347 | 0 | 0.33 |
| flat_dispatch_pernode | npc | 1 | 0.308 | 0 | 0.33 |
| flat_dispatch_stack | npc | 1 | 0.413 | 0 | 0.33 |
| flat_dispatch_buffer | npc | 1 | 0.336 | 0 | 0.09 |
| flat_dispatch_inlineleaf | npc | 1 | 0.318 | 0 | 0.33 |
| baseline | npc | 10 | 2.143 | 480 | 4.68 |
| flat_dispatch | npc | 10 | 0.237 | 0 | 0.53 |
| flat_dispatch_handlers | npc | 10 | 0.241 | 0 | 0.53 |
| flat_dispatch_pernode | npc | 10 | 0.217 | 0 | 0.53 |
| flat_dispatch_stack | npc | 10 | 0.314 | 0 | 0.53 |
| flat_dispatch_buffer | npc | 10 | 0.244 | 0 | 0.37 |
| flat_dispatch_inlineleaf | npc | 10 | 0.218 | 0 | 0.53 |
| baseline | npc | 100 | 2.192 | 481 | 8.67 |
| flat_dispatch | npc | 100 | 0.215 | 0 | 0.44 |
| flat_dispatch_handlers | npc | 100 | 0.224 | 0 | 0.44 |
| flat_dispatch_pernode | npc | 100 | 0.199 | 0 | 0.44 |
| flat_dispatch_stack | npc | 100 | 0.306 | 0 | 0.44 |
| flat_dispatch_buffer | npc | 100 | 0.224 | 0 | 0.46 |
| flat_dispatch_inlineleaf | npc | 100 | 0.261 | 0 | 0.44 |
| baseline | npc | 1000 | 2.298 | 480 | 8.66 |
| flat_dispatch | npc | 1000 | 0.206 | 0 | 0.37 |
| flat_dispatch_handlers | npc | 1000 | 0.210 | 0 | 0.37 |
| flat_dispatch_pernode | npc | 1000 | 0.193 | 0 | 0.37 |
| flat_dispatch_stack | npc | 1000 | 0.254 | 0 | 0.37 |
| flat_dispatch_buffer | npc | 1000 | 0.222 | 0 | 0.40 |
| flat_dispatch_inlineleaf | npc | 1000 | 0.253 | 0 | 0.37 |
| baseline | wide | 1 | 5.602 | 224 | 21.64 |
| flat_dispatch | wide | 1 | 0.573 | 0 | 0.58 |
| flat_dispatch_handlers | wide | 1 | 0.731 | 0 | 0.58 |
| flat_dispatch_pernode | wide | 1 | 0.557 | 0 | 0.58 |
| flat_dispatch_stack | wide | 1 | 0.620 | 0 | 0.58 |
| flat_dispatch_buffer | wide | 1 | 0.585 | 0 | 1.77 |
| flat_dispatch_inlineleaf | wide | 1 | 0.574 | 0 | 0.58 |
| baseline | wide | 10 | 5.898 | 224 | 19.38 |
| flat_dispatch | wide | 10 | 0.525 | 0 | 0.93 |
| flat_dispatch_handlers | wide | 10 | 0.586 | 0 | 0.93 |
| flat_dispatch_pernode | wide | 10 | 0.493 | 0 | 0.93 |
| flat_dispatch_stack | wide | 10 | 0.574 | 0 | 0.93 |
| flat_dispatch_buffer | wide | 10 | 0.518 | 0 | 0.57 |
| flat_dispatch_inlineleaf | wide | 10 | 0.504 | 0 | 0.93 |
| baseline | wide | 100 | 6.301 | 224 | 21.46 |
| flat_dispatch | wide | 100 | 0.534 | 0 | 0.76 |
| flat_dispatch_handlers | wide | 100 | 0.626 | 0 | 0.76 |
| flat_dispatch_pernode | wide | 100 | 0.515 | 0 | 0.76 |
| flat_dispatch_stack | wide | 100 | 0.577 | 0 | 0.76 |
| flat_dispatch_buffer | wide | 100 | 0.541 | 0 | 0.76 |
| flat_dispatch_inlineleaf | wide | 100 | 0.523 | 0 | 0.76 |
| baseline | wide | 1000 | 7.180 | 224 | 21.45 |
| flat_dispatch | wide | 1000 | 0.526 | 0 | 0.61 |
| flat_dispatch_handlers | wide | 1000 | 0.614 | 0 | 0.61 |
| flat_dispatch_pernode | wide | 1000 | 0.512 | 0 | 0.61 |
| flat_dispatch_stack | wide | 1000 | 0.605 | 0 | 0.61 |
| flat_dispatch_buffer | wide | 1000 | 0.555 | 0 | 0.64 |
| flat_dispatch_inlineleaf | wide | 1000 | 0.504 | 0 | 0.61 |
| baseline | deep | 1 | 4.753 | 1120 | 8.34 |
| flat_dispatch | deep | 1 | 0.419 | 0 | 0.09 |
| flat_dispatch_handlers | deep | 1 | 0.575 | 0 | 0.09 |
| flat_dispatch_pernode | deep | 1 | 0.436 | 0 | 0.09 |
| flat_dispatch_stack | deep | 1 | 0.472 | 0 | 0.09 |
| flat_dispatch_buffer | deep | 1 | 0.425 | 0 | 0.09 |
| flat_dispatch_inlineleaf | deep | 1 | 0.444 | 0 | 0.09 |
| baseline | deep | 10 | 4.933 | 1120 | 2.50 |
| flat_dispatch | deep | 10 | 0.287 | 0 | 0.15 |
| flat_dispatch_handlers | deep | 10 | 0.458 | 0 | 0.15 |
| flat_dispatch_pernode | deep | 10 | 0.326 | 0 | 0.15 |
| flat_dispatch_stack | deep | 10 | 0.323 | 0 | 0.15 |
| flat_dispatch_buffer | deep | 10 | 0.290 | 0 | 0.18 |
| flat_dispatch_inlineleaf | deep | 10 | 0.334 | 0 | 0.15 |
| baseline | deep | 100 | 5.267 | 1120 | 4.39 |
| flat_dispatch | deep | 100 | 0.285 | 0 | 0.12 |
| flat_dispatch_handlers | deep | 100 | 0.451 | 0 | 0.12 |
| flat_dispatch_pernode | deep | 100 | 0.298 | 0 | 0.12 |
| flat_dispatch_stack | deep | 100 | 0.322 | 0 | 0.12 |
| flat_dispatch_buffer | deep | 100 | 0.290 | 0 | 0.16 |
| flat_dispatch_inlineleaf | deep | 100 | 0.290 | 0 | 0.12 |
| baseline | deep | 1000 | 5.191 | 1120 | 4.38 |
| flat_dispatch | deep | 1000 | 0.274 | 0 | 0.10 |
| flat_dispatch_handlers | deep | 1000 | 0.401 | 0 | 0.10 |
| flat_dispatch_pernode | deep | 1000 | 0.304 | 0 | 0.10 |
| flat_dispatch_stack | deep | 1000 | 0.295 | 0 | 0.10 |
| flat_dispatch_buffer | deep | 1000 | 0.265 | 0 | 0.13 |
| flat_dispatch_inlineleaf | deep | 1000 | 0.297 | 0 | 0.10 |
| baseline | reactive | 1 | 1.749 | 352 | 4.36 |
| flat_dispatch | reactive | 1 | 0.248 | 0 | 0.17 |
| flat_dispatch_handlers | reactive | 1 | 0.266 | 0 | 0.17 |
| flat_dispatch_pernode | reactive | 1 | 0.243 | 0 | 0.17 |
| flat_dispatch_stack | reactive | 1 | 0.265 | 0 | 0.17 |
| flat_dispatch_buffer | reactive | 1 | 0.253 | 0 | 0.08 |
| flat_dispatch_inlineleaf | reactive | 1 | 0.240 | 0 | 0.17 |
| baseline | reactive | 10 | 1.786 | 294 | 0.00 |
| flat_dispatch | reactive | 10 | 0.135 | 0 | 0.28 |
| flat_dispatch_handlers | reactive | 10 | 0.140 | 0 | 0.28 |
| flat_dispatch_pernode | reactive | 10 | 0.120 | 0 | 0.28 |
| flat_dispatch_stack | reactive | 10 | 0.150 | 0 | 0.28 |
| flat_dispatch_buffer | reactive | 10 | 0.140 | 0 | 0.23 |
| flat_dispatch_inlineleaf | reactive | 10 | 0.126 | 0 | 0.28 |
| baseline | reactive | 100 | 1.635 | 289 | 4.31 |
| flat_dispatch | reactive | 100 | 0.117 | 0 | 0.22 |
| flat_dispatch_handlers | reactive | 100 | 0.123 | 0 | 0.22 |
| flat_dispatch_pernode | reactive | 100 | 0.105 | 0 | 0.22 |
| flat_dispatch_stack | reactive | 100 | 0.133 | 0 | 0.22 |
| flat_dispatch_buffer | reactive | 100 | 0.123 | 0 | 0.25 |
| flat_dispatch_inlineleaf | reactive | 100 | 0.112 | 0 | 0.22 |
| baseline | reactive | 1000 | 1.749 | 288 | 4.30 |
| flat_dispatch | reactive | 1000 | 0.116 | 0 | 0.18 |
| flat_dispatch_handlers | reactive | 1000 | 0.124 | 0 | 0.18 |
| flat_dispatch_pernode | reactive | 1000 | 0.106 | 0 | 0.18 |
| flat_dispatch_stack | reactive | 1000 | 0.134 | 0 | 0.18 |
| flat_dispatch_buffer | reactive | 1000 | 0.122 | 0 | 0.21 |
| flat_dispatch_inlineleaf | reactive | 1000 | 0.112 | 0 | 0.18 |
```

The `KB/agent` column at N = 1 is dominated by fixed costs and is not comparable across cases; use
N = 100/1000. `flat_dispatch_buffer`'s figure is inflated at large N because the metric counts the
discarded halves of the buffer doublings (see section 5).

---

## 2. What each variant changed, in numbers

**d1 `flat_dispatch` (the design).** Node ids are assigned breadth-first, so a composite's children
are the contiguous id range `FIRST[id] .. FIRST[id] + CNT[id] - 1`; a decorator is just a composite
with `CNT == 1`, so there is **no children table anywhere**. All node data lives in parallel arrays
(`KIND`, `FIRST`, `CNT`, `PARAM`, `SPOL`, `FPOL`, `FS`, `FT`, `FH`) that are upvalues of one
`tick_node` closure per *world* (not per node). The kind chain is ordered by visit frequency
(hookless leaf, hooked leaf, Sequence, Inverter, Fallback, ...), which matters: a compare costs
~0.35 ns, so an out-of-order 14-way chain would cost ~2.5 ns/visit instead of ~0.5.

**d2 `flat_dispatch_handlers`: 1.02x – 1.49x slower than d1.** Replacing the chain with
`H[KIND[c]].tick(c, agent, dt)` costs `+8 ns/visit` on `deep` and `+6.6 ns/visit` on `wide`. The
micro-benchmark says the three lookups should cost only ~2.8 ns more than d3's single lookup; the
real cost is ~3x that, because the interpreter has to dispatch four extra VM instructions
(two `GETUPVAL`, one `GETTABLE`, one `GETTABLEKS`) in a loop that is already dispatch-bound. This is
the clear loser and the one design I would not ship.

**d3 `flat_dispatch_pernode`: 0.91x – 1.08x of d1, i.e. a wash.** `TF[c](c, agent, dt)` trades the
`KIND[c]` read plus the compare chain for nothing at all (the `TF[c]` read replaces the `KIND[c]`
read one-for-one). It wins slightly where the tree is shallow and kind-diverse (npc, wide, reactive:
6–9% faster) and loses slightly on `deep`, where d1's chain hits `K_INV` at position 4 and d1's one
big function keeps everything in one code object. **This is the variant I would ship**: same speed
as d1 and, unlike d1, a user can register a new node kind from outside the module (section 3).

**d4 `flat_dispatch_stack`: 1.07x – 1.23x slower.** It is perfectly feasible to make
Sequence/Fallback/Parallel resumption work iteratively — the frame just carries the child cursor and,
for Parallel, the two counters (`STK_C/STK_A/STK_B`), and the node's own SoM state stays exactly
where it was. It costs ~30 lines more per composite (an "enter" branch and a "resume" branch instead
of one loop), and it is measurably slower for a simple reason: **a composite is dispatched once per
child return plus once on entry, where the recursive version is dispatched once in total.** A
3-child Sequence goes from 1 dispatch to 4. The trade is "one saved Lua call (10.5 ns) per node vs
one extra kind dispatch (~4 ns) per *edge*", and with average branching near 2 the call saving does
not cover it. It only pays where nodes are many and shallow (`deep`: 1.07x, essentially neutral).
It also cannot be interrupted mid-traversal without a second stack, so halting stayed recursive.
Verdict: not worth it; recursion is the right tool here. (It would become attractive only if you
needed to suspend a traversal across frames.)

**d5 `flat_dispatch_buffer`: 1.00x – 1.05x of d1, i.e. no speed win, and real pain.** This is the
most surprising result, and the explanation is in 1c: **the harness's agent ids are dense (1..N), so
`SA[id][agent]` lands in the table's *array part* and costs 2.4 ns for both reads — nearly the same
as `OFFA[id]` + `buffer.readf64` (1.8 ns).** The buffer's real win is `add_agent` (O(1) memset vs
O(#stateful nodes) table stores: 0.072 us vs 0.187 us on `wide`) and steady-state footprint
(8 B/field vs ~16–32 B/field). The pain is exactly what the SPEC warns about:
- an id -> slot map, a slot free list, a slot -> base array and a live-agent array, four structures
  to keep in sync on every add/remove (the swap-remove in `remove` touches four of them);
- the buffer must be doubled and copied as the agent high-water mark rises;
- every idle sentinel has to be 0.0 so a fresh slot can be cleared with one `buffer.fill`, which
  forced Repeat to store `count + 1` and Parallel to store `status + 1` — two off-by-one traps that
  exist for no reason other than the storage choice;
- only numbers fit, so hooks, policies and the node arrays still live in ordinary tables anyway.

  **But:** if agent ids are *not* dense — the realistic Roblox case, where ids come from instance
  attributes or a global counter that never resets — `m[agent]` becomes a hash-part read and the
  measured cost jumps from 2.4 ns to **20–22 ns per node per tick**, roughly doubling the cost of a
  node visit. The cheap fix keeps SoM tables and dense slots: hand out a dense `slot` at `add_agent`
  and key the SoM maps by `slot` instead of by the caller's id (one hash lookup per agent per tick
  instead of one per node per tick). That gets d5's robustness without a buffer, a free-list-shaped
  sentinel scheme, or losing the ability to store non-numbers.

**extra `flat_dispatch_inlineleaf`: 0.93x – 1.05x of d1.** Each recursion site does
`if KIND[c] == K_LEAF then FT[c](agent, dt) else tick_node(c, agent, dt)`, trading one array read
plus one compare (~1.6 ns) for one saved Lua call (~10.5 ns) on roughly half of all node visits. It
should have been a clear ~15% win on leaf-heavy `wide` and it was only 7%; on `deep` (few leaves) it
is 5% slower, as expected. The gap between prediction and result is the honest summary of this whole
experiment: **at ~22–55 ns per node visit, the interpreter's own instruction dispatch, not any single
lookup, is the budget.**

---

## 3. API sketch

### Declaring a tree, and a leaf with the three hooks

The spec is plain data — identical in shape to `harness/scenarios.luau`. Nothing is instantiated per
agent; `compile` flattens it into the arrays once.

```lua
local BT = require(script.Parent.BehaviorTree)
local SUCCESS, FAILURE, RUNNING = BT.SUCCESS, BT.FAILURE, BT.RUNNING

-- per-agent leaf state is SoM, owned by whoever writes the leaf
local swing = {}

local tree = BT.compile({
    kind = "Fallback",
    children = {
        { kind = "Sequence", children = {
            -- a condition leaf: on_tick only. Costs no state and no start/halt bookkeeping.
            { kind = "Leaf", name = "see_enemy",
              on_tick = function(agent, dt)
                  return BB.target[agent] ~= nil and SUCCESS or FAILURE
              end },

            -- an action leaf: all three hooks, all take the agent id and nothing else
            { kind = "Cooldown", seconds = 1.0, child = {
                kind = "Leaf", name = "attack",
                on_start = function(agent) swing[agent] = 0 end,
                on_tick  = function(agent, dt)
                    local t = swing[agent] + dt
                    swing[agent] = t
                    return if t >= 0.6 then SUCCESS else RUNNING
                end,
                on_halt  = function(agent) swing[agent] = nil end,
            } },
        } },
        { kind = "IfThenElse", children = { is_hurt, flee, patrol } },
    },
})

tree:add(agent_id)          -- allocates this agent's slot in every state map
tree:tick(dt)               -- ticks every live agent; tree:status(agent_id) for the root result
tree:remove(agent_id)       -- halts everything running for it (on_halt fires), frees its slots
```

A leaf that declares neither `on_start` nor `on_halt` is compiled to a different kind (`K_LEAF`) that
owns no per-agent state at all and whose `halt` is a no-op — this is how "a design should not pay for
absent hooks" is honoured, and it is worth real money: in `npc` 6 of 11 leaves are hookless.

### Adding a new composite kind

This is the one place where d1 and d3 differ in *API*, not just in speed. With d1's if/elseif chain a
new kind means editing three places inside the module (the kind constants, the build switch, the tick
chain, the halt chain) and users cannot add one at all. With **d3** the handler is pre-resolved per
node, so a kind is just a registration; this is why d3 is the version to ship.

```lua
-- `b` is the build context: it hands out the shared node arrays and this kind's state maps.
-- Registration happens once, before compile().
BT.register("IfThenElse", function(b)
    local FIRST, CNT   = b.FIRST, b.CNT     -- shared node arrays (upvalues, not table fields)
    local TICK, HALT   = b.TICK, b.HALT     -- per-node resolved handlers: TICK[id](id, agent, dt)
    local RUN          = b.state(0)         -- one SoM map per node of this kind; 0 == idle

    return {
        -- called once per node at compile time; children are already laid out contiguously
        build = function(id, spec)
            assert(#spec.children == 2 or #spec.children == 3, "IfThenElse takes 2 or 3 children")
        end,

        tick = function(id, agent, dt)
            local m, first = RUN[id], FIRST[id]
            local running = m[agent]

            if running > first then                        -- resume the THEN / ELSE branch
                local s = TICK[running](running, agent, dt)
                if s ~= RUNNING then m[agent] = 0 end
                return s
            end

            local c = TICK[first](first, agent, dt)        -- the condition
            if c == RUNNING then
                m[agent] = first                           -- remember it: halt must reach it
                return RUNNING
            end

            local branch
            if c == SUCCESS then
                branch = first + 1
            elseif CNT[id] == 3 then
                branch = first + 2
            else
                m[agent] = 0
                return FAILURE
            end

            local s = TICK[branch](branch, agent, dt)
            m[agent] = if s == RUNNING then branch else 0
            return s
        end,

        halt = function(id, agent)                         -- only called when this node IS running
            local m = RUN[id]
            local running = m[agent]
            m[agent] = 0
            if running ~= 0 then HALT[running](running, agent) end
        end,
    }
end)
```

The whole contract for a new kind is two sentences: **record which child is running, and make `halt`
forward to it.** Everything else (ids, child ranges, per-agent slot allocation, the agent loop) is
the framework's.

---

## 4. How halting works, and what state a node holds

There is **no running-node set and no end-of-tick sweep**. The baseline's rule — "if X was running at
the end of tick T then during T+1 it is either ticked or halted, never neither, never both" — is
enforced by an explicit cascade with one invariant:

> `halt_node(id, agent)` is only ever called on a node that *is* running for that agent.

That invariant lets `halt` skip the "am I running?" test that the baseline pays for on every node,
and it lets three node kinds carry no per-agent state at all. Each kind knows which of its children is
the running one:

| kind | per-agent state | who it halts |
|---|---|---|
| `Leaf` (no hooks) | **none** | nothing (halting it is a genuine no-op) |
| `Leaf` (any hook) | `SA` = 0 idle / 1 running | calls `on_halt(agent)` |
| `Sequence`, `Fallback` | `SA` = 0 idle / cursor **child id** | the cursor child (it returned RUNNING, so it is running) |
| `ReactiveSequence`, `ReactiveFallback` | `SA` = 0 / id of **the one** running child | that child. Because the node halts all others whenever it returns RUNNING, at most one child is ever running, so one scalar replaces the baseline's `HaltOtherChildren` scan |
| `Parallel` | `PS[child]` = -1 idle / RUNNING / SUCCESS / FAILURE, one map **per child slot** | every child whose `PS` is RUNNING. This doubles as the "completed children" set, so the baseline's per-run `Map` allocation disappears |
| `Inverter`, `ForceSuccess`, `ForceFailure` | **none** | its child, unconditionally (these are running exactly when their child is) |
| `Wait` | `SA` = 0 idle / time_left (> 0 while running) | nothing |
| `Timeout` | `SA` = 0 idle / time_left | its child (and on expiry, only if the child was actually started) |
| `Cooldown` | `SA` = time_left, **persists across runs**, never an idle marker | its child (it returns RUNNING only when the child did) |
| `Repeat` | `SA` = -1 idle / count, `SB` = 1 while the **child** is running | the child, only if `SB == 1` — Repeat is the one node that can be RUNNING while its child is idle (between iterations) |

The places that halt mid-tick are exactly the four the SPEC lists: a reactive composite that finds a
different child running (`r > c` — the remembered child has an id greater than the one just ticked,
so it has not been re-ticked this tick), a Parallel hitting a ONE policy or finishing, a Timeout
expiring, and `remove_agent`. `remove_agent` halts the root if the last root status was RUNNING; the
cascade does the rest.

State values use numeric idle sentinels (`0`, or `-1` where `0` is a legal value) instead of `nil`.
I chose that to keep the hash slot alive so a re-set never calls `luaH_newkey`; **measured, `nil`
would also have been allocation-free** (20 rounds of nil-then-set over 5000 sparse keys allocated
0 bytes — Luau reuses a nil-valued key's node, and `t[k] = nil` on a never-present key does not
create one). So the sentinel is a defensive choice worth about one branch, not a requirement.

---

## 5. Memory per agent, and what add / remove cost

Per-agent memory is **one table slot per stateful node**, nothing else:

| scenario | nodes | stateful slots | SoM bytes/agent (16 B/slot, dense ids) | measured KB/agent @1000 | baseline KB/agent |
|---|---:|---:|---:|---:|---:|
| npc | 21 | 17 | 272 | 0.37 | 8.66 |
| wide | 49 | 33 | 528 | 0.61 | 21.45 |
| deep | 14 | 2 | 32 | 0.10 | 4.38 |
| reactive | 10 | 8 | 128 | 0.18 | 4.30 |

23x to 44x less per agent than the baseline's per-agent tree, and the measured figure is above the
16 B/slot floor only because of the world-level bookkeeping (`status`, `order`, `slot`) and table
growth slack. The **shared** part — the node arrays and the two closures — is allocated once per
tree, not per agent, and is a few hundred bytes for a 50-node tree.

`flat_dispatch_buffer` stores 8 B per field, so its true steady-state footprint is 136 B/agent on
`npc` and 264 B on `wide` — about half of SoM. Its reported `KB/agent` (0.40 / 0.64) is *higher* only
because the metric sums positive heap deltas and therefore counts all the discarded halves of the
capacity doublings (8 -> 16 -> ... -> 1024 allocates ~2x the final buffer).

- **add_agent** — SoM: `NMAPS` array stores (one per stateful node), 0.04–0.19 us. Buffer: one
  free-list pop plus one `buffer.fill`, 0.06–0.07 us **independent of tree size**. Baseline:
  4.5–31 us (it builds an entire tree).
- **remove_agent** — halt cascade + `NMAPS` clears + an O(1) swap-remove from the live list:
  0.12–0.36 us (SoM), 0.10–0.24 us (buffer). Baseline 1.3–4.6 us. Ids may be reused freely; the
  correctness schedule removes agent 3 at tick 30 and re-adds it at tick 70, which both variants pass.
- **steady state**: 0 B/agent-tick, in every scenario, at every agent count.

---

## 6. Pros, cons, and the verdict on the hypothesis

**Pros.** 11–19x faster than the baseline and allocation-free; 23–44x less memory per agent; adding
an agent is 40–400x cheaper than building a tree; the whole tree is three closures and ~15 arrays, so
it is trivially serialisable, inspectable and debuggable (a node is an integer you can print); the
contiguous-child-range layout removes every per-node children table and makes a decorator literally a
1-child composite; the explicit halt cascade deletes the two per-tick `Set`s, the diff, and five of
the baseline's hook calls per node.

**Cons.** With d1's if/elseif chain the node catalogue is closed — a user cannot add a kind without
editing the module (d3 fixes this at no measured cost). The state layout is bespoke per kind
(`SA`/`SB`/`PS` with per-kind sentinels), which is compact but is the part a maintainer will get
wrong; it wants a small `b.state(idle)` helper rather than hand-rolled maps. Everything is in one
module, so the file is long. And the design leans on dense-ish agent ids (section 5 / d5).

**Verdict on the hypothesis.** The flat graph is the right shape — it wins decisively on memory,
build cost, agent add/remove and allocation — but *"minimises per-node call overhead"* is not what it
does: it makes exactly the same number of Lua calls as a closure-per-node design would, and a call
(~10.5 ns) is 8–10x an array read (~1.2 ns), so the calls, not the indexing, are the budget. On the
open question: array indexing does cost more than upvalue access, but not much — a flat node visit
pays 2–5 extra ns in `KIND/FIRST/CNT/SA` reads that a closure design would get for free from
upvalues, against a 22–55 ns node visit, so **the theoretical ceiling for a closure-per-node design
is roughly 10–20% per node visit in the interpreter**, bought with one closure plus upvalue cells per
node and a much more expensive `compile`. Within the flat family the dispatch mechanism barely
matters (d1 ≈ d3 ≈ d5 ± 8%) except for the one that adds VM instructions per edge (d2, up to 1.49x)
and the one that adds a dispatch per edge (d4, up to 1.23x). I would ship **d3**: d1's speed, plus
user-registrable node kinds, and under `--!native` its balance improves further (table reads get
cheaper, calls do not, and d3 has no compare chain to speed up).

---

## 7. How the remaining baseline nodes map

All of these fit the same two rules — *record which child is running; `halt` forwards to it* — and
none needs anything the four scenarios did not already exercise.

| node | mapping | per-agent state |
|---|---|---|
| **Log** | a hookless `K_LEAF` whose `on_tick` prints and returns SUCCESS | none |
| **Switch(key)** | children = the cases in declaration order, default last; `CASES[id]` is a value -> child-id table built **once at compile time and shared by all agents**. Tick: if idle, read `bb[key][agent]`, pick the child (or default, else FAILURE), store it, tick it; clear when it returns non-RUNNING | 1 scalar (selected child id, 0 = idle) |
| **IfThenElse** | shown in full in section 3 | 1 scalar |
| **WhileDoElse** | the same shape, but the condition child is re-ticked every tick; when the branch changes, halt the remembered branch before starting the other — the same "remember the one running child, halt it when you skip it" pattern `ReactiveSequence` already implements | 1 scalar |
| **TryCatch** | 3 children (TRY / CATCH / FINALLY); the running child id plus the pending result that FINALLY must not overwrite | 2 scalars (`SA` = running child, `SB` = pending status) |
| **KeepRunningUntilSuccess / Failure(max_attempts)** | decorator, same shape as `Repeat`: attempt counter, plus the "is my child running?" flag, because like Repeat it can be RUNNING while its child is idle between attempts | 2 scalars |
| **OneShot** | decorator that latches the first non-RUNNING result: `SA` = 0 none / `status + 1`. It is running exactly when its child is, so `halt` forwards unconditionally and no second flag is needed. Its `reset_on_become_inactive` option disappears with `OnBecameInactive` (SPEC goal 3); the replacement is an explicit reset leaf, or a parent that clears the map | 1 scalar |
| **SubTree** | with a flat graph the natural mapping is to **inline it at compile time** — the subtree's spec is flattened into the same arrays and becomes an ordinary branch, at zero runtime cost, with recursion detectable at build. If a genuinely shared, independently-ticked tree is wanted, keep a leaf-shaped `K_SUBTREE` whose `on_tick` calls `other.tick_agent(agent, dt)` and whose `on_halt` calls `other.halt_agent(agent)` | none (inlined) or 1 running flag |
| **WasEntryUpdated, Timer** | hookless leaves over the SoM blackboard (`bb.field[agent]`) | none |
| **FSM / GOAP connectors** | leaves with `on_start` / `on_tick` / `on_halt`, exactly like any action | 1 running flag |
| **MemorySequence, FireAndForget, RunningGate, WaitGate, ForceRunning** | one extra kind code and one branch each; all are `Sequence` / decorator variants already covered | 0–1 scalar |

A kind needing more than two scalars just asks the build context for more state maps; nothing about
the layout changes.

---

## 8. Notes on the harness and the SPEC

No harness or SPEC bug found — the differential test caught every semantic detail I got wrong while
writing this (Cooldown's `OnExit` reset rule and Repeat's "RUNNING with an idle child" case both
failed first and were fixed against it), and all six cases passed unmodified afterwards.

Two cosmetic notes:

1. `SPEC.md` describes the `npc` scenario as "~24 nodes, depth 4"; `Scenarios.count_nodes` reports 21.
2. `KB/agent (add + 1st tick)` sums positive heap deltas, so a design that grows an arena by doubling
   (my `flat_dispatch_buffer`) is charged for the copies it discards and looks ~2x larger than it is.
   Worth knowing before comparing arena-based cases against table-based ones on that column.

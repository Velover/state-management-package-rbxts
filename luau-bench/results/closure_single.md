# closure_single — closure factories + SoM upvalue state + explicit halt cascade

All 7 cases pass the differential test against the baseline on all 4 scenarios (80 ticks, add/remove/id
reuse). Files: `cases/closure_single.luau` and `cases/closure_single_{table,epoch,hookif,hooknoop,out,ctx}.luau`.

## 1. Headline numbers

Best of 5 identical full runs (`lune run luau-bench/harness/runner.luau baseline closure_single … `,
all cases measured in the same runs so ratios are comparable; run-to-run spread was 2–30 %, see §1b).
The verbatim runner table of the final single full run is in the appendix.

| scenario | agents | baseline µs | closure_single µs | speed-up | B/agent-tick | KB/agent (add + 1st tick) |
|---|---:|---:|---:|---:|---:|---:|
| npc | 1 | 1.974 | 0.230 | 8.6x | 0 (480) | 0.14 (10.62) |
| npc | 10 | 1.977 | 0.154 | 12.8x | 0 (480) | 0.20 (4.67) |
| npc | 100 | 2.084 | 0.161 | 12.9x | 0 (482) | 0.24 (3.63) |
| npc | 1000 | 2.347 | 0.155 | **15.1x** | 0 (481) | 0.27 (8.66) |
| wide | 1 | 5.531 | 0.413 | 13.4x | 0 (224) | 0.09 (21.64) |
| wide | 10 | 5.833 | 0.421 | 13.9x | 0 (224) | 0.16 (21.42) |
| wide | 100 | 6.237 | 0.493 | 12.7x | 0 (224) | 0.18 (21.46) |
| wide | 1000 | 7.033 | 0.511 | **13.8x** | 0 (224) | 0.14 (21.45) |
| deep | 1 | 4.746 | 0.308 | 15.4x | 0 (1120) | 0.08 (8.34) |
| deep | 10 | 4.849 | 0.176 | 27.6x | 0 (1120) | 0.12 (2.85) |
| deep | 100 | 5.016 | 0.156 | 32.2x | 0 (1120) | 0.10 (4.39) |
| deep | 1000 | 5.119 | 0.159 | **32.2x** | 0 (1120) | 0.08 (4.38) |
| reactive | 1 | 1.730 | 0.201 | 8.6x | 0 (352) | 0.08 (4.36) |
| reactive | 10 | 1.652 | 0.084 | 19.7x | 0 (294) | 0.10 (4.33) |
| reactive | 100 | 1.660 | 0.070 | 23.7x | 0 (289) | 0.10 (4.31) |
| reactive | 1000 | 1.723 | 0.069 | **25.0x** | 0 (288) | 0.08 (4.30) |

(baseline values in parentheses)

**Scaling 1 → 1000 agents.** µs/agent-tick is flat from 10 to 1000 agents (npc 0.154 / 0.161 / 0.155;
reactive 0.084 / 0.070 / 0.069; deep 0.176 / 0.156 / 0.159). The N = 1 column looks ~0.08 µs worse for
every fast case because the harness calls `collectgarbage("count")` twice per *world* tick inside the
timed loop; measured at **0.0445 µs/call** in Lune, so N = 1 carries 0.089 µs/agent-tick of harness
overhead and N = 1000 carries 0.0001. Subtract it and npc is 0.141 / 0.154 / 0.155 — flat. Not a bug,
but worth knowing before reading the N = 1 rows of any design (it is 40 % of my N = 1 number and 4 % of
the baseline's).

### 1b. Noise

Other agents were benchmarking on the same machine. Per-row spread over the 5 runs was mostly 5–20 %
(worst 33 %), and the *ordering* of the variants was stable across runs for every difference reported
below that is larger than ~8 %. Differences under 5 % (notably variant e) should be read as "no effect".

## 2. Variants

µs/agent-tick, 1000 agents, best of 5, and the delta vs `closure_single`:

| case | npc | wide | deep | reactive | verdict |
|---|---:|---:|---:|---:|---|
| **closure_single** | **0.155** | **0.511** | **0.159** | **0.069** | keep |
| closure_single_table (a) | 0.168 +8% | 0.535 +5% | 0.206 **+30%** | 0.078 +13% | reject |
| closure_single_epoch (b) | 0.212 **+37%** | 0.628 +23% | 0.190 +19% | 0.108 **+57%** | reject |
| closure_single_hookif (c) | 0.174 +12% | 0.739 **+45%** | 0.177 +11% | 0.128 **+86%** | reject |
| closure_single_hooknoop (c) | 0.171 +10% | 0.795 **+56%** | 0.180 +13% | 0.134 **+94%** | reject |
| closure_single_out (d) | 0.165 +6% | 0.543 +6% | 0.187 +18% | 0.080 +16% | reject |
| closure_single_ctx (e) | 0.151 −3% | 0.509 −0% | 0.157 −1% | 0.066 −4% | free, take it |

**(a) node table vs parallel closure arrays.** `closure_single` copies each child's `tick`/`halt` into
two build-time arrays (`ct[i](agent, dt)`), `_table` keeps the node tables and does
`ct[i].tick(agent, dt)`. Cost of the extra field lookup: +5…+13 % on the composite-heavy scenarios and
**+30 % on `deep`** (12 levels of decorator, where the indirection is essentially the whole workload).
Note the API is unchanged — the factory still *takes* node tables, it just unpacks them once at build
time. Free win, no reason not to.

**(b) epoch / sweep.** Nodes stamp `stamp[agent] = NOW` when ticked and push themselves onto a reusable
per-agent list when they return RUNNING; after the agent's root tick the runner walks *last* tick's list
and halts entries whose stamp is stale. It is 19–57 % slower and needs ~2x the per-agent memory
(npc 0.57 vs 0.27 KB/agent, wide 0.61 vs 0.14). Two findings:

- *It cannot express the whole halting rule.* A sweep can only halt a node that was **not ticked this
  tick**. `Parallel` with a ONE policy preempts siblings that already ran earlier in the same tick, and
  those carry a fresh stamp. Repro: take `cases/closure_single_epoch.luau` and delete the two
  `for j = base + 1, CUR_N do HALTS[CUR[j]](agent) end` lines →
  `[closure_single_puresweep] npc FAIL at tick 14 / missing events: look_around:halt:1`.
  I had to put a cascade back in, expressed over the list: the list is in depth-first order, so a node
  records `base = CUR_N` on entry and halts exactly the entries pushed by its own subtree. That works
  and is arguably elegant, but it *is* a cascade.
- *What it does buy* is real but small: `ReactiveSequence`/`ReactiveFallback` become completely
  stateless (no "which child is running" index), `Timeout` does not halt its child, `Repeat` does not
  track whether its child is running. The price is one hash write per stateful node per tick, one
  array push per running node, a second map per node, two tables per agent, and the sweep loop.

**(c) hooks.** Three strategies, all measured:

| leaf strategy | wide (16 hookless condition leaves/tick) | reactive |
|---|---:|---:|
| build-time specialisation (main) | 0.511 | 0.069 |
| `if on_start then on_start(agent) end` | 0.739 (+45 %) | 0.128 (+86 %) |
| shared no-op bound at build time | 0.795 (+56 %) | 0.134 (+94 %) |

`if`-check vs no-op is a **tie** (the no-op is 0–8 % worse: a real call beats a predictable branch by
nothing). The interesting result is the third option the brief did not list: pick the closure shape at
build time. A leaf with no `on_start` needs no `started[agent]` map and no wrapper at all — the node's
`tick` *is* the user's `on_tick` function. That removes a call frame, a hash read and a hash write per
condition leaf per tick, which is where the 45–94 % comes from. On trees where every leaf has all three
hooks the three strategies converge (npc/deep are only ~11 % apart).

**(d) return the status vs write `status[agent]`.** Writing into a shared per-agent slot that the parent
reads is 6–18 % slower: a hash write plus a hash read beats a register return nowhere. It has one nice
property — a node whose result is its child's result (Sequence→FAILURE, Fallback→SUCCESS, Timeout,
Cooldown off cooldown) writes nothing at all — but it also forces a wrapper closure around every leaf,
losing (c)'s best trick.

**(e) `(agent, dt)` vs `(agent, dt, ctx)`.** No measurable cost (−4…0 %, inside noise, and it was
*faster* in 4 of 4 scenarios, which I read as "free"). Luau pushes the third argument into a register
that is already reserved by the call frame. **Take the ctx parameter** — threading a world/blackboard
handle through the tree costs nothing and removes the need for module-level upvalue state.

## 3. API sketch

Nodes are declared by factories; no class, no `:AddChild`, no per-agent instance.

```lua
local BT = require(script.Parent.BehaviorTree)

local tree = BT.Fallback {
    BT.Sequence {
        BT.Leaf { name = "see_enemy", on_tick = function(agent) return see[agent] and SUCCESS or FAILURE end },
        BT.Cooldown(1.0, BT.Leaf {
            name     = "attack",
            on_start = function(agent) progress[agent] = 0 end,
            on_tick  = function(agent, dt)
                progress[agent] += dt
                return progress[agent] >= 0.5 and SUCCESS or RUNNING
            end,
            on_halt  = function(agent) progress[agent] = nil end,
        }),
    },
    BT.ReactiveSequence {
        BT.Leaf { name = "hungry", on_tick = is_hungry },   -- on_tick only: zero per-agent state
        BT.Repeat(2, eat),
    },
    BT.Wait(0.5),
}

local world = BT.World(tree)
world:Add(agent_id)       -- one array append; no state allocated until a node is first reached
world:Tick(dt)            -- ticks every live agent
world:Remove(agent_id)    -- halts whatever is running (on_halt fires), frees the agent's slots
```

`on_start`/`on_halt` are optional and absent hooks cost nothing at run time (§2c). `Leaf` is the only
node kind a user normally writes; `OnBecameActivated` / `OnBecameInactive` are gone (do the work in
`on_start`, return RUNNING, undo it in `on_halt`).

**A new composite kind is ~30 lines and needs no framework knowledge** — return a table with `tick`,
`halt` and the list of your state maps. This is the real `IfThenElse` (baseline semantics: once a branch
is chosen it is resumed without re-evaluating the condition), verified to run:

```lua
local function IfThenElse(children)
    local branch = {}          -- per agent: 1 = condition running, 2/3 = that branch running, nil = idle
    local maps = { branch }
    local n, ct, ch = split(children, maps)      -- split: children -> parallel tick/halt arrays
    return {
        tick = function(agent, dt)
            local b = branch[agent]
            if b ~= nil and b ~= 1 then          -- resume the chosen branch, do not re-evaluate
                local s = ct[b](agent, dt)
                if s ~= RUNNING then branch[agent] = nil end
                return s
            end
            local c = ct[1](agent, dt)
            if c == RUNNING then
                branch[agent] = 1
                return RUNNING
            end
            b = if c == SUCCESS then 2 else 3
            if b > n then                         -- no else branch
                if branch[agent] ~= nil then branch[agent] = nil end
                return FAILURE
            end
            local s = ct[b](agent, dt)
            if s == RUNNING then
                branch[agent] = b
            elseif branch[agent] ~= nil then
                branch[agent] = nil
            end
            return s
        end,
        halt = function(agent)                    -- only called when this node is running for `agent`
            local b = branch[agent]
            branch[agent] = nil
            ch[b](agent)
        end,
        maps = maps,
    }
end
```

The three rules an author must follow: (1) `halt(agent)` may assume the node is running for that agent —
halt exactly the child you know is running; (2) when you return SUCCESS/FAILURE leave no child running;
(3) put every per-agent table in `maps` so `Remove` can free it.

## 4. Halting and per-agent state

Halting is an **explicit cascade**, not a diff and not a sweep: every parent already stores which child
is running for an agent, so `halt(agent)` walks exactly the running spine and nothing else. There is no
`is_running` flag anywhere — "running" is encoded in the state a node already needs (`cursor[agent] ~=
nil` *is* "running, at child `cursor[agent]`"). Decorators that are running exactly when their child is
(`Inverter`, `ForceSuccess`, `ForceFailure`, `Cooldown`) set `halt = child.halt` at build time: halting
through them is literally free.

| node | per-agent state | halt |
|---|---|---|
| Sequence / Fallback | `cursor[agent]` (nil = idle) | halt child `cursor`, clear |
| ReactiveSequence / ReactiveFallback | `rc[agent]` = the one running child | halt child `rc`, clear |
| Parallel | `done[agent]`, `succ[agent]`, `run[agent]` — three bitmasks, no per-agent set/table | halt children in `run & ~done`, clear |
| Inverter / ForceSuccess / ForceFailure | none | `= child.halt` |
| Repeat(count) | `cnt[agent]`: nil = idle, `c` = running with an idle child, `-(c+1)` = running with a running child | clear; halt child if it was running |
| Wait / Timeout | `time_left[agent]` (nil = idle) | clear (Timeout also halts its child) |
| Cooldown | `time_left[agent]`, persists across runs *and* halts | `= child.halt` |
| Leaf with `on_start` | `started[agent]` | clear, `on_halt(agent)` |
| Leaf without `on_start` | **none** | `on_halt` or a shared no-op |

Two spots where the baseline halts late and I had to halt eagerly to match the per-tick event multiset:
`ReactiveSequence` returning FAILURE at child *i* while child *j > i* is still running (the baseline's
end-of-tick sweep catches it; I halt it inline), and `Timeout` expiring. Both were caught by the
differential test, which is doing its job.

Allocation: nil is the idle marker, and every `t[agent] = nil` is guarded by "was it non-nil?", so a
node never inserts a hash key just to delete it. Re-entering a node reuses the key slot Luau left
behind. Measured result: **0 B/agent-tick** on all 4 scenarios at every agent count, including scenarios
that switch branches every tick.

## 5. Memory and add/remove cost

| | closure_single | epoch | baseline |
|---|---:|---:|---:|
| state maps for the npc tree (21 nodes) | 16 | 26 | — (one tree per agent) |
| B/agent, npc, add + 1st tick | 276 | 584 | 8 870 |
| B/agent, npc, after 20 ticks | 361 | 781 | 16 890 |
| B/agent, wide (49 nodes) after 20 ticks | 148 | 897 | 12 052 |
| B/agent, deep after 20 ticks | 82 | 324 | 22 693 |
| `add_agent` µs/agent (1000 agents) | **0.03** | 0.05 | 4.9–31.1 |
| `remove_agent` µs/agent (1000 live) | 0.27–1.41 | 0.32–2.56 | 0.93–4.78 |

`add_agent` is one array append — nothing is allocated until the agent actually reaches a node, so an
agent that never enters a branch never pays for it (that is why `wide`, with 49 nodes, costs *less* per
agent than `npc` with 21: 15 of its 16 branches are never entered). `remove_agent` halts the root if the
agent's last root status was RUNNING, then does `#maps` hash deletes; the numbers above are dominated by
the `table.find` + `table.remove` on the id list, which I copied from the baseline adapter — a real
implementation should swap-remove with an id→index map.

Per-agent memory is 30–150x smaller than the baseline and ~2.4x smaller than the epoch variant.

## 6. Pros / cons and verdict

**Pros.** 13–32x faster than the baseline, 0 B/agent-tick, 276 B/agent instead of 8.9 KB, flat µs per
agent-tick from 1 to 1000 agents, `add_agent` ≈ free. The whole implementation is 460 lines with no
class hierarchy, no `self`, no sets, no allocation paths to audit; a new node kind is one function that
returns `{ tick, halt, maps }`. Per-agent state is exactly the SoM the spec asks for and is directly
inspectable (`cursor[agent]`).

**Cons.** Halting correctness is the author's responsibility, not the framework's: a node kind that
forgets to halt a skipped child leaks a running leaf, and nothing detects it (the baseline's sweep was a
safety net; I removed it). Node state has to be hand-encoded to stay in one map (`Repeat`'s negative
counter is the ugliest thing in the file) — a sign that "one map per field" wants a small helper. A
node's per-agent state is invisible to tooling unless `maps` is maintained, and forgetting to add a map
there leaks that field on `remove_agent`. `Parallel`'s bitmasks cap it at 32 children (fall back to
per-child maps beyond that). Debugging is worse than an OOP tree: a stack trace is a pile of anonymous
closures, so nodes need a `name` kept in a parallel build-time array for tooling.

**Verdict on the hypothesis: confirmed, with one correction.** Closure factories with per-agent SoM
upvalues, single-agent depth-first recursion, no sets and an explicit cascade give 13–32x over the
baseline at zero steady-state allocation, and the API stays a one-liner per node — the hypothesis's
"most of the achievable speed with the simplest API" holds. The correction is that the two things the
hypothesis treats as details are the only choices that mattered: **specialising the leaf closure at
build time** (up to +94 % if you don't) and **unpacking children into parallel closure arrays** (up to
+30 % if you don't); the epoch/sweep alternative is both slower and unable to express Parallel's
preemption without reintroducing a cascade. Everything else I measured — extra `ctx` argument, shared
status slot, no-op vs nil-check — is within a few percent, so spend the freedom on the `ctx` parameter
and keep returning the status.

## 7. How the remaining baseline nodes would map

All of these are composites/decorators over the same two-closure protocol; per-agent state stays SoM.

| node | mapping | per-agent state |
|---|---|---|
| **IfThenElse** | written out in §3 | `branch[agent]` (1 = cond, 2/3 = branch) |
| **WhileDoElse** | like IfThenElse but the condition is re-ticked every tick; when it flips, halt the old branch (`ch[b](agent)`) before ticking the new one — the same inline halt the reactive composites do | `branch[agent]` |
| **Switch(key)** | resolve `bb[key][agent]` to a child index at start, store it, tick it; on halt, halt that child. Cases become a build-time `value -> index` map plus a default index | `case_idx[agent]` |
| **TryCatch** | a 3-state machine over `phase[agent]` (0 = try, 1 = catch, 2 = finally) plus `pending[agent]` for the result held across the finally branch; halt = halt the child for `phase` | `phase[agent]`, `pending[agent]` |
| **KeepRunningUntilSuccess/Failure** | exactly `Repeat`'s shape with a different terminal test; `max_attempts <= 0` means the counter is never read, so specialise the closure at build time and skip the map entirely | `attempts[agent]` (only if `max_attempts > 0`) |
| **OneShot** | `res[agent]` (nil = not yet decided). Tick the child until it is non-RUNNING, then cache and return the cached value. `reset_on_become_inactive` has no equivalent (OnBecameInactive is dropped) — express it as "clear in `on_halt`", which is what halting already gives you | `res[agent]` |
| **SubTree** | a subtree is just a node, so it is `{ tick = other_root.tick, halt = other_root.halt }` — zero cost, and its `maps` merge into the parent tree's list so `remove_agent` frees it too. A subtree with its *own* agent set (baseline's `BehaviorTree` instance) becomes a leaf whose `on_tick` drives the other world | none |
| **Log** | `Leaf { on_tick = function(agent) print(msg) return SUCCESS end }` — no node kind needed | none |
| **Timer / WasEntryUpdated** | blackboard-reading condition leaves; SoM blackboard makes them `Leaf { on_tick = ... bb.field[agent] ... }` | none |
| **ForceRunning / FireAndForget / RunningGate** | decorators with no state, `halt = child.halt`, like Inverter | none |

The two that do *not* map cleanly are `OnBecameActivated` / `OnBecameInactive` (intentionally dropped —
they require the active-node set that costs the baseline 224–1120 B/tick) and anything that wants to
know "was I ticked last tick" without being a parent's business; those need the epoch variant's stamp,
which §2b prices at ~20–60 %.

## Appendix — verbatim runner table, final full run

`lune run luau-bench/harness/runner.luau baseline closure_single closure_single_table
closure_single_epoch closure_single_hookif closure_single_hooknoop closure_single_out closure_single_ctx`
(all 7 cases passed the correctness test in this run; this single run is noisier than the best-of-5
above, e.g. baseline npc/1000 came out at 2.532 µs vs 2.347 best-of-5).

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 2.108 | 480 | 8.75 |
| closure_single | npc | 1 | 0.239 | 0 | 0.14 |
| closure_single_table | npc | 1 | 0.241 | 0 | 0.14 |
| closure_single_epoch | npc | 1 | 0.296 | 0 | 0.42 |
| closure_single_hookif | npc | 1 | 0.242 | 0 | 0.20 |
| closure_single_hooknoop | npc | 1 | 0.234 | 0 | 0.20 |
| closure_single_out | npc | 1 | 0.250 | 0 | 0.14 |
| closure_single_ctx | npc | 1 | 0.229 | 0 | 0.14 |
| baseline | npc | 10 | 2.042 | 480 | 4.67 |
| closure_single | npc | 10 | 0.164 | 0 | 0.20 |
| closure_single_table | npc | 10 | 0.171 | 0 | 0.20 |
| closure_single_epoch | npc | 10 | 0.243 | 0 | 0.53 |
| closure_single_hookif | npc | 10 | 0.195 | 0 | 0.22 |
| closure_single_hooknoop | npc | 10 | 0.198 | 0 | 0.22 |
| closure_single_out | npc | 10 | 0.181 | 0 | 0.20 |
| closure_single_ctx | npc | 10 | 0.173 | 0 | 0.20 |
| baseline | npc | 100 | 2.385 | 481 | 8.67 |
| closure_single | npc | 100 | 0.160 | 0 | 0.24 |
| closure_single_table | npc | 100 | 0.190 | 0 | 0.24 |
| closure_single_epoch | npc | 100 | 0.230 | 0 | 0.57 |
| closure_single_hookif | npc | 100 | 0.196 | 0 | 0.24 |
| closure_single_hooknoop | npc | 100 | 0.195 | 0 | 0.24 |
| closure_single_out | npc | 100 | 0.185 | 0 | 0.26 |
| closure_single_ctx | npc | 100 | 0.164 | 0 | 0.24 |
| baseline | npc | 1000 | 2.532 | 481 | 8.66 |
| closure_single | npc | 1000 | 0.157 | 0 | 0.27 |
| closure_single_table | npc | 1000 | 0.181 | 0 | 0.27 |
| closure_single_epoch | npc | 1000 | 0.233 | 0 | 0.59 |
| closure_single_hookif | npc | 1000 | 0.177 | 0 | 0.27 |
| closure_single_hooknoop | npc | 1000 | 0.187 | 0 | 0.27 |
| closure_single_out | npc | 1000 | 0.184 | 0 | 0.29 |
| closure_single_ctx | npc | 1000 | 0.155 | 0 | 0.27 |
| baseline | wide | 1 | 5.528 | 224 | 21.64 |
| closure_single | wide | 1 | 0.415 | 0 | 0.09 |
| closure_single_table | wide | 1 | 0.472 | 0 | 0.09 |
| closure_single_epoch | wide | 1 | 0.499 | 0 | 0.47 |
| closure_single_hookif | wide | 1 | 0.449 | 0 | 0.23 |
| closure_single_hooknoop | wide | 1 | 0.491 | 0 | 0.23 |
| closure_single_out | wide | 1 | 0.484 | 0 | 0.09 |
| closure_single_ctx | wide | 1 | 0.436 | 0 | 0.09 |
| baseline | wide | 10 | 5.996 | 224 | 21.42 |
| closure_single | wide | 10 | 0.437 | 0 | 0.16 |
| closure_single_table | wide | 10 | 0.453 | 0 | 0.16 |
| closure_single_epoch | wide | 10 | 0.517 | 0 | 0.65 |
| closure_single_hookif | wide | 10 | 0.695 | 0 | 0.21 |
| closure_single_hooknoop | wide | 10 | 0.730 | 0 | 0.21 |
| closure_single_out | wide | 10 | 0.477 | 0 | 0.16 |
| closure_single_ctx | wide | 10 | 0.428 | 0 | 0.16 |
| baseline | wide | 100 | 6.377 | 224 | 21.46 |
| closure_single | wide | 100 | 0.504 | 0 | 0.18 |
| closure_single_table | wide | 100 | 0.530 | 0 | 0.18 |
| closure_single_epoch | wide | 100 | 0.620 | 0 | 0.72 |
| closure_single_hookif | wide | 100 | 0.757 | 0 | 0.19 |
| closure_single_hooknoop | wide | 100 | 0.785 | 0 | 0.19 |
| closure_single_out | wide | 100 | 0.586 | 0 | 0.18 |
| closure_single_ctx | wide | 100 | 0.483 | 0 | 0.18 |
| baseline | wide | 1000 | 7.512 | 224 | 21.45 |
| closure_single | wide | 1000 | 0.530 | 0 | 0.14 |
| closure_single_table | wide | 1000 | 0.581 | 0 | 0.14 |
| closure_single_epoch | wide | 1000 | 0.684 | 0 | 0.61 |
| closure_single_hookif | wide | 1000 | 0.825 | 0 | 0.14 |
| closure_single_hooknoop | wide | 1000 | 0.812 | 0 | 0.14 |
| closure_single_out | wide | 1000 | 0.595 | 0 | 0.14 |
| closure_single_ctx | wide | 1000 | 0.517 | 0 | 0.14 |
| baseline | deep | 1 | 5.070 | 1120 | 8.47 |
| closure_single | deep | 1 | 0.338 | 0 | 0.08 |
| closure_single_table | deep | 1 | 0.391 | 0 | 0.08 |
| closure_single_epoch | deep | 1 | 0.371 | 0 | 0.28 |
| closure_single_hookif | deep | 1 | 0.343 | 0 | 0.09 |
| closure_single_hooknoop | deep | 1 | 0.324 | 0 | 0.09 |
| closure_single_out | deep | 1 | 0.333 | 0 | 0.08 |
| closure_single_ctx | deep | 1 | 0.361 | 0 | 0.08 |
| baseline | deep | 10 | 5.672 | 1120 | 2.02 |
| closure_single | deep | 10 | 0.219 | 0 | 0.12 |
| closure_single_table | deep | 10 | 0.289 | 0 | 0.12 |
| closure_single_epoch | deep | 10 | 0.240 | 0 | 0.38 |
| closure_single_hookif | deep | 10 | 0.281 | 0 | 0.13 |
| closure_single_hooknoop | deep | 10 | 0.249 | 0 | 0.13 |
| closure_single_out | deep | 10 | 0.258 | 0 | 0.12 |
| closure_single_ctx | deep | 10 | 0.236 | 0 | 0.12 |
| baseline | deep | 100 | 5.654 | 1120 | 4.39 |
| closure_single | deep | 100 | 0.178 | 0 | 0.10 |
| closure_single_table | deep | 100 | 0.231 | 0 | 0.10 |
| closure_single_epoch | deep | 100 | 0.203 | 0 | 0.33 |
| closure_single_hookif | deep | 100 | 0.208 | 0 | 0.10 |
| closure_single_hooknoop | deep | 100 | 0.186 | 0 | 0.10 |
| closure_single_out | deep | 100 | 0.206 | 0 | 0.10 |
| closure_single_ctx | deep | 100 | 0.223 | 0 | 0.10 |
| baseline | deep | 1000 | 6.061 | 1120 | 4.38 |
| closure_single | deep | 1000 | 0.195 | 0 | 0.08 |
| closure_single_table | deep | 1000 | 0.243 | 0 | 0.08 |
| closure_single_epoch | deep | 1000 | 0.257 | 0 | 0.28 |
| closure_single_hookif | deep | 1000 | 0.185 | 0 | 0.08 |
| closure_single_hooknoop | deep | 1000 | 0.185 | 0 | 0.08 |
| closure_single_out | deep | 1000 | 0.202 | 0 | 0.08 |
| closure_single_ctx | deep | 1000 | 0.166 | 0 | 0.08 |
| baseline | reactive | 1 | 1.885 | 352 | 4.36 |
| closure_single | reactive | 1 | 0.215 | 0 | 0.08 |
| closure_single_table | reactive | 1 | 0.244 | 0 | 0.08 |
| closure_single_epoch | reactive | 1 | 0.310 | 0 | 0.27 |
| closure_single_hookif | reactive | 1 | 0.225 | 0 | 0.09 |
| closure_single_hooknoop | reactive | 1 | 0.270 | 0 | 0.09 |
| closure_single_out | reactive | 1 | 0.249 | 0 | 0.08 |
| closure_single_ctx | reactive | 1 | 0.227 | 0 | 0.08 |
| baseline | reactive | 10 | 2.096 | 294 | 0.80 |
| closure_single | reactive | 10 | 0.109 | 0 | 0.10 |
| closure_single_table | reactive | 10 | 0.119 | 0 | 0.10 |
| closure_single_epoch | reactive | 10 | 0.181 | 0 | 0.30 |
| closure_single_hookif | reactive | 10 | 0.196 | 0 | 0.10 |
| closure_single_hooknoop | reactive | 10 | 0.223 | 0 | 0.10 |
| closure_single_out | reactive | 10 | 0.101 | 0 | 0.10 |
| closure_single_ctx | reactive | 10 | 0.107 | 0 | 0.10 |
| baseline | reactive | 100 | 2.010 | 289 | 4.31 |
| closure_single | reactive | 100 | 0.083 | 0 | 0.10 |
| closure_single_table | reactive | 100 | 0.099 | 0 | 0.10 |
| closure_single_epoch | reactive | 100 | 0.153 | 0 | 0.29 |
| closure_single_hookif | reactive | 100 | 0.165 | 0 | 0.10 |
| closure_single_hooknoop | reactive | 100 | 0.203 | 0 | 0.10 |
| closure_single_out | reactive | 100 | 0.090 | 0 | 0.10 |
| closure_single_ctx | reactive | 100 | 0.075 | 0 | 0.10 |
| baseline | reactive | 1000 | 2.076 | 288 | 4.30 |
| closure_single | reactive | 1000 | 0.071 | 0 | 0.08 |
| closure_single_table | reactive | 1000 | 0.099 | 0 | 0.08 |
| closure_single_epoch | reactive | 1000 | 0.128 | 0 | 0.26 |
| closure_single_hookif | reactive | 1000 | 0.134 | 0 | 0.08 |
| closure_single_hooknoop | reactive | 1000 | 0.144 | 0 | 0.08 |
| closure_single_out | reactive | 1000 | 0.083 | 0 | 0.08 |
| closure_single_ctx | reactive | 1000 | 0.070 | 0 | 0.08 |

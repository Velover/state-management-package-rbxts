# Luau micro-benchmarks for the behaviour-tree rework

Source: `luau-bench/micro/*.luau`. Reproduce with `lune run luau-bench/micro/run_all.luau`
(optionally naming topics: `a_indexing b_calls c_hooks d_alloc e_batch f_misc`).
`lune run luau-bench/micro/sanity.luau` validates the harness itself.

## TL;DR

1. **Lune is not "the interpreter".** Lune 0.10.5 embeds Luau's X64 native code generator and
   applies it to the main script *and to everything it `require`s*. Every number the
   `luau-bench/harness` runner has produced so far is a **native-codegen** number, not an
   interpreter number. This inverts the premise in `SPEC.md`: it is Roblox *without* `--!native`
   that we have no data for by default. Every table below therefore has two columns, measured from
   one source string via `luau.load(src, { codegenEnabled = false / true })`.
2. Under codegen a **call costs ~7 ns and an array-part table read costs ~0.9 ns**: an 8:1 ratio.
   Interpreted it is 23 ns vs 9.3 ns: 2.5:1. Cutting call count is worth far more natively than
   interpreted, and the rework should be optimised for the native ratio.
3. **The largest single lever is not the tree shape at all - it is whether per-agent SoM maps land
   in a table's array part.** `field[agent]` with sparse ids (1000, 2000, ...) costs 10-20 ns per
   access versus 0.9 ns dense: 11-22x. Over 20 nodes that is ~380 ns per agent-tick, more than
   everything batching can win.
4. **Metatable `__index` chains deeper than one level fall off a cliff** (43 ns for 2 levels,
   52 ns for 3, versus 7.4 ns for a closure or `handlers[kind](...)`) and native codegen barely
   helps them (1.2x). The current Leaf -> Decorator/Composite -> Node chain is the most expensive
   dispatch shape measured.
5. **An absent optional hook is free if it is a nil local/upvalue and expensive if you probe the
   node table for it.** `if fn then fn(a) end` with `fn == nil` is 0.44 ns, the floor. Reading a
   *missing* string key is 6.7-7.4 ns natively - 15x the 0.44 ns of a *present* key, because the
   `GETTABLEKS` inline cache only caches hits. Five absent-hook probes per node per tick = 46 ns.
6. **Node-major batching pays from ~10 agents** and reaches the fully-inlined ceiling: 3.7 ns
   versus 11.0 ns per (node, agent) at 1000 agents. At 1 agent it loses (12.7 vs 10.9 native,
   94 vs 66 interpreted), so "always batch" costs ~17% natively / ~40% interpreted at one agent.

## Environment

| | |
|---|---|
| runtime | Lune 0.10.5 (`Lune 0.10.5+709`), Windows 11 x64 |
| Luau compiler | `optimizationLevel = 2` |
| codegen | Luau X64 `CodeGen` is linked into `lune.exe` and is on by default for `lune run` and for `require` |

Environment probe, `s = s + math.sqrt(i) * 1.5` in a loop, ns per iteration:

| where the code came from | ns/iter |
|---|---:|
| this module, loaded by Lune's `require` | 2.19 |
| `luau.load(src, { codegenEnabled = false })` | 21.11 |
| `luau.load(src, { codegenEnabled = true })` | 2.06 |

A `math.sqrt` plus a multiply and an add costing the same as an empty loop is only possible with
native code. `require`d module code matches `codegenEnabled = true` exactly, and the harness
self-check (`micro/sanity.luau`) confirms that a hand-written function in a `require`d module and
the generated `codegenEnabled = true` function agree to 0.01 ns/op on the same op. Independently,
`lune.exe` contains 416 `Luau::CodeGen::X64::...` symbols (IR lowering, assembler, unwind info), so
the generator is compiled in, not just referenced.

Read the columns as:

* **interp** - plain Luau VM. This is a normal Roblox script, and also a `--!native` script's
  behaviour for any function codegen declines to compile.
* **native** - Luau codegen. The closest available analogue of Roblox `--!native`, and what the
  `luau-bench/harness` runner has been measuring all along.

## Method

* ns/op = (min of 7 reps) minus (min of 7 reps of the *identical* function with an empty loop
  body), divided by the op count. Both compilations come from the same generated source string, so
  the two columns can never differ by a source-level accident.
* Loop bodies are unrolled 8x, because a bare `for` back-edge costs ~1.9 ns native / ~5 ns interp
  here and would swamp a 0.4 ns op. ns/op at unroll 1 / 2 / 4 / 8 agree for the interpreter
  (9.9 / 9.9 / 9.3 / 9.1 for an array read); the native column needs unroll >= 4 before the loop
  stops hiding the op.
* Indices, kinds and flags are always loaded out of a data table at run time, never written as
  literals, so the compiler cannot fold them into constant-index opcodes.
* Every name a careful implementer would cache is a real local; the cases that ask about upvalues
  put the loop inside a nested closure so the name really is an upvalue.
* Reps are interleaved across the cases of a suite so a load spike cannot land on one case only.
* At least 2.09 M ops per measurement (1.3 M for the coarse-grained (e) and (f1) suites).
* Allocation = sum of positive `collectgarbage("count")` deltas, one sample per op, with a 32 MB
  `buffer` pad live so GC sweeps are rare. Validated: 48 B per `{}`, 112 B per 2-field table.
* **Noise.** Five other benchmark processes ran on this machine throughout. Two independent full
  runs agree to a 2.3% median / 7.4% p90 deviation over 318 measurements; the worst outliers are
  the 4-6 ns native batching rows (+/-26%). Treat native numbers below ~1 ns as "free" rather than
  exact.

## (a) Indexing

### (a1) Reads

`t`/`som`/`flat`/`buf`/`selfy` are cached locals; the index is a runtime local (never a
constant, so the compiler cannot use the constant-index opcode) and rotates over 8 spread
slots. `N = 64`.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `s = s + t[k]` — 1 lookup, dense int key (array part) | 9.33 | 0.91 | 10.2 |
| `s = s + som[a][k]` — SoM, 2 lookups, outer key fixed | 17.65 | 1.53 | 11.5 |
| `s = s + som[a][b]` — SoM, 2 lookups, outer key rotates (node-major walk) | 17.07 | 1.98 | 8.6 |
| `s = s + flat[a * N + k]` — flat, index computed | 19.25 | 1.14 | 16.9 |
| `s = s + flat[k]` — flat, index already in a local | 9.27 | 0.90 | 10.3 |
| `s = s + buffer.readu8(buf, o)` | 12.78 | 0.44 | 28.8 |
| `s = s + buffer.readf32(buf, o)` | 10.22 | 0.48 | 21.5 |
| `s = s + up[k]` — table is an UPVALUE of the loop function | 13.97 | 1.54 | 9.1 |
| `s = s + loc[k]` — same shape, table is a LOCAL (upvalue control) | 9.33 | 0.89 | 10.5 |
| `s = s + self.field[k]` — string field then int key (2 lookups) | 16.66 | 1.65 | 10.1 |
| `s = s + self.f` — string key only (GETTABLEKS, inline-cached) | 8.82 | 1.22 | 7.2 |
| `s = s + sp[q]` — sparse int ids 1000,2000,... (hash part, 8 HOT keys — see (f1) for a cold 1000-id walk) | 17.42 | 9.82 | 1.8 |
| `s = s + ok[obj]` — table object as key (hash part) | 18.68 | 11.91 | 1.6 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.91 | 2.01 | |

### (a2) Writes

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `t[k] = i` — dense int key (array part) | 5.97 | 0.74 | 8.1 |
| `som[a][k] = i` — SoM, 2 lookups | 11.47 | 1.51 | 7.6 |
| `flat[a * N + k] = i` — flat, index computed | 14.43 | 0.89 | 16.3 |
| `buffer.writeu8(buf, o, 1)` | 15.05 | 0.21 | 70.3 |
| `buffer.writef32(buf, o, 1.5)` | 12.30 | 0.28 | 43.7 |
| `up[k] = i` — table is an UPVALUE | 10.53 | 1.44 | 7.3 |
| `loc[k] = i` — same shape, LOCAL (upvalue control) | 6.14 | 0.74 | 8.3 |
| `self.field[k] = i` | 11.46 | 1.60 | 7.2 |
| `self.f = i` — string key (SETTABLEKS) | 6.43 | 0.80 | 8.0 |
| `sp[q] = i` — sparse int ids (hash part) | 15.37 | 11.40 | 1.3 |
| `ok[obj] = i` — table object as key (hash part) | 16.40 | 12.96 | 1.3 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.35 | 2.01 | |

### (a3) Clearing a key and putting it back (per pair of statements)

Cost of `t[k] = nil` followed later by `t[k] = v`, which is what per-agent state does on
`remove_agent` / `add_agent`. Compared against two plain stores so the extra cost of the
nil store is visible.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| array part: `t[k] = 1; t[k] = 2` (control, 2 stores) | 19.19 | 0.85 | 22.5 |
| array part: `t[k] = nil; t[k] = 2` | 19.59 | 4.97 | 3.9 |
| hash part: `t[q] = 1; t[q] = 2` (control, 2 stores) | 46.29 | 23.28 | 2.0 |
| hash part: `t[q] = nil; t[q] = 2` | 45.97 | 24.12 | 1.9 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.09 | 2.02 | |

**Reading (a).**

* An array-part read is 0.91 ns native / 9.3 ns interp; a **second** lookup (SoM `som[a][k]`, or
  `self.field[k]`) adds only ~0.6 ns native / ~8 ns interp. Struct-of-Maps costs one extra cheap
  indirection, not a doubling.
* **Sparse integer ids are the expensive thing, not the two-level shape.** A hash-part read is
  9.8 ns native even with only 8 hot keys, and (f1) shows 19.9 ns/element when walking 1000 sparse
  ids. That is 11x-22x an array-part read, against a 1.7x penalty for the extra SoM level. Writes:
  11.4 ns (hash) vs 0.74 ns (array), 15x.
* Table objects as keys are worse still (11.9 ns read / 13.0 ns write) - a `state[node][agent]`
  layout keyed by the *node table* pays this on the outer lookup. Key by a node **index**.
* Flat `t[a * N + b]` is the *slowest* read in the interpreter (19.3 ns - the multiply and add cost
  ~10 ns) and the *fastest* table read natively (1.14 ns, beating SoM's 1.53 ns). This ordering
  flips with `--!native`.
* `buffer` is not a win interpreted (`readu8` 12.8 ns is worse than an array read's 9.3 ns) and is
  a large win natively (`readu8` 0.44 ns, `writeu8` 0.21 ns - half and a third of the table
  equivalents). Another ordering that flips.
* Reading through an **upvalue** table costs +0.65 ns native / +4.6 ns interp versus a local. A
  closure-per-node design pays this once per access: small natively, noticeable interpreted.
* Clearing a key: on the array part `t[k] = nil` costs ~4.1 ns more than a plain store natively (it
  invalidates the length boundary); on the hash part it is free. Neither matters - this happens on
  `remove_agent`, not per tick. Re-inserting a previously nil-ed key is **not** a rehash: the node
  keeps its key, so the SPEC's id reuse is cheap.

## (b) Calls and dispatch

### (b0) The callee's own body changes the cost of the call

Identical call site `s = s + f(1)`; only the one-expression body of `f` differs. Reproducible
to <3% over independent chunks, so it is not code alignment. Returning a literal or a computed
value costs ~3.9 ns more under codegen than returning a parameter or an upvalue.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `function(a) return a end` (returns a parameter) | 24.12 | 7.28 | 3.3 |
| `function(a) return SUCCESS end` (SUCCESS is an upvalue) | 28.94 | 6.93 | 4.2 |
| `function(a) return 1 end` (returns a literal) | 26.97 | 11.14 | 2.4 |
| `function(a) return a + 1 end` | 29.64 | 10.92 | 2.7 |
| `function(a) return a, a end` (2 results, 1 used) | 32.54 | 8.75 | 3.7 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.99 | 1.92 | |

### (b1) Call shapes (every callee is the same `function(a) return a end`)

`s = s + 1` (no call at all) is the floor.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `s = s + 1` — no call (floor) | 5.46 | 0.42 | 12.9 |
| `f(1)` — local closure | 23.07 | 7.04 | 3.3 |
| `f(1)` — closure is an UPVALUE of the caller | 23.23 | 7.26 | 3.2 |
| `node.tick(1)` — field lookup then call | 24.85 | 7.53 | 3.3 |
| `node:tick(1)` — namecall, function stored on the table itself (no metatable) | 23.83 | 7.41 | 3.2 |
| `obj:tick(1)` — 1-level `__index` metatable | 30.46 | 12.12 | 2.5 |
| `obj:tick(1)` — 2-level `__index` chain | 50.24 | 43.04 | 1.2 |
| `obj:tick(1)` — 3-level `__index` chain | 59.02 | 51.89 | 1.1 |
| `handlers[kind](1)` — 8-entry table, kind fixed | 24.26 | 7.38 | 3.3 |
| `handlers[kind](1)` — 8-entry table, kind rotates over all 8 | 23.95 | 7.41 | 3.2 |
| `fns[id](1)` — 512-entry table, ids spread | 25.04 | 7.46 | 3.4 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.96 | 1.91 | |

### (b2) Inline if/elseif chain on an integer kind (no call at all)

Branch bodies are `s = s + <n>`; the kind is a runtime local, never a constant. "fixed" means
the same branch every iteration (perfectly predicted); "rotating" cycles through all branches,
which is what a real node-kind switch sees.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| 3 branches, 1st matches | 12.93 | 1.77 | 7.3 |
| 3 branches, 2nd (middle) matches | 17.62 | 1.74 | 10.1 |
| 3 branches, 3rd (last) matches | 22.67 | 1.75 | 12.9 |
| 8 branches, 1st matches | 13.14 | 1.74 | 7.6 |
| 8 branches, 4th (middle) matches | 28.33 | 1.83 | 15.5 |
| 8 branches, 8th (last) matches | 58.80 | 3.30 | 17.8 |
| 16 branches, 1st matches | 13.56 | 1.71 | 7.9 |
| 16 branches, 8th (middle) matches | 58.88 | 3.19 | 18.4 |
| 16 branches, 16th (last) matches | 100.01 | 6.53 | 15.3 |
| 8 branches, kind rotates over all 8 (unpredictable) | 28.70 | 1.82 | 15.8 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.07 | 1.91 | |

### (b3) Arity, and returning a status vs writing it

Arity rows use an empty callee (`function(a, b) end`) and the call site `f(...) s = s + 1`,
so only the argument count varies.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `f()` — 0 args | 19.66 | 5.92 | 3.3 |
| `f(1)` — 1 arg | 22.67 | 6.14 | 3.7 |
| `f(1,2)` — 2 args | 25.73 | 6.72 | 3.8 |
| `f(1,2,3,4,5)` — 5 args | 35.26 | 7.18 | 4.9 |
| `s = s + f(agent)` — leaf RETURNS the status (upvalue constant) | 28.33 | 6.47 | 4.4 |
| `f(agent)` — leaf WRITES `status[agent]` (upvalue table), returns nothing | 37.86 | 7.53 | 5.0 |
| `status[agent] = f(agent)` — leaf returns, caller stores it | 33.46 | 7.25 | 4.6 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.79 | 1.93 | |

### (b4) Recursion / nesting depth (cost of one top-level call)

`dN(x)` calls `dN-1(x)`; `d0(x)` returns `x`. This is the floor for per-agent recursive tree
descent, before any node body runs.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `d0(1)` — 1 call (depth 0) | 22.60 | 7.21 | 3.1 |
| `d1(1)` — 2 nested calls | 42.29 | 14.94 | 2.8 |
| `d4(1)` — 5 nested calls (depth 4) | 105.17 | 38.56 | 2.7 |
| `d12(1)` — 13 nested calls (depth 12) | 292.23 | 102.99 | 2.8 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.98 | 1.92 | |

**Reading (b).**

* (b0) is a measurement hazard worth knowing about: with an identical call site, a callee whose
  body is `return 1` costs **3.9 ns more** natively than one whose body is `return a` or
  `return SUCCESS` (an upvalue). It reproduces to <3% across six independently compiled chunks, so
  it is not code alignment. Practical consequence for leaves: hold the status codes as
  upvalues/locals (`local SUCCESS = Status.SUCCESS`) rather than returning bare numeric literals -
  6.9 ns vs 11.1 ns per hook call is a 60% difference on the cheapest thing a leaf can do.
* **All the reasonable dispatch shapes cost the same**: local closure 7.0, upvalue closure 7.3,
  `node.tick(...)` 7.5, `node:tick(...)` with the function stored on the node itself 7.4,
  `handlers[kind](...)` 7.4, `fns[id](...)` on a 512-entry table 7.5. Neither the size of the
  dispatch table nor the predictability of the index matters. **Pick whichever is nicest to write.**
* **Metatable chains are the exception.** 1 level 12.1 ns, 2 levels 43.0 ns, 3 levels 51.9 ns.
  Codegen gives the 2- and 3-level chains almost nothing (1.2x, versus 3.3x for a plain call), so
  the deeper the chain the worse it looks natively. The baseline's Leaf -> Decorator/Composite ->
  Node chain is 2 levels: **43 ns per node per tick just to find the method**, ~6x a direct call
  and ~47 array reads.
* An inline `if/elseif` on an integer kind is ~4x cheaper than any call natively (1.74 ns for the
  first branch, 3.3 ns at the 8th of 8, 6.5 ns at the 16th of 16) and it does not care whether the
  branch is predictable (rotating over all 8 kinds: 1.82 ns). Interpreted, it is only cheap if the
  hot kinds come first: the 16th of 16 costs 100 ns, 4x a table dispatch.
* Arity is nearly free natively (0 args 5.9 -> 5 args 7.2, +0.26 ns per argument) and not
  interpreted (19.7 -> 35.3, +3.1 ns per argument). "Five tick arguments threaded through every
  call" is an interpreter problem; `--!native` mostly dissolves it.
* Returning a status (6.5 ns) is cheaper than writing `status[agent]` inside the callee (7.5 ns) or
  returning-and-storing (7.3 ns). Returning wins; there is no reason to use an out-parameter.
* **Recursion costs ~7.8 ns per level natively and ~22 ns interpreted, before any work.** A
  12-deep descent is 103 ns / 292 ns per agent per tick of pure call overhead.

## (c) Optional hooks

### (c1) Guarding a hook that lives in a local/upvalue

`fn` is a cached local holding either the hook or `nil`; `agent` is a local. The floor row is
the same loop with the hook call removed entirely.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `s = s + 1` — no hook site at all (floor) | 5.49 | 0.43 | 12.8 |
| `if fn then fn(agent) end` — fn is **nil** | 5.62 | 0.44 | 12.8 |
| `if fn then fn(agent) end` — fn is **present** | 27.13 | 6.73 | 4.0 |
| `if fn ~= nil then fn(agent) end` — fn is **nil** | 5.50 | 0.41 | 13.4 |
| `noop(agent)` — always call a pre-bound no-op `function(a) end` | 25.34 | 6.29 | 4.0 |
| `if fn then fn(agent) end` — fn is **nil**, fn is an UPVALUE | 5.40 | 0.44 | 12.2 |
| `if fn then fn(agent) end` — fn is **present**, fn is an UPVALUE | 30.18 | 8.24 | 3.7 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.89 | 2.01 | |

### (c2) Reading the hook out of the node table first

`leaf` is a plain table. `leaf_bare` simply has no `on_start` key, so the read returns nil.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `local f = leaf.on_start if f then f(agent) end` — key **absent** | 16.66 | 7.39 | 2.3 |
| `local f = leaf.on_start if f then f(agent) end` — key **present** | 37.12 | 8.62 | 4.3 |
| `if leaf.on_start then leaf.on_start(agent) end` — key **absent** (1 read) | 16.09 | 7.50 | 2.1 |
| `if leaf.on_start then leaf.on_start(agent) end` — key **present** (2 reads) | 37.76 | 8.80 | 4.3 |
| `local f = leaf.on_start` only, no call, key **absent** (the read alone) | 13.91 | 6.73 | 2.1 |
| `local f = leaf.on_start` only, no call, key **present** (the read alone) | 9.94 | 0.44 | 22.6 |
| `local f = leaf.on_start ...` — key absent on a 5-key leaf (realistic node table) | 16.36 | 7.30 | 2.2 |
| `leaf.on_start(agent)` unguarded — key **present** (what you pay with a required hook) | 29.39 | 7.02 | 4.2 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.96 | 2.01 | |

### (c3) Five hooks per node per tick, the baseline's shape

`start` / `tick` / `halt` / `activated` / `inactive`-style: five optional hook sites in a row.
This is the per-node-per-tick cost of the hook protocol alone, with no node work.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| 5 sites, all guarded, all **nil** (`if h1 then h1(a) end` x5) | 5.43 | 0.44 | 12.4 |
| 5 sites, all guarded, all **present** | 110.57 | 38.54 | 2.9 |
| 5 sites, unguarded pre-bound no-ops (`h1(a)` x5) | 95.83 | 35.57 | 2.7 |
| 5 sites read from the node table, all **absent** | 57.21 | 46.21 | 1.2 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.06 | 2.01 | |

**Reading (c).**

* `if fn then fn(agent) end` where `fn` is a **nil local or upvalue** costs **nothing**: 0.44 ns
  native / 5.5 ns interp, identical to the floor row with no hook site at all. Five such sites in a
  row also cost nothing (0.44 ns). A design that resolves hooks into node fields or closure
  upvalues at build time genuinely "does not pay for absent hooks", which is SPEC goal 3.
* Binding a pre-bound no-op instead is strictly worse: it costs a full call (6.3 ns / 25.3 ns).
  Never write `on_start = on_start or NOOP`.
* **Probing the node table for an absent key is the expensive mistake.** `leaf.on_start` when the
  key is present is 0.44 ns (the `GETTABLEKS` inline cache). When the key is **absent** it is
  6.7-7.4 ns - 15x - because the cache only caches hits and a miss re-hashes every time. It does
  not depend on how many other keys the node has (a 5-key node: 7.3 ns). Interpreted the gap is
  only 1.4x (13.9 vs 9.9), so **this is one of the sharpest `--!native` flips in the study.**
* Consequence: five optional hook sites read off the node object each tick cost **46 ns per node
  per tick natively while every hook is absent** - more than a 2-level metatable method call, and
  more than six real calls' worth of work, for nothing. The same five sites as nil locals cost
  0.44 ns.

## (d) Per-tick allocation strategies

### (d1) Building a 20-entry per-tick list (ns per whole list, and per entry)

One op = one tick's worth of work: produce a list of 20 values. Divide by 20 for per-entry cost.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| fresh `{}` + grow: `local t = {} for j=1,20 do t[j]=j end` | 560.35 | 339.15 | 1.7 |
| fresh `table.create(20)` + fill | 318.99 | 112.10 | 2.8 |
| reuse + `table.clear(t)` + fill | 278.17 | 54.33 | 5.1 |
| reuse, count-tracked, never cleared: `n=0 ... t[n+1]=v n+=1` | 339.89 | 54.54 | 6.2 |
| reuse + `table.insert(t, v)` (after clear) | 381.93 | 160.48 | 2.4 |
| reuse + `t[#t+1] = v` (after clear) | 487.31 | 126.63 | 3.8 |
| reuse + `t[n+1] = v; n += 1` (after clear) | 456.18 | 68.75 | 6.6 |
| fresh `{}` used as a SET: `t[node] = true` x 20 (the baseline's per-tick sets) | 776.01 | 383.00 | 2.0 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.99 | 2.02 | |

### (d2) Length vs a tracked count, and `table.clear`

Append idioms are measured in (d1) instead, where the list stays bounded at 20 entries;
an unbounded `t[#t+1]` / `table.insert` loop would measure array growth, not the idiom.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `s = s + #t` — length operator on a 64-entry array | 9.35 | 2.01 | 4.7 |
| `s = s + n` — tracked count in a local | 4.38 | 0.43 | 10.2 |
| `s = s + t.n` — count stored as a field on the table | 8.85 | 0.58 | 15.3 |
| `t[n] = v` — store, index already in a local (same slot) | 5.77 | 0.06 | 90.0 |
| `t[n + 1] = v` — store, one add | 5.59 | 0.06 | 87.6 |
| `table.clear(t)` — 20-entry array | 22.47 | 13.09 | 1.7 |
| `table.clear(t)` — 1000-entry array | 296.59 | 279.20 | 1.1 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.05 | 1.99 | |

### (d3) Bytes allocated (sum of positive `collectgarbage("count")` deltas, one sample per op)

| op | B/op |
|---|---:|
| `{}` — empty table | 48.0 |
| `table.create(20)` | 368.0 |
| `{ time_left = 0, cursor = 1 }` — a 2-field per-agent state table | 112.0 |
| fresh `{}` + fill 20 entries (grow) | 560.0 |
| fresh `table.create(20)` + fill 20 entries | 362.0 |
| fresh `{}` set of 20 table keys (`t[node] = true`) | 1072.0 |
| reuse + `table.clear` + fill 20 | 0.0 |
| reuse, count-tracked, never cleared, 20 writes | 0.0 |
| reuse + `table.clear` + `table.insert` x 20 | 0.0 |
| `function() return upc end` — 1 upvalue, SAME value every time (closure cache hits) | 0.0 |
| `function() return x end` — 1 FRESH upvalue each time (cache miss) | 48.0 |
| `function() return a + b + c end` — 3 FRESH upvalues each time | 80.0 |
| closure + its own 1-field state table (a per-(node,agent) closure design) | 128.0 |
| `setmetatable({}, MT)` — one class instance | 48.0 |
| `setmetatable({ a = 1, b = 2, c = 3 }, MT)` — instance with 3 fields | 175.2 |
| one new key in an existing SoM map (`m[id] = 0`, hash part, amortised) | 52.0 |
| one new key in an existing dense array (`m[id] = 0`, array part, amortised) | 26.0 |
| `buffer.create(4096)` | 4031.1 |
| nothing (control) | 0.0 |

**Reading (d).**

* The baseline's per-tick sets are the worst line in the table: a fresh 20-key set costs **383 ns
  and 1072 B**; two of them per tick is ~770 ns and ~2 KB of steady-state garbage per agent-tick.
* Reuse is the whole story: `table.clear` + refill and count-tracked-never-cleared are both
  **54 ns and 0 B** - a 6-7x speedup with all the garbage gone. Of the two, prefer the
  **count-tracked array**: `table.clear` is O(capacity), 13 ns for a 20-slot table but **283 ns for
  a 1000-slot table**, so clearing an agent-sized list every tick reintroduces the cost you just
  removed.
* Append idioms, derived from (d1) as cost per element over the `t[j] = j` baseline:
  `t[n + 1] = v; n += 1` +0.7 ns, `t[#t + 1] = v` +3.6 ns, `table.insert(t, v)` +5.3 ns.
  `table.insert` costs about as much as a whole function call, because it is one.
* `#t` is 2.0 ns vs 0.43 ns for a tracked count in a local and 0.58 ns for a count field on the
  table. Track the count.
* `table.create(n)` + fill is 3x faster and 34% smaller than `{}` + grow (112 ns / 368 B vs
  339 ns / 560 B) when a fresh table is unavoidable.
* **Closures are cheap to allocate but not free.** Luau caches the closure produced by a
  `NEWCLOSURE` site when its upvalues are unchanged, so a closure over unchanging state allocates
  **0 B**; one over per-agent state allocates 48 B (1 upvalue), 80 B (3 upvalues), or 128 B with
  its own state table. A per-*node* closure set is effectively free; a per-(node, agent) closure at
  1000 agents x 20 nodes is 1-2.5 MB and defeats the point of the rework.
* Growing a SoM map costs **26 B per id in the array part and 52 B per id in the hash part** -
  sparse ids double the memory as well as costing 11x the access time.

## (e) Batch vs per-agent structure (20 nodes)

### (e) 1 agent x 20 nodes, dense ids 1..N — ns per (node, agent)

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| (i) agent-major, `f(node, agent)` — tiny fn, no state | 36.71 | 8.61 | 4.3 |
| (ii) node-major, `f(node, agent)` — tiny fn, no state | 65.10 | 10.96 | 5.9 |
| (iii) node-major batched, `g(node, agents, n)` — tiny fn, no state | 69.40 | 10.56 | 6.6 |
| (i-s) agent-major, `f` reads+writes `node.s[agent]` | 66.47 | 10.89 | 6.1 |
| (ii-s) node-major, `f` reads+writes `node.s[agent]` | 87.82 | 13.07 | 6.7 |
| (iii-s) node-major batched, `g` hoists `node.s`, loops agents inside | 94.35 | 12.68 | 7.4 |
| (iv-s) node-major, fully inlined (no call at all) — the ceiling | 61.36 | 8.65 | 7.1 |
| (v-s) agent-major, fully inlined (no call at all) | 35.38 | 5.80 | 6.1 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.83 | 1.92 | |

### (e) 10 agents x 20 nodes, dense ids 1..N — ns per (node, agent)

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| (i) agent-major, `f(node, agent)` — tiny fn, no state | 36.32 | 8.59 | 4.2 |
| (ii) node-major, `f(node, agent)` — tiny fn, no state | 37.95 | 8.18 | 4.6 |
| (iii) node-major batched, `g(node, agents, n)` — tiny fn, no state | 23.07 | 3.64 | 6.3 |
| (i-s) agent-major, `f` reads+writes `node.s[agent]` | 53.50 | 10.79 | 5.0 |
| (ii-s) node-major, `f` reads+writes `node.s[agent]` | 54.82 | 10.29 | 5.3 |
| (iii-s) node-major batched, `g` hoists `node.s`, loops agents inside | 34.12 | 6.19 | 5.5 |
| (iv-s) node-major, fully inlined (no call at all) — the ceiling | 31.21 | 5.46 | 5.7 |
| (v-s) agent-major, fully inlined (no call at all) | 34.38 | 6.96 | 4.9 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 5.08 | 2.00 | |

### (e) 100 agents x 20 nodes, dense ids 1..N — ns per (node, agent)

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| (i) agent-major, `f(node, agent)` — tiny fn, no state | 36.15 | 8.86 | 4.1 |
| (ii) node-major, `f(node, agent)` — tiny fn, no state | 34.09 | 7.96 | 4.3 |
| (iii) node-major batched, `g(node, agents, n)` — tiny fn, no state | 16.65 | 3.04 | 5.5 |
| (i-s) agent-major, `f` reads+writes `node.s[agent]` | 53.62 | 11.37 | 4.7 |
| (ii-s) node-major, `f` reads+writes `node.s[agent]` | 50.75 | 9.86 | 5.1 |
| (iii-s) node-major batched, `g` hoists `node.s`, loops agents inside | 27.47 | 3.68 | 7.5 |
| (iv-s) node-major, fully inlined (no call at all) — the ceiling | 26.97 | 3.56 | 7.6 |
| (v-s) agent-major, fully inlined (no call at all) | 34.33 | 6.02 | 5.7 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 8.31 | 2.62 | |

### (e) 1000 agents x 20 nodes, dense ids 1..N — ns per (node, agent)

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| (i) agent-major, `f(node, agent)` — tiny fn, no state | 36.18 | 8.51 | 4.3 |
| (ii) node-major, `f(node, agent)` — tiny fn, no state | 33.96 | 7.87 | 4.3 |
| (iii) node-major batched, `g(node, agents, n)` — tiny fn, no state | 15.73 | 2.97 | 5.3 |
| (i-s) agent-major, `f` reads+writes `node.s[agent]` | 53.20 | 11.04 | 4.8 |
| (ii-s) node-major, `f` reads+writes `node.s[agent]` | 50.53 | 9.83 | 5.1 |
| (iii-s) node-major batched, `g` hoists `node.s`, loops agents inside | 26.60 | 3.66 | 7.3 |
| (iv-s) node-major, fully inlined (no call at all) — the ceiling | 26.74 | 3.58 | 7.5 |
| (v-s) agent-major, fully inlined (no call at all) | 34.51 | 6.30 | 5.5 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 44.62 | 10.77 | |

### (e) 1000 agents x 20 nodes, SPARSE ids (1000, 2000, ...) — ns per (node, agent)

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| (i) agent-major, `f(node, agent)` — tiny fn, no state | 35.83 | 8.63 | 4.2 |
| (ii) node-major, `f(node, agent)` — tiny fn, no state | 33.96 | 7.74 | 4.4 |
| (iii) node-major batched, `g(node, agents, n)` — tiny fn, no state | 16.42 | 2.90 | 5.7 |
| (i-s) agent-major, `f` reads+writes `node.s[agent]` | 79.15 | 32.34 | 2.4 |
| (ii-s) node-major, `f` reads+writes `node.s[agent]` | 79.97 | 39.30 | 2.0 |
| (iii-s) node-major batched, `g` hoists `node.s`, loops agents inside | 55.57 | 34.85 | 1.6 |
| (iv-s) node-major, fully inlined (no call at all) — the ceiling | 56.77 | 34.63 | 1.6 |
| (v-s) agent-major, fully inlined (no call at all) | 57.97 | 27.99 | 2.1 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 41.54 | 9.23 | |

**Reading (e).** Per (node, agent), native column, with per-(node, agent) state:

| agents | (i-s) agent-major | (ii-s) node-major | (iii-s) node-major batched | (iv-s) inlined ceiling |
|---:|---:|---:|---:|---:|
| 1 | **10.9** | 13.1 | 12.7 | 8.7 |
| 10 | 10.8 | 10.3 | **6.2** | 5.5 |
| 100 | 11.4 | 9.9 | **3.7** | 3.6 |
| 1000 | 11.0 | 9.8 | **3.7** | 3.6 |
| 1000, sparse ids | 32.3 | 39.3 | 34.9 | 34.6 |

* **The crossover is between 1 and 10 agents.** At 1 agent, per-agent recursion wins by ~17%
  natively (10.9 vs 12.7) and by ~40% interpreted (66 vs 94). From 10 agents batching is already
  ~1.7x better; from 100 agents ~3x better and **indistinguishable from removing the function call
  entirely** (3.7 vs 3.6). Batching recovers the whole call cost.
* Batching wins for two reasons that compound: one call per *node* instead of one per
  (node, agent), and the node's state table hoisted out of the inner loop so the per-agent work is
  a single array-part read-modify-write.
* Node-major traversal *without* batching (shape ii) is worth almost nothing on its own (9.8 vs
  11.0). **The batching, not the traversal order, is what pays.**
* **Sparse ids erase every structural win.** At 1000 agents the best batched shape goes from 3.7 ns
  to 34.9 ns - 3x worse than the *worst* dense shape. Nothing else in this study is worth as much
  as making the SoM key dense.
* Interpreted, the picture is muted: batching still wins from 10 agents (34.1 vs 53.5 with state)
  but the
  ceiling is 27 ns rather than 3.6 ns, so the relative prize for batching is larger natively (3.0x)
  than interpreted (2.0x).

## (f) Other things that move a tick loop

### (f1) Iterating 1000 elements (ns per element)

`arr` is a dense array of 1000 numbers; the maps hold one value per agent id.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `for i = 1, n do s = s + arr[i] end` — numeric for, count in a local | 14.47 | 2.35 | 6.2 |
| `for i = 1, #arr do ... end` — numeric for, `#` in the loop header | 14.68 | 2.26 | 6.5 |
| `for i, v in arr do s = s + v end` — Luau generic for over a table | 8.94 | 1.93 | 4.6 |
| `for i, v in ipairs(arr) do ... end` | 8.84 | 1.97 | 4.5 |
| `for k, v in pairs(arr) do ... end` | 8.60 | 1.98 | 4.3 |
| dense ids: `for i = 1, n do local id = ids[i] s = s + map[id] end` | 20.45 | 3.50 | 5.8 |
| sparse ids: `for i = 1, n do local id = ids[i] s = s + map[id] end` (hash part) | 38.38 | 19.92 | 1.9 |
| sparse ids: `for id, v in map do s = s + v end` (generic for over the hash map) | 9.94 | 5.26 | 1.9 |
| sparse ids: `for id in live do s = s + map[id] end` (membership set + lookup) | 34.64 | 23.58 | 1.5 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 6.31 | 2.31 | |

### (f2) Branching, constants, globals

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `if flag then s = s + 1 else s = s + 2 end` | 9.21 | 1.79 | 5.1 |
| `s = s + (flag and 1 or 2)` | 13.97 | 1.75 | 8.0 |
| `if k == 1 then ... end` — compare against a literal | 8.95 | 1.78 | 5.0 |
| `if k == C then ... end` — C is a LOCAL | 11.55 | 1.79 | 6.4 |
| `if k == C then ... end` — C is an UPVALUE | 17.66 | 1.77 | 10.0 |
| `if st == 2 then` — numeric status compare | 13.40 | 1.80 | 7.5 |
| `if st == "running" then` — string status compare (interned, pointer eq) | 13.10 | 1.78 | 7.4 |
| `if x ~= nil then` — x is a present table value | 10.31 | 1.82 | 5.7 |
| `if x then` — x is a present table value | 7.91 | 1.82 | 4.3 |
| `s = s + max(a, b)` — `math.max` cached in a local (fastcall) | 12.35 | 0.45 | 27.4 |
| `s = s + math.max(a, b)` — through the global table | 11.91 | 0.45 | 26.5 |
| `if a > b then s = s + a else s = s + b end` — inline instead of `max` | 9.59 | 1.83 | 5.2 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.98 | 1.93 | |

### (f3) Threading tick arguments: varargs vs fixed, and multiple returns

The current design threads five tick arguments through every node call.

| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |
|---|---:|---:|---:|
| `f(a)` — 1 fixed arg, forwarded to a 1-arg callee | 41.91 | 14.49 | 2.9 |
| `f(a,b,c,d,e)` — 5 fixed args, forwarded to a 5-arg callee | 70.95 | 15.02 | 4.7 |
| `f(...)` — 5 args through varargs, forwarded with `...` | 61.11 | 24.03 | 2.5 |
| `f(ctx)` — 5 values packed into one long-lived context table, `ctx.dt` read inside | 49.17 | 14.57 | 3.4 |
| `local st = f(a)` — 1 return value | 23.06 | 7.18 | 3.2 |
| `local st, x = f(a)` — 2 return values | 31.71 | 8.59 | 3.7 |
| `local st, x, y = f(a)` — 3 return values | 37.60 | 8.53 | 4.4 |
| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | 4.76 | 1.91 | |

**Reading (f).**

* **Generic-for beats numeric-for + index** for walking children or agents: `for i, v in arr`
  1.93 ns vs `for i = 1, n do ... arr[i]` 2.35 ns natively, and 8.9 vs 14.5 ns interpreted.
  `ipairs` and `pairs` measure the same as the bare generic-for (Luau specialises all three). Free
  performance, especially in the interpreter.
* **How you enumerate live agents matters more than anything else in this suite.** Per agent:
  dense ids through an index array + `map[id]`, 3.5 ns; **sparse ids the same way, 19.9 ns**;
  sparse ids by iterating the map directly (`for id, v in map`), 5.3 ns; a membership set plus a
  separate map lookup (`for id in live do ... map[id]`), 23.6 ns - the worst option, and the shape
  a `live[id] = true` set invites.
* Branch forms are all the same natively (~1.8 ns): `and/or` vs `if/else`, comparing against a
  literal vs a local vs an upvalue, number status vs interned-string status. Interpreted they are
  not: comparing against a literal is 9.0 ns, a local 11.6 ns, an **upvalue 17.7 ns**, and `and/or`
  (14.0) is worse than `if/else` (9.2). Numeric and interned-string status codes cost the same in
  both modes, so `SUCCESS = 0` is about table indexing and clarity, not speed.
* `math.max(a, b)` costs the same through the global table as through a cached local (0.45 ns) -
  Luau's import/fastcall optimisation makes localising `math.*` pointless for speed - and natively
  it is **4x cheaper than the equivalent `if a > b then`** (0.45 vs 1.83) because it lowers to a
  branchless instruction.
* **Threading five tick arguments**: five fixed args forwarded through one level cost 15.0 ns
  native / 71.0 ns interp; the same five values packed in one long-lived context table cost
  14.6 / 49.2; varargs forwarding costs 24.0 / 61.1. Natively, fixed args and a context table tie
  and varargs is 60% worse; interpreted, the context table wins clearly and varargs beats fixed
  args. Another ordering that flips.
* Extra return values cost ~1.4 ns each natively and ~8 ns each interpreted. Returning `status`
  alone rather than `status, something` is worth having.

---

## What this means for the BT design

### 1. Agent ids: map them to dense slots once. This is the biggest single lever.

`SPEC.md` goal 5 says ids are chosen by the caller, may be reused, and must not be assumed dense.
The measurements say the *storage* must nevertheless be dense:

| per access | dense (array part) | sparse (hash part) | ratio |
|---|---:|---:|---:|
| SoM read `field[agent]`, native | 0.91 ns | 9.8 ns hot / 19.9 ns over 1000 ids | 11-22x |
| SoM write `field[agent]`, native | 0.74 ns | 11.4 ns | 15x |
| bytes per new id | 26 B | 52 B | 2x |

A tree with 20 nodes touching one map each pays roughly `20 x (19.9 - 0.9) = 380 ns` per agent-tick
purely for sparse keys. That is larger than everything batching can win (~150 ns) and larger than
the whole per-node dispatch bill.

The fix is cheap: keep one `slot_of[agent_id]` hash map in the world, resolved **once per agent per
tick** (or once at `add_agent` if the tick loop iterates slots), and key every per-node SoM map by
the dense slot. One hash lookup per agent-tick (~20 ns) replaces 20 of them. Removal pushes the
slot onto a free list; `t[slot] = nil` then re-set is not a rehash (a3), so reuse is free. The SoM
*shape* from goal 4 is untouched - `bb.health[slot]`, `time_left[slot]` - only the key changes.

If an implementation refuses to introduce slots, the second-best option is to never look agents up
by id in the inner loop: iterate the map itself (`for slot, v in map`, 5.3 ns) rather than an id
list plus `map[id]` (19.9 ns) or a membership set plus a lookup (23.6 ns).

### 2. Node representation: plain tables in a flat array, handler function stored on the node.

Nothing in (b1) separates a local closure (7.0 ns), an upvalue closure (7.3), `node.tick(...)`
(7.5), `node:tick(...)` with the function on the node (7.4) and `handlers[kind](...)` (7.4). The
one shape that is different is the one the baseline uses:

| dispatch | native | interp |
|---|---:|---:|
| closure / `node.tick(...)` / `handlers[kind](...)` | 7.0-7.5 ns | 23-25 ns |
| method through a 1-level `__index` metatable | 12.1 ns | 30.5 ns |
| method through a **2-level** chain (Leaf -> Composite -> Node) | **43.0 ns** | 50.2 ns |
| method through a 3-level chain | 51.9 ns | 59.0 ns |
| inline `if/elseif` on an integer kind, hot kind first | **1.74 ns** | 13.1 ns |

So: **drop the class hierarchy.** Nodes should be plain tables (or parallel arrays) holding an
integer `kind`, child indices, and the already-resolved hook functions. Either dispatch style is
fine; `handlers[kind]` keeps the node set open with no measurable penalty over a closure, and it
avoids a closure per node if that matters. If the last drop of speed is wanted, inline the 3-4
hottest kinds in the walker's `if/elseif` (1.74-1.8 ns) and fall through to `handlers[kind]` for
the rest - but order the chain by frequency, because in the interpreter the 16th of 16 branches
costs 100 ns.

Closures vs flat arrays, concretely: a closure per *node* capturing its SoM tables costs one
upvalue read per access (+0.65 ns native / +4.6 ns interp) and allocates nothing after build, so it
is a fine implementation of "one handler per node". A closure per *(node, agent)* costs 48-128 B
each - 1-2.5 MB at 1000 agents x 20 nodes - and is exactly what goal 1 forbids.

### 3. Hooks: resolve at build time into `nil`-or-function fields. Never probe the node table.

| per node per tick, 5 optional hook sites | native | interp |
|---|---:|---:|
| 5 nil-guarded locals/upvalues, all absent | **0.44 ns** | 5.4 ns |
| 5 sites read off the node table, all absent | **46.2 ns** | 57.2 ns |
| 5 unguarded pre-bound no-ops | 35.6 ns | 95.8 ns |
| 5 guarded calls, all present | 38.5 ns | 110.6 ns |

`if fn then fn(agent) end` with `fn` nil is literally free. Reading `leaf.on_start` when the key is
absent is not, because Luau's `GETTABLEKS` inline cache only caches hits. So the node build step
must copy `on_start` / `on_tick` / `on_halt` out of the user's leaf spec into fixed slots (node
fields that always exist, closure upvalues, or parallel arrays) so that the per-tick read is either
a cached hit or no read at all. Dropping `OnBecameActivated` / `OnBecameInactive` is right, but the
saving comes from removing the *probes*, not the calls.

Also: leaves should return status constants held as locals/upvalues, not numeric literals - 6.9 ns
vs 11.1 ns per hook call (b0).

### 4. Traversal: per-agent recursion for 1 agent, node-major batching from ~10.

| per (node, agent), native | 1 agent | 10 | 100 | 1000 |
|---|---:|---:|---:|---:|
| per-agent recursion, `f(node, agent)` | **10.9** | 10.8 | 11.4 | 11.0 |
| node-major batched, `g(node, agents, n)` | 12.7 | **6.2** | **3.7** | **3.7** |
| no call at all (ceiling) | 8.7 | 5.5 | 3.6 | 3.6 |

Plus (b4): recursive descent costs ~7.8 ns per level natively / ~22 ns interpreted before any node
body runs, so a 12-deep tree spends 103 ns / 292 ns per agent-tick on stack frames alone.

Batching is worth 3x at scale and reaches the no-call ceiling, and it costs only ~17% at a single
agent, so "always batch" is a defensible choice for a design that must serve 1 and 1000 agents.
The catch is semantic, not numeric: a Sequence cannot tick child 2 for an agent until child 1 has
answered for that agent, so node-major requires per-node "which agents are currently here" lists.
Those lists are cheap if they are count-tracked arrays (0.7 ns per append, 0 B - see (d)), but they
are real bookkeeping and they interact with the halting rule. A reasonable middle path: batch the
leaves and the timer/cooldown decorators (where the per-agent work is a pure SoM update and the
agent list is naturally available) and keep per-agent recursion for the composites.

Do this **after** the dense-slot change: batching buys ~150 ns per agent-tick, dense slots buy
~380 ns.

### 5. Per tick: allocate nothing, and do not use `#t` or `table.insert`.

| per tick, 20 entries | ns native | B |
|---|---:|---:|
| fresh `{}` set, `t[node] = true` x20 (the baseline's `running_nodes` / `active_nodes`) | 383 | 1072 |
| fresh `{}` list + grow | 339 | 560 |
| fresh `table.create(20)` + fill | 112 | 368 |
| reuse + `table.clear` + fill | 54 | **0** |
| reuse, count-tracked, never cleared | **54** | **0** |

Goal 2 ("nothing allocated per tick") is worth ~770 ns and ~2 KB per agent-tick against the current
design. Use count-tracked arrays rather than `table.clear`, because `table.clear` is O(capacity)
(283 ns on a 1000-slot table) and a per-agent-sized scratch list cleared every tick would give back
most of the win. Track lengths in a number; `#t` is 2.0 ns vs 0.43 ns and `table.insert` costs
+5.3 ns per element over a direct indexed store.

Better still, do not keep per-tick lists at all: the "is this (node, agent) running" bit is itself
SoM state (`running[node_index][slot]`), and the halting rule can be enforced by comparing a
per-(node, agent) `last_ticked` tick number against the world tick counter - one array-part read and
one array-part write, ~1.6 ns, instead of building and diffing two sets.

### 6. Tick arguments and status

Five fixed arguments cost +1.3 ns per call natively but +15.6 ns interpreted; a single long-lived
context table costs the same as five fixed args natively and is 30% cheaper interpreted; varargs are
the worst natively. So pass `(node, slot)` plus a world/context table captured as an upvalue, and
put `dt` and the tick counter in that table. Return one status value; extra return values cost
~1.4 ns native / ~8 ns interp each, and returning beats writing `status[agent]` from inside the
callee.

### 7. A rough budget (floors only - no node logic included)

Per agent-tick on a 20-node tree, native column:

| design | per agent-tick | per tick garbage |
|---|---:|---:|
| baseline shape: 2-level metatable dispatch (43) + 5 hook probes (46) + 2 fresh sets | ~1.8 us | ~2.1 KB |
| shared tree, per-agent recursion, handler on the node, dense slots, hooks as fields | ~200 ns | 0 B |
| shared tree, node-major batched, dense slots | ~75 ns | 0 B |

The dominant term moves from "dispatch + hook probing" to "one call per (node, agent)" to "no call
at all", and the sparse/dense key choice is worth as much as any of the structural changes.

---

## What should flip under Roblox `--!native`

Because both columns here are measured, these are observations rather than predictions - but note
the caveat in the next section about Lune's codegen not being identical to Roblox's.

**Orderings that actually reverse:**

| comparison | interp | native | flips? |
|---|---|---|---|
| flat `t[a*N+b]` vs SoM `t[a][b]` (read) | 19.3 vs 17.7 - **SoM wins** | 1.14 vs 1.53 - **flat wins** | yes |
| `buffer.readu8` vs array read | 12.8 vs 9.3 - **table wins** | 0.44 vs 0.91 - **buffer wins** | yes |
| `buffer.writeu8` vs array write | 15.1 vs 6.0 - **table wins** | 0.21 vs 0.74 - **buffer wins** | yes |
| inline `if/elseif`, 16 branches, last match, vs `handlers[kind]()` | 100.0 vs 24.3 - **table wins** | 6.5 vs 7.4 - **inline wins** | yes |
| 5 fixed args vs varargs forwarding | 71.0 vs 61.1 - **varargs wins** | 15.0 vs 24.0 - **fixed wins** | yes |
| `math.max(a,b)` vs inline `if a > b` | 12.4 vs 9.6 - **inline wins** | 0.45 vs 1.83 - **`max` wins** | yes |
| node-major batched vs agent-major at 1 agent | 94 vs 66 - agent-major by 42% | 12.7 vs 10.9 - agent-major by 17% | no, but the penalty shrinks |

**Gaps that widen enormously (same ordering, much bigger stake):**

| comparison | interp gap | native gap |
|---|---:|---:|
| present vs **absent** string key (`leaf.on_start`) | 1.4x | **15x** |
| sparse (hash) vs dense (array) SoM read | 1.9x | **11x** (22x cold) |
| call vs array-part read | 2.5x | **8x** |
| 2-level metatable method vs plain call | 2.2x | **6.1x** |
| a whole call vs an inline `if/elseif` branch | 1.8x | **4x** |

The general rule the numbers support: **codegen speeds up arithmetic (17x), table indexing (10x),
branching (7x) and buffers (29-70x), and barely speeds up calls (3.3x), hash lookups (1.8x),
metamethod chains (1.2x) and `table.*` builtins (1.1-2.4x).** Everything the compiler cannot see
through stays at roughly its interpreted cost while everything around it gets ~10x faster, so under
`--!native` a BT tick becomes almost entirely *call count*, *hash lookups* and *inline-cache misses*.
Optimise for those three and the design is right for both modes, because none of the three is cheap
in the interpreter either.

Two `--!native` specifics not measurable here: Roblox's codegen uses type annotations to remove
checks (so `--!strict` typed node code should do better than these numbers), and it declines to
compile some functions, which then run interpreted - another reason not to let any single node
kind's cost depend on codegen.

---

## Caveats

* **The interpreter column is a Windows/MSVC build of the Luau VM.** Luau's dispatch loop uses
  computed goto on gcc/clang and a `switch` on MSVC, so the absolute interpreter numbers here are
  probably pessimistic by some constant factor versus a Roblox Linux server. Ratios within the
  column, and every ordering claim, are unaffected.
* Native numbers below ~1 ns are at the edge of what this method resolves: with an 8x-unrolled body
  the CPU overlaps independent loads, so `t[k] = v` to the same slot measures 0.06 ns. Treat
  sub-nanosecond figures as "free", not as exact.
* Five other benchmark processes shared the machine. Two full runs agree to a 2.3% median / 7.4%
  p90 deviation across 318 measurements; the 4-6 ns native batching rows are the noisiest (±26%).
* (b0)'s `return 1` vs `return a` effect (+3.9 ns) is reproducible and load-independent but
  unexplained; the likely mechanism is that returning a register that is already an argument slot
  avoids a stack move that `LOADN` forces. It is reported because it is large relative to a call,
  not because the mechanism is confirmed.
* The `luau-bench/harness` runner's own `us/agent-tick` figures are **native** numbers. If the
  project wants interpreter figures for comparison, the cheapest route is to run the same adapters
  through `luau.load(source, { codegenEnabled = false })` rather than `require`.

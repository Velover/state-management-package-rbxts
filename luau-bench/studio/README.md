# Running the bench inside Roblox Studio

The Lune runner (`harness/runner.luau`) measures the design candidates under Lune, which compiles
every required module with Luau **native codegen**. That corresponds to Roblox `--!native`, but it is
not Roblox: a different Luau build, a different allocator, a different GC schedule, and no answer at
all for what the plain interpreter does. This folder runs the *same* harness inside a live Roblox
Studio, in both codegen modes, and writes the numbers next to the Lune ones.

```
bun run luau-bench/studio/studio_runner.ts
```

Reports land in `luau-bench/results/`: `studio_native.md`, `studio_interp.md`, `studio_vs_lune.md`.

## Prerequisites

- **Roblox Studio open** on any place, in Edit mode. The bench never enters play mode and never saves.
- **MCP enabled in Studio**: Assistant → settings → MCP. Without it `list_roblox_studios` returns an
  empty list and the runner says so after retrying for 30 s.
- `bun` on PATH. The runner spawns `StudioMCP.exe` itself (falling back to `%LOCALAPPDATA%\Roblox\mcp.bat`);
  nothing else needs to be running.

Nothing in the project's `package.json` is touched, so always invoke the script by path.

## Flags

| flag | meaning | default |
|---|---|---|
| `--mode=native\|interp\|both` | which codegen mode(s) to run | `both` |
| `--cases=a,b,c` | cases to run, comma separated | the seven from `results/SUMMARY.md` |
| `--scenario=npc\|wide\|deep\|reactive` | only this scenario | all four |
| `--agents=1,10,100,1000` | agent counts | `1,10,100,1000` |
| `--quick` | fewer ticks / reps (15k agent-ticks per rep, 2 reps) | full (60k, 3 reps) |
| `--no-check` / `--no-bench` | skip the differential test / the benchmark | both run |
| `--studio=<name substring>` | choose a Studio instance by name | the first one |
| `--pick` | choose interactively when several match | off |
| `--out=<dir>` | where the reports go | `luau-bench/results` |

A full both-mode run takes about a minute; `--quick` a few seconds.

## What the driver does

`bundle.ts` turns the harness, the baseline and the selected cases into **one self-contained Luau
chunk** per slice:

- every module becomes `MODULES["harness/status"] = function(require) ... end`, and `require` becomes a
  shim that resolves `./x` and `../dir/x` against the requiring module's own path, loading lazily with
  a cache. `require("../cases/" .. name)` keeps working because the shim resolves at run time;
- each module's `--!native` / `--!optimize 2` line is replaced by a comment (so line numbers still match
  the file on disk) and the bundle carries **exactly one header**: `--!optimize 2` always, plus
  `--!native` only in native mode. A run is therefore entirely native or entirely interpreted;
- `require("@lune/process")` resolves to an injected `{ args = { ... } }`, which is how the runner's
  flags get in;
- `print` is shadowed by a chunk-local collector, so the runner's markdown table comes back as data
  instead of vanishing into the Studio console.

The module sources are copied byte for byte. Nothing under `harness/`, `baseline/` or `cases/` is
modified or written to.

`studio_runner.ts` then sends one chunk per slice through the MCP tool `execute_luau`
(`datamodel_type: "Edit"`). Each chunk creates `Workspace.LuauBench`, `task.spawn`s the slice, and
returns at once; the slice appends its output to a `StringValue` under that folder and finishes with a
`#DONE` marker. The runner polls with further `execute_luau` calls until it sees the marker. Because
the result lives in the place rather than in the call, a poll that times out while Studio is busy in
the middle of a slice is simply retried — no MCP timeout can lose a run. Slices are one
(scenario, agent count) group over all cases, which is also how the Lune runner groups its work.

Every instance created is `Archivable = false`, and the folder is destroyed when the run ends.

### Why not ModuleScripts

The obvious way to make Studio honour `--!native` is to put the source in a ModuleScript and `require`
it, since a loose `loadstring`-style chunk might ignore script directives. That is not possible here:
the Assistant thread that `execute_luau` runs on is capability-restricted, and in a place with
sandboxed containers it can neither parent a ModuleScript into any service nor require one at all
("The current thread cannot require 'ModuleScript' since 'ModuleScript' has additional values for the
Capabilities property"). `_G` and `shared` are `nil` on that thread too, which is why state travels
through a StringValue.

It turns out not to matter: **`execute_luau` compiles its chunk with the directives applied.** The
native-codegen canary from SPEC.md (`s = s + math.sqrt(i) * 1.5`, 5e6 iterations) runs at ~1.9 ns/iter
with the `--!native` header and ~7.6 ns/iter without it, in the same Studio, in the same session. Every
report records its canary so a run that silently lost native codegen is obvious.

## The one measurement Studio cannot reproduce

Roblox's `collectgarbage("count")` returns **whole kilobytes**; Lune's returns a precise float. The
harness's `B/agent-tick` is a median of per-tick heap deltas, so in Studio it is quantised to 1024 B.
At 1000 agents a tick allocates hundreds of KB and the column is accurate; at 1 and 10 agents a true
480 B/agent-tick reads as 0 or 1024. The reports carry this caveat inline. Timing (`us/agent-tick`) is
unaffected — `os.clock()` is a normal high-resolution clock in Roblox.

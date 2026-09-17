# Studio bench: native (--!native --!optimize 2)

Roblox Studio 0.739.0.7390687 - Dive In  (placeId: 107977544283224)
Run 2026-09-17 18:08:38Z through the Studio MCP server (`luau-bench/studio/studio_runner.ts`), Edit mode.
Cases: baseline, oop_shared_alias, closure_single, closure_batch, flat_dispatch_pernode, flat_batch, flat_batch_buffer. Full run (60k agent-ticks per rep, 3 reps).
Wall time: 30s.

## Native-codegen canary

`s = s + math.sqrt(i) * 1.5` x 5e6: **1.95 ns/iter**.

## Differential correctness vs the baseline tree (in the Roblox VM)

| case / scenario | result |
|---|---|
| oop_shared_alias / npc | pass (80 ticks, 21 nodes) |
| oop_shared_alias / wide | pass (80 ticks, 49 nodes) |
| oop_shared_alias / deep | pass (80 ticks, 14 nodes) |
| oop_shared_alias / reactive | pass (80 ticks, 10 nodes) |
| closure_single / npc | pass (80 ticks, 21 nodes) |
| closure_single / wide | pass (80 ticks, 49 nodes) |
| closure_single / deep | pass (80 ticks, 14 nodes) |
| closure_single / reactive | pass (80 ticks, 10 nodes) |
| closure_batch / npc | pass (80 ticks, 21 nodes) |
| closure_batch / wide | pass (80 ticks, 49 nodes) |
| closure_batch / deep | pass (80 ticks, 14 nodes) |
| closure_batch / reactive | pass (80 ticks, 10 nodes) |
| flat_dispatch_pernode / npc | pass (80 ticks, 21 nodes) |
| flat_dispatch_pernode / wide | pass (80 ticks, 49 nodes) |
| flat_dispatch_pernode / deep | pass (80 ticks, 14 nodes) |
| flat_dispatch_pernode / reactive | pass (80 ticks, 10 nodes) |
| flat_batch / npc | pass (80 ticks, 21 nodes) |
| flat_batch / wide | pass (80 ticks, 49 nodes) |
| flat_batch / deep | pass (80 ticks, 14 nodes) |
| flat_batch / reactive | pass (80 ticks, 10 nodes) |
| flat_batch_buffer / npc | pass (80 ticks, 21 nodes) |
| flat_batch_buffer / wide | pass (80 ticks, 49 nodes) |
| flat_batch_buffer / deep | pass (80 ticks, 14 nodes) |
| flat_batch_buffer / reactive | pass (80 ticks, 10 nodes) |

## Benchmark

| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |
|---|---|---:|---:|---:|---:|
| baseline | npc | 1 | 1.141 | 0 | 10.00 |
| oop_shared_alias | npc | 1 | 0.168 | 0 | 0.00 |
| closure_single | npc | 1 | 0.100 | 0 | 0.00 |
| closure_batch | npc | 1 | 0.209 | 0 | 1.00 |
| flat_dispatch_pernode | npc | 1 | 0.155 | 0 | 0.00 |
| flat_batch | npc | 1 | 0.285 | 0 | 0.00 |
| flat_batch_buffer | npc | 1 | 0.298 | 0 | 1.00 |
| baseline | npc | 10 | 1.319 | 512 | 8.80 |
| oop_shared_alias | npc | 10 | 0.157 | 0 | 0.80 |
| closure_single | npc | 10 | 0.117 | 0 | 0.20 |
| closure_batch | npc | 10 | 0.165 | 0 | 0.30 |
| flat_dispatch_pernode | npc | 10 | 0.147 | 0 | 0.60 |
| flat_batch | npc | 10 | 0.163 | 0 | 0.30 |
| flat_batch_buffer | npc | 10 | 0.171 | 0 | 0.20 |
| baseline | npc | 100 | 1.480 | 481 | 8.68 |
| oop_shared_alias | npc | 100 | 0.166 | 0 | 0.68 |
| closure_single | npc | 100 | 0.131 | 0 | 0.25 |
| closure_batch | npc | 100 | 0.131 | 0 | 0.30 |
| flat_dispatch_pernode | npc | 100 | 0.152 | 0 | 0.44 |
| flat_batch | npc | 100 | 0.138 | 0 | 0.37 |
| flat_batch_buffer | npc | 100 | 0.120 | 0 | 0.50 |
| baseline | npc | 1000 | 1.732 | 480 | 8.66 |
| oop_shared_alias | npc | 1000 | 0.154 | 0 | 0.56 |
| closure_single | npc | 1000 | 0.128 | 0 | 0.27 |
| closure_batch | npc | 1000 | 0.107 | 0 | 0.35 |
| flat_dispatch_pernode | npc | 1000 | 0.150 | 0 | 0.37 |
| flat_batch | npc | 1000 | 0.117 | 0 | 0.41 |
| flat_batch_buffer | npc | 1000 | 0.102 | 0 | 0.08 |
| baseline | wide | 1 | 3.698 | 0 | 22.00 |
| oop_shared_alias | wide | 1 | 0.443 | 0 | 1.00 |
| closure_single | wide | 1 | 0.240 | 0 | 0.00 |
| closure_batch | wide | 1 | 0.505 | 0 | 1.00 |
| flat_dispatch_pernode | wide | 1 | 0.373 | 0 | 1.00 |
| flat_batch | wide | 1 | 0.687 | 0 | 0.00 |
| flat_batch_buffer | wide | 1 | 0.728 | 0 | 0.00 |
| baseline | wide | 10 | 4.338 | 307 | 21.50 |
| oop_shared_alias | wide | 10 | 0.471 | 0 | 1.70 |
| closure_single | wide | 10 | 0.313 | 0 | 0.20 |
| closure_batch | wide | 10 | 0.406 | 0 | 0.30 |
| flat_dispatch_pernode | wide | 10 | 0.393 | 0 | 1.00 |
| flat_batch | wide | 10 | 0.566 | 0 | 0.60 |
| flat_batch_buffer | wide | 10 | 0.473 | 0 | 0.40 |
| baseline | wide | 100 | 4.779 | 225 | 21.47 |
| oop_shared_alias | wide | 100 | 0.504 | 0 | 1.42 |
| closure_single | wide | 100 | 0.355 | 0 | 0.18 |
| closure_batch | wide | 100 | 0.342 | 0 | 0.28 |
| flat_dispatch_pernode | wide | 100 | 0.412 | 0 | 0.76 |
| flat_batch | wide | 100 | 0.466 | 0 | 0.63 |
| flat_batch_buffer | wide | 100 | 0.311 | 0 | 0.92 |
| baseline | wide | 1000 | 5.128 | 224 | 21.45 |
| oop_shared_alias | wide | 1000 | 0.519 | 0 | 1.14 |
| closure_single | wide | 1000 | 0.411 | 0 | 0.14 |
| closure_batch | wide | 1000 | 0.350 | 0 | 0.22 |
| flat_dispatch_pernode | wide | 1000 | 0.427 | 0 | 0.61 |
| flat_batch | wide | 1000 | 0.421 | 0 | 0.53 |
| flat_batch_buffer | wide | 1000 | 0.309 | 0 | 0.81 |
| baseline | deep | 1 | 3.047 | 1024 | 10.00 |
| oop_shared_alias | deep | 1 | 0.376 | 0 | 0.00 |
| closure_single | deep | 1 | 0.179 | 0 | 0.00 |
| closure_batch | deep | 1 | 0.237 | 0 | 1.00 |
| flat_dispatch_pernode | deep | 1 | 0.297 | 0 | 0.00 |
| flat_batch | deep | 1 | 0.372 | 0 | 0.00 |
| flat_batch_buffer | deep | 1 | 0.394 | 0 | 0.00 |
| baseline | deep | 10 | 3.258 | 1126 | 4.90 |
| oop_shared_alias | deep | 10 | 0.351 | 0 | 0.20 |
| closure_single | deep | 10 | 0.155 | 0 | 0.10 |
| closure_batch | deep | 10 | 0.074 | 0 | 0.20 |
| flat_dispatch_pernode | deep | 10 | 0.276 | 0 | 0.10 |
| flat_batch | deep | 10 | 0.138 | 0 | 0.20 |
| flat_batch_buffer | deep | 10 | 0.145 | 0 | 0.10 |
| baseline | deep | 100 | 3.677 | 1116 | 4.45 |
| oop_shared_alias | deep | 100 | 0.331 | 0 | 0.18 |
| closure_single | deep | 100 | 0.143 | 0 | 0.10 |
| closure_batch | deep | 100 | 0.056 | 0 | 0.16 |
| flat_dispatch_pernode | deep | 100 | 0.257 | 0 | 0.12 |
| flat_batch | deep | 100 | 0.105 | 0 | 0.14 |
| flat_batch_buffer | deep | 100 | 0.103 | 0 | 0.16 |
| baseline | deep | 1000 | 3.703 | 1119 | 4.38 |
| oop_shared_alias | deep | 1000 | 0.326 | 0 | 0.14 |
| closure_single | deep | 1000 | 0.145 | 0 | 0.08 |
| closure_batch | deep | 1000 | 0.053 | 0 | 0.12 |
| flat_dispatch_pernode | deep | 1000 | 0.258 | 0 | 0.10 |
| flat_batch | deep | 1000 | 0.102 | 0 | 0.11 |
| flat_batch_buffer | deep | 1000 | 0.103 | 0 | 0.13 |
| baseline | reactive | 1 | 1.027 | 0 | 0.00 |
| oop_shared_alias | reactive | 1 | 0.180 | 0 | 0.00 |
| closure_single | reactive | 1 | 0.081 | 0 | 0.00 |
| closure_batch | reactive | 1 | 0.129 | 0 | 0.00 |
| flat_dispatch_pernode | reactive | 1 | 0.117 | 0 | 0.00 |
| flat_batch | reactive | 1 | 0.223 | 0 | 0.00 |
| flat_batch_buffer | reactive | 1 | 0.216 | 0 | 0.00 |
| baseline | reactive | 10 | 1.116 | 307 | 4.30 |
| oop_shared_alias | reactive | 10 | 0.174 | 0 | 0.40 |
| closure_single | reactive | 10 | 0.061 | 0 | 0.10 |
| closure_batch | reactive | 10 | 0.062 | 0 | 0.10 |
| flat_dispatch_pernode | reactive | 10 | 0.094 | 0 | 0.20 |
| flat_batch | reactive | 10 | 0.087 | 0 | 0.20 |
| flat_batch_buffer | reactive | 10 | 0.081 | 0 | 0.10 |
| baseline | reactive | 100 | 1.116 | 287 | 4.31 |
| oop_shared_alias | reactive | 100 | 0.163 | 0 | 0.32 |
| closure_single | reactive | 100 | 0.059 | 0 | 0.10 |
| closure_batch | reactive | 100 | 0.044 | 0 | 0.17 |
| flat_dispatch_pernode | reactive | 100 | 0.087 | 0 | 0.22 |
| flat_batch | reactive | 100 | 0.059 | 0 | 0.18 |
| flat_batch_buffer | reactive | 100 | 0.056 | 0 | 0.28 |
| baseline | reactive | 1000 | 1.262 | 288 | 4.30 |
| oop_shared_alias | reactive | 1000 | 0.171 | 0 | 0.26 |
| closure_single | reactive | 1000 | 0.059 | 0 | 0.08 |
| closure_batch | reactive | 1000 | 0.041 | 0 | 0.14 |
| flat_dispatch_pernode | reactive | 1000 | 0.088 | 0 | 0.18 |
| flat_batch | reactive | 1000 | 0.052 | 0 | 0.14 |
| flat_batch_buffer | reactive | 1000 | 0.052 | 0 | 0.24 |

> **Reading `B/agent-tick` in Studio.** Roblox's `collectgarbage("count")` reports whole
> kilobytes, so the harness's per-tick heap delta is quantised to 1024 B (Lune's counter is a
> precise float). At 1000 agents a tick allocates hundreds of KB and the column is accurate to
> well under 1%; at 1 and 10 agents the true per-tick figure is below the quantum, so a real 480 B
> shows up as 0 or 1024. Trust the 1000-agent rows, and read `KB/agent (add + 1st tick)` the same
> way. The zero-garbage claim for the shared-tree designs still holds: they read 0 at every agent
> count, including 1000, where 480 B/agent-tick would have been impossible to miss.

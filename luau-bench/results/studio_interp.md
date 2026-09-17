# Studio bench: interp (--!optimize 2, no --!native)

Roblox Studio 0.739.0.7390687 - Dive In  (placeId: 107977544283224)
Run 2026-09-17 18:08:38Z through the Studio MCP server (`luau-bench/studio/studio_runner.ts`), Edit mode.
Cases: baseline, oop_shared_alias, closure_single, closure_batch, flat_dispatch_pernode, flat_batch, flat_batch_buffer. Full run (60k agent-ticks per rep, 3 reps).
Wall time: 34s.

## Native-codegen canary

`s = s + math.sqrt(i) * 1.5` x 5e6: **7.59 ns/iter**.

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
| baseline | npc | 1 | 1.388 | 0 | 10.00 |
| oop_shared_alias | npc | 1 | 0.279 | 0 | 0.00 |
| closure_single | npc | 1 | 0.234 | 0 | 0.00 |
| closure_batch | npc | 1 | 0.521 | 0 | 0.00 |
| flat_dispatch_pernode | npc | 1 | 0.289 | 0 | 0.00 |
| flat_batch | npc | 1 | 0.601 | 0 | 1.00 |
| flat_batch_buffer | npc | 1 | 0.704 | 0 | 1.00 |
| baseline | npc | 10 | 1.592 | 512 | 8.70 |
| oop_shared_alias | npc | 10 | 0.264 | 0 | 0.80 |
| closure_single | npc | 10 | 0.230 | 0 | 0.20 |
| closure_batch | npc | 10 | 0.322 | 0 | 0.30 |
| flat_dispatch_pernode | npc | 10 | 0.265 | 0 | 0.50 |
| flat_batch | npc | 10 | 0.326 | 0 | 0.30 |
| flat_batch_buffer | npc | 10 | 0.397 | 0 | 0.20 |
| baseline | npc | 100 | 1.976 | 481 | 8.67 |
| oop_shared_alias | npc | 100 | 0.267 | 0 | 0.63 |
| closure_single | npc | 100 | 0.250 | 0 | 0.24 |
| closure_batch | npc | 100 | 0.249 | 0 | 0.29 |
| flat_dispatch_pernode | npc | 100 | 0.265 | 0 | 0.44 |
| flat_batch | npc | 100 | 0.270 | 0 | 0.35 |
| flat_batch_buffer | npc | 100 | 0.314 | 0 | 0.49 |
| baseline | npc | 1000 | 1.764 | 474 | 7.86 |
| oop_shared_alias | npc | 1000 | 0.251 | 0 | 0.56 |
| closure_single | npc | 1000 | 0.236 | 0 | 0.27 |
| closure_batch | npc | 1000 | 0.230 | 0 | 0.35 |
| flat_dispatch_pernode | npc | 1000 | 0.267 | 0 | 0.37 |
| flat_batch | npc | 1000 | 0.231 | 0 | 0.41 |
| flat_batch_buffer | npc | 1000 | 0.274 | 0 | 0.47 |
| baseline | wide | 1 | 4.679 | 0 | 23.00 |
| oop_shared_alias | wide | 1 | 0.794 | 0 | 1.00 |
| closure_single | wide | 1 | 0.501 | 0 | 0.00 |
| closure_batch | wide | 1 | 1.312 | 0 | 0.00 |
| flat_dispatch_pernode | wide | 1 | 0.688 | 0 | 0.00 |
| flat_batch | wide | 1 | 1.344 | 0 | 0.00 |
| flat_batch_buffer | wide | 1 | 1.560 | 0 | 0.00 |
| baseline | wide | 10 | 5.279 | 307 | 21.50 |
| oop_shared_alias | wide | 10 | 0.815 | 0 | 1.80 |
| closure_single | wide | 10 | 0.545 | 0 | 0.20 |
| closure_batch | wide | 10 | 0.763 | 0 | 0.20 |
| flat_dispatch_pernode | wide | 10 | 0.722 | 0 | 0.90 |
| flat_batch | wide | 10 | 0.946 | 0 | 0.50 |
| flat_batch_buffer | wide | 10 | 1.013 | 0 | 0.30 |
| baseline | wide | 100 | 5.762 | 225 | 21.47 |
| oop_shared_alias | wide | 100 | 0.852 | 0 | 1.42 |
| closure_single | wide | 100 | 0.614 | 0 | 0.18 |
| closure_batch | wide | 100 | 0.560 | 0 | 0.28 |
| flat_dispatch_pernode | wide | 100 | 0.726 | 0 | 0.76 |
| flat_batch | wide | 100 | 0.731 | 0 | 0.63 |
| flat_batch_buffer | wide | 100 | 0.736 | 0 | 0.91 |
| baseline | wide | 1000 | 6.205 | 224 | 21.45 |
| oop_shared_alias | wide | 1000 | 0.865 | 0 | 1.14 |
| closure_single | wide | 1000 | 0.659 | 0 | 0.14 |
| closure_batch | wide | 1000 | 0.563 | 0 | 0.22 |
| flat_dispatch_pernode | wide | 1000 | 0.756 | 0 | 0.61 |
| flat_batch | wide | 1000 | 0.698 | 0 | 0.53 |
| flat_batch_buffer | wide | 1000 | 0.688 | 0 | 0.81 |
| baseline | deep | 1 | 3.584 | 1024 | 10.00 |
| oop_shared_alias | deep | 1 | 0.528 | 0 | 0.00 |
| closure_single | deep | 1 | 0.333 | 0 | 1.00 |
| closure_batch | deep | 1 | 0.539 | 0 | 0.00 |
| flat_dispatch_pernode | deep | 1 | 0.506 | 0 | 0.00 |
| flat_batch | deep | 1 | 0.756 | 0 | 0.00 |
| flat_batch_buffer | deep | 1 | 0.800 | 0 | 0.00 |
| baseline | deep | 10 | 3.870 | 1126 | 5.00 |
| oop_shared_alias | deep | 10 | 0.488 | 0 | 0.20 |
| closure_single | deep | 10 | 0.290 | 0 | 0.10 |
| closure_batch | deep | 10 | 0.172 | 0 | 0.20 |
| flat_dispatch_pernode | deep | 10 | 0.444 | 0 | 0.10 |
| flat_batch | deep | 10 | 0.353 | 0 | 0.20 |
| flat_batch_buffer | deep | 10 | 0.373 | 0 | 0.10 |
| baseline | deep | 100 | 4.293 | 1116 | 4.35 |
| oop_shared_alias | deep | 100 | 0.470 | 0 | 0.18 |
| closure_single | deep | 100 | 0.276 | 0 | 0.10 |
| closure_batch | deep | 100 | 0.118 | 0 | 0.16 |
| flat_dispatch_pernode | deep | 100 | 0.426 | 0 | 0.12 |
| flat_batch | deep | 100 | 0.260 | 0 | 0.14 |
| flat_batch_buffer | deep | 100 | 0.303 | 0 | 0.15 |
| baseline | deep | 1000 | 4.337 | 1119 | 4.38 |
| oop_shared_alias | deep | 1000 | 0.474 | 0 | 0.14 |
| closure_single | deep | 1000 | 0.281 | 0 | 0.08 |
| closure_batch | deep | 1000 | 0.135 | 0 | 0.13 |
| flat_dispatch_pernode | deep | 1000 | 0.426 | 0 | 0.10 |
| flat_batch | deep | 1000 | 0.262 | 0 | 0.11 |
| flat_batch_buffer | deep | 1000 | 0.294 | 0 | 0.13 |
| baseline | reactive | 1 | 1.251 | 0 | 5.00 |
| oop_shared_alias | reactive | 1 | 0.297 | 0 | 1.00 |
| closure_single | reactive | 1 | 0.160 | 0 | 0.00 |
| closure_batch | reactive | 1 | 0.330 | 0 | 0.00 |
| flat_dispatch_pernode | reactive | 1 | 0.216 | 0 | 0.00 |
| flat_batch | reactive | 1 | 0.410 | 0 | 0.00 |
| flat_batch_buffer | reactive | 1 | 0.479 | 0 | 0.00 |
| baseline | reactive | 10 | 1.400 | 307 | 4.40 |
| oop_shared_alias | reactive | 10 | 0.275 | 0 | 0.40 |
| closure_single | reactive | 10 | 0.134 | 0 | 0.10 |
| closure_batch | reactive | 10 | 0.147 | 0 | 0.20 |
| flat_dispatch_pernode | reactive | 10 | 0.184 | 0 | 0.30 |
| flat_batch | reactive | 10 | 0.183 | 0 | 0.20 |
| flat_batch_buffer | reactive | 10 | 0.223 | 0 | 0.20 |
| baseline | reactive | 100 | 1.381 | 287 | 4.31 |
| oop_shared_alias | reactive | 100 | 0.278 | 0 | 0.32 |
| closure_single | reactive | 100 | 0.128 | 0 | 0.10 |
| closure_batch | reactive | 100 | 0.104 | 0 | 0.17 |
| flat_dispatch_pernode | reactive | 100 | 0.175 | 0 | 0.22 |
| flat_batch | reactive | 100 | 0.126 | 0 | 0.18 |
| flat_batch_buffer | reactive | 100 | 0.165 | 0 | 0.29 |
| baseline | reactive | 1000 | 1.616 | 288 | 4.30 |
| oop_shared_alias | reactive | 1000 | 0.276 | 0 | 0.26 |
| closure_single | reactive | 1000 | 0.128 | 0 | 0.08 |
| closure_batch | reactive | 1000 | 0.103 | 0 | 0.14 |
| flat_dispatch_pernode | reactive | 1000 | 0.190 | 0 | 0.18 |
| flat_batch | reactive | 1000 | 0.130 | 0 | 0.14 |
| flat_batch_buffer | reactive | 1000 | 0.158 | 0 | 0.24 |

> **Reading `B/agent-tick` in Studio.** Roblox's `collectgarbage("count")` reports whole
> kilobytes, so the harness's per-tick heap delta is quantised to 1024 B (Lune's counter is a
> precise float). At 1000 agents a tick allocates hundreds of KB and the column is accurate to
> well under 1%; at 1 and 10 agents the true per-tick figure is below the quantum, so a real 480 B
> shows up as 0 or 1024. Trust the 1000-agent rows, and read `KB/agent (add + 1st tick)` the same
> way. The zero-garbage claim for the shared-tree designs still holds: they read 0 at every agent
> count, including 1000, where 480 B/agent-tick would have been impossible to miss.

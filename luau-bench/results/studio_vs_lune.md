# Studio vs Lune

Roblox Studio 0.739.0.7390687 - Dive In  (placeId: 107977544283224), Edit mode, 2026-09-17 18:08:38Z.
Lune column: `results/_final_run.txt` (Lune 0.10.5, native codegen for required modules).
Studio columns: `results/studio_native.md` and `results/studio_interp.md`, produced by
`luau-bench/studio/studio_runner.ts` - the same harness, bundled into one chunk per slice and
run through `execute_luau`. Same scenarios, same agent counts, same 60k agent-ticks per rep.

## Native codegen really is on

| runtime | canary ns/iter |
|---|---:|
| Lune (require, native codegen) | 2.0 |
| Studio `--!native` | 1.95 |
| Studio plain interpreter | 7.59 |

## us per agent-tick

| case | scenario | agents | Lune native | Studio native | Studio interp | Studio native / Lune | interp / native | B/agent-tick (Studio) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | npc | 1 | 1.951 | 1.141 | 1.388 | 0.58x | 1.22x | 0 |
| oop_shared_alias | npc | 1 | 0.194 | 0.168 | 0.279 | 0.87x | 1.66x | 0 |
| closure_single | npc | 1 | 0.113 | 0.100 | 0.234 | 0.88x | 2.34x | 0 |
| closure_batch | npc | 1 | 0.246 | 0.209 | 0.521 | 0.85x | 2.49x | 0 |
| flat_dispatch_pernode | npc | 1 | 0.200 | 0.155 | 0.289 | 0.77x | 1.86x | 0 |
| flat_batch | npc | 1 | 0.353 | 0.285 | 0.601 | 0.81x | 2.11x | 0 |
| flat_batch_buffer | npc | 1 | 0.386 | 0.298 | 0.704 | 0.77x | 2.36x | 0 |
| baseline | npc | 10 | 1.968 | 1.319 | 1.592 | 0.67x | 1.21x | 512 |
| oop_shared_alias | npc | 10 | 0.193 | 0.157 | 0.264 | 0.81x | 1.68x | 0 |
| closure_single | npc | 10 | 0.146 | 0.117 | 0.230 | 0.80x | 1.97x | 0 |
| closure_batch | npc | 10 | 0.207 | 0.165 | 0.322 | 0.80x | 1.95x | 0 |
| flat_dispatch_pernode | npc | 10 | 0.196 | 0.147 | 0.265 | 0.75x | 1.80x | 0 |
| flat_batch | npc | 10 | 0.214 | 0.163 | 0.326 | 0.76x | 2.00x | 0 |
| flat_batch_buffer | npc | 10 | 0.202 | 0.171 | 0.397 | 0.85x | 2.32x | 0 |
| baseline | npc | 100 | 2.190 | 1.480 | 1.976 | 0.68x | 1.34x | 481 |
| oop_shared_alias | npc | 100 | 0.198 | 0.166 | 0.267 | 0.84x | 1.61x | 0 |
| closure_single | npc | 100 | 0.163 | 0.131 | 0.250 | 0.80x | 1.91x | 0 |
| closure_batch | npc | 100 | 0.161 | 0.131 | 0.249 | 0.81x | 1.90x | 0 |
| flat_dispatch_pernode | npc | 100 | 0.196 | 0.152 | 0.265 | 0.78x | 1.74x | 0 |
| flat_batch | npc | 100 | 0.182 | 0.138 | 0.270 | 0.76x | 1.96x | 0 |
| flat_batch_buffer | npc | 100 | 0.144 | 0.120 | 0.314 | 0.83x | 2.62x | 0 |
| baseline | npc | 1000 | 2.507 | 1.732 | 1.764 | 0.69x | 1.02x | 480 |
| oop_shared_alias | npc | 1000 | 0.184 | 0.154 | 0.251 | 0.84x | 1.63x | 0 |
| closure_single | npc | 1000 | 0.175 | 0.128 | 0.236 | 0.73x | 1.84x | 0 |
| closure_batch | npc | 1000 | 0.134 | 0.107 | 0.230 | 0.80x | 2.15x | 0 |
| flat_dispatch_pernode | npc | 1000 | 0.197 | 0.150 | 0.267 | 0.76x | 1.78x | 0 |
| flat_batch | npc | 1000 | 0.149 | 0.117 | 0.231 | 0.79x | 1.97x | 0 |
| flat_batch_buffer | npc | 1000 | 0.120 | 0.102 | 0.274 | 0.85x | 2.69x | 0 |
| baseline | wide | 1 | 5.408 | 3.698 | 4.679 | 0.68x | 1.27x | 0 |
| oop_shared_alias | wide | 1 | 0.525 | 0.443 | 0.794 | 0.84x | 1.79x | 0 |
| closure_single | wide | 1 | 0.304 | 0.240 | 0.501 | 0.79x | 2.09x | 0 |
| closure_batch | wide | 1 | 0.620 | 0.505 | 1.312 | 0.81x | 2.60x | 0 |
| flat_dispatch_pernode | wide | 1 | 0.432 | 0.373 | 0.688 | 0.86x | 1.84x | 0 |
| flat_batch | wide | 1 | 0.845 | 0.687 | 1.344 | 0.81x | 1.96x | 0 |
| flat_batch_buffer | wide | 1 | 0.901 | 0.728 | 1.560 | 0.81x | 2.14x | 0 |
| baseline | wide | 10 | 6.112 | 4.338 | 5.279 | 0.71x | 1.22x | 307 |
| oop_shared_alias | wide | 10 | 0.589 | 0.471 | 0.815 | 0.80x | 1.73x | 0 |
| closure_single | wide | 10 | 0.428 | 0.313 | 0.545 | 0.73x | 1.74x | 0 |
| closure_batch | wide | 10 | 0.522 | 0.406 | 0.763 | 0.78x | 1.88x | 0 |
| flat_dispatch_pernode | wide | 10 | 0.500 | 0.393 | 0.722 | 0.79x | 1.84x | 0 |
| flat_batch | wide | 10 | 0.725 | 0.566 | 0.946 | 0.78x | 1.67x | 0 |
| flat_batch_buffer | wide | 10 | 0.587 | 0.473 | 1.013 | 0.81x | 2.14x | 0 |
| baseline | wide | 100 | 6.209 | 4.779 | 5.762 | 0.77x | 1.21x | 225 |
| oop_shared_alias | wide | 100 | 0.594 | 0.504 | 0.852 | 0.85x | 1.69x | 0 |
| closure_single | wide | 100 | 0.492 | 0.355 | 0.614 | 0.72x | 1.73x | 0 |
| closure_batch | wide | 100 | 0.473 | 0.342 | 0.560 | 0.72x | 1.64x | 0 |
| flat_dispatch_pernode | wide | 100 | 0.517 | 0.412 | 0.726 | 0.80x | 1.76x | 0 |
| flat_batch | wide | 100 | 0.588 | 0.466 | 0.731 | 0.79x | 1.57x | 0 |
| flat_batch_buffer | wide | 100 | 0.412 | 0.311 | 0.736 | 0.75x | 2.37x | 0 |
| baseline | wide | 1000 | 7.170 | 5.128 | 6.205 | 0.72x | 1.21x | 224 |
| oop_shared_alias | wide | 1000 | 0.618 | 0.519 | 0.865 | 0.84x | 1.67x | 0 |
| closure_single | wide | 1000 | 0.505 | 0.411 | 0.659 | 0.81x | 1.60x | 0 |
| closure_batch | wide | 1000 | 0.470 | 0.350 | 0.563 | 0.74x | 1.61x | 0 |
| flat_dispatch_pernode | wide | 1000 | 0.539 | 0.427 | 0.756 | 0.79x | 1.77x | 0 |
| flat_batch | wide | 1000 | 0.545 | 0.421 | 0.698 | 0.77x | 1.66x | 0 |
| flat_batch_buffer | wide | 1000 | 0.367 | 0.309 | 0.688 | 0.84x | 2.23x | 0 |
| baseline | deep | 1 | 4.660 | 3.047 | 3.584 | 0.65x | 1.18x | 1024 |
| oop_shared_alias | deep | 1 | 0.408 | 0.376 | 0.528 | 0.92x | 1.40x | 0 |
| closure_single | deep | 1 | 0.197 | 0.179 | 0.333 | 0.91x | 1.86x | 0 |
| closure_batch | deep | 1 | 0.265 | 0.237 | 0.539 | 0.89x | 2.27x | 0 |
| flat_dispatch_pernode | deep | 1 | 0.375 | 0.297 | 0.506 | 0.79x | 1.70x | 0 |
| flat_batch | deep | 1 | 0.428 | 0.372 | 0.756 | 0.87x | 2.03x | 0 |
| flat_batch_buffer | deep | 1 | 0.465 | 0.394 | 0.800 | 0.85x | 2.03x | 0 |
| baseline | deep | 10 | 4.948 | 3.258 | 3.870 | 0.66x | 1.19x | 1126 |
| oop_shared_alias | deep | 10 | 0.390 | 0.351 | 0.488 | 0.90x | 1.39x | 0 |
| closure_single | deep | 10 | 0.183 | 0.155 | 0.290 | 0.85x | 1.87x | 0 |
| closure_batch | deep | 10 | 0.100 | 0.074 | 0.172 | 0.74x | 2.32x | 0 |
| flat_dispatch_pernode | deep | 10 | 0.315 | 0.276 | 0.444 | 0.88x | 1.61x | 0 |
| flat_batch | deep | 10 | 0.158 | 0.138 | 0.353 | 0.87x | 2.56x | 0 |
| flat_batch_buffer | deep | 10 | 0.168 | 0.145 | 0.373 | 0.86x | 2.57x | 0 |
| baseline | deep | 100 | 5.146 | 3.677 | 4.293 | 0.71x | 1.17x | 1116 |
| oop_shared_alias | deep | 100 | 0.375 | 0.331 | 0.470 | 0.88x | 1.42x | 0 |
| closure_single | deep | 100 | 0.160 | 0.143 | 0.276 | 0.89x | 1.93x | 0 |
| closure_batch | deep | 100 | 0.060 | 0.056 | 0.118 | 0.93x | 2.11x | 0 |
| flat_dispatch_pernode | deep | 100 | 0.296 | 0.257 | 0.426 | 0.87x | 1.66x | 0 |
| flat_batch | deep | 100 | 0.127 | 0.105 | 0.260 | 0.83x | 2.48x | 0 |
| flat_batch_buffer | deep | 100 | 0.137 | 0.103 | 0.303 | 0.75x | 2.94x | 0 |
| baseline | deep | 1000 | 5.286 | 3.703 | 4.337 | 0.70x | 1.17x | 1119 |
| oop_shared_alias | deep | 1000 | 0.367 | 0.326 | 0.474 | 0.89x | 1.45x | 0 |
| closure_single | deep | 1000 | 0.168 | 0.145 | 0.281 | 0.86x | 1.94x | 0 |
| closure_batch | deep | 1000 | 0.060 | 0.053 | 0.135 | 0.88x | 2.55x | 0 |
| flat_dispatch_pernode | deep | 1000 | 0.293 | 0.258 | 0.426 | 0.88x | 1.65x | 0 |
| flat_batch | deep | 1000 | 0.122 | 0.102 | 0.262 | 0.84x | 2.57x | 0 |
| flat_batch_buffer | deep | 1000 | 0.114 | 0.103 | 0.294 | 0.90x | 2.85x | 0 |
| baseline | reactive | 1 | 1.615 | 1.027 | 1.251 | 0.64x | 1.22x | 0 |
| oop_shared_alias | reactive | 1 | 0.233 | 0.180 | 0.297 | 0.77x | 1.65x | 0 |
| closure_single | reactive | 1 | 0.100 | 0.081 | 0.160 | 0.81x | 1.98x | 0 |
| closure_batch | reactive | 1 | 0.158 | 0.129 | 0.330 | 0.82x | 2.56x | 0 |
| flat_dispatch_pernode | reactive | 1 | 0.131 | 0.117 | 0.216 | 0.89x | 1.85x | 0 |
| flat_batch | reactive | 1 | 0.263 | 0.223 | 0.410 | 0.85x | 1.84x | 0 |
| flat_batch_buffer | reactive | 1 | 0.268 | 0.216 | 0.479 | 0.81x | 2.22x | 0 |
| baseline | reactive | 10 | 1.623 | 1.116 | 1.400 | 0.69x | 1.25x | 307 |
| oop_shared_alias | reactive | 10 | 0.218 | 0.174 | 0.275 | 0.80x | 1.58x | 0 |
| closure_single | reactive | 10 | 0.075 | 0.061 | 0.134 | 0.81x | 2.20x | 0 |
| closure_batch | reactive | 10 | 0.080 | 0.062 | 0.147 | 0.78x | 2.37x | 0 |
| flat_dispatch_pernode | reactive | 10 | 0.105 | 0.094 | 0.184 | 0.90x | 1.96x | 0 |
| flat_batch | reactive | 10 | 0.099 | 0.087 | 0.183 | 0.88x | 2.10x | 0 |
| flat_batch_buffer | reactive | 10 | 0.101 | 0.081 | 0.223 | 0.80x | 2.75x | 0 |
| baseline | reactive | 100 | 1.691 | 1.116 | 1.381 | 0.66x | 1.24x | 287 |
| oop_shared_alias | reactive | 100 | 0.209 | 0.163 | 0.278 | 0.78x | 1.71x | 0 |
| closure_single | reactive | 100 | 0.069 | 0.059 | 0.128 | 0.86x | 2.17x | 0 |
| closure_batch | reactive | 100 | 0.056 | 0.044 | 0.104 | 0.79x | 2.36x | 0 |
| flat_dispatch_pernode | reactive | 100 | 0.103 | 0.087 | 0.175 | 0.84x | 2.01x | 0 |
| flat_batch | reactive | 100 | 0.060 | 0.059 | 0.126 | 0.98x | 2.14x | 0 |
| flat_batch_buffer | reactive | 100 | 0.068 | 0.056 | 0.165 | 0.82x | 2.95x | 0 |
| baseline | reactive | 1000 | 1.785 | 1.262 | 1.616 | 0.71x | 1.28x | 288 |
| oop_shared_alias | reactive | 1000 | 0.203 | 0.171 | 0.276 | 0.84x | 1.61x | 0 |
| closure_single | reactive | 1000 | 0.074 | 0.059 | 0.128 | 0.80x | 2.17x | 0 |
| closure_batch | reactive | 1000 | 0.050 | 0.041 | 0.103 | 0.82x | 2.51x | 0 |
| flat_dispatch_pernode | reactive | 1000 | 0.104 | 0.088 | 0.190 | 0.85x | 2.16x | 0 |
| flat_batch | reactive | 1000 | 0.057 | 0.052 | 0.130 | 0.91x | 2.50x | 0 |
| flat_batch_buffer | reactive | 1000 | 0.066 | 0.052 | 0.158 | 0.79x | 3.04x | 0 |

> **Reading `B/agent-tick` in Studio.** Roblox's `collectgarbage("count")` reports whole
> kilobytes, so the harness's per-tick heap delta is quantised to 1024 B (Lune's counter is a
> precise float). At 1000 agents a tick allocates hundreds of KB and the column is accurate to
> well under 1%; at 1 and 10 agents the true per-tick figure is below the quantum, so a real 480 B
> shows up as 0 or 1024. Trust the 1000-agent rows, and read `KB/agent (add + 1st tick)` the same
> way. The zero-garbage claim for the shared-tree designs still holds: they read 0 at every agent
> count, including 1000, where 480 B/agent-tick would have been impossible to miss.

## How the ordering of designs changes

Fastest design first, baseline excluded.

| scenario | agents | Lune native | Studio native | Studio interp |
|---|---:|---|---|---|
| npc | 1 | closure_single > oop_shared_alias > flat_dispatch_pernode > closure_batch > flat_batch > flat_batch_buffer | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer | closure_single > oop_shared_alias > flat_dispatch_pernode > closure_batch > flat_batch > flat_batch_buffer |
| npc | 10 | closure_single > oop_shared_alias > flat_dispatch_pernode > flat_batch_buffer > closure_batch > flat_batch | closure_single > flat_dispatch_pernode > oop_shared_alias > flat_batch > closure_batch > flat_batch_buffer | closure_single > oop_shared_alias > flat_dispatch_pernode > closure_batch > flat_batch > flat_batch_buffer |
| npc | 100 | flat_batch_buffer > closure_batch > closure_single > flat_batch > flat_dispatch_pernode > oop_shared_alias | flat_batch_buffer > closure_single > closure_batch > flat_batch > flat_dispatch_pernode > oop_shared_alias | closure_batch > closure_single > flat_dispatch_pernode > oop_shared_alias > flat_batch > flat_batch_buffer |
| npc | 1000 | flat_batch_buffer > closure_batch > flat_batch > closure_single > oop_shared_alias > flat_dispatch_pernode | flat_batch_buffer > closure_batch > flat_batch > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > closure_single > oop_shared_alias > flat_dispatch_pernode > flat_batch_buffer |
| wide | 1 | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer |
| wide | 10 | closure_single > flat_dispatch_pernode > closure_batch > flat_batch_buffer > oop_shared_alias > flat_batch | closure_single > flat_dispatch_pernode > closure_batch > oop_shared_alias > flat_batch_buffer > flat_batch | closure_single > flat_dispatch_pernode > closure_batch > oop_shared_alias > flat_batch > flat_batch_buffer |
| wide | 100 | flat_batch_buffer > closure_batch > closure_single > flat_dispatch_pernode > flat_batch > oop_shared_alias | flat_batch_buffer > closure_batch > closure_single > flat_dispatch_pernode > flat_batch > oop_shared_alias | closure_batch > closure_single > flat_dispatch_pernode > flat_batch > flat_batch_buffer > oop_shared_alias |
| wide | 1000 | flat_batch_buffer > closure_batch > closure_single > flat_dispatch_pernode > flat_batch > oop_shared_alias | flat_batch_buffer > closure_batch > closure_single > flat_batch > flat_dispatch_pernode > oop_shared_alias | closure_batch > closure_single > flat_batch_buffer > flat_batch > flat_dispatch_pernode > oop_shared_alias |
| deep | 1 | closure_single > closure_batch > flat_dispatch_pernode > oop_shared_alias > flat_batch > flat_batch_buffer | closure_single > closure_batch > flat_dispatch_pernode > flat_batch > oop_shared_alias > flat_batch_buffer | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer |
| deep | 10 | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > closure_single > flat_batch > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias |
| deep | 100 | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch_buffer > flat_batch > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > closure_single > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias |
| deep | 1000 | closure_batch > flat_batch_buffer > flat_batch > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > closure_single > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias |
| reactive | 1 | closure_single > flat_dispatch_pernode > closure_batch > oop_shared_alias > flat_batch > flat_batch_buffer | closure_single > flat_dispatch_pernode > closure_batch > oop_shared_alias > flat_batch_buffer > flat_batch | closure_single > flat_dispatch_pernode > oop_shared_alias > closure_batch > flat_batch > flat_batch_buffer |
| reactive | 10 | closure_single > closure_batch > flat_batch > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias | closure_single > closure_batch > flat_batch_buffer > flat_batch > flat_dispatch_pernode > oop_shared_alias | closure_single > closure_batch > flat_batch > flat_dispatch_pernode > flat_batch_buffer > oop_shared_alias |
| reactive | 100 | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch_buffer > closure_single > flat_batch > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > closure_single > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias |
| reactive | 1000 | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > flat_batch > flat_batch_buffer > closure_single > flat_dispatch_pernode > oop_shared_alias | closure_batch > closure_single > flat_batch > flat_batch_buffer > flat_dispatch_pernode > oop_shared_alias |

## What changes in Studio

**Studio native is the fastest of the three runtimes.** Across all 112 rows the median
Studio-native time is **0.81x** the Lune time, i.e. Studio runs the same bundled harness about
24% faster than Lune does. The Lune numbers in SUMMARY.md are therefore
conservative for a `--!native` Roblox build, not optimistic.

**How much each design depends on native codegen** (median interp / native over all rows):

| case | interp / native |
|---|---:|
| baseline | 1.22x |
| oop_shared_alias | 1.65x |
| flat_dispatch_pernode | 1.80x |
| closure_single | 1.94x |
| flat_batch | 2.03x |
| closure_batch | 2.32x |
| flat_batch_buffer | 2.57x |

The spread is the point. The baseline barely notices codegen: it spends its time in metatable
lookups, table allocation and GC, none of which codegen speeds up. The lean designs are the ones
that lose the most without it, because what is left of them is arithmetic and calls. So the
*ratio* between the baseline and the rework shrinks under the interpreter, but only from
enormous to very large.

**Does `closure_single` still lead at 1 agent(s)?** Fastest design per scenario:

- npc: Lune closure_single, Studio native closure_single, Studio interp closure_single
- wide: Lune closure_single, Studio native closure_single, Studio interp closure_single
- deep: Lune closure_single, Studio native closure_single, Studio interp closure_single
- reactive: Lune closure_single, Studio native closure_single, Studio interp closure_single

**Where batching starts to pay** (lowest measured agent count at which `closure_batch` beats
`closure_single`):

| scenario | Lune | Studio native | Studio interp |
|---|---:|---:|---:|
| npc | 100 | 1000 | 100 |
| wide | 100 | 100 | 100 |
| deep | 10 | 10 | 10 |
| reactive | 100 | 100 | 100 |


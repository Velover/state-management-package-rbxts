# luau-bench

Lune test bed for the behavior tree rework. See [SPEC.md](SPEC.md) for the design brief, semantics and
adapter contract.

```
baseline/   current BTree compiled from src/BehaviorTree.ts (do not edit)
harness/    runner (correctness vs baseline + benchmarks), scenarios, status codes, baseline adapter
cases/      one adapter file per design candidate
micro/      isolated micro-benchmarks (indexing, call dispatch, allocation)
results/    reports per case
```

Run everything for one case:

```
lune run luau-bench/harness/runner.luau baseline closure_single
lune run luau-bench/harness/runner.luau closure_single --quick --scenario=npc --agents=1,1000
```

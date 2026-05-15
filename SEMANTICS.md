# Benchmark Semantics

This suite compares reactive libraries as runtime profiles, not as one universal
speed number.

Every result should be read as:

```txt
Library L + adapter semantics S + workload W + machine M + runtime R
-> distribution of time, memory pressure, correctness, and stability
```

## Adapter Contract

The benchmark adapter interface is intentionally small:

```ts
signal(initial).read()
signal(initial).write(value)
computed(fn).read()
effect(fn)
withBatch(fn)
withBuild(fn)
```

Adapters should match the closest production semantics of each library while
making the measured operation comparable. Where semantics differ, the result is
a profile of that adapter and policy, not a proof that one library universally
dominates another.

## Semantics Matrix

Each adapter should be classified against these questions before its numbers are
treated as comparable:

| Dimension | Why it matters |
| --- | --- |
| Computed lazy or eager | Moves cost between writes and reads |
| Effects sync or scheduled | Changes latency, batching, and delivery timing |
| Batching support | Write-heavy tests are unfair without an explicit policy |
| Equality check | Can block propagation and change dirty marking |
| Dynamic dependency cleanup | Required for branchy UI-style graphs |
| Dispose or cleanup support | Determines lifecycle and retained-graph behavior |
| Nested effects | Changes ownership and cleanup semantics |
| Glitch-free guarantee | Fast propagation is not useful if intermediate values leak |
| Error or cycle handling | Unsafe runtimes can look faster by doing less work |

Current adapters implement this through a common wrapper, but not every library
has identical native semantics. Treat any unknown cell as a limitation of the
current comparison, not as a hidden benchmark assumption.

## Workload Model

Reactive workloads are modeled as changing directed graphs:

```txt
G_t = (V_t, E_t)
V = signals union computeds union effects
E = dependency edges
```

Operations either change values or graph structure:

```txt
write(source)
read(computed)
flush(effects)
track(dep)
untrack(dep)
dispose(node)
switchBranch(observer)
```

Dynamic benchmark rows include topology metadata such as estimated nodes, edges,
depth, fan-in, read fraction, and dependency churn. Static microbenchmarks are
classified by family and dominant operation.

## Workload Groups

The report groups benchmarks into these families:

| Group | What it emphasizes |
| --- | --- |
| `creation` | Signal/computed allocation and object shape cost |
| `update` | Stable graph write and invalidation hot paths |
| `pull` | Dirty computed reads, fan-in aggregation, and chain pulls |
| `push` | Fan-out propagation and effect delivery |
| `dynamic` | Dependency churn, branch switching, cleanup, and retracking |
| `large_graph` | Scaling behavior on larger DAGs |
| `lifecycle` | Create/dispose pressure and retained graph behavior |
| `baseline` | Small propagation and historical reference cases |

## Statistics

The primary row score is median wall-clock time. Rows also emit:

```txt
min
median
mean
p75
p90
p95
p99
stddev
MAD
IQR
coefficient of variation
```

The terminal log currently prints median, p95, p99, CV, group, family, and
benchmark-specific counters. The HTML report ranks libraries by geometric mean
of relative slowdown:

```txt
r(L, test) = median_time(L, test) / best_median_time(test)
score(L) = exp(mean(log(r(L, test))))
```

Lower is better. A score of `1.00x` means best on every included row.

## Correctness Gate

Performance rows must keep a validation sink alive. Dynamic graph rows check the
observed sum and, when adapter semantics allow it, recomputation counts.

The intended gate before trusting performance results is:

```txt
computed correctness
dynamic dependencies
diamond glitch freedom
effect delivery
batch behavior
dispose cleanup, when claimed
cycle or error behavior, when claimed
```

Fast incorrect results are benchmark failures, not wins.

## Fairness Rules

Runs should record:

```txt
OS
CPU
RAM
Node
V8
package versions
build mode
power mode
thermal state
BENCH_RUNS
GC policy
```

This project runs under `node --expose-gc` and isolates each framework/scenario
pair in a child process so V8 state, heap state, subscriptions, and library
caches do not leak between rows.

## Interpretation

Prefer statements like:

```txt
Library A is strong on creation and baseline propagation.
Library B is stronger on update-heavy and dynamic dependency workloads.
Library C has low allocation pressure on stable graphs but degrades under churn.
```

Avoid statements like:

```txt
Library A is faster.
```

That sentence hides the graph class, runtime policy, memory behavior, and tail
latency. Real applications care about graceful degradation when the topology
gets ugly.

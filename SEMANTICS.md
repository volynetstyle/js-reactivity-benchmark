# Benchmark Semantics

This suite compares reactive libraries as runtime profiles, not as one universal
speed number.

Current measurements follow **semantics v3**. See
[the researched workload contracts](docs/benchmark-methodology.md) for
creation, observation, batching, correctness, and diagnostic policies.
Earlier logs must be rerun to compare with this contract.

Every result should be read as:

```txt
Library L + adapter semantics S + workload W + machine M + runtime R
-> distribution of time, memory pressure, correctness, and stability
```

## Adapter Contract

The benchmark adapter interface is intentionally small:

```ts
signal(initial).read();
signal(initial).write(value);
computed(fn).read();
effect(fn);
withBatch(fn);
withBuild(fn);
```

Adapters should match the closest production semantics of each library while
making the measured operation comparable. Where semantics differ, the result is
a profile of that adapter and policy, not a proof that one library universally
dominates another.

## Semantics Matrix

Each adapter should be classified against these questions before its numbers are
treated as comparable:

| Dimension                  | Why it matters                                             |
| -------------------------- | ---------------------------------------------------------- |
| Computed lazy or eager     | Moves cost between writes and reads                        |
| Effects sync or scheduled  | Changes latency, batching, and delivery timing             |
| Batching support           | Write-heavy tests are unfair without an explicit policy    |
| Equality check             | Can block propagation and change dirty marking             |
| Dynamic dependency cleanup | Required for branchy UI-style graphs                       |
| Dispose or cleanup support | Determines lifecycle and retained-graph behavior           |
| Nested effects             | Changes ownership and cleanup semantics                    |
| Glitch-free guarantee      | Fast propagation is not useful if intermediate values leak |
| Error or cycle handling    | Unsafe runtimes can look faster by doing less work         |

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

| Group         | What it emphasizes                                          |
| ------------- | ----------------------------------------------------------- |
| `creation`    | Signal/computed allocation and object shape cost            |
| `update`      | Stable graph write and invalidation hot paths               |
| `pull`        | Dirty computed reads, fan-in aggregation, and chain pulls   |
| `push`        | Fan-out propagation and effect delivery                     |
| `dynamic`     | Dependency churn, branch switching, cleanup, and retracking |
| `large_graph` | Scaling behavior on larger DAGs                             |
| `lifecycle`   | Create/dispose pressure and retained graph behavior         |
| `baseline`    | Small propagation and historical reference cases            |

## Statistics

### Adaptive performance ceiling

Every row begins with one validated pilot run. The default ceiling is:

```txt
max(1500 ms, 3 * fastest pilot observed for the same scenario)
```

If a pilot exceeds that ceiling, its measured time is kept as the score, but
additional samples are skipped and the row is marked `SLOW/CAPPED samples=1`.
This is a low-confidence classification, not a timeout or a fabricated result.
Configure it with `BENCH_MIN_CEILING_MS` and `BENCH_MAX_SLOWDOWN`.

The quick profile uses five measured samples; expensive graph/fan cases use three.
The tails profile uses 1000 samples and additional warmup. An explicit
`BENCH_SAMPLES` overrides the target.
The current runner does not read `BENCH_RUNS`. Sample counts are declared by
each case through the centralized benchmark API. Report those counts and any
capped rows when publishing distribution statistics.

The pilot is validated but excluded from an uncapped distribution. A capped row
uses its pilot alone and remains visibly low confidence. Samples are untrimmed:
slow observations are never discarded. The runner emits median, CV, group,
family, and counters. p95 requires 200 samples; p99 requires 1000. Tail intervals
use 95% order-statistic bounds under an iid assumption; correlated runtime or
thermal behavior limits that interpretation. Saved JSON contains every duration.
The HTML report ranks libraries by geometric mean of relative slowdown:

```txt
r(L, test) = median_time(L, test) / best_median_time(test)
score(L) = exp(mean(log(r(L, shared_test))))
```

Lower is better. A score of `1.00x` means best on every included row.

## Correctness Gate

Performance rows must keep a validation sink alive. Dynamic graph rows check the
observed sum and, when adapter semantics allow it, recomputation counts.
The numeric oracle covers every active graph scenario. Every produced result
is validated outside timing before a fixture reset; a mismatch throws and
prevents that row from receiving a score.

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
per-case sample counts and capped rows
GC policy
```

This project runs under `node --expose-gc` and isolates each framework/scenario
pair in a child process so V8 state, heap state, subscriptions, and library
caches do not leak between rows.
Samples within a row share a VM. Creation fixtures remain fresh. Declared warm
static full-read graphs keep their fixture and restore initial source values,
flush all leaves, and reset counters outside timing; tests verify the same
measured values and recomputation counts. The log header records
Node/V8, platform, CPU, RAM, GC, semantics version, isolation, and whether
diagnostic instrumentation is enabled. The lockfile records package versions.
`BENCH_IN_PROCESS=1` disables row isolation for diagnosis; `BENCH_INSTRUMENT=1`
adds internal instrumentation to `@solidjs/signals`. Do not combine those
diagnostic results with a default run.

Measured workload files contain no console calls. CI additionally guards all
console methods at runtime during measured callbacks. Reports are emitted after
timing. Native lifecycle support is explicit; absent ownership is not scored as
zero, and the overall ranking uses the shared scenario intersection.

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

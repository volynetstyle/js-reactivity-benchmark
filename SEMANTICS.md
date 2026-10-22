# Benchmark Semantics

This suite compares reactive libraries as runtime profiles, not as one universal
speed number.

Current measurements follow **semantics v4**. See
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

The `reactive-engine` adapter uses the public `ReactiveEngineCore` export from
`@pravosleva/reactive-engine`, with logging disabled. It measures signals, lazy
computed values, synchronous effects, and native explicit batching. Build calls
run directly; the automatic microtask scheduler, DI services, resources, and UI
bridges are not used. Effects return native disposers for fixture cleanup. The
adapter does not expose `createScope`, because the core has no public owner-scope
API for disposing an entire graph; native owner lifecycle rows are omitted.

Adapters measure each library's reactive core, built as it ships to production:

- Preact Signals uses `@preact/signals-core`, the framework-agnostic core,
  rather than the Preact integration package (which also loads Preact and its
  hooks).
- `@vue/reactivity` runs `reactivity.cjs.prod.js`. Before v4 the bundle left
  `process.env.NODE_ENV` unset, so Vue silently ran its development build.
- Oby effects use `$.effect(fn, { sync: "init" })`: the first run is synchronous
  and later runs are flushed by `tick()` at the commit. Reactively effects are
  evaluated once with `get()` and then flushed by `stabilize()`. Before v4 both
  adapters ran every effect body twice on installation (once untracked).
- lite-signal (1.5.x) has no disposable root; its `createScope` uses an effect
  as the unit of ownership, as the library documents.

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

### Sampling

Each row runs in a fresh process: one validated pilot (cold), validated warmup
invocations, then measured samples. Each invocation prepares its fixture,
runs a full GC, and only then starts the clock, so setup garbage and the
previous sample's garbage are never charged to the measured call.

| Profile           | Warmup | Measured samples                                                             |
| ----------------- | ------ | ---------------------------------------------------------------------------- |
| `quick` (default) | 2      | at least the case minimum (10; 6 for graph/fan rows) and 250 ms, at most 100 |
| `tails`           | 20     | exactly 1000                                                                 |
| `BENCH_SAMPLES=n` | 2/20   | exactly `n`                                                                  |

`BENCH_MIN_TIME_MS` and `BENCH_MAX_SAMPLES` tune the quick budget. Samples are
kept in chronological order and untrimmed; statistics use a sorted copy.

`BENCH_ROUNDS=n` repeats every row in `n` fresh processes. The score is then
the median of the round medians and the reported interval is their range, which
exposes between-process (JIT, allocation layout) variance that samples inside
one process cannot show.

Rows run scenario-major: all frameworks for one scenario, then the next. The
framework order rotates per scenario and per round, so no library is always
measured first or last as the machine heats up or picks up background load.

### Adaptive performance ceiling

The default ceiling is:

```txt
max(1500 ms, 3 * fastest pilot of any framework for the same scenario)
```

A row whose pilot exceeds 1500 ms is deferred; once every framework's pilot for
the scenario is known, it is either capped or measured in full in a new process.
The decision therefore does not depend on run order (before v4 it compared only
with frameworks that happened to run earlier). A capped row keeps its cold pilot
as the score, is marked `SLOW/CAPPED samples=1`, and has no interval. Configure
with `BENCH_MIN_CEILING_MS` and `BENCH_MAX_SLOWDOWN`.

### Uncertainty

The row score is the median. With 6 or more samples the runner reports a
distribution-free 95% order-statistic interval for it (`median_ci95`). The
report marks a result whose interval overlaps the leader's with `≈` and counts
a scenario as a win only when the leader's interval lies below the runner-up's.
p95 requires 200 samples and p99 1000, with 95% order-statistic bounds. All
intervals assume iid samples; autocorrelation, JIT transitions and thermal
changes limit that interpretation, which is what rounds are for. Saved JSON
contains every duration, including pilot and warmup.
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
package versions (recorded per worker)
build mode (production, recorded)
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
Node/V8, platform, CPU, cores, RAM, GC, semantics version, sampling policy,
isolation, run order, build mode, and whether diagnostic instrumentation is
enabled; one `# package` line per framework records the exact versions bundled
into its worker. All dependencies are pinned to exact versions.
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

# Benchmark methodology: research and semantics v3

The v2 revision addressed the CI adapter failure and the five review questions.
The v3 revision completes value/delivery validation, lifecycle workloads,
tail sampling, and faster preparation and process startup.
Sources were consulted before implementation. Installed implementations were
also inspected at the versions in `pnpm-lock.yaml`; upstream documentation can
describe a different version.

## Sources and implications

| Primary source                                                                                                               | Finding                                                                                                                                                                        | Benchmark decision                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mitata: writing good benchmarks](https://github.com/evanwashere/mitata#writing-good-benchmarks)                             | Unobserved allocations can be eliminated; fixture parameters and GC policy affect measurement.                                                                                 | Return an array retaining all created nodes, consume the result with `do_not_optimize`, and validate outside timing.                                      |
| [Preact Signals](https://preactjs.com/guide/v10/signals/)                                                                    | Computeds evaluate on demand; reading an invalid computed inside a batch can pull dependencies before the batch ends.                                                          | Initialize every creation node, and read every update consumer after each changed write. Read large-graph sinks after the declared transaction commits.   |
| [Solid: batch](https://docs.solidjs.com/reference/reactive-utilities/batch)                                                  | Batch defers downstream work; reading during a batch may update a computation on demand.                                                                                       | Apply the same batch policy to every adapter.                                                                                                             |
| [S.js: freeze and data](https://github.com/adamhaile/S#sfreeze)                                                              | Freeze defers propagation; conflicting writes to a source within one freeze are unsupported.                                                                                   | A burst writes each source at most once. Reject bursts larger than the source count instead of giving S.js a special workload.                            |
| [lite-signal repository](https://github.com/PeshoVurtoleta/lite-signal), published `@zakkster/lite-signal@1.3.0` `Signal.js` | Lazy preallocation constructs pool objects on demand. In 1.3.0 grow refills chunks and extends a capacity ledger; an array-wide copy is not guaranteed by this implementation. | Keep fresh lazy registries, raise the node budget to 262,144, and use the throw policy to prevent unnoticed growth.                                       |
| [Reflex repository](https://github.com/volynetstyle/Reflex), published `@volynets/reflex@1.0.0` README and types             | The published `signal` returns `[read, write]`; computed is a lazy accessor and SAB flushes effects after a batch.                                                             | Adapt the published tuple API. Check the exact npm tarball against the lockfile integrity rather than trusting a stale local build with the same version. |

The [Vue 3.5.32 effect implementation](https://github.com/vuejs/core/blob/v3.5.32/packages/reactivity/src/effect.ts)
also shows that native triggering runs only if dirty; a custom scheduler
replaces that policy. The adapter must preserve that check when flushing.

## Workload contracts

Creation rows exclude source construction and the result-array allocation.
The timed section creates the requested nodes inside the framework's ownership
scope, evaluates each node once, records its checksum, and retains every node
through validation. This measures initialized graph construction, including
first allocation and dependency tracking. A fresh lazy pool still allocates
objects inside the timed section. It is not an allocation-free warm-pool test.
`createDataSignals` now constructs only the requested signals; it no longer
preconstructs and replaces an equally large unused source array.

Update rows construct and initialize the graph outside timing. Each timed
iteration changes source zero, then reads every requested consumer and
accumulates the values. Fan-out rows preserve their original write counts:
`4 * COUNT / fanOut`; fan-in rows preserve their original counts. This is a
write-and-pull workload. Native eager or lazy scheduling remains part of the
library profile; neither engine can win by leaving the result unobserved.
Separate invalidation-only and observed push tests should use separate names.

Large graph policies are uniform across adapters:

| Mode/cadence       | Transaction and observation                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| mixed / per-update | Commit one source write, then read selected sinks; repeat for each write.                          |
| mixed / per-batch  | Commit an iteration's burst, then read selected sinks.                                             |
| mixed / final-only | Commit each iteration's burst; read sinks after all iterations.                                    |
| pull               | Commit each iteration's burst; read sinks at the end. Eager engines may still propagate on commit. |
| push               | Install effects, commit each iteration's burst, and return the final delivered sink values.        |

The mixed runner also performs one final sink pass for the returned checksum.
These are synchronous graph simulations, not DOM rendering or browser event
latency measurements. Push currently includes effect installation in the timed
section; separate steady-state effect delivery is a future workload.

## Correctness and isolation

`src/util/referenceGraph.ts` calculates final values using plain numeric arrays,
deterministic topology selection, and the final source writes. It does not use
an adapter, `makeGraph`, or `runGraph`. It covers all active graph shapes,
selective reads, dynamic branch rules, and untimed warmup writes.

Historical targets were checked against that oracle:

| Scenario          | Correct final sum              | Count policy                     |
| ----------------- | ------------------------------ | -------------------------------- |
| simple component  | 19,200,092                     | Canonical pull count: 3,180,010. |
| dynamic component | 302,310,877,104                | Canonical pull count: 1,140,004. |
| large web app     | 29,355,933,696,000 (unchanged) | Canonical pull count: 1,473,786. |

Other configured sums agree with the oracle. Scenarios without a historical
sum receive an oracle target outside timing. Count assertions only apply when
an explicit target exists and an adapter claims matching pull counts.
Counts across eager and lazy schedules are not universally interchangeable.

Incorrect sums throw and exclude the row from reporting. Validation runs for
every pilot, warmup, and measured result, outside timing and before the next
fixture reset. Intermediate failures cannot be hidden by a later correct run.

By default each framework/scenario pair executes in a fresh serial child
process containing only its selected library. Creation samples use fresh fixtures.
Explicitly warm static full-read graphs reuse a fixture after an exact untimed
checkpoint restore, leaf flush, and counter reset. Tests across all 14 adapters
verify identical sums and recomputation counts after restoration. The pilot is
excluded from an uncapped median; a capped row retains its one pilot. The parent
passes the fastest pilot reference between workers for the adaptive cap.
`BENCH_IN_PROCESS=1` is a diagnostic override, recorded as shared isolation in
the log header. Compare runs with the same isolation policy.

`@solidjs/signals` normally executes its unmodified implementation.
`BENCH_INSTRUMENT=1` enables the previous internal queue instrumentation for
diagnostic runs. Those runs add work to that adapter and must not be mixed
with ordinary performance results.

The Vue adapter previously queued the same effect once per invalidation and
unconditionally ran every queued copy. Its queue now deduplicates effects,
checks `ReactiveEffect.dirty`, and flushes at the outer commit. It also flushes
unbatched writes synchronously and restores batching state after errors. This
fixes duplicate delivery and avoids charging Vue for work its native scheduler
would skip. Adapter tests cover committed values and dynamic dependency
detachment for all active frameworks.

## Completed in v3

Historical Kairo and fan cases use numerical schedules prepared without a
reactive library. A common consumer probe detects wrong intermediate values
and missing deliveries of changed outputs; an engine may additionally deliver
unchanged values, which is reported as actual work. Assertions run after timing.
Fan PRNG and unique-write selection moved outside timing; the original source
write sequence is preserved. Read-only schedules can be cached, but reactive
nodes and cold registries cannot.

The historical mutable-identity graph now checks all three effect values at
each commit. Separate immutable-replacement and in-place/versioned publication
rows make the publication policy explicit. In-place mutation alone is not
assumed to invalidate shallow signals.

Seven adapters expose native owner disposal: Alien Signals, lite-signal,
@solidjs/signals, S.js, Oby, SolidJS, and Vue. One lifecycle row constructs,
updates, and disposes graphs over 1000 cycles; another times disposal of a
retained 1024-node graph. Post-disposal writes must trigger neither computations
nor effects. Other adapters have no fabricated lifecycle result.

Synthetic heavy work now evolves an observable stateful checksum, preventing
an unused constant loop from disappearing. All active rows have value/delivery
or lifecycle validation. Old unused assertion-based Kairo files were removed.

### Tail statistics

The [NIST percentile discussion](https://www.itl.nist.gov/div898/handbook/prc/section2/prc262.htm)
describes percentile estimation and interpolation. This harness uses R7
interpolation and an explicit engineering rule of ten expected observations
above a target quantile: at least 200 samples for p95 and 1000 for p99. These
thresholds are our reporting policy, not a guarantee of precision.

The tails profile collects 1000 measured invocations after extra warmup.
The quick profile preserves short median runs. Every duration is kept:
mitata 1.0.34 normally sorts and trims two observations from each end above
its threshold; `samples_threshold: Infinity` disables that trimming, and a
count assertion catches any discarded observations. Saved samples are sorted
by duration, not chronological. JSON stores the pilot separately.

Equal-tail 95% intervals use binomial order-statistic bounds. Their coverage
interpretation assumes iid continuous samples; autocorrelation, JIT transitions,
and thermal changes limit that assumption. Percentiles describe a whole
workload invocation under the stated GC policy, not individual UI event latency.
Neither quick runs nor capped rows claim a p99.

### CI and reproducibility

CI runs the complete adapter/workload tests, builds dedicated workers once,
and verifies 21 isolated rows plus saved samples. Timing values are not pass/fail
thresholds on shared CI machines. Static and runtime checks reject console
calls during measurement; report output occurs after timing.

The benchmark workflow checks out the exact tested SHA, archives the log and
all samples, and avoids committing a stale leaderboard if the branch advanced.
Overall scores use a common scenario intersection. Lifecycle comparisons use
the subset of adapters that implement native ownership.

## Remaining extensions

The changes above resolve the five review issues; they do not establish a
universal library ranking. Further useful work is:

- separate cold construction, allocation-only construction, invalidation-only
  updates, and steady-state observed push rows;
- package version metadata and recorded power/thermal conditions for published
  runs.

Old logs cannot be recalculated into v3 measurements. Generate a complete fresh
run before publishing a new leaderboard.

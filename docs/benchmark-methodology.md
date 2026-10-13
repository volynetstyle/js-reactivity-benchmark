# Benchmark methodology: research and semantics v2

This revision addresses the CI adapter failure and the five review questions.
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
process. Samples within that row use fresh fixtures in the same VM; there is
still JIT warmup within a row. The pilot participates in the median. The parent
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

## Further stages

The changes above resolve the five review issues; they do not establish a
universal library ranking. Further useful work is:

- independent value/delivery validation for the remaining historical Kairo,
  fan, and mutable-object scenarios;
- separate cold construction, allocation-only construction, invalidation-only
  updates, and steady-state observed push rows;
- ownership/disposal fixtures for lifecycle tests and warmed push scenarios;
- larger sample distributions and saved raw samples before reporting tails;
- explicit workload families in current compact output, and comparison on the
  same complete scenario intersection;
- package version metadata and recorded power/thermal conditions for published
  runs.

Old logs cannot be recalculated into v2 measurements. Generate a complete fresh
run before publishing a new leaderboard.

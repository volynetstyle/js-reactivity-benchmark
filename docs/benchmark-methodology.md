# Benchmark methodology: research and semantics v4

## Semantics v4: measurement honesty review

v4 audits what is actually executed and timed. Each finding below changed
results, or could have changed them, without any library changing.

| Finding                                                                                                                                                            | Effect before v4                                                                                                                              | Decision                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The esbuild bundle left `process.env.NODE_ENV` unset. `@vue/reactivity/index.js` selects `reactivity.cjs.prod.js` only when it equals `production`.                | Vue ran its development build. Same-machine A/B on three rows: update 1to1 +3%, create 1to1 +17%, kanban board +12% (95% intervals disjoint). | Bundle with `NODE_ENV=production`. The build fails if a bundled file has a production twin on disk (`x.cjs.js`/`x.cjs.prod.js`, `dev.js`/`prod.js`). Workers also run with `NODE_ENV=production`. |
| `globalThis.__DEV__ = true` was set before every run.                                                                                                              | No bundled library reads it today; it would enable dev paths in any library that does.                                                        | Removed.                                                                                                                                                                                          |
| `random` was a caret range. `random@5.5` seeds strings with xoshiro128\*\* and also corrects the ARC4 swap that 5.4.1 implements.                                  | A fresh npm install (5.5.1) builds different graphs; every framework failed the configured expected sums.                                     | Vendor the exact 5.4.1 generator (`src/util/seededRandom.ts`), verified identical over one million mixed draws and pinned by a golden test. Every configured sum is unchanged.                    |
| Dependencies used caret ranges.                                                                                                                                    | npm and pnpm users could measure different library versions under one label.                                                                  | Exact pins. Each worker records the versions it bundles; they are logged (`# package`), saved in JSON and shown on the page.                                                                      |
| The cap compared a pilot with the fastest pilot of frameworks that had already run.                                                                                | Whether a slow library was capped (one cold sample) depended on its position in the run.                                                      | Pilots above the absolute floor are deferred until all frameworks' pilots for the scenario are known.                                                                                             |
| Rows ran framework-major.                                                                                                                                          | Thermal and background drift during a long run biased whole libraries.                                                                        | Scenario-major order with framework rotation per scenario and per round.                                                                                                                          |
| mitata sorted samples and added an unconditional extra warmup call; the quick profile used 5 samples (3 for graph rows). Rows as short as 30 µs had CV around 0.7. | Chronological effects (JIT tier-up, throttling) were invisible; medians of 3 to 5 noisy samples ranked libraries.                             | An in-repo sampler: pilot, explicit warmup, then samples until a per-case minimum and a 250 ms budget are met (max 100), kept chronologically. The median gets a 95% order-statistic interval.    |
| Within-process samples cannot show between-process variance.                                                                                                       | One process per row was a single draw of JIT and allocation layout.                                                                           | Optional `BENCH_ROUNDS`: fresh-process repetitions, median of round medians plus their range.                                                                                                     |
| Oby and Reactively adapters called `fn()` before creating the effect.                                                                                              | Every effect body ran twice on installation (once untracked), charged to timed effect installation.                                           | Native `sync: "init"` (Oby) and a single tracked `get()` (Reactively).                                                                                                                            |
| `@preact/signals` is the Preact integration and loads `preact` and its hooks.                                                                                      | Extra modules in the worker; not the framework-agnostic core the other adapters measure.                                                      | `@preact/signals-core`.                                                                                                                                                                           |
| The report counted every raw first place as a win and described the score as covering all tests.                                                                   | Differences inside the noise were presented as wins.                                                                                          | Wins require disjoint median intervals; overlapping results are marked `≈`; the score note names the shared-scenario count.                                                                       |

Version policy: every dependency is pinned to its npm `latest` dist-tag at the
time of the update. `@solidjs/signals` is the exception: its `latest` tag
points to `2.0.0-rc.0` (a stale release candidate with a new effect API) while
release candidates ship almost daily, so it stays on the newest stable release,
0.13.13, as the stable row. The 2.0 line is measured separately (below).
`@pravosleva/reactive-engine` has no stable release containing
`ReactiveEngineCore`; it follows its `latest` beta.

v3 and earlier logs are not comparable with v4: build mode, sample counts,
warmup, ordering and the cap rule all changed.

### Parallel measurement in CI

Parallelism runs on separate CI runner VMs, not on one machine.

| Source                                                                                                                                                                                                   | Finding                                                                                                                                                                                                                                                     | Decision                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Duet benchmarking (Bulej et al., ICPE 2020)](https://arxiv.org/abs/2001.05811)                                                                                                                          | Running two artifacts concurrently on one machine, with a start barrier, cancels shared cloud noise. It loses accuracy when the workloads differ in length (the shorter one's resources go idle) or in bottleneck, and SMT siblings and throttling skew it. | Not used for absolute rows: 24 libraries with very different durations and allocation profiles would interfere asymmetrically.          |
| [Laaber, Scheuner, Leitner (EMSE 2019)](https://research.chalmers.se/en/publication/511491)                                                                                                              | Cloud microbenchmark variability ranges from a CV of 0.03% to over 100%. Running test and control on the same instance, in randomized order, detects slowdowns of 10% or less with high confidence.                                                         | Shards split scenarios, never frameworks, so every per-scenario comparison is made on one VM, in rotated order.                         |
| [CodSpeed: benchmarks in CI without noise](https://codspeed.io/blog/benchmarks-in-ci-without-noise); [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | The same `ubuntu-latest` label lands on different CPUs (e.g. Intel Xeon 8370C, AMD EPYC 7763 / 9V74); GitHub documents vCPU counts, not CPU models.                                                                                                         | Every shard records its CPU; optional machine rounds measure each shard on several VMs and report the median and range across machines. |
| [pyperf system tuning](https://pyperf.readthedocs.io/en/latest/system.html); [Google Benchmark: reducing variance](https://github.com/google/benchmark/blob/main/docs/reducing_variance.md)              | CPU isolation, pinning, and disabling SMT and boost reduce variance on one host.                                                                                                                                                                            | Not applicable to hosted runners; recorded as a limitation.                                                                             |

`scripts/merge-shards.mjs` merges shard outputs only when they come from the
same commit, lockfile, bundle hash, Node/V8, package versions and sampling
policy, and when every machine round covers each scenario exactly once.
Per-scenario ratios therefore stay within one machine. The overall geometric
mean still combines ratios measured on different CPUs, so CPU-model effects on
relative speed remain possible; machine rounds expose them.

### Architectural families

v4 adds second generations next to their stable lines (npm aliases): Solid 2.0
RC (`solid-js`, `@solidjs/signals`) and Vue reactivity 3.6 RC, plus Dalien
Signals, Anod, Reatom 1001, Maverick Signals, Cellx and ReScript Signals, and
registers the original suite's `cellx1000`/`cellx2500` workloads. Adding them
surfaced problems that tests could not:

- The per-worker version manifests showed that the Vue 3.6 worker also bundled
  Vue 3.5 (a shared adapter module imported it). They also showed that the
  SolidJS 2 worker would have loaded `@solidjs/signals@0.13.13` at runtime: the
  package was external for diagnostic instrumentation, so solid-js 2's import
  of its own core resolved to the project's top-level 0.13 copy. Workers now
  bundle everything, and the build fails if a worker contains two versions of
  one package or leaves a package external.
- `solid-js` 2 resolves its `node` export condition to its non-reactive SSR
  build and no longer exports `./dist/*`; the client build is aliased by path.
- `dalien-signals@3.2.1`'s `reset()` fails on repeated rewinds of a
  populated graph; the adapter uses the library's default leak-free API.
- Reatom 1001 retains memory that grows with graph depth on dense DAGs and
  cannot complete the 32-layer graph rows in a 4 GB heap. Rather than letting
  one library abort the run, failures became results: classified `FAILED`
  rows, not ranked overall, while publication continues.

## Semantics v3

The v2 revision addressed the CI adapter failure and the five review questions.
The v3 revision completes value/delivery validation, lifecycle workloads,
tail sampling, and faster preparation and process startup.
Sources were consulted before implementation. Installed implementations were
also inspected at the versions in `pnpm-lock.yaml`; upstream documentation can
describe a different version.

## Sources and implications

| Primary source                                                                                                                 | Finding                                                                                                                                                                            | Benchmark decision                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [mitata: writing good benchmarks](https://github.com/evanwashere/mitata#writing-good-benchmarks)                               | Unobserved allocations can be eliminated; fixture parameters and GC policy affect measurement.                                                                                     | Return an array retaining all created nodes, keep the result in a blackhole sink, and validate outside timing.                                               |
| [Preact Signals](https://preactjs.com/guide/v10/signals/)                                                                      | Computeds evaluate on demand; reading an invalid computed inside a batch can pull dependencies before the batch ends.                                                              | Initialize every creation node, and read every update consumer after each changed write. Read large-graph sinks after the declared transaction commits.      |
| [Solid: batch](https://docs.solidjs.com/reference/reactive-utilities/batch)                                                    | Batch defers downstream work; reading during a batch may update a computation on demand.                                                                                           | Apply the same batch policy to every adapter.                                                                                                                |
| [S.js: freeze and data](https://github.com/adamhaile/S#sfreeze)                                                                | Freeze defers propagation; conflicting writes to a source within one freeze are unsupported.                                                                                       | A burst writes each source at most once. Reject bursts larger than the source count instead of giving S.js a special workload.                               |
| [lite-signal repository](https://github.com/PeshoVurtoleta/lite-signal), published `@zakkster/lite-signal@1.5.2` `Signal.d.ts` | Under `prealloc: "lazy"`, `maxNodes`/`maxLinks` are capacity ledgers and objects are constructed on demand. 1.5 validates the config and adds `createRoot`, which has no disposer. | Keep fresh lazy registries, a 262,144-node budget, and the throw policy. Ownership remains an effect, the unit of ownership the library documents.           |
| [Reflex repository](https://github.com/volynetstyle/Reflex), published `@volynets/reflex@3.0.1` README and types               | `signal` returns a readable accessor with `.set`; computed is a lazy accessor and SAB flushes effects after a batch.                                                               | Adapt the published accessor API. Check the exact npm tarball against the lockfile integrity rather than trusting a stale local build with the same version. |

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
Every duration is kept. (v3 used mitata 1.0.34 with trimming disabled and saved
samples sorted. v4 times invocations itself and saves them chronologically,
with the pilot and warmup stored separately.)

Equal-tail 95% intervals use binomial order-statistic bounds. Their coverage
interpretation assumes iid continuous samples; autocorrelation, JIT transitions,
and thermal changes limit that assumption. Percentiles describe a whole
workload invocation under the stated GC policy, not individual UI event latency.
Neither quick runs nor capped rows claim a p99.

### CI and reproducibility

CI runs the complete adapter/workload tests, builds dedicated workers once,
and verifies 23 isolated rows plus saved samples. Timing values are not pass/fail
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
  updates, and steady-state observed push rows (push rows still include effect
  installation in the timed section);
- recorded power/thermal conditions for published runs (package versions and
  per-shard CPU models are recorded since v4);
- an uncertainty interval for the overall geometric-mean score, not only per
  row;
- a dedicated benchmark host: shared CI runners make published numbers noisy,
  which `BENCH_ROUNDS` exposes but cannot remove.

Old logs cannot be recalculated into v4 measurements. Generate a complete fresh
run before publishing a new leaderboard.

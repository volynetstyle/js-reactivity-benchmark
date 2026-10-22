# JS Reactivity Benchmark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/volynetstyle/js-reactivity-benchmark/actions/workflows/main.yml/badge.svg)](https://github.com/volynetstyle/js-reactivity-benchmark/actions/workflows/main.yml)

[Results](index.html) ? [Benchmark semantics](SEMANTICS.md) ? [Contributing](CONTRIBUTING.md) ? [License](LICENSE)

Local benchmark harness for comparing JavaScript reactivity libraries as behavior profiles across several scenario types:

- classic propagation graphs
- computation creation and update tests
- larger static and dynamic dependency graphs

The project bundles the runner with `esbuild`, runs benchmarks under `node --expose-gc`, saves the raw log, and generates an HTML results page. Each framework/scenario pair runs in a fresh child process. The report ranks by relative geometric mean and shows per-test medians and capped status.

The current workload contract is **semantics v4**: v3's validated values,
effect delivery and native lifecycle workloads, plus production library builds,
exact dependency versions, interleaved run order, an order-independent cap,
time-budgeted chronological sampling, and a 95% interval for every median.
Compare runs with the same version and profile; v3 logs need a fresh run. See
[the research and decisions](docs/benchmark-methodology.md).

Measurement is centralized in [`src/util/benchmark.ts`](src/util/benchmark.ts). Each framework/scenario pair runs in a fresh worker process that loads only the selected library, bundled with `NODE_ENV=production`. Each invocation prepares its fixture, runs a full GC, then starts the clock; preparation, validation, cleanup, and reporting stay outside timing. No automatic batching or sample trimming is used. Creation fixtures stay fresh; explicitly warm static graphs restore an exact checkpoint between samples.

Every case starts with one validated cold pilot run, excluded from the score. Results slower than the adaptive performance ceiling (`max(1500 ms, 3x the fastest pilot of any framework for that scenario)`) are reported but skip repeated sampling and carry a `SLOW/CAPPED samples=1` marker. The decision waits until every framework's pilot is known, so it does not depend on run order. Override the policy with `BENCH_MIN_CEILING_MS` and `BENCH_MAX_SLOWDOWN`.

## Quick Start

Use the Node.js version in [`.nvmrc`](.nvmrc) (the one CI publishes with) and pnpm 10.
Keep `.nvmrc` pinned to an exact `major.minor.patch` release so every CI shard
uses the same Node/V8 runtime, regardless of the runner's cached versions.
All dependencies are pinned to exact versions, so `npm install` resolves the
same libraries as the lockfile; see [Dependency versions](#dependency-versions).

```bash
pnpm install
pnpm bench
```

To run only one framework locally, set `BENCH_FRAMEWORK`:

```bash
BENCH_FRAMEWORK=reflex pnpm bench
```

You can also pass a comma-separated list such as `BENCH_FRAMEWORK="reflex,alien-signals"`.

Use `BENCH_FILTER` to select scenario names by substring, for example
`BENCH_FILTER=Computations` or `BENCH_FILTER="dynamic/simple component"`.
Comma-separated filters select their union.
An unmatched selection fails. Use `pnpm build` followed by `pnpm run` for a
focused check; `pnpm bench` replaces the results page with the selected subset.

On Windows PowerShell:

```powershell
$env:BENCH_FRAMEWORK = "reflex,alien-signals"
pnpm bench
Remove-Item Env:BENCH_FRAMEWORK
```

The default `BENCH_PROFILE=quick` runs two validated warmup invocations, then
samples until both the case minimum (10; 6 for expensive graph/fan cases) and
250 ms of measured time are reached, with at most 100 samples
(`BENCH_MIN_TIME_MS`, `BENCH_MAX_SAMPLES`). `BENCH_PROFILE=tails` collects
exactly 1000 untrimmed samples per uncapped row after 20 warmup invocations.
`BENCH_SAMPLES` sets an exact count. p95 is reported at 200 samples and p99 at
1000, with 95% order-statistic intervals. These are workload-duration
distributions. Slow rows retain one pilot and cannot establish tails.

`BENCH_ROUNDS=3` repeats every row in three fresh processes and reports the
median of the round medians with their range. Use it for publication-grade
runs: it shows between-process variance that samples inside one process cannot.

For a focused tail run in PowerShell:

```powershell
$env:BENCH_PROFILE = "tails"
$env:BENCH_FRAMEWORK = "lite-signal"
$env:BENCH_FILTER = "molBench"
pnpm.cmd build
pnpm.cmd run run
```

CI executes `pnpm test`, `pnpm build`, and `pnpm bench:smoke`. The smoke
checks 97 isolated rows across all 24 adapters, with two samples per row, plus
production build mode, recorded package versions, and a real two-shard run
merged into one page; it is a correctness check, not a performance
publication. A static check and a runtime guard (`BENCH_ASSERT_NO_CONSOLE=1`)
reject console calls on the hot path.

### Parallel CI measurement

The Benchmarks workflow measures in parallel on separate runner VMs, then
merges the results. GitHub assigns different CPU models to different jobs, so
shards split **scenarios, never frameworks**: every framework of a scenario
runs on the same VM and each per-scenario comparison stays within one CPU
(the same-instance principle of Laaber et al. 2019 and duet benchmarking).

- `BENCH_SHARD=i/n` selects the i-th of n scenario shards. Scenarios are
  balanced by the measured cost in the committed samples file (longest first),
  deterministically, so every job computes the same partition.
- `machine_rounds` (workflow input) measures every shard again on other VMs.
  The merged score is then the median across machines, and the interval is
  their range, which exposes the hardware lottery instead of hiding it.
- [`scripts/merge-shards.mjs`](scripts/merge-shards.mjs) refuses to merge
  shards that differ in commit, lockfile, bundle hash, Node/V8, package
  versions, or sampling policy, or that cover scenarios incompletely or twice.
  The page lists every machine and the scenarios it measured.

Run a shard locally with, for example, `BENCH_SHARD=2/8 pnpm run run`, and merge
shard outputs (`<name>.log` + `<name>.samples.json` pairs) with
`node scripts/merge-shards.mjs <dir>`.

### Failures are results

A row that produces a wrong value, throws, crashes, runs out of memory,
overflows the stack, or exceeds `BENCH_ROW_TIMEOUT_MS` is recorded as a
`FAILED` row with its classified reason, and the run continues. Such a
framework is shown, but it is not ranked overall: scoring it only over the
scenarios it completed would rank it on an easier workload set. The run still
exits non-zero unless `BENCH_ALLOW_FAILURES=1`, which only the publication
workflow sets; tests and the smoke stay strict. For a complete local run that
includes libraries with known failures, use
`BENCH_ALLOW_FAILURES=1 pnpm bench`.

After the run, these files are updated:

- `bench-results/latest.log` - raw runner output
- `bench-results/latest.samples.json` - all timing samples, pilots, statistics, and validation status
- `index.html` - generated summary page with rankings and per-test comparisons

If you already have a log and only want to rebuild the results page:

```bash
pnpm results:page
```

## Scripts

- `pnpm test` - run `vitest`
- `pnpm build` - bundle `src/index.ts` into `dist/`
- `pnpm run` - execute the built runner with `node --expose-gc`
- `pnpm bench` - build, run benchmarks, save `bench-results/latest.log`, and refresh `index.html`
- `pnpm results:page` - rebuild `index.html` from an existing log
- `pnpm bench:smoke` - verify the built workers, their correctness gates, and a sharded run
- `node scripts/merge-shards.mjs <dir>` - merge CI shard outputs into one log, samples file and page

## What Gets Measured

The current default run includes several benchmark groups. They are classified by workload family instead of being treated as one flat race:

- `creation` - allocation, initial evaluation, and dependency tracking
- `update` - changed source writes followed by reads of every computed consumer
- `pull` - dirty reads, aggregation, and chain pulls
- `push` - fan-out propagation and effect delivery
- `dynamic` - branch switching, dependency cleanup, and retracking
- `large_graph` - scaling behavior on larger DAGs
- `baseline` - historical propagation scenarios such as `diamond`, `mux`, and `triangle`, plus the `cellx1000`/`cellx2500` layer workloads of the original suite

The `dynamicBench` set now also includes several more app-like presets such as
`dashboard selective reads`, `editor derived state`, `kanban board`, and
`entity detail page`. These use the same rectangular graph generator, but with
more moderate widths/depths and partial leaf reads to better resemble common UI
workloads.

The larger graph benchmark parameters are defined in [src/config.ts](src/config.ts).

The semantics and interpretation rules are documented in [SEMANTICS.md](SEMANTICS.md). Read that file before treating results as comparable across libraries.

## Reported Metrics

The primary `time` is the median of measured samples (the median of round
medians with `BENCH_ROUNDS`), excluding the pilot unless the row is capped.
Each row carries `median_ci95`, a distribution-free 95% interval for the median
(6+ samples), or `round_range` for multi-round runs. Expanded output includes
p95/p99 when supported, CV, group, family, and counters. The log header records
the semantics version, sampling policy, runtime, machine, GC, isolation, run
order, build mode, and diagnostic mode; a `# package` line per framework records
the exact library versions bundled into its worker.

Every observed duration is preserved, in chronological order, with the pilot and
warmup stored separately. `pnpm run run` saves
`bench-results/last-run.samples.json`; `BENCH_SAMPLES_FILE` chooses another path.

The HTML leaderboard uses:

```txt
r(L, test) = median_time(L, test) / best_median_time(test)
score(L) = geometric_mean(r(L, tests))
```

Lower is better. The score weights each included scenario equally; use per-row
results to assess a particular application. Capped rows have only one sample.
Overall scores use the same scenario intersection for every framework.
Lifecycle is compared within its supported group; unsupported ownership is
absent, never a fabricated zero. In per-test cards a `≈` marks a result whose
median interval overlaps the leader's; a scenario counts as a win only when the
leader's interval lies entirely below the runner-up's.

## Dependency versions

Every dependency is pinned exactly to its npm `latest` dist-tag at the time of
the update. Second generations are measured next to the stable lines through
npm aliases: `solid-js-2`, `solid-signals-2` (2.0.0-rc.17) and
`vue-reactivity-3.6` (3.6.0-rc.12). The stable `@solidjs/signals` row stays on
0.13.13, because that package's `latest` tag points at a stale 2.0 release
candidate. Update a library deliberately, run the
full suite, and publish a fresh run; the page lists the measured versions.

Graph topology uses a vendored copy of the `random@5.4.1` generator
([`src/util/seededRandom.ts`](src/util/seededRandom.ts)). The expected sums
depend on its exact sequence, and `random@5.5` changed that sequence.

## Framework Adapters

The repository contains adapters for:

- Reflex
- Alien Signals
- Dalien Signals (alien-signals over an `Int32Array` arena)
- [Reactive Engine](https://github.com/garage-13/reactive-engine) (synchronous graph core)
- Anod (async-native, explicit dependency reads)
- Reatom (`@reatom/core` 1001)
- Maverick Signals
- Cellx
- ReScript Signals
- Angular Signals
- MobX
- mol_wire
- Oby
- Preact Signals (`@preact/signals-core`)
- Reactively
- S.js
- Signia
- Solid 1.9 and Solid 2.0 RC
- @solidjs/signals 0.13 and 2.0 RC
- Svelte
- TC39 Signals Proposal polyfill
- Tansu
- uSignal
- Vue Reactivity 3.5 and 3.6 RC
- Compostate
- Valtio
- Kairo
- Lite Signal

The list of adapters enabled in the default run is defined in [src/config.ts](src/config.ts).

`Svelte`, `TC39 Signals Proposal polyfill`, and `Angular Signals` are currently disabled from the default benchmark set because it was too slow for the current suite, especially once the larger graph scenarios were added.

## Artifacts

- [README.md](README.md)
- [SEMANTICS.md](SEMANTICS.md)
- [index.html](index.html)
- [bench-results/latest.log](bench-results/latest.log)
- [bench-results/history](bench-results/history)

`index.html` is generated by [scripts/render-results-page.mjs](scripts/render-results-page.mjs) from the CSV-like text output produced by the benchmark runner.

## Structure

- [src/index.ts](src/index.ts) - runner entry point
- [src/config.ts](src/config.ts) - active framework list and large-graph test configuration
- [src/util/benchmark.ts](src/util/benchmark.ts) - registration, run order, worker isolation, sampling, GC, validation, capping, and reporting
- [src/util/seededRandom.ts](src/util/seededRandom.ts) - vendored deterministic generator behind every graph topology and expected sum
- [scripts/bench-and-update.mjs](scripts/bench-and-update.mjs) - full benchmark-and-refresh pipeline
- [scripts/render-results-page.mjs](scripts/render-results-page.mjs) - log parser and profile-oriented HTML report generator
- [src/frameworks.test.ts](src/frameworks.test.ts) - adapter sanity checks with `vitest`

## Notes

- Some adapters are disabled because parts of the suite currently hang or are incompatible. The reasons are documented inline in [src/config.ts](src/config.ts) and [src/index.ts](src/index.ts).
- `bench-results/latest.log` and `index.html` always reflect the last local run. If the active framework list changed, those artifacts may still describe an older run until you execute `pnpm bench` again.

## Credits

Based on the original idea and structure from [milomg/js-reactivity-benchmark](https://github.com/milomg/js-reactivity-benchmark).

Maintained by [Andrii Volynets](https://github.com/volynetstyle). This repository adapts the original benchmark with additional adapters, workloads, centralized measurement, and HTML reporting.

## License and Reuse

This repository is licensed under the [MIT License](LICENSE). You may use, modify, and redistribute its benchmark code, workloads, and runner, including in a public repository and for commercial purposes, subject to the license terms. Include the copyright notice and full permission notice in all copies or substantial portions of the software.

A link back to this repository and a description of your changes are appreciated. Keep existing third-party notices when reusing code. The reactive libraries and other dependencies retain their own licenses.

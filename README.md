# JS Reactivity Benchmark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/volynetstyle/js-reactivity-benchmark/actions/workflows/main.yml/badge.svg)](https://github.com/volynetstyle/js-reactivity-benchmark/actions/workflows/main.yml)

[Results](index.html) ? [Benchmark semantics](SEMANTICS.md) ? [Contributing](CONTRIBUTING.md) ? [License](LICENSE)

Local benchmark harness for comparing JavaScript reactivity libraries as behavior profiles across several scenario types:

- classic propagation graphs
- computation creation and update tests
- larger static and dynamic dependency graphs

The project bundles the runner with `esbuild`, runs benchmarks under `node --expose-gc`, saves the raw log, and generates an HTML results page. The report ranks by relative geometric mean and keeps per-test medians, p95/p99 tails, and workload families visible.

Measurement is centralized in [`src/util/benchmark.ts`](src/util/benchmark.ts) and powered by `mitata`. Scenario files only declare fixture setup, the measured operation, and optional validation/reporting. Setup runs outside the timed section, samples do not use mitata's automatic batching, and garbage collection policy is applied consistently by the runner. Regular cases use five samples; expensive dynamic graph cases use three.

Every case starts with one real pilot run. Results slower than the adaptive performance ceiling (`max(1500 ms, 3x the fastest pilot for that scenario)`) are reported honestly but skip repeated sampling and carry a `SLOW/CAPPED samples=1` marker. Override the policy with `BENCH_MIN_CEILING_MS` and `BENCH_MAX_SLOWDOWN`.

## Quick Start

Use a current Node.js LTS release and pnpm 9 (the version used in CI).

```bash
pnpm install
pnpm bench
```

To run only one framework locally, set `BENCH_FRAMEWORK`:

```bash
BENCH_FRAMEWORK=reflex pnpm bench
```

You can also pass a comma-separated list such as `BENCH_FRAMEWORK="reflex,alien-signals"`.

On Windows PowerShell:

```powershell
$env:BENCH_FRAMEWORK = "reflex,alien-signals"
pnpm bench
Remove-Item Env:BENCH_FRAMEWORK
```

Regular cases collect five samples; expensive dynamic graph cases collect three. Slow cases may be capped after the pilot run. `BENCH_RUNS` is not supported by the current runner.

After the run, these files are updated:

- `bench-results/latest.log` - raw runner output
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

## What Gets Measured

The current default run includes several benchmark groups. They are classified by workload family instead of being treated as one flat race:

- `creation` - signal/computed allocation and setup cost
- `update` - stable graph writes and invalidation hot paths
- `pull` - dirty reads, aggregation, and chain pulls
- `push` - fan-out propagation and effect delivery
- `dynamic` - branch switching, dependency cleanup, and retracking
- `large_graph` - scaling behavior on larger DAGs
- `baseline` - historical propagation scenarios such as `diamond`, `mux`, and `triangle`

The `dynamicBench` set now also includes several more app-like presets such as
`dashboard selective reads`, `editor derived state`, `kanban board`, and
`entity detail page`. These use the same rectangular graph generator, but with
more moderate widths/depths and partial leaf reads to better resemble common UI
workloads.

The larger graph benchmark parameters are defined in [src/config.ts](src/config.ts).

The semantics and interpretation rules are documented in [SEMANTICS.md](SEMANTICS.md). Read that file before treating results as comparable across libraries.

## Reported Metrics

Rows use the per-case sample counts described above. The primary terminal `time` column is the median, not the fastest run. Rows also emit:

- `p95` and `p99` - tail latency for jitter/outliers
- `cv` - coefficient of variation for stability
- `group` and `family` - workload taxonomy
- benchmark-specific counters such as recomputation, traversal, or checksum data

The HTML leaderboard uses:

```txt
r(L, test) = median_time(L, test) / best_median_time(test)
score(L) = geometric_mean(r(L, tests))
```

Lower is better. A profile score is more honest than an arithmetic average because a catastrophic slowdown in one workload family is harder to hide.

## Framework Adapters

The repository contains adapters for:

- Reflex
- Alien Signals
- Angular Signals
- MobX
- mol_wire
- Oby
- Preact Signals
- Reactively
- S.js
- Signia
- Solid
- @solidjs/signals
- Svelte
- TC39 Signals Proposal polyfill
- Tansu
- uSignal
- Vue Reactivity
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
- [src/util/benchmark.ts](src/util/benchmark.ts) - centralized mitata registration, sampling, GC, validation, and reporting
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

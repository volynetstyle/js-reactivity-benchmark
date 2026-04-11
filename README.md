# JS Reactivity Benchmark

Small benchmark harness for comparing JavaScript reactivity libraries across static and dynamic dependency scenarios.

The project can:

- build the benchmark bundle with `esbuild`
- run tests with forced garbage collection enabled
- save raw benchmark output to `bench-results/latest.log`
- generate an HTML results page at `index.html`

## Quick Start

```bash
pnpm install
pnpm bench
```

After a run, these artifacts are updated:

- `bench-results/latest.log` - raw benchmark output
- `index.html` - generated summary page with rankings and per-test comparisons

If you only want to rebuild the page from an existing log:

```bash
pnpm results:page
```

## Scripts

- `pnpm test` - run `vitest`
- `pnpm build` - bundle `src/index.ts` into `dist/`
- `pnpm run` - execute the built benchmark with `node --expose-gc`
- `pnpm bench` - build, run benchmarks, save `bench-results/latest.log`, and refresh `index.html`
- `pnpm results:page` - regenerate `index.html` from the saved benchmark log

## What Gets Measured

The suite includes several groups of tests:

- classic propagation scenarios such as `diamond`, `triangle`, and `broadPropagation`
- computation creation and update tests
- larger dependency-graph scenarios such as `simple component`, `dynamic component`, `large web app`, `wide dense`, `deep`, and `very dynamic`

The app-style benchmark parameters are defined in [src/config.ts](/d:/PersonalProjects/js-reactivity-benchmark/src/config.ts).

## Framework Adapters

The repository contains adapters for multiple reactive libraries, including:

- Reflex
- Alien Signals
- Reactively
- Solid
- Angular Signals
- MobX
- mol_wire
- Oby
- Preact Signals
- S.js
- Signia
- Svelte
- TC39 Signals Proposal polyfill
- Tansu
- uSignal
- Vue Reactivity
- Compostate
- Valtio

Not every adapter is enabled in the default run. The currently active framework list is defined in [src/config.ts](/d:/PersonalProjects/js-reactivity-benchmark/src/config.ts).

## Artifacts

- [README.md](/d:/PersonalProjects/js-reactivity-benchmark/README.md)
- [index.html](/d:/PersonalProjects/js-reactivity-benchmark/index.html)
- [compare.html](/d:/PersonalProjects/js-reactivity-benchmark/compare.html)
- [bench-results/latest.log](/d:/PersonalProjects/js-reactivity-benchmark/bench-results/latest.log)
- [results.png](/d:/PersonalProjects/js-reactivity-benchmark/results.png)

## Current State

Results in this folder are generated locally from `bench-results/latest.log`, and `index.html` shows average execution time across all parsed tests for each framework. If you want to document a specific machine, Node version, or benchmark date in the README, it is best to do that after the next full benchmark run.

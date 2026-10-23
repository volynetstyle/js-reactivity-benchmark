# Production environment

This project runs finite Node.js benchmark jobs and generates a static results
page. It does not need an HTTP server or an application port. GitHub Pages
continues to publish the generated `index.html` and `bench-results/` artifacts.

## Build and validate

Use the exact Node.js version from `.nvmrc` (24.15.0) for comparable measurements;
`node scripts/check-runtime.mjs` verifies it, and the Benchmarks workflow runs it
on every shard and on the merged result. The generated JavaScript targets
Node.js 22 and later, which CI checks on Node.js 22, 24 and 26: that is a
compatibility matrix, never a source of published numbers. `package.json` pins
pnpm 10.22.0; all dependencies, including TypeScript, have exact versions.

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm check
```

`pnpm-workspace.yaml` permits only the explicitly pinned versions of six
libraries listed as peers by cellx's own benchmark tooling. It does not replace
their installed versions or broaden compatibility for other dependencies.
Each worker's package manifest still verifies which versions it measures.
Only esbuild is allowed to run dependency build scripts.

`pnpm typecheck` checks every TypeScript source file, including disabled legacy
adapters. `skipLibCheck` skips third-party declaration checking; adapter calls
remain strictly checked. Vue's shared adapter uses the public structure common
to both supported generations instead of their different internal node types.

The build explicitly enables esbuild's `production` export condition, retains
its `module` condition, defines `process.env.NODE_ENV` as `production` and sets
the actual environment before dependencies initialize. It removes whitespace
and unused exports while retaining identifier names for useful profiles.
External source maps remain available. See the official documentation for
[conditions](https://esbuild.github.io/api/#conditions),
[minification](https://esbuild.github.io/api/#minify) and
[targets](https://esbuild.github.io/api/#target).

The runner and every worker reject development entry points, bundled test files
and unresolved runtime packages. Each worker additionally rejects two bundled
versions of one package. `dist/package.json` declares CommonJS so the
distribution remains runnable inside a parent project that uses ES modules.
Build paths and aliases are resolved relative to the repository, not the shell's
working directory.

## Standalone execution

Copy the complete `dist/` directory to a machine with the chosen Node.js runtime:

```sh
node --expose-gc dist/index.js
```

No `node_modules`, source files, tests or package manager are needed for ordinary
measurements. The `BENCH_INSTRUMENT=1` diagnostic mode evaluates an instrumented
copy of an installed package and therefore needs a full development checkout.
`BENCH_IN_PROCESS=1` remains available as a diagnostic mode; default measurements
continue to use a fresh process for each row.

From a checkout, `pnpm start` and `pnpm run run` execute the built runner.
`pnpm bench` builds and also updates the log and HTML report. A standalone run
writes raw samples to `bench-results/last-run.samples.json` by default; its
working directory must be writable. Set `BENCH_SAMPLES_FILE` to select another
output location.

For a short selection in PowerShell:

```powershell
$env:BENCH_FRAMEWORK = "reflex,alien-signals"
$env:BENCH_FILTER = "mux"
pnpm.cmd start
Remove-Item Env:BENCH_FRAMEWORK, Env:BENCH_FILTER
```

`pnpm verify:production` copies only `dist/` into an OS temporary directory and
runs one checked scenario for all 29 frameworks. It starts from
`NODE_ENV=development` and checks that the runner establishes the actual
production environment. CI runs this after the adapter smoke tests and
the real two-shard merge check. Temporary verification outputs are removed.

## Container execution

The multi-stage Dockerfile installs and checks dependencies in the build stage.
The runtime stage contains Node.js and `dist/` and runs as the unprivileged
`node` user. Tests, source and `node_modules` are excluded from the runtime image.

```sh
docker build -t js-reactivity-benchmark .
docker run --rm \
  -e BENCH_FRAMEWORK=reflex,alien-signals \
  -e BENCH_FILTER=mux \
  js-reactivity-benchmark
```

Mount a writable directory at `/app/bench-results` to retain samples, or capture
standard output for the raw log. Keep the Docker `NODE_VERSION` build argument
aligned with `.nvmrc`. Compare results using the same host/container setup and
record CPU limits, Node.js version and benchmark options with the results.

## Performance changes

The harness reuses batch callbacks in repeated updates, skips copying and random
selection for full-drain graph reads, and avoids duplicate source arrays for
dynamic graph nodes. Numerical validation derives each source's last write
directly and no longer allocates an input array for every oracle node.
Single-round summaries reuse the worker's existing statistics.

A local before/after check on Node.js 25.2.0 used a 128-source rectangular graph,
8 layers, fan-in 3, 50% static nodes and 10,000 writes. After 7 warmups, the median
of 15 invocations preparing 200 oracle results fell from 25.19 ms to 9.61 ms
(about 2.6 times faster). The production runner shrank from 1,210,109 to 838,202
bytes (about 31%). These are local harness observations;
they do not establish new library rankings. Rerun scored benchmarks after
changing harness code. Workload checksums, write counts, batch boundaries and
observation policies remain covered by the contract tests.

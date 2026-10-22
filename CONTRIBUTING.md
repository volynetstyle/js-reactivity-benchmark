# Contributing

Issues and pull requests for new adapters, workloads, correctness fixes, and
reporting improvements are welcome.

## Local Setup

Use the Node.js version in `.nvmrc` and pnpm 10, then run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Adapters and Workloads

Read [SEMANTICS.md](SEMANTICS.md) and the adapter contract in
[src/util/reactiveFramework.ts](src/util/reactiveFramework.ts) before making
changes. Add adapters under `src/frameworks/` and register enabled adapters in
[src/config.ts](src/config.ts) and, in the same order,
[src/frameworkCatalog.json](src/frameworkCatalog.json) (one isolated worker per
entry). Pin the library to an exact version; measure another generation of a
library through an npm alias with a shared adapter factory that does not
import any library itself. Document semantic differences and limitations;
include correctness checks appropriate to the change.

`pnpm build` rejects a worker that bundles a development build, contains two
versions of one package, or leaves a package to be resolved at runtime. Check
`dist/workers/<id>.packages.json`: it must list exactly the library and version
the adapter's name claims.

Keep fixture setup outside measured operations and use the centralized runner in
[src/util/benchmark.ts](src/util/benchmark.ts) for measurement.

## Reporting Results

Include the commit, library versions, runtime version, operating system, CPU,
selected frameworks, and relevant environment variables when sharing results.
Attach raw logs and explain changes to workloads or adapter behavior.

`pnpm bench` updates `bench-results/latest.log` and `index.html`. Include generated
results in a pull request only when they are relevant, and state how they were
produced. Avoid drawing conclusions from runs with different configurations.

## Pull Requests

Describe the problem, the resulting behavior, and how you validated the change.
Run `pnpm test` and `pnpm build` for code changes. For report generator changes,
the same `pnpm test` run covers `scripts/render-results-page.test.mjs`.

Preserve existing attribution and third-party notices. Contributions are provided
under the repository's [MIT License](LICENSE).

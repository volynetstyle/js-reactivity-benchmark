# Contributing

Issues and pull requests for new adapters, workloads, correctness fixes, and
reporting improvements are welcome.

## Local Setup

Use a current Node.js LTS release and pnpm 9, then run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Adapters and Workloads

Read [SEMANTICS.md](SEMANTICS.md) and the adapter contract in
[src/util/reactiveFramework.ts](src/util/reactiveFramework.ts) before making
changes. Add adapters under `src/frameworks/` and register enabled adapters in
[src/config.ts](src/config.ts). Document semantic differences and limitations;
include correctness checks appropriate to the change.

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
also run `node --test scripts/render-results-page.test.mjs`.

Preserve existing attribution and third-party notices. Contributions are provided
under the repository's [MIT License](LICENSE).

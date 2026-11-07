# Semantic application gauntlet

These are executable application-shaped checks of the installed
`reflex-quant`, separate from the timed benchmarks. The suite passed all 12
checks with version 1.1.1. Strict assertions are disabled in the normal test
run so a library behavior change does not fail CI. To opt in, run:

```sh
SEMANTIC_GAUNTLET_STRICT=1 pnpm exec vitest run tests/semantic-gauntlet/quant.test.ts
```

In PowerShell, set `$env:SEMANTIC_GAUNTLET_STRICT = "1"` before running the
command (without the leading assignment), then remove it with
`Remove-Item Env:SEMANTIC_GAUNTLET_STRICT`.

They exercise a workflow editor (dynamic routing, repeated endpoint reads,
cutoff, selection and batched drag), a resource handoff whose later dependency
fails validation, compiler branch failure and recovery, and a combined live-edit
and render lifecycle. Additional cases cover effect recovery, disposal, an ABA
batch, 10,000 failed/recovered computations and a 3,000-node projection chain.
The resource is an in-memory event log; this suite makes no network connections
and does not measure performance or memory bounds.

## Observed differences from the proposed contract

Two proposed contract checks are marked as expected failures only when the
installed package is version 1.0.0. On other versions they run as ordinary
assertions. The 1.0.0 observations are:

- A normalizer which reads its selection, writes a fallback and rereads it did
  not run again to observe the fallback. The written selection was visible.
- If the first synchronous effect execution throws after reading a signal,
  `effect()` throws without returning a handle. Writing the signal invokes the
  effect again and throws again. A first execution deferred by `batch()` does
  return a handle before the batch drains; disposing that handle prevents later
  executions.

Both proposed contract checks pass with version 1.1.1 under this test runner.
The observations above apply to 1.0.0 and do not establish behavior in other
versions.

## Scope

This is an initial Quant-only gauntlet, not a comparative compatibility report.
The benchmark adapter's effect signature drops cleanup callbacks and its batch
and scheduling policies differ between libraries, so running these checks through
that interface would not faithfully test resource and failure semantics. Native
per-library harnesses and explicit classifications of unsupported semantics,
different semantics and demonstrated bugs are required before making competitor
claims. The combined case is a focused composition, not the full proposed
19-phase maximal witness. In particular, it does not test disposal during
validation, cleanup failure, or structural memory bounds; the deep-chain and
recovery checks do not establish those properties.

## Cross-library run

`node scripts/semantic-gauntlet/compare.mjs --output bench-results/semantic-gauntlet.json`
executes the same four application scenarios with Quant, Preact Signals Core,
Alien Signals, Vue Reactivity 3.5 and 3.6 RC, MobX and SolidJS. Each
library/scenario pair runs in a separate Node process with a ten-second timeout.
The JSON records each checkpoint's actual and expected values, exceptions,
stderr, package version and exit status. The script reports matches, differences, exceptions, crashes and timeouts as
data and exits successfully for those library outcomes. A failure to write the
report or start the harness itself can still fail the command. The ordinary CI
tests exercise result classification with synthetic inputs; they do not assert
that a library matches the proposed contract. This is a behavioral comparison,
not a timed benchmark or a general conformance ranking.

The recorded run used Node 25.2.0 and the lockfile versions below. Cells show
checkpoints matching this suite's Quant-oriented expectations. Later checkpoints
can depend on earlier ones, so the counts are not independent bug counts.

| Runtime                     | Workflow / 10 | Handoff / 5 | Compiler / 8 | Combined / 8 |
| --------------------------- | ------------: | ----------: | -----------: | -----------: |
| reflex-quant 1.1.1          |            10 |           5 |            8 |            8 |
| @preact/signals-core 1.14.5 |            10 |           4 |            7 |            7 |
| alien-signals 3.2.1         |             9 |           2 |            6 |            4 |
| @vue/reactivity 3.5.45      |             9 |           4 |            6 |            7 |
| @vue/reactivity 3.6.0-rc.14 |             9 |           2 |            6 |            4 |
| mobx 7.1.5                  |            10 |           3 |            7 |            6 |
| solid-js 1.9.18             |            10 |           3 |            6 |            5 |

The observations behind the mismatches are more useful than the totals:

- Preact closes the old resource before the failing dependency is validated;
  the repaired input creates the new resource. Its second failed compiler read
  rethrows without re-executing the computation.
- Alien and both Vue versions do not rerun the self-writing normalizer in the
  workflow. In the compiler fixture their second read returns the previous `A`
  after the first new-branch read threw. Alien and Vue 3.6 RC do not reconnect
  in the handoff fixture after repair; Vue 3.5 does.
- MobX's default reaction error handling reports the failure instead of
  propagating it to the write, and the explicit cleanup closes the resource
  before the failing read. Its repaired handoff does reconnect. Its second failed
  compiler read rethrows without re-executing the computation.
- Solid's memo evaluates on the branch write, so that write throws; the later
  write to the obsolete backend also throws in this particular sequence. The
  handoff does not reconnect after repair in this fixture.

The Vue low-level package has no public batch primitive: the harness uses an
explicit effect queue and dirty check, like the repository's Vue benchmark
adapter. The queue's behavior after exceptions is part of this measurement, so
these outcomes do not automatically describe Vue component watchers. MobX
`autorun` has no returned-cleanup contract; the harness explicitly runs the
previous cleanup before the reaction body and on disposal, with default error
boundaries and `enforceActions: "never"`. Solid uses synchronous render effects,
roots and `onCleanup`; memo evaluation is eager. Other frameworks use their
native effect cleanup and batching. These are adapter and API choices, not
proof that an application cannot implement different behavior using other
primitives. The run covers the four application scenarios; the other Quant-only
stress and lifecycle checks are not included in this comparison. Angular and
Svelte are also not included in this synchronous low-level harness.

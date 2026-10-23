# Rechecking disabled adapters — 2026-10-23

The seven installed but disabled libraries were checked against npm dist-tags,
the source and declarations shipped in their exact packages, and upstream
documentation. Five are now enabled in both `src/config.ts` and the isolated
worker catalog. Existing published timing artifacts were not regenerated.

| Library | Installed version after review | Decision |
| --- | --- | --- |
| MobX | 7.1.0 (`latest`, already installed) | Enabled with native `keepAlive: true` computeds |
| Svelte | 5.57.2 (`latest`, already installed) | Enabled using private client runtime primitives |
| Angular core | 22.2.3 (`latest`, already installed) | Enabled with the low-level Watch primitive |
| signal-polyfill | 0.2.2 (`latest`, already installed) | Enabled with an adapter effect scheduler |
| Kairo | **0.8.0-alpha.2** (`alpha`, upgraded from 0.6.0-rc.0) | Enabled and labeled `kairo 0.8 alpha` |
| Compostate | 1.0.0 (`latest`, already installed) | Adapter repaired; excluded for deep shared-path invalidation cost |
| Valtio | 2.3.2 (`latest`, already installed), plus **valtio-reactive 0.2.0** | Adapter migrated; excluded for transient effect values |

## Restored integrations

**MobX.** The historical [issue #3926](https://github.com/mobxjs/mobx/issues/3926)
was closed after identifying unobserved computed cache suspension. The
[computed documentation](https://mobx.js.org/computeds.html) describes both
this default and the native `keepAlive` option. This adapter deliberately uses
`keepAlive: true` for observer-free pull graphs. This is a benchmark policy,
with native retention costs, rather than MobX's default behavior. No synthetic
memo cache or owner disposal is added. Shallow boxes preserve object identity;
`enforceActions: "never"` allows the harness's standalone fixture writes;
`runInAction` still batches updates. Autorun returns its native disposer.

**Svelte.** Sources use runtime `state`, `get`, `set`, and `derived`. `withBuild`
constructs derivations inside an effect root, matching runtime ownership in
compiled components. The effect wrapper discards callback return values, and
creates an individual root only outside an existing adapter scope. Nested roots
are independent in Svelte, so observations within `createScope` attach directly
to that scope. Native root destruction then actually detaches observations.
The outermost `withBatch` drains `flush` in `finally`.
These are [private runtime APIs](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/reactivity/effects.js),
not a measurement of compilation, DOM work, or component rendering.

**Angular.** Public `signal` and `computed` are combined with
[`createWatch`](https://github.com/angular/angular/blob/main/packages/core/primitives/signals/src/watch.ts).
Each observer runs initially, queues into a Set on invalidation, and exposes a
disposer that removes pending work and calls `destroy()`. A depth counter and
`finally` defer draining to the outer commit, including throwing callbacks.
This measures the reactive primitive without Angular dependency injection.

**TC39 polyfill.** The
[official README](https://github.com/proposal-signals/signal-polyfill#creating-a-simple-effect)
explicitly leaves effects and scheduling to consumers. The adapter uses native
State/Computed and Watcher, drains pending computeds at the outer commit, and
retains a microtask fallback for standalone writes. Disposing an observer
unwatches its computed. Callback results are ignored, rather than interpreted
as cleanups by an extra adapter convention.

**Kairo.** Version 0.6 RC fails the independent dynamic graph oracle and the
`editor derived state` workload (1968065610 instead of 1968220290 in the
diagnostic run). The newer alpha uses explicit dependency reads. Its shipped
README and declarations, linked from the [upstream project](https://github.com/3Shain/kairo),
specify `mutable`, `.current`, `computed($ => ...)`, `Reaction.track`, and
`Reaction.dispose`. The adapter preserves and restores the current Track
function in `finally`; it does not replace Kairo's dependency engine.
The alpha passes the independent oracle across graph families and transaction/
read policies. Exact minimal pull counts are not asserted. No native graph
owner is claimed.

## Remaining exclusions

**Compostate.** The current adapter uses native `atom`, `computed`, `syncEffect`,
`batch`, and `batchCleanup`. `atom` also permits literal function values without
the updater interpretation of `signal`'s setter. `batchCleanup` is a real native
graph cleanup boundary, contrary to the previous adapter comment.
The [API documentation](https://github.com/lxsmnsyc/compostate/blob/main/docs/api.md)
and shipped `dist/reactivity-CsFkomfN.js` were checked. Its `notifyTrackers`
recursively follows every downstream path without stopping at an already
invalidated tracker. On the cellx shared graph this grows exponentially. One
local diagnostic update took approximately 16 ms at 16 layers and 6.5 seconds
at 32 layers; the 64-layer case was stopped. These are diagnostic observations,
not comparative benchmark results. The suite uses 1000 and 2500 layers.
The shallow eight-layer regression checks values against arithmetic independent
of Compostate, and checks native scope disposal. Changing the library's
invalidation algorithm inside an adapter would measure a fork.

**Valtio.** The [historical discussion](https://github.com/pmndrs/valtio/discussions/949)
now points to [valtio-reactive](https://github.com/valtiojs/valtio-reactive).
The old `watch` is deprecated in Valtio's shipped source. The adapter now uses
the companion's native computed/effect/batch, with a guard against inner-batch
flushes and `ref` for signal object replacement semantics. Nevertheless, two
source writes in a batched diamond produce `[8, 12, 18]`, while the active
contract requires `[8, 18]`. Companion `core.ts` drains source callbacks after
popping the batch; downstream computed writes can therefore trigger effects
before sibling branches settle. The expected-failure test exercises the actual
contract; an upstream fix makes it unexpectedly pass and prompts re-review.
No second propagation engine is added to hide this native behavior.

**Ripple comment.** There is no `rippleFramework` adapter, import, or dependency
in this checkout. The comment was already dangling when Reflex was introduced
in commit `8120fc2`. It was removed instead of selecting an unrelated npm
package based only on a name.

## Verification and stress limits

The shared adapter, observed workload, and independent graph oracle tests cover
all 29 active rows. CI smoke now additionally runs mux, mutable-object molBench,
cellx1000, pure pull, and supported native lifecycle rows for the restored
adapters. Production verification runs the standalone bundles without the
repository's node_modules.

Final local verification: TypeScript passed; 1040 tests passed with one
expected Valtio failure; the production build produced 29 workers; smoke
validated 123 isolated rows plus 15 merged rows from two shards; standalone
production verification passed for all 29 frameworks. Local diagnostics used
Node.js 25.2.0 on Windows. They are not a publication run under the release
pinned in `.nvmrc`.

Targeted production diagnostics also exercised cellx2500, pure push, editor
derived state and a warm layered DAG. The restored libraries produce correct
values on completed rows. Large stress rows can still exceed time limits:
Svelte and Kairo alpha exceeded shortened diagnostic budgets on the editor and
layered DAG cases. A timeout is retained as a failed row, never as a performance
sample or a reason to exclude a whole library. The default runner's 180-second
row timeout was not changed. One-sample diagnostics establish compatibility,
not ranking-quality timing distributions.

Run the regular verification with:

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd bench:smoke
pnpm.cmd verify:production
```

To inspect a particular stress case without refreshing published artifacts:

```powershell
$env:BENCH_FRAMEWORK = 'MobX,Svelte v5,TC39 Signals Polyfill,@angular/signals,kairo 0.8 alpha'
$env:BENCH_FILTER = 'cellx2500,dynamic/editor derived state,dynamic/layered full-drain warm'
$env:BENCH_PROFILE = 'quick'
$env:BENCH_SAMPLES = '1'
$env:BENCH_SAMPLES_FILE = 'tmp/adapter-recheck.samples.json'
node --expose-gc dist/index.js
```

# Adapter audit

Reviewed against the exact installed versions in `package.json` and
`pnpm-lock.yaml`. The active comparison consists of the 24 entries in
[`frameworkCatalog.json`](../src/frameworkCatalog.json); tests verify that it
matches [`config.ts`](../src/config.ts). Upstream links and author credits for
every integration, including inactive ones, are in the
[README](../README.md#framework-adapters).

## What is comparable

Each adapter exposes the same source/read/write/computed/effect operations.
Effects install synchronously once, and writes in a benchmark transaction are
delivered by the end of `withBatch`. Nested batches commit at their outermost
boundary. Workloads use numeric values and, in the mutable-object group, object
values; they do not attempt to normalize function-valued signals, writes from
effects, or each library's error-recovery semantics. In particular, S.js value
signals reject conflicting writes to the same source in one frozen transaction;
the harness must not silently replace that rule with last-write-wins behavior.
S.js 0.4.9 drops root disposal queued before a frozen transaction starts
propagating (`run()` resets its disposal queue). Disposal must be requested
again outside that transaction. The regression test records this native
limitation; the lifecycle benchmarks already dispose scopes outside transactions.

Native equality, lazy/eager computation, dependency tracking, ownership, and
scheduler costs stay part of the measured library profile. There is no adapter
memoization, equality override, or synthetic owner disposal to make a library
look faster. A failed value/delivery check is a failure, not a timing sample to
keep. Native lifecycle workloads run only for adapters with a real owner scope.

## Active mappings and remaining overhead

| Adapter / line                       | Sources and computeds                                                                     | Effects, commit and ownership                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Reflex                               | Native callable read, native `.set`, native callable computed                             | Native `effect` and `batch`; runtime configured with `effectStrategy: "sab"`; no owner API exposed                                    |
| Alien Signals                        | Native callable source for read/write, callable computed                                  | Native effect with void-return boundary, `startBatch`/`endBatch` in `finally`, native `effectScope`                                   |
| Reactive Engine                      | `.value` accessors over `ReactiveEngineCore`                                              | Native effect and explicit batch, logger disabled; engine replaced between fresh fixtures; no fabricated owner scope                  |
| Lite Signal                          | Registry callables and `.set`                                                             | Registry effect/batch; effect owns an untracked scope body; fresh registry per fixture, lazy capacity allocation with explicit limits |
| @solidjs/signals 0.13                | Native setter; reads check observer and flush only when untracked                         | `createRenderEffect` compute phase, shared empty apply callback; explicit outer commit; native root                                   |
| Preact Signals                       | Closures translate `.value` to read/write                                                 | Native core `effect`/`batch`, native effect disposer; no Preact hooks or UI integration                                               |
| Reactively                           | Closures preserve receiver for `Reactive.get/set`                                         | A tracked initial `get()`, outer `stabilize()`; disposer uses public `set(undefined)` to detach the observer                          |
| S.js                                 | Native `S.value` callable for read/write, native computation getter                       | Native `S`, `freeze`, and owned `root`; eager computations and conflicting-write rule remain native                                   |
| Tansu                                | Native writable callable, `.set`, computed callable                                       | Subscribed computed is the effect; one shared empty subscription callback; native `batch`, unsubscribe disposer                       |
| $mol_wire                            | Native Atom subclass with shared prototype `read/write` methods; no separate node wrapper | Atom observer evaluated once, outer static `Atom.sync()` with receiver preserved; native observer destructor                          |
| Oby                                  | Native callable source for read/write, native memo getter                                 | Effect with `{ sync: "init" }`, outer `tick()`; native root and disposer                                                              |
| Signia                               | `.value` reads and receiver-preserving `.set`                                             | Named native `react`/`transact`; native effect disposer                                                                               |
| SolidJS 1.9                          | Native getter/setter and memo getter                                                      | Client build, native render effect/batch/root; no SSR no-op signals                                                                   |
| uSignal                              | Closures translate `.value` to read/write                                                 | Native effect/batch and effect disposer                                                                                               |
| Vue 3.5 / 3.6 RC                     | Shared factory, `shallowRef` for source identity, native computed `.value`                | Shared dirty-checked effect queue; outer commit; native effect scope                                                                  |
| @solidjs/signals 2 RC / SolidJS 2 RC | Shared factory, native setter; observer check and untracked flush on read                 | Shared render-effect compute policy and empty apply callback; outer explicit flush; native roots; SolidJS client alias                |
| Dalien Signals                       | Same callable mapping as Alien Signals, default managed API                               | Same void-return and batch boundary as Alien Signals; native scope; numeric-handle/reset tier excluded                                |
| Anod                                 | Active computation context routes `val(sender)`; otherwise native get/set                 | Context is saved/restored in `finally`; native effect/batch/root; explicit tracking is not replaced with a different engine           |
| Reatom 1001                          | Native atom/computed getter and `.set`                                                    | Native effect; `batch(fn, true)` supplies synchronous commits/builds; native unsubscribe; `context.reset()` between fresh fixtures    |
| Maverick Signals                     | Native callable getter, already bound `.set`, native computed getter                      | Native effect, outer `tick()` and native root/disposer                                                                                |
| Cellx                                | Closures preserve `Cell.get/set` receiver; standalone writes release                      | Native autorun; call native batch once for the outer transaction, then release; native effect disposer                                |
| ReScript Signals                     | Closures pass node to generated `Signal.get/set`                                          | Direct generated module imports; native synchronous scheduler and batch; effect result converted to ReScript unit; native disposer    |

### Why some wrappers remain

- The contract permits receiver-dependent prototype methods. Native methods
  cannot simply be copied unbound onto an unrelated wrapper, but a native node
  subclass can expose `read/write` without accessor closures. `$mol_wire` does
  this. Property APIs still need a method/property bridge; such a bridge can
  use shared prototype methods too and is not inherently a closure requirement.
- Anod needs a context bridge because its dependency reads are explicit.
- Staged Solid cores need the observer check and untracked-read flush so a
  benchmark read sees committed writes; tracked reads never flush. Reads inside
  an explicit batch retain the library's staged-read policy and are not used to
  force premature effect delivery in the benchmark.
- Alien/Dalien effects and ReScript Signals interpret callback results as
  cleanup. TypeScript permits `() => array.push(value)` for a void callback;
  the void boundary prevents the number from becoming a disposer. ReScript
  specifically treats every non-undefined result as cleanup. These closures
  are semantically required.
- [`commitBatch.ts`](../src/frameworks/commitBatch.ts) keeps a depth counter for
  adapters exposing only a flush operation. It is allocated once per adapter,
  not once per node or write. `finally` restores depth and flushes on unwind;
  native batch APIs retain their own exception policy.
- Scope callbacks capture the library-provided disposer and the fixture return
  value. They implement actual ownership rather than wrapping every node with
  an adapter-maintained registry.

## Changes from the review

Removed forwarding closures from callable getters/setters, native batch/root
functions, and effect callbacks that do not need return-value conversion.
The `$mol_wire` node subclass follows
[nin-jin's PR #5](https://github.com/volynetstyle/js-reactivity-benchmark/pull/5).
The harness's one-source computation path now captures the node and calls its
method instead of detaching `read`. This removes a hidden receiver requirement
for every adapter. The PR's original effect path predates fixture cleanup;
the current adapter retains the native observer disposer.
Solid and Tansu share their empty callbacks rather than allocating one per
effect. Reatom no longer creates an extra batch callback for each source write:
the harness already commits writes through `withBatch`. Its standalone writes,
like other microtask-scheduled libraries, need a commit to drain effects.

Explicit-flush adapters previously flushed at the end of inner batches. They
now wait for the outermost boundary. Cellx's native batch also releases on each
invocation, so the adapter invokes it only at the outermost level. Vue retains
native scope disposal without allocating an extra per-effect disposer.

## Inactive integrations and limits

The seven inactive integrations are Angular, MobX, Svelte, the TC39 polyfill,
Compostate, Valtio, and Kairo. Their files were inspected and straightforward
forwarding closures removed where applicable. This does not certify their
compatibility with the present suite. Svelte uses private runtime APIs; Angular
and the polyfill supply custom queues; Valtio's proxy getter is not a cached
computed and its no-op batch cannot satisfy the active commit contract.
Compostate/Kairo retain known incompatibilities; MobX/Valtio have linked
historical hang reports in the README. Re-enabling any of them requires the
same contract and workload validation as the active rows, regardless of its
historical speed.

Known native failures remain results, including Reatom's deep-graph retained
memory growth. Library defaults and adapter policies can still influence
rankings: compare workload families and per-row results, not just the overall
score. This review does not claim a measured speedup from removing a closure.
Existing published results were not regenerated; use a fresh run from this
commit and the same machine/runtime/profile to measure the changes.

## Verification

[`frameworkAdapters.test.ts`](../tests/frameworkAdapters.test.ts) checks method
accessors with object replacement, nested transaction delivery, synchronous
initial observation, ignored numeric callback returns, and fixture disposal
for all 24 active rows, including native queued-work disposal policies.
Existing adapter and observed-workload tests additionally
check values, dynamic dependency detachment, delivery coverage, and supported
native graph lifecycles. A prototype-method probe in
[`sBench.test.ts`](../tests/sBench.test.ts) runs every creation/update row to ensure
the harness preserves source and computed receivers. The production build and `bench:smoke` exercise isolated
workers, their bundled versions, correctness gates, and shard merging.

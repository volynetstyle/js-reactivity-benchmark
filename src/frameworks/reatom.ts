import { atom, batch, computed, context, effect } from "@reatom/core";
import { ReactiveFramework } from "../util/reactiveFramework";

// Reatom queues effects to a microtask by default. `batch(cb, true)` notifies
// synchronously when the outermost batch completes, which gives the harness
// its commit-at-the-end-of-a-batch model without changing the library.
export const reatomFramework: ReactiveFramework = {
  name: "@reatom/core",
  signal: (initial) => {
    const node = atom(initial);
    return {
      read: node,
      // The harness commits through withBatch; wrapping every write in another
      // batch adds a callback allocation without changing that commit.
      write: node.set,
    };
  },
  computed: (fn) => {
    const node = computed(fn);
    return { read: node };
  },
  effect: (fn) => {
    let instance!: { unsubscribe: () => void };
    batch(() => {
      instance = effect(fn);
    }, true);
    return instance.unsubscribe;
  },
  withBatch: (fn) => {
    batch(fn, true);
  },
  withBuild: (fn) => batch(fn, true),
  resetBenchmark: () => context.reset(),
};

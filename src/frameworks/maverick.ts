import { computed, effect, root, signal, tick } from "@maverick-js/signals";
import { ReactiveFramework } from "../util/reactiveFramework";

// Lazy computeds, microtask-batched effects flushed synchronously by `tick()`
// at each commit, and a native `root` with disposal.
export const maverickFramework: ReactiveFramework = {
  name: "@maverick-js/signals",
  signal: (initial) => {
    const node = signal(initial);
    return {
      read: () => node(),
      write: (value) => node.set(value),
    };
  },
  computed: (fn) => {
    const node = computed(fn);
    return { read: () => node() };
  },
  effect: (fn) =>
    effect(() => {
      fn();
    }),
  withBatch: (fn) => {
    fn();
    tick();
  },
  withBuild: (fn) => {
    const value = root(fn);
    tick();
    return value;
  },
  createScope(fn) {
    let dispose!: () => void;
    const value = root((stop) => {
      dispose = stop;
      return fn();
    });
    tick();
    return { value, dispose };
  },
};

import { createRegistry, Registry } from "@zakkster/lite-signal";
import { ReactiveFramework } from "../util/reactiveFramework";

function createBenchmarkRegistry(): Registry {
  return createRegistry({
    // The largest creation fixture contains 100k sources + 100k computeds.
    // Lazy allocation still charges first construction to the creation rows.
    maxNodes: 262_144,
    maxLinks: 1_048_576,
    prealloc: "lazy",
    // Fail if future scenarios outgrow the declared budget; never silently
    // benchmark capacity growth as part of an ordinary creation/update row.
    onCapacityExceeded: "throw",
  });
}

let registry = createBenchmarkRegistry();

export const liteSignalFramework: ReactiveFramework = {
  name: "lite-signal",
  signal(initialValue) {
    const value = registry.signal(initialValue);
    return {
      read: value,
      write: value.set,
    };
  },
  computed(fn) {
    const value = registry.computed(fn);
    return { read: value };
  },
  effect(fn) {
    registry.effect(fn);
  },
  withBatch(fn) {
    registry.batch(fn);
  },
  withBuild: (fn) => fn(),
  resetBenchmark() {
    registry.destroy();
    registry = createBenchmarkRegistry();
  },
};

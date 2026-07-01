import { createRegistry, Registry } from "@zakkster/lite-signal";
import { ReactiveFramework } from "../util/reactiveFramework";

function createBenchmarkRegistry(): Registry {
  return createRegistry({
    maxNodes: 131_072,
    maxLinks: 1_048_576,
    prealloc: "lazy",
    onCapacityExceeded: "grow",
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

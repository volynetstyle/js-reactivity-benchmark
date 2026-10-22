import { ReactiveEngineCore } from "@pravosleva/reactive-engine";
import { ReactiveFramework } from "../util/reactiveFramework";

// Measure the synchronous graph core, without automatic scheduling or UI bridges.
let engine = new ReactiveEngineCore({ logger: { isEnabled: false } });

export const reactiveEngineFramework: ReactiveFramework = {
  name: "reactive-engine",
  signal: (initial) => {
    const data = engine.signal(initial);
    return {
      read: () => data.value,
      write: (value) => {
        data.value = value;
      },
    };
  },
  computed: (fn) => {
    const data = engine.computed(fn);
    return { read: () => data.value };
  },
  effect: (fn) => engine.effect(fn),
  withBatch: (fn) => engine.batch(fn),
  withBuild: (fn) => fn(),
  resetBenchmark: () => {
    engine = new ReactiveEngineCore({ logger: { isEnabled: false } });
  },
};

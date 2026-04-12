import { createRuntime, signal, computed, effect } from "@volynets/reflex";
import { ReactiveFramework } from "../util/reactiveFramework";

const rt = createRuntime({ effectStrategy: "sab" });

const b = rt.batch.bind(rt);

const fn = (fn: any) => fn();

export const reflexFramework: ReactiveFramework = {
  name: "reflex",
  signal: (initial) => {
    const [read, write] = signal(initial);

    return {
      read,
      write,
    };
  },
  computed: (fn) => {
    return {
      read: computed(fn),
    };
  },
  effect: effect,
  withBatch: b,
  withBuild: fn,
};

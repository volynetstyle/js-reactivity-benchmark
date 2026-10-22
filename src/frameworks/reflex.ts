import {
  createRuntime,
  signal,
  computed,
  effect,
  batch,
} from "@volynets/reflex";
import { ReactiveFramework } from "../util/reactiveFramework";

createRuntime({ effectStrategy: "sab" });

export const reflexFramework: ReactiveFramework = {
  name: "reflex",
  signal: (initial) => {
    const data = signal(initial);
    return {
      read: data,
      write: data.set,
    };
  },
  computed: (fn) => {
    return {
      read: computed(fn),
    };
  },
  effect,
  withBatch: batch,
  withBuild: (fn) => fn(),
};

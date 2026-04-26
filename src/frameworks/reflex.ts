import {
  createRuntime,
  signal,
  computed,
  effect,
  batch,
} from "@volynets/reflex";
import { ReactiveFramework } from "../util/reactiveFramework";

const fn = (fn: any) => fn();

createRuntime({ effectStrategy: "sab" });

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
  withBatch: (fn) => {
    batch(fn);
  },
  withBuild: fn,
};

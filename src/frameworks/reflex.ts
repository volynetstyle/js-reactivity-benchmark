import {
  createRuntime,
  signal,
  computed,
  effect,
  batch,
  memo,
  flush,
} from "@volynets/reflex";
import { ReactiveFramework } from "../util/reactiveFramework";

const fn = (fn: any) => fn();

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
  effect: effect,
  withBatch: (fn) => {
    batch(fn);
  },
  withBuild: fn,
};

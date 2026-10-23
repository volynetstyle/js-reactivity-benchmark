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
      // The native setter has conditional updater overloads. Workloads use
      // direct values; keep that call path without an extra runtime wrapper.
      write: data.set as (value: typeof initial) => void,
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

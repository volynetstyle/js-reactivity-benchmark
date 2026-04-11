import {
  createRuntime,
  signal,
  computed,
  effect,
} from "@volynets/reflex";
import { ReactiveFramework } from "../util/reactiveFramework";

const rt = createRuntime({ effectStrategy: "sab" });

export const reflexFramework: ReactiveFramework = {
  name: "reflex",
  signal: (initial) => {
    const { 0: read, 1: write } = signal(initial);
    
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
  withBatch: rt.batch,
  withBuild: (fn) => fn(),
};

import {
  createRuntime,
  signal,
  memo,
  effect,
} from "../../node_modules/reflex/dist/esm";
import { ReactiveFramework } from "../util/reactiveFramework";

const rt = createRuntime({ effectStrategy: "sab"});

export const reflexFramework: ReactiveFramework = {
  name: "reflex",
  signal: (initial) => {
    const [r, w] = signal(initial);
    return {
      read: r,
      write: w,
    };
  },
  computed: (fn) => {
    return {
      read: memo(fn),
    };
  },
  effect: effect,
  withBatch:  rt.batch,
  withBuild: (fn) => fn(),
};

import {
  computed,
  effect,
  effectScope,
  endBatch,
  signal,
  startBatch,
} from "alien-signals";
import { ReactiveFramework } from "../util/reactiveFramework";

export const alienFramework: ReactiveFramework = {
  name: "alien-signals",
  signal: (initial) => {
    const data = signal(initial);
    return {
      read: data,
      write: data,
    };
  },
  computed: (fn) => {
    return {
      read: computed(fn),
    };
  },
  // Native effects interpret a return value as cleanup; the harness ignores it.
  effect: (fn) =>
    effect(() => {
      fn();
    }),
  withBatch: (fn) => {
    startBatch();
    try {
      fn();
    } finally {
      endBatch();
    }
  },
  withBuild: (fn) => fn(),
  createScope(fn) {
    let value!: ReturnType<typeof fn>;
    const dispose = effectScope(() => {
      value = fn();
    });
    return { value, dispose };
  },
};

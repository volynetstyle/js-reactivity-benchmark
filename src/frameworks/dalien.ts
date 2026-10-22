import {
  computed,
  effect,
  effectScope,
  endBatch,
  signal,
  startBatch,
} from "dalien-signals";
import { ReactiveFramework } from "../util/reactiveFramework";

// alien-signals' algorithm over one Int32Array arena. This is the library's
// default, leak-free API: each callable owns its arena record and frees it
// when dropped, so the adapter has the same shape as the alien-signals one.
// (The numeric-handle tier needs manual `reset()`, which in 3.2.1 fails on
// repeated rewinds of a populated graph.)
export const dalienFramework: ReactiveFramework = {
  name: "dalien-signals",
  signal: (initial) => {
    const data = signal(initial);
    return {
      read: data,
      write: data,
    };
  },
  computed: (fn) => ({ read: computed(fn) }),
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

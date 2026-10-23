import { atom, computed, syncEffect, batch, batchCleanup } from "compostate";
import { ReactiveFramework } from "../util/reactiveFramework";

export const compostateFramework: ReactiveFramework = {
  name: "Compostate",
  signal: (initialValue) => {
    // atom accepts literal function values; signal interprets them as updaters.
    const value = atom(initialValue);
    return {
      write: (next) => {
        value(next);
      },
      read: value,
    };
  },
  computed: (fn) => {
    const get = computed(fn);
    return {
      read: get,
    };
  },
  effect: (fn) =>
    syncEffect(() => {
      fn();
    }),
  withBatch: batch,
  withBuild: (fn) => fn(),
  createScope: <T>(fn: () => T) => {
    let value!: T;
    const dispose = batchCleanup(() => {
      value = fn();
    });
    return { value, dispose };
  },
};

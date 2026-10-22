import { signal, computed, syncEffect, batch, createRoot } from "compostate";
import { ReactiveFramework } from "../util/reactiveFramework";

// NOTE: The compostate adapter is currently not working and unused.

export const compostateFramework: ReactiveFramework = {
  name: "Compostate",
  signal: (initialValue) => {
    const [get, set] = signal(initialValue);
    return {
      write: set,
      read: get,
    };
  },
  computed: (fn) => {
    const get = computed(fn);
    return {
      read: get,
    };
  },
  effect: syncEffect,
  withBatch: batch,
  withBuild: createRoot,
};

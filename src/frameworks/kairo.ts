import { ReactiveFramework } from "../util/reactiveFramework";
import { batch, computed, effect, mutValue } from "kairo";
import { collectScope } from "kairo";

// NOTE: The kairo adapter is currently not working and unused.

export const kairoFramework: ReactiveFramework = {
  name: "kairo",
  signal: (initialValue) => {
    const [get, write] = mutValue(initialValue);
    return {
      read: () => get.value,
      write,
    };
  },
  computed: (fn) => {
    const c = computed(fn);
    return {
      read: () => c.value,
    };
  },
  effect,
  withBatch: batch,
  withBuild: (fn) => {
    const endCollectScope = collectScope();
    try {
      return fn();
    } finally {
      endCollectScope();
    }
  },
};

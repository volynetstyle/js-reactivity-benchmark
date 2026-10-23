import { computed, observable, autorun, runInAction, configure } from "mobx";
import { ReactiveFramework } from "../util/reactiveFramework";

// Fixture construction also writes outside actions.
configure({ enforceActions: "never" });

export const mobxFramework: ReactiveFramework = {
  name: "MobX",
  signal(initial) {
    const s = observable.box(initial, { deep: false });
    return {
      read: () => s.get(),
      write: (x) => s.set(x),
    };
  },
  computed: (fn) => {
    // Pull workloads have no observers. Otherwise MobX suspends their caches,
    // causing exponential traversal of shared deep graphs (upstream #3926).
    const read = computed(fn, { keepAlive: true });
    return {
      read: () => read.get(),
    };
  },
  effect: (fn) =>
    autorun(() => {
      fn();
    }),
  withBatch: runInAction,
  withBuild: (fn) => fn(),
};

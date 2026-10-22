import { Reactive, stabilize } from "@reactively/core";
import { ReactiveFramework } from "../util/reactiveFramework";

export const reactivelyFramework: ReactiveFramework = {
  name: "@reactively",
  signal: (initialValue) => {
    const r = new Reactive(initialValue);
    return {
      write: (v) => r.set(v),
      read: () => r.get(),
    };
  },
  computed: (fn) => {
    const r = new Reactive(fn);
    return {
      read: () => r.get(),
    };
  },
  effect: (fn) => {
    const observer = new Reactive(fn, true);
    // Evaluate once, tracked, instead of an untracked `fn()` followed by a
    // second queued run; `stabilize()` then skips the clean effect.
    observer.get();
    // Public set(value) converts a computation into a value and detaches its
    // parent observers. Use that path to release benchmark consumers.
    return () => observer.set(undefined);
  },
  withBatch: (fn) => {
    fn();
    stabilize();
  },
  withBuild: (fn) => fn(),
};

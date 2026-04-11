import { ReactiveFramework } from "../util/reactiveFramework";
import {
  createRenderEffect,
  flush,
  getObserver,
  createMemo,
  createRoot,
  createSignal,
} from "@solidjs/signals";

export const solidSignalsFramework: ReactiveFramework = {
  name: "@solidjs/signals",
  signal: (initialValue) => {
    const [getter, setter] = createSignal(initialValue, { pureWrite: true });
    return {
      write: (v) => {
        setter(v as any);
      },
      read: () => {
        if (!getObserver()) {
          flush();
        }
        return getter();
      },
    };
  },
  computed: (fn) => {
    const memo = createMemo(fn);
    return {
      read: () => {
        if (!getObserver()) {
          flush();
        }
        return memo();
      },
    };
  },
  effect: (fn) =>
    createRenderEffect(() => {
      fn();
    }, () => {}),
  withBatch: (fn) => {
    fn();
    flush();
  },
  withBuild: (fn) => createRoot(fn),
};

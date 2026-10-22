import { ReactiveFramework } from "../util/reactiveFramework";
import {
  batch,
  createRenderEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js/dist/solid.js";

export const solidFramework: ReactiveFramework = {
  name: "SolidJS",
  signal: (initialValue) => {
    const [getter, setter] = createSignal(initialValue);
    return {
      write: setter,
      read: getter,
    };
  },
  computed: (fn) => {
    const memo = createMemo(fn);
    return {
      read: memo,
    };
  },
  effect: createRenderEffect,
  withBatch: batch,
  withBuild: createRoot,
  createScope(fn) {
    let dispose!: () => void;
    const value = createRoot((stop) => {
      dispose = stop;
      return fn();
    });
    return { value, dispose };
  },
};

import { ReactiveFramework } from "../util/reactiveFramework";
import S from "s-js";

export const sFramework: ReactiveFramework = {
  name: "s-js",
  signal: (initial) => {
    const data = S.value(initial);
    return {
      read: data,
      write: data,
    };
  },
  computed: (fn) => {
    const computed = S(fn);
    return {
      read: computed,
    };
  },
  effect: (fn) => S(fn),
  withBatch: S.freeze,
  withBuild: S.root,
  createScope(fn) {
    let dispose!: () => void;
    const value = S.root((stop) => {
      dispose = stop;
      return fn();
    });
    return { value, dispose };
  },
};

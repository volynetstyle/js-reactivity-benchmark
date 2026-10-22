import { ReactiveFramework } from "../util/reactiveFramework";
import $ from "oby";
import { commitBatch } from "./commitBatch";

export const obyFramework: ReactiveFramework = {
  name: "Oby",
  signal: (initialValue) => {
    const observable = $(initialValue);
    return {
      write: observable,
      read: observable,
    };
  },
  computed: (fn) => {
    const memo = $.memo(fn);
    return {
      read: memo,
    };
  },
  // Native synchronous first run; later runs use Oby's scheduler, flushed by
  // `tick()` at the commit. Calling `fn()` up front would run every effect
  // twice on installation (once untracked, once tracked).
  effect: (fn) => $.effect(fn, { sync: "init" }),
  withBatch: commitBatch($.tick),
  withBuild: $.root,
  createScope(fn) {
    let dispose!: () => void;
    const value = $.root((stop) => {
      dispose = stop;
      return fn();
    });
    return { value, dispose };
  },
};

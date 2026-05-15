import { createRegistry } from "@zakkster/lite-signal";

import { ReactiveFramework } from "../util/reactiveFramework";

const fn = (fn: any) => fn();

const r = createRegistry({
  maxNodes: 65536,
  maxLinks: 1048576,
  onCapacityExceeded: "grow",
});

export const liteSignal: ReactiveFramework = {
  name: "lite",
  signal: (initial) => {
    const v = r.signal(initial);

    return {
      read: v,
      write: v.set,
    };
  },
  computed: (fn) => {
    return {
      read: r.computed(fn),
    };
  },
  effect: r.effect,
  withBatch: (fn) => {
    r.batch(fn);
  },
  withBuild: fn,
};

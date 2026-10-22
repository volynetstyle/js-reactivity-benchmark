import { autorun, batch, Cell, computed, observable, release } from "cellx";
import { ReactiveFramework } from "../util/reactiveFramework";

// Computed cells pull synchronously on read; change propagation to
// subscribers is deferred until `release()`, which the adapter calls at each
// commit (after a batch, or after a write outside one).
let depth = 0;

export const cellxFramework: ReactiveFramework = {
  name: "cellx",
  signal: (initial) => {
    const cell = observable(initial);
    return {
      read: () => cell.get(),
      write: (value) => {
        cell.set(value);
        if (depth === 0) release();
      },
    };
  },
  computed: (fn) => {
    const cell: Cell = computed(fn);
    return { read: () => cell.get() };
  },
  effect: autorun,
  withBatch: (fn) => {
    // Cellx's native batch releases on every call, including nested ones.
    if (depth > 0) {
      fn();
      return;
    }
    depth++;
    try {
      batch(fn);
    } finally {
      depth--;
      release();
    }
  },
  withBuild: (fn) => fn(),
};

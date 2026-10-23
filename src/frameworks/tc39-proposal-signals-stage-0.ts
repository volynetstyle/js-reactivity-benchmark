import { ReactiveFramework } from "../util/reactiveFramework";
import { Signal } from "signal-polyfill";

let batchDepth = 0;
let flushing = false;
let scheduled = false;
// The proposal deliberately leaves effects and scheduling to consumers.
const watcher = new Signal.subtle.Watcher(() => {
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      processPending();
    });
  }
});

function processPending() {
  if (batchDepth || flushing) return;
  flushing = true;
  try {
    while (watcher.getPending().length) {
      for (const signal of watcher.getPending()) signal.get();
      watcher.watch();
    }
  } finally {
    watcher.watch();
    flushing = false;
  }
}

export function effect(callback: () => void) {
  const computed = new Signal.Computed(() => {
    callback();
  });
  watcher.watch(computed);
  try {
    computed.get();
  } catch (error) {
    watcher.unwatch(computed);
    throw error;
  }
  return () => watcher.unwatch(computed);
}

export const tc39SignalsProposalStage0: ReactiveFramework = {
  name: "TC39 Signals Polyfill",
  signal: (initialValue) => {
    const s = new Signal.State(initialValue);
    return { write: (value) => s.set(value), read: () => s.get() };
  },
  computed: (fn) => {
    const c = new Signal.Computed(fn);
    return { read: () => c.get() };
  },
  effect,
  withBatch: (fn) => {
    batchDepth++;
    try {
      fn();
    } finally {
      if (--batchDepth === 0) processPending();
    }
  },
  withBuild: (fn) => fn(),
};

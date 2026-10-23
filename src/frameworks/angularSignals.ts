import { ReactiveFramework } from "../util/reactiveFramework";
import { signal, computed } from "@angular/core";
import { createWatch, Watch } from "@angular/core/primitives/signals";

export const angularFramework: ReactiveFramework = {
  name: "@angular/signals",
  signal: (initialValue) => {
    const s = signal(initialValue);
    return {
      write: s.set,
      read: s,
    };
  },
  computed: (fn) => {
    const c = computed(fn);
    return {
      read: c,
    };
  },
  effect,
  withBatch: (fn) => {
    batchDepth++;
    try {
      fn();
    } finally {
      if (--batchDepth === 0) flushEffects();
    }
  },
  withBuild: (fn) => fn(),
};

const queue = new Set<Watch>();
let batchDepth = 0;

/**
 * Wrapper around Angular's core effect primitive `Watch`, decoupled from
 * dependency injection, cleanup, and other unrelated concepts.
 */
function effect(effectFn: () => void): () => void {
  const w = createWatch(
    () => {
      effectFn();
    },
    queue.add.bind(queue),
    true
  );

  // Run effect immediately
  w.run();
  return () => {
    queue.delete(w);
    w.destroy();
  };
}

function flushEffects(): void {
  for (const watch of queue) {
    queue.delete(watch);
    watch.run();
  }
}

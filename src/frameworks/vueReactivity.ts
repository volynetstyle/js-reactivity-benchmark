import {
  computed,
  effectScope,
  shallowRef,
  effect,
  ReactiveEffect,
} from "@vue/reactivity";
import { ReactiveFramework } from "../util/reactiveFramework";

const scheduled = new Set<ReactiveEffect>();
let batching = false;

function flushEffects() {
  if (batching) return;
  batching = true;
  try {
    for (const pending of scheduled) {
      scheduled.delete(pending);
      // Match Vue's native dirty check when the custom scheduler flushes.
      if (pending.dirty) pending.run();
    }
  } finally {
    batching = false;
  }
}

export const vueReactivityFramework: ReactiveFramework = {
  name: "@vue/reactivity",
  signal: (initial) => {
    const data = shallowRef(initial);
    return {
      read: () => data.value as any,
      write: (v) => (data.value = v as any),
    };
  },
  computed: (fn) => {
    const c = computed(fn);
    return {
      read: () => c.value,
    };
  },
  effect: (fn) => {
    const t = effect(() => fn(), {
      scheduler: () => {
        scheduled.add(t.effect);
        flushEffects();
      },
    });
  },
  withBatch: (fn) => {
    if (batching) {
      fn();
    } else {
      batching = true;
      try {
        fn();
      } finally {
        batching = false;
        flushEffects();
      }
    }
  },
  withBuild: (fn) => {
    const e = effectScope();
    return e.run(fn)!;
  },
};

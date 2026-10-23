import { ReactiveFramework } from "../util/reactiveFramework";

export interface VueReactivity {
  shallowRef<T>(value: T): { value: T };
  computed<T>(fn: () => T): { readonly value: T };
  effectScope(): {
    run<T>(fn: () => T): T | undefined;
    stop(): void;
  };
  // Only the scheduler contract is shared between Vue generations. Their
  // development-only debugger types refer to different internal node types.
  effect(
    fn: () => void,
    options: { scheduler: () => void }
  ): {
    effect: { dirty: boolean; run(): unknown };
  };
}

/**
 * One adapter for every @vue/reactivity generation, so 3.5 (pull-oriented
 * core) and 3.6 (alien-signals-derived core) differ only in the library.
 */
export function createVueReactivityFramework(
  name: string,
  vue: VueReactivity
): ReactiveFramework {
  const scheduled = new Set<{ dirty: boolean; run(): unknown }>();
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

  return {
    name,
    signal: (initial) => {
      const data = vue.shallowRef(initial);
      return {
        read: () => data.value as any,
        write: (v) => (data.value = v as any),
      };
    },
    computed: (fn) => {
      const c = vue.computed(fn);
      return {
        read: () => c.value,
      };
    },
    effect: (fn) => {
      const t = vue.effect(fn, {
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
      const e = vue.effectScope();
      return e.run(fn)!;
    },
    createScope(fn) {
      const scope = vue.effectScope();
      return { value: scope.run(fn)!, dispose: () => scope.stop() };
    },
  };
}

import { ReactiveFramework } from "../util/reactiveFramework";
// @ts-ignore
import * as $ from "svelte/internal/client";

// NOTE: The svelte adapter uses private, internal APIs that are usually only
// used by the Svelte compiler and client runtime. The Svelte team has made the
// decision to not expose these APIs publicly / officially, because it gives
// them more freedom to experiment without making breaking changes, but given
// that Svelte's v5 reactivity API is one of the most actively developed and
// efficient TS implementations available, I wanted to include it in the
// benchmark suite regardless.

export const svelteFramework: ReactiveFramework = {
  name: "Svelte v5",
  signal: (initialValue) => {
    const s = $.state(initialValue);
    return {
      write: (v) => $.set(s, v),
      read: () => $.get(s),
    };
  },
  computed: (fn) => {
    const c = $.derived(fn);
    return {
      read: () => $.get(c),
    };
  },
  effect: (fn) => {
    if (scopeDepth) {
      $.render_effect(() => {
        fn();
      });
      return;
    }
    // Discard callback results: the runtime interprets functions as cleanups.
    return $.effect_root(() => {
      $.render_effect(() => {
        fn();
      });
    });
  },
  withBatch: (fn) => {
    batchDepth++;
    try {
      fn();
    } finally {
      if (--batchDepth === 0) $.flush();
    }
  },
  // Match compiler-created derivations: they have an active effect owner.
  withBuild: (fn) => (scopeDepth ? fn() : createScope(fn).value),
  createScope,
};

function createScope<T>(fn: () => T) {
  let value!: T;
  const dispose = $.effect_root(() => {
    scopeDepth++;
    try {
      value = fn();
    } finally {
      scopeDepth--;
    }
  });
  return { value, dispose };
}

let batchDepth = 0;
let scopeDepth = 0;

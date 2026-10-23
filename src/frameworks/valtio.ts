import { ReactiveFramework } from "../util/reactiveFramework";
import { proxy, ref } from "valtio/vanilla";
import { batch, computed, effect } from "valtio-reactive";

let batchDepth = 0;
// Nested properties are outside the signal replacement contract.
const literal = <T>(value: T): T =>
  value !== null && typeof value === "object" ? ref(value) : value;

export const valtioFramework: ReactiveFramework = {
  name: "Valtio",
  signal: (initial) => {
    const state = proxy({ value: literal(initial) });
    return {
      read: () => state.value,
      write: (value) => {
        state.value = literal(value);
      },
    };
  },
  computed: (fn) => {
    const state = computed({ value: () => literal(fn()) });
    return { read: () => state.value };
  },
  effect: (fn) =>
    effect(() => {
      fn();
    }),
  withBatch: (fn) => {
    if (batchDepth) {
      fn();
      return;
    }
    batch(() => {
      batchDepth++;
      try {
        fn();
      } finally {
        batchDepth--;
      }
    });
  },
  withBuild: (fn) => fn(),
};

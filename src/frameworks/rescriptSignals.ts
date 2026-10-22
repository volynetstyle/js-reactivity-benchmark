// The package entry re-exports ReScript module aliases, which compile to
// `undefined` in JavaScript; the generated modules are imported directly.
import * as Signal from "rescript-signals/src/signals/Signal.res.mjs";
import * as Computed from "rescript-signals/src/signals/Computed.res.mjs";
import * as Effect from "rescript-signals/src/signals/Effect.res.mjs";
import { ReactiveFramework } from "../util/reactiveFramework";

// Signals compiled from ReScript. Effects run immediately and synchronously;
// `Signal.batch` defers them to the end of the batch.
export const rescriptSignalsFramework: ReactiveFramework = {
  name: "rescript-signals",
  signal: (initial) => {
    const node = Signal.make(initial);
    return {
      read: () => Signal.get(node),
      write: (value) => Signal.set(node, value),
    };
  },
  computed: (fn) => {
    const node = Computed.make(fn);
    return { read: () => Signal.get(node) };
  },
  effect: (fn) => {
    const handle = Effect.runWithDisposer(() => {
      fn();
      return undefined;
    });
    return () => handle.dispose();
  },
  withBatch: (fn) => Signal.batch(fn),
  withBuild: (fn) => fn(),
};

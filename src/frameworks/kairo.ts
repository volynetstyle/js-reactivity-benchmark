import { ReactiveFramework } from "../util/reactiveFramework";
import { batch, computed, Reaction, mutable, Track, Cell } from "kairo";

let track: Track | undefined;
function tracked<T>(reader: Track, fn: () => T): T {
  const parent = track;
  track = reader;
  try {
    return fn();
  } finally {
    track = parent;
  }
}
function read<T>(cell: Cell<T>): T {
  return track ? track(cell) : cell.current;
}

export const kairoFramework: ReactiveFramework = {
  name: "kairo 0.8 alpha",
  signal: (initialValue) => {
    const [cell, set] = mutable(initialValue);
    return {
      read: () => read(cell),
      write: (value) => set(() => value),
    };
  },
  computed: (fn) => {
    const c = computed(($) => tracked($, fn));
    return {
      read: () => read(c),
    };
  },
  // effect() only initializes when a LifecycleScope attaches. Public Reaction
  // provides the synchronous observation and disposer needed by this harness.
  effect: (fn) => {
    const run = ($: Track) =>
      tracked($, () => {
        fn();
      });
    const reaction = new Reaction(() => {
      reaction.track(run);
    });
    reaction.track(run);
    return () => reaction.dispose();
  },
  withBatch: batch,
  withBuild: (fn) => fn(),
};

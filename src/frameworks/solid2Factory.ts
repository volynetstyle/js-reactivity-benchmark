import type * as signals2 from "solid-signals-2";
import { ReactiveFramework } from "../util/reactiveFramework";

export type Solid2Api = Pick<
  typeof signals2,
  | "createMemo"
  | "createRenderEffect"
  | "createRoot"
  | "createSignal"
  | "flush"
  | "getObserver"
>;

/**
 * Solid 2 stages writes until `flush()`. The adapter keeps the commit policy of
 * the @solidjs/signals 0.13 adapter so the generations stay comparable:
 * flush at the end of a batch, and before an untracked read; tracked reads
 * inside computations never flush.
 */
export function createSolid2Framework(
  name: string,
  solid: Solid2Api
): ReactiveFramework {
  const settle = () => {
    if (!solid.getObserver()) solid.flush();
  };
  return {
    name,
    signal: (initialValue) => {
      const [getter, setter] = solid.createSignal(initialValue as any, {
        ownedWrite: true,
      });
      return {
        write: (v) => {
          setter(v as any);
        },
        read: () => {
          settle();
          return getter();
        },
      };
    },
    computed: (fn) => {
      const memo = solid.createMemo(fn);
      return {
        read: () => {
          settle();
          return memo();
        },
      };
    },
    // Tracking and the side effect share the compute phase, as in the
    // 0.13 adapter; the effect phase is empty.
    effect: (fn) =>
      solid.createRenderEffect(
        () => {
          fn();
        },
        () => {}
      ),
    withBatch: (fn) => {
      fn();
      solid.flush();
    },
    withBuild: (fn) => {
      const value = solid.createRoot(fn);
      solid.flush();
      return value;
    },
    createScope(fn) {
      let dispose!: () => void;
      const value = solid.createRoot((stop) => {
        dispose = stop;
        return fn();
      });
      solid.flush();
      return { value, dispose };
    },
  };
}

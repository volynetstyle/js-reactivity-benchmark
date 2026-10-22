import type * as signals2 from "solid-signals-2";
import { ReactiveFramework } from "../util/reactiveFramework";
import { commitBatch } from "./commitBatch";

export type Solid2Api = Pick<
  typeof signals2,
  | "createMemo"
  | "createRenderEffect"
  | "createRoot"
  | "createSignal"
  | "flush"
  | "getObserver"
>;

const ignore = () => {};

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
  return {
    name,
    signal: (initialValue) => {
      const [getter, setter] = solid.createSignal(initialValue as any, {
        ownedWrite: true,
      });
      return {
        write: setter,
        read: () => {
          if (!solid.getObserver()) solid.flush();
          return getter();
        },
      };
    },
    computed: (fn) => {
      const memo = solid.createMemo(fn);
      return {
        read: () => {
          if (!solid.getObserver()) solid.flush();
          return memo();
        },
      };
    },
    // Tracking and the side effect share the compute phase, as in the
    // 0.13 adapter; the effect phase is empty.
    effect: (fn) => solid.createRenderEffect(fn, ignore),
    withBatch: commitBatch(solid.flush),
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

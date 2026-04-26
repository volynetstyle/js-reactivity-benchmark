import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FrameworkBenchmarkMetrics,
  ReactiveFramework,
} from "../util/reactiveFramework";

type SolidSignalsModule = {
  createMemo: <T>(fn: () => T) => () => T;
  createRenderEffect: (fn: () => void, initial: () => void) => void;
  createRoot: <T>(fn: () => T) => T;
  createSignal: <T>(
    initialValue: T,
    options?: { pureWrite?: boolean }
  ) => [() => T, (next: T) => void];
  flush: () => void;
  getObserver: () => unknown;
  __codexInstrumentation: {
    reset(): void;
    snapshot(): {
      fallbackCount: number;
      heightAdjustCount: number;
      maxDirtyQueueSize: number;
    };
  };
};

const solidSignals = loadSolidSignalsModule();

function loadSolidSignalsModule(): SolidSignalsModule {
  const modulePath = require.resolve("@solidjs/signals");
  const source = readFileSync(modulePath, "utf8");
  const instrumentedSource = `${source}
;(() => {
  const __codexMetrics = {
    fallbackCount: 0,
    heightAdjustCount: 0,
    maxDirtyQueueSize: 0,
    currentDirtyQueueSize: 0,
  };

  function __codexResetMetrics() {
    __codexMetrics.fallbackCount = 0;
    __codexMetrics.heightAdjustCount = 0;
    __codexMetrics.maxDirtyQueueSize = 0;
    __codexMetrics.currentDirtyQueueSize = 0;
  }

  function __codexBumpDirtyQueue() {
    __codexMetrics.currentDirtyQueueSize++;
    if (__codexMetrics.currentDirtyQueueSize > __codexMetrics.maxDirtyQueueSize) {
      __codexMetrics.maxDirtyQueueSize = __codexMetrics.currentDirtyQueueSize;
    }
  }

  function __codexDropDirtyQueue() {
    if (__codexMetrics.currentDirtyQueueSize > 0) {
      __codexMetrics.currentDirtyQueueSize--;
    }
  }

  const __codexInsertIntoHeap = insertIntoHeap;
  insertIntoHeap = function(n, heap) {
    const prevFlags = n.m;
    __codexInsertIntoHeap(n, heap);
    if (heap === P && !(prevFlags & i) && (n.m & i)) {
      __codexBumpDirtyQueue();
    }
  };

  const __codexInsertIntoHeapHeight = insertIntoHeapHeight;
  insertIntoHeapHeight = function(n, heap) {
    const prevFlags = n.m;
    __codexInsertIntoHeapHeight(n, heap);
    if (
      heap === P &&
      !(prevFlags & s) &&
      (n.m & s)
    ) {
      __codexBumpDirtyQueue();
    }
  };

  const __codexDeleteFromHeap = deleteFromHeap;
  deleteFromHeap = function(n, heap) {
    const prevFlags = n.m;
    __codexDeleteFromHeap(n, heap);
    if (heap === P && (prevFlags & (i | s))) {
      __codexDropDirtyQueue();
    }
  };

  const __codexAdjustHeight = adjustHeight;
  adjustHeight = function(el, heap) {
    __codexMetrics.fallbackCount++;
    const prevHeight = el.o;
    __codexAdjustHeight(el, heap);
    if (el.o !== prevHeight) {
      __codexMetrics.heightAdjustCount++;
    }
  };

  module.exports.__codexInstrumentation = {
    reset: __codexResetMetrics,
    snapshot: () => ({
      fallbackCount: __codexMetrics.fallbackCount,
      heightAdjustCount: __codexMetrics.heightAdjustCount,
      maxDirtyQueueSize: __codexMetrics.maxDirtyQueueSize,
    }),
  };
})();`;

  const mod = { exports: {} as Record<string, unknown> };
  const dirname = path.dirname(modulePath);
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    instrumentedSource
  );
  fn(mod.exports, require, mod, modulePath, dirname);
  return mod.exports as unknown as SolidSignalsModule;
}

const benchmarkMetrics: FrameworkBenchmarkMetrics = {
  reset() {
    solidSignals.__codexInstrumentation.reset();
  },
  snapshot() {
    return solidSignals.__codexInstrumentation.snapshot();
  },
};

export const solidSignalsFramework: ReactiveFramework = {
  name: "@solidjs/signals",
  benchmarkMetrics,
  signal: (initialValue) => {
    const [getter, setter] = solidSignals.createSignal(initialValue, {
      pureWrite: true,
    });
    return {
      write: (v) => {
        setter(v as any);
      },
      read: () => {
        if (!solidSignals.getObserver()) {
          solidSignals.flush();
        }
        return getter();
      },
    };
  },
  computed: (fn) => {
    const memo = solidSignals.createMemo(fn);
    return {
      read: () => {
        if (!solidSignals.getObserver()) {
          solidSignals.flush();
        }
        return memo();
      },
    };
  },
  effect: (fn) =>
    solidSignals.createRenderEffect(() => {
      fn();
    }, () => {}),
  withBatch: (fn) => {
    fn();
    solidSignals.flush();
  },
  withBuild: (fn) => solidSignals.createRoot(fn),
};

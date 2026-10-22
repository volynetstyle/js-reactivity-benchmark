/** interface for a reactive framework.
 *
 * Implement this interface to add a new reactive framework to the test and performance test suite.
 */
export interface ReactiveFramework {
  name: string;
  signal<T>(initialValue: T): Signal<T>;
  computed<T>(fn: () => T): Computed<T>;
  effect(fn: () => void): void;
  withBatch<T>(fn: () => T): void;
  withBuild<T>(fn: () => T): T;
  /** Native owner scope; only adapters with real graph disposal expose it. */
  createScope?<T>(fn: () => T): { value: T; dispose: () => void };
  /** Reset framework-owned benchmark state before constructing a fresh fixture. */
  resetBenchmark?: () => void;
  benchmarkMetrics?: FrameworkBenchmarkMetrics;
}

/** Accessors are methods: callers must preserve the node receiver (`this`). */
export interface Signal<T> {
  read(): T;
  write(v: T): void;
}

export interface Computed<T> {
  /** Call on the node; implementations may use prototype methods and `this`. */
  read(): T;
}

export interface FrameworkBenchSnapshot {
  fallbackCount?: number;
  heightAdjustCount?: number;
  maxDirtyQueueSize?: number;
}

export interface FrameworkBenchmarkMetrics {
  reset(): void;
  snapshot(): FrameworkBenchSnapshot;
}

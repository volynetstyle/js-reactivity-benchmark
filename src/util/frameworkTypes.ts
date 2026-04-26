import { TestResult } from "./perfTests";
import { ReactiveFramework } from "./reactiveFramework";

/** Parameters for a running a performance benchmark test
 *
 * The benchmarks create a rectangular grid of reactive elements, with
 * mutable signals in the first level, computed elements in the middle levels,
 * and read effect elements in the last level.
 *
 * Each test iteration modifies one signal, and then reads specified
 * fraction of the effect elements.
 *
 * Each non-signal node sums values from a specified number of elements
 * in the preceding layer. Some nodes are dynamic, and read vary
 * the number of sources the read for the sum.
 *
 * Tests may optionally provide result values to verify the sum
 * of all read effect elements in all iterations, and the total
 * number of non-signal updated.
 */
export interface TestConfig {
  /** friendly name for the test, should be unique */
  name?: string;

  /** graph family used to construct the benchmark */
  graphKind?: "rect" | "layered-dag" | "diamond-mesh";

  /** benchmark execution mode */
  mode?: "mixed" | "pull" | "push";

  /** sink read cadence during a benchmark iteration */
  sinkReadMode?: "per-update" | "per-batch" | "final-only";

  /** width of dependency graph to construct */
  width: number;

  /** number of mutable sources, defaults to width for rectangular graphs */
  sourcesCount?: number;

  /** depth of dependency graph to construct */
  totalLayers: number;

  /** fan-in for layered DAG style graphs, defaults to nSources */
  fanIn?: number;

  /** fraction of nodes that are static */ // TODO change to dynamicFraction
  staticFraction: number;

  /** construct a graph with number of sources in each node */
  nSources: number;

  /** fraction of [0, 1] elements in the last layer from which to read values in each test iteration */
  readFraction: number;

  /** number of test iterations */
  iterations: number;

  /** number of source writes performed per iteration */
  updatesPerIteration?: number;

  /** steady-state warmup iterations executed before the timed phase */
  warmupIterations?: number;

  /** whether graph construction should be included in the measured time */
  measureBuild?: boolean;

  /** sum and count of all iterations, for verification */
  expected: Partial<TestResult>;
}

export interface FrameworkInfo {
  /** wrapper/adapter for a benchmarking a reactive framework */
  framework: ReactiveFramework;

  /** verify the number of nodes executed matches the expected number */
  testPullCounts?: boolean;
}

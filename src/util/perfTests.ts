import { FrameworkInfo, TestConfig } from "./frameworkTypes";
import { BenchCountersSnapshot } from "./dependencyGraph";
import { FrameworkBenchSnapshot } from "./reactiveFramework";

export interface TestResult {
  sum: number;
  count: number;
  metrics?: BenchCountersSnapshot & FrameworkBenchSnapshot;
}

export interface TimingResult<T> {
  result: T;
  timing: TestTiming;
}

export interface TestTiming {
  /** Primary score for a row. Prefer median over min for benchmark reporting. */
  time: number;
  min?: number;
  median?: number;
  mean?: number;
  p75?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  max?: number;
  stddev?: number;
  mad?: number;
  iqr?: number;
  cv?: number;
  samples?: number[];
}

export function verifyBenchResult(
  perfFramework: FrameworkInfo,
  config: TestConfig,
  timedResult: TimingResult<TestResult>
): void {
  const { testPullCounts, framework } = perfFramework;
  const { expected } = config;
  const { result } = timedResult;

  if (expected.sum) {
    console.assert(
      result.sum == expected.sum,
      `sum ${framework.name} ${config.name} result:${result.sum} expected:${expected.sum}`
    );
  }
  if (
    expected.count &&
    (config.readFraction === 1 || testPullCounts) &&
    testPullCounts !== false
  ) {
    console.assert(
      result.count === expected.count,
      `count ${framework.name} ${config.name} result:${result.count} expected:${expected.count}`
    );
  }
}

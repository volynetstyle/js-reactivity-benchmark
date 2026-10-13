import { FrameworkInfo, TestConfig } from "./frameworkTypes";
import { BenchCountersSnapshot } from "./dependencyGraph";
import { FrameworkBenchSnapshot } from "./reactiveFramework";

export interface TestResult {
  sum: number;
  count: number;
  metrics?: BenchCountersSnapshot & FrameworkBenchSnapshot;
}

export function verifyBenchResult(
  perfFramework: FrameworkInfo,
  config: TestConfig,
  result: TestResult
): void {
  const { testPullCounts, framework } = perfFramework;
  const { expected } = config;

  if (expected.sum !== undefined && result.sum !== expected.sum) {
    throw new Error(
      `sum ${framework.name} ${config.name} result:${result.sum} expected:${expected.sum}`
    );
  }
  if (
    expected.count !== undefined &&
    testPullCounts === true &&
    result.count !== expected.count
  ) {
    throw new Error(
      `count ${framework.name} ${config.name} result:${result.count} expected:${expected.count}`
    );
  }
}

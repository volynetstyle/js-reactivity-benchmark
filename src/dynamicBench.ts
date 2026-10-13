import { perfTests } from "./config";
import { registerBenchmark } from "./util/benchmark";
import { Counter, Graph, makeGraph, runGraph } from "./util/dependencyGraph";
import { FrameworkInfo } from "./util/frameworkTypes";
import { perfRowStrings } from "./util/perfLogging";
import { TestResult, verifyBenchResult } from "./util/perfTests";
import { expectedGraphSum } from "./util/referenceGraph";

interface DynamicFixture {
  counter: Counter;
  graph?: Graph;
  startTick: number;
}

/** Register all dependency-graph scenarios for one reactive framework. */
export function dynamicBench(frameworkInfo: FrameworkInfo): void {
  const { framework } = frameworkInfo;

  for (const config of perfTests) {
    const checkedConfig = {
      ...config,
      expected: { ...config.expected },
    };
    const { warmupIterations = 0, measureBuild = warmupIterations === 0 } =
      config;

    registerBenchmark<DynamicFixture, TestResult>({
      framework: framework.name,
      name: `dynamic/${config.name ?? "unnamed"}`,
      setup() {
        // Compute a library-independent target only for selected cases,
        // outside measurement, including rows with no historical target.
        checkedConfig.expected.sum ??= expectedGraphSum(config);
        framework.resetBenchmark?.();
        const counter = new Counter();
        framework.benchmarkMetrics?.reset();

        if (measureBuild) {
          return { counter, startTick: 0 };
        }

        const graph = makeGraph(framework, config, counter);

        if (warmupIterations > 0) {
          runGraph(
            graph,
            { ...config, iterations: warmupIterations, startTick: 0 },
            framework
          );
        }

        counter.reset();
        framework.benchmarkMetrics?.reset();

        return {
          counter,
          graph,
          startTick: warmupIterations * (config.updatesPerIteration ?? 1),
        };
      },
      benchmark(fixture) {
        const graph =
          fixture.graph ?? makeGraph(framework, config, fixture.counter);
        const sum = runGraph(
          graph,
          { ...config, startTick: fixture.startTick },
          framework
        );

        return {
          sum,
          count: fixture.counter.count,
          metrics: {
            ...fixture.counter.snapshot(),
            ...framework.benchmarkMetrics?.snapshot(),
          },
        };
      },
      validate: (result) =>
        verifyBenchResult(frameworkInfo, checkedConfig, result),
      report: (result, timeMs) =>
        perfRowStrings(framework.name, config, timeMs, result),
      gc: "inner",
      blackhole: true,
      samples: 3,
    });
  }
}

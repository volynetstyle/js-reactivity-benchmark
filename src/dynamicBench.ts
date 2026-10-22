import { perfTests } from "./workloads";
import { registerBenchmark } from "./util/benchmark";
import { Counter, Graph, makeGraph, runGraph } from "./util/dependencyGraph";
import { FrameworkInfo } from "./util/frameworkTypes";
import { perfRowStrings, perfTitle } from "./util/perfLogging";
import { TestResult, verifyBenchResult } from "./util/perfTests";
import { expectedGraphSum } from "./util/referenceGraph";

interface DynamicFixture {
  counter: Counter;
  graph?: Graph;
  startTick: number;
  warmSources?: number[];
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
    const reuseFixture =
      !measureBuild &&
      warmupIterations > 0 &&
      config.staticFraction === 1 &&
      config.readFraction === 1;

    registerBenchmark<DynamicFixture, TestResult>({
      framework: framework.name,
      name: `dynamic/${config.name ?? "unnamed"}`,
      title: perfTitle(config),
      group:
        config.mode === "push"
          ? "push"
          : config.mode === "pull"
            ? "pull"
            : "large_graph",
      family: config.graphKind ?? "rect",
      reuseFixture,
      prepareSample(fixture) {
        if (!fixture.graph || !fixture.warmSources)
          throw new Error("Missing warm graph checkpoint");
        restoreWarmGraph(fixture.graph, fixture.warmSources, framework);
        framework.benchmarkMetrics?.reset();
      },
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
          warmSources: reuseFixture
            ? graph.sources.map((source) => source.read())
            : undefined,
        };
      },
      benchmark(fixture) {
        const graph =
          fixture.graph ?? makeGraph(framework, config, fixture.counter);
        fixture.graph = graph;
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
      teardown: (fixture) => fixture.graph?.disposePushEffects?.(),
      report: (result, timeMs) =>
        perfRowStrings(framework.name, config, timeMs, result),
      gc: "inner",
      blackhole: true,
      // Six samples are the minimum for a 95% order-statistic median interval.
      samples: 6,
    });
  }
}

export function restoreWarmGraph(
  graph: Graph,
  values: readonly number[],
  framework: FrameworkInfo["framework"]
): void {
  framework.withBatch(() => {
    for (let i = 0; i < values.length; i++) graph.sources[i].write(values[i]);
  });
  for (const leaf of graph.layers[graph.layers.length - 1]) leaf.read();
  graph.counter.reset();
}

import { expect, test } from "vitest";
import { expectedGraphSum } from "./referenceGraph";
import { perfTests, frameworkInfo } from "../config";
import { Counter, makeGraph, runGraph } from "./dependencyGraph";
import { verifyBenchResult } from "./perfTests";

test("historical expected sums agree with the numerical oracle", () => {
  const failures = perfTests.flatMap((config) => {
    const actual = expectedGraphSum(config);
    return config.expected.sum !== undefined && config.expected.sum !== actual
      ? [`${config.name}: ${config.expected.sum} -> ${actual}`]
      : [];
  });
  expect(failures).toEqual([]);
});

for (const { framework } of frameworkInfo) {
  for (const graphKind of ["rect", "layered-dag", "diamond-mesh"] as const) {
    test(`${framework.name} | ${graphKind} sums independent of transaction/read policy`, () => {
      for (const mode of ["mixed", "pull", "push"] as const) {
        for (const sinkReadMode of [
          "per-update",
          "per-batch",
          "final-only",
        ] as const) {
          framework.resetBenchmark?.();
          const config = {
            graphKind,
            mode,
            sinkReadMode,
            width: 8,
            sourcesCount: 8,
            totalLayers: 4,
            staticFraction: 0.5,
            nSources: 3,
            fanIn: 3,
            readFraction: 0.5,
            iterations: 12,
            updatesPerIteration: 3,
            expected: {},
          };
          const graph = makeGraph(framework, config, new Counter());
          expect(runGraph(graph, config, framework)).toBe(
            expectedGraphSum(config)
          );
        }
      }
    });
  }
}

test("oracle includes the untimed warmup writes", () => {
  const { framework } = frameworkInfo[1];
  const config = {
    width: 8,
    totalLayers: 4,
    staticFraction: 0.5,
    nSources: 3,
    readFraction: 0.5,
    iterations: 12,
    updatesPerIteration: 3,
    warmupIterations: 5,
    measureBuild: false,
    expected: {},
  };
  const graph = makeGraph(framework, config, new Counter());
  runGraph(
    graph,
    { ...config, iterations: config.warmupIterations },
    framework
  );
  const sum = runGraph(graph, { ...config, startTick: 15 }, framework);
  expect(sum).toBe(expectedGraphSum(config));
});

test("correctness failures throw, including an expected zero", () => {
  const framework = frameworkInfo[1];
  const config = {
    width: 1,
    totalLayers: 2,
    staticFraction: 1,
    nSources: 1,
    readFraction: 1,
    iterations: 1,
    expected: { sum: 0, count: 0 },
  };
  expect(() =>
    verifyBenchResult(framework, config, { sum: 1, count: 0 })
  ).toThrow("sum");
  expect(() =>
    verifyBenchResult(framework, config, { sum: 0, count: 1 })
  ).toThrow("count");
});

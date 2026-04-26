import { Counter, makeGraph, runGraph } from "./util/dependencyGraph";
import { logPerfResult, perfRowStrings } from "./util/perfLogging";
import { TestResult, verifyBenchResult } from "./util/perfTests";
import { FrameworkInfo } from "./util/frameworkTypes";
import { perfTests } from "./config";
import { fastestTest } from "./util/benchRepeat";
import { runTimed } from "./util/perfUtil";

/** benchmark a single test under single framework.
 * The test is run multiple times and the fastest result is logged to the console.
 */
export async function dynamicBench(
  frameworkTest: FrameworkInfo,
  testRepeats = 1
): Promise<void> {
  const { framework } = frameworkTest;
  for (const config of perfTests) {
    let counter = new Counter();
    const {
      warmupIterations = 0,
      iterations,
      measureBuild = warmupIterations === 0,
    } = config as typeof config & { measureBuild?: boolean };

    function runOnce(): number {
      // Create a new graph from scratch for each run to ensure they're independent
      // from each other.
      try {
        const graph = makeGraph(framework, config, counter);
        const res = runGraph(graph, config, framework);
        globalThis.gc?.();
        return res;
      } catch (err: any) {
        console.warn(`Error dynamicBench "${framework.name}":`, err);
        return -1;
      }
    }

    function runMeasuredOnce(): { result: TestResult; timing: { time: number } } {
      try {
        const graph = makeGraph(framework, config, counter);

        if (warmupIterations > 0) {
          runGraph(
            graph,
            {
              ...config,
              iterations: warmupIterations,
              startTick: 0,
            },
            framework
          );
        }

        counter.reset();
        framework.benchmarkMetrics?.reset();

        const timed = runTimed(() =>
          runGraph(
            graph,
            {
              ...config,
              startTick:
                warmupIterations * (config.updatesPerIteration ?? 1),
            },
            framework
          )
        );
        globalThis.gc?.();

        return {
          result: {
            sum: timed.result,
            count: counter.count,
            metrics: {
              ...counter.snapshot(),
              ...framework.benchmarkMetrics?.snapshot(),
            },
          },
          timing: { time: timed.time },
        };
      } catch (err: any) {
        console.warn(`Error dynamicBench "${framework.name}":`, err);
        return {
          result: { sum: -1, count: -1 },
          timing: { time: Number.POSITIVE_INFINITY },
        };
      }
    }

    // warm up
    runOnce();

    const timedResult = measureBuild
      ? await fastestTest(testRepeats, () => {
          counter.reset();
          framework.benchmarkMetrics?.reset();
          const sum = runOnce();
          return {
            sum,
            count: counter.count,
            metrics: {
              ...counter.snapshot(),
              ...framework.benchmarkMetrics?.snapshot(),
            },
          };
        })
      : await fastestTimed(testRepeats, runMeasuredOnce);

    logPerfResult(perfRowStrings(framework.name, config, timedResult));
    verifyBenchResult(frameworkTest, config, timedResult);
  }
}

async function fastestTimed<T>(
  times: number,
  fn: () => { result: T; timing: { time: number } }
): Promise<{ result: T; timing: { time: number } }> {
  let fastest = fn();

  for (let i = 1; i < times; i++) {
    const next = fn();
    if (next.timing.time < fastest.timing.time) {
      fastest = next;
    }
  }

  return fastest;
}

import { avoidablePropagation } from "./kairo/avoidable";
import { broadPropagation } from "./kairo/broad";
import { deepPropagation } from "./kairo/deep";
import { diamond } from "./kairo/diamond";
import { mux } from "./kairo/mux";
import { repeatedObservers } from "./kairo/repeated";
import { triangle } from "./kairo/triangle";
import { unstable } from "./kairo/unstable";
import { fastestTest } from "./util/benchRepeat";
import { benchRunCount } from "./util/benchOptions";
import { metadataForNamedScenario } from "./util/benchMetadata";
import { logPerfResult, perfNamedRowStrings } from "./util/perfLogging";
import { ReactiveFramework } from "./util/reactiveFramework";

const cases = [
  avoidablePropagation,
  broadPropagation,
  deepPropagation,
  diamond,
  mux,
  repeatedObservers,
  triangle,
  unstable,
];

export const kairoBenchCaseNames = cases.map((c) => c.name);

export async function kairoBench(
  framework: ReactiveFramework,
  caseName?: string
) {
  const selectedCases = caseName
    ? cases.filter((c) => c.name === caseName)
    : cases;

  if (selectedCases.length === 0) {
    throw new Error(`Unknown kairo benchmark scenario: ${caseName}`);
  }

  for (const c of selectedCases) {
    // Warm up: build graph and run once to trigger JIT compilation.
    // Discarded — not measured.
    const warmupIter = framework.withBuild(() => c(framework));
    warmupIter();
    globalThis.gc?.();

    // Each repeat of fastestTest rebuilds the graph from scratch so that:
    // 1. Reactive state does not accumulate across repeats.
    // 2. The graph's internal subscriber/dependency lists start clean.
    // The build cost itself is excluded — only the 1000 update iterations
    // are measured — matching the original intent.
    const { timing } = await fastestTest(benchRunCount(), () => {
      // Build outside the timed window
      const iter = framework.withBuild(() => c(framework));

      // One un-timed warmup iteration to settle the graph's initial state
      iter();

      // Timed: 1000 update iterations on a fresh, settled graph
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        iter();
      }
      const time = performance.now() - start;

      globalThis.gc?.();
      return time;
    });

    logPerfResult(
      perfNamedRowStrings(
        framework.name,
        c.name,
        { result: undefined, timing },
        metadataForNamedScenario("kairo", c.name)
      )
    );
  }
}

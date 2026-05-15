import { fastestTest } from "./util/benchRepeat";
import { metadataForNamedScenario } from "./util/benchMetadata";
import { logPerfResult, perfNamedRowStrings } from "./util/perfLogging";
import { ReactiveFramework } from "./util/reactiveFramework";

function fib(n: number): number {
  if (n < 2) return 1;
  return fib(n - 1) + fib(n - 2);
}

function hard(n: number, _log: string) {
  return n + fib(16);
}

const numbers = Array.from({ length: 5 }, (_, i) => i);

function buildGraph(framework: ReactiveFramework) {
  // Each call creates a fully independent graph with its own signals,
  // computeds, effects, and result buffer. This prevents state from leaking
  // between fastestTest repeats.
  const res: number[] = [];

  const iter = framework.withBuild(() => {
    const A = framework.signal(0);
    const B = framework.signal(0);
    const C = framework.computed(() => (A.read() % 2) + (B.read() % 2));
    const D_items = numbers.map(() => ({ x: 0 }));
    const D = framework.computed(() => {
      const a = A.read() % 2;
      const b = B.read() % 2;
      for (let i = 0; i < numbers.length; i++) {
        D_items[i].x = numbers[i] + a - b;
      }
      return D_items;
    });
    const E = framework.computed(() =>
      hard(C.read() + A.read() + D.read()[0].x, "E")
    );
    const F = framework.computed(() => hard(D.read()[2].x || B.read(), "F"));
    const G = framework.computed(
      () => C.read() + (C.read() || E.read() % 2) + D.read()[4].x + F.read()
    );

    framework.effect(() => res.push(hard(G.read(), "H")));
    framework.effect(() => res.push(G.read()));
    framework.effect(() => res.push(hard(F.read(), "J")));

    return (i: number) => {
      res.length = 0;
      framework.withBatch(() => {
        B.write(1);
        A.write(1 + i * 2);
      });
      framework.withBatch(() => {
        A.write(2 + i * 2);
        B.write(2);
      });
    };
  });

  return iter;
}

export const molBenchCaseNames = ["molBench"];

export async function molBench(
  framework: ReactiveFramework,
  caseName?: string
) {
  if (caseName && caseName !== "molBench") {
    throw new Error(`Unknown mol benchmark scenario: ${caseName}`);
  }

  // Warm up: build graph, run a few iterations to trigger JIT. Discarded.
  const warmupIter = buildGraph(framework);
  warmupIter(1);
  globalThis.gc?.();

  const { timing } = await fastestTest(10, () => {
    // Rebuild the graph for every repeat so reactive state is clean.
    // Build cost is outside the timed window.
    const iter = buildGraph(framework);

    // One un-timed settle iteration
    iter(0);

    // Timed: 10k update iterations on a fresh, settled graph
    const start = performance.now();
    for (let i = 0; i < 1e4; i++) {
      iter(i);
    }
    const time = performance.now() - start;

    globalThis.gc?.();
    return time;
  });

  logPerfResult(
    perfNamedRowStrings(
      framework.name,
      "molBench",
      { result: undefined, timing },
      metadataForNamedScenario("mol", "molBench")
    )
  );
}

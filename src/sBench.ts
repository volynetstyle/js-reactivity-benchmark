// Inspired by https://github.com/solidjs/solid/blob/main/packages/solid/bench/bench.cjs
import { summarizeSamples } from "./util/benchRepeat";
import { metadataForNamedScenario } from "./util/benchMetadata";
import { logPerfResult, perfNamedRowStrings } from "./util/perfLogging";
import { Computed, Signal, ReactiveFramework } from "./util/reactiveFramework";

const COUNT = 1e5;
const cases = [
  "createDataSignals",
  "createComputations0to1",
  "createComputations1to1",
  "createComputations2to1",
  "createComputations4to1",
  "createComputations1000to1",
  "createComputations1to2",
  "createComputations1to4",
  "createComputations1to8",
  "createComputations1to1000",
  "updateComputations1to1",
  "updateComputations2to1",
  "updateComputations4to1",
  "updateComputations1000to1",
  "updateComputations1to2",
  "updateComputations1to4",
  "updateComputations1to1000",
] as const;

export const sBenchCaseNames = [...cases];

type Reader = () => number;
export function sbench(framework: ReactiveFramework, caseName?: string) {
  if (caseName && !cases.includes(caseName as (typeof cases)[number])) {
    throw new Error(`Unknown s benchmark scenario: ${caseName}`);
  }

  bench(createDataSignals, COUNT, COUNT);
  bench(createComputations0to1, COUNT, 0);
  bench(createComputations1to1, COUNT, COUNT);
  bench(createComputations2to1, COUNT / 2, COUNT);
  bench(createComputations4to1, COUNT / 4, COUNT);
  bench(createComputations1000to1, COUNT / 1000, COUNT);
  bench(createComputations1to2, COUNT, COUNT / 2);
  bench(createComputations1to4, COUNT, COUNT / 4);
  bench(createComputations1to8, COUNT, COUNT / 8);
  bench(createComputations1to1000, COUNT, COUNT / 1000);
  bench(updateComputations1to1, COUNT * 4, 1);
  bench(updateComputations2to1, COUNT * 2, 2);
  bench(updateComputations4to1, COUNT, 4);
  bench(updateComputations1000to1, COUNT / 100, 1000);
  bench(updateComputations1to2, COUNT * 4, 1);
  bench(updateComputations1to4, COUNT * 4, 1);
  bench(updateComputations1to1000, COUNT * 4, 1);

  function bench(
    fn: (n: number, sources: any[]) => void,
    count: number,
    scount: number
  ) {
    if (caseName && fn.name !== caseName) {
      return;
    }

    const samples = Array.from({ length: benchRunCount() }, () =>
      run(fn, count, scount)
    );
    const stats = summarizeSamples(samples);
    const timing = {
      ...stats,
      time: stats.median,
      samples,
    };
    logPerfResult(
      perfNamedRowStrings(
        framework.name,
        fn.name,
        { result: undefined, timing },
        metadataForNamedScenario("s", fn.name)
      )
    );
  }

  function run(
    fn: (n: number, sources: Computed<number>[]) => void,
    n: number,
    scount: number
  ) {
    let start = 0;
    let end = 0;

    framework.withBuild(() => {
      // Warmup: run 3 times with small n to JIT-compile hot paths
      let sources = createDataSignals(scount, []) as Computed<number>[] | null;
      fn(n / 100, sources!);
      sources = createDataSignals(scount, []);
      fn(n / 100, sources);
      sources = createDataSignals(scount, []);
      fn(n / 100, sources);

      // Prepare final sources for the real measurement
      sources = createDataSignals(scount, []);

      // Warm up CPU caches for the sources array by reading every element.
      // Without this, large scount (e.g. 100k) causes cache misses that
      // inflate create* timings by ~3x, masking real computation overhead.
      for (let i = 0; i < scount; i++) {
        sources[i].read();
      }

      // GC after warmup so the measurement starts heap-clean
      globalThis.gc?.();

      start = performance.now();

      fn(n, sources);

      end = performance.now();

      // Allow GC to reclaim created computations
      sources = null;
      globalThis.gc?.();
    });

    return end - start;
  }

  function createDataSignals(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      sources[i] = framework.signal(i);
    }
    return sources;
  }

  function createComputations0to1(n: number, _sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation0(i);
    }
  }

  function createComputations1to1000(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 1000; i++) {
      const { read: get } = sources[i];
      for (let j = 0; j < 1000; j++) {
        createComputation1(get);
      }
    }
  }

  function createComputations1to8(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 8; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to4(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 4; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to2(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 2; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
    }
  }

  function createComputations2to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation2(sources[i * 2].read, sources[i * 2 + 1].read);
    }
  }

  function createComputations4to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation4(
        sources[i * 4].read,
        sources[i * 4 + 1].read,
        sources[i * 4 + 2].read,
        sources[i * 4 + 3].read
      );
    }
  }

  function createComputations1000to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation1000(sources, i * 1000);
    }
  }

  function createComputation0(i: number) {
    framework.computed(() => i);
  }

  function createComputation1(s1: Reader) {
    framework.computed(() => s1());
  }

  function createComputation2(s1: Reader, s2: Reader) {
    framework.computed(() => s1() + s2());
  }

  function createComputation4(s1: Reader, s2: Reader, s3: Reader, s4: Reader) {
    framework.computed(() => s1() + s2() + s3() + s4());
  }

  function createComputation1000(ss: Computed<number>[], offset: number) {
    framework.computed(() => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += ss[offset + i].read();
      }
      return sum;
    });
  }

  function updateComputations1to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations2to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0],
      { read: get2 } = sources[1];
    framework.computed(() => get1() + get2());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations4to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0],
      { read: get2 } = sources[1],
      { read: get3 } = sources[2],
      { read: get4 } = sources[3];
    framework.computed(() => get1() + get2() + get3() + get4());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations1000to1(n: number, sources: Signal<number>[]) {
    let { read: _get1, write: set1 } = sources[0];
    framework.computed(() => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += sources[i].read();
      }
      return sum;
    });
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations1to2(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    framework.computed(() => get1());
    for (let i = 0; i < n / 2; i++) {
      set1(i);
    }
  }

  function updateComputations1to4(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    framework.computed(() => get1());
    framework.computed(() => get1());
    framework.computed(() => get1());
    for (let i = 0; i < n / 4; i++) {
      set1(i);
    }
  }

  function updateComputations1to1000(n: number, sources: Signal<number>[]) {
    const { read: get1, write: set1 } = sources[0];
    for (let i = 0; i < 1000; i++) {
      framework.computed(() => get1());
    }
    for (let i = 0; i < n / 1000; i++) {
      set1(i);
    }
  }
}

function benchRunCount(): number {
  const parsed = Number.parseInt(process.env.BENCH_RUNS ?? "7", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

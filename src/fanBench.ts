import { fastestTest } from "./util/benchRepeat";
import { metadataForNamedScenario } from "./util/benchMetadata";
import { logPerfResult, perfNamedRowStrings } from "./util/perfLogging";
import { ReactiveFramework, Signal } from "./util/reactiveFramework";

const ITERATIONS = 50_000;
const SOURCE_COUNT = 128;
const MUTATIONS_PER_STEP = 8;
const DIRECT_STRIDE = 16;

const cases = [
  manyEffectsFromOneSource,
  manySourcesIntoOneComputedEffectWithDirect,
  manySourcesIntoOneComputedEffect,
  manySourcesIntoOneDirectEffect,
];

export const fanBenchCaseNames = cases.map((c) => c.name);

export async function fanBench(
  framework: ReactiveFramework,
  caseName?: string
): Promise<void> {
  const selectedCases = caseName
    ? cases.filter((c) => c.name === caseName)
    : cases;

  if (selectedCases.length === 0) {
    throw new Error(`Unknown fan benchmark scenario: ${caseName}`);
  }

  for (const c of selectedCases) {
    const warmup = framework.withBuild(() => c(framework));
    warmup(1_000);
    globalThis.gc?.();

    const { timing, result } = await fastestTest(10, () => {
      const run = framework.withBuild(() => c(framework));
      run(1_000);

      const start = performance.now();
      const checksum = run(ITERATIONS);
      const time = performance.now() - start;

      globalThis.gc?.();
      return { checksum, time };
    });

    logPerfResult(
      perfNamedRowStrings(
        framework.name,
        c.name,
        { result, timing },
        metadataForNamedScenario("fan", c.name),
        `checksum=${result.checksum}`
      )
    );
  }
}

function manyEffectsFromOneSource(framework: ReactiveFramework) {
  const source = framework.signal(0);
  const doubled = framework.computed(() => source.read() * 2);
  let checksum = 0;

  for (let i = 0; i < 48; i++) {
    framework.effect(() => {
      checksum += source.read();
    });
  }

  for (let i = 0; i < 48; i++) {
    framework.effect(() => {
      checksum += doubled.read();
    });
  }

  return (iterations: number) => {
    for (let i = 1; i <= iterations; i++) {
      framework.withBatch(() => {
        source.write(i);
      });
    }
    return checksum;
  };
}

function manySourcesIntoOneComputedEffectWithDirect(framework: ReactiveFramework) {
  const sources = makeSources(framework);
  const total = makeTotal(framework, sources);
  let checksum = 0;

  framework.effect(() => {
    checksum += total.read();
  });

  framework.effect(() => {
    checksum += readEvery16thSource(sources);
  });

  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function manySourcesIntoOneComputedEffect(framework: ReactiveFramework) {
  const sources = makeSources(framework);
  const total = makeTotal(framework, sources);
  let checksum = 0;

  framework.effect(() => {
    checksum += total.read();
  });

  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function manySourcesIntoOneDirectEffect(framework: ReactiveFramework) {
  const sources = makeSources(framework);
  let checksum = 0;

  framework.effect(() => {
    checksum += readEvery16thSource(sources);
  });

  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function makeSources(framework: ReactiveFramework): Signal<number>[] {
  return Array.from({ length: SOURCE_COUNT }, (_, i) => framework.signal(i));
}

function makeTotal(framework: ReactiveFramework, sources: Signal<number>[]) {
  return framework.computed(() => {
    let sum = 0;
    for (let i = 0; i < sources.length; i++) {
      sum += sources[i].read();
    }
    return sum;
  });
}

function readEvery16thSource(sources: Signal<number>[]): number {
  let sum = 0;
  for (let i = 0; i < SOURCE_COUNT; i += DIRECT_STRIDE) {
    sum += sources[i].read();
  }
  return sum;
}

function makeSourceMutationRunner(
  framework: ReactiveFramework,
  sources: Signal<number>[],
  readChecksum: () => number
) {
  let seed = 0x9e3779b9;
  let value = 0;

  return (iterations: number) => {
    for (let step = 0; step < iterations; step++) {
      framework.withBatch(() => {
        const changed = new Set<number>();
        while (changed.size < MUTATIONS_PER_STEP) {
          seed = nextSeed(seed);
          changed.add(seed % SOURCE_COUNT);
        }

        for (const index of changed) {
          sources[index].write(++value);
        }
      });
    }
    return readChecksum();
  };
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

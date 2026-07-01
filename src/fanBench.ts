import { registerBenchmark } from "./util/benchmark";
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

export function fanBench(framework: ReactiveFramework): void {
  for (const benchmarkCase of cases) {
    registerBenchmark({
      framework: framework.name,
      name: benchmarkCase.name,
      setup: () => {
        framework.resetBenchmark?.();
        return framework.withBuild(() => {
          const run = benchmarkCase(framework);
          run(1_000);
          return run;
        });
      },
      benchmark: (run) => run(ITERATIONS),
      gc: "inner",
      blackhole: true,
      samples: 3,
    });
  }
}

function manyEffectsFromOneSource(framework: ReactiveFramework) {
  const source = framework.signal(0);
  const doubled = framework.computed(() => source.read() * 2);
  let checksum = 0;
  for (let i = 0; i < 48; i++)
    framework.effect(() => void (checksum += source.read()));
  for (let i = 0; i < 48; i++)
    framework.effect(() => void (checksum += doubled.read()));
  return (iterations: number) => {
    for (let i = 1; i <= iterations; i++)
      framework.withBatch(() => source.write(i));
    return checksum;
  };
}

function manySourcesIntoOneComputedEffectWithDirect(
  framework: ReactiveFramework
) {
  const sources = makeSources(framework);
  const total = makeTotal(framework, sources);
  let checksum = 0;
  framework.effect(() => void (checksum += total.read()));
  framework.effect(() => void (checksum += readEvery16thSource(sources)));
  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function manySourcesIntoOneComputedEffect(framework: ReactiveFramework) {
  const sources = makeSources(framework);
  const total = makeTotal(framework, sources);
  let checksum = 0;
  framework.effect(() => void (checksum += total.read()));
  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function manySourcesIntoOneDirectEffect(framework: ReactiveFramework) {
  const sources = makeSources(framework);
  let checksum = 0;
  framework.effect(() => void (checksum += readEvery16thSource(sources)));
  return makeSourceMutationRunner(framework, sources, () => checksum);
}

function makeSources(framework: ReactiveFramework): Signal<number>[] {
  return Array.from({ length: SOURCE_COUNT }, (_, i) => framework.signal(i));
}

function makeTotal(framework: ReactiveFramework, sources: Signal<number>[]) {
  return framework.computed(() =>
    sources.reduce((sum, source) => sum + source.read(), 0)
  );
}

function readEvery16thSource(sources: Signal<number>[]): number {
  let sum = 0;
  for (let i = 0; i < SOURCE_COUNT; i += DIRECT_STRIDE)
    sum += sources[i].read();
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
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          changed.add(seed % SOURCE_COUNT);
        }
        for (const index of changed) sources[index].write(++value);
      });
    }
    return readChecksum();
  };
}

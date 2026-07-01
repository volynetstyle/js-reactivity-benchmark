// Based on https://github.com/Riim/cellx/blob/master/perf/perf.html
import { registerBenchmark } from "./util/benchmark";
import { Computed, ReactiveFramework, Signal } from "./util/reactiveFramework";

type Values = readonly [number, number, number, number];
type BenchmarkResults = readonly [Values, Values];

interface CellxFixture {
  start: Record<"prop1" | "prop2" | "prop3" | "prop4", Signal<number>>;
  end: Record<"prop1" | "prop2" | "prop3" | "prop4", Computed<number>>;
  before: Values;
}

const expected: Record<number, BenchmarkResults> = {
  1000: [
    [-3, -6, -2, 2],
    [-2, -4, 2, 3],
  ],
  2500: [
    [-3, -6, -2, 2],
    [-2, -4, 2, 3],
  ],
  5000: [
    [2, 4, -1, -6],
    [-2, 1, -4, -4],
  ],
};

export function cellxbench(framework: ReactiveFramework): void {
  for (const [layersText, expectedResult] of Object.entries(expected)) {
    const layers = Number(layersText);

    registerBenchmark<CellxFixture, BenchmarkResults>({
      framework: framework.name,
      name: `cellx${layers}`,
      setup: () => {
        framework.resetBenchmark?.();
        return makeFixture(framework, layers);
      },
      benchmark({ start, end, before }) {
        framework.withBatch(() => {
          start.prop1.write(4);
          start.prop2.write(3);
          start.prop3.write(2);
          start.prop4.write(1);
        });

        const after = readValues(end);
        return [before, after];
      },
      validate([before, after]) {
        console.assert(
          arraysEqual(before, expectedResult[0]),
          `Expected first layer ${expectedResult[0]}, found ${before}`
        );
        console.assert(
          arraysEqual(after, expectedResult[1]),
          `Expected last layer ${expectedResult[1]}, found ${after}`
        );
      },
      gc: "inner",
      blackhole: true,
    });
  }
}

function makeFixture(
  framework: ReactiveFramework,
  layers: number
): CellxFixture {
  return framework.withBuild(() => {
    const start = {
      prop1: framework.signal(1),
      prop2: framework.signal(2),
      prop3: framework.signal(3),
      prop4: framework.signal(4),
    };

    let layer: CellxFixture["end"] = start;

    for (let i = layers; i > 0; i--) {
      const previous = layer;
      const next = {
        prop1: framework.computed(() => previous.prop2.read()),
        prop2: framework.computed(
          () => previous.prop1.read() - previous.prop3.read()
        ),
        prop3: framework.computed(
          () => previous.prop2.read() + previous.prop4.read()
        ),
        prop4: framework.computed(() => previous.prop3.read()),
      };

      framework.effect(() => next.prop1.read());
      framework.effect(() => next.prop2.read());
      framework.effect(() => next.prop3.read());
      framework.effect(() => next.prop4.read());
      readValues(next);
      layer = next;
    }

    return { start, end: layer, before: readValues(layer) };
  });
}

function readValues(values: CellxFixture["end"]): Values {
  return [
    values.prop1.read(),
    values.prop2.read(),
    values.prop3.read(),
    values.prop4.read(),
  ];
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

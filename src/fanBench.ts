import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";
import { deliveryPlan, DeliveryProbe, verifyDelivery } from "./util/delivery";
import { fixtureScope } from "./util/fixtureScope";

const SOURCE_COUNT = 128;
const MUTATIONS_PER_STEP = 8;
const DIRECT_STRIDE = 16;
export const fanCases = [
  "manyEffectsFromOneSource",
  "manySourcesIntoOneComputedEffectWithDirect",
  "manySourcesIntoOneComputedEffect",
  "manySourcesIntoOneDirectEffect",
] as const;
type FanKind = (typeof fanCases)[number];

/** Shared immutable inputs; reactive nodes and pools are never reused. */
const schedules = new Map<string, ReturnType<typeof prepareSchedule>>();
function prepareSchedule(kind: FanKind, iterations: number, warmup: number) {
  const single = kind === "manyEffectsFromOneSource";
  const totalSteps = iterations + warmup;
  const indices = new Uint16Array(
    totalSteps * (single ? 1 : MUTATIONS_PER_STEP)
  );
  const writes = new Float64Array(indices.length);
  const state = Array.from({ length: SOURCE_COUNT }, (_, i) => i);
  let total = state.reduce((a, b) => a + b, 0);
  let direct = state
    .filter((_, i) => i % DIRECT_STRIDE === 0)
    .reduce((a, b) => a + b, 0);
  const rows: number[][] = [
    single
      ? [0, 0]
      : kind === "manySourcesIntoOneComputedEffectWithDirect"
        ? [total, direct]
        : [kind === "manySourcesIntoOneDirectEffect" ? direct : total],
  ];
  let seed = 0x9e3779b9;
  let value = 0;
  for (let step = 0; step < totalSteps; step++) {
    if (single) {
      const next = step < warmup ? step + 1 : step - warmup + 1;
      writes[step] = next;
      rows.push([next, next * 2]);
      continue;
    }
    const changed = new Set<number>();
    while (changed.size < MUTATIONS_PER_STEP) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      changed.add(seed % SOURCE_COUNT);
    }
    let mutation = 0;
    for (const index of changed) {
      const next = ++value;
      const offset = step * MUTATIONS_PER_STEP + mutation++;
      indices[offset] = index;
      writes[offset] = next;
      total += next - state[index];
      if (index % DIRECT_STRIDE === 0) direct += next - state[index];
      state[index] = next;
    }
    rows.push(
      kind === "manySourcesIntoOneComputedEffectWithDirect"
        ? [total, direct]
        : [kind === "manySourcesIntoOneDirectEffect" ? direct : total]
    );
  }
  const columns = single
    ? Array.from({ length: 96 }, (_, i) => (i < 48 ? 0 : 1))
    : undefined;
  return {
    indices,
    writes,
    warm: deliveryPlan(rows.slice(0, warmup + 1), columns),
    timed: deliveryPlan(rows.slice(warmup), columns),
  };
}

export function fanWorkload(
  framework: ReactiveFramework,
  kind: FanKind,
  iterations = 50_000,
  warmup = 1_000
) {
  const key = `${kind}/${iterations}/${warmup}`;
  let inputs = schedules.get(key);
  if (!inputs)
    schedules.set(key, (inputs = prepareSchedule(kind, iterations, warmup)));
  const probe = new DeliveryProbe(inputs.warm);
  const single = kind === "manyEffectsFromOneSource";
  const scope = fixtureScope(framework, () => {
    const sources = Array.from({ length: single ? 1 : SOURCE_COUNT }, (_, i) =>
      framework.signal(i)
    );
    if (single) {
      const doubled = framework.computed(() => sources[0].read() * 2);
      for (let i = 0; i < 96; i++)
        framework.effect(() =>
          probe.record(i, i < 48 ? sources[0].read() : doubled.read())
        );
    } else {
      const total =
        kind === "manySourcesIntoOneDirectEffect"
          ? undefined
          : framework.computed(() => {
              let sum = 0;
              for (const source of sources) sum += source.read();
              return sum;
            });
      if (total) framework.effect(() => probe.record(0, total.read()));
      if (kind !== "manySourcesIntoOneComputedEffect") {
        const index = total ? 1 : 0;
        framework.effect(() => {
          let sum = 0;
          for (let i = 0; i < sources.length; i += DIRECT_STRIDE)
            sum += sources[i].read();
          probe.record(index, sum);
        });
      }
    }
    return sources;
  });
  framework.withBatch(() => {});
  probe.verifyInitial(kind);
  const run = (start: number, count: number) => {
    for (let step = 0; step < count; step++) {
      probe.step = step + 1;
      const offset = (start + step) * (single ? 1 : MUTATIONS_PER_STEP);
      framework.withBatch(() => {
        if (single) scope.value[0].write(inputs!.writes[offset]);
        else
          for (let i = 0; i < MUTATIONS_PER_STEP; i++)
            scope.value[inputs!.indices[offset + i]].write(
              inputs!.writes[offset + i]
            );
      });
    }
    return probe.snapshot();
  };
  probe.reset(inputs.warm);
  verifyDelivery(kind, inputs.warm, run(0, warmup));
  probe.reset(inputs.timed);
  return {
    run: () => run(warmup, iterations),
    validate: (result: ReturnType<typeof probe.snapshot>) =>
      verifyDelivery(kind, inputs!.timed, result),
    dispose: scope.dispose,
  };
}

export function fanBench(framework: ReactiveFramework): void {
  for (const name of fanCases)
    registerBenchmark({
      framework: framework.name,
      name,
      setup: () => {
        framework.resetBenchmark?.();
        return fanWorkload(framework, name);
      },
      benchmark: (fixture) => fixture.run(),
      validate: (result, fixture) => fixture.validate(result),
      teardown: (fixture) => fixture.dispose(),
      gc: "inner",
      blackhole: true,
      samples: 3,
    });
}

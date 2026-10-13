import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";
import { DeliveryProbe, deliveryPlan, verifyDelivery } from "./util/delivery";
import { fixtureScope } from "./util/fixtureScope";

function fib(n: number): number {
  return n < 2 ? 1 : fib(n - 1) + fib(n - 2);
}
function hard(n: number): number {
  return n + fib(16);
}

function expectedMol(a: number, b: number): number[] {
  let previous = 1,
    current = 1;
  for (let i = 2; i <= 16; i++)
    [previous, current] = [current, previous + current];
  const c = (a % 2) + (b % 2);
  const delta = (a % 2) - (b % 2);
  const e = c + a + delta + current;
  const f = (2 + delta || b) + current;
  const g = c + (c || e % 2) + 4 + delta + f;
  return [g + current, g, f + current];
}

export function molWorkload(framework: ReactiveFramework) {
  let expected = deliveryPlan([
    expectedMol(0, 0),
    expectedMol(3, 1),
    expectedMol(4, 2),
  ]);
  const probe = new DeliveryProbe(expected);
  const scope = fixtureScope(framework, () => {
    const a = framework.signal(0),
      b = framework.signal(0);
    const c = framework.computed(() => (a.read() % 2) + (b.read() % 2));
    const items = Array.from({ length: 5 }, (_, i) => ({ x: i }));
    const d = framework.computed(() => {
      const av = a.read() % 2,
        bv = b.read() % 2;
      for (let i = 0; i < items.length; i++) items[i].x = i + av - bv;
      return items;
    });
    const e = framework.computed(() =>
      hard(c.read() + a.read() + d.read()[0].x)
    );
    const f = framework.computed(() => hard(d.read()[2].x || b.read()));
    const g = framework.computed(
      () => c.read() + (c.read() || e.read() % 2) + d.read()[4].x + f.read()
    );
    framework.effect(() => probe.record(0, hard(g.read())));
    framework.effect(() => probe.record(1, g.read()));
    framework.effect(() => probe.record(2, hard(f.read())));
    return { a, b, g };
  });
  framework.withBatch(() => {});
  probe.verifyInitial("molBench");
  const run = (offset: number) => {
    probe.step = 1;
    framework.withBatch(() => {
      scope.value.b.write(1);
      scope.value.a.write(1 + offset * 2);
    });
    probe.step = 2;
    framework.withBatch(() => {
      scope.value.a.write(2 + offset * 2);
      scope.value.b.write(2);
    });
    return { delivery: probe.snapshot(), final: scope.value.g.read() };
  };
  probe.reset();
  verifyDelivery("molBench warmup", expected, run(1).delivery);
  expected = deliveryPlan([
    expectedMol(4, 2),
    expectedMol(1, 1),
    expectedMol(2, 2),
  ]);
  probe.reset(expected);
  return {
    run: () => run(0),
    validate: (result: ReturnType<typeof run>) => {
      verifyDelivery("molBench", expected, result.delivery);
      if (result.final !== expectedMol(2, 2)[1])
        throw new Error("molBench: stale final derivation");
    },
    dispose: scope.dispose,
  };
}

export function objectWorkload(
  framework: ReactiveFramework,
  versioned: boolean,
  iterations = 5000
) {
  const plan = deliveryPlan(
    Array.from({ length: iterations + 1 }, (_, i) => [i * 2])
  );
  const probe = new DeliveryProbe(plan);
  const scope = fixtureScope(framework, () => {
    const shared = { count: 0 };
    const payload = framework.signal(shared);
    const version = versioned ? framework.signal(0) : undefined;
    const derived = framework.computed(() => {
      version?.read();
      return payload.read().count * 2;
    });
    framework.effect(() => probe.record(0, derived.read()));
    return { shared, payload, version, derived };
  });
  framework.withBatch(() => {});
  probe.verifyInitial("object publication");
  probe.reset();
  return {
    run() {
      for (let value = 1; value <= iterations; value++) {
        probe.step = value;
        framework.withBatch(() => {
          if (versioned) {
            scope.value.shared.count = value;
            scope.value.version!.write(value);
          } else scope.value.payload.write({ count: value });
        });
      }
      return { delivery: probe.snapshot(), final: scope.value.derived.read() };
    },
    validate(result: {
      delivery: ReturnType<typeof probe.snapshot>;
      final: number;
    }) {
      verifyDelivery("object publication", plan, result.delivery);
      if (result.final !== iterations * 2)
        throw new Error("object publication: stale final value");
    },
    dispose: scope.dispose,
  };
}

export function molBench(framework: ReactiveFramework): void {
  for (const [name, create] of [
    ["molBench", () => molWorkload(framework)],
    [
      "mutable-object/immutable replacement",
      () => objectWorkload(framework, false),
    ],
    [
      "mutable-object/in-place versioned",
      () => objectWorkload(framework, true),
    ],
  ] as const)
    registerBenchmark({
      framework: framework.name,
      name,
      setup: () => {
        framework.resetBenchmark?.();
        return create();
      },
      benchmark: (fixture) => fixture.run(),
      validate: (result, fixture) => fixture.validate(result),
      teardown: (fixture) => fixture.dispose(),
      gc: "inner",
      blackhole: true,
    });
}

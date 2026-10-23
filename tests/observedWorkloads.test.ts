import { expect, test } from "vitest";
import { frameworkInfo } from "../src/config";
import { historicalCases } from "../src/kairoBench";
import { historicalWorkload } from "../src/kairo/observed";
import { fanCases, fanWorkload } from "../src/fanBench";
import { deliveryPlan, DeliveryProbe, verifyDelivery } from "../src/util/delivery";
import { molWorkload, objectWorkload } from "../src/molBench";
import { lifecycleWorkload, retainedDisposal } from "../src/lifecycleBench";
import { makeFixture as makeCellxFixture } from "../src/cellxBench";

for (const { framework } of frameworkInfo) {
  test(`${framework.name} | checked mutable-object workloads`, () => {
    for (const create of [
      () => molWorkload(framework),
      () => objectWorkload(framework, false, 64),
      () => objectWorkload(framework, true, 64),
    ]) {
      framework.resetBenchmark?.();
      const fixture = create();
      try {
        fixture.validate(fixture.run());
      } finally {
        fixture.dispose();
      }
    }
  });
  if (framework.createScope)
    test(`${framework.name} | native graph lifecycle`, () => {
      framework.resetBenchmark?.();
      const fixture = lifecycleWorkload(framework, 8, 12);
      fixture.validate(fixture.run());
      const retained = retainedDisposal(framework, 64);
      retained.dispose();
      retained.validate();
      retained.dispose();
    });
  for (const kind of historicalCases)
    test(`${framework.name} | checked historical ${kind}`, () => {
      framework.resetBenchmark?.();
      const fixture = historicalWorkload(framework, kind);
      try {
        fixture.validate(fixture.run());
        fixture.prepareRun();
        fixture.validate(fixture.run());
      } finally {
        fixture.dispose();
      }
    });
  for (const kind of fanCases)
    test(`${framework.name} | checked fan ${kind}`, () => {
      framework.resetBenchmark?.();
      const fixture = fanWorkload(framework, kind, 64, 16);
      try {
        fixture.validate(fixture.run());
      } finally {
        fixture.dispose();
      }
    });
}

test("delivery validation detects missing intermediate updates even with the correct final value", () => {
  const plan = deliveryPlan([[0], [1], [2]]);
  const probe = new DeliveryProbe(plan);
  probe.record(0, 0);
  probe.verifyInitial("probe");
  probe.reset();
  probe.step = 2;
  probe.record(0, 2);
  expect(() => verifyDelivery("probe", plan, probe.snapshot())).toThrow(
    "changed outputs delivered"
  );
});

test("delivery validation catches a transient wrong value followed by a correct one", () => {
  const plan = deliveryPlan([[0], [1]]);
  const probe = new DeliveryProbe(plan);
  probe.step = 1;
  probe.record(0, 9);
  probe.record(0, 1);
  expect(() => verifyDelivery("probe", plan, probe.snapshot())).toThrow(
    "mismatches=1"
  );
});

test.each(frameworkInfo.map(({ framework }) => framework))(
  "$name | cellx layers propagate one batch through every layer",
  (framework) => {
    framework.resetBenchmark?.();
    const fixture = makeCellxFixture(framework, 1000);
    try {
      expect(fixture.before).toEqual([-3, -6, -2, 2]);
      framework.withBatch(() => {
        fixture.start.prop1.write(4);
        fixture.start.prop2.write(3);
        fixture.start.prop3.write(2);
        fixture.start.prop4.write(1);
      });
      expect([
        fixture.end.prop1.read(),
        fixture.end.prop2.read(),
        fixture.end.prop3.read(),
        fixture.end.prop4.read(),
      ]).toEqual([-2, -4, 2, 3]);
    } finally {
      fixture.dispose();
    }
  }
);

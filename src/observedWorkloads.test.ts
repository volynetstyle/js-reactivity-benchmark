import { expect, test } from "vitest";
import { frameworkInfo } from "./config";
import { historicalCases } from "./kairoBench";
import { historicalWorkload } from "./kairo/observed";
import { fanCases, fanWorkload } from "./fanBench";
import { deliveryPlan, DeliveryProbe, verifyDelivery } from "./util/delivery";
import { molWorkload, objectWorkload } from "./molBench";
import { lifecycleWorkload, retainedDisposal } from "./lifecycleBench";

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

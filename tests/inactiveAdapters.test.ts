import { expect, test } from "vitest";
import { compostateFramework } from "../src/frameworks/compostate";
import { valtioFramework } from "../src/frameworks/valtio";
import { fixtureScope } from "../src/util/fixtureScope";
import { makeFixture } from "../src/cellxBench";

// Keep the small native case checked without starting Compostate's exponential
// shared-path traversal at the suite's 1000/2500-layer sizes. See the audit.
test("Compostate | shallow cellx values and native scope disposal", () => {
  const f = compostateFramework;
  const fixture = makeFixture(f, 8);
  const reference = (input: number[]) => {
    let values = input;
    for (let i = 0; i < 8; i++) {
      const [a, b, c, d] = values;
      values = [b, a - c, b + d, c];
    }
    return values;
  };
  try {
    expect(fixture.before).toEqual(reference([1, 2, 3, 4]));
    f.withBatch(() => {
      fixture.start.prop1.write(4);
      fixture.start.prop2.write(3);
      fixture.start.prop3.write(2);
      fixture.start.prop4.write(1);
    });
    expect(Object.values(fixture.end).map((node) => node.read())).toEqual(
      reference([4, 3, 2, 1])
    );
  } finally {
    fixture.dispose();
  }
  const source = f.signal(0);
  const values: number[] = [];
  const scope = fixtureScope(f, () => {
    f.effect(() => values.push(source.read()));
  });
  scope.dispose();
  f.withBatch(() => source.write(1));
  expect(values).toEqual([0]);
});

// Expected failure against the same commit contract as the active adapters.
// If upstream fixes propagation, Vitest reports an unexpected pass so this
// exclusion is revisited instead of silently becoming permanent.
test.fails(
  "Valtio | batch must deliver only the committed diamond value",
  () => {
    const f = valtioFramework;
    const values: number[] = [];
    const scope = fixtureScope(f, () => {
      const a = f.signal(1);
      const b = f.signal(2);
      const left = f.computed(() => a.read() * 2);
      const right = f.computed(() => b.read() * 3);
      const joined = f.computed(() => left.read() + right.read());
      f.effect(() => values.push(joined.read()));
      return { a, b };
    });
    try {
      f.withBatch(() => {
        scope.value.a.write(3);
        scope.value.b.write(4);
      });
      expect(values).toEqual([8, 18]);
    } finally {
      scope.dispose();
    }
  }
);

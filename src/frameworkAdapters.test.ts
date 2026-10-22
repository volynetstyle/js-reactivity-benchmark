import { expect, test } from "vitest";
import { frameworkInfo } from "./config";
import { fixtureScope } from "./util/fixtureScope";

const explicitCommitAdapters = new Set([
  "@solidjs/signals",
  "@solidjs/signals 2 RC",
  "SolidJS 2 RC",
  "@reactively",
  "$mol_wire",
  "Oby",
  "@maverick-js/signals",
  "cellx",
]);

for (const { framework } of frameworkInfo) {
  const name = framework.name;

  test(`${name} | method accessors preserve object values and tracking`, () => {
    const fixture = fixtureScope(framework, () => {
      const source = framework.signal({ value: 1 });
      const derived = framework.computed(() => source.read().value * 2);
      expect(derived.read()).toBe(2);
      framework.withBatch(() => source.write({ value: 3 }));
      expect(source.read()).toEqual({ value: 3 });
      expect(derived.read()).toBe(6);
    });
    fixture.dispose();
  });

  test(`${name} | nested batches deliver once at the outer commit`, () => {
    const values: number[] = [];
    const fixture = fixtureScope(framework, () => {
      const a = framework.signal(0);
      const b = framework.signal(0);
      const c = framework.signal(0);
      framework.effect(() => {
        values.push(a.read() + b.read() + c.read());
      });
      return { a, b, c };
    });
    try {
      expect(values).toEqual([0]);
      framework.withBatch(() => {
        fixture.value.a.write(1);
        framework.withBatch(() => fixture.value.b.write(2));
        expect(values).toEqual([0]);
        fixture.value.c.write(3);
      });
      expect(values).toEqual([0, 6]);
    } finally {
      fixture.dispose();
    }
  });

  test(`${name} | fixture disposal detaches effects and ignores callback results`, () => {
    const values: number[] = [];
    const source = framework.signal(0);
    // TypeScript allows a value-returning function where () => void is expected.
    const fixture = fixtureScope(framework, () => {
      framework.effect(() => values.push(source.read()));
    });
    try {
      expect(values).toEqual([0]);
      framework.withBatch(() => source.write(1));
      expect(values).toEqual([0, 1]);
      fixture.dispose();
      framework.withBatch(() => source.write(2));
      expect(values).toEqual([0, 1]);
    } finally {
      fixture.dispose();
    }
  });

  test(`${name} | disposal follows native policy for already queued observations`, () => {
    const values: number[] = [];
    const source = framework.signal(0);
    const fixture = fixtureScope(framework, () => {
      framework.effect(() => {
        values.push(source.read());
      });
    });
    try {
      framework.withBatch(() => {
        source.write(1);
        fixture.dispose();
      });
      // S.js 0.4.9 drops a disposal queued before freeze's propagation starts.
      // Preserve the native behavior; dispose again outside the transaction.
      const expected = name === "s-js" ? [0, 1] : [0];
      expect(values).toEqual(expected);
      fixture.dispose();
      framework.withBatch(() => source.write(2));
      expect(values).toEqual(expected);
    } finally {
      fixture.dispose();
    }
  });

  if (explicitCommitAdapters.has(name)) {
    test(`${name} | failed callback releases the adapter commit boundary`, () => {
      const values: number[] = [];
      const source = framework.signal(0);
      const fixture = fixtureScope(framework, () => {
        framework.effect(() => {
          values.push(source.read());
        });
      });
      const error = new Error("callback failed");
      try {
        expect(() =>
          framework.withBatch(() => {
            framework.withBatch(() => {
              source.write(1);
              throw error;
            });
          })
        ).toThrow(error);
        expect(values).toEqual([0, 1]);
        framework.withBatch(() => source.write(2));
        expect(values).toEqual([0, 1, 2]);
      } finally {
        fixture.dispose();
      }
    });
  }
}

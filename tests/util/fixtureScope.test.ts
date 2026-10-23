import { expect, test, vi } from "vitest";
import { fixtureScope } from "../../src/util/fixtureScope";
import { ReactiveFramework } from "../../src/util/reactiveFramework";

function fallbackFramework(stops: (() => void)[]) {
  let index = 0;
  const framework: ReactiveFramework = {
    name: "fallback",
    signal: <T>(initial: T) => ({ read: () => initial, write: () => {} }),
    computed: (fn) => ({ read: fn }),
    effect(fn) {
      expect(this).toBe(framework);
      fn();
      return stops[index++];
    },
    withBatch: (fn) => {
      fn();
    },
    withBuild: (fn) => fn(),
  };
  return framework;
}

test("fallback scopes preserve receivers, restore methods and dispose exactly once", () => {
  const stop = vi.fn();
  const framework = fallbackFramework([stop]);
  const original = framework.effect;
  const fixture = fixtureScope(framework, () => {
    framework.effect(() => {});
    return 42;
  });
  expect(fixture.value).toBe(42);
  expect(framework.effect).toBe(original);
  fixture.dispose();
  fixture.dispose();
  expect(stop).toHaveBeenCalledTimes(1);
});

test("failed construction disposes installed effects and restores the adapter", () => {
  const stop = vi.fn();
  const framework = fallbackFramework([stop]);
  const original = framework.effect;
  const error = new Error("setup failed");
  expect(() =>
    fixtureScope(framework, () => {
      framework.effect(() => {});
      throw error;
    })
  ).toThrow(error);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(framework.effect).toBe(original);
});

test("one failing disposer does not leave other effects subscribed", () => {
  const error = new Error("stop failed");
  const first = vi.fn(() => {
    throw error;
  });
  const second = vi.fn();
  const framework = fallbackFramework([first, second]);
  const fixture = fixtureScope(framework, () => {
    framework.effect(() => {});
    framework.effect(() => {});
  });
  expect(fixture.dispose).toThrow(AggregateError);
  expect(second).toHaveBeenCalledTimes(1);
  fixture.dispose();
  expect(first).toHaveBeenCalledTimes(1);
});

test("failed setup retains both construction and cleanup errors", () => {
  const setupError = new Error("setup failed");
  const cleanupError = new Error("cleanup failed");
  const framework = fallbackFramework([
    () => {
      throw cleanupError;
    },
  ]);
  try {
    fixtureScope(framework, () => {
      framework.effect(() => {});
      throw setupError;
    });
    throw new Error("Expected construction to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBe(setupError);
    expect((error as AggregateError).errors[1].errors).toEqual([cleanupError]);
  }
});

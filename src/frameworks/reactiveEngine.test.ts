import { expect, test, vi } from "vitest";
import { fixtureScope } from "../util/fixtureScope";
import { reactiveEngineFramework as framework } from "./reactiveEngine";

test("reactive-engine core keeps unobserved computations lazy and cached", () => {
  framework.resetBenchmark!();
  const source = framework.signal(1);
  const compute = vi.fn(() => source.read() * 2);
  const node = framework.computed(compute);
  expect(compute).not.toHaveBeenCalled();
  expect(node.read()).toBe(2);
  expect(node.read()).toBe(2);
  expect(compute).toHaveBeenCalledTimes(1);
  source.write(2);
  source.write(3);
  expect(compute).toHaveBeenCalledTimes(1);
  expect(node.read()).toBe(6);
  expect(compute).toHaveBeenCalledTimes(2);
});

test("reactive-engine delivers synchronously and fixture cleanup detaches effects", async () => {
  framework.resetBenchmark!();
  const source = framework.signal(1);
  const values: number[] = [];
  const fixture = fixtureScope(framework, () => {
    const node = framework.computed(() => source.read() * 2);
    framework.effect(() => {
      values.push(node.read());
    });
  });
  try {
    expect(values).toEqual([2]);
    source.write(2);
    expect(values).toEqual([2, 4]);
    framework.withBatch(() => {
      source.write(3);
      source.write(4);
      expect(values).toEqual([2, 4]);
    });
    expect(values).toEqual([2, 4, 8]);
    fixture.dispose();
    fixture.dispose();
    source.write(5);
    await Promise.resolve();
    expect(values).toEqual([2, 4, 8]);
  } finally {
    fixture.dispose();
  }
});

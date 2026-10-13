import { beforeEach, expect, test, vi } from "vitest";
import { sbench } from "./sBench";
import { frameworkInfo } from "./config";
import { liteSignalFramework } from "./frameworks/liteSignal";
import { registerBenchmark } from "./util/benchmark";

vi.mock("./util/benchmark", () => ({ registerBenchmark: vi.fn() }));

const register = vi.mocked(registerBenchmark);
beforeEach(() => register.mockClear());

for (const { framework } of frameworkInfo) {
  test(`${framework.name} | all computation rows produce verified work`, () => {
    sbench(framework, 2000);
    expect(register).toHaveBeenCalledTimes(17);
    for (const [row] of register.mock.calls) {
      const fixture = row.setup();
      const result = row.benchmark(fixture);
      expect(row.blackhole).toBe(true);
      expect(row.validate).toBeTypeOf("function");
      row.validate!(result);
      if (row.name.startsWith("create")) {
        const { nodes } = result as { nodes: unknown[] };
        expect(nodes.every((node) => node !== undefined)).toBe(true);
      }
    }
  });
}

test("creation retains and initializes every lazy computed", () => {
  let evaluations = 0;
  sbench(
    {
      name: "lazy probe",
      signal: (initial) => {
        let value = initial;
        return {
          read: () => value,
          write: (next) => {
            value = next;
          },
        };
      },
      computed: (fn) => ({
        read: () => {
          evaluations++;
          return fn();
        },
      }),
      effect: () => {},
      withBuild: (fn) => fn(),
      withBatch: (fn) => {
        fn();
      },
    },
    2000
  );
  const row = register.mock.calls.find(
    ([row]) => row.name === "createComputations1to2"
  )![0];
  const result = row.benchmark(row.setup()) as { nodes: unknown[] };
  expect(evaluations).toBe(2000);
  expect(result.nodes).toHaveLength(2000);
  row.validate!(result);
});

test("the largest lite-signal creation fixture fits a fresh fixed-capacity registry", () => {
  sbench(liteSignalFramework);
  const row = register.mock.calls.find(
    ([row]) => row.name === "createComputations1to1"
  )![0];
  const result = row.benchmark(row.setup());
  row.validate!(result);
  liteSignalFramework.resetBenchmark!();
});

test("update validation rejects a source write without computed delivery", () => {
  sbench(frameworkInfo[0].framework, 2000);
  const row = register.mock.calls.find(
    ([row]) => row.name === "updateComputations1to1000"
  )![0];
  expect(() => row.validate!(0)).toThrow("update checksum");
});

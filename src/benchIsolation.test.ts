import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import { frameworkInfo, perfTests } from "./config";
import {
  benchScenarios,
  runScenarioIsolated,
  type BenchScenario,
} from "./index";
import { fanBenchCaseNames } from "./fanBench";
import { kairoBenchCaseNames } from "./kairoBench";
import { molBenchCaseNames } from "./molBench";
import { sBenchCaseNames } from "./sBench";

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  }),
}));

const mockedFork = vi.mocked(fork);

describe("benchmark isolation", () => {
  test("scenario list covers every benchmark row exactly once", () => {
    const expected = [
      ...kairoBenchCaseNames.map((name) => `kairo:${name}`),
      ...fanBenchCaseNames.map((name) => `fan:${name}`),
      ...molBenchCaseNames.map((name) => `mol:${name}`),
      ...sBenchCaseNames.map((name) => `s:${name}`),
      ...perfTests.map((config) => `dynamic:${config.name}`),
    ];

    const actual = benchScenarios.map(
      (scenario) => `${scenario.suite}:${scenario.name}`
    );

    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  test("each framework and scenario pair gets its own child process", async () => {
    mockedFork.mockClear();

    for (const { framework } of frameworkInfo) {
      for (const scenario of benchScenarios) {
        await runScenarioIsolated(framework.name, scenario);
      }
    }

    expect(mockedFork).toHaveBeenCalledTimes(
      frameworkInfo.length * benchScenarios.length
    );
  });

  test("child process environment is framework-neutral and scenario-scoped", async () => {
    mockedFork.mockClear();

    const originalEnv = {
      BENCH_FRAMEWORK: "reflex,alien",
      NODE_ENV: "test",
      __BENCH_CHILD_FRAMEWORK__: "stale-framework",
      __BENCH_CHILD_SUITE__: "stale-suite",
      __BENCH_CHILD_SCENARIO__: "stale-scenario",
    };
    const scenario: BenchScenario = {
      suite: "dynamic",
      name: "dashboard selective reads",
    };

    const previousEnv = process.env;
    process.env = { ...originalEnv };
    try {
      await runScenarioIsolated("alien", scenario);
    } finally {
      process.env = previousEnv;
    }

    const [, , options] = mockedFork.mock.calls[0];
    expect(options?.env).toMatchObject({
      BENCH_FRAMEWORK: "reflex,alien",
      NODE_ENV: "test",
      __BENCH_CHILD_FRAMEWORK__: "alien",
      __BENCH_CHILD_SUITE__: "dynamic",
      __BENCH_CHILD_SCENARIO__: "dashboard selective reads",
    });
    expect(options?.env?.__BENCH_CHILD_FRAMEWORK__).not.toBe(
      originalEnv.__BENCH_CHILD_FRAMEWORK__
    );
    expect(options?.env?.__BENCH_CHILD_SUITE__).not.toBe(
      originalEnv.__BENCH_CHILD_SUITE__
    );
    expect(options?.env?.__BENCH_CHILD_SCENARIO__).not.toBe(
      originalEnv.__BENCH_CHILD_SCENARIO__
    );
  });

  test("all scenarios use the same runtime flags and inherited stdio", async () => {
    mockedFork.mockClear();

    await runScenarioIsolated("reflex", {
      suite: "kairo",
      name: kairoBenchCaseNames[0],
    });
    await runScenarioIsolated("alien", {
      suite: "dynamic",
      name: perfTests[0].name,
    });

    const options = mockedFork.mock.calls.map(([, , childOptions]) => childOptions);

    expect(options).toHaveLength(2);
    expect(options[0]?.stdio).toBe("inherit");
    expect(options[1]?.stdio).toBe("inherit");
    expect(options[0]?.execArgv).toEqual(options[1]?.execArgv);
    expect(options[0]?.execArgv).toContain("--expose-gc");
  });
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { measure, sink, log } = vi.hoisted(() => ({
  measure: vi.fn(),
  sink: vi.fn(),
  log: vi.fn(),
}));
vi.mock("mitata", () => ({ measure, do_not_optimize: sink }));
vi.mock("./perfLogging", () => ({
  logPerfResult: log,
  perfReportHeaders: () => ({ framework: "framework", test: "test" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("BENCH_IN_PROCESS", "1");
  vi.stubEnv("BENCH_CASE", "");
  vi.stubEnv("BENCH_FILTER", "");
  vi.stubEnv("BENCH_PROFILE", "quick");
  vi.stubEnv("BENCH_SAMPLES", "");
  vi.stubEnv("BENCH_SAMPLES_FILE", "");
  vi.stubEnv("BENCH_ASSERT_NO_CONSOLE", "");
});
afterEach(() => vi.unstubAllEnvs());

test("validates every sample outside timing and before the next fixture reset", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let serial = 0;
  let measured = false;
  const events: string[] = [];
  measure.mockImplementation(async (target) => {
    const task = target().next().value;
    for (let i = 0; i < 3; i++) {
      const fixture = task[0]();
      measured = true;
      task.bench(fixture);
      measured = false;
    }
    return { samples: [1_000_000, 2_000_000, 3_000_000] };
  });
  registerBenchmark({
    framework: "probe",
    name: "valid",
    samples: 3,
    blackhole: true,
    gc: false,
    setup: () => {
      events.push("setup");
      return ++serial;
    },
    benchmark: (fixture) => fixture,
    validate: (result) => {
      expect(measured).toBe(false);
      events.push(`validate ${result}`);
    },
  });
  await runBenchmarks();
  expect(events).toEqual([
    "setup",
    "validate 1",
    "setup",
    "validate 2",
    "setup",
    "validate 3",
    "setup",
    "validate 4",
  ]);
  expect(
    sink.mock.calls.filter(([result]) => result !== undefined)
  ).toHaveLength(4);
  expect(sink.mock.calls.at(-1)).toEqual([undefined]);
  expect(log.mock.calls.at(-1)![0].metrics).toContain(
    "samples=3 profile=quick pilot=excluded"
  );
  expect(log.mock.calls.at(-1)![0].time).toBe("2.000000");
});

test("an incorrect intermediate sample fails the row before it is reported", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let runs = 0;
  measure.mockImplementation(async (target) => {
    const task = target().next().value;
    for (let i = 0; i < 3; i++) task.bench(task[0]());
    return { samples: [1_000_000, 2_000_000] };
  });
  registerBenchmark({
    framework: "probe",
    name: "invalid",
    gc: false,
    setup: () => null,
    benchmark: () => (++runs === 3 ? -1 : 1),
    validate: (result) => {
      if (result !== 1) throw new Error("bad intermediate value");
    },
  });
  await expect(runBenchmarks()).rejects.toThrow("bad intermediate value");
  expect(log).toHaveBeenCalledTimes(1); // Header only, no score for the failed row.
});

test("an unmatched selection fails instead of producing an empty successful run", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  vi.stubEnv("BENCH_FILTER", "missing scenario");
  registerBenchmark({
    framework: "probe",
    name: "other",
    setup: () => null,
    benchmark: () => 1,
  });
  await expect(runBenchmarks()).rejects.toThrow("No benchmark cases matched");
});

test("warm fixtures are restored outside timing and disposed once", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let measured = false;
  const setup = vi.fn(() => ({ value: 0 }));
  const teardown = vi.fn();
  const prepareSample = vi.fn((fixture) => {
    expect(measured).toBe(false);
    fixture.value = 0;
  });
  measure.mockImplementation(async (target) => {
    const task = target().next().value;
    for (let i = 0; i < 3; i++) {
      const fixture = task[0]();
      measured = true;
      task.bench(fixture);
      measured = false;
    }
    return { samples: [1_000_000, 2_000_000, 3_000_000] };
  });
  registerBenchmark({
    framework: "probe",
    name: "warm",
    samples: 3,
    setup,
    prepareSample,
    teardown,
    reuseFixture: true,
    benchmark: (fixture) => ++fixture.value,
    validate: (value) => expect(value).toBe(1),
  });
  await runBenchmarks();
  expect(setup).toHaveBeenCalledTimes(1);
  expect(prepareSample).toHaveBeenCalledTimes(3);
  expect(teardown).toHaveBeenCalledTimes(1);
});

test("CI console guard rejects output from a measured callback", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  vi.stubEnv("BENCH_ASSERT_NO_CONSOLE", "1");
  registerBenchmark({
    framework: "probe",
    name: "logging",
    setup: () => null,
    benchmark: () => {
      console.log("unwanted hot-path output");
      return 1;
    },
    validate: () => {},
  });
  await expect(runBenchmarks()).rejects.toThrow(
    "console.log called inside measured workload"
  );
});

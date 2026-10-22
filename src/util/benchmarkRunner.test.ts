import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { log } = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("./perfLogging", () => ({
  logPerfResult: log,
  perfReportHeaders: () => ({ framework: "framework", test: "test" }),
}));

/** Deterministic clock: each workload advances it by its own duration. */
let clock = 0;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.stubEnv("BENCH_IN_PROCESS", "1");
  vi.stubEnv("BENCH_CASE", "");
  vi.stubEnv("BENCH_FILTER", "");
  vi.stubEnv("BENCH_PROFILE", "quick");
  vi.stubEnv("BENCH_SAMPLES", "3");
  vi.stubEnv("BENCH_ROUNDS", "");
  vi.stubEnv("BENCH_SAMPLES_FILE", "");
  vi.stubEnv("BENCH_ASSERT_NO_CONSOLE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function samplesFile() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "bench-")),
    "samples.json"
  );
  vi.stubEnv("BENCH_SAMPLES_FILE", file);
  return () => JSON.parse(readFileSync(file, "utf8"));
}

const rowFor = (test: string) =>
  log.mock.calls.map(([row]) => row).find((row) => row.test === test);

test("validates every invocation outside timing and before the next fixture reset", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let serial = 0;
  let measured = false;
  const events: string[] = [];
  registerBenchmark({
    framework: "probe",
    name: "valid",
    blackhole: true,
    gc: false,
    setup: () => {
      events.push("setup");
      return ++serial;
    },
    benchmark: (fixture) => {
      measured = true;
      clock += fixture;
      measured = false;
      return fixture;
    },
    validate: (result) => {
      expect(measured).toBe(false);
      events.push(`validate ${result}`);
    },
  });
  await runBenchmarks();
  // Pilot, two warmup invocations, three measured samples.
  expect(events).toEqual(
    [1, 2, 3, 4, 5, 6].flatMap((n) => ["setup", `validate ${n}`])
  );
  const row = rowFor("valid");
  expect(row.metrics).toContain(
    "samples=3 rounds=1 profile=quick warmup=2 pilot=excluded"
  );
  expect(row.time).toBe("5.000000");
});

test("samples keep chronological order and every observation", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  const read = samplesFile();
  const durations = [50, 9, 8, 7, 1, 30];
  let call = 0;
  registerBenchmark({
    framework: "probe",
    name: "ordered",
    gc: false,
    setup: () => null,
    benchmark: () => (clock += durations[call++]),
    validate: () => {},
  });
  await runBenchmarks();
  const [record] = read().rows;
  expect(record.rounds[0]).toMatchObject({
    pilotMs: 50,
    warmupMs: [9, 8],
    samplesMs: [7, 1, 30],
  });
  expect(record.estimateMs).toBe(7);
  expect(read().semantics).toBe("v4");
});

test("quick profile samples until both the count and the time budget are met", async () => {
  vi.stubEnv("BENCH_SAMPLES", "");
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  const read = samplesFile();
  for (const [name, duration] of [
    ["heavy", 100],
    ["medium", 10],
    ["tiny", 1],
  ] as const)
    registerBenchmark({
      framework: "probe",
      name,
      samples: 3,
      gc: false,
      setup: () => null,
      benchmark: () => (clock += duration),
      validate: () => {},
    });
  await runBenchmarks();
  const counts = Object.fromEntries(
    read().rows.map((row: any) => [row.name, row.rounds[0].samplesMs.length])
  );
  // 250 ms budget: 3 x 100 ms, 25 x 10 ms, and the 100-sample ceiling.
  expect(counts).toEqual({ heavy: 3, medium: 25, tiny: 100 });
  expect(rowFor("medium").metrics).toMatch(/median_ci95=10\.0+\.\.10\.0+/);
});

test("the slow-row cap does not depend on registration or run order", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  // Slowest first: an order-dependent cap would compare it with nothing.
  for (const [framework, duration] of [
    ["slowest", 10_000],
    ["slow", 5_000],
    ["fast", 2_000],
  ] as const)
    registerBenchmark({
      framework,
      name: "scenario",
      gc: false,
      setup: () => null,
      benchmark: () => (clock += duration),
      validate: () => {},
    });
  await runBenchmarks();
  const rows = Object.fromEntries(
    log.mock.calls
      .map(([row]) => row)
      .filter((row) => row.test === "scenario")
      .map((row) => [row.framework, row])
  );
  // Ceiling = max(1500, 3 x fastest pilot 2000) = 6000 ms.
  expect(rows.slowest.metrics).toContain(
    "SLOW/CAPPED samples=1 ceiling=6000ms"
  );
  expect(rows.slow.metrics).toContain("samples=3");
  expect(rows.fast.metrics).toContain("samples=3");
});

test("rounds report the median of round medians and their range", async () => {
  vi.stubEnv("BENCH_ROUNDS", "3");
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let round = 0;
  registerBenchmark({
    framework: "probe",
    name: "rounds",
    gc: false,
    // Six invocations per round; each round runs at its own speed.
    setup: () => null,
    benchmark: () => (clock += [4, 2, 9][Math.floor(round++ / 6)]),
    validate: () => {},
  });
  await runBenchmarks();
  const row = rowFor("rounds");
  expect(row.time).toBe("4.000000");
  expect(row.metrics).toContain("samples=9 rounds=3");
  expect(row.metrics).toContain("round_range=2.000000..9.000000");
});

test("execution order is scenario-major and rotates frameworks", async () => {
  const { executionOrder } = await import("./benchmark");
  const cases = ["x", "y"].flatMap((name) =>
    ["a", "b", "c"].map((framework) => ({ name, framework }))
  );
  const order = (round: number) =>
    executionOrder(cases, round).map((c) => `${c.name}${c.framework}`);
  expect(order(1)).toEqual(["xa", "xb", "xc", "yb", "yc", "ya"]);
  expect(order(2)).toEqual(["xb", "xc", "xa", "yc", "ya", "yb"]);
});

test("an incorrect intermediate sample fails the row before it is reported", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  let runs = 0;
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
  registerBenchmark({
    framework: "probe",
    name: "warm",
    setup,
    prepareSample,
    teardown,
    reuseFixture: true,
    benchmark: (fixture) => {
      measured = true;
      clock += 1;
      measured = false;
      return ++fixture.value;
    },
    validate: (value) => expect(value).toBe(1),
  });
  await runBenchmarks();
  expect(setup).toHaveBeenCalledTimes(1);
  expect(prepareSample).toHaveBeenCalledTimes(5);
  expect(teardown).toHaveBeenCalledTimes(1);
});

test("CI console guard rejects output from a measured callback", async () => {
  const { registerBenchmark, runBenchmarks } = await import("./benchmark");
  vi.stubEnv("BENCH_ASSERT_NO_CONSOLE", "1");
  vi.mocked(console.log).mockRestore();
  registerBenchmark({
    framework: "probe",
    name: "logging",
    setup: () => null,
    benchmark: () => {
      console.warn("unwanted hot-path output");
      return 1;
    },
    validate: () => {},
  });
  await expect(runBenchmarks()).rejects.toThrow(
    "console.warn called inside measured workload"
  );
});

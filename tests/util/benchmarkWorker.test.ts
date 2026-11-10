import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("a supervised pilot is killed at its ceiling while setup and incorrect results remain separate", async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    BENCH_IN_PROCESS: "",
    BENCH_CASE: "",
    BENCH_FILTER: "",
    BENCH_SHARD: "",
    BENCH_PROFILE: "quick",
    BENCH_SAMPLES: "2",
    BENCH_ROUNDS: "1",
    BENCH_MIN_CEILING_MS: "50",
    BENCH_MAX_SLOWDOWN: "3",
    BENCH_ROW_TIMEOUT_MS: "8000",
    BENCH_ALLOW_FAILURES: "1",
  }))
    vi.stubEnv(key, value);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const dir = mkdtempSync(path.join(tmpdir(), "supervised-pilot-"));
  const worker = path.join(dir, "worker.cjs");
  const samples = path.join(dir, "samples.json");
  buildSync({
    entryPoints: ["tests/fixtures/ceiling-worker.ts"],
    outfile: worker,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  vi.stubEnv("BENCH_SAMPLES_FILE", samples);
  const { registerBenchmark, registerFrameworkWorker, runBenchmarks } =
    await import("../../src/util/benchmark");
  for (const framework of ["slow", "slow-setup", "alien-signals", "invalid"]) {
    registerFrameworkWorker(framework, worker);
    registerBenchmark({
      framework,
      name: "ceiling probe",
      setup: () => null,
      benchmark: () => 1,
    });
  }
  await runBenchmarks();
  const { rows } = JSON.parse(readFileSync(samples, "utf8"));
  const slow = rows.find((row: any) => row.framework === "slow");
  expect(slow).toMatchObject({
    capped: true,
    censored: true,
    validation: "not-completed",
    rounds: [],
  });
  expect(slow.estimateMs).toBeUndefined();
  expect(slow.statistics).toBeUndefined();
  const setup = rows.find((row: any) => row.framework === "slow-setup");
  expect(setup.capped).toBe(false);
  expect(setup.statistics.count).toBe(2);
  expect(
    rows.find((row: any) => row.framework === "invalid").failure.kind
  ).toBe("incorrect");
}, 15_000);

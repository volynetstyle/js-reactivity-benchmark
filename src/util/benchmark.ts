import { do_not_optimize, measure as mitataMeasure } from "mitata";
import { fork } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { timingStatistics, TimingStatistics } from "./statistics";
import {
  logPerfResult,
  perfReportHeaders,
  PerfRowStrings,
} from "./perfLogging";

export type BenchmarkGcMode = false | true | "once" | "inner";

export interface BenchmarkCase<TFixture, TResult> {
  framework: string;
  name: string;
  setup: () => TFixture;
  benchmark: (fixture: TFixture) => TResult;
  validate?: (result: TResult, fixture: TFixture) => void;
  teardown?: (fixture: TFixture) => void;
  report?: (result: TResult, timeMs: number) => PerfRowStrings;
  gc?: BenchmarkGcMode;
  blackhole?: boolean;
  samples?: number;
  group?: string;
  family?: string;
  /** Only for declared steady-state cases with an exact untimed reset. */
  reuseFixture?: boolean;
  prepareSample?: (fixture: TFixture) => void;
}

export interface TimingRecord {
  id: string;
  framework: string;
  name: string;
  profile: string;
  capped: boolean;
  pilotMs: number;
  samplesMs: number[];
  statistics: TimingStatistics;
  validation: "passed" | "absent";
  group: string;
  family: string;
  fixture: "fresh" | "warm-reused";
}

interface RegisteredCase<
  TFixture = unknown,
  TResult = unknown,
> extends BenchmarkCase<TFixture, TResult> {
  id: string;
  completed: boolean;
  result?: TResult;
}

const registeredCases: RegisteredCase[] = [];
const fastestPilotByScenario = new Map<string, number>();
const timingRecords: TimingRecord[] = [];
const workerEntries = new Map<string, string>();
export function registerFrameworkWorker(
  framework: string,
  entry: string
): void {
  workerEntries.set(framework, entry);
}

export function samplingPolicy(caseSamples = 5) {
  const profile = process.env.BENCH_PROFILE?.trim() || "quick";
  if (profile !== "quick" && profile !== "tails")
    throw new Error("BENCH_PROFILE must be quick or tails");
  const raw = process.env.BENCH_SAMPLES?.trim();
  const count = raw ? Number(raw) : profile === "tails" ? 1000 : caseSamples;
  if (!Number.isInteger(count) || count < 1)
    throw new Error("BENCH_SAMPLES must be a positive integer");
  return { profile, count };
}

function workloadFamily(name: string): [string, string] {
  if (name.startsWith("create"))
    return ["creation", "initialized construction"];
  if (name.startsWith("update")) return ["update", "write and pull"];
  if (name.startsWith("lifecycle/")) return ["lifecycle", "native ownership"];
  if (name.startsWith("mutable-object/") || name === "molBench")
    return ["dynamic", "object publication"];
  if (name.startsWith("many")) return ["push", "fan"];
  if (name.startsWith("dynamic/")) return ["large_graph", "dependency graph"];
  return ["baseline", "historical propagation"];
}

async function saveTimingRecords(): Promise<void> {
  const output =
    process.env.BENCH_SAMPLES_FILE ?? "bench-results/last-run.samples.json";
  if (!output) return;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        semantics: "v3",
        profile: samplingPolicy().profile,
        node: process.version,
        v8: process.versions.v8,
        gc: !!globalThis.gc,
        isolation: process.env.BENCH_IN_PROCESS === "1" ? "shared" : "row",
        rows: timingRecords,
        sampleOrder: "sorted by duration; all observations retained",
        consoleGuard: process.env.BENCH_ASSERT_NO_CONSOLE === "1",
        sourceCommit: process.env.BENCH_SOURCE_COMMIT,
        lockfileSha256: createHash("sha256")
          .update(await readFile("pnpm-lock.yaml"))
          .digest("hex"),
      },
      null,
      2
    ) + "\n"
  );
}

const MIN_PERFORMANCE_CEILING_MS = readPositiveNumber(
  "BENCH_MIN_CEILING_MS",
  1500
);
const MAX_SLOWDOWN_FACTOR = readPositiveNumber("BENCH_MAX_SLOWDOWN", 3);

/** Register workload and fixture creation without performing any measurement. */
export function registerBenchmark<TFixture, TResult>(
  benchmarkCase: BenchmarkCase<TFixture, TResult>
): void {
  const id = `${benchmarkCase.framework} :: ${benchmarkCase.name}`;
  if (process.env.BENCH_CASE && process.env.BENCH_CASE !== id) return;
  const filter = process.env.BENCH_FILTER?.trim().toLowerCase();
  if (
    filter &&
    !filter
      .split(",")
      .some((part) => benchmarkCase.name.toLowerCase().includes(part.trim()))
  )
    return;

  if (registeredCases.some((entry) => entry.id === id)) {
    throw new Error(`Duplicate benchmark name: ${id}`);
  }

  registeredCases.push({
    ...benchmarkCase,
    id,
    completed: false,
  } as RegisteredCase);
}

/**
 * Measure every collected workload with mitata and translate nanoseconds back
 * to the report format consumed by this repository.
 */
export async function runBenchmarks(): Promise<void> {
  if (registeredCases.length === 0)
    throw new Error("No benchmark cases matched the selection.");
  if (!process.env.BENCH_CASE) {
    const policy = samplingPolicy();
    console.log(
      `# semantics=v3 profile=${policy.profile} node=${process.version} v8=${process.versions.v8} platform=${process.platform}/${process.arch} cpu=${cpus()[0]?.model ?? "unknown"} ram=${totalmem()} gc=${!!globalThis.gc} isolation=${process.env.BENCH_IN_PROCESS === "1" ? "shared" : "row"} instrumented=${process.env.BENCH_INSTRUMENT === "1"}`
    );
    logPerfResult(perfReportHeaders());
    if (process.env.BENCH_IN_PROCESS !== "1") {
      await runIsolatedBenchmarks();
      await saveTimingRecords();
      return;
    }
  }
  const errors: string[] = [];

  for (const entry of registeredCases) {
    let insideMeasured = false;
    const consoleMethods = ["log", "warn", "error", "debug", "info"] as const;
    const originalConsole = new Map<string, (...args: unknown[]) => void>();
    if (process.env.BENCH_ASSERT_NO_CONSOLE === "1") {
      for (const method of consoleMethods) {
        const original = console[method].bind(console);
        originalConsole.set(method, original);
        console[method] = (...args) => {
          if (insideMeasured)
            throw new Error(
              `console.${method} called inside measured workload`
            );
          original(...args);
        };
      }
    }
    let pendingValidation = false;
    let activeFixture: unknown;
    let hasFixture = false;
    const validatePending = () => {
      if (pendingValidation) {
        entry.validate?.(entry.result, activeFixture);
        pendingValidation = false;
      }
    };
    const setup = () => {
      // Validate the preceding sample before a reset can destroy its fixture.
      // This stays outside the measured callback and catches failures in
      // intermediate/warmup samples, not just the pilot and final sample.
      validatePending();
      if (entry.blackhole && entry.completed) do_not_optimize(undefined);
      entry.result = undefined;
      entry.completed = false;
      if (entry.reuseFixture && hasFixture) {
        entry.prepareSample?.(activeFixture);
        return activeFixture;
      }
      if (hasFixture) entry.teardown?.(activeFixture);
      hasFixture = false;
      activeFixture = entry.setup();
      hasFixture = true;
      return activeFixture;
    };
    const runMeasured = (fixture: unknown) => {
      let result: unknown;
      try {
        insideMeasured = true;
        result = entry.benchmark(fixture);
      } finally {
        insideMeasured = false;
      }
      entry.result = result;
      entry.completed = true;
      pendingValidation = true;

      if (entry.blackhole) {
        do_not_optimize(result);
      }

      return result;
    };
    const target = function* () {
      yield {
        [0]: setup,
        bench: runMeasured,
      };
    };

    try {
      const policy = samplingPolicy(entry.samples);
      const gc =
        entry.gc === false || !globalThis.gc ? false : () => globalThis.gc?.();

      if (gc) gc();
      let pilotMs: number;
      {
        const pilotFixture = setup();
        const pilotStart = performance.now();
        runMeasured(pilotFixture);
        pilotMs = performance.now() - pilotStart;
      }

      if (!entry.completed) {
        throw new Error("benchmark completed without producing a result");
      }

      validatePending();
      if (process.send)
        process.send({ kind: "pilot", name: entry.name, pilotMs });

      const previousBest = process.env.BENCH_REFERENCE_PILOT_MS
        ? Number(process.env.BENCH_REFERENCE_PILOT_MS)
        : fastestPilotByScenario.get(entry.name);
      const ceilingMs = performanceCeilingMs(
        previousBest,
        MIN_PERFORMANCE_CEILING_MS,
        MAX_SLOWDOWN_FACTOR
      );
      fastestPilotByScenario.set(
        entry.name,
        Math.min(previousBest ?? Number.POSITIVE_INFINITY, pilotMs)
      );

      const capped = pilotMs > ceilingMs;
      let samplesMs = [pilotMs];

      if (!capped) {
        const measuredSamples = policy.count;
        const stats = await mitataMeasure(target as never, {
          gc,
          inner_gc: entry.gc === "inner",
          min_samples: measuredSamples,
          max_samples: measuredSamples,
          min_cpu_time: 0,
          warmup_samples: policy.profile === "tails" ? 20 : 0,
          warmup_threshold: Infinity,
          // Preserve outliers: mitata's default trims both ends of the array.
          samples_threshold: Infinity,
          batch_samples: 1,
          batch_unroll: 1,
          batch_threshold: 0,
        });
        samplesMs = stats.samples.map((ns) => ns / 1_000_000);
        if (samplesMs.length !== measuredSamples)
          throw new Error("Measurement library discarded samples");
        validatePending();
      }
      const statistics = timingStatistics(samplesMs);
      const timeMs = statistics.median;
      const [defaultGroup, defaultFamily] = workloadFamily(entry.name);
      const record: TimingRecord = {
        id: entry.id,
        framework: entry.framework,
        name: entry.name,
        profile: policy.profile,
        capped,
        pilotMs,
        samplesMs,
        statistics,
        validation: entry.validate ? "passed" : "absent",
        group: entry.group ?? defaultGroup,
        family: entry.family ?? defaultFamily,
        fixture: entry.reuseFixture ? "warm-reused" : "fresh",
      };

      const row = entry.report?.(entry.result, timeMs) ?? {
        framework: entry.framework,
        test: entry.name,
        time: timeMs.toFixed(6),
        metrics: "",
      };
      row.time = timeMs.toFixed(6);
      row.p95 = statistics.p95?.toFixed(6) ?? "";
      row.p99 = statistics.p99?.toFixed(6) ?? "";
      row.cv = statistics.cv?.toFixed(6) ?? "";
      row.group = record.group;
      row.family = record.family;

      if (capped) {
        const marker = `SLOW/CAPPED samples=1 ceiling=${ceilingMs.toFixed(0)}ms`;
        row.metrics = row.metrics ? `${marker} ${row.metrics}` : marker;
      } else {
        const tails =
          statistics.p99 !== undefined
            ? "p95+p99"
            : statistics.p95 !== undefined
              ? "p95"
              : "insufficient";
        row.metrics = `samples=${statistics.count} profile=${policy.profile} pilot=excluded tails=${tails} fixture=${record.fixture}${row.metrics ? " " + row.metrics : ""}`;
      }
      for (const key of ["p95", "p99"] as const) {
        const interval = statistics[`${key}Interval`];
        if (interval)
          row.metrics += ` ${key}_ci95=${interval[0].toFixed(6)}..${interval[1].toFixed(6)}`;
      }

      logPerfResult(row);
      if (process.send) process.send({ kind: "result", record });
      else timingRecords.push(record);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${entry.id}: ${reason}`);
    } finally {
      // mitata's sink retains its most recent argument; do not carry the
      // previous graph into the next fixture's GC/timed allocation work.
      if (entry.blackhole) do_not_optimize(undefined);
      entry.result = undefined;
      if (hasFixture) entry.teardown?.(activeFixture);
      for (const method of consoleMethods) {
        const original = originalConsole.get(method);
        if (original) console[method] = original;
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Benchmark failures:\n${errors.join("\n")}`);
  }
  if (!process.env.BENCH_CASE) await saveTimingRecords();
}

/** A fresh VM per row prevents caches, subscriptions, and JIT profiles from
 * earlier framework/scenario pairs affecting later rows. Workers stay serial.
 */
async function runIsolatedBenchmarks(): Promise<void> {
  const errors: string[] = [];
  for (const entry of registeredCases) {
    try {
      await new Promise<void>((resolve, reject) => {
        const previousBest = fastestPilotByScenario.get(entry.name);
        const child = fork(
          workerEntries.get(entry.framework) ?? process.argv[1],
          process.argv.slice(2),
          {
            env: {
              ...process.env,
              BENCH_CASE: entry.id,
              BENCH_REFERENCE_PILOT_MS:
                previousBest === undefined ? "" : String(previousBest),
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          }
        );
        child.stdout!.on("data", (chunk) => process.stdout.write(chunk));
        child.stderr!.on("data", (chunk) => process.stderr.write(chunk));
        child.on("message", (message: unknown) => {
          const sample = message as {
            kind?: string;
            name?: string;
            pilotMs?: number;
            record?: TimingRecord;
          };
          if (sample.kind === "result" && sample.record?.id === entry.id)
            timingRecords.push(sample.record);
          if (
            sample.name === entry.name &&
            typeof sample.pilotMs === "number" &&
            Number.isFinite(sample.pilotMs)
          ) {
            fastestPilotByScenario.set(
              entry.name,
              Math.min(previousBest ?? Infinity, sample.pilotMs)
            );
          }
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(`worker exited with code ${code}, signal ${signal}`)
            );
        });
      });
    } catch (error) {
      errors.push(
        `${entry.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (errors.length)
    throw new Error(`Benchmark worker failures:\n${errors.join("\n")}`);
}

export function performanceCeilingMs(
  previousBest: number | undefined,
  minimumMs = MIN_PERFORMANCE_CEILING_MS,
  slowdownFactor = MAX_SLOWDOWN_FACTOR
): number {
  return previousBest === undefined
    ? minimumMs
    : Math.max(minimumMs, previousBest * slowdownFactor);
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

import { do_not_optimize, measure as mitataMeasure } from "mitata";
import { fork } from "node:child_process";
import { cpus, totalmem } from "node:os";
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
  validate?: (result: TResult) => void;
  report?: (result: TResult, timeMs: number) => PerfRowStrings;
  gc?: BenchmarkGcMode;
  blackhole?: boolean;
  samples?: number;
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
  if (filter && !benchmarkCase.name.toLowerCase().includes(filter)) return;

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
    console.log(
      `# semantics=v2 node=${process.version} v8=${process.versions.v8} platform=${process.platform}/${process.arch} cpu=${cpus()[0]?.model ?? "unknown"} ram=${totalmem()} gc=${!!globalThis.gc} isolation=${process.env.BENCH_IN_PROCESS === "1" ? "shared" : "row"} instrumented=${process.env.BENCH_INSTRUMENT === "1"}`
    );
    logPerfResult(perfReportHeaders());
    if (process.env.BENCH_IN_PROCESS !== "1") {
      await runIsolatedBenchmarks();
      return;
    }
  }
  const errors: string[] = [];

  for (const entry of registeredCases) {
    let pendingValidation = false;
    const validatePending = () => {
      if (pendingValidation) {
        entry.validate?.(entry.result);
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
      return entry.setup();
    };
    const runMeasured = (fixture: unknown) => {
      const result = entry.benchmark(fixture);
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
      const samples = entry.samples ?? 5;
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
      if (process.send) process.send({ name: entry.name, pilotMs });

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
      let timeMs = pilotMs;
      let sampleCount = 1;

      if (!capped && samples > 1) {
        const measuredSamples = samples - 1;
        const stats = await mitataMeasure(target as never, {
          gc,
          inner_gc: entry.gc === "inner",
          min_samples: measuredSamples,
          max_samples: measuredSamples,
          min_cpu_time: 0,
          warmup_samples: 1,
          batch_samples: 1,
          batch_unroll: 1,
          batch_threshold: 0,
        });
        timeMs = median([
          pilotMs,
          ...stats.samples.map((ns) => ns / 1_000_000),
        ]);
        sampleCount += stats.samples.length;
        validatePending();
      }

      const row = entry.report?.(entry.result, timeMs) ?? {
        framework: entry.framework,
        test: entry.name,
        time: timeMs.toFixed(2),
        metrics: "",
      };

      if (capped) {
        const marker = `SLOW/CAPPED samples=1 ceiling=${ceilingMs.toFixed(0)}ms`;
        row.metrics = row.metrics ? `${marker} ${row.metrics}` : marker;
      } else {
        row.metrics = `samples=${sampleCount}${row.metrics ? " " + row.metrics : ""}`;
      }

      logPerfResult(row);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${entry.id}: ${reason}`);
    } finally {
      // mitata's sink retains its most recent argument; do not carry the
      // previous graph into the next fixture's GC/timed allocation work.
      if (entry.blackhole) do_not_optimize(undefined);
      entry.result = undefined;
    }
  }

  if (errors.length > 0) {
    throw new Error(`Benchmark failures:\n${errors.join("\n")}`);
  }
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
        const child = fork(process.argv[1], process.argv.slice(2), {
          env: {
            ...process.env,
            BENCH_CASE: entry.id,
            BENCH_REFERENCE_PILOT_MS:
              previousBest === undefined ? "" : String(previousBest),
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout!.on("data", (chunk) => process.stdout.write(chunk));
        child.stderr!.on("data", (chunk) => process.stderr.write(chunk));
        child.on("message", (message: unknown) => {
          const sample = message as { name?: string; pilotMs?: number };
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

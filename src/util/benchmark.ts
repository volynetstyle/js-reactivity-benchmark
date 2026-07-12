import { do_not_optimize, measure as mitataMeasure } from "mitata";
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
  logPerfResult(perfReportHeaders());
  const errors: string[] = [];

  for (const entry of registeredCases) {
    const runMeasured = (fixture: unknown) => {
      const result = entry.benchmark(fixture);
      entry.result = result;
      entry.completed = true;

      if (entry.blackhole) {
        do_not_optimize(result);
      }

      return result;
    };
    const target = function* () {
      yield {
        [0]: entry.setup,
        bench: runMeasured,
      };
    };

    try {
      const samples = entry.samples ?? 5;
      const gc =
        entry.gc === false || !globalThis.gc ? false : () => globalThis.gc?.();

      if (gc) gc();
      const pilotFixture = entry.setup();
      const pilotStart = performance.now();
      runMeasured(pilotFixture);
      const pilotMs = performance.now() - pilotStart;

      if (!entry.completed) {
        throw new Error("benchmark completed without producing a result");
      }

      entry.validate?.(entry.result);

      const previousBest = fastestPilotByScenario.get(entry.name);
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
        entry.validate?.(entry.result);
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
      }

      logPerfResult(row);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${entry.id}: ${reason}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Benchmark failures:\n${errors.join("\n")}`);
  }
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

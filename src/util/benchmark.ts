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
    const target = function* () {
      yield {
        [0]: entry.setup,
        bench(fixture: unknown) {
          const result = entry.benchmark(fixture);
          entry.result = result;
          entry.completed = true;

          if (entry.blackhole) {
            do_not_optimize(result);
          }

          return result;
        },
      };
    };

    try {
      const samples = entry.samples ?? 5;
      const gc =
        entry.gc === false || !globalThis.gc ? false : () => globalThis.gc?.();
      const stats = await mitataMeasure(target as never, {
        gc,
        inner_gc: entry.gc === "inner",
        min_samples: samples,
        max_samples: samples,
        min_cpu_time: 0,
        warmup_samples: 2,
        batch_samples: 1,
        batch_unroll: 1,
        batch_threshold: 0,
      });

      if (!entry.completed) {
        throw new Error("mitata completed without running the benchmark");
      }

      entry.validate?.(entry.result);

      const timeMs = stats.avg / 1_000_000;
      const row = entry.report?.(entry.result, timeMs) ?? {
        framework: entry.framework,
        test: entry.name,
        time: timeMs.toFixed(2),
        metrics: "",
      };
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

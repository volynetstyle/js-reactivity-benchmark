import { TimingResult } from "./perfTests";
import { runTimed } from "./perfUtil";

/** benchmark a function n times, returning the median result and full timing distribution */
export async function fastestTest<T>(
  times: number,
  fn: () => T
): Promise<TimingResult<T>> {
  const results: TimingResult<T>[] = [];

  for (let i = 0; i < times; i++) {
    const run = await runTracked(fn);
    results.push(run);
  }

  const samples = results.map((run) => run.timing.time);
  const stats = summarizeSamples(samples);
  const medianIndex = Math.floor((results.length - 1) / 2);
  const medianRun = [...results].sort(
    (a, b) => a.timing.time - b.timing.time
  )[medianIndex];

  return {
    result: medianRun.result,
    timing: {
      ...stats,
      time: stats.median,
      samples,
    },
  };
}

/** run a function, reporting the wall clock time and garbage collection time. */
async function runTracked<T>(fn: () => T): Promise<TimingResult<T>> {
  globalThis.gc?.();

  const { result, time } = runTimed(fn);

  globalThis.gc?.();

  return { result, timing: { time } };
}

export function summarizeSamples(samples: number[]) {
  if (samples.length === 0) {
    throw new Error("Cannot summarize an empty benchmark sample set.");
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    samples.length;
  const stddev = Math.sqrt(variance);
  const median = percentileSorted(sorted, 0.5);
  const deviations = samples
    .map((value) => Math.abs(value - median))
    .sort((a, b) => a - b);

  return {
    min: sorted[0],
    median,
    mean,
    p75: percentileSorted(sorted, 0.75),
    p90: percentileSorted(sorted, 0.9),
    p95: percentileSorted(sorted, 0.95),
    p99: percentileSorted(sorted, 0.99),
    max: sorted[sorted.length - 1],
    stddev,
    mad: percentileSorted(deviations, 0.5),
    iqr: percentileSorted(sorted, 0.75) - percentileSorted(sorted, 0.25),
    cv: mean === 0 ? 0 : stddev / mean,
  };
}

function percentileSorted(sorted: number[], percentile: number): number {
  if (sorted.length === 1) {
    return sorted[0];
  }

  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

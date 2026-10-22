export interface TimingStatistics {
  count: number;
  min: number;
  median: number;
  mean: number;
  max: number;
  cv?: number;
  /** Equal-tail 95% order-statistic interval for the median (6+ samples). */
  medianInterval?: [number, number];
  p95?: number;
  p99?: number;
  p95Interval?: [number, number];
  p99Interval?: [number, number];
}

/** R7 interpolation; samples are durations of a complete workload invocation. */
function quantile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  return (
    sorted[lower] +
    (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
  );
}

/** Equal-tail, distribution-free order-statistic interval under iid sampling. */
export function orderInterval(
  sorted: number[],
  p: number
): [number, number] | undefined {
  const n = sorted.length;
  let logChoose = 0,
    cumulative = 0,
    lower = -1,
    upper = -1;
  for (let k = 0; k <= n; k++) {
    if (k) logChoose += Math.log(n - k + 1) - Math.log(k);
    cumulative += Math.exp(
      logChoose + k * Math.log(p) + (n - k) * Math.log1p(-p)
    );
    if (lower < 0 && cumulative >= 0.025) lower = k;
    if (cumulative >= 0.975) {
      upper = k + 1;
      break;
    }
  }
  if (lower < 1 || upper > n || upper < 1) return undefined;
  return [sorted[lower - 1], sorted[upper - 1]];
}

export function timingStatistics(samples: readonly number[]): TimingStatistics {
  if (
    !samples.length ||
    samples.some((sample) => !Number.isFinite(sample) || sample <= 0)
  ) {
    throw new Error("Timing samples must be finite positive durations");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n > 1
      ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
      : undefined;
  const result: TimingStatistics = {
    count: n,
    min: sorted[0],
    median: quantile(sorted, 0.5),
    mean,
    max: sorted[n - 1],
    cv: variance === undefined ? undefined : Math.sqrt(variance) / mean,
    medianInterval: orderInterval(sorted, 0.5),
  };
  // At least ten expected observations beyond the target percentile.
  // This is an explicit reporting rule, not a claim of guaranteed precision.
  if (n >= 200) {
    result.p95 = quantile(sorted, 0.95);
    result.p95Interval = orderInterval(sorted, 0.95);
  }
  if (n >= 1000) {
    result.p99 = quantile(sorted, 0.99);
    result.p99Interval = orderInterval(sorted, 0.99);
  }
  return result;
}

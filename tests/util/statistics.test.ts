import { expect, test } from "vitest";
import { timingStatistics } from "../../src/util/statistics";

test("small runs never masquerade as tail estimates", () => {
  const stats = timingStatistics([1, 2, 3, 4, 5]);
  expect(stats.median).toBe(3);
  expect(stats.p95).toBeUndefined();
  expect(stats.p99).toBeUndefined();
});

test("reports percentiles only after the declared sample thresholds", () => {
  const medium = timingStatistics(Array.from({ length: 200 }, (_, i) => i + 1));
  expect(medium.p95).toBeCloseTo(190.05);
  expect(medium.p99).toBeUndefined();
  const large = timingStatistics(Array.from({ length: 1000 }, (_, i) => i + 1));
  expect(large.p95).toBeCloseTo(950.05);
  expect(large.p99).toBeCloseTo(990.01);
  for (const [value, interval] of [
    [large.p95, large.p95Interval],
    [large.p99, large.p99Interval],
  ] as const) {
    expect(interval![0]).toBeLessThan(value!);
    expect(interval![1]).toBeGreaterThan(value!);
    expect(interval![1]).toBeLessThanOrEqual(1000);
  }
});

test("rejects non-durations rather than silently dropping them", () => {
  for (const samples of [[], [0], [-1], [NaN], [Infinity]]) {
    expect(() => timingStatistics(samples)).toThrow("finite positive");
  }
});

test("median interval is distribution-free and needs at least six samples", () => {
  expect(timingStatistics([1, 2, 3, 4, 5]).medianInterval).toBeUndefined();
  // n=6: [x(1), x(6)] covers the median with probability 1 - 2/64.
  expect(timingStatistics([6, 1, 5, 2, 4, 3]).medianInterval).toEqual([1, 6]);
  const stats = timingStatistics(Array.from({ length: 100 }, (_, i) => i + 1));
  // Binomial(100, 0.5) equal-tail bounds: order statistics 40 and 61.
  expect(stats.medianInterval).toEqual([40, 61]);
});

test("statistics do not depend on sample order", () => {
  const chronological = [5, 1, 9, 3, 7, 2, 8];
  expect(timingStatistics(chronological)).toEqual(
    timingStatistics([...chronological].sort((a, b) => a - b))
  );
});

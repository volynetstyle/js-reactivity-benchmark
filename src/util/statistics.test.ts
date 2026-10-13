import { expect, test } from "vitest";
import { timingStatistics } from "./statistics";
import { measure } from "mitata";

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

test("mitata integration retains all 1000 samples including rare slow events", async () => {
  let clock = 0,
    calls = 0;
  const result = await measure(
    function* () {
      yield {
        [0]: () => null,
        bench: () => {
          clock += ++calls % 100 === 0 ? 10000 : 1;
        },
      };
    },
    {
      now: () => clock,
      gc: false,
      min_samples: 1000,
      max_samples: 1000,
      min_cpu_time: 0,
      warmup_samples: 0,
      batch_threshold: 0,
      samples_threshold: Infinity,
    }
  );
  expect(result.samples).toHaveLength(1000);
  expect(
    result.samples.filter((sample: number) => sample === 10000)
  ).toHaveLength(10);
});

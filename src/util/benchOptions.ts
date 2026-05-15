export function benchRunCount(): number {
  const parsed = Number.parseInt(process.env.BENCH_RUNS ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

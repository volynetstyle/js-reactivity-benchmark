import { registerBenchmark, runBenchmarks } from "../../src/util/benchmark";

const wait = (ms: number) => {
  const start = performance.now();
  while (performance.now() - start < ms) {
    /* synchronous workload */
  }
};

for (const framework of [
  "slow",
  "slow-setup",
  "cold-slow",
  "cold-hang",
  "alien-signals",
  "invalid",
]) {
  let invocation = 0;
  registerBenchmark({
    framework,
    name: "ceiling probe",
    gc: "throughput",
    setup: () => {
      wait(framework === "slow-setup" ? 150 : 1);
      return null;
    },
    benchmark: () => {
      invocation++;
      wait(
        (framework === "slow" && invocation > 3) ||
          (framework === "cold-hang" && invocation === 1)
          ? 10_000
          : framework === "cold-slow" && invocation === 1
            ? 150
            : 2
      );
      return framework === "invalid" ? -1 : 1;
    },
    validate: (value) => {
      if (value !== 1) throw new Error("wrong result");
    },
  });
}

runBenchmarks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

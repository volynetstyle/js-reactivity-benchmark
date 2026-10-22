import path from "node:path";
import catalog from "./frameworkCatalog.json";
import { registerFrameworkBenchmarks } from "./suite";
import { frameworkInfo } from "./config";
import { runBenchmarks, registerFrameworkWorker } from "./util/benchmark";

function getSelectedFrameworks() {
  const rawSelection = process.env.BENCH_FRAMEWORK?.trim();

  if (!rawSelection) {
    return frameworkInfo;
  }

  const selectedNames = new Set(
    rawSelection
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );

  const filteredFrameworks = frameworkInfo.filter(({ framework }) =>
    selectedNames.has(framework.name.toLowerCase())
  );

  if (filteredFrameworks.length === 0) {
    throw new Error(`No frameworks matched BENCH_FRAMEWORK="${rawSelection}".`);
  }

  return filteredFrameworks;
}

async function main() {
  const benchOnlyRaw = process.env.BENCH_ONLY?.trim().toLowerCase();
  const benchOnly = benchOnlyRaw?.replace(/\s+/g, "");
  const runCompareDeep =
    !benchOnly || benchOnly === "comparedeep" || benchOnly === "compare-deep";
  const runFrameworks =
    !benchOnly || benchOnly === "frameworks" || benchOnly === "reactive";

  if (benchOnly && !runCompareDeep && !runFrameworks) {
    throw new Error(
      `Unknown BENCH_ONLY="${benchOnlyRaw}". Use "compareDeep" or "frameworks".`
    );
  }

  // if (runCompareDeep) {
  //   await compareDeepBench();
  // }

  if (!runFrameworks) return;

  for (const frameworkTest of getSelectedFrameworks()) {
    const { framework } = frameworkTest;

    const entry = catalog.find((entry) => entry.name === framework.name);
    if (!entry)
      throw new Error(`Missing worker catalog entry for ${framework.name}`);
    registerFrameworkWorker(
      framework.name,
      path.join(__dirname, "workers", `${entry.id}.cjs`)
    );
    registerFrameworkBenchmarks(frameworkTest);
  }

  await runBenchmarks();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

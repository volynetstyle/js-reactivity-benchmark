import { dynamicBench } from "./dynamicBench";
// import { cellxbench } from "./cellxBench";
import { sbench } from "./sBench";
import { frameworkInfo } from "./config";
import { logPerfResult, perfReportHeaders } from "./util/perfLogging";
import { molBench } from "./molBench";
import { kairoBench } from "./kairoBench";

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
    throw new Error(
      `No frameworks matched BENCH_FRAMEWORK="${rawSelection}".`
    );
  }

  return filteredFrameworks;
}

async function main() {
  logPerfResult(perfReportHeaders());
  (globalThis as any).__DEV__ = true;

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

    await kairoBench(framework);
    await molBench(framework);
    sbench(framework);

    // MobX, Valtio, and Svelte fail this test currently, so disabling it for now.
    // @see https://github.com/mobxjs/mobx/issues/3926
    // @see https://github.com/sveltejs/svelte/discussions/13277
    // cellxbench(framework);

    await dynamicBench(frameworkTest);

    globalThis.gc?.();
  }
}

main();

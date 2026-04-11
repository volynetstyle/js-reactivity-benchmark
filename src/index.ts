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

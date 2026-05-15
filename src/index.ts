import { dynamicBench } from "./dynamicBench";
import { sBenchCaseNames, sbench } from "./sBench";
import { frameworkInfo, perfTests } from "./config";
import { logPerfResult, perfReportHeaders } from "./util/perfLogging";
import { benchRunCount } from "./util/benchOptions";
import { molBench, molBenchCaseNames } from "./molBench";
import { kairoBench, kairoBenchCaseNames } from "./kairoBench";
import { fanBench, fanBenchCaseNames } from "./fanBench";
import { fork } from "node:child_process";

export type BenchSuite = "kairo" | "fan" | "mol" | "s" | "dynamic";

export interface BenchScenario {
  suite: BenchSuite;
  name: string;
}

export const benchScenarios: BenchScenario[] = [
  ...kairoBenchCaseNames.map((name) => ({ suite: "kairo" as const, name })),
  ...fanBenchCaseNames.map((name) => ({ suite: "fan" as const, name })),
  ...molBenchCaseNames.map((name) => ({ suite: "mol" as const, name })),
  ...sBenchCaseNames.map((name) => ({ suite: "s" as const, name })),
  ...perfTests.map((config) => ({ suite: "dynamic" as const, name: config.name })),
];

export function getSelectedFrameworks() {
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

// When spawned as a child process, run only the specified framework and exit.
// This ensures each framework gets a clean V8 JIT state.
const CHILD_FRAMEWORK_ENV = "__BENCH_CHILD_FRAMEWORK__";
const CHILD_SUITE_ENV = "__BENCH_CHILD_SUITE__";
const CHILD_SCENARIO_ENV = "__BENCH_CHILD_SCENARIO__";

export async function runScenario(
  frameworkName: string,
  suite: BenchSuite,
  scenarioName: string
) {
  const frameworkTest = frameworkInfo.find(
    ({ framework }) =>
      framework.name.toLowerCase() === frameworkName.toLowerCase()
  );
  if (!frameworkTest) {
    throw new Error(`Unknown framework: ${frameworkName}`);
  }

  const { framework } = frameworkTest;

  switch (suite) {
    case "kairo":
      await kairoBench(framework, scenarioName);
      break;
    case "fan":
      await fanBench(framework, scenarioName);
      break;
    case "mol":
      await molBench(framework, scenarioName);
      break;
    case "s":
      sbench(framework, scenarioName);
      break;
    case "dynamic":
      await dynamicBench(frameworkTest, benchRunCount(), scenarioName);
      break;
    default:
      throw new Error(`Unknown benchmark suite: ${suite}`);
  }

  globalThis.gc?.();
}

// Spawn a child process for each scenario so V8 JIT, heap state, subscriptions,
// and library-level caches cannot leak between benchmark rows.
export function runScenarioIsolated(
  frameworkName: string,
  scenario: BenchScenario
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, [], {
      env: {
        ...process.env,
        [CHILD_FRAMEWORK_ENV]: frameworkName,
        [CHILD_SUITE_ENV]: scenario.suite,
        [CHILD_SCENARIO_ENV]: scenario.name,
      },
      // Pass --expose-gc so child can call globalThis.gc()
      execArgv: [
        ...process.execArgv.filter((a) => a !== "--expose-gc"),
        "--expose-gc",
      ],
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Child process for "${frameworkName}/${scenario.suite}/${scenario.name}" exited with code ${code}`
          )
        );
    });
    child.on("error", reject);
  });
}

export async function main() {
  // Child process: run one framework/scenario pair and exit.
  const childFramework = process.env[CHILD_FRAMEWORK_ENV];
  if (childFramework) {
    const childSuite = process.env[CHILD_SUITE_ENV] as BenchSuite | undefined;
    const childScenario = process.env[CHILD_SCENARIO_ENV];
    if (!childSuite || !childScenario) {
      throw new Error("Child benchmark process is missing scenario selection.");
    }

    (globalThis as any).__DEV__ = true;
    await runScenario(childFramework, childSuite, childScenario);
    return;
  }

  // Parent process: spawn one child per benchmark row.
  logPerfResult(perfReportHeaders());
  (globalThis as any).__DEV__ = true;

  const benchOnlyRaw = process.env.BENCH_ONLY?.trim().toLowerCase();
  const benchOnly = benchOnlyRaw?.replace(/\s+/g, "");
  const runFrameworks =
    !benchOnly || benchOnly === "frameworks" || benchOnly === "reactive";

  if (benchOnly && !runFrameworks) {
    throw new Error(`Unknown BENCH_ONLY="${benchOnlyRaw}". Use "frameworks".`);
  }

  if (!runFrameworks) return;

  for (const { framework } of getSelectedFrameworks()) {
    for (const scenario of benchScenarios) {
      await runScenarioIsolated(framework.name, scenario);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

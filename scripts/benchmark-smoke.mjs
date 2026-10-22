import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseBenchOutput } from "./render-results-page.mjs";

const outputPath = path.resolve("tmp/ci-benchmark.samples.json");
await mkdir(path.dirname(outputPath), { recursive: true });
const selections = [
  {
    framework: "reflex,lite-signal",
    filter:
      "diamond,manySourcesIntoOneComputedEffect,molBench,mutable-object/,lifecycle/,createComputations1to1",
  },
  { framework: "alien-signals", filter: "dynamic/layered full-drain warm" },
  {
    framework: "reactive-engine",
    filter:
      "diamond,manySourcesIntoOneComputedEffect,dynamic/layered full-drain warm,dynamic/pure push,createComputations1to1",
  },
  { framework: "s-js,SolidJS", filter: "dynamic/pure push" },
  {
    // Production builds and native effect wiring for every adapter.
    framework:
      "@vue/reactivity,Preact Signals,Oby,@reactively,@solidjs/signals,$mol_wire,Signia,uSignal,@amadeus-it-group/tansu",
    filter: "diamond,molBench",
  },
];
let checked = 0;
for (const selection of selections) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", "dist/index.js"], {
      env: {
        ...process.env,
        BENCH_IN_PROCESS: "",
        BENCH_CASE: "",
        BENCH_PROFILE: "quick",
        BENCH_SAMPLES: "2",
        BENCH_INSTRUMENT: "",
        BENCH_ASSERT_NO_CONSOLE: "1",
        BENCH_FRAMEWORK: selection.framework,
        BENCH_FILTER: selection.filter,
        BENCH_SAMPLES_FILE: outputPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(text)
        : reject(new Error(`Benchmark smoke exited ${code}`))
    );
  });
  const parsed = parseBenchOutput(stdout);
  const raw = JSON.parse(await readFile(outputPath, "utf8"));
  if (
    raw.semantics !== "v4" ||
    raw.nodeEnv !== "production" ||
    raw.rows.length !== parsed.rows.length ||
    raw.rows.some(
      (row) =>
        row.validation !== "passed" ||
        row.rounds.some((round) => round.samplesMs.length !== 2) ||
        !Object.keys(raw.packages[row.framework] ?? {}).length
    )
  ) {
    throw new Error("Missing validated samples in benchmark smoke");
  }
  checked += raw.rows.length;
}
// One summary outside every timed process; no timings are used as CI thresholds.
console.log(`Benchmark smoke passed: ${checked} validated isolated rows.`);

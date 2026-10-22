import { spawn } from "node:child_process";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBenchOutput } from "./render-results-page.mjs";
import { mergeShards } from "./merge-shards.mjs";

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
    // Native nodes with prototype accessors require the harness to preserve
    // `this` in one-source creation and update rows (including 1-to-1000).
    framework: "$mol_wire",
    filter: "createComputations1to1,updateComputations1to1",
  },
  {
    // Production builds and native effect wiring for every adapter.
    framework:
      "@vue/reactivity,Preact Signals,Oby,@reactively,@solidjs/signals,$mol_wire,Signia,uSignal,@amadeus-it-group/tansu",
    filter: "diamond,molBench",
  },
  {
    // Second generations and architectural families: production workers,
    // native lifecycle where claimed, and the cellx layer workload.
    framework:
      "@solidjs/signals 2 RC,SolidJS 2 RC,@vue/reactivity 3.6 RC,dalien-signals,anod,@reatom/core,@maverick-js/signals,cellx,rescript-signals",
    // "diamond" would also select the mesh graph rows, on which Reatom 1001
    // exhausts a 4 GB heap (its retained memory grows with graph depth);
    // full runs record that as a failed row.
    filter: "mux,molBench,lifecycle/,cellx1000",
  },
];

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", "dist/index.js"], {
      env: {
        ...process.env,
        BENCH_IN_PROCESS: "",
        BENCH_CASE: "",
        BENCH_SHARD: "",
        BENCH_PROFILE: "quick",
        BENCH_SAMPLES: "2",
        BENCH_INSTRUMENT: "",
        BENCH_ASSERT_NO_CONSOLE: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    // Forward diagnostics, not the per-row progress lines.
    child.stderr.on("data", (chunk) => {
      const lines = String(chunk)
        .split("\n")
        .filter((line) => line && !/^\[\d+\/\d+\] round /.test(line));
      if (lines.length) process.stderr.write(lines.join("\n") + "\n");
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(text)
        : reject(new Error(`Benchmark smoke exited ${code}`))
    );
  });
}

let checked = 0;
for (const selection of selections) {
  const stdout = await run({
    BENCH_FRAMEWORK: selection.framework,
    BENCH_FILTER: selection.filter,
    BENCH_SAMPLES_FILE: outputPath,
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

// The CI publication path: real scenario shards merged into one page.
const shardDir = path.resolve("tmp/ci-shards");
await rm(shardDir, { recursive: true, force: true });
await mkdir(shardDir, { recursive: true });
const shardSelection = {
  BENCH_FRAMEWORK: "reflex,alien-signals,SolidJS",
  BENCH_FILTER: "diamond,mux,triangle,dynamic/pure pull",
};
for (const shard of ["1/2", "2/2"]) {
  const name = `shard-1-${shard[0]}`;
  const stdout = await run({
    ...shardSelection,
    BENCH_SHARD: shard,
    BENCH_SAMPLES_FILE: path.join(shardDir, `${name}.samples.json`),
  });
  await writeFile(path.join(shardDir, `${name}.log`), stdout);
}
const merged = await mergeShards(shardDir, {
  logPath: path.join(shardDir, "merged", "latest.log"),
  samplesPath: path.join(shardDir, "merged", "latest.samples.json"),
  htmlPath: path.join(shardDir, "merged", "index.html"),
});
const unsharded = parseBenchOutput(
  await run({ ...shardSelection, BENCH_SAMPLES_FILE: "" })
);
if (merged.rows !== unsharded.rows.length)
  throw new Error(
    `Merged shards produced ${merged.rows} rows, an unsharded run ${unsharded.rows.length}`
  );

// One summary outside every timed process; no timings are used as CI thresholds.
console.log(
  `Benchmark smoke passed: ${checked} validated isolated rows; ${merged.rows} rows from ${merged.shards} merged shards.`
);

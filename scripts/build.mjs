import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const catalog = JSON.parse(await readFile("src/frameworkCatalog.json", "utf8"));
await mkdir("dist/workers", { recursive: true });
const options = {
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: "external",
  external: ["bun:jsc", "@mitata/counters", "@solidjs/signals"],
  logLevel: "warning",
};
await build({
  ...options,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});
// Compilation can run concurrently; measurement workers always remain serial.
await Promise.all(
  catalog.map((entry) =>
    build({
      ...options,
      outfile: `dist/workers/${entry.id}.cjs`,
      stdin: {
        loader: "ts",
        resolveDir: path.resolve("src"),
        sourcefile: `worker-${entry.id}.ts`,
        contents: `
      import { ${entry.export} as framework } from "./frameworks/${entry.module}";
      import { registerFrameworkBenchmarks } from "./suite";
      import { runBenchmarks } from "./util/benchmark";
      registerFrameworkBenchmarks({ framework, testPullCounts: ${!!entry.pullCounts} });
      runBenchmarks().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      },
    })
  )
);
console.log(`Built runner and ${catalog.length} isolated framework workers.`);

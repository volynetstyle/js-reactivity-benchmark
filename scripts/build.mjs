import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Loaded at runtime with require() (see src/frameworks/solid-signals.ts).
const RUNTIME_EXTERNALS = ["@solidjs/signals"];

const catalog = JSON.parse(await readFile("src/frameworkCatalog.json", "utf8"));
await mkdir("dist/workers", { recursive: true });
const options = {
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: "external",
  external: RUNTIME_EXTERNALS,
  // Libraries must run their production builds. Without this, packages that
  // select a build from process.env.NODE_ENV at runtime (e.g. @vue/reactivity)
  // silently run their development build with debug hooks and warnings.
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
};
await build({
  ...options,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});
// Compilation can run concurrently; measurement workers always remain serial.
await Promise.all(
  catalog.map(async (entry) => {
    const result = await build({
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
    });
    const inputs = Object.keys(result.metafile.inputs);
    const development = inputs.filter(hasProductionTwin);
    if (development.length)
      throw new Error(
        `${entry.id} bundles development builds: ${development.join(", ")}`
      );
    const externals = Object.values(result.metafile.outputs).flatMap((output) =>
      output.imports.filter((item) => item.external).map((item) => item.path)
    );
    await writeFile(
      `dist/workers/${entry.id}.packages.json`,
      JSON.stringify(bundledPackages(inputs, externals), null, 2) + "\n"
    );
  })
);
console.log(`Built runner and ${catalog.length} isolated framework workers.`);

/** A bundled file is a development build when its production twin exists. */
function hasProductionTwin(file) {
  const twins = [
    file.replace(/\.cjs\.js$/, ".cjs.prod.js"),
    file.replace(/([\\/])dev\.([cm]?js)$/, "$1prod.$2"),
    file.replace(/\.development\.([cm]?js)$/, ".production.$1"),
    file.replace(/\.development\.([cm]?js)$/, ".production.min.$1"),
  ];
  return twins.some((twin) => twin !== file && existsSync(twin));
}

/** name -> version for every package bundled into, or required by, a worker. */
function bundledPackages(inputs, externals) {
  const packages = {};
  const roots = inputs.flatMap(
    (input) =>
      input.match(/^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/)?.[1] ?? []
  );
  for (const name of RUNTIME_EXTERNALS)
    if (externals.includes(name)) roots.push(path.join("node_modules", name));
  for (const root of roots) {
    const manifest = path.join(root, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
    packages[name] = version;
  }
  return Object.fromEntries(
    Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))
  );
}

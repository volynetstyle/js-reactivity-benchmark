import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { moduleAliases, projectRoot } from "./module-aliases.mjs";

const outputDir = path.join(projectRoot, "dist");
const catalog = JSON.parse(
  await readFile(path.join(projectRoot, "src/frameworkCatalog.json"), "utf8")
);
await mkdir(path.join(outputDir, "workers"), { recursive: true });
const options = {
  absWorkingDir: projectRoot,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  conditions: ["production", "module"],
  treeShaking: true,
  minifyWhitespace: true,
  sourcemap: "external",
  alias: moduleAliases,
  // Libraries must run their production builds. Without this, packages that
  // select a build from process.env.NODE_ENV at runtime (e.g. @vue/reactivity)
  // silently run their development build with debug hooks and warnings.
  define: { "process.env.NODE_ENV": '"production"' },
  // Also set the real environment before dependencies initialize (and for
  // diagnostic code that reads process.env dynamically).
  banner: { js: 'process.env.NODE_ENV = "production";' },
  metafile: true,
  logLevel: "warning",
};
const runner = await build({
  ...options,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});
validateBundle("runner", runner);
// Compilation can run concurrently; measurement workers always remain serial.
await Promise.all(
  catalog.map(async (entry) => {
    const result = await build({
      ...options,
      outfile: `dist/workers/${entry.id}.cjs`,
      stdin: {
        loader: "ts",
        resolveDir: path.join(projectRoot, "src"),
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
    const inputs = validateBundle(entry.id, result);
    // Everything a worker executes must be bundled: a package resolved at run
    // time escapes the production-build and version checks, and can resolve
    // to a different version than the adapter imported. (`require.resolve`
    // only locates a file, for the BENCH_INSTRUMENT diagnostic mode.)
    await writeFile(
      path.join(outputDir, "workers", `${entry.id}.packages.json`),
      JSON.stringify(bundledPackages(entry.id, inputs), null, 2) + "\n"
    );
  })
);
await writeFile(
  path.join(outputDir, "package.json"),
  JSON.stringify({ private: true, type: "commonjs" }) + "\n"
);
console.log(
  `Built production runner and ${catalog.length} isolated framework workers.`
);

function validateBundle(id, result) {
  const inputs = Object.keys(result.metafile.inputs);
  const development = inputs.filter(hasProductionTwin);
  if (development.length)
    throw new Error(
      `${id} bundles development builds: ${development.join(", ")}`
    );
  const tests = inputs.filter((file) =>
    /(?:^|[\\/])tests[\\/]|\.test\.[cm]?[jt]s$/.test(file)
  );
  if (tests.length) throw new Error(`${id} bundles tests: ${tests.join(", ")}`);
  const externals = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports
      .filter(
        (item) =>
          item.external &&
          item.kind !== "require-resolve" &&
          !isBuiltin(item.path)
      )
      .map((item) => item.path)
  );
  if (externals.length)
    throw new Error(`${id} leaves packages external: ${externals.join(", ")}`);
  return inputs;
}

/** A bundled file is a development build when its production twin exists. */
function hasProductionTwin(file) {
  const twins = [
    file.replace(/\.cjs\.js$/, ".cjs.prod.js"),
    file.replace(/([\\/])dev\.([cm]?js)$/, "$1prod.$2"),
    file.replace(/\.development\.([cm]?js)$/, ".production.$1"),
    file.replace(/\.development\.([cm]?js)$/, ".production.min.$1"),
  ];
  return twins.some(
    (twin) => twin !== file && existsSync(path.resolve(projectRoot, twin))
  );
}

/**
 * name -> version for every package bundled into a worker. Two versions of
 * one package in a worker mean an adapter measures something other than its
 * label (e.g. a shared module that pulls in a second library generation).
 */
function bundledPackages(id, inputs) {
  const packages = {};
  const roots = new Set(
    inputs.flatMap(
      (input) =>
        input.match(/^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/)?.[1] ??
        []
    )
  );
  for (const root of roots) {
    const manifest = path.resolve(projectRoot, root, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
    if (packages[name] && packages[name] !== version)
      throw new Error(
        `${id} bundles two versions of ${name}: ${packages[name]} and ${version}`
      );
    packages[name] = version;
  }
  return Object.fromEntries(
    Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))
  );
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "./module-aliases.mjs";

// Run only the deployable files, outside the repository's node_modules tree.
const temporaryRoot = path.resolve(tmpdir());
const directory = await mkdtemp(
  path.join(temporaryRoot, "reactivity-production-")
);
try {
  await cp(path.join(projectRoot, "dist"), path.join(directory, "dist"), {
    recursive: true,
  });
  const catalog = JSON.parse(
    await readFile(path.join(projectRoot, "src/frameworkCatalog.json"), "utf8")
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("BENCH_"))
  );
  Object.assign(env, {
    NODE_ENV: "development", // The bundle must establish the real production environment.
    BENCH_FILTER: "mux",
    BENCH_SAMPLES: "1",
    BENCH_ASSERT_NO_CONSOLE: "1",
    BENCH_SAMPLES_FILE: "samples.json",
  });
  const source = `
    require("./dist/index.js");
    process.on("exit", () => {
      if (process.env.NODE_ENV !== "production") throw new Error("Runtime is not in production mode");
    });
  `;
  // A file keeps --eval out of process.execArgv inherited by row workers.
  await writeFile(path.join(directory, "verify-runtime.cjs"), source);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--expose-gc", "verify-runtime.cjs"],
      {
        cwd: directory,
        env,
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-8192);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Standalone runner failed (${code ?? signal}): ${diagnostics}`
          )
        );
    });
  });
  const result = JSON.parse(
    await readFile(path.join(directory, "samples.json"), "utf8")
  );
  assert.equal(result.nodeEnv, "production");
  assert.equal(result.isolation, "row");
  assert.deepEqual(
    result.rows.map((row) => row.framework).sort(),
    catalog.map((entry) => entry.name).sort()
  );
  assert.ok(result.rows.every((row) => row.validation === "passed"));
  console.log(
    `Production verification passed: ${result.rows.length} frameworks run from standalone dist/.`
  );
} finally {
  // Cleanup is restricted to the temporary directory allocated above.
  assert.equal(path.dirname(directory), temporaryRoot);
  assert.ok(path.basename(directory).startsWith("reactivity-production-"));
  await rm(directory, { recursive: true, force: true });
}

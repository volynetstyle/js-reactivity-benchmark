import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { updateResultsPage } from "./render-results-page.mjs";

const LOG_DIR = path.resolve("bench-results");
const LOG_PATH = path.join(LOG_DIR, "latest.log");
const HTML_PATH = path.resolve("index.html");

async function runBench() {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", ["--expose-gc", "dist/index.js"], {
      cwd: process.cwd(),
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark process exited with code ${code}.`));
        return;
      }

      resolve(stdout);
    });
  });
}

async function main() {
  const stdout = await runBench();

  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(LOG_PATH, stdout, "utf8");

  const { parsed } = await updateResultsPage({
    inputPath: LOG_PATH,
    outputPath: HTML_PATH,
    sourceLabel: `Auto-generated from ${path.relative(process.cwd(), LOG_PATH)}`,
  });

  console.log(
    `Updated ${path.relative(process.cwd(), HTML_PATH)} using ${parsed.rows.length} benchmark rows.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

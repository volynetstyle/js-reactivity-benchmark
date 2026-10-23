import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./module-aliases.mjs";

/**
 * Published measurements use exactly the Node.js release in `.nvmrc` (and so
 * exactly one V8). Without an argument, check the running Node.js; with a
 * samples file, check the runtime recorded in it.
 */
const pinned = (
  await readFile(path.join(projectRoot, ".nvmrc"), "utf8")
).trim();
if (!/^\d+\.\d+\.\d+$/.test(pinned))
  throw new Error(
    `.nvmrc must pin an exact major.minor.patch release: ${pinned}`
  );

const samplesPath = process.argv[2];
const runtime = samplesPath
  ? JSON.parse(await readFile(path.resolve(samplesPath), "utf8"))
  : { node: process.version, v8: process.versions.v8 };
if (runtime.node !== `v${pinned}`)
  throw new Error(
    `${samplesPath ?? "This process"} uses Node.js ${runtime.node}; publication requires v${pinned} from .nvmrc`
  );
console.log(`Node.js ${runtime.node} (V8 ${runtime.v8}) matches .nvmrc`);

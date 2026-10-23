import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Module aliases shared by the benchmark build and the test runner, so both
 * load the same files.
 *
 * solid-js 2 maps the `node` export condition to its non-reactive SSR build
 * and no longer exports `./dist/*`. Package "imports" cannot point into
 * node_modules, so the reactive client build is aliased by file path.
 */
export const moduleAliases = {
  "solid-js-2-client": path.join(
    projectRoot,
    "node_modules/solid-js-2/dist/solid.js"
  ),
};

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

test("measured workloads and adapters never call console", () => {
  const files = [
    "sBench.ts",
    "kairoBench.ts",
    "fanBench.ts",
    "molBench.ts",
    "lifecycleBench.ts",
    "dynamicBench.ts",
    "cellxBench.ts",
    "util/dependencyGraph.ts",
    "util/delivery.ts",
    "util/fixtureScope.ts",
    "kairo/observed.ts",
    "kairo/util/index.ts",
    ...readdirSync("src/frameworks")
      .filter((file) => file.endsWith(".ts"))
      .map((file) => path.join("frameworks", file)),
  ];
  for (const file of files) {
    expect(readFileSync(path.join("src", file), "utf8"), file).not.toMatch(
      /\bconsole\s*(?:\.|\[)/
    );
  }
});

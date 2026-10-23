import { expect, test, vi } from "vitest";
import { logPerfResult } from "../../src/util/perfLogging";
import { parseBenchOutput } from "../../scripts/render-results-page.mjs";

test("padding preserves complete scenario identities and diagnostic values", () => {
  const output: string[] = [];
  const logger = vi
    .spyOn(console, "log")
    .mockImplementation((line) => output.push(line));
  try {
    for (const suffix of ["cold", "warm"]) {
      logPerfResult({
        framework: "@amadeus-it-group/tansu",
        test:
          "a graph description longer than sixty columns with identical prefix " +
          suffix,
        time: "12.50",
        metrics: "samples=3 " + "diagnostic ".repeat(15),
      });
    }
  } finally {
    logger.mockRestore();
  }
  const parsed = parseBenchOutput(output.join("\n"));
  expect(parsed.tests).toHaveLength(2);
  expect(parsed.frameworks[0].name).toBe("@amadeus-it-group/tansu");
  expect(output[0]).toContain("diagnostic ".repeat(15));
});

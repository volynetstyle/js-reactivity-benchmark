import { describe, expect, test } from "vitest";
import { parseBenchOutput } from "./render-results-page.mjs";

describe("benchmark result quality", () => {
  test("reads capped status from the compact mitata format", () => {
    const parsed = parseBenchOutput(
      "slow-lib , scenario , 1800.00 , SLOW/CAPPED samples=1 ceiling=1500ms"
    );

    expect(parsed.rows[0].capped).toBe(true);
    expect(parsed.frameworks[0].entries[0].capped).toBe(true);
  });

  test("keeps expanded historical rows compatible", () => {
    const parsed = parseBenchOutput(
      "fast-lib , scenario , 10.00 , 12.00 , 14.00 , 0.050 , update , stable update , checksum=1"
    );

    expect(parsed.rows[0]).toMatchObject({
      capped: false,
      group: "update",
      family: "stable update",
    });
  });
});

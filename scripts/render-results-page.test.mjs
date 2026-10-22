import { describe, expect, test } from "vitest";
import {
  intervalsOverlap,
  parseBenchOutput,
  renderResultsPage,
} from "./render-results-page.mjs";

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

test("overall scores use the same scenario intersection despite lifecycle gaps", () => {
  const parsed = parseBenchOutput(
    [
      "a , common , 10 , , , , update , stable , samples=3",
      "b , common , 20 , , , , update , stable , samples=3",
      "b , optional lifecycle , 0.001 , , , , lifecycle , native , samples=3",
    ].join("\n")
  );
  expect(parsed.commonTests).toEqual(["common"]);
  expect(parsed.frameworks.map((framework) => framework.relativeScore)).toEqual(
    [1, 2]
  );
});

test("rejects duplicate and zero-duration rows rather than inventing a winner", () => {
  expect(() => parseBenchOutput("a , common , 1\na , common , 2")).toThrow(
    "Duplicate result"
  );
  expect(() => parseBenchOutput("a , common , 0")).toThrow("Invalid duration");
});

test("tail evidence is retained and insufficient claims are rejected", () => {
  const parsed = parseBenchOutput(
    "a , common , 1 , 2 , 3 , 0.1 , update , stable , samples=1000 p99_ci95=2.5..4.5"
  );
  expect(parsed.rows[0].p99Interval).toEqual([2.5, 4.5]);
  expect(() =>
    parseBenchOutput(
      "a , common , 1 , 2 , 3 , 0.1 , update , stable , samples=5"
    )
  ).toThrow("Insufficient samples");
});

test("run metadata and measured package versions are parsed from the header", () => {
  const parsed = parseBenchOutput(
    [
      "# semantics=v4 profile=quick rounds=1 node=v24.0.0 node_env=production",
      "# package Preact Signals | @preact/signals-core@1.14.4",
      "a , common , 1 , , , , update , stable , samples=10",
    ].join("\n")
  );
  expect(parsed.meta).toMatchObject({
    semantics: "v4",
    node_env: "production",
  });
  expect(parsed.packages).toEqual({
    "Preact Signals": ["@preact/signals-core@1.14.4"],
  });
  expect(renderResultsPage(parsed)).toContain("@preact/signals-core@1.14.4");
});

test("overlapping median intervals are ties, not wins", () => {
  const log = (bInterval) =>
    [
      "a , t , 1.00 , , , , update , stable , samples=10 median_ci95=0.9..1.1",
      `b , t , 1.05 , , , , update , stable , samples=10 median_ci95=${bInterval}`,
    ].join("\n");
  const tied = parseBenchOutput(log("1.0..1.2"));
  expect(intervalsOverlap(tied.rows[0], tied.rows[1])).toBe(true);
  const tiedPage = renderResultsPage(tied);
  expect(tiedPage).toContain("+5.0% ≈");
  expect(tiedPage).toContain("0 decisive test wins");

  const clear = parseBenchOutput(log("1.2..1.3"));
  expect(intervalsOverlap(clear.rows[0], clear.rows[1])).toBe(false);
  expect(renderResultsPage(clear)).toContain("1 decisive test wins");
});

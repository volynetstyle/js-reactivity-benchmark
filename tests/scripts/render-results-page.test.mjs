import { describe, expect, test } from "vitest";
import {
  describeInterval,
  decisive,
  intervalsOverlap,
  parseBenchOutput,
  rangeCoverage,
  renderResultsPage,
} from "../../scripts/render-results-page.mjs";
import { pairedComparison } from "../../scripts/paired-statistics.mjs";

test("stress failures and lifecycle gaps leave a common core leaderboard with explicit coverage", () => {
  const parsed = parseBenchOutput(
    [
      "a , common , 10 , , , , update , stable , samples=10",
      "b , common , 20 , , , , update , stable , samples=10",
      'a , heavy , FAILED , , , , large_graph , dag , FAILED kind=stack-overflow reason="deep graph"',
      "b , heavy , >1500 , , , , large_graph , dag , CENSORED samples=0 ceiling=1500ms",
      'a , native lifecycle , FAILED , , , , lifecycle , native , FAILED kind=error reason="dispose"',
    ].join("\n")
  );
  expect(parsed.commonTests).toEqual(["common"]);
  expect(
    parsed.frameworks.map(({ name, relativeScore, unranked }) => [
      name,
      relativeScore,
      unranked,
    ])
  ).toEqual([
    ["a", 1, false],
    ["b", 2, false],
  ]);
  expect(parsed.frameworks[0].stressCoverage).toMatchObject({
    completed: 0,
    total: 1,
    failed: 1,
  });
  expect(parsed.frameworks[1].capabilityCoverage).toMatchObject({
    total: 1,
    unsupported: 1,
  });
  const html = renderResultsPage(parsed);
  expect(html).toContain(
    "3 scenarios total · 1 in core performance score · 1 stress / scalability scenarios · 1 lifecycle capability scenarios"
  );
  expect(html).toContain("Stress / Scalability Suite");
  expect(html).toContain("Stress coverage: 0/1 completed · 1 failed");
  expect(html).toContain("FAILED");
  expect(html).toContain("CENSORED");
});

test("no shared core evidence gives every framework no score, including stress-only runs", () => {
  for (const log of [
    "a , t , 1\nb , t , >1500 , CENSORED samples=0 ceiling=1500ms",
    "a , stress , 1 , , , , large_graph , dag , samples=10",
    'a , core , FAILED , , , , update , stable , FAILED kind=incorrect reason="wrong value"',
  ]) {
    const parsed = parseBenchOutput(log);
    expect(parsed.commonTests).toEqual([]);
    expect(
      parsed.frameworks.every(
        (framework) =>
          framework.unranked && Number.isNaN(framework.relativeScore)
      )
    ).toBe(true);
    expect(renderResultsPage(parsed)).toContain("No ranked results");
  }
});

test("partial evidence pairs only identical machine IDs and never invents missing hosts", () => {
  const left = {
    partial: true,
    machineIds: [1, 3],
    machineEstimates: [10, 40],
    processEstimates: [
      [9, 10, 11],
      [36, 40, 44],
    ],
  };
  const right = {
    machineIds: [1, 2, 3],
    machineEstimates: [20, 800, 80],
    processEstimates: [
      [18, 20, 22],
      [700, 800, 900],
      [72, 80, 88],
    ],
  };
  expect(pairedComparison(left, right)).toMatchObject({
    machineRatios: [0.5, 0.5],
    processRatios: [
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ],
  });
  expect(
    pairedComparison(left, { machineIds: [2], machineEstimates: [800] })
  ).toBeUndefined();
  expect(
    pairedComparison({ ...left, machineIds: undefined }, right)
  ).toBeUndefined();
});

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

test("censored pilots never set the best time or enter an exact score", () => {
  const parsed = parseBenchOutput(
    [
      "a , t , 2000 , , , , update , stable , samples=10",
      "b , t , >1500 , , , , update , stable , CENSORED samples=0 ceiling=1500ms",
      "a , common , 1 , , , , update , stable , samples=10",
      "b , common , 2 , , , , update , stable , samples=10",
    ].join("\n")
  );
  expect(parsed.frameworks[0]).toMatchObject({ name: "a", relativeScore: 1 });
  expect(parsed.frameworks[1]).toMatchObject({
    name: "b",
    unranked: false,
    relativeScore: 2,
  });
  expect(parsed.commonTests).toEqual(["common"]);
  expect(renderResultsPage(parsed)).toContain("&gt;1500.00 ms");
  expect(renderResultsPage(parsed)).toContain(
    "1 core scenarios excluded for all participants"
  );
});

test("an entirely censored publication renders without inventing a leader", () => {
  const parsed = parseBenchOutput(
    "a , t , >1500 , CENSORED samples=0 ceiling=1500ms"
  );
  expect(renderResultsPage(parsed)).toContain("No ranked results");
});

test("families have equal weight and the flat score remains available", () => {
  const parsed = parseBenchOutput(
    [
      "a , u1 , 1 , , , , update , stable , samples=10",
      "a , u2 , 1 , , , , update , stable , samples=10",
      "a , c1 , 9 , , , , creation , allocation , samples=10",
      "b , u1 , 3 , , , , update , stable , samples=10",
      "b , u2 , 3 , , , , update , stable , samples=10",
      "b , c1 , 1 , , , , creation , allocation , samples=10",
    ].join("\n")
  );
  const a = parsed.frameworks.find((framework) => framework.name === "a");
  const b = parsed.frameworks.find((framework) => framework.name === "b");
  expect(a.relativeScore).toBeCloseTo(3);
  expect(b.relativeScore).toBeCloseTo(Math.sqrt(3));
  expect(a.flatScore).toBeCloseTo(9 ** (1 / 3));
  expect(b.flatScore).toBeCloseTo(9 ** (1 / 3));
});

test("paired machine ratios cancel shared host speed despite overlapping absolute ranges", () => {
  const parsed = parseBenchOutput(
    [
      "a , t , 2 , , , , update , stable , samples=30 machines=3 machine_range=1..4 machine_estimates=1;2;4",
      "b , t , 2.8 , , , , update , stable , samples=30 machines=3 machine_range=1.4..5.6 machine_estimates=1.4;2.8;5.6",
    ].join("\n")
  );
  expect(intervalsOverlap(...parsed.rows)).toBe(false);
  expect(decisive(...parsed.rows)).toBe(true);
  expect(renderResultsPage(parsed)).toContain("1 decisive test wins");
});

test("paired ratios crossing 1 preclude a decisive win", () => {
  const parsed = parseBenchOutput(
    [
      "a , t , 2 , , , , update , stable , samples=30 machines=3 machine_range=1..4 machine_estimates=1;2;4",
      "b , t , 3 , , , , update , stable , samples=30 machines=3 machine_range=0.9..6 machine_estimates=0.9;3;6",
    ].join("\n")
  );
  expect(intervalsOverlap(...parsed.rows)).toBe(true);
  expect(decisive(...parsed.rows)).toBe(false);
});

test("matched process ratios are used on a single machine", () => {
  const parsed = parseBenchOutput(
    [
      "a , t , 2 , , , , update , stable , samples=30 round_range=1..4 process_estimates=1;2;4",
      "b , t , 3 , , , , update , stable , samples=30 round_range=1.5..6 process_estimates=1.5;3;6",
    ].join("\n")
  );
  expect(decisive(...parsed.rows)).toBe(true);
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

test("failed rows are results: shown, not scored, and never ranked on a subset", () => {
  const parsed = parseBenchOutput(
    [
      "a , easy , 1 , , , , update , stable , samples=10",
      "b , easy , 2 , , , , update , stable , samples=10",
      "c , easy , 0.5 , , , , update , stable , samples=10",
      "a , hard , 10 , , , , update , dag , samples=10",
      "b , hard , 20 , , , , update , dag , samples=10",
      'c , hard , FAILED , , , , update , dag , FAILED kind=out-of-memory reason="worker exited with code 134"',
    ].join("\n")
  );
  const c = parsed.frameworks.find((framework) => framework.name === "c");
  expect(c).toMatchObject({ unranked: true });
  expect(c.failedTests[0].failure).toEqual({
    kind: "out-of-memory",
    reason: "worker exited with code 134",
  });
  // c still sets the best time where it succeeded...
  expect(parsed.frameworks.map((framework) => framework.name)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(parsed.frameworks[0].relativeScore).toBeCloseTo(Math.sqrt(2));
  // ...but gets no group score where it failed.
  expect(c.groupScores.update).toBeUndefined();
  const page = renderResultsPage(parsed);
  expect(page).toContain("not ranked: 1 failed");
  expect(page).toContain("out-of-memory");
});

test("intervals are labelled with what they actually cover", () => {
  const parsed = parseBenchOutput(
    [
      "a , t , 1.00 , , , , update , stable , samples=10 median_ci95=0.9..1.1",
      "b , t , 1.50 , , , , update , stable , samples=30 rounds=3 round_range=1.4..1.6",
      "c , t , 2.00 , , , , update , stable , samples=90 machines=3 machine_range=1.8..2.2",
    ].join("\n")
  );
  const [a, b, c] = parsed.rows;
  expect(describeInterval(a)).toContain("95% interval within one process");
  expect(describeInterval(a)).toContain("sample noise only");
  expect(describeInterval(b)).toContain("3 fresh processes on one machine");
  expect(describeInterval(b)).toContain("~75% coverage");
  expect(describeInterval(c)).toContain("range over 3 machines");
  expect(rangeCoverage(3)).toBe(0.75);
  expect(rangeCoverage(5)).toBe(0.9375);
  // A single-VM-per-scenario run has no interval for the overall score.
  expect(
    renderResultsPage(
      parseBenchOutput(
        "a , t , 1 , , , , update , stable , samples=10 median_ci95=0.9..1.1"
      )
    )
  ).toContain("The leaderboard score has no interval of its own");
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { mergeShardData, mergeShards } from "../../scripts/merge-shards.mjs";
import {
  parseBenchOutput,
  renderResultsPage,
} from "../../scripts/render-results-page.mjs";

const WIDTHS = [22, 60, 8, 8, 8, 8, 12, 24, 0];
const line = (values) =>
  values.map((value, index) => String(value).padEnd(WIDTHS[index])).join(" , ");

/** A shard output pair in the exact format the runner writes. */
function shard({
  round = 1,
  index,
  count,
  scenarios,
  cpu,
  rows,
  ...overrides
}) {
  const json = {
    semantics: "v4",
    profile: "quick",
    policy: { profile: "quick", rounds: 1 },
    node: "v24.0.0",
    v8: "13",
    platform: "linux/x64",
    gc: true,
    isolation: "row",
    order: "interleaved",
    nodeEnv: "production",
    capPolicy: { minCeilingMs: 1500, maxSlowdown: 3 },
    packages: { a: { "lib-a": "1.0.0" }, b: { "lib-b": "2.0.0" } },
    consoleGuard: true,
    sourceCommit: "abc",
    lockfileSha256: "lock",
    bundleSha256: "bundle",
    cpu,
    cores: 4,
    ram: 1,
    os: "Linux 6",
    shard: { index, count, scenarios },
    machineRound: round,
    rows: rows.map(([framework, name, estimateMs, rounds = []]) => ({
      id: `${framework} :: ${name}`,
      framework,
      name,
      profile: "quick",
      capped: false,
      estimateMs,
      statistics: { count: 10, median: estimateMs },
      validation: "passed",
      group: "update",
      family: "stable",
      fixture: "fresh",
      rounds: rounds.map(([median, low, high], index) => ({
        round: index + 1,
        statistics: { median, medianInterval: [low, high] },
      })),
    })),
    ...overrides,
  };
  const log = [
    `# semantics=v4 profile=quick rounds=1 node=v24.0.0 cpu=${cpu.replaceAll(" ", "_")} cores=4 ram=1 isolation=row shard=${index}/${count} machine_round=${round} bundle=bundle`,
    "# package a | lib-a@1.0.0",
    "# package b | lib-b@2.0.0",
    line([
      "framework",
      "test",
      "time",
      "p95",
      "p99",
      "cv",
      "group",
      "family",
      "metrics",
    ]),
    ...rows.map(([framework, name, estimate]) =>
      line([
        framework,
        name,
        estimate.toFixed(6),
        "",
        "",
        "0.010000",
        "update",
        "stable",
        `samples=10 rounds=1 profile=quick warmup=2 pilot=excluded tails=insufficient fixture=fresh median_ci95=${(estimate * 0.9).toFixed(6)}..${(estimate * 1.1).toFixed(6)}`,
      ])
    ),
  ].join("\n");
  return { name: `shard-${round}-${index}`, json, log };
}

const twoShards = () => [
  shard({
    index: 1,
    count: 2,
    scenarios: ["s1"],
    cpu: "AMD EPYC 7763",
    rows: [
      ["a", "s1", 1],
      ["b", "s1", 2],
    ],
  }),
  shard({
    index: 2,
    count: 2,
    scenarios: ["s2"],
    cpu: "Intel Xeon 8370C",
    rows: [
      ["b", "s2", 4],
      ["a", "s2", 3],
    ],
  }),
];

test("one machine round keeps each scenario's rows from its single machine", () => {
  const { log, samples } = mergeShardData(twoShards());
  const parsed = parseBenchOutput(log);
  expect(
    parsed.rows.map((row) => `${row.framework}/${row.test}/${row.time}`)
  ).toEqual(["a/s1/1", "b/s1/2", "b/s2/4", "a/s2/3"]);
  expect(parsed.meta.machines.map((machine) => machine.cpu)).toEqual([
    "AMD_EPYC_7763",
    "Intel_Xeon_8370C",
  ]);
  // Machine-specific values are per machine, not in the shared header.
  expect(parsed.meta.cpu).toBeUndefined();
  expect(parsed.rows[0].interval).toEqual([0.9, 1.1]);
  expect(samples.machines).toHaveLength(2);
  expect(samples.rows[2].machines[0]).toMatchObject({
    shard: 2,
    cpu: "Intel Xeon 8370C",
  });
  expect(samples.cpu).toBeUndefined();
});

test("machine rounds report the median of per-machine estimates and their range", () => {
  const rounds = [10, 14, 30].map((estimate, i) =>
    shard({
      round: i + 1,
      index: 1,
      count: 1,
      scenarios: ["s"],
      cpu: `cpu ${i}`,
      rows: [["a", "s", estimate]],
    })
  );
  const { log, samples } = mergeShardData(rounds);
  const [row] = parseBenchOutput(log).rows;
  expect(row.time).toBe(14);
  expect(row.samples).toBe(30);
  expect(row.interval).toEqual([10, 30]);
  expect(log).toContain("machines=3 machine_range=10.000000..30.000000");
  expect(log).not.toContain("median_ci95");
  expect(samples.rows[0].interval).toEqual({
    kind: "machine-median-range",
    lowMs: 10,
    highMs: 30,
  });
});

test("rows decompose their noise into process, round and machine levels", () => {
  const sd = (values) => {
    const logs = values.map(Math.log);
    const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    return Math.sqrt(
      logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (logs.length - 1)
    );
  };
  // Two fresh processes per machine, three machines.
  const processes = [
    [
      [10, 9, 11],
      [12, 11, 13],
    ],
    [
      [20, 19, 21],
      [20, 18, 22],
    ],
    [
      [15, 14, 16],
      [13, 12, 14],
    ],
  ];
  const machines = processes.map((rounds, i) =>
    shard({
      round: i + 1,
      index: 1,
      count: 1,
      scenarios: ["s"],
      cpu: `cpu ${i}`,
      rows: [["a", "s", (rounds[0][0] + rounds[1][0]) / 2, rounds]],
    })
  );
  const { log, samples } = mergeShardData(machines);
  const { noise, machineEstimatesMs } = samples.rows[0];
  expect(machineEstimatesMs).toEqual([11, 20, 14]);
  expect(noise.betweenMachine).toBeCloseTo(sd([11, 20, 14]));
  // Pooled within-machine SD of ln(process median), 3 degrees of freedom.
  const pooled = Math.sqrt(
    processes.reduce((sum, [[x], [y]]) => sum + sd([x, y]) ** 2, 0) / 3
  );
  expect(noise.betweenProcess).toBeCloseTo(pooled);
  // Median over processes of the log-width of the 95% interval / (2 * 1.96).
  const widths = processes
    .flat()
    .map(([, low, high]) => Math.log(high / low) / (2 * 1.959963984540054))
    .sort((a, b) => a - b);
  expect(noise.withinProcess).toBeCloseTo((widths[2] + widths[3]) / 2);
  expect(samples.merged.noise.betweenMachine.rows).toBe(1);

  const [row] = parseBenchOutput(log).rows;
  expect(row.machineEstimates).toEqual([11, 20, 14]);
  expect(row.noise.betweenMachine).toBeCloseTo(noise.betweenMachine, 4);
  expect(row.intervalKind).toBe("machine_range");
  expect(log.split("\n")[0]).toContain("machine_rounds=3");
});

test("one machine round reports no machine-level noise", () => {
  const { log, samples } = mergeShardData([
    shard({
      index: 1,
      count: 1,
      scenarios: ["s"],
      cpu: "cpu",
      rows: [
        [
          "a",
          "s",
          11,
          [
            [10, 9, 11],
            [12, 11, 13],
          ],
        ],
      ],
    }),
  ]);
  expect(samples.rows[0].noise.betweenMachine).toBeUndefined();
  expect(samples.rows[0].noise.betweenProcess).toBeGreaterThan(0);
  expect(log).toContain("sd_process=");
  expect(log).not.toContain("sd_machine=");
  expect(log).not.toContain("machine_estimates=");
});

test("the leaderboard is scored per machine round, not from merged medians", () => {
  // Per machine round: [a s1, b s1, a s2, b s2].
  const times = [
    [1, 2, 4, 2],
    [3, 2, 2, 4],
    [2, 4, 3, 3],
  ];
  const shards = times.map(([a1, b1, a2, b2], i) =>
    shard({
      round: i + 1,
      index: 1,
      count: 1,
      scenarios: ["s1", "s2"],
      cpu: `cpu ${i}`,
      rows: [
        ["a", "s1", a1],
        ["b", "s1", b1],
        ["a", "s2", a2],
        ["b", "s2", b2],
      ],
    })
  );
  const parsed = parseBenchOutput(mergeShardData(shards).log);
  // Merged medians are identical (2 and 3 for both), which would score both
  // 1.00x; within each machine they are not.
  expect(parsed.rows.map((row) => row.time)).toEqual([2, 2, 3, 3]);
  expect(parsed.machineRounds).toBe(3);
  const [a, b] = parsed.frameworks;
  expect(a.name).toBe("a");
  expect(a.roundScores.map((value) => value.toFixed(4))).toEqual(
    [Math.SQRT2, Math.sqrt(1.5), 1].map((value) => value.toFixed(4))
  );
  expect(a.relativeScore).toBeCloseTo(Math.sqrt(1.5));
  expect(a.scoreRange).toEqual([1, expect.closeTo(Math.SQRT2)]);
  expect(b.relativeScore).toBeCloseTo(Math.SQRT2);

  const page = renderResultsPage(parsed);
  expect(page).toContain("1.00–1.41x over 3 machine sets");
  expect(page).toContain("overlaps #1");
  expect(page).toContain("~75% probability");
  expect(page).not.toContain("median 95% interval");
});

test("refuses to merge results that are not one comparable measurement", () => {
  const [one, two] = twoShards();
  const variants = {
    "differs in bundleSha256": [
      one,
      { ...two, json: { ...two.json, bundleSha256: "other" } },
    ],
    "differs in packages": [
      one,
      { ...two, json: { ...two.json, packages: {} } },
    ],
    "missing shard 2/2": [one],
    "appears in two shards": [
      one,
      {
        ...two,
        json: {
          ...two.json,
          shard: { ...two.json.shard, scenarios: ["s1", "s2"] },
        },
      },
    ],
    "outside its scenarios": [
      one,
      {
        ...two,
        json: { ...two.json, shard: { ...two.json.shard, scenarios: ["s3"] } },
      },
    ],
    "Duplicate shard": [one, one],
  };
  for (const [message, shards] of Object.entries(variants))
    expect(() => mergeShardData(shards), message).toThrow(message);
});

test("rounds must cover the same rows with the same partition", () => {
  const first = twoShards();
  const second = twoShards().map((item) => ({
    ...item,
    json: { ...item.json, machineRound: 2 },
  }));
  second[1] = {
    ...second[1],
    json: { ...second[1].json, rows: second[1].json.rows.slice(0, 1) },
    log: second[1].log.split("\n").slice(0, -1).join("\n"),
  };
  expect(() => mergeShardData([...first, ...second])).toThrow(
    "Machine round 2 has no result for a :: s2"
  );
});

test("writes the merged log, samples and page from a shard directory", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shards-"));
  const out = mkdtempSync(path.join(tmpdir(), "merged-"));
  for (const item of twoShards()) {
    writeFileSync(path.join(dir, `${item.name}.log`), item.log);
    writeFileSync(
      path.join(dir, `${item.name}.samples.json`),
      JSON.stringify(item.json)
    );
  }
  const result = await mergeShards(dir, {
    logPath: path.join(out, "latest.log"),
    samplesPath: path.join(out, "latest.samples.json"),
    htmlPath: path.join(out, "index.html"),
  });
  expect(result).toEqual({ shards: 2, rows: 4 });
  const html = readFileSync(path.join(out, "index.html"), "utf8");
  expect(html).toContain("Intel Xeon 8370C");
  expect(html).toContain("lib-b@2.0.0");
});

test("a row that fails on any machine is merged as failed", () => {
  const rows = [
    ["a", "s", 10],
    ["b", "s", 12],
  ];
  const ok = shard({
    round: 1,
    index: 1,
    count: 1,
    scenarios: ["s"],
    cpu: "cpu A",
    rows,
  });
  const crashed = shard({
    round: 2,
    index: 1,
    count: 1,
    scenarios: ["s"],
    cpu: "cpu B",
    rows,
  });
  crashed.json.rows[0] = {
    id: "a :: s",
    framework: "a",
    name: "s",
    title: "s",
    status: "failed",
    failure: { kind: "out-of-memory", message: "worker exited with code 134" },
    group: "update",
    family: "stable",
  };
  crashed.log = crashed.log.replace(
    /^a\s+ , s\s+ , 10\.000000 .*$/m,
    line([
      "a",
      "s",
      "FAILED",
      "",
      "",
      "",
      "update",
      "stable",
      'FAILED kind=out-of-memory reason="worker exited with code 134"',
    ])
  );
  const { log, samples } = mergeShardData([ok, crashed]);
  const parsed = parseBenchOutput(log);
  expect(parsed.rows.find((row) => row.framework === "a")).toMatchObject({
    failed: true,
    failure: { kind: "out-of-memory" },
  });
  expect(parsed.rows.find((row) => row.framework === "b").time).toBe(12);
  expect(samples.rows[0].status).toBe("failed");
  expect(samples.rows[0].machines.map((machine) => machine.cpu)).toEqual([
    "cpu A",
    "cpu B",
  ]);
});

test("refuses a shard whose log and samples disagree about a failure", () => {
  const [one] = twoShards();
  const lying = {
    ...one,
    json: {
      ...one.json,
      shard: { ...one.json.shard, count: 1 },
      rows: [{ ...one.json.rows[0], status: "failed" }, one.json.rows[1]],
    },
  };
  expect(() => mergeShardData([lying])).toThrow("disagree on whether");
});

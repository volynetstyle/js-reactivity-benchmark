import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { mergeShardData, mergeShards } from "./merge-shards.mjs";
import { parseBenchOutput } from "./render-results-page.mjs";

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
    rows: rows.map(([framework, name, estimateMs]) => ({
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
      rounds: [],
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

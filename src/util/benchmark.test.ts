import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  performanceCeilingMs,
  readShard,
  scenarioWeights,
  shardScenarios,
} from "./benchmark";

describe("adaptive benchmark ceiling", () => {
  test("uses the absolute ceiling before a reference result exists", () => {
    expect(performanceCeilingMs(undefined, 1500, 3)).toBe(1500);
  });

  test("allows a bounded slowdown relative to the fastest result", () => {
    expect(performanceCeilingMs(800, 1500, 3)).toBe(2400);
  });

  test("never drops below the absolute ceiling", () => {
    expect(performanceCeilingMs(200, 1500, 3)).toBe(1500);
  });
});

describe("CI scenario shards", () => {
  const names = ["a", "b", "c", "d", "e"];

  test("cover every scenario exactly once and never split one", () => {
    const shards = shardScenarios(names, 3, new Map());
    expect(shards.flat().sort()).toEqual(names);
    expect(shards.every((shard) => shard.length > 0)).toBe(true);
  });

  test("balance measured cost and stay deterministic", () => {
    const weights = new Map([
      ["a", 100],
      ["b", 60],
      ["c", 40],
      ["d", 30],
      ["e", 30],
    ]);
    const shards = shardScenarios(names, 2, weights);
    const load = (shard: string[]) =>
      shard.reduce((sum, name) => sum + weights.get(name)!, 0);
    expect(shards.map(load).sort()).toEqual([130, 130]);
    expect(shardScenarios(names, 2, weights)).toEqual(shards);
    // Scenario order inside a shard follows registration order.
    for (const shard of shards)
      expect(shard).toEqual(
        [...shard].sort((x, y) => names.indexOf(x) - names.indexOf(y))
      );
  });

  test("reject impossible or malformed shard requests", () => {
    expect(() => shardScenarios(names, 6, new Map())).toThrow("Cannot split");
    expect(readShard("2/4")).toEqual({ index: 2, count: 4 });
    expect(readShard("")).toBeUndefined();
    for (const raw of ["0/2", "3/2", "1", "a/b"])
      expect(() => readShard(raw)).toThrow("BENCH_SHARD");
  });

  test("weights sum every recorded invocation of v3 and v4 files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "weights-"));
    const file = path.join(dir, "samples.json");
    writeFileSync(
      file,
      JSON.stringify({
        rows: [
          {
            name: "x",
            rounds: [{ pilotMs: 1, warmupMs: [2], samplesMs: [3, 4] }],
          },
          { name: "x", pilotMs: 5, samplesMs: [5] },
        ],
      })
    );
    expect(scenarioWeights(file).get("x")).toBe(20);
    expect(scenarioWeights(path.join(dir, "missing.json")).size).toBe(0);
  });
});

test("shard weights prefer recorded wall time, including failed rows", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "weights-"));
  const file = path.join(dir, "samples.json");
  writeFileSync(
    file,
    JSON.stringify({
      rows: [
        { name: "slow", status: "failed", wallMs: 180_000 },
        { name: "fast", wallMs: 900, rounds: [{ pilotMs: 1, samplesMs: [1] }] },
        {
          name: "merged",
          machines: [{ record: { wallMs: 100 } }, { record: { wallMs: 300 } }],
        },
      ],
    })
  );
  const weights = scenarioWeights(file);
  expect(Object.fromEntries(weights)).toEqual({
    slow: 180_000,
    fast: 900,
    merged: 200,
  });
});

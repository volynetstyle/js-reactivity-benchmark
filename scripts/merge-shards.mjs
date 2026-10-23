import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { updateResultsPage } from "./render-results-page.mjs";

/**
 * Merge CI shard outputs (`<name>.log` + `<name>.samples.json` pairs) into one
 * log, samples file and results page.
 *
 * Shards split scenarios, never frameworks, so every per-scenario comparison
 * was made on a single machine. With several machine rounds each scenario was
 * measured on several independent machines; the score is then the median of
 * the per-machine medians and the reported interval is their range. Every row
 * also keeps its per-machine estimates and a decomposition of its noise into
 * within-process, between-process and between-machine spread.
 */
export async function mergeShards(
  dir,
  {
    logPath = path.resolve("bench-results", "latest.log"),
    samplesPath = path.resolve("bench-results", "latest.samples.json"),
    htmlPath = path.resolve("index.html"),
    sourceLabel,
  } = {}
) {
  const shards = await loadShards(dir);
  const { log, samples } = mergeShardData(shards);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, log, "utf8");
  await writeFile(samplesPath, JSON.stringify(samples, null, 2) + "\n");
  const { parsed } = await updateResultsPage({
    inputPath: logPath,
    outputPath: htmlPath,
    sourceLabel:
      sourceLabel ??
      `Merged from ${shards.length} CI shard runs on ${new Set(shards.map((s) => s.json.cpu)).size} CPU model(s)`,
  });
  return { shards: shards.length, rows: parsed.rows.length };
}

async function loadShards(dir) {
  const files = (await readdir(dir)).filter((file) =>
    file.endsWith(".samples.json")
  );
  if (!files.length) throw new Error(`No *.samples.json shard files in ${dir}`);
  return Promise.all(
    files.sort().map(async (file) => {
      const base = file.slice(0, -".samples.json".length);
      return {
        name: base,
        json: JSON.parse(await readFile(path.join(dir, file), "utf8")),
        log: await readFile(path.join(dir, `${base}.log`), "utf8"),
      };
    })
  );
}

/** Fields that must be identical for shards to be one comparable measurement. */
const SHARED_FIELDS = [
  "semantics",
  "profile",
  "policy",
  "node",
  "v8",
  "platform",
  "gc",
  "isolation",
  "order",
  "nodeEnv",
  "capPolicy",
  "packages",
  "consoleGuard",
  "sourceCommit",
  "lockfileSha256",
  "bundleSha256",
];

export function mergeShardData(shards) {
  if (!shards.length) throw new Error("No shards to merge");
  const first = shards[0].json;
  for (const { name, json } of shards) {
    for (const field of SHARED_FIELDS)
      if (JSON.stringify(json[field]) !== JSON.stringify(first[field]))
        throw new Error(
          `Shard ${name} differs in ${field}; refusing to merge different measurements`
        );
    if (!json.shard)
      throw new Error(`Shard ${name} was not produced with BENCH_SHARD`);
  }

  const count = first.shard.count;
  const rounds = new Map();
  for (const shard of shards) {
    const { shard: spec, machineRound = 1 } = shard.json;
    if (spec.count !== count)
      throw new Error(
        `Shard ${shard.name} uses ${spec.count} shards, not ${count}`
      );
    const round = rounds.get(machineRound) ?? new Map();
    if (round.has(spec.index))
      throw new Error(
        `Duplicate shard ${spec.index}/${count} in machine round ${machineRound}`
      );
    round.set(spec.index, shard);
    rounds.set(machineRound, round);
  }
  const roundIds = [...rounds.keys()].sort((a, b) => a - b);
  for (const id of roundIds) {
    const round = rounds.get(id);
    for (let index = 1; index <= count; index++)
      if (!round.has(index))
        throw new Error(
          `Machine round ${id} is missing shard ${index}/${count}`
        );
    const seen = new Set();
    for (const shard of round.values())
      for (const scenario of shard.json.shard.scenarios) {
        if (seen.has(scenario))
          throw new Error(`Scenario ${scenario} appears in two shards`);
        seen.add(scenario);
      }
  }
  const partition = (id) =>
    JSON.stringify(
      [...rounds.get(id).values()]
        .sort((a, b) => a.json.shard.index - b.json.shard.index)
        .map((shard) => shard.json.shard.scenarios)
    );
  for (const id of roundIds)
    if (partition(id) !== partition(roundIds[0]))
      throw new Error("Machine rounds used different scenario partitions");

  // Pair every data line of a log with its JSON row (same order by design).
  const lines = new Map();
  const records = new Map();
  for (const shard of shards) {
    const data = dataLines(shard.log);
    if (data.length !== shard.json.rows.length)
      throw new Error(
        `Shard ${shard.name}: log and samples disagree on row count`
      );
    const scenarios = new Set(shard.json.shard.scenarios);
    shard.json.rows.forEach((row, index) => {
      if (!scenarios.has(row.name))
        throw new Error(
          `Shard ${shard.name} measured ${row.id} outside its scenarios`
        );
      if (
        (data[index].split(" , ")[2]?.trim() === "FAILED") !==
        (row.status === "failed")
      )
        throw new Error(
          `Shard ${shard.name}: log and samples disagree on whether ${row.id} failed`
        );
      if (data[index].split(" , ")[0].trim() !== row.framework)
        throw new Error(
          `Shard ${shard.name}: log line ${index + 1} is not ${row.id}`
        );
      const key = `${shard.json.machineRound ?? 1}\u0000${row.id}`;
      if (records.has(key)) throw new Error(`Duplicate row ${row.id}`);
      records.set(key, { row, shard: shard.json });
      lines.set(key, data[index]);
    });
  }

  const ordered = [...rounds.get(roundIds[0]).values()].sort(
    (a, b) => a.json.shard.index - b.json.shard.index
  );
  const ids = ordered.flatMap((shard) => shard.json.rows.map((row) => row.id));
  for (const id of roundIds)
    for (const rowId of ids)
      if (!records.has(`${id}\u0000${rowId}`))
        throw new Error(`Machine round ${id} has no result for ${rowId}`);

  const machines = shards
    .map(({ json }) => ({
      machineRound: json.machineRound ?? 1,
      shard: json.shard.index,
      cpu: json.cpu,
      cores: json.cores,
      ram: json.ram,
      os: json.os,
      scenarios: json.shard.scenarios,
    }))
    .sort((a, b) => a.machineRound - b.machineRound || a.shard - b.shard);

  const outLines = [];
  const outRows = [];
  for (const rowId of ids) {
    const entries = roundIds.map((id) => ({
      id,
      line: lines.get(`${id}\u0000${rowId}`),
      ...records.get(`${id}\u0000${rowId}`),
    }));
    // A failure on any machine is the row's result (a library that crashes
    // on one CPU is not reported by its luckier machines).
    const failed = entries.find((entry) => entry.row.status === "failed");
    const noise = failed
      ? undefined
      : noiseComponents(entries.map((entry) => entry.row));
    if (entries.length === 1 || failed) {
      const chosen = failed ?? entries[0];
      outLines.push(
        failed ? chosen.line : appendMetrics(chosen.line, noiseTokens(noise))
      );
      outRows.push({
        ...chosen.row,
        ...(noise ? { noise } : {}),
        machines: entries.map((entry) => ({
          machineRound: entry.id,
          shard: entry.shard.shard.index,
          cpu: entry.shard.cpu,
          ...(entries.length > 1 ? { record: entry.row } : {}),
        })),
      });
      continue;
    }
    const estimates = entries.map((entry) => entry.row.estimateMs);
    const sorted = [...estimates].sort((a, b) => a - b);
    const estimateMs = median(estimates);
    const capped = entries.some((entry) => entry.row.capped);
    const samples = entries.reduce(
      (sum, entry) => sum + entry.row.statistics.count,
      0
    );
    outLines.push(
      appendMetrics(
        rewriteLine(entries[0].line, {
          time: estimateMs,
          samples,
          machines: entries.length,
          range: [sorted[0], sorted[sorted.length - 1]],
          capped,
        }),
        [
          // In machine-round order, so a reader can form ratios within one
          // machine instead of between medians taken from different machines.
          `machine_estimates=${estimates.map((value) => value.toFixed(6)).join(";")}`,
          ...noiseTokens(noise),
        ]
      )
    );
    outRows.push({
      id: rowId,
      framework: entries[0].row.framework,
      name: entries[0].row.name,
      profile: entries[0].row.profile,
      group: entries[0].row.group,
      family: entries[0].row.family,
      fixture: entries[0].row.fixture,
      validation: entries.every((entry) => entry.row.validation === "passed")
        ? "passed"
        : "absent",
      capped,
      estimateMs,
      interval: {
        kind: "machine-median-range",
        lowMs: sorted[0],
        highMs: sorted[sorted.length - 1],
      },
      machineEstimatesMs: estimates,
      ...(noise ? { noise } : {}),
      machines: entries.map((entry) => ({
        machineRound: entry.id,
        shard: entry.shard.shard.index,
        cpu: entry.shard.cpu,
        record: entry.row,
      })),
    });
  }

  const header = firstHeader(shards[0].log);
  const packages = shards[0].log
    .split(/\r?\n/)
    .filter((line) => line.startsWith("# package "));
  const columns = shards[0].log
    .split(/\r?\n/)
    .find((line) => /^framework\s*,\s*test\s*,/.test(line));
  const log = [
    `${header} machine_rounds=${roundIds.length}`,
    ...machines.map(
      (machine) =>
        `# machine ${machine.machineRound}/${machine.shard} cpu=${String(machine.cpu).replace(/\s+/g, "_")} cores=${machine.cores} os=${String(machine.os ?? "unknown").replace(/\s+/g, "_")} scenarios=${machine.scenarios.length}`
    ),
    ...packages,
    columns,
    ...outLines,
  ].join("\n");

  const {
    cpu: _cpu,
    cores: _cores,
    ram: _ram,
    os: _os,
    shard: _shard,
    machineRound: _round,
    rows: _rows,
    ...shared
  } = first;
  const samples = {
    ...shared,
    merged: {
      shards: count,
      machineRounds: roundIds.length,
      processRounds: first.policy?.rounds ?? 1,
      estimate:
        roundIds.length > 1
          ? "median of per-machine estimates; interval is their range"
          : "per-machine estimate (each scenario measured on one machine)",
      noise: summarizeNoise(outRows),
    },
    machines,
    rows: outRows,
  };
  return { log: log + "\n", samples };
}

const Z95 = 1.959963984540054;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
};

/**
 * Spread of a row's estimate at each level of the nested design
 * machine > fresh process > sample, as standard deviations of ln(time)
 * (0.05 is roughly a 5% relative spread):
 *
 * - `withinProcess`: standard error of one process's median, from the width of
 *   its 95% order-statistic interval (median over processes);
 * - `betweenProcess`: SD of process medians on the same machine (pooled);
 * - `betweenMachine`: SD of the per-machine estimates.
 *
 * Each level contains the noise of the levels below it. Capped rows have a
 * single cold sample per machine and are left out.
 */
export function noiseComponents(records) {
  if (records.some((record) => record.capped)) return undefined;
  const within = [];
  let squares = 0;
  let df = 0;
  for (const record of records) {
    const rounds = (record.rounds ?? []).filter((round) => round.statistics);
    for (const { statistics } of rounds)
      if (statistics.medianInterval) {
        const [low, high] = statistics.medianInterval;
        within.push((Math.log(high) - Math.log(low)) / (2 * Z95));
      }
    if (rounds.length < 2) continue;
    const logs = rounds.map((round) => Math.log(round.statistics.median));
    const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    squares += logs.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    df += logs.length - 1;
  }
  const machines = records.map((record) => Math.log(record.estimateMs));
  const machineMean =
    machines.reduce((sum, value) => sum + value, 0) / machines.length;
  const components = {
    withinProcess: within.length ? median(within) : undefined,
    betweenProcess: df ? Math.sqrt(squares / df) : undefined,
    betweenMachine:
      machines.length > 1
        ? Math.sqrt(
            machines.reduce(
              (sum, value) => sum + (value - machineMean) ** 2,
              0
            ) /
              (machines.length - 1)
          )
        : undefined,
  };
  return Object.values(components).some((value) => value !== undefined)
    ? components
    : undefined;
}

const NOISE_TOKENS = {
  withinProcess: "sd_within",
  betweenProcess: "sd_process",
  betweenMachine: "sd_machine",
};

function noiseTokens(noise) {
  return Object.entries(NOISE_TOKENS)
    .filter(([key]) => noise?.[key] !== undefined)
    .map(([key, token]) => `${token}=${noise[key].toFixed(4)}`);
}

/** Median of each noise component over the rows that report it. */
function summarizeNoise(rows) {
  const summary = {
    unit: "SD of ln(time); median over rows",
  };
  for (const key of Object.keys(NOISE_TOKENS)) {
    const values = rows
      .map((row) => row.noise?.[key])
      .filter((value) => value !== undefined);
    summary[key] = values.length
      ? { median: median(values), rows: values.length }
      : undefined;
  }
  return summary;
}

function appendMetrics(line, tokens) {
  if (!tokens.length) return line;
  const parts = line.split(" , ");
  if (parts.length < 9) throw new Error(`Unexpected row format: ${line}`);
  const metrics = parts.slice(8).join(" , ").trim();
  return [
    ...parts.slice(0, 8),
    [metrics, ...tokens].filter(Boolean).join(" "),
  ].join(" , ");
}

function dataLines(log) {
  return log
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() &&
        !line.startsWith("#") &&
        !/^framework\s*,\s*test\s*,/.test(line)
    );
}

function firstHeader(log) {
  const line = log
    .split(/\r?\n/)
    .find((text) => text.startsWith("# semantics="));
  if (!line) throw new Error("Shard log has no semantics header");
  // Machine-specific values move to the per-machine `# machine` lines.
  return line
    .split(" ")
    .filter((token) => !/^(cpu|cores|ram|shard|machine_round)=/.test(token))
    .join(" ");
}

/** Replace the score and its uncertainty in a formatted row line. */
function rewriteLine(line, { time, samples, machines, range, capped }) {
  const parts = line.split(" , ");
  if (parts.length < 9) throw new Error(`Unexpected row format: ${line}`);
  const pad = (value, index) => value.padEnd(parts[index].length);
  parts[2] = pad(time.toFixed(6), 2);
  for (const index of [3, 4, 5]) parts[index] = pad("", index);
  const metrics = parts
    .slice(8)
    .join(" , ")
    .trim()
    .split(/\s+/)
    .filter(
      (token) =>
        !/^(median_ci95|round_range|p95_ci95|p99_ci95|machine_range)=/.test(
          token
        )
    )
    .map((token) =>
      token.startsWith("samples=") && !capped ? `samples=${samples}` : token
    );
  metrics.splice(
    1,
    0,
    `machines=${machines}`,
    `machine_range=${range[0].toFixed(6)}..${range[1].toFixed(6)}`
  );
  return [...parts.slice(0, 8), metrics.join(" ")].join(" , ");
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/merge-shards.mjs <shard-output-dir>");
    process.exitCode = 1;
  } else {
    mergeShards(path.resolve(dir))
      .then(({ shards, rows }) =>
        console.log(`Merged ${shards} shard runs into ${rows} rows.`)
      )
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}

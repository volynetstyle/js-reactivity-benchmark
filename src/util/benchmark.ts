import { fork } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { timingStatistics, TimingStatistics } from "./statistics";
import {
  logPerfResult,
  perfReportHeaders,
  PerfRowStrings,
} from "./perfLogging";

/** Results from different semantics versions must not be compared. */
export const SEMANTICS_VERSION = "v4";

/**
 * `true` and `"inner"`: full GC after each fixture is prepared and before each
 * timed invocation. `"once"`: a single GC before the pilot. `false`: never.
 */
export type BenchmarkGcMode = false | true | "once" | "inner";

export interface BenchmarkCase<TFixture, TResult> {
  framework: string;
  name: string;
  setup: () => TFixture;
  benchmark: (fixture: TFixture) => TResult;
  validate?: (result: TResult, fixture: TFixture) => void;
  teardown?: (fixture: TFixture) => void;
  report?: (result: TResult, timeMs: number) => PerfRowStrings;
  gc?: BenchmarkGcMode;
  blackhole?: boolean;
  /** Minimum measured samples in the quick profile (default 10). */
  samples?: number;
  group?: string;
  family?: string;
  /** Only for declared steady-state cases with an exact untimed reset. */
  reuseFixture?: boolean;
  prepareSample?: (fixture: TFixture) => void;
}

/** One framework/scenario measurement in one process. */
export interface RoundRecord {
  round: number;
  /** First, cold invocation. Excluded from uncapped statistics. */
  pilotMs: number;
  /** Validated invocations after the pilot, excluded from statistics. */
  warmupMs: number[];
  /** Measured durations in chronological order; nothing is trimmed. */
  samplesMs: number[];
  statistics?: TimingStatistics;
}

export interface TimingRecord {
  id: string;
  framework: string;
  name: string;
  profile: string;
  capped: boolean;
  ceilingMs?: number;
  /** Primary row score: the median, or the median of round medians. */
  estimateMs: number;
  interval?: {
    kind: "median-order-statistic-95" | "round-median-range";
    lowMs: number;
    highMs: number;
  };
  /** Over all measured samples of all rounds (the pilot when capped). */
  statistics: TimingStatistics;
  rounds: RoundRecord[];
  validation: "passed" | "absent";
  group: string;
  family: string;
  fixture: "fresh" | "warm-reused";
}

export interface SamplingPolicy {
  profile: "quick" | "tails";
  warmup: number;
  minSamples: number;
  maxSamples: number;
  /** Keep sampling until this much measured time has accumulated. */
  minTimeMs: number;
  rounds: number;
}

type CaseOutcome =
  | { kind: "measured"; id: string; round: RoundRecord; row: PerfRowStrings }
  | { kind: "deferred"; id: string; pilotMs: number; row: PerfRowStrings };

interface RegisteredCase<
  TFixture = unknown,
  TResult = unknown,
> extends BenchmarkCase<TFixture, TResult> {
  id: string;
}

const DEFAULT_MIN_SAMPLES = 10;
const registeredCases: RegisteredCase[] = [];
const workerEntries = new Map<string, string>();

export function registerFrameworkWorker(
  framework: string,
  entry: string
): void {
  workerEntries.set(framework, entry);
}

export function samplingPolicy(
  caseSamples = DEFAULT_MIN_SAMPLES
): SamplingPolicy {
  const profile = process.env.BENCH_PROFILE?.trim() || "quick";
  if (profile !== "quick" && profile !== "tails")
    throw new Error("BENCH_PROFILE must be quick or tails");
  const rounds = readPositiveInteger("BENCH_ROUNDS", 1);
  const raw = process.env.BENCH_SAMPLES?.trim();
  if (raw) {
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1)
      throw new Error("BENCH_SAMPLES must be a positive integer");
    // An explicit count is exact: no time budget can add samples.
    return {
      profile,
      warmup: profile === "tails" ? 20 : 2,
      minSamples: count,
      maxSamples: count,
      minTimeMs: 0,
      rounds,
    };
  }
  if (profile === "tails")
    return {
      profile,
      warmup: 20,
      minSamples: 1000,
      maxSamples: 1000,
      minTimeMs: 0,
      rounds,
    };
  return {
    profile,
    warmup: 2,
    minSamples: caseSamples,
    maxSamples: Math.max(
      caseSamples,
      readPositiveInteger("BENCH_MAX_SAMPLES", 100)
    ),
    minTimeMs: readPositiveNumber("BENCH_MIN_TIME_MS", 250),
    rounds,
  };
}

function workloadFamily(name: string): [string, string] {
  if (name.startsWith("create"))
    return ["creation", "initialized construction"];
  if (name.startsWith("update")) return ["update", "write and pull"];
  if (name.startsWith("lifecycle/")) return ["lifecycle", "native ownership"];
  if (name.startsWith("mutable-object/") || name === "molBench")
    return ["dynamic", "object publication"];
  if (name.startsWith("many")) return ["push", "fan"];
  if (name.startsWith("dynamic/")) return ["large_graph", "dependency graph"];
  return ["baseline", "historical propagation"];
}

const MIN_PERFORMANCE_CEILING_MS = readPositiveNumber(
  "BENCH_MIN_CEILING_MS",
  1500
);
const MAX_SLOWDOWN_FACTOR = readPositiveNumber("BENCH_MAX_SLOWDOWN", 3);
const ROW_TIMEOUT_MS = readPositiveNumber("BENCH_ROW_TIMEOUT_MS", 15 * 60_000);

/** Register workload and fixture creation without performing any measurement. */
export function registerBenchmark<TFixture, TResult>(
  benchmarkCase: BenchmarkCase<TFixture, TResult>
): void {
  const id = `${benchmarkCase.framework} :: ${benchmarkCase.name}`;
  if (process.env.BENCH_CASE && process.env.BENCH_CASE !== id) return;
  const filter = process.env.BENCH_FILTER?.trim().toLowerCase();
  if (
    filter &&
    !filter
      .split(",")
      .some((part) => benchmarkCase.name.toLowerCase().includes(part.trim()))
  )
    return;

  if (registeredCases.some((entry) => entry.id === id)) {
    throw new Error(`Duplicate benchmark name: ${id}`);
  }

  registeredCases.push({ ...benchmarkCase, id } as RegisteredCase);
}

/**
 * Scenario-major order. Within each scenario the framework order rotates per
 * scenario and per round, so no library is systematically measured first or
 * last while the machine warms up, throttles, or picks up background load.
 */
export function executionOrder<T extends { name: string }>(
  cases: readonly T[],
  round = 1
): T[] {
  const byName = new Map<string, T[]>();
  for (const entry of cases) {
    const row = byName.get(entry.name) ?? [];
    row.push(entry);
    byName.set(entry.name, row);
  }
  return Array.from(byName.values()).flatMap((row, scenario) => {
    const offset = (scenario + round - 1) % row.length;
    return [...row.slice(offset), ...row.slice(0, offset)];
  });
}

/**
 * Entry point for the parent runner, a row worker (`BENCH_CASE`), and the
 * shared-process diagnostic mode (`BENCH_IN_PROCESS=1`).
 */
export async function runBenchmarks(): Promise<void> {
  if (registeredCases.length === 0)
    throw new Error("No benchmark cases matched the selection.");

  if (process.env.BENCH_CASE) {
    const outcome = measureCase(
      registeredCases[0],
      readPositiveInteger("BENCH_ROUND", 1),
      process.env.BENCH_DEFER_CAP === "1"
    );
    if (process.send) {
      await new Promise<void>((resolve, reject) =>
        process.send!(outcome, (error: Error | null) =>
          error ? reject(error) : resolve()
        )
      );
    } else if (outcome.kind === "measured") {
      // Manual single-row run without a parent: print the row directly.
      logPerfResult(
        formatRow(summarize(registeredCases[0], [outcome.round]), outcome.row)
      );
    }
    return;
  }

  const policy = samplingPolicy();
  const isolation = process.env.BENCH_IN_PROCESS === "1" ? "shared" : "row";
  console.log(
    `# semantics=${SEMANTICS_VERSION} profile=${policy.profile} rounds=${policy.rounds} warmup=${policy.warmup} min_samples=${process.env.BENCH_SAMPLES?.trim() || "per-case"} max_samples=${policy.maxSamples} min_time_ms=${policy.minTimeMs} node=${process.version} v8=${process.versions.v8} platform=${process.platform}/${process.arch} cpu=${(cpus()[0]?.model ?? "unknown").replace(/\s+/g, "_")} cores=${cpus().length} ram=${totalmem()} gc=${!!globalThis.gc} isolation=${isolation} order=interleaved node_env=production instrumented=${process.env.BENCH_INSTRUMENT === "1"}`
  );
  const packages = packageVersions();
  for (const [framework, versions] of Object.entries(packages))
    console.log(
      `# package ${framework} | ${Object.entries(versions)
        .map(([name, version]) => `${name}@${version}`)
        .join(" ")}`
    );
  logPerfResult(perfReportHeaders());

  const records = await runPlan(policy);
  await saveTimingRecords(policy, isolation, packages, records);
}

interface RowState {
  entry: RegisteredCase;
  rounds: RoundRecord[];
  row?: PerfRowStrings;
  capped?: { pilotMs: number; ceilingMs: number };
  failed?: boolean;
}

async function runPlan(policy: SamplingPolicy): Promise<TimingRecord[]> {
  const states = new Map(
    registeredCases.map((entry) => [
      entry.id,
      { entry, rounds: [] } as RowState,
    ])
  );
  const errors: string[] = [];
  const records: TimingRecord[] = [];
  const total = registeredCases.length * policy.rounds;
  let started = 0;
  const finish = (state: RowState) => {
    const record = summarize(state.entry, state.rounds, state.capped);
    logPerfResult(formatRow(record, state.row!));
    records.push(record);
  };

  for (let round = 1; round <= policy.rounds; round++) {
    const deferred: { state: RowState; pilotMs: number }[] = [];
    const pilots = new Map<string, number>();
    const note = (name: string, pilotMs: number) =>
      pilots.set(name, Math.min(pilots.get(name) ?? Infinity, pilotMs));

    const attempt = async (state: RowState, allowDefer: boolean) => {
      process.stderr.write(
        `[${++started}/${total}] round ${round}/${policy.rounds} ${state.entry.id}\n`
      );
      try {
        const outcome = await runRow(state.entry, round, allowDefer);
        state.row = outcome.row;
        if (outcome.kind === "deferred") {
          note(state.entry.name, outcome.pilotMs);
          deferred.push({ state, pilotMs: outcome.pilotMs });
          return;
        }
        note(state.entry.name, outcome.round.pilotMs);
        state.rounds.push(outcome.round);
        if (round === policy.rounds) finish(state);
      } catch (error) {
        state.failed = true;
        errors.push(
          `${state.entry.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    for (const entry of executionOrder(registeredCases, round)) {
      const state = states.get(entry.id)!;
      if (state.failed || state.capped) continue;
      // The cap is decided once, in the first round, from all frameworks' pilots.
      await attempt(state, round === 1);
    }

    // Order-independent cap: every pilot of the scenario is known now. Decide
    // all deferred rows from this snapshot before any rerun adds new pilots.
    const decisions = deferred.map(({ state, pilotMs }) => ({
      state,
      pilotMs,
      ceilingMs: performanceCeilingMs(pilots.get(state.entry.name)),
    }));
    for (const { state, pilotMs, ceilingMs } of decisions) {
      if (pilotMs > ceilingMs) {
        state.capped = { pilotMs, ceilingMs };
        finish(state);
      } else {
        started--; // The full measurement replaces the deferred attempt.
        await attempt(state, false);
      }
    }
  }

  if (errors.length)
    throw new Error(`Benchmark failures:\n${errors.join("\n")}`);
  return records;
}

/** Run one row in a fresh worker process, or in-process for diagnostics. */
async function runRow(
  entry: RegisteredCase,
  round: number,
  allowDefer: boolean
): Promise<CaseOutcome> {
  if (process.env.BENCH_IN_PROCESS === "1")
    return measureCase(entry, round, allowDefer);
  return await new Promise<CaseOutcome>((resolve, reject) => {
    let outcome: CaseOutcome | undefined;
    const child = fork(
      workerEntries.get(entry.framework) ?? process.argv[1],
      process.argv.slice(2),
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          BENCH_CASE: entry.id,
          BENCH_ROUND: String(round),
          BENCH_DEFER_CAP: allowDefer ? "1" : "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`worker exceeded ${ROW_TIMEOUT_MS} ms`));
    }, ROW_TIMEOUT_MS);
    child.stdout!.on("data", (chunk) => process.stderr.write(chunk));
    child.stderr!.on("data", (chunk) => process.stderr.write(chunk));
    child.on("message", (message: CaseOutcome) => {
      if (message?.id === entry.id) outcome = message;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && outcome) resolve(outcome);
      else
        reject(
          new Error(
            `worker exited with code ${code}, signal ${signal}${outcome ? "" : ", no result"}`
          )
        );
    });
  });
}

/** Keeps a reference so benchmark results cannot be optimized away. */
const blackholeSink: { value: unknown } = { value: undefined };

/** Measure one case: pilot, validated warmup, then chronological samples. */
function measureCase(
  entry: RegisteredCase,
  round: number,
  allowDefer: boolean
): CaseOutcome {
  const policy = samplingPolicy(entry.samples);
  const guard = consoleGuard();
  const hasGc = entry.gc !== false && typeof globalThis.gc === "function";
  const gcEverySample = hasGc && entry.gc !== "once";
  let fixture: unknown;
  let hasFixture = false;
  let result: unknown;
  let pendingValidation = false;

  const validatePending = () => {
    if (pendingValidation) {
      pendingValidation = false;
      entry.validate?.(result, fixture);
    }
  };
  const prepare = () => {
    // Validate the preceding invocation before a reset can destroy its fixture.
    validatePending();
    blackholeSink.value = undefined;
    result = undefined;
    if (entry.reuseFixture && hasFixture) {
      entry.prepareSample?.(fixture);
      return;
    }
    if (hasFixture) {
      hasFixture = false;
      entry.teardown?.(fixture);
    }
    fixture = entry.setup();
    hasFixture = true;
  };
  const invoke = (): number => {
    prepare();
    // Collect setup and previous-sample garbage outside the timed region.
    if (gcEverySample) globalThis.gc!();
    guard.measured = true;
    let start = 0;
    let end = 0;
    try {
      start = performance.now();
      result = entry.benchmark(fixture);
      end = performance.now();
    } finally {
      guard.measured = false;
    }
    pendingValidation = true;
    if (entry.blackhole) blackholeSink.value = result;
    return end - start;
  };
  const report = (timeMs: number): PerfRowStrings =>
    (entry.report as ((r: unknown, t: number) => PerfRowStrings) | undefined)?.(
      result,
      timeMs
    ) ?? {
      framework: entry.framework,
      test: entry.name,
      time: "",
      metrics: "",
    };

  try {
    if (hasGc && !gcEverySample) globalThis.gc!();
    const pilotMs = invoke();
    validatePending();
    // Only a pilot above the absolute floor can be capped; the parent decides
    // once the pilots of every framework for this scenario are known.
    if (allowDefer && pilotMs > MIN_PERFORMANCE_CEILING_MS)
      return { kind: "deferred", id: entry.id, pilotMs, row: report(pilotMs) };

    const warmupMs: number[] = [];
    for (let i = 0; i < policy.warmup; i++) warmupMs.push(invoke());
    const samplesMs: number[] = [];
    let measuredMs = 0;
    while (
      samplesMs.length < policy.maxSamples &&
      (samplesMs.length < policy.minSamples || measuredMs < policy.minTimeMs)
    ) {
      const duration = invoke();
      samplesMs.push(duration);
      measuredMs += duration;
    }
    validatePending();
    const statistics = timingStatistics(samplesMs);
    return {
      kind: "measured",
      id: entry.id,
      round: { round, pilotMs, warmupMs, samplesMs, statistics },
      row: report(statistics.median),
    };
  } finally {
    blackholeSink.value = undefined;
    result = undefined;
    if (hasFixture) entry.teardown?.(fixture);
    guard.restore();
  }
}

function consoleGuard() {
  const state = { measured: false, restore: () => {} };
  if (process.env.BENCH_ASSERT_NO_CONSOLE !== "1") return state;
  const methods = ["log", "warn", "error", "debug", "info"] as const;
  const originals = methods.map((method) => console[method]);
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (state.measured)
        throw new Error(`console.${method} called inside measured workload`);
      original(...args);
    };
  }
  state.restore = () =>
    methods.forEach((method, index) => (console[method] = originals[index]));
  return state;
}

function summarize(
  entry: RegisteredCase,
  rounds: RoundRecord[],
  capped?: { pilotMs: number; ceilingMs: number }
): TimingRecord {
  const [defaultGroup, defaultFamily] = workloadFamily(entry.name);
  const base = {
    id: entry.id,
    framework: entry.framework,
    name: entry.name,
    profile: samplingPolicy(entry.samples).profile,
    validation: entry.validate ? ("passed" as const) : ("absent" as const),
    group: entry.group ?? defaultGroup,
    family: entry.family ?? defaultFamily,
    fixture: entry.reuseFixture ? ("warm-reused" as const) : ("fresh" as const),
  };
  if (capped) {
    return {
      ...base,
      capped: true,
      ceilingMs: capped.ceilingMs,
      estimateMs: capped.pilotMs,
      statistics: timingStatistics([capped.pilotMs]),
      rounds: [
        { round: 1, pilotMs: capped.pilotMs, warmupMs: [], samplesMs: [] },
      ],
    };
  }
  const statistics = timingStatistics(rounds.flatMap((r) => r.samplesMs));
  const medians = rounds.map((r) => r.statistics!.median);
  const single = rounds.length === 1;
  const interval = single
    ? rounds[0].statistics!.medianInterval
    : [Math.min(...medians), Math.max(...medians)];
  return {
    ...base,
    capped: false,
    estimateMs: single ? medians[0] : timingStatistics(medians).median,
    interval: interval && {
      kind: single ? "median-order-statistic-95" : "round-median-range",
      lowMs: interval[0],
      highMs: interval[1],
    },
    statistics,
    rounds,
  };
}

function formatRow(
  record: TimingRecord,
  row: PerfRowStrings = {
    framework: record.framework,
    test: record.name,
    time: "",
    metrics: "",
  }
): PerfRowStrings {
  const { statistics } = record;
  const out: PerfRowStrings = {
    ...row,
    time: record.estimateMs.toFixed(6),
    p95: statistics.p95?.toFixed(6) ?? "",
    p99: statistics.p99?.toFixed(6) ?? "",
    cv: statistics.cv?.toFixed(6) ?? "",
    group: record.group,
    family: record.family,
  };
  const tokens: string[] = [];
  if (record.capped) {
    tokens.push(
      `SLOW/CAPPED samples=1 ceiling=${record.ceilingMs!.toFixed(0)}ms pilot=cold`
    );
  } else {
    const warmup = record.rounds[0].warmupMs.length;
    const tails =
      statistics.p99 !== undefined
        ? "p95+p99"
        : statistics.p95 !== undefined
          ? "p95"
          : "insufficient";
    tokens.push(
      `samples=${statistics.count} rounds=${record.rounds.length} profile=${record.profile} warmup=${warmup} pilot=excluded tails=${tails} fixture=${record.fixture}`
    );
    if (record.interval) {
      const key =
        record.interval.kind === "round-median-range"
          ? "round_range"
          : "median_ci95";
      tokens.push(
        `${key}=${record.interval.lowMs.toFixed(6)}..${record.interval.highMs.toFixed(6)}`
      );
    }
    for (const key of ["p95", "p99"] as const) {
      const interval = statistics[`${key}Interval`];
      if (interval)
        tokens.push(
          `${key}_ci95=${interval[0].toFixed(6)}..${interval[1].toFixed(6)}`
        );
    }
  }
  if (row.metrics) tokens.push(row.metrics);
  out.metrics = tokens.join(" ");
  return out;
}

/** Versions of the packages bundled into each framework worker. */
function packageVersions(): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [framework, entry] of workerEntries) {
    const manifest = entry.replace(/\.cjs$/, ".packages.json");
    if (existsSync(manifest))
      result[framework] = JSON.parse(readFileSync(manifest, "utf8"));
  }
  return result;
}

async function saveTimingRecords(
  policy: SamplingPolicy,
  isolation: string,
  packages: Record<string, Record<string, string>>,
  rows: TimingRecord[]
): Promise<void> {
  const output =
    process.env.BENCH_SAMPLES_FILE ?? "bench-results/last-run.samples.json";
  if (!output) return;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        semantics: SEMANTICS_VERSION,
        profile: policy.profile,
        policy: {
          ...policy,
          minSamples: process.env.BENCH_SAMPLES?.trim()
            ? policy.minSamples
            : "per-case",
        },
        node: process.version,
        v8: process.versions.v8,
        platform: `${process.platform}/${process.arch}`,
        cpu: cpus()[0]?.model ?? "unknown",
        cores: cpus().length,
        ram: totalmem(),
        gc: !!globalThis.gc,
        isolation,
        order:
          "interleaved: scenario-major, framework rotation per scenario and round",
        nodeEnv: "production",
        capPolicy: {
          minCeilingMs: MIN_PERFORMANCE_CEILING_MS,
          maxSlowdown: MAX_SLOWDOWN_FACTOR,
        },
        packages,
        sampleOrder: "chronological; all observations retained",
        consoleGuard: process.env.BENCH_ASSERT_NO_CONSOLE === "1",
        sourceCommit: process.env.BENCH_SOURCE_COMMIT,
        lockfileSha256: existsSync("pnpm-lock.yaml")
          ? createHash("sha256")
              .update(await readFile("pnpm-lock.yaml"))
              .digest("hex")
          : undefined,
        rows,
      },
      null,
      2
    ) + "\n"
  );
}

export function performanceCeilingMs(
  previousBest: number | undefined,
  minimumMs = MIN_PERFORMANCE_CEILING_MS,
  slowdownFactor = MAX_SLOWDOWN_FACTOR
): number {
  return previousBest === undefined
    ? minimumMs
    : Math.max(minimumMs, previousBest * slowdownFactor);
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

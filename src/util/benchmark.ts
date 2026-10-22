import { fork } from "node:child_process";
import { cpus, release, totalmem, type } from "node:os";
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
  /** Report label when it differs from `name`; known before measuring. */
  title?: string;
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
  /** Wall-clock cost of the row's workers, process start included. */
  wallMs?: number;
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

export type FailureKind =
  | "incorrect"
  | "error"
  | "out-of-memory"
  | "stack-overflow"
  | "crashed"
  | "timeout";

export interface RowFailure {
  kind: FailureKind;
  message: string;
}

/**
 * A row that could not be measured. Failures are results: they are logged,
 * saved and shown, and the framework is not ranked overall.
 */
export interface FailedRecord {
  id: string;
  framework: string;
  name: string;
  title: string;
  status: "failed";
  failure: RowFailure;
  group: string;
  family: string;
  wallMs?: number;
}

type CaseOutcome =
  | { kind: "measured"; id: string; round: RoundRecord; row: PerfRowStrings }
  | { kind: "deferred"; id: string; pilotMs: number; row: PerfRowStrings }
  | { kind: "failed"; id: string; failure: RowFailure };

/** Thrown when a produced result is wrong, as opposed to a crash. */
class ValidationError extends Error {}

export function classifyFailure(text: string): FailureKind {
  if (
    /heap out of memory|Array buffer allocation failed|Invalid array length|allocation failed/i.test(
      text
    )
  )
    return "out-of-memory";
  if (/Maximum call stack size exceeded/i.test(text)) return "stack-overflow";
  return "crashed";
}

function failureOf(error: unknown): RowFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ValidationError) return { kind: "incorrect", message };
  const kind = classifyFailure(message);
  return { kind: kind === "crashed" ? "error" : kind, message };
}

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
/**
 * Wall-clock budget for one row worker: process start, setup and pilot (plus
 * warmup and samples when uncapped). Legitimate rows, including capped slow
 * ones, finish far below it; a row that cannot is a `timeout` failure.
 */
const ROW_TIMEOUT_MS = readPositiveNumber("BENCH_ROW_TIMEOUT_MS", 180_000);
/**
 * The same V8 heap budget on every machine, independent of the runner's RAM.
 * A library whose memory keeps growing fails as out-of-memory instead of
 * spending the run in back-to-back full GCs near a machine-dependent limit.
 */
const WORKER_HEAP_MB = readPositiveNumber("BENCH_HEAP_MB", 4096);

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

export interface ShardSpec {
  index: number;
  count: number;
}

/** `BENCH_SHARD=i/n` selects the i-th of n scenario shards (1-based). */
export function readShard(raw = process.env.BENCH_SHARD?.trim()) {
  if (!raw) return undefined;
  const match = raw.match(/^(\d+)\/(\d+)$/);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || index < 1 || count < 1 || index > count)
    throw new Error(`BENCH_SHARD must look like i/n with 1 <= i <= n: ${raw}`);
  return { index, count } satisfies ShardSpec;
}

/**
 * Partition scenarios, never frameworks: every framework of a scenario runs
 * on the same machine, so each per-scenario comparison stays within one CPU
 * even when CI shards land on different hardware. Longest-processing-time
 * first by measured cost; deterministic for identical inputs.
 */
export function shardScenarios(
  names: readonly string[],
  count: number,
  weights: ReadonlyMap<string, number>
): string[][] {
  if (count > names.length)
    throw new Error(
      `Cannot split ${names.length} scenarios into ${count} shards`
    );
  const known = names
    .map((name) => weights.get(name))
    .filter((weight): weight is number => weight !== undefined && weight > 0)
    .sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weightOf = (name: string) => {
    const weight = weights.get(name);
    return weight !== undefined && weight > 0 ? weight : fallback;
  };
  const order = names
    .map((name, index) => ({ name, index, weight: weightOf(name) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const loads = new Array<number>(count).fill(0);
  const shardOf = new Map<string, number>();
  for (const { name, weight } of order) {
    let target = 0;
    for (let shard = 1; shard < count; shard++)
      if (loads[shard] < loads[target]) target = shard;
    loads[target] += weight;
    shardOf.set(name, target);
  }
  return loads.map((_, shard) =>
    names.filter((name) => shardOf.get(name) === shard)
  );
}

/** Total measured cost per scenario from a previous samples file (v3 or v4). */
export function scenarioWeights(file: string): Map<string, number> {
  const weights = new Map<string, number>();
  if (!existsSync(file)) return weights;
  let rows: any[] = [];
  try {
    rows = JSON.parse(readFileSync(file, "utf8")).rows ?? [];
  } catch {
    return weights;
  }
  const sum = (values: number[] = []) =>
    values.reduce((total, value) => total + value, 0);
  // Prefer the recorded wall time: it includes setup, process start, and the
  // time spent on rows that failed or timed out.
  const cost = (row: any): number => {
    if (typeof row.wallMs === "number") return row.wallMs;
    const machines = (row.machines ?? []).filter(
      (machine: any) => machine.record
    );
    if (machines.length)
      return (
        sum(machines.map((machine: any) => cost(machine.record))) /
        machines.length
      );
    const rounds: any[] = row.rounds ?? [row];
    return sum(
      rounds.map(
        (round) =>
          (round.pilotMs ?? 0) + sum(round.warmupMs) + sum(round.samplesMs)
      )
    );
  };
  for (const row of rows)
    weights.set(row.name, (weights.get(row.name) ?? 0) + cost(row));
  return weights;
}

function selectShard(shard: ShardSpec): string[] {
  const names = Array.from(new Set(registeredCases.map((entry) => entry.name)));
  const scenarios = shardScenarios(
    names,
    shard.count,
    scenarioWeights(
      process.env.BENCH_SHARD_WEIGHTS ?? "bench-results/latest.samples.json"
    )
  )[shard.index - 1];
  const selected = new Set(scenarios);
  const kept = registeredCases.filter((entry) => selected.has(entry.name));
  registeredCases.splice(0, registeredCases.length, ...kept);
  return scenarios;
}

/** Hash of the runner and worker bundles; shards must measure identical code. */
function bundleSha256(): string {
  const files = [process.argv[1], ...workerEntries.values()]
    .filter((file) => file && existsSync(file))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.basename(file));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Entry point for the parent runner, a row worker (`BENCH_CASE`), and the
 * shared-process diagnostic mode (`BENCH_IN_PROCESS=1`).
 */
export async function runBenchmarks(): Promise<void> {
  if (registeredCases.length === 0)
    throw new Error("No benchmark cases matched the selection.");

  if (process.env.BENCH_CASE) {
    const entry = registeredCases[0];
    const outcome = measureCaseSafely(
      entry,
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
      logPerfResult(formatRow(summarize(entry, [outcome.round]), outcome.row));
    }
    if (outcome.kind === "failed")
      throw new Error(`${entry.id}: ${outcome.failure.message}`);
    return;
  }

  const policy = samplingPolicy();
  const isolation = process.env.BENCH_IN_PROCESS === "1" ? "shared" : "row";
  const shard = readShard();
  const scenarios = shard ? selectShard(shard) : undefined;
  const machineRound = readPositiveInteger("BENCH_MACHINE_ROUND", 1);
  const bundle = bundleSha256();
  console.log(
    `# semantics=${SEMANTICS_VERSION} profile=${policy.profile} rounds=${policy.rounds} warmup=${policy.warmup} min_samples=${process.env.BENCH_SAMPLES?.trim() || "per-case"} max_samples=${policy.maxSamples} min_time_ms=${policy.minTimeMs} node=${process.version} v8=${process.versions.v8} platform=${process.platform}/${process.arch} cpu=${(cpus()[0]?.model ?? "unknown").trim().replace(/\s+/g, "_")} cores=${cpus().length} ram=${totalmem()} gc=${!!globalThis.gc} isolation=${isolation} order=interleaved node_env=production instrumented=${process.env.BENCH_INSTRUMENT === "1"} shard=${shard ? `${shard.index}/${shard.count}` : "none"} machine_round=${machineRound} bundle=${bundle.slice(0, 12)} heap_mb=${WORKER_HEAP_MB} row_timeout_s=${Math.round(ROW_TIMEOUT_MS / 1000)}`
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
  await saveTimingRecords(policy, isolation, packages, records, {
    shard: shard && { ...shard, scenarios: scenarios! },
    machineRound,
    bundleSha256: bundle,
  });
  const failures = records.filter(
    (record): record is FailedRecord => "failure" in record
  );
  if (failures.length) {
    const summary = failures
      .map(({ id, failure }) => `${id}: ${failure.kind}: ${failure.message}`)
      .join("\n");
    // Publication runs record failures as results; every other run fails.
    if (process.env.BENCH_ALLOW_FAILURES === "1")
      process.stderr.write(
        `Recorded ${failures.length} failed rows:\n${summary}\n`
      );
    else throw new Error(`Benchmark failures:\n${summary}`);
  }
}

interface RowState {
  entry: RegisteredCase;
  rounds: RoundRecord[];
  row?: PerfRowStrings;
  capped?: { pilotMs: number; ceilingMs: number };
  failure?: RowFailure;
  wallMs?: number;
}

async function runPlan(
  policy: SamplingPolicy
): Promise<(TimingRecord | FailedRecord)[]> {
  const states = new Map(
    registeredCases.map((entry) => [
      entry.id,
      { entry, rounds: [] } as RowState,
    ])
  );
  const records: (TimingRecord | FailedRecord)[] = [];
  const total = registeredCases.length * policy.rounds;
  let started = 0;
  const finish = (state: RowState) => {
    if (state.failure) {
      const record = {
        ...failedRecord(state.entry, state.failure),
        wallMs: state.wallMs,
      };
      logPerfResult(failedRow(record));
      records.push(record);
      return;
    }
    const record = {
      ...summarize(state.entry, state.rounds, state.capped),
      wallMs: state.wallMs,
    };
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
      const startedAt = performance.now();
      const outcome = await runRow(state.entry, round, allowDefer);
      // Whole-row cost, process start included: what CI shards must balance.
      state.wallMs = (state.wallMs ?? 0) + performance.now() - startedAt;
      if (outcome.kind === "failed") {
        // A failure in any round is the row's result.
        state.failure = outcome.failure;
        finish(state);
        return;
      }
      state.row = outcome.row;
      if (outcome.kind === "deferred") {
        note(state.entry.name, outcome.pilotMs);
        deferred.push({ state, pilotMs: outcome.pilotMs });
        return;
      }
      note(state.entry.name, outcome.round.pilotMs);
      state.rounds.push(outcome.round);
      if (round === policy.rounds) finish(state);
    };

    for (const entry of executionOrder(registeredCases, round)) {
      const state = states.get(entry.id)!;
      if (state.failure || state.capped) continue;
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

  return records;
}

/** Run one row in a fresh worker process, or in-process for diagnostics. */
async function runRow(
  entry: RegisteredCase,
  round: number,
  allowDefer: boolean
): Promise<CaseOutcome> {
  if (process.env.BENCH_IN_PROCESS === "1")
    return measureCaseSafely(entry, round, allowDefer);
  const failed = (failure: RowFailure): CaseOutcome => ({
    kind: "failed",
    id: entry.id,
    failure,
  });
  return await new Promise<CaseOutcome>((resolve) => {
    let outcome: CaseOutcome | undefined;
    let timedOut = false;
    // Keep the end of the worker's diagnostics to classify crashes.
    let tail = "";
    const remember = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4096);
      process.stderr.write(chunk);
    };
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
        execArgv: [
          ...process.execArgv.filter(
            (flag) => !flag.startsWith("--max-old-space-size")
          ),
          `--max-old-space-size=${WORKER_HEAP_MB}`,
        ],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    );
    const timer = setTimeout(() => {
      timedOut = true;
      // A worker stuck in back-to-back GCs may not act on SIGTERM promptly.
      child.kill("SIGKILL");
    }, ROW_TIMEOUT_MS);
    child.stdout!.on("data", remember);
    child.stderr!.on("data", remember);
    child.on("message", (message: CaseOutcome) => {
      if (message?.id === entry.id) outcome = message;
    });
    child.on("error", (error) =>
      resolve(failed({ kind: "crashed", message: error.message }))
    );
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut)
        resolve(
          failed({
            kind: "timeout",
            message: `worker exceeded ${ROW_TIMEOUT_MS} ms`,
          })
        );
      else if (outcome?.kind === "failed") resolve(outcome);
      else if (code === 0 && outcome) resolve(outcome);
      else {
        const lastLine = tail
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("at "))
          .at(-1);
        resolve(
          failed({
            kind: classifyFailure(tail),
            message: `worker exited with code ${code}, signal ${signal}${outcome ? "" : ", no result"}${lastLine ? `: ${lastLine}` : ""}`,
          })
        );
      }
    });
  });
}

/** Measure a case; an exception becomes a classified failure outcome. */
function measureCaseSafely(
  entry: RegisteredCase,
  round: number,
  allowDefer: boolean
): CaseOutcome {
  try {
    return measureCase(entry, round, allowDefer);
  } catch (error) {
    return { kind: "failed", id: entry.id, failure: failureOf(error) };
  }
}

function failedRecord(
  entry: RegisteredCase,
  failure: RowFailure
): FailedRecord {
  const [defaultGroup, defaultFamily] = workloadFamily(entry.name);
  return {
    id: entry.id,
    framework: entry.framework,
    name: entry.name,
    title: entry.title ?? entry.name,
    status: "failed",
    failure,
    group: entry.group ?? defaultGroup,
    family: entry.family ?? defaultFamily,
  };
}

/** `FAILED` in the time column; the reason stays free of column separators. */
function failedRow(record: FailedRecord): PerfRowStrings {
  const reason = record.failure.message
    .replace(/\s+/g, " ")
    .replace(/,/g, ";")
    .slice(0, 200);
  return {
    framework: record.framework,
    test: record.title,
    time: "FAILED",
    p95: "",
    p99: "",
    cv: "",
    group: record.group,
    family: record.family,
    metrics: `FAILED kind=${record.failure.kind} reason=${JSON.stringify(reason)}`,
  };
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
      try {
        entry.validate?.(result, fixture);
      } catch (error) {
        throw new ValidationError(
          error instanceof Error ? error.message : String(error)
        );
      }
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
  rows: (TimingRecord | FailedRecord)[],
  run: {
    shard?: ShardSpec & { scenarios: string[] };
    machineRound: number;
    bundleSha256: string;
  }
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
        cpu: cpus()[0]?.model.trim() ?? "unknown",
        cores: cpus().length,
        ram: totalmem(),
        os: `${type()} ${release()}`,
        shard: run.shard,
        machineRound: run.machineRound,
        bundleSha256: run.bundleSha256,
        gc: !!globalThis.gc,
        isolation,
        order:
          "interleaved: scenario-major, framework rotation per scenario and round",
        nodeEnv: "production",
        limits: { heapMb: WORKER_HEAP_MB, rowTimeoutMs: ROW_TIMEOUT_MS },
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

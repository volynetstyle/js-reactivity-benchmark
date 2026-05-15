import { TestConfig } from "./frameworkTypes";
import { TestResult, TimingResult } from "./perfTests";
import { metadataForDynamicConfig, WorkloadMetadata } from "./benchMetadata";

export function logPerfResult(row: PerfRowStrings): void {
  const line = Object.values(trimColumns(row)).join(" , ");
  console.log(line);
}

export interface PerfRowStrings {
  framework: string;
  test: string;
  time: string;
  p95: string;
  p99: string;
  cv: string;
  group: string;
  family: string;
  metrics: string;
}

const columnWidth = {
  framework: 22,
  test: 60,
  time: 8,
  p95: 8,
  p99: 8,
  cv: 8,
  group: 14,
  family: 24,
  metrics: 96,
};

export function perfReportHeaders(): PerfRowStrings {
  const keys: (keyof PerfRowStrings)[] = Object.keys(columnWidth) as any;
  const kv = keys.map((key) => [key, key]);
  const untrimmed = Object.fromEntries(kv);
  return trimColumns(untrimmed);
}

export function perfRowStrings(
  frameworkName: string,
  config: TestConfig,
  timed: TimingResult<TestResult>
): PerfRowStrings {
  const { timing } = timed;
  const metadata = metadataForDynamicConfig(config);

  return {
    framework: frameworkName,
    test: `${makeTitle(config)} (${config.name || ""})`,
    time: timing.time.toFixed(2),
    p95: formatOptionalTiming(timing.p95),
    p99: formatOptionalTiming(timing.p99),
    cv: formatOptionalRatio(timing.cv),
    group: metadata.group,
    family: metadata.family,
    metrics: formatMetrics(timed.result.metrics),
  };
}

export function perfNamedRowStrings(
  frameworkName: string,
  test: string,
  timed: TimingResult<unknown>,
  metadata: WorkloadMetadata,
  metrics = ""
): PerfRowStrings {
  const { timing } = timed;
  return {
    framework: frameworkName,
    test,
    time: timing.time.toFixed(2),
    p95: formatOptionalTiming(timing.p95),
    p99: formatOptionalTiming(timing.p99),
    cv: formatOptionalRatio(timing.cv),
    group: metadata.group,
    family: metadata.family,
    metrics,
  };
}

export function makeTitle(config: TestConfig): string {
  const {
    width,
    totalLayers,
    staticFraction,
    nSources,
    sourcesCount,
    fanIn,
    readFraction,
    mode,
    graphKind = "rect",
    updatesPerIteration = 1,
    warmupIterations = 0,
    sinkReadMode,
  } = config;
  const dyn = staticFraction < 1 ? " - dynamic" : "";
  const read = readFraction < 1 ? ` - read ${percent(readFraction)}` : "";
  const execMode = mode && mode !== "mixed" ? ` - ${mode}` : "";
  const sources = ` - ${nSources} sources`;
  const dagShape =
    graphKind === "rect"
      ? `${width}x${totalLayers}`
      : `${sourcesCount ?? width}->${width}x${totalLayers} - fanIn ${fanIn ?? nSources}`;
  const graphLabel = graphKind === "rect" ? "" : ` - ${graphKind}`;
  const burst = updatesPerIteration > 1 ? ` - burst ${updatesPerIteration}` : "";
  const warmup = warmupIterations > 0 ? ` - warm ${warmupIterations}` : "";
  const sinkMode =
    sinkReadMode && sinkReadMode !== "per-update"
      ? ` - ${sinkReadMode}`
      : "";
  return `${dagShape}${graphLabel}${sources}${dyn}${read}${execMode}${burst}${warmup}${sinkMode}`;
}

function percent(n: number): string {
  return Math.round(n * 100) + "%";
}

function trimColumns(row: PerfRowStrings): PerfRowStrings {
  const keys: (keyof PerfRowStrings)[] = Object.keys(columnWidth) as any;
  const trimmed = { ...row };
  for (const key of keys) {
    const length = columnWidth[key];
    const value = (row[key] || "").slice(0, length).padEnd(length);
    trimmed[key] = value;
  }
  return trimmed;
}

function formatMetrics(metrics: Record<string, number | undefined> | undefined): string {
  if (!metrics) {
    return "";
  }

  const orderedKeys = [
    "nodesRecomputed",
    "nodesVisited",
    "edgesTraversed",
    "sinkReads",
    "fallbackCount",
    "heightAdjustCount",
    "maxDirtyQueueSize",
  ] as const;

  return orderedKeys
    .flatMap((key) => {
      const value = metrics[key];
      return typeof value === "number" ? `${key}=${value}` : [];
    })
    .join(" ");
}

function formatOptionalTiming(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "";
}

function formatOptionalRatio(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "";
}

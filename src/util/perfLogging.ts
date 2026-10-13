import { TestConfig } from "./frameworkTypes";
import { TestResult } from "./perfTests";

export function logPerfResult(row: PerfRowStrings): void {
  const padded = trimColumns(row);
  const line = Object.keys(columnWidth)
    .map((key) => padded[key as keyof PerfRowStrings])
    .join(" , ");
  console.log(line);
}

export interface PerfRowStrings {
  framework: string;
  test: string;
  time: string;
  metrics: string;
  p95?: string;
  p99?: string;
  cv?: string;
  group?: string;
  family?: string;
}

const columnWidth = {
  framework: 22,
  test: 60,
  time: 8,
  p95: 8,
  p99: 8,
  cv: 8,
  group: 12,
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
  timeMs: number,
  result: TestResult
): PerfRowStrings {
  return {
    framework: frameworkName,
    test: `${makeTitle(config)} (${config.name || ""})`,
    time: timeMs.toFixed(2),
    metrics: formatMetrics(result.metrics),
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
  const burst =
    updatesPerIteration > 1 ? ` - burst ${updatesPerIteration}` : "";
  const warmup = warmupIterations > 0 ? ` - warm ${warmupIterations}` : "";
  const sinkMode =
    sinkReadMode && sinkReadMode !== "per-update" ? ` - ${sinkReadMode}` : "";
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
    // Truncated scenario/framework identifiers can merge different workloads
    // in the report parser. Width is padding only; preserve the full value.
    const value = (row[key] || "").padEnd(length);
    trimmed[key] = value;
  }
  return trimmed;
}

function formatMetrics(metrics: TestResult["metrics"]): string {
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

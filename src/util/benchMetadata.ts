import { TestConfig } from "./frameworkTypes";

export type WorkloadGroup =
  | "creation"
  | "update"
  | "pull"
  | "push"
  | "dynamic"
  | "large_graph"
  | "lifecycle"
  | "baseline";

export interface WorkloadMetadata {
  group: WorkloadGroup;
  family: string;
  dominantOperation: string;
  topology: string;
  scale: string;
}

export function metadataForNamedScenario(
  suite: string,
  name: string
): WorkloadMetadata {
  if (suite === "s") {
    if (name.startsWith("createData")) {
      return micro("creation", "signal creation", "create signal", name);
    }
    if (name.startsWith("createComputations")) {
      return micro("creation", "computed creation", "create computed", name);
    }
    if (name.startsWith("updateComputations")) {
      return micro("update", "stable update", "write + invalidate", name);
    }
  }

  if (suite === "fan") {
    const fanIn = name.includes("SourcesIntoOne");
    return {
      group: fanIn ? "pull" : "push",
      family: fanIn ? "wide fan-in" : "wide fan-out",
      dominantOperation: fanIn ? "aggregation pull" : "broadcast push",
      topology: fanIn ? "many sources -> one observer" : "one source -> many observers",
      scale: "fixed",
    };
  }

  if (suite === "kairo") {
    const familyByName: Record<string, string> = {
      avoidablePropagation: "selective propagation",
      broadPropagation: "wide fan-out",
      deepPropagation: "linear chain",
      diamond: "diamond",
      mux: "dynamic branch",
      repeatedObservers: "duplicate observer",
      triangle: "glitch-free triangle",
      unstable: "dynamic dependency churn",
    };
    const family = familyByName[name] ?? "baseline propagation";
    return {
      group:
        name === "mux" || name === "unstable"
          ? "dynamic"
          : name === "deepPropagation"
            ? "pull"
            : "baseline",
      family,
      dominantOperation: "write + propagation",
      topology: family,
      scale: "fixed",
    };
  }

  if (suite === "mol") {
    return {
      group: "dynamic",
      family: "mixed app graph",
      dominantOperation: "batched writes + effects",
      topology: "conditional computed DAG",
      scale: "fixed",
    };
  }

  return micro("baseline", suite, "mixed", name);
}

export function metadataForDynamicConfig(config: TestConfig): WorkloadMetadata {
  const dynamicFraction = 1 - config.staticFraction;
  const graphKind = config.graphKind ?? "rect";
  const nodes = estimateNodes(config);
  const edges = estimateEdges(config);
  const churn =
    dynamicFraction === 0
      ? "0%"
      : `${Math.round(dynamicFraction * 100)}% dynamic nodes`;

  const family =
    graphKind === "diamond-mesh"
      ? "diamond mesh"
      : graphKind === "layered-dag"
        ? "layered DAG"
        : dynamicFraction > 0
          ? "dynamic rectangular DAG"
          : "stable rectangular DAG";

  return {
    group: dynamicFraction > 0 ? "dynamic" : nodes >= 10_000 ? "large_graph" : "pull",
    family,
    dominantOperation:
      config.mode === "push"
        ? "write + effect delivery"
        : config.mode === "pull"
          ? "dirty pull"
          : dynamicFraction > 0
            ? "branch switch + dirty pull"
            : "write + selective read",
    topology: `${graphKind}; V~${nodes}; E~${edges}; D=${config.totalLayers}; fanIn=${config.fanIn ?? config.nSources}; read=${percent(config.readFraction)}; churn=${churn}`,
    scale: nodes >= 10_000 ? "large" : nodes >= 1_000 ? "medium" : "small",
  };
}

function estimateNodes(config: TestConfig): number {
  return (config.sourcesCount ?? config.width) + config.width * config.totalLayers;
}

function estimateEdges(config: TestConfig): number {
  const fanIn = config.fanIn ?? config.nSources;
  return config.width * config.totalLayers * fanIn;
}

function micro(
  group: WorkloadGroup,
  family: string,
  dominantOperation: string,
  topology: string
): WorkloadMetadata {
  return {
    group,
    family,
    dominantOperation,
    topology,
    scale: "micro",
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

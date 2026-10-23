import { SeededRandom } from "./seededRandom";
import { TestConfig } from "./frameworkTypes";

/**
 * Numerical oracle: evaluates plain arrays at the final source values.
 * No framework, adapter, reactive graph builder, or batching runner is used.
 * Computation bodies are pure, so read cadence must not change this result.
 */
export function expectedGraphSum(config: TestConfig): number {
  const {
    width,
    totalLayers,
    staticFraction,
    nSources,
    readFraction,
    iterations,
    graphKind = "rect",
    sourcesCount = width,
    fanIn = nSources,
    updatesPerIteration = 1,
    warmupIterations = 0,
    measureBuild = warmupIterations === 0,
  } = config;
  const warmup = measureBuild ? 0 : warmupIterations;
  const writes = (warmup + iterations) * updatesPerIteration;
  // Only the last write to each source affects the final numerical graph.
  // Derive it directly instead of replaying every benchmark iteration.
  let previous = Array.from({ length: sourcesCount }, (_, index) => {
    if (index >= writes) return index;
    const tick =
      index + Math.floor((writes - 1 - index) / sourcesCount) * sourcesCount;
    return tick + index;
  });

  const random = new SeededRandom("seed");
  const layers = graphKind === "rect" ? totalLayers - 1 : totalLayers;
  for (let layer = 0; layer < layers; layer++) {
    const size = graphKind === "rect" ? previous.length : width;
    const next = new Array<number>(size);
    const inputCount = graphKind === "rect" ? nSources : fanIn;
    const step = Math.max(
      1,
      Math.floor(previous.length / Math.max(1, fanIn * 8))
    );
    const cluster = Math.max(2, Math.floor(fanIn / 2));
    for (let node = 0; node < size; node++) {
      const base =
        graphKind === "rect"
          ? node
          : graphKind === "layered-dag"
            ? node * 13 + layer * 17
            : Math.floor(node / cluster) * cluster + layer * cluster;
      const isStatic = random.float() < staticFraction;
      let sum = previous[base % previous.length];
      const tailLength = inputCount - 1;
      const drop =
        graphKind === "rect"
          ? sum % tailLength
          : tailLength === 0
            ? 0
            : (sum + node) % tailLength;
      const shouldDrop =
        graphKind === "rect" ? sum & 1 : (sum + layer + node) & 1;
      for (let input = 1; input < inputCount; input++) {
        if (!isStatic && shouldDrop && input - 1 === drop) continue;
        const offset =
          graphKind === "rect"
            ? input
            : graphKind === "layered-dag"
              ? input * step
              : Math.floor(input / 2);
        sum += previous[(base + offset) % previous.length];
      }
      next[node] = sum;
    }
    previous = next;
  }

  const selectionRandom = new SeededRandom("seed");
  const skip = Math.round(previous.length * (1 - readFraction));
  for (let i = 0; i < skip; i++) {
    previous.splice(selectionRandom.int(0, previous.length - 1), 1);
  }
  return previous.reduce((sum, value) => sum + value, 0);
}

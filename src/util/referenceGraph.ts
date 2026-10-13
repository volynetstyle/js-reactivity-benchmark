import { Random } from "random";
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
  let previous = Array.from({ length: sourcesCount }, (_, i) => i);
  for (
    let tick = 0;
    tick < (warmup + iterations) * updatesPerIteration;
    tick++
  ) {
    const index = tick % sourcesCount;
    previous[index] = tick + index;
  }

  const random = new Random("seed");
  const layers = graphKind === "rect" ? totalLayers - 1 : totalLayers;
  for (let layer = 0; layer < layers; layer++) {
    const size = graphKind === "rect" ? previous.length : width;
    const next = new Array<number>(size);
    for (let node = 0; node < size; node++) {
      const inputs: number[] = [];
      const inputCount = graphKind === "rect" ? nSources : fanIn;
      const step = Math.max(
        1,
        Math.floor(previous.length / Math.max(1, fanIn * 8))
      );
      const cluster = Math.max(2, Math.floor(fanIn / 2));
      for (let input = 0; input < inputCount; input++) {
        let index: number;
        if (graphKind === "rect") {
          index = (node + input) % previous.length;
        } else if (graphKind === "layered-dag") {
          index = (node * 13 + layer * 17 + input * step) % previous.length;
        } else {
          index =
            (Math.floor(node / cluster) * cluster +
              layer * cluster +
              Math.floor(input / 2)) %
            previous.length;
        }
        inputs.push(previous[index]);
      }
      const isStatic = random.float() < staticFraction;
      let sum = inputs[0];
      const tailLength = inputs.length - 1;
      const drop =
        graphKind === "rect"
          ? sum % tailLength
          : tailLength === 0
            ? 0
            : (sum + node) % tailLength;
      const shouldDrop =
        graphKind === "rect" ? sum & 1 : (sum + layer + node) & 1;
      for (let input = 1; input < inputs.length; input++) {
        if (!isStatic && shouldDrop && input - 1 === drop) continue;
        sum += inputs[input];
      }
      next[node] = sum;
    }
    previous = next;
  }

  const selectionRandom = new Random("seed");
  const skip = Math.round(previous.length * (1 - readFraction));
  for (let i = 0; i < skip; i++) {
    previous.splice(selectionRandom.int(0, previous.length - 1), 1);
  }
  return previous.reduce((sum, value) => sum + value, 0);
}

import { TestConfig } from "./frameworkTypes";
import { Computed, ReactiveFramework, Signal } from "./reactiveFramework";
import { SeededRandom } from "./seededRandom";
import { fixtureScope } from "./fixtureScope";

export interface Graph {
  sources: Signal<number>[];
  layers: Computed<number>[][];
  counter: Counter;
  disposePushEffects?: () => void;
}

export interface BenchCountersSnapshot {
  nodesRecomputed: number;
  nodesVisited: number;
  edgesTraversed: number;
  sinkReads: number;
}

/**
 * Make a rectangular dependency graph, with an equal number of source elements
 * and computation elements at every layer.
 *
 * @param width number of source elements and number of computed elements per layer
 * @param totalLayers total number of source and computed layers
 * @param staticFraction every nth computed node is static (1 = all static, 3 = 2/3rd are dynamic)
 * @returns the graph
 */
export function makeGraph(
  framework: ReactiveFramework,
  config: TestConfig,
  counter: Counter
): Graph {
  const {
    width,
    totalLayers,
    staticFraction,
    nSources,
    graphKind = "rect",
    sourcesCount = width,
    fanIn = nSources,
  } = config;

  return framework.withBuild(() => {
    const sources = new Array<Signal<number>>(sourcesCount);
    for (let i = 0; i < sourcesCount; i++) sources[i] = framework.signal(i);
    const rows =
      graphKind === "rect"
        ? makeDependentRows(
            sources,
            totalLayers - 1,
            counter,
            staticFraction,
            nSources,
            framework
          )
        : makeLayeredRows(
            sources,
            totalLayers,
            width,
            counter,
            staticFraction,
            fanIn,
            framework,
            graphKind
          );
    const graph = { sources, layers: rows, counter };
    return graph;
  });
}

/**
 * Execute the graph by writing one of the sources and reading some or all of the leaves.
 *
 * @return the sum of all leaf values
 */
export function runGraph(
  graph: Graph,
  config: Pick<
    TestConfig,
    | "iterations"
    | "readFraction"
    | "mode"
    | "updatesPerIteration"
    | "sinkReadMode"
  > & { startTick?: number },
  framework: ReactiveFramework
): number {
  return withActiveCounter(graph.counter, () => {
    const {
      iterations,
      readFraction,
      mode = "mixed",
      updatesPerIteration = 1,
      sinkReadMode = "per-update",
      startTick = 0,
    } = config;
    const { sources, layers } = graph;
    if (
      updatesPerIteration > sources.length &&
      (mode !== "mixed" || sinkReadMode !== "per-update")
    ) {
      throw new Error(
        "A transaction must write each source at most once (S.js freeze contract)."
      );
    }
    const leaves = layers[layers.length - 1];
    const removeCount = Math.round(leaves.length * (1 - readFraction));
    // Full-drain rows need neither a copy nor a fresh random generator.
    const readLeaves =
      removeCount === 0
        ? leaves
        : removeElems(leaves, removeCount, new SeededRandom("seed"));
    let tick = startTick;
    const write = () => {
      const sourceIndex = tick % sources.length;
      sources[sourceIndex].write(tick + sourceIndex);
      tick++;
    };
    const writeBatch = () => {
      for (let update = 0; update < updatesPerIteration; update++) write();
    };
    const read = () => {
      let sum = 0;
      for (const leaf of readLeaves) sum += trackedRead(leaf);
      return sum;
    };

    if (mode === "push") {
      const latestValues = new Array<number>(readLeaves.length).fill(0);
      const scope = fixtureScope(framework, () => {
        for (const [index, leaf] of readLeaves.entries()) {
          framework.effect(() => {
            latestValues[index] = trackedRead(leaf);
          });
        }
      });
      graph.disposePushEffects = scope.dispose;
      for (let iteration = 0; iteration < iterations; iteration++)
        framework.withBatch(writeBatch);
      return latestValues.reduce((sum, value) => sum + value, 0);
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
      if (mode === "mixed" && sinkReadMode === "per-update") {
        for (let update = 0; update < updatesPerIteration; update++) {
          framework.withBatch(write);
          read();
        }
      } else {
        framework.withBatch(writeBatch);
        if (mode === "mixed" && sinkReadMode === "per-batch") read();
      }
    }
    return read();
  });
}

function removeElems<T>(src: T[], rmCount: number, rand: SeededRandom): T[] {
  const copy = src.slice();
  for (let i = 0; i < rmCount; i++) {
    const rmDex = rand.int(0, copy.length - 1);
    copy.splice(rmDex, 1);
  }
  return copy;
}

export class Counter {
  count = 0;
  nodesVisited = 0;
  edgesTraversed = 0;
  sinkReads = 0;

  reset(): void {
    this.count = 0;
    this.nodesVisited = 0;
    this.edgesTraversed = 0;
    this.sinkReads = 0;
  }

  snapshot(): BenchCountersSnapshot {
    return {
      nodesRecomputed: this.count,
      nodesVisited: this.nodesVisited,
      edgesTraversed: this.edgesTraversed,
      sinkReads: this.sinkReads,
    };
  }
}

function makeDependentRows(
  sources: Computed<number>[],
  numRows: number,
  counter: Counter,
  staticFraction: number,
  nSources: number,
  framework: ReactiveFramework
): Computed<number>[][] {
  let prevRow = sources;
  const rand = new SeededRandom("seed");
  const rows = [];
  for (let l = 0; l < numRows; l++) {
    const row = makeRow(
      prevRow,
      counter,
      staticFraction,
      nSources,
      framework,
      l,
      rand
    );
    rows.push(row);
    prevRow = row;
  }
  return rows;
}

function makeLayeredRows(
  initialSources: Computed<number>[],
  numRows: number,
  width: number,
  counter: Counter,
  staticFraction: number,
  fanIn: number,
  framework: ReactiveFramework,
  graphKind: "layered-dag" | "diamond-mesh"
): Computed<number>[][] {
  let prevRow = initialSources;
  const rand = new SeededRandom("seed");
  const rows = [];

  for (let layer = 0; layer < numRows; layer++) {
    const row = new Array<Computed<number>>(width);
    for (let nodeDex = 0; nodeDex < width; nodeDex++) {
      row[nodeDex] = makeLayeredNode(
        prevRow,
        nodeDex,
        layer,
        counter,
        staticFraction,
        fanIn,
        framework,
        graphKind,
        rand
      );
    }
    rows.push(row);
    prevRow = row;
  }

  return rows;
}

function makeRow(
  sources: Computed<number>[],
  counter: Counter,
  staticFraction: number,
  nSources: number,
  framework: ReactiveFramework,
  _layer: number,
  random: SeededRandom
): Computed<number>[] {
  return sources.map((_, myDex) => {
    const mySources = pickRectSources(sources, myDex, nSources);

    const staticNode = random.float() < staticFraction;
    if (staticNode) {
      // static node, always reference sources
      return framework.computed(() => {
        return readStaticNode(mySources, counter);
      });
    } else {
      // dynamic node, drops one of the sources depending on the value of the first element
      const first = mySources[0];
      const tailLength = mySources.length - 1;
      const node = framework.computed(() => {
        counter.count++;
        counter.nodesVisited++;
        counter.edgesTraversed++;
        let sum = first.read();
        const shouldDrop = sum & 0x1;
        const dropDex = sum % tailLength;

        for (let i = 1; i < mySources.length; i++) {
          if (shouldDrop && i - 1 === dropDex) continue;
          counter.edgesTraversed++;
          sum += mySources[i].read();
        }

        return sum;
      });
      return node;
    }
  });
}

function makeLayeredNode(
  prevRow: Computed<number>[],
  nodeDex: number,
  layer: number,
  counter: Counter,
  staticFraction: number,
  fanIn: number,
  framework: ReactiveFramework,
  graphKind: "layered-dag" | "diamond-mesh",
  random: SeededRandom
): Computed<number> {
  const mySources =
    graphKind === "diamond-mesh"
      ? pickMeshSources(prevRow, nodeDex, fanIn, layer)
      : pickLayeredSources(prevRow, nodeDex, fanIn, layer);

  const staticNode = random.float() < staticFraction;
  if (staticNode) {
    return framework.computed(() => readStaticNode(mySources, counter));
  }

  const first = mySources[0];
  const tailLength = mySources.length - 1;
  return framework.computed(() => {
    counter.count++;
    counter.nodesVisited++;
    counter.edgesTraversed++;
    let sum = first.read();
    const shouldDrop = (sum + layer + nodeDex) & 0x1;
    const dropDex = tailLength === 0 ? 0 : (sum + nodeDex) % tailLength;

    for (let i = 1; i < mySources.length; i++) {
      if (shouldDrop && i - 1 === dropDex) continue;
      counter.edgesTraversed++;
      sum += mySources[i].read();
    }

    return sum;
  });
}

function pickRectSources(
  sources: Computed<number>[],
  myDex: number,
  nSources: number
): Computed<number>[] {
  const mySources: Computed<number>[] = [];
  for (let sourceDex = 0; sourceDex < nSources; sourceDex++) {
    mySources.push(sources[(myDex + sourceDex) % sources.length]);
  }
  return mySources;
}

function pickLayeredSources(
  prevRow: Computed<number>[],
  nodeDex: number,
  fanIn: number,
  layer: number
): Computed<number>[] {
  const sources: Computed<number>[] = [];
  const base = (nodeDex * 13 + layer * 17) % prevRow.length;
  const step = Math.max(1, Math.floor(prevRow.length / Math.max(1, fanIn * 8)));

  for (let sourceDex = 0; sourceDex < fanIn; sourceDex++) {
    const sourceIndex = (base + sourceDex * step) % prevRow.length;
    sources.push(prevRow[sourceIndex]);
  }

  return sources;
}

function pickMeshSources(
  prevRow: Computed<number>[],
  nodeDex: number,
  fanIn: number,
  layer: number
): Computed<number>[] {
  const sources: Computed<number>[] = [];
  const clusterSize = Math.max(2, Math.floor(fanIn / 2));
  const clusterBase =
    (Math.floor(nodeDex / clusterSize) * clusterSize + layer * clusterSize) %
    prevRow.length;

  for (let sourceDex = 0; sourceDex < fanIn; sourceDex++) {
    const sharedOffset = Math.floor(sourceDex / 2);
    const sourceIndex = (clusterBase + sharedOffset) % prevRow.length;
    sources.push(prevRow[sourceIndex]);
  }

  return sources;
}

function readStaticNode(
  mySources: Computed<number>[],
  counter: Counter
): number {
  counter.count++;
  counter.nodesVisited++;

  let sum = 0;
  for (const src of mySources) {
    counter.edgesTraversed++;
    sum += src.read();
  }
  return sum;
}

function trackedRead(node: Computed<number>): number {
  if (activeCounter) {
    activeCounter.sinkReads++;
  }
  return node.read();
}

let activeCounter: Counter | null = null;

function withActiveCounter<T>(counter: Counter | null, fn: () => T): T {
  const previous = activeCounter;
  activeCounter = counter;
  try {
    return fn();
  } finally {
    activeCounter = previous;
  }
}

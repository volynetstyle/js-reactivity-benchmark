import { TestConfig } from "./frameworkTypes";
import { Computed, ReactiveFramework, Signal } from "./reactiveFramework";
import { Random } from "random";

export interface Graph {
  sources: Signal<number>[];
  layers: Computed<number>[][];
  counter: Counter;
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
    const sources = new Array(sourcesCount)
      .fill(0)
      .map((_, i) => framework.signal(i));
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
    const rand = new Random("seed");
    const { sources, layers } = graph;
    const leaves = layers[layers.length - 1];
    const skipCount = Math.round(leaves.length * (1 - readFraction));
    const readLeaves = removeElems(leaves, skipCount, rand);
    const frameworkName = framework.name.toLowerCase();
    const batchPerIteration =
      frameworkName === "s-js" || frameworkName === "solidjs";

    const writeIteration = (iteration: number, updateDex: number) => {
      const tick = startTick + iteration * updatesPerIteration + updateDex;
      const sourceDex = tick % sources.length;
      sources[sourceDex].write(tick + sourceDex);
    };

    const sumLeaves = () => {
      let total = 0;
      for (const leaf of readLeaves) {
        total += trackedRead(leaf);
      }
      return total;
    };

    const flushPerIteration = (iteration: number) => {
      if (sinkReadMode === "final-only") {
        for (let updateDex = 0; updateDex < updatesPerIteration; updateDex++) {
          writeIteration(iteration, updateDex);
        }
        return;
      }

      if (sinkReadMode === "per-update") {
        for (let updateDex = 0; updateDex < updatesPerIteration; updateDex++) {
          writeIteration(iteration, updateDex);
          readLeaves.forEach(trackedRead);
        }
        return;
      }

      for (let updateDex = 0; updateDex < updatesPerIteration; updateDex++) {
        writeIteration(iteration, updateDex);
      }
      readLeaves.forEach(trackedRead);
    };

    const writeOnlyIteration = (iteration: number) => {
      for (let updateDex = 0; updateDex < updatesPerIteration; updateDex++) {
        writeIteration(iteration, updateDex);
      }
    };

    if (mode === "pull") {
      if (batchPerIteration) {
        for (let i = 0; i < iterations; i++) {
          framework.withBatch(() => {
            writeOnlyIteration(i);
          });
        }
      } else {
        framework.withBatch(() => {
          for (let i = 0; i < iterations; i++) {
            writeOnlyIteration(i);
          }
        });
      }

      return sumLeaves();
    }

    if (mode === "push") {
      const latestValues = new Array(readLeaves.length).fill(0);

      for (const [i, leaf] of readLeaves.entries()) {
        framework.effect(() => {
          latestValues[i] = trackedRead(leaf);
        });
      }

      for (let i = 0; i < iterations; i++) {
        framework.withBatch(() => {
          writeOnlyIteration(i);
        });
      }

      return latestValues.reduce((total, value) => total + value, 0);
    }

    let sum = 0;

    if (batchPerIteration) {
      // [S.js freeze](https://github.com/adamhaile/S#sdatavalue) doesn't allow different
      // values to be set during a single batch, so special case it.
      for (let i = 0; i < iterations; i++) {
        framework.withBatch(() => {
          flushPerIteration(i);
        });
      }

      sum = sumLeaves();
    } else {
      framework.withBatch(() => {
        for (let i = 0; i < iterations; i++) {
          flushPerIteration(i);
        }

        sum = sumLeaves();
      });
    }

    return sum;
  });
}

function removeElems<T>(src: T[], rmCount: number, rand: Random): T[] {
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
  const rand = new Random("seed");
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
  const rand = new Random("seed");
  const rows = [];

  for (let layer = 0; layer < numRows; layer++) {
    const row = new Array(width).fill(0).map((_, nodeDex) =>
      makeLayeredNode(
        prevRow,
        nodeDex,
        layer,
        counter,
        staticFraction,
        fanIn,
        framework,
        graphKind,
        rand
      )
    );
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
  random: Random
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
      const tail = mySources.slice(1);
      const node = framework.computed(() => {
        counter.count++;
        counter.nodesVisited++;
        counter.edgesTraversed++;
        let sum = first.read();
        const shouldDrop = sum & 0x1;
        const dropDex = sum % tail.length;

        for (let i = 0; i < tail.length; i++) {
          if (shouldDrop && i === dropDex) continue;
          counter.edgesTraversed++;
          sum += tail[i].read();
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
  random: Random
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
  const tail = mySources.slice(1);
  return framework.computed(() => {
    counter.count++;
    counter.nodesVisited++;
    counter.edgesTraversed++;
    let sum = first.read();
    const shouldDrop = (sum + layer + nodeDex) & 0x1;
    const dropDex = tail.length === 0 ? 0 : (sum + nodeDex) % tail.length;

    for (let i = 0; i < tail.length; i++) {
      if (shouldDrop && i === dropDex) continue;
      counter.edgesTraversed++;
      sum += tail[i].read();
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

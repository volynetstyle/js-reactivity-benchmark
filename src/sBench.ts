// Inspired by https://github.com/solidjs/solid/blob/main/packages/solid/bench/bench.cjs
import { registerBenchmark } from "./util/benchmark";
import { Computed, Signal, ReactiveFramework } from "./util/reactiveFramework";

const COUNT = 1e5;

interface CreationRow {
  name: string;
  nodes: number;
  sources: number;
  fanIn: number;
  fanOut: number;
  signals?: boolean;
}

function makeComputation(
  framework: ReactiveFramework,
  sources: Signal<number>[],
  fanIn: number,
  offset: number,
  constant: number
): Computed<number> {
  if (fanIn === 0) return framework.computed(() => constant);
  if (fanIn === 1) {
    const source = sources[offset];
    return framework.computed(() => source.read());
  }
  return framework.computed(() => {
    let sum = 0;
    for (let i = 0; i < fanIn; i++) sum += sources[offset + i].read();
    return sum;
  });
}
export function sbench(framework: ReactiveFramework, count = COUNT) {
  const creationRows: CreationRow[] = [
    {
      name: "createDataSignals",
      nodes: count,
      sources: 0,
      fanIn: 0,
      fanOut: 1,
      signals: true,
    },
    {
      name: "createComputations0to1",
      nodes: count,
      sources: 0,
      fanIn: 0,
      fanOut: 1,
    },
    {
      name: "createComputations1to1",
      nodes: count,
      sources: count,
      fanIn: 1,
      fanOut: 1,
    },
    {
      name: "createComputations2to1",
      nodes: count / 2,
      sources: count,
      fanIn: 2,
      fanOut: 1,
    },
    {
      name: "createComputations4to1",
      nodes: count / 4,
      sources: count,
      fanIn: 4,
      fanOut: 1,
    },
    {
      name: "createComputations1000to1",
      nodes: count / 1000,
      sources: count,
      fanIn: 1000,
      fanOut: 1,
    },
    ...[2, 4, 8, 1000].map((fanOut) => ({
      name: `createComputations1to${fanOut}`,
      nodes: count,
      sources: count / fanOut,
      fanIn: 1,
      fanOut,
    })),
  ];
  const updateRows = [
    { name: "updateComputations1to1", writes: count * 4, fanIn: 1, fanOut: 1 },
    { name: "updateComputations2to1", writes: count * 2, fanIn: 2, fanOut: 1 },
    { name: "updateComputations4to1", writes: count, fanIn: 4, fanOut: 1 },
    {
      name: "updateComputations1000to1",
      writes: count / 100,
      fanIn: 1000,
      fanOut: 1,
    },
    ...[2, 4, 1000].map((fanOut) => ({
      name: `updateComputations1to${fanOut}`,
      writes: (count * 4) / fanOut,
      fanIn: 1,
      fanOut,
    })),
  ];

  for (const row of creationRows) {
    registerBenchmark({
      framework: framework.name,
      name: row.name,
      setup: () => {
        framework.resetBenchmark?.();
        return framework.withBuild(() => ({
          sources: Array.from({ length: row.sources }, (_, i) =>
            framework.signal(i)
          ),
          nodes: new Array<Computed<number>>(row.nodes),
        }));
      },
      benchmark: ({ sources, nodes }) =>
        framework.withBuild(() => {
          let checksum = 0;
          for (let i = 0; i < row.nodes; i++) {
            const node = row.signals
              ? framework.signal(i)
              : makeComputation(
                  framework,
                  sources,
                  row.fanIn,
                  Math.floor(i / row.fanOut) * row.fanIn,
                  i
                );
            nodes[i] = node;
            // Initialization and dependency tracking are part of creation for
            // every engine, including engines whose computed is initially lazy.
            checksum += node.read();
          }
          // Retain every node, not only the last one or a scalar checksum.
          return { nodes, checksum };
        }),
      validate: ({ nodes, checksum }) => {
        const expected =
          row.signals || row.fanIn === 0
            ? (row.nodes * (row.nodes - 1)) / 2
            : (row.fanOut * row.sources * (row.sources - 1)) / 2;
        if (nodes.length !== row.nodes || checksum !== expected) {
          throw new Error(
            `${row.name}: creation checksum ${checksum}, expected ${expected}`
          );
        }
      },
      gc: "inner",
      blackhole: true,
    });
  }

  for (const row of updateRows) {
    registerBenchmark({
      framework: framework.name,
      name: row.name,
      setup: () => {
        framework.resetBenchmark?.();
        return framework.withBuild(() => {
          const sources = Array.from({ length: row.fanIn }, (_, i) =>
            framework.signal(i)
          );
          const nodes = Array.from({ length: row.fanOut }, () =>
            makeComputation(framework, sources, row.fanIn, 0, 0)
          );
          for (const node of nodes) node.read();
          return { sources, nodes };
        });
      },
      benchmark: ({ sources, nodes }) => {
        let checksum = 0;
        // Start at one so every write changes the source, even the first one.
        for (let value = 1; value <= row.writes; value++) {
          sources[0].write(value);
          for (const node of nodes) checksum += node.read();
        }
        return checksum;
      },
      validate: (checksum) => {
        const unchangedSources = (row.fanIn * (row.fanIn - 1)) / 2;
        const expected =
          row.fanOut *
          ((row.writes * (row.writes + 1)) / 2 + row.writes * unchangedSources);
        if (checksum !== expected) {
          throw new Error(
            `${row.name}: update checksum ${checksum}, expected ${expected}`
          );
        }
      },
      gc: "inner",
      blackhole: true,
    });
  }
}

import { expect, test } from "vitest";
import { Counter, makeGraph, runGraph } from "./dependencyGraph";
import { ReactiveFramework } from "./reactiveFramework";

function transactionProbe(name: string) {
  const events: string[] = [];
  let inBatch = false;
  const framework: ReactiveFramework = {
    name,
    signal: (initial) => {
      let value = initial;
      return {
        read: () => value,
        write: (next) => {
          expect(inBatch).toBe(true);
          events.push("write");
          value = next;
        },
      };
    },
    computed: (fn) => ({
      read: () => {
        expect(inBatch).toBe(false);
        events.push("read");
        return fn();
      },
    }),
    effect: (fn) => {
      fn();
    },
    withBuild: (fn) => fn(),
    withBatch: (fn) => {
      expect(inBatch).toBe(false);
      inBatch = true;
      fn();
      inBatch = false;
      events.push("commit");
    },
  };
  return { framework, events };
}

test("per-update commits may revisit a source in separate transactions", () => {
  const { framework } = transactionProbe("s-js");
  const config = {
    width: 2,
    totalLayers: 2,
    staticFraction: 1,
    nSources: 1,
    readFraction: 1,
    iterations: 1,
    updatesPerIteration: 3,
    sinkReadMode: "per-update" as const,
    expected: {},
  };
  const graph = makeGraph(framework, config, new Counter());
  expect(runGraph(graph, config, framework)).toBe(4);
  expect(() =>
    runGraph(graph, { ...config, sinkReadMode: "per-batch" }, framework)
  ).toThrow("at most once");
});

for (const name of ["ordinary lazy engine", "s-js", "SolidJS"]) {
  for (const sinkReadMode of [
    "per-update",
    "per-batch",
    "final-only",
  ] as const) {
    test(`${name} | ${sinkReadMode} has explicit commit boundaries before reads`, () => {
      const { framework, events } = transactionProbe(name);
      const config = {
        width: 2,
        totalLayers: 2,
        staticFraction: 1,
        nSources: 1,
        readFraction: 1,
        iterations: 2,
        updatesPerIteration: 2,
        sinkReadMode,
        expected: {},
      };
      const graph = makeGraph(framework, config, new Counter());
      runGraph(graph, config, framework);
      const reads = ["read", "read"];
      const step =
        sinkReadMode === "per-update"
          ? ["write", "commit", ...reads, "write", "commit", ...reads]
          : [
              "write",
              "write",
              "commit",
              ...(sinkReadMode === "per-batch" ? reads : []),
            ];
      expect(events).toEqual([...step, ...step, ...reads]);
    });
  }
}

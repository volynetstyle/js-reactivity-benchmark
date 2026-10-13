import { expect, test, vi } from "vitest";
import { sFramework } from "../frameworks/s";
import { solidFramework } from "../frameworks/solid";
import { Counter, makeGraph, runGraph } from "./dependencyGraph";
import { ReactiveFramework } from "./reactiveFramework";

for (const base of [sFramework, solidFramework]) {
  test(`${base.name} | push effects own a scope, writes commit outside it, cleanup detaches effects`, () => {
    let inOwnerScope = false;
    let deliveries = 0;
    const framework: ReactiveFramework = {
      ...base,
      createScope(fn) {
        return base.createScope!(() => {
          inOwnerScope = true;
          try {
            return fn();
          } finally {
            inOwnerScope = false;
          }
        });
      },
      effect(fn) {
        expect(inOwnerScope).toBe(true);
        return base.effect(() => {
          deliveries++;
          fn();
        });
      },
      withBatch(fn) {
        expect(inOwnerScope).toBe(false);
        base.withBatch(fn);
      },
    };
    const config = {
      width: 3,
      totalLayers: 3,
      staticFraction: 1,
      nSources: 2,
      readFraction: 1,
      iterations: 2,
      mode: "push" as const,
      expected: {},
    };
    const graph = makeGraph(framework, config, new Counter());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("Unexpected console.warn from push workload");
    });
    try {
      expect(runGraph(graph, config, framework)).toBe(16);
      expect(warning).not.toHaveBeenCalled();
      const beforeCleanup = deliveries;
      expect(graph.disposePushEffects).toBeTypeOf("function");
      graph.disposePushEffects!();
      framework.withBatch(() => graph.sources[0].write(100));
      expect(deliveries).toBe(beforeCleanup);
    } finally {
      graph.disposePushEffects?.();
      warning.mockRestore();
    }
  });
}

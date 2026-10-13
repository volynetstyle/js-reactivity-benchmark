import { historicalWorkload, HistoricalKind } from "./kairo/observed";
import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";

export const historicalCases: HistoricalKind[] = [
  "avoidablePropagation",
  "broadPropagation",
  "deepPropagation",
  "diamond",
  "mux",
  "repeatedObservers",
  "triangle",
  "unstable",
];

export function kairoBench(framework: ReactiveFramework): void {
  for (const name of historicalCases) {
    registerBenchmark({
      framework: framework.name,
      name,
      setup: () => {
        framework.resetBenchmark?.();
        const fixture = historicalWorkload(framework, name);
        fixture.validate(fixture.run());
        fixture.prepareRun();
        return fixture;
      },
      benchmark: (fixture) => fixture.run(),
      validate: (result, fixture) => fixture.validate(result),
      teardown: (fixture) => fixture.dispose(),
      blackhole: true,
      gc: "inner",
    });
  }
}

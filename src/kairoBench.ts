import { avoidablePropagation } from "./kairo/avoidable";
import { broadPropagation } from "./kairo/broad";
import { deepPropagation } from "./kairo/deep";
import { diamond } from "./kairo/diamond";
import { mux } from "./kairo/mux";
import { repeatedObservers } from "./kairo/repeated";
import { triangle } from "./kairo/triangle";
import { unstable } from "./kairo/unstable";
import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";

const cases = [
  avoidablePropagation,
  broadPropagation,
  deepPropagation,
  diamond,
  mux,
  repeatedObservers,
  triangle,
  unstable,
];

export function kairoBench(framework: ReactiveFramework): void {
  for (const c of cases) {
    registerBenchmark({
      framework: framework.name,
      name: c.name,
      setup: () => {
        framework.resetBenchmark?.();
        return framework.withBuild(() => {
          const iter = c(framework);
          iter();
          return iter;
        });
      },
      benchmark: (iter) => iter(),
      gc: "inner",
    });
  }
}

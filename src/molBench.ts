import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";

function fib(n: number): number {
  if (n < 2) return 1;
  return fib(n - 1) + fib(n - 2);
}

function hard(n: number, _log: string) {
  return n + fib(16);
}

const numbers = Array.from({ length: 5 }, (_, i) => i);

export function molBench(framework: ReactiveFramework): void {
  registerBenchmark({
    framework: framework.name,
    name: "molBench",
    setup: () => {
      framework.resetBenchmark?.();
      return framework.withBuild(() => {
        const res: number[] = [];
        const A = framework.signal(0);
        const B = framework.signal(0);
        const C = framework.computed(() => (A.read() % 2) + (B.read() % 2));
        const D_items = numbers.map(() => ({ x: 0 }));
        const D = framework.computed(() => {
          const a = A.read() % 2;
          const b = B.read() % 2;
          for (let i = 0; i < numbers.length; i++) {
            D_items[i].x = numbers[i] + a - b;
          }
          return D_items;
        });
        const E = framework.computed(() =>
          hard(C.read() + A.read() + D.read()[0].x, "E")
        );
        const F = framework.computed(() =>
          hard(D.read()[2].x || B.read(), "F")
        );
        const G = framework.computed(
          () => C.read() + (C.read() || E.read() % 2) + D.read()[4].x + F.read()
        );

        framework.effect(() => res.push(hard(G.read(), "H")));
        framework.effect(() => res.push(G.read()));
        framework.effect(() => res.push(hard(F.read(), "J")));

        const iter = (i: number) => {
          res.length = 0;
          framework.withBatch(() => {
            B.write(1);
            A.write(1 + i * 2);
          });
          framework.withBatch(() => {
            A.write(2 + i * 2);
            B.write(2);
          });
        };

        iter(1);
        return iter;
      });
    },
    benchmark: (iter) => iter(0),
    gc: "inner",
  });
}

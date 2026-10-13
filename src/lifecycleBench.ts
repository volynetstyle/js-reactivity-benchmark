import { registerBenchmark } from "./util/benchmark";
import { ReactiveFramework } from "./util/reactiveFramework";

export function lifecycleWorkload(
  framework: ReactiveFramework,
  width = 32,
  cycles = 1000
) {
  if (!framework.createScope)
    throw new Error("Native owner disposal is unavailable");
  const source = framework.signal(0);
  return {
    run() {
      let deliveries = 0,
        checksum = 0,
        afterDispose = 0;
      for (let cycle = 0; cycle < cycles; cycle++) {
        let disposed = false;
        const scope = framework.createScope!(() =>
          Array.from({ length: width }, (_, i) => {
            const node = framework.computed(() => {
              if (disposed) afterDispose++;
              return source.read() + i;
            });
            framework.effect(() => {
              if (disposed) afterDispose++;
              checksum += node.read();
              deliveries++;
            });
            return node;
          })
        );
        framework.withBatch(() => source.write(cycle * 2 + 1));
        scope.dispose();
        disposed = true;
        framework.withBatch(() => source.write(cycle * 2 + 2));
      }
      return { deliveries, checksum, afterDispose };
    },
    validate(result: {
      deliveries: number;
      checksum: number;
      afterDispose: number;
    }) {
      const expectedChecksum =
        width * cycles * (2 * cycles - 1) + cycles * width * (width - 1);
      if (
        result.deliveries !== width * cycles * 2 ||
        result.checksum !== expectedChecksum ||
        result.afterDispose
      ) {
        throw new Error(
          `lifecycle: deliveries=${result.deliveries}, checksum=${result.checksum}, activity after disposal=${result.afterDispose}`
        );
      }
    },
  };
}

export function retainedDisposal(framework: ReactiveFramework, width = 1024) {
  const source = framework.signal(0);
  let executions = 0,
    deliveries = 0;
  const seen = new Uint8Array(width);
  let observed = 0,
    mismatches = 0;
  const scope = framework.createScope!(() =>
    Array.from({ length: width }, (_, i) => {
      const node = framework.computed(() => {
        executions++;
        return source.read() + i;
      });
      framework.effect(() => {
        if (node.read() !== i) mismatches++;
        if (!seen[i]) {
          seen[i] = 1;
          observed++;
        }
        deliveries++;
      });
      return node;
    })
  );
  framework.withBatch(() => {});
  return {
    dispose: scope.dispose,
    validate() {
      const before = { executions, deliveries };
      framework.withBatch(() => source.write(1));
      if (
        observed !== width ||
        mismatches ||
        executions !== before.executions ||
        deliveries !== before.deliveries
      ) {
        throw new Error(
          "lifecycle: retained graph still executes after disposal"
        );
      }
    },
  };
}

export function lifecycleBench(framework: ReactiveFramework): void {
  if (!framework.createScope) return;
  registerBenchmark({
    framework: framework.name,
    name: "lifecycle/owned graph create-update-dispose",
    setup: () => {
      framework.resetBenchmark?.();
      return lifecycleWorkload(framework);
    },
    benchmark: (fixture) => fixture.run(),
    validate: (result, fixture) => fixture.validate(result),
    gc: "inner",
    blackhole: true,
  });
  registerBenchmark({
    framework: framework.name,
    name: "lifecycle/dispose retained graph",
    setup: () => {
      framework.resetBenchmark?.();
      return retainedDisposal(framework);
    },
    benchmark: (fixture) => {
      fixture.dispose();
      return true;
    },
    validate: (_, fixture) => fixture.validate(),
    teardown: (fixture) => fixture.dispose(),
    gc: "inner",
    blackhole: true,
  });
}

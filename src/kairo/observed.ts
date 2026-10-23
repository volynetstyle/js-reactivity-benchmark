import { Computed, ReactiveFramework } from "../util/reactiveFramework";
import {
  deliveryPlan,
  DeliveryProbe,
  DeliveryResult,
  verifyDelivery,
} from "../util/delivery";
import { busy } from "./util";
import { fixtureScope } from "../util/fixtureScope";

export type HistoricalKind =
  | "diamond"
  | "triangle"
  | "mux"
  | "broadPropagation"
  | "deepPropagation"
  | "repeatedObservers"
  | "unstable"
  | "avoidablePropagation";
export interface HistoricalResult {
  pullChecksum: number;
  delivery: DeliveryResult;
  workChecksum: number;
}

export function historicalWorkload(
  framework: ReactiveFramework,
  kind: HistoricalKind
) {
  const sourceCount = kind === "mux" ? 100 : 1;
  const observerCount =
    kind === "mux" ? 100 : kind === "broadPropagation" ? 50 : 1;
  const sourceValues = new Array<number>(sourceCount).fill(0);
  const writes =
    kind === "mux"
      ? [
          ...Array.from({ length: 10 }, (_, i) => [i, i]),
          ...Array.from({ length: 10 }, (_, i) => [i, i * 2]),
        ]
      : [
          [0, 1],
          ...Array.from(
            {
              length:
                kind === "diamond"
                  ? 500
                  : kind === "avoidablePropagation"
                    ? 1000
                    : kind === "broadPropagation" || kind === "deepPropagation"
                      ? 50
                      : 100,
            },
            (_, i) => [0, i]
          ),
        ];
  const valueAt = (values: number[], index: number): number => {
    const head = values[0];
    switch (kind) {
      case "diamond":
        return 5 * (head + 1);
      case "triangle":
        return 10 * head + 45;
      case "mux":
        return values[index] + 1;
      case "broadPropagation":
        return head + index + 1;
      case "deepPropagation":
        return head + 50;
      case "repeatedObservers":
        return 30 * head;
      case "unstable":
        return 20 * (head % 2 ? head * 2 : -head);
      case "avoidablePropagation":
        return 6;
    }
  };
  const prepare = () => {
    const values = sourceValues.slice();
    const rows = [
      Array.from({ length: observerCount }, (_, i) => valueAt(values, i)),
    ];
    let pullChecksum = 0;
    for (const [index, value] of writes) {
      values[index] = value;
      const row = Array.from({ length: observerCount }, (_, i) =>
        valueAt(values, i)
      );
      rows.push(row);
      pullChecksum += row[kind === "mux" ? index : observerCount - 1];
    }
    return { plan: deliveryPlan(rows), pullChecksum };
  };
  let expected = prepare();
  const probe = new DeliveryProbe(expected.plan);
  let workChecksum = 0;
  let workSeed = 0x12345678;
  const consumeWork = () => {
    workSeed = busy(workSeed);
    workChecksum = (workChecksum + workSeed) | 0;
  };
  const scope = fixtureScope(framework, () => {
    const sources = sourceValues.map((value) => framework.signal(value));
    const head = sources[0];
    let outputs: Computed<number>[];
    switch (kind) {
      case "diamond": {
        const branches = Array.from({ length: 5 }, () =>
          framework.computed(() => head.read() + 1)
        );
        outputs = [
          framework.computed(() =>
            branches.reduce((sum, node) => sum + node.read(), 0)
          ),
        ];
        break;
      }
      case "triangle": {
        let node: Computed<number> = head;
        const nodes: Computed<number>[] = [];
        for (let i = 0; i < 10; i++) {
          nodes.push(node);
          const previous = node;
          node = framework.computed(() => previous.read() + 1);
        }
        outputs = [
          framework.computed(() =>
            nodes.reduce((sum, node) => sum + node.read(), 0)
          ),
        ];
        break;
      }
      case "mux": {
        const aggregate = framework.computed(() =>
          Object.fromEntries(sources.map((node) => node.read()).entries())
        );
        outputs = sources.map((_, i) => {
          const projection = framework.computed(() => aggregate.read()[i]);
          return framework.computed(() => projection.read() + 1);
        });
        break;
      }
      case "broadPropagation":
        outputs = Array.from({ length: 50 }, (_, i) => {
          const node = framework.computed(() => head.read() + i);
          return framework.computed(() => node.read() + 1);
        });
        break;
      case "deepPropagation": {
        let node: Computed<number> = head;
        for (let i = 0; i < 50; i++) {
          const previous = node;
          node = framework.computed(() => previous.read() + 1);
        }
        outputs = [node];
        break;
      }
      case "repeatedObservers":
        outputs = [
          framework.computed(() => {
            let sum = 0;
            for (let i = 0; i < 30; i++) sum += head.read();
            return sum;
          }),
        ];
        break;
      case "unstable": {
        const double = framework.computed(() => head.read() * 2);
        const inverse = framework.computed(() => -head.read());
        outputs = [
          framework.computed(() => {
            let sum = 0;
            for (let i = 0; i < 20; i++)
              sum += head.read() % 2 ? double.read() : inverse.read();
            return sum;
          }),
        ];
        break;
      }
      case "avoidablePropagation": {
        const a = framework.computed(() => head.read());
        const b = framework.computed(() => (a.read(), 0));
        const c = framework.computed(() => {
          const value = b.read();
          consumeWork();
          return value + 1;
        });
        const d = framework.computed(() => c.read() + 2);
        outputs = [framework.computed(() => d.read() + 3)];
        break;
      }
    }
    outputs.forEach((node, index) =>
      framework.effect(() => {
        const value = node.read();
        probe.record(index, value);
        if (kind === "avoidablePropagation") consumeWork();
      })
    );
    return { sources, outputs };
  });
  const graph = scope.value;
  framework.withBatch(() => {});
  probe.verifyInitial(kind);

  let writeIndex = 0;
  let writeValue = 0;
  const write = () => graph.sources[writeIndex].write(writeValue);
  const run = (): HistoricalResult => {
    let pullChecksum = 0;
    for (let step = 0; step < writes.length; step++) {
      const [index, value] = writes[step];
      probe.step = step + 1;
      writeIndex = index;
      writeValue = value;
      framework.withBatch(write);
      sourceValues[index] = value;
      pullChecksum +=
        graph.outputs[kind === "mux" ? index : observerCount - 1].read();
    }
    return { pullChecksum, delivery: probe.snapshot(), workChecksum };
  };
  const validate = (result: HistoricalResult) => {
    if (result.pullChecksum !== expected.pullChecksum)
      throw new Error(`${kind}: incorrect pull checksum`);
    verifyDelivery(kind, expected.plan, result.delivery);
  };
  const prepareRun = () => {
    expected = prepare();
    probe.reset(expected.plan);
    workChecksum = 0;
    workSeed = 0x12345678;
  };
  prepareRun();
  return { run, validate, prepareRun, dispose: scope.dispose };
}

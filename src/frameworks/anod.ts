import { batch, c as globalFactory, root, signal } from "anod";
import { ReactiveFramework } from "../util/reactiveFramework";

// Anod tracks dependencies explicitly with `c.val(sender)`. The adapter routes
// implicit `read()` calls through the active computation's context, as the
// reactive-framework-test-suite adapter does. `.set()` flushes synchronously;
// `batch()` coalesces writes into one flush.
type Reader = { val<T>(sender: unknown): T };
type Factory = typeof globalFactory;

let reader: Reader | undefined;
let factory: Factory = globalFactory;

function withContext<T>(
  context: Reader | undefined,
  owner: Factory,
  fn: () => T
): T {
  const previousReader = reader;
  const previousFactory = factory;
  reader = context;
  factory = owner;
  try {
    return fn();
  } finally {
    reader = previousReader;
    factory = previousFactory;
  }
}

export const anodFramework: ReactiveFramework = {
  name: "anod",
  signal: (initial) => {
    const node = signal(initial);
    return {
      read: () => (reader ? reader.val(node) : node.get()),
      write: (value) => {
        node.set(value);
      },
    };
  },
  computed: (fn) => {
    const node = factory.compute((context) =>
      withContext(context, factory, fn)
    );
    return {
      read: () => {
        if (reader) return reader.val(node);
        const value = node.get();
        if (node.error) throw value;
        return value;
      },
    };
  },
  effect: (fn) => {
    const node = factory.effect((context) =>
      withContext(context, context as unknown as Factory, fn)
    );
    return () => node.dispose();
  },
  withBatch: batch,
  withBuild: (fn) => fn(),
  createScope(fn) {
    let value!: ReturnType<typeof fn>;
    const owner = root((context) => {
      value = withContext(undefined, context as unknown as Factory, fn);
    });
    return { value, dispose: () => owner.dispose() };
  },
};

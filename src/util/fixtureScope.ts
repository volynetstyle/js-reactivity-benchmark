import { ReactiveFramework } from "./reactiveFramework";

export function fixtureScope<T>(framework: ReactiveFramework, fn: () => T) {
  if (framework.createScope) return framework.createScope(fn);
  const stops: (() => void)[] = [];
  const original = framework.effect;
  framework.effect = (effect) => {
    const handle: unknown = original(effect);
    if (typeof handle === "function") stops.push(handle as () => void);
  };
  let value: T;
  try {
    value = framework.withBuild(fn);
  } finally {
    framework.effect = original;
  }
  return {
    value,
    dispose: () => {
      for (const stop of stops.splice(0)) stop();
    },
  };
}

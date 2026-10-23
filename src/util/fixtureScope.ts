import { ReactiveFramework } from "./reactiveFramework";

export function fixtureScope<T>(framework: ReactiveFramework, fn: () => T) {
  if (framework.createScope) return framework.createScope(fn);
  const stops: (() => void)[] = [];
  const original = framework.effect;
  framework.effect = (effect) => {
    const handle: unknown = original.call(framework, effect);
    if (typeof handle === "function") stops.push(handle as () => void);
  };
  const dispose = () => {
    const errors: unknown[] = [];
    // Detach handles before calling them: cleanup is idempotent and a
    // reentrant disposal cannot run the same handles again.
    const handles = stops.splice(0);
    for (let i = 0; i < handles.length; i++) {
      try {
        handles[i]();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Fixture cleanup failed");
  };
  let value: T;
  try {
    value = framework.withBuild(fn);
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fixture setup and cleanup failed"
      );
    }
    throw error;
  } finally {
    framework.effect = original;
  }
  return {
    value,
    dispose,
  };
}

// The reactive client build of solid-js 2 (see scripts/module-aliases.mjs).
declare module "solid-js-2-client" {
  export * from "solid-js-2";
}

// Kairo ships these declarations but its exports map hides them from bundler
// resolution. Describe the API used by the disabled legacy adapter.
declare module "kairo" {
  export function mutValue<T>(
    value: T
  ): [{ readonly value: T }, (value: T) => void];
  export function computed<T>(fn: () => T): { readonly value: T };
  export function effect(fn: () => void): void;
  export function batch(fn: () => void): void;
  export function collectScope(): () => unknown;
}

// rescript-signals ships generated JavaScript without type declarations.
declare module "rescript-signals/src/signals/Signal.res.mjs" {
  export type t<T> = { readonly __signal: T };
  export function make<T>(initialValue: T): t<T>;
  export function get<T>(signal: t<T>): T;
  export function set<T>(signal: t<T>, value: T): void;
  export function batch<T>(fn: () => T): T;
}
declare module "rescript-signals/src/signals/Computed.res.mjs" {
  import type { t } from "rescript-signals/src/signals/Signal.res.mjs";
  export function make<T>(compute: () => T): t<T>;
}
declare module "rescript-signals/src/signals/Effect.res.mjs" {
  export function runWithDisposer(fn: () => undefined | (() => void)): {
    dispose: () => void;
  };
}

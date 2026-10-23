// The reactive client build of solid-js 2 (see scripts/module-aliases.mjs).
declare module "solid-js-2-client" {
  export * from "solid-js-2";
}

// Kairo ships these declarations but its exports map hides them from bundler
// resolution. Describe the public API used by the adapter.
declare module "kairo" {
  export interface Cell<T> {
    readonly current: T;
  }
  export interface Track {
    <T>(cell: Cell<T>): T;
  }
  export function mutable<T>(
    value: T
  ): [Cell<T>, (value: T | ((current: T) => T)) => void];
  export function computed<T>(fn: (track: Track) => T): Cell<T>;
  export class Reaction {
    constructor(callback: () => void);
    track<T>(fn: (track: Track) => T): T;
    dispose(): void;
  }
  export function batch(fn: () => void): void;
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

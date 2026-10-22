import { ReactiveFramework, Signal } from "../util/reactiveFramework";
import $ from "mol_wire_lib";
import { commitBatch } from "./commitBatch";

// Return the native node itself. Shared prototype methods avoid an adapter
// object and read/write closures for every source and computation.
// Based on nin-jin's https://github.com/volynetstyle/js-reactivity-benchmark/pull/5.
class Atom<T> extends $.$mol_wire_atom<null, [], T> {
  read() {
    return this.sync();
  }

  write(value: T) {
    this.put(value);
  }
}

export const molWireFramework: ReactiveFramework = {
  name: "$mol_wire",
  signal: <T>(initialValue: T): Signal<T> =>
    new Atom("", (next: T = initialValue) => next),
  computed: (fn) => new Atom("", fn),
  effect: (fn) => {
    const observer = new Atom("", fn);
    observer.sync();
    return () => observer.destructor();
  },
  // Static sync uses its class as `this`.
  withBatch: commitBatch(() => Atom.sync()),
  withBuild: (fn) => fn(),
};

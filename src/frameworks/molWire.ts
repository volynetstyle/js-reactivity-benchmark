import { ReactiveFramework, Signal } from "../util/reactiveFramework";
import $ from "mol_wire_lib";

class Atom<T> extends $.$mol_wire_atom<null, [], T> {
  read() {
    return this.sync();
  }
  write(v:T) {
    return this.put(v);
  }
}

export const molWireFramework: ReactiveFramework = {
  name: "$mol_wire",
  signal: <T>(initialValue: T): Signal<T> => new Atom("", (next: T = initialValue) => next),
  computed: (fn) => new Atom("", fn),
  effect: (fn) => new Atom("", fn).sync(),
  withBatch: (fn) => {
    fn();
    Atom.sync();
  },
  withBuild: (fn) => fn(),
};

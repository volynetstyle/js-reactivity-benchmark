import { describe, expect, test } from "vitest";

// Disabled diagnostics must not load the library in the ordinary CI run.
const strict = process.env.SEMANTIC_GAUNTLET_STRICT === "1";
const { batch, computed, dispose, effect, get, set, signal } = strict
  ? await import("reflex-quant")
  : ({} as typeof import("reflex-quant"));
const quantPackage = strict
  ? (await import("reflex-quant/package.json")).default
  : { version: "disabled" };

const proposedContract = quantPackage.version === "1.0.0" ? test.fails : test;

describe.skipIf(!strict)(
  `semantic application gauntlet: Quant ${quantPackage.version}`,
  () => {
    test("workflow editor: dynamic routing, selection and batched drag", () => {
      const x = signal(10);
      const width = signal(300);
      const obstacle = signal(1);
      const alternate = signal(20);
      const useAlternate = signal(false);
      const ports = signal(["out-0", "out-1"]);
      const selected = signal("out-1");
      let routeRuns = 0;
      const bucket = computed(() => Math.floor(get(width) / 10));
      const route = computed(() => {
        routeRuns++;
        const endpoint = get(useAlternate) ? alternate : x;
        const first = get(endpoint);
        const clearance = get(obstacle);
        const second = get(endpoint);
        return first + second + clearance + get(bucket);
      });
      const normalize = effect(() => {
        const available = get(ports);
        const current = get(selected);
        if (!available.includes(current)) {
          set(selected, available[0]);
          get(selected);
        }
      });
      const rendered: number[] = [];
      const render = effect(() => {
        rendered.push(get(route));
      });
      try {
        expect(rendered).toEqual([51]);
        const before = routeRuns;
        set(width, 301);
        expect(routeRuns).toBe(before);
        expect(rendered).toEqual([51]);
        set(ports, ["out-0"]);
        expect(get(selected)).toBe("out-0");
        batch(() => {
          set(x, 11);
          set(obstacle, 2);
          expect(get(route)).toBe(54);
          expect(rendered).toEqual([51]);
        });
        expect(rendered).toEqual([51, 54]);
        set(useAlternate, true);
        expect(rendered.at(-1)).toBe(72);
        const count = rendered.length;
        set(x, 99);
        expect(rendered).toHaveLength(count);
        set(alternate, 21);
        expect(rendered.at(-1)).toBe(74);
      } finally {
        dispose(render);
        dispose(normalize);
        dispose(route);
        dispose(bucket);
      }
    });

    test("resource handoff: validation failure retains the live connection", () => {
      const account = signal("A");
      const auth = signal("valid");
      const endpoint = computed(() => get(account));
      const credentials = computed(() => {
        const value = get(auth);
        if (value === "expired") throw new Error("expired credentials");
        return value;
      });
      const events: string[] = [];
      const connection = effect(() => {
        const address = get(endpoint);
        const credential = get(credentials);
        events.push(`connect ${address}:${credential}`);
        return () => {
          events.push(`close ${address}:${credential}`);
        };
      });
      try {
        expect(() =>
          batch(() => {
            set(account, "B");
            set(auth, "expired");
          })
        ).toThrow("expired credentials");
        expect(events).toEqual(["connect A:valid"]);
        set(auth, "renewed");
        expect(events).toEqual([
          "connect A:valid",
          "close A:valid",
          "connect B:renewed",
        ]);
      } finally {
        dispose(connection);
        dispose(endpoint);
        dispose(credentials);
      }
      expect(events.at(-1)).toBe("close B:renewed");
    });

    test("incremental compiler: failed branch retries without validating obsolete backend", () => {
      const branch = signal("A");
      const a = signal("ok");
      const b = signal("broken");
      let attempts = 0;
      const backendA = computed(() => {
        if (get(a) === "broken") throw new Error("obsolete backend");
        return "A";
      });
      const program = computed(() => {
        attempts++;
        if (get(branch) === "A") return get(backendA);
        if (get(b) === "broken") throw new Error("syntax error");
        return "B";
      });
      try {
        expect(get(program)).toBe("A");
        set(branch, "B");
        expect(() => get(program)).toThrow("syntax error");
        const afterFailure = attempts;
        expect(() => get(program)).toThrow("syntax error");
        expect(attempts).toBe(afterFailure + 1);
        set(a, "broken");
        set(b, "fixed");
        expect(get(program)).toBe("B");
      } finally {
        dispose(program);
        dispose(backendA);
      }
    });

    test("combined live edit: batch, failed compile, recovery and disposal", () => {
      const position = signal(1);
      const text = signal("ok");
      const selection = signal("out-1");
      const ports = signal(["out-0", "out-1"]);
      const route = computed(() => get(position) * 2);
      const compiled = computed(() => {
        const source = get(text);
        if (source === "bad") throw new Error("parse failed");
        return source.toUpperCase();
      });
      const normalizer = effect(() => {
        const options = get(ports);
        if (!options.includes(get(selection))) set(selection, options[0]);
      });
      const events: string[] = [];
      const renderer = effect(() => {
        const currentRoute = get(route);
        const program = get(compiled);
        events.push(`attach ${currentRoute}:${program}`);
        return () => {
          events.push(`detach ${currentRoute}:${program}`);
        };
      });
      try {
        expect(() =>
          batch(() => {
            set(position, 2);
            set(text, "bad");
            set(ports, ["out-0"]);
            expect(get(route)).toBe(4);
            expect(events).toEqual(["attach 2:OK"]);
          })
        ).toThrow("parse failed");
        expect(events).toEqual(["attach 2:OK"]);
        set(text, "fixed");
        expect(get(selection)).toBe("out-0");
        expect(events).toEqual([
          "attach 2:OK",
          "detach 2:OK",
          "attach 4:FIXED",
        ]);
        dispose(renderer);
        set(position, 3);
        expect(events.at(-1)).toBe("detach 4:FIXED");
      } finally {
        dispose(renderer);
        dispose(normalizer);
        dispose(route);
        dispose(compiled);
      }
    });
    test("a failed renderer run wakes on a newly read source", () => {
      const mode = signal("stable");
      const repair = signal(false);
      const runs: string[] = [];
      const renderer = effect(() => {
        const current = get(mode);
        runs.push(current);
        if (current === "editing" && !get(repair))
          throw new Error("render failed");
      });
      try {
        expect(() => set(mode, "editing")).toThrow("render failed");
        set(repair, true);
        expect(runs).toEqual(["stable", "editing", "editing"]);
      } finally {
        dispose(renderer);
      }
    });

    proposedContract("selection write remains owed after a reread", () => {
      const options = signal(["a", "b"]);
      const selection = signal("b");
      const runs: string[] = [];
      const normalizer = effect(() => {
        const available = get(options);
        const current = get(selection);
        runs.push(current);
        if (!available.includes(current)) {
          set(selection, available[0]);
          get(selection);
        }
      });
      try {
        set(options, ["a"]);
        expect(runs).toEqual(["b", "b", "a"]);
      } finally {
        dispose(normalizer);
      }
    });

    proposedContract(
      "failed initial effect leaves no live subscription",
      () => {
        const source = signal(0);
        let runs = 0;
        expect(() =>
          effect(() => {
            get(source);
            runs++;
            throw new Error("setup failed");
          })
        ).toThrow("setup failed");
        expect(() => set(source, 1)).not.toThrow();
        expect(runs).toBe(1);
      }
    );
    test("disposed effect cannot subscribe again after a later read", () => {
      const trigger = signal(0);
      const later = signal(0);
      let runs = 0;
      let stop: ReturnType<typeof effect>;
      batch(() => {
        stop = effect(() => {
          runs++;
          get(trigger);
          dispose(stop);
          get(later);
        });
      });
      set(trigger, 1);
      set(later, 1);
      expect(runs).toBe(1);
    });

    test("repeated failed compilation recovers without losing its source", () => {
      const source = signal("ok");
      const program = computed(() => {
        const value = get(source);
        if (value === "bad") throw new Error("syntax error");
        return value;
      });
      try {
        expect(get(program)).toBe("ok");
        for (let i = 0; i < 10_000; i++) {
          set(source, "bad");
          expect(() => get(program)).toThrow("syntax error");
          set(source, "ok");
          expect(get(program)).toBe("ok");
        }
      } finally {
        dispose(program);
      }
    });

    test("deep incremental projection propagates without recursive overflow", () => {
      const input = signal(0);
      let node: ReturnType<typeof computed<number>> = computed(
        () => get(input) + 1
      );
      const nodes = [node];
      for (let i = 1; i < 3000; i++) {
        const previous = node;
        node = computed(() => get(previous) + 1);
        nodes.push(node);
      }
      try {
        expect(get(node)).toBe(3000);
        set(input, 1);
        expect(get(node)).toBe(3001);
      } finally {
        for (const item of nodes.reverse()) dispose(item);
      }
    });
    test("a deferred failed initial run can be disposed using its handle", () => {
      const source = signal(0);
      let runs = 0;
      let handle!: ReturnType<typeof effect>;
      expect(() =>
        batch(() => {
          handle = effect(() => {
            get(source);
            runs++;
            throw new Error("deferred setup failed");
          });
        })
      ).toThrow("deferred setup failed");
      dispose(handle);
      set(source, 1);
      expect(runs).toBe(1);
    });

    test("batched writes returning to the original value remain observable", () => {
      const source = signal("A");
      const seen: string[] = [];
      const observer = effect(() => {
        seen.push(get(source));
      });
      try {
        batch(() => {
          set(source, "B");
          set(source, "A");
          expect(seen).toEqual(["A"]);
        });
        expect(seen).toEqual(["A", "A"]);
      } finally {
        dispose(observer);
      }
    });
  }
);

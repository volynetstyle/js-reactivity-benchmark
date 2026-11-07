import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { classifyCell } from "./result.mjs";

// Each cell is a fresh process: failed effects cannot contaminate another cell.
const libraries = ["quant", "preact", "alien", "vue", "vue36", "mobx", "solid"];
const cases = ["workflow", "handoff", "compiler", "combined"];

async function adapter(name) {
  const modules = {
    quant: "reflex-quant",
    preact: "@preact/signals-core",
    alien: "alien-signals",
    vue: "@vue/reactivity",
    vue36: "vue-reactivity-3.6",
    mobx: "mobx",
    solid: "solid-js/dist/solid.js",
  };
  if (!modules[name]) throw Error(`Unknown library: ${name}`);
  const library = await import(modules[name]);
  const quant = library,
    preact = library,
    alien = library,
    mobx = library,
    solid = library;
  if (name === "quant")
    return {
      signal: (v) => {
        const s = quant.signal(v);
        return { read: () => quant.get(s), write: (v) => quant.set(s, v) };
      },
      computed: (fn) => {
        const c = quant.computed(fn);
        return { read: () => quant.get(c) };
      },
      effect: (fn) => {
        const e = quant.effect(fn);
        return () => quant.dispose(e);
      },
      batch: quant.batch,
    };
  if (name === "preact")
    return {
      signal: (v) => {
        const s = preact.signal(v);
        return {
          read: () => s.value,
          write: (v) => {
            s.value = v;
          },
        };
      },
      computed: (fn) => {
        const c = preact.computed(fn);
        return { read: () => c.value };
      },
      effect: preact.effect,
      batch: preact.batch,
    };
  if (name === "alien")
    return {
      signal: (v) => {
        const s = alien.signal(v);
        return { read: () => s(), write: (v) => s(v) };
      },
      computed: (fn) => {
        const c = alien.computed(fn);
        return { read: () => c() };
      },
      effect: alien.effect,
      batch: (fn) => {
        alien.startBatch();
        try {
          return fn();
        } finally {
          alien.endBatch();
        }
      },
    };
  if (name === "vue" || name === "vue36") {
    const v = library;
    let batching = 0;
    let flushing = false;
    const queue = new Set();
    function flush() {
      if (batching || flushing) return;
      flushing = true;
      try {
        for (const pending of queue) {
          queue.delete(pending);
          if (pending.dirty) pending.run();
        }
      } finally {
        flushing = false;
      }
    }
    return {
      signal: (value) => {
        const s = v.shallowRef(value);
        return {
          read: () => s.value,
          write: (x) => {
            s.value = x;
          },
        };
      },
      computed: (fn) => {
        const c = v.computed(fn);
        return { read: () => c.value };
      },
      effect: (fn) => {
        let runner;
        runner = v.effect(
          () => {
            const cleanup = fn();
            if (typeof cleanup === "function") v.onEffectCleanup(cleanup);
          },
          {
            scheduler: () => {
              queue.add(runner.effect);
              flush();
            },
          }
        );
        return () => {
          queue.delete(runner.effect);
          v.stop(runner);
        };
      },
      batch: (fn) => {
        batching++;
        try {
          return fn();
        } finally {
          batching--;
          flush();
        }
      },
    };
  }
  if (name === "mobx") {
    mobx.configure({ enforceActions: "never" });
    return {
      signal: (v) => {
        const s = mobx.observable.box(v, { deep: false });
        return { read: () => s.get(), write: (v) => s.set(v) };
      },
      computed: (fn) => {
        const c = mobx.computed(fn, { keepAlive: true });
        return { read: () => c.get() };
      },
      // autorun has no returned-cleanup contract; model a resource with explicit cleanup.
      effect: (fn) => {
        let cleanup;
        const stop = mobx.autorun(() => {
          cleanup?.();
          cleanup = undefined;
          cleanup = fn();
        });
        return () => {
          stop();
          cleanup?.();
        };
      },
      batch: (fn) => mobx.runInAction(fn),
    };
  }
  if (name === "solid")
    return {
      signal: (v) => {
        const [read, write] = solid.createSignal(v);
        return { read, write: (v) => write(() => v) };
      },
      computed: (fn) => {
        const c = solid.createMemo(fn);
        return { read: c };
      },
      effect: (fn) =>
        solid.createRoot((dispose) => {
          solid.createRenderEffect(() => {
            const cleanup = fn();
            if (typeof cleanup === "function") solid.onCleanup(cleanup);
          });
          return dispose;
        }),
      batch: solid.batch,
    };
  throw Error(`Unknown library: ${name}`);
}

function recorder() {
  const checks = [];
  return {
    checks,
    check(name, actual, expected) {
      checks.push({
        name,
        actual,
        expected,
        matches: JSON.stringify(actual) === JSON.stringify(expected),
      });
    },
    attempt(fn) {
      try {
        fn();
        return "none";
      } catch (e) {
        return String(e?.message ?? e);
      }
    },
  };
}

function workflow(a, r) {
  const x = a.signal(10),
    width = a.signal(300),
    obstacle = a.signal(1),
    alternate = a.signal(20),
    useAlternate = a.signal(false);
  const ports = a.signal(["out-0", "out-1"]),
    selected = a.signal("out-1");
  let routeRuns = 0;
  const bucket = a.computed(() => Math.floor(width.read() / 10));
  const route = a.computed(() => {
    routeRuns++;
    const endpoint = useAlternate.read() ? alternate : x;
    const first = endpoint.read();
    const clearance = obstacle.read();
    const second = endpoint.read();
    return first + second + clearance + bucket.read();
  });
  const normalizations = [];
  const stopNormalize = a.effect(() => {
    const available = ports.read(),
      current = selected.read();
    normalizations.push(current);
    if (!available.includes(current)) {
      selected.write(available[0]);
      selected.read();
    }
  });
  const rendered = [];
  const stopRender = a.effect(() => {
    rendered.push(route.read());
  });
  try {
    r.check("initial route", [...rendered], [51]);
    const before = routeRuns;
    width.write(301);
    r.check(
      "cutoff suppresses route",
      [routeRuns - before, [...rendered]],
      [0, [51]]
    );
    ports.write(["out-0"]);
    r.check("selection fallback", selected.read(), "out-0");
    r.check(
      "self-write obligation",
      [...normalizations],
      ["out-1", "out-1", "out-0"]
    );
    let during, duringRenders;
    a.batch(() => {
      x.write(11);
      obstacle.write(2);
      during = route.read();
      duringRenders = [...rendered];
    });
    r.check("fresh read during batch", during, 54);
    r.check("render deferred in batch", duringRenders, [51]);
    r.check("single batched render", [...rendered], [51, 54]);
    useAlternate.write(true);
    r.check("branch switch", rendered.at(-1), 72);
    const count = rendered.length;
    x.write(99);
    r.check("old branch detached", rendered.length, count);
    alternate.write(21);
    r.check("new branch live", rendered.at(-1), 74);
  } finally {
    stopRender();
    stopNormalize();
  }
}

function handoff(a, r) {
  const account = a.signal("A"),
    auth = a.signal("valid");
  const endpoint = a.computed(() => account.read());
  const credentials = a.computed(() => {
    const value = auth.read();
    if (value === "expired") throw Error("expired credentials");
    return value;
  });
  const events = [];
  const stop = a.effect(() => {
    const address = endpoint.read(),
      credential = credentials.read();
    events.push(`connect ${address}:${credential}`);
    return () => {
      events.push(`close ${address}:${credential}`);
    };
  });
  try {
    r.check(
      "validation error",
      r.attempt(() =>
        a.batch(() => {
          account.write("B");
          auth.write("expired");
        })
      ),
      "expired credentials"
    );
    r.check("old resource retained", [...events], ["connect A:valid"]);
    const err = r.attempt(() => auth.write("renewed"));
    r.check("recovery error", err, "none");
    r.check(
      "handoff events",
      [...events],
      ["connect A:valid", "close A:valid", "connect B:renewed"]
    );
  } finally {
    stop();
  }
  r.check("dispose closes resource", events.at(-1), "close B:renewed");
}

function compiler(a, r) {
  const branch = a.signal("A"),
    old = a.signal("ok"),
    current = a.signal("broken");
  let attempts = 0;
  const backend = a.computed(() => {
    if (old.read() === "broken") throw Error("obsolete backend");
    return "A";
  });
  const program = a.computed(() => {
    attempts++;
    if (branch.read() === "A") return backend.read();
    if (current.read() === "broken") throw Error("syntax error");
    return "B";
  });
  r.check("initial compile", program.read(), "A");
  // Solid memos may evaluate eagerly at the write; capture that as an observation.
  r.check(
    "switch write error",
    r.attempt(() => branch.write("B")),
    "none"
  );
  r.check(
    "first failed demand",
    r.attempt(() => program.read()),
    "syntax error"
  );
  const after = attempts;
  let repeated;
  const repeatedError = r.attempt(() => {
    repeated = program.read();
  });
  r.check(
    "second failed demand",
    repeatedError === "none" ? `returned ${String(repeated)}` : repeatedError,
    "syntax error"
  );
  r.check("failed demand retries", attempts - after, 1);
  r.check(
    "obsolete backend write error",
    r.attempt(() => old.write("broken")),
    "none"
  );
  r.check(
    "repair write error",
    r.attempt(() => current.write("fixed")),
    "none"
  );
  let value;
  const error = r.attempt(() => {
    value = program.read();
  });
  r.check(
    "recovered compile",
    error === "none" ? value : `error: ${error}`,
    "B"
  );
}

function combined(a, r) {
  const position = a.signal(1),
    text = a.signal("ok"),
    selection = a.signal("out-1"),
    ports = a.signal(["out-0", "out-1"]);
  const route = a.computed(() => position.read() * 2);
  const compiled = a.computed(() => {
    const s = text.read();
    if (s === "bad") throw Error("parse failed");
    return s.toUpperCase();
  });
  const normalizer = a.effect(() => {
    const options = ports.read();
    if (!options.includes(selection.read())) selection.write(options[0]);
  });
  const events = [];
  const renderer = a.effect(() => {
    const current = route.read(),
      program = compiled.read();
    events.push(`attach ${current}:${program}`);
    return () => {
      events.push(`detach ${current}:${program}`);
    };
  });
  try {
    let pull, during;
    const error = r.attempt(() =>
      a.batch(() => {
        position.write(2);
        text.write("bad");
        ports.write(["out-0"]);
        pull = route.read();
        during = [...events];
      })
    );
    r.check("batch error", error, "parse failed");
    r.check("route during batch", pull ?? null, 4);
    r.check("render deferred", during ?? null, ["attach 2:OK"]);
    r.check(
      "resource survives failed validation",
      [...events],
      ["attach 2:OK"]
    );
    const repair = r.attempt(() => text.write("fixed"));
    r.check("repair error", repair, "none");
    r.check("selection recovered", selection.read(), "out-0");
    r.check(
      "render handoff",
      [...events],
      ["attach 2:OK", "detach 2:OK", "attach 4:FIXED"]
    );
    renderer();
    position.write(3);
    r.check("disposed renderer", events.at(-1), "detach 4:FIXED");
  } finally {
    renderer();
    normalizer();
  }
}

const workloads = { workflow, handoff, compiler, combined };
const versions = {
  quant: "reflex-quant",
  preact: "@preact/signals-core",
  alien: "alien-signals",
  vue: "@vue/reactivity",
  vue36: "vue-reactivity-3.6",
  mobx: "mobx",
  solid: "solid-js",
};
if (process.argv[2] === "--cell") {
  const [, , , name, workload] = process.argv;
  const result = recorder();
  let error = null;
  try {
    workloads[workload](await adapter(name), result);
  } catch (e) {
    error = String(e?.stack ?? e);
  }
  process.stdout.write(
    JSON.stringify({ name, workload, checks: result.checks, error })
  );
} else {
  const results = [];
  for (const name of libraries) {
    let version = null;
    try {
      version = JSON.parse(
        readFileSync(`node_modules/${versions[name]}/package.json`, "utf8")
      ).version;
    } catch {
      /* The cell records missing or broken packages. */
    }
    for (const workload of cases) {
      const child = spawnSync(
        process.execPath,
        [process.argv[1], "--cell", name, workload],
        { encoding: "utf8", timeout: 10000 }
      );
      results.push(classifyCell(name, workload, version, child));
    }
  }
  const output =
    JSON.stringify({ node: process.version, results }, null, 2) + "\n";
  const index = process.argv.indexOf("--output");
  if (index !== -1) {
    if (!process.argv[index + 1]) throw Error("--output needs a file path");
    writeFileSync(process.argv[index + 1], output, "utf8");
  } else process.stdout.write(output);
}

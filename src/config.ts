import { TestConfig, FrameworkInfo } from "./util/frameworkTypes";

import { alienFramework } from "./frameworks/alienSignals";
//import { angularFramework } from "./frameworks/angularSignals";
import { mobxFramework } from "./frameworks/mobx";
//import { tc39SignalsProposalStage0 } from "./frameworks/tc39-proposal-signals-stage-0";
import { molWireFramework } from "./frameworks/molWire";
import { obyFramework } from "./frameworks/oby";
import { preactSignalFramework } from "./frameworks/preactSignals";
import { reactivelyFramework } from "./frameworks/reactively";

import { signiaFramework } from "./frameworks/signia";
import { solidFramework } from "./frameworks/solid";
import { sFramework } from "./frameworks/s";
import { usignalFramework } from "./frameworks/uSignal";
import { vueReactivityFramework } from "./frameworks/vueReactivity";
//import { svelteFramework } from "./frameworks/svelte";
import { tansuFramework } from "./frameworks/tansu";
import { reflexFramework } from "./frameworks/reflex";
import { solidSignalsFramework } from "./frameworks/solid-signals";
// import { compostateFramework } from "./frameworks/compostate";
// import { valtioFramework } from "./frameworks/valtio";

export const frameworkInfo: FrameworkInfo[] = [
  { framework: reflexFramework, testPullCounts: true },
  { framework: alienFramework, testPullCounts: true },
  { framework: solidSignalsFramework },
  { framework: preactSignalFramework, testPullCounts: true },
  { framework: reactivelyFramework, testPullCounts: true },
  { framework: sFramework },
  { framework: tansuFramework, testPullCounts: true },
  { framework: molWireFramework, testPullCounts: true },
  { framework: obyFramework, testPullCounts: true },
  { framework: signiaFramework, testPullCounts: true },
  { framework: solidSignalsFramework },
  { framework: solidFramework },
  { framework: usignalFramework, testPullCounts: true },
  { framework: vueReactivityFramework, testPullCounts: true },
  // NOTE: MobX currently hangs on some of the `dynamic` tests and `cellx` tests, 
  // so disable it if you want to run them. (https://github.com/mobxjs/mobx/issues/3926)
  { framework: mobxFramework, testPullCounts: false },

  // --- Disabled frameworks ---
  // unoptimized and too heavy
  //{ framework: rippleFramework, testPullCounts: true },
  // REMOVED: cause too slow because it maybe should compiled - tough to measure
  //{ framework: svelteFramework, testPullCounts: true },
  // REMOVED: cause too slow
  // { framework: tc39SignalsProposalStage0, testPullCounts: true },
  // REMOVED: cause too slow
  // { framework: angularFramework, testPullCounts: true }
  // NOTE: the compostate adapter is currently broken and unused.
  // { framework: compostateFramework },
  // NOTE: the kairo adapter is currently broken and unused.
  // { framework: kairoFramework, testPullCounts: true },
  // NOTE: Valtio currently hangs on some of the `dynamic` tests, so disable it if you want to run them. (https://github.com/pmndrs/valtio/discussions/949)
  // { framework: valtioFramework },
];

export const perfTests: TestConfig[] = [
  // App-like scenarios: moderate graph sizes, selective leaf reads, and a mix
  // of mostly-static and partially-dynamic derivations. These are less
  // synthetic than the stress-style cases below and tend to track real UI data
  // flows more closely.
  {
    name: "dashboard selective reads",
    width: 64,
    totalLayers: 6,
    staticFraction: 0.95,
    nSources: 4,
    readFraction: 0.12,
    iterations: 120000,
    expected: {},
  },
  {
    name: "editor derived state",
    width: 24,
    totalLayers: 8,
    staticFraction: 0.8,
    nSources: 3,
    readFraction: 0.4,
    iterations: 90000,
    expected: {},
  },
  {
    name: "kanban board",
    width: 120,
    totalLayers: 7,
    staticFraction: 0.9,
    nSources: 5,
    readFraction: 0.18,
    iterations: 30000,
    expected: {},
  },
  {
    name: "entity detail page",
    width: 40,
    totalLayers: 10,
    staticFraction: 0.97,
    nSources: 4,
    readFraction: 0.6,
    iterations: 30000,
    expected: {},
  },
  {
    name: "layered full-drain cold",
    graphKind: "layered-dag",
    width: 512,
    sourcesCount: 256,
    totalLayers: 32,
    staticFraction: 1,
    nSources: 4,
    fanIn: 4,
    readFraction: 1,
    sinkReadMode: "per-update",
    iterations: 120,
    warmupIterations: 0,
    measureBuild: false,
    expected: {},
  },
  {
    name: "layered full-drain warm",
    graphKind: "layered-dag",
    width: 512,
    sourcesCount: 256,
    totalLayers: 32,
    staticFraction: 1,
    nSources: 4,
    fanIn: 4,
    readFraction: 1,
    sinkReadMode: "per-update",
    iterations: 120,
    warmupIterations: 320,
    measureBuild: false,
    expected: {},
  },
  {
    name: "layered burst flush warm",
    graphKind: "layered-dag",
    width: 512,
    sourcesCount: 256,
    totalLayers: 32,
    staticFraction: 1,
    nSources: 8,
    fanIn: 8,
    readFraction: 1,
    sinkReadMode: "per-batch",
    updatesPerIteration: 16,
    iterations: 96,
    warmupIterations: 256,
    measureBuild: false,
    expected: {},
  },
  {
    name: "stable diamond mesh warm",
    graphKind: "diamond-mesh",
    width: 512,
    sourcesCount: 256,
    totalLayers: 32,
    staticFraction: 1,
    nSources: 8,
    fanIn: 8,
    readFraction: 1,
    sinkReadMode: "per-update",
    iterations: 96,
    warmupIterations: 256,
    measureBuild: false,
    expected: {},
  },
  {
    name: "pure pull",
    mode: "pull",
    width: 32,
    totalLayers: 8,
    staticFraction: 1,
    nSources: 4,
    readFraction: 1,
    iterations: 10000,
    expected: {
      sum: 5242355712,
      count: 224,
    },
  },
  {
    name: "pure push",
    mode: "push",
    width: 32,
    totalLayers: 8,
    staticFraction: 1,
    nSources: 4,
    readFraction: 1,
    iterations: 10000,
    expected: {
      sum: 5242355712,
      count: 910133,
    },
  },

  // Stress-style scenarios kept for continuity with older runs.
  {
    name: "simple component",
    width: 10, // can't change for decorator tests
    staticFraction: 1, // can't change for decorator tests
    nSources: 2, // can't change for decorator tests
    totalLayers: 5,
    readFraction: 0.2,
    iterations: 600000,
    expected: {
      sum: 19199832,
      count: 2640004,
    },
  },
  {
    name: "dynamic component",
    width: 10,
    totalLayers: 10,
    staticFraction: 3 / 4,
    nSources: 6,
    readFraction: 0.2,
    iterations: 15000,
    expected: {
      sum: 302310477864,
      count: 1125003,
    },
  },
  {
    name: "large web app",
    width: 1000,
    totalLayers: 12,
    staticFraction: 0.95,
    nSources: 4,
    readFraction: 1,
    iterations: 7000,
    expected: {
      sum: 29355933696000,
      count: 1473791,
    },
  },
  {
    name: "wide dense",
    width: 1000,
    totalLayers: 5,
    staticFraction: 1,
    nSources: 25,
    readFraction: 1,
    iterations: 3000,
    expected: {
      sum: 1171484375000,
      count: 735756,
    },
  },
  {
    name: "deep",
    width: 5,
    totalLayers: 500,
    staticFraction: 1,
    nSources: 3,
    readFraction: 1,
    iterations: 500,
    expected: {
      sum: 3.0239642676898464e241,
      count: 1246502,
    },
  },
  // Several frameworks hang on this test, so disabling it for now.
  // @see https://github.com/vuejs/core/issues/11928
  // {
  //   name: "very dynamic",
  //   width: 100,
  //   totalLayers: 15,
  //   staticFraction: 0.5,
  //   nSources: 6,
  //   readFraction: 1,
  //   iterations: 2000,
  //   expected: {
  //     sum: 15664996402790400,
  //     count: 1078671,
  //   },
  // },
];

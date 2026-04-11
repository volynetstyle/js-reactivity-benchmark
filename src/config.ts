import { TestConfig, FrameworkInfo } from "./util/frameworkTypes";

import { alienFramework } from "./frameworks/alienSignals";
import { angularFramework } from "./frameworks/angularSignals";
import { mobxFramework } from "./frameworks/mobx";
import { tc39SignalsProposalStage0 } from "./frameworks/tc39-proposal-signals-stage-0";
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
  { framework: preactSignalFramework, testPullCounts: true },
  //{ framework: svelteFramework, testPullCounts: true },
  { framework: tc39SignalsProposalStage0, testPullCounts: true },
  { framework: reactivelyFramework, testPullCounts: true },
  // unoptimized and too heavy
  //{ framework: rippleFramework, testPullCounts: true },
  { framework: sFramework },
  { framework: tansuFramework, testPullCounts: true },
  { framework: angularFramework, testPullCounts: true },
  { framework: molWireFramework, testPullCounts: true },
  { framework: obyFramework, testPullCounts: true },
  { framework: signiaFramework, testPullCounts: true },
  { framework: solidSignalsFramework },
  { framework: solidFramework },
  { framework: usignalFramework, testPullCounts: true },
  { framework: vueReactivityFramework, testPullCounts: true },
  // NOTE: MobX currently hangs on some of the `dynamic` tests and `cellx` tests, so disable it if you want to run them. (https://github.com/mobxjs/mobx/issues/3926)
  { framework: mobxFramework, testPullCounts: false },

  // --- Disabled frameworks ---
  // NOTE: the compostate adapter is currently broken and unused.
  // { framework: compostateFramework },
  // NOTE: the kairo adapter is currently broken and unused.
  // { framework: kairoFramework, testPullCounts: true },
  // NOTE: Valtio currently hangs on some of the `dynamic` tests, so disable it if you want to run them. (https://github.com/pmndrs/valtio/discussions/949)
  // { framework: valtioFramework },
];

export const perfTests: TestConfig[] = [
  {
    name: "diamond shared deps",
    width: 200,
    totalLayers: 6,
    staticFraction: 1,
    nSources: 2,
    readFraction: 1,
    iterations: 10000,
    expected: { sum: 63993600, count: 200980 },
  },
  {
    name: "broad fan-out",
    width: 5000,
    totalLayers: 2,
    staticFraction: 1,
    nSources: 1,
    readFraction: 1,
    iterations: 5000,
    expected: { sum: 24995000, count: 9999 },
  },
  {
    name: "many sources one sink",
    width: 1,
    totalLayers: 2,
    staticFraction: 1,
    nSources: 5000,
    readFraction: 1,
    iterations: 3000,
    expected: { sum: 14995000, count: 3000 },
  },
  {
    name: "conditional churn",
    width: 200,
    totalLayers: 20,
    staticFraction: 0.5,
    nSources: 8,
    readFraction: 0.5,
    iterations: 8000,
    expected: { sum: 1.1546784962272535e23, count: 10258075 },
  },
  {
    name: "stable after recompute",
    width: 300,
    totalLayers: 10,
    staticFraction: 1,
    nSources: 4,
    readFraction: 1,
    iterations: 20000,
    expected: { sum: 1572785356800, count: 2882556 },
  },
  {
    name: "hot reads stable graph",
    width: 500,
    totalLayers: 8,
    staticFraction: 1,
    nSources: 4,
    readFraction: 1,
    iterations: 200000,
    expected: { sum: 1638391808000, count: 18203409 },
  },
  {
    name: "broad invalidation sparse reads",
    width: 3000,
    totalLayers: 6,
    staticFraction: 1,
    nSources: 2,
    readFraction: 0.02,
    iterations: 10000,
    expected: { sum: 19217928, count: 10801 },
  },
  {
    name: "many observers",
    width: 1,
    totalLayers: 3,
    staticFraction: 1,
    nSources: 2,
    readFraction: 1,
    iterations: 10000,
    expected: { sum: 39996, count: 20000 },
  },
  {
    name: "deep dynamic",
    width: 5,
    totalLayers: 300,
    staticFraction: 0.7,
    nSources: 3,
    readFraction: 1,
    iterations: 1000,
    expected: { sum: 3.3818054478087055e145, count: 1492802 },
  },
  {
    name: "ultra wide shallow",
    width: 10000,
    totalLayers: 2,
    staticFraction: 1,
    nSources: 2,
    readFraction: 1,
    iterations: 2000,
    expected: { sum: 103988000, count: 13998 },
  },
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

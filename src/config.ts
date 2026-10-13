import { FrameworkInfo } from "./util/frameworkTypes";

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
import { liteSignalFramework } from "./frameworks/liteSignal";
// import { compostateFramework } from "./frameworks/compostate";
// import { valtioFramework } from "./frameworks/valtio";

export const frameworkInfo: FrameworkInfo[] = [
  { framework: reflexFramework, testPullCounts: true },
  { framework: alienFramework, testPullCounts: true },
  { framework: liteSignalFramework, testPullCounts: true },
  { framework: solidSignalsFramework },
  { framework: preactSignalFramework, testPullCounts: true },
  { framework: reactivelyFramework, testPullCounts: true },
  { framework: sFramework },
  { framework: tansuFramework, testPullCounts: true },
  { framework: molWireFramework, testPullCounts: true },
  { framework: obyFramework, testPullCounts: true },
  { framework: signiaFramework, testPullCounts: true },
  { framework: solidFramework },
  { framework: usignalFramework, testPullCounts: true },
  { framework: vueReactivityFramework, testPullCounts: true },
  // NOTE: MobX currently hangs on some of the `dynamic` tests and `cellx` tests,
  // so disable it if you want to run them. (https://github.com/mobxjs/mobx/issues/3926)
  // { framework: mobxFramework, testPullCounts: false },

  // --- Disabled frameworks ---
  // unoptimized and too heavy
  // { framework: rippleFramework, testPullCounts: true },
  // REMOVED: cause too slow because it maybe should compiled - tough to measure
  // { framework: svelteFramework, testPullCounts: true },
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

export { perfTests } from "./workloads";

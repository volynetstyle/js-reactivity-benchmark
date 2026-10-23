import { FrameworkInfo } from "./util/frameworkTypes";

import { alienFramework } from "./frameworks/alienSignals";
import { reactiveEngineFramework } from "./frameworks/reactiveEngine";
//import { angularFramework } from "./frameworks/angularSignals";
//import { mobxFramework } from "./frameworks/mobx";
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
import { solidSignals2Framework } from "./frameworks/solidSignals2";
import { solid2Framework } from "./frameworks/solidJs2";
import { vueReactivity36Framework } from "./frameworks/vueReactivity36";
import { dalienFramework } from "./frameworks/dalien";
import { anodFramework } from "./frameworks/anod";
import { reatomFramework } from "./frameworks/reatom";
import { maverickFramework } from "./frameworks/maverick";
import { cellxFramework } from "./frameworks/cellx";
import { rescriptSignalsFramework } from "./frameworks/rescriptSignals";
// import { compostateFramework } from "./frameworks/compostate";
// import { valtioFramework } from "./frameworks/valtio";

export const frameworkInfo: FrameworkInfo[] = [
  { framework: reflexFramework, testPullCounts: true },
  { framework: alienFramework, testPullCounts: true },
  { framework: reactiveEngineFramework, testPullCounts: true },
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
  // Architectural families added in semantics v4.
  { framework: solidSignals2Framework },
  { framework: solid2Framework },
  { framework: vueReactivity36Framework, testPullCounts: true },
  { framework: dalienFramework, testPullCounts: true },
  { framework: anodFramework },
  { framework: reatomFramework, testPullCounts: true },
  { framework: maverickFramework, testPullCounts: true },
  { framework: cellxFramework },
  { framework: rescriptSignalsFramework },
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

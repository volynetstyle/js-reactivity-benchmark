import { FrameworkInfo } from "./util/frameworkTypes";

import { alienFramework } from "./frameworks/alienSignals";
import { reactiveEngineFramework } from "./frameworks/reactiveEngine";
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
import { svelteFramework } from "./frameworks/svelte";
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
import { kairoFramework } from "./frameworks/kairo";

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
  { framework: mobxFramework },
  { framework: svelteFramework, testPullCounts: true },
  { framework: tc39SignalsProposalStage0, testPullCounts: true },
  { framework: angularFramework, testPullCounts: true },
  { framework: kairoFramework },
  // Compostate 1.0.0 revisits shared dependency paths exponentially (cellx).
  // Valtio 2.3.2 + valtio-reactive 0.2.0 emits transient diamond values.
  // See tests/inactiveAdapters.test.ts and docs/adapter-recheck.md.
];

export { perfTests } from "./workloads";

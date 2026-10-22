import * as signals2 from "solid-signals-2";
import { createSolid2Framework } from "./solid2Factory";

// @solidjs/signals 2.0 release candidate (npm alias): the reactive core of
// SolidJS 2.0, with staged writes and explicit flush.
export const solidSignals2Framework = createSolid2Framework(
  "@solidjs/signals 2 RC",
  signals2
);

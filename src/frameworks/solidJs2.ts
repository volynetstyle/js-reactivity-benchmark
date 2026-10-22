// solid-js 2 resolves its `node` export to the non-reactive SSR build;
// `solid-js-2-client` (scripts/module-aliases.mjs) is its client build.
import * as solid2 from "solid-js-2-client";
import { createSolid2Framework, Solid2Api } from "./solid2Factory";

export const solid2Framework = createSolid2Framework(
  "SolidJS 2 RC",
  solid2 as unknown as Solid2Api
);

import * as vue35 from "@vue/reactivity";
import { createVueReactivityFramework } from "./vueFactory";

export const vueReactivityFramework = createVueReactivityFramework(
  "@vue/reactivity",
  vue35
);

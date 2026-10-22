import * as vue36 from "vue-reactivity-3.6";
import { createVueReactivityFramework } from "./vueFactory";

// @vue/reactivity 3.6 release candidate (npm alias), whose core is derived
// from alien-signals. Same adapter and scheduling policy as 3.5.
export const vueReactivity36Framework = createVueReactivityFramework(
  "@vue/reactivity 3.6 RC",
  vue36
);

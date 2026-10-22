import { defineConfig } from "vitest/config";
import { moduleAliases } from "./scripts/module-aliases.mjs";

export default defineConfig({
  resolve: { alias: moduleAliases },
});

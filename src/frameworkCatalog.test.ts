import { expect, test } from "vitest";
import catalog from "./frameworkCatalog.json";
import { frameworkInfo } from "./config";
test("worker catalog matches the active adapters and pull-count contracts", () => {
  expect(catalog.map((entry) => entry.name)).toEqual(
    frameworkInfo.map((info) => info.framework.name)
  );
  expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  for (const [index, entry] of catalog.entries()) {
    expect(!!entry.pullCounts).toBe(!!frameworkInfo[index].testPullCounts);
  }
});

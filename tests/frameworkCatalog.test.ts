import { expect, test } from "vitest";
import catalog from "../src/frameworkCatalog.json";
import { frameworkInfo } from "../src/config";

// The default run must cover exactly the built workers: an adapter silently
// left out of either list would drop out of the published leaderboard.
test("worker catalog matches the active adapters and pull-count contracts", () => {
  expect(catalog.map((entry) => entry.name)).toEqual(
    frameworkInfo.map((info) => info.framework.name)
  );
  expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  for (const [index, entry] of catalog.entries()) {
    expect(!!entry.pullCounts).toBe(!!frameworkInfo[index].testPullCounts);
  }
});

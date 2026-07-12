import { describe, expect, test } from "vitest";
import { performanceCeilingMs } from "./benchmark";

describe("adaptive benchmark ceiling", () => {
  test("uses the absolute ceiling before a reference result exists", () => {
    expect(performanceCeilingMs(undefined, 1500, 3)).toBe(1500);
  });

  test("allows a bounded slowdown relative to the fastest result", () => {
    expect(performanceCeilingMs(800, 1500, 3)).toBe(2400);
  });

  test("never drops below the absolute ceiling", () => {
    expect(performanceCeilingMs(200, 1500, 3)).toBe(1500);
  });
});

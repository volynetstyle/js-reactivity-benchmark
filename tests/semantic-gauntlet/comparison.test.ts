import { describe, expect, test } from "vitest";
import { classifyCell } from "../../scripts/semantic-gauntlet/result.mjs";

describe("semantic comparison result classification", () => {
  const child = (body: object) => ({
    status: 0,
    stdout: JSON.stringify(body),
    stderr: "",
  });
  test("records matching and different results", () => {
    expect(
      classifyCell(
        "lib",
        "case",
        "1",
        child({ checks: [{ matches: true }], error: null })
      ).outcome
    ).toBe("match");
    expect(
      classifyCell(
        "lib",
        "case",
        "1",
        child({ checks: [{ matches: false }], error: null })
      ).outcome
    ).toBe("difference");
  });
  test("records a thrown error and a crashed process", () => {
    expect(
      classifyCell("lib", "case", "1", child({ checks: [], error: "failure" }))
        .outcome
    ).toBe("error");
    expect(
      classifyCell("lib", "case", "1", {
        status: 1,
        stdout: "",
        stderr: "crash",
      }).error
    ).toBe("crash");
  });
  test("records a timeout even when output streams are absent", () => {
    const result = classifyCell("lib", "case", "1", {
      status: null,
      stdout: null,
      stderr: null,
      error: { code: "ETIMEDOUT", message: "timed out" },
    });
    expect(result.outcome).toBe("timeout");
    expect(result.error).toBe("timed out");
  });
});

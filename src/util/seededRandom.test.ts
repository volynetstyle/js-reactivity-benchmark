import { expect, test } from "vitest";
import { SeededRandom } from "./seededRandom";

// Captured from random@5.4.1 `new Random("seed")`; 1,000,000 mixed float/int
// draws over four seeds matched exactly before the dependency was removed.
test("reproduces the random@5.4.1 sequence that the expected sums depend on", () => {
  const random = new SeededRandom("seed");
  expect(Array.from({ length: 6 }, () => random.next())).toEqual([
    0.4770385572192159, 0.6635319494276601, 0.1544994037968863,
    0.351112128035406, 0.8638669515610129, 0.3823690375297207,
  ]);
  expect(Array.from({ length: 12 }, () => random.int(0, 99))).toEqual([
    9, 81, 80, 58, 69, 16, 65, 42, 17, 46, 24, 37,
  ]);
  let sum = 0;
  for (let i = 0; i < 100_000; i++) sum += random.int(0, 1_000_000);
  expect(sum).toBe(49980951061);
});

test("float is next and fresh instances restart the sequence", () => {
  const a = new SeededRandom("seed");
  const b = new SeededRandom("seed");
  expect(a.float()).toBe(b.next());
  expect(new SeededRandom("seed").next()).toBe(0.4770385572192159);
  expect(() => a.int(0, 1.5)).toThrow("integers");
});

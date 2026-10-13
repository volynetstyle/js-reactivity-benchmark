export function busy(input: number): number {
  let value = input | 0;
  for (let i = 0; i < 100; i++) {
    value = (Math.imul(value ^ i, 1664525) + 1013904223) | 0;
  }
  return value;
}

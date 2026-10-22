/**
 * Deterministic generator for graph topology and leaf selection.
 *
 * This is a vendored copy of the string-seeded ARC4 generator in
 * `random@5.4.1` (`new Random("seed")`, `.float()`, `.int(min, max)`). The
 * configured expected sums depend on this exact sequence, so it must not be
 * resolved from a semver range: `random@5.5` seeds strings with xoshiro128**
 * and also corrects the ARC4 swap, and both changes alter every graph.
 *
 * Note that `g()` intentionally keeps 5.4.1's order of the swap (it writes
 * `S[j]` before advancing `j`), which differs from textbook RC4. The golden
 * sequence in `seededRandom.test.ts` pins this behaviour.
 */
export class SeededRandom {
  private i = 0;
  private j = 0;
  private readonly S: number[] = [];

  constructor(seed: string) {
    const key = mixKey(seed);
    const S = this.S;
    for (let i = 0; i <= 255; i++) S[i] = i;
    for (let i = 0, j = 0; i <= 255; i++) {
      const t = S[i];
      j = 255 & (j + key[i % key.length] + t);
      S[i] = S[j];
      S[j] = t;
    }
    this.g(256);
  }

  /** Uniform float in [0, 1), with 52 bits of randomness. */
  next(): number {
    let n = this.g(6);
    let d = 281474976710656; // 2^48
    let x = 0;
    while (n < 4503599627370496) {
      // 2^52
      n = (n + x) * 256;
      d *= 256;
      x = this.g(1);
    }
    while (n >= 9007199254740992) {
      // 2^53
      n /= 2;
      d /= 2;
      x >>>= 1;
    }
    return (n + x) / d;
  }

  /** Equivalent to `random@5.4.1` `Random#float()` with default bounds. */
  float(): number {
    return this.next();
  }

  /** Equivalent to `random@5.4.1` `Random#int(min, max)`; both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max))
      throw new TypeError("SeededRandom.int bounds must be integers");
    return Math.floor(this.next() * (max - min + 1) + min);
  }

  private g(count: number): number {
    const S = this.S;
    let i = this.i;
    let j = this.j;
    let r = 0;
    while (count--) {
      i = 255 & (i + 1);
      const t = S[i];
      S[j] = t;
      j = 255 & (j + t);
      S[i] = S[j];
      r = r * 256 + S[255 & (S[i] + t)];
    }
    this.i = i;
    this.j = j;
    return r;
  }
}

function mixKey(seed: string): number[] {
  const key: number[] = [];
  let smear = 0;
  for (let j = 0; j < seed.length; j++) {
    key[255 & j] =
      255 & ((smear ^= (key[255 & j] ?? 0) * 19) + seed.charCodeAt(j));
  }
  return key.length ? key : [0];
}

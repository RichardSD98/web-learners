/**
 * Seeded pseudo-randomness.
 *
 * `Math.random()` is deliberately not used anywhere in test assembly: a paper
 * has to be reproducible from its seed alone, so that a learner can share one,
 * a bug report can be replayed, and the tests can assert on real output rather
 * than on mocks.
 */

/** Hash a string seed into a 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and stable across platforms and Node versions. */
export function makeRng(seed: string): () => number {
  let a = hashSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Fisher-Yates, returning a new array. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take `count` items without replacement. Returns fewer only if the pool is smaller. */
export function sample<T>(items: readonly T[], count: number, rng: () => number): T[] {
  return shuffle(items, rng).slice(0, Math.min(count, items.length));
}

/** A readable seed, e.g. "brisk-otter-4821". Not security-sensitive. */
const WORDS_A = [
  "brisk", "calm", "swift", "quiet", "bright", "steady", "keen", "bold",
  "clear", "warm", "sharp", "gentle",
];
const WORDS_B = [
  "otter", "kudu", "oryx", "falcon", "jackal", "springbok", "heron", "meerkat",
  "gecko", "zebra", "eagle", "hare",
];

export function generateSeed(rng: () => number = makeRng(String(Date.now()))): string {
  const a = WORDS_A[randomInt(rng, WORDS_A.length)];
  const b = WORDS_B[randomInt(rng, WORDS_B.length)];
  const n = 1000 + randomInt(rng, 9000);
  return `${a}-${b}-${n}`;
}

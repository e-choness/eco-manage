// Deterministic randomness: the same seed gives the same site, so demos and E2E runs repeat.

export type Rng = () => number;

/** mulberry32: small, fast, good enough for a simulation. Returns values in [0, 1). */
export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A value derived from the seed and a key, independent of how many draws happened before. */
export const hashRandom = (seed: number, key: string): number => {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return createRng(h)();
};

/** Standard normal via Box–Muller. */
export const gaussian = (rng: Rng): number => {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

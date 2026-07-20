// Shared deterministic RNG so the engine and the map generator agree.
// makeRng(seed) returns a function in [0,1). Null seed => Math.random.
export function makeRng(seed) {
  if (seed == null) return Math.random;
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

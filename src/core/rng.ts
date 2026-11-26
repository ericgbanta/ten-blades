// Seeded RNG (mulberry32). The state is a single 32-bit unsigned integer, so it
// is a plain serializable value that can live inside the battle state and saves.
// All functions are pure: they take a state and return a value plus the new state.

export type RngState = number;

/** Create an RNG state from any integer seed. */
export function createRng(seed: number): RngState {
  return seed >>> 0;
}

/** Next float in [0, 1). Returns [value, newState]. */
export function nextFloat(state: RngState): [number, RngState] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Next integer in [min, max], both inclusive. Returns [value, newState]. */
export function nextInt(state: RngState, min: number, max: number): [number, RngState] {
  const [f, s] = nextFloat(state);
  return [min + Math.floor(f * (max - min + 1)), s];
}

/** True with the given percent chance (0 to 100). Returns [hit, newState]. */
export function rollPercent(state: RngState, percent: number): [boolean, RngState] {
  const [v, s] = nextInt(state, 0, 99);
  return [v < percent, s];
}

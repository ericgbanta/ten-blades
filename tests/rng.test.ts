import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, rollPercent } from '../src/core/rng';

function run(seed: number, n: number): number[] {
  let s = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [v, ns] = nextFloat(s);
    out.push(v);
    s = ns;
  }
  return out;
}

describe('rng', () => {
  it('is deterministic for a seed', () => {
    expect(run(42, 20)).toEqual(run(42, 20));
  });
  it('differs between seeds', () => {
    expect(run(1, 5)).not.toEqual(run(2, 5));
  });
  it('stays in [0,1)', () => {
    for (const v of run(7, 500)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('does not mutate state and resumes from a JSON round trip', () => {
    const s = createRng(99);
    const [a, s2] = nextFloat(s);
    expect(nextFloat(s)[0]).toBe(a);
    const restored = JSON.parse(JSON.stringify(s2)) as number;
    expect(nextFloat(restored)).toEqual(nextFloat(s2));
  });
  it('nextInt covers inclusive range', () => {
    let s = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const [v, ns] = nextInt(s, 1, 6);
      seen.add(v);
      s = ns;
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('rollPercent respects 0 and 100', () => {
    let s = createRng(3);
    for (let i = 0; i < 100; i++) {
      const [no, s1] = rollPercent(s, 0);
      const [yes, s2] = rollPercent(s1, 100);
      expect(no).toBe(false);
      expect(yes).toBe(true);
      s = s2;
    }
  });
});

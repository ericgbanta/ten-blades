import { describe, expect, it } from 'vitest';
import { createRng, nextFloat } from '../src/core/rng';
import {
  DEFAULT_LOOK,
  LOOKS,
  LOOK_KEYS,
  hexToRgb,
  isLook,
  lookKey,
  lookOptions,
  lookProblem,
  paletteOf,
  portraitLayerIds,
  poseLayerIds,
  randomLook,
  tokenLayerIds,
  type McLook,
} from '../src/art/mc/look';

const seeded = (seed: number) => {
  let s = createRng(seed);
  return () => {
    const [v, n] = nextFloat(s);
    s = n;
    return v;
  };
};

describe('looks data', () => {
  it('has the options the design asks for', () => {
    expect(LOOKS.bodies.map((b) => b.id)).toEqual(['lean', 'broad']);
    expect(LOOKS.skins).toHaveLength(6);
    expect(LOOKS.hairStyles).toHaveLength(8);
    expect(LOOKS.hairColors).toHaveLength(10);
    expect(LOOKS.eyes).toHaveLength(3);
    expect(LOOKS.scars.map((s) => s.id)).toContain('none');
    expect(LOOKS.scars).toHaveLength(7);
    expect(LOOKS.accents).toHaveLength(6);
  });

  it('gives every color option a base and a shadow, and unique ids per field', () => {
    for (const list of [LOOKS.skins, LOOKS.hairColors, LOOKS.accents]) {
      for (const c of list) {
        expect(c.base).toMatch(/^#[0-9a-f]{6}$/);
        expect(c.shadow).toMatch(/^#[0-9a-f]{6}$/);
        // the shadow is darker than the base
        const lum = (h: string) => hexToRgb(h).reduce((a, v) => a + v, 0);
        expect(lum(c.shadow)).toBeLessThan(lum(c.base));
      }
    }
    for (const k of LOOK_KEYS) {
      const ids = lookOptions(k).map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('has a valid default look', () => {
    expect(lookProblem(DEFAULT_LOOK)).toBeNull();
  });
});

describe('look validation', () => {
  const good: McLook = { body: 'broad', skin: 'deep', hairStyle: 'curls', hairColor: 'white', eyes: 'narrow', scar: 'burn', accent: 'bone' };

  it('accepts every option of every field', () => {
    expect(isLook(good)).toBe(true);
    for (const k of LOOK_KEYS) for (const o of lookOptions(k)) expect(lookProblem({ ...good, [k]: o.id })).toBeNull();
  });

  it('names the field and the problem', () => {
    expect(lookProblem(null)).toBe('expected an object');
    expect(lookProblem([])).toBe('expected an object');
    expect(lookProblem({ ...good, skin: 'green' })).toBe('skin: unknown skin tone "green"');
    expect(lookProblem({ ...good, eyes: 3 })).toBe('eyes: expected text');
    const noAccent: Partial<McLook> = { ...good };
    delete noAccent.accent;
    expect(lookProblem(noAccent)).toBe('accent: missing');
    expect(lookProblem({ ...good, hat: 'tricorn' })).toBe('hat: unknown field');
    expect(lookProblem({ ...good, hairColor: 'crimson' })).toBe('hairColor: unknown hair color "crimson"');
    expect(isLook({ ...good, scar: '' })).toBe(false);
  });
});

describe('palette and keys', () => {
  it('looks up the palette entries of a look', () => {
    const p = paletteOf({ ...DEFAULT_LOOK, skin: 'porcelain', hairColor: 'teal', accent: 'violet' });
    expect([p.skin.base, p.skin.shadow]).toEqual(['#f3d5c3', '#dcae9a']);
    expect(p.hair.id).toBe('teal');
    expect(p.accent.name).toBe('Violet');
    expect(() => paletteOf({ ...DEFAULT_LOOK, skin: 'green' })).toThrow(/skin tone green/);
  });

  it('converts hex colors', () => {
    expect(hexToRgb('#8f1f24')).toEqual([143, 31, 36]);
    expect(() => hexToRgb('red')).toThrow();
  });

  it('gives one cache key per look', () => {
    expect(lookKey(DEFAULT_LOOK)).toBe('lean|tan|crop|darkbrown|almond|none|crimson');
    expect(lookKey({ ...DEFAULT_LOOK, scar: 'nose' })).not.toBe(lookKey(DEFAULT_LOOK));
  });

  it('lists the layers of each picture, bottom first', () => {
    const look: McLook = { ...DEFAULT_LOOK, body: 'broad', eyes: 'round', scar: 'cheek', hairStyle: 'bob' };
    expect(portraitLayerIds(look, 'angry')).toEqual(['mc.broad.bust', 'mc.broad.face.round.angry', 'mc.broad.scar.cheek', 'mc.broad.hair.bob.portrait']);
    expect(portraitLayerIds({ ...look, scar: 'none' }, 'smile')).toEqual(['mc.broad.bust', 'mc.broad.face.round.smile', 'mc.broad.hair.bob.portrait']);
    expect(tokenLayerIds(look, 'duelist')).toEqual(['mc.broad.token.duelist', 'mc.broad.hair.bob.token.duelist']);
    expect(poseLayerIds(look, 'spiritblade', 'hit')).toEqual(['mc.broad.pose.spiritblade.hit', 'mc.broad.hair.bob.pose.spiritblade.hit']);
  });
});

describe('random looks', () => {
  it('are valid, repeat for a seed and cover the options', () => {
    expect(randomLook(seeded(11))).toEqual(randomLook(seeded(11)));
    const next = seeded(3);
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < 400; i++) {
      const look = randomLook(next);
      expect(lookProblem(look)).toBeNull();
      for (const k of LOOK_KEYS) {
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k)!.add(look[k]);
      }
    }
    for (const k of LOOK_KEYS) expect(seen.get(k)!.size).toBe(lookOptions(k).length);
  });
});

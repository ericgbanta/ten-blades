import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, hexToRgb, type McLook } from '../src/art/mc/look';
import { REGION, buildLut, recolorPixels } from '../src/art/mc/recolor';
import fixture from './fixtures/mc-recolor.json';

/** One pixel through recolorPixels: art RGBA and data RGB in, RGBA out. */
function one(art: number[], data: number[], look: McLook): number[] {
  const out = new Uint8ClampedArray(4);
  recolorPixels(new Uint8ClampedArray(art), new Uint8ClampedArray(data), buildLut(look), out, 3);
  return [...out];
}

describe('mc recolor', () => {
  it('matches the Python build on pixels from the packed layers', () => {
    const art = new Uint8ClampedArray(fixture.pixels.flatMap((p) => p.art));
    const data = new Uint8ClampedArray(fixture.pixels.flatMap((p) => p.data));
    const codes = new Set(fixture.pixels.map((p) => Math.round(p.data[2]! / 64)));
    expect([...codes].sort()).toEqual([0, 1, 2, 3, 4]);
    for (const c of fixture.cases) {
      const out = new Uint8ClampedArray(art.length);
      recolorPixels(art, data, buildLut(c.look as McLook), out, 3);
      let worst = 0;
      c.expected.forEach((px, i) => px.forEach((v, ch) => (worst = Math.max(worst, Math.abs(v - out[i * 4 + ch]!)))));
      expect(worst).toBeLessThanOrEqual(1);
    }
  });

  it('leaves neutral pixels and empty pixels alone', () => {
    expect(one([40, 41, 42, 255], [0, 0, 0], DEFAULT_LOOK)).toEqual([40, 41, 42, 255]);
    expect(one([0, 0, 0, 0], [255, 100, 64], DEFAULT_LOOK)).toEqual([0, 0, 0, 0]);
  });

  it('paints a full region pixel at the base tone with the palette base color', () => {
    const uZero = Math.round((0 - -0.6) / 1.85 * 255);
    for (const skin of ['porcelain', 'deep']) {
      const look = { ...DEFAULT_LOOK, skin };
      const base = hexToRgb(skin === 'porcelain' ? '#f3d5c3' : '#4f3222');
      const px = one([10, 10, 10, 255], [255, uZero, REGION.skin * 64], look);
      px.slice(0, 3).forEach((v, i) => expect(Math.abs(v - base[i]!)).toBeLessThanOrEqual(2));
    }
  });

  it('keeps the ink part of an edge pixel: half membership is half way to the ink', () => {
    const uOne = Math.round((1 - -0.6) / 1.85 * 255);
    const look = { ...DEFAULT_LOOK, hairColor: 'white' };
    const shadow = hexToRgb('#c2bdb4');
    const px = one([0, 0, 0, 200], [128, uOne, REGION.hair * 64], look);
    px.slice(0, 3).forEach((v, i) => expect(Math.abs(v - (shadow[i]! * 128) / 255)).toBeLessThanOrEqual(2));
    expect(px[3]).toBe(200);
  });

  it('draws the stubble film as a dark shade of the hair color', () => {
    const look = { ...DEFAULT_LOOK, hairColor: 'blond' };
    const px = one([0, 0, 0, 90], [255, 0, REGION.film * 64], look);
    expect(px).toEqual([...hexToRgb('#b18a48').map((v) => Math.round(v * 0.55)), 90]);
  });

  it('builds one table per palette, with lighter tones below u = 0 and darker above 1', () => {
    const lut = buildLut(DEFAULT_LOOK);
    const at = (code: number, g: number) => lut[(code * 256 + g) * 3]!;
    expect(at(REGION.accent, 0)).toBeGreaterThan(at(REGION.accent, 83));
    expect(at(REGION.accent, 255)).toBeLessThan(at(REGION.accent, 221));
  });
});

// The per-pixel recolor of a packed MC layer (format "mc1", written by tools/art/mc_build.py). Pure: works on plain
// arrays, so it runs under Vitest. tests/mc-recolor.test.ts checks it against pixels the Python build decoded.
//
// A layer is two images of the same size. The art image's RGB is the neutral part N of each pixel (ink, cloth,
// steel) and its alpha the pixel's alpha. The data image holds, per pixel: R = t, how much of the pixel belongs to
// its key region (0..255); G = u, the tone within that region, stored as (u - uMin) / (uMax - uMin) * 255, where
// u = 0 is the base color, 1 the shadow, below 0 lighter and above 1 darker; B = the region code times 64
// (0 none, 1 skin, 2 hair, 3 accent, 4 stubble film). The recolored pixel is
//     out = N + t * (LUT[region][G] - N)
// with LUT[region][g] the palette tone at that u. Ink and neutral cloth never change; shading shapes stay as drawn.

import { LOOKS, hexToRgb, paletteOf, type McLook, type RecolorConstants } from './look';

/** Region codes in the data image's blue channel (divided by 64). */
export const REGION = { none: 0, skin: 1, hair: 2, accent: 3, film: 4 } as const;

/** 5 regions x 256 tones x RGB, as floats 0..255. Region 0 is unused. */
export type RecolorLut = Float64Array;

/** The tone ramp of one palette entry: base at u = 0, shadow at u = 1, gentler toward light below 0. */
function ramp(lut: Float64Array, code: number, base: readonly number[], shadow: readonly number[], c: RecolorConstants): void {
  for (let g = 0; g < 256; g++) {
    const u = c.uMin + (g / 255) * (c.uMax - c.uMin);
    const k = u < 0 ? u * c.highlightSlope : u;
    for (let ch = 0; ch < 3; ch++) {
      const v = base[ch]! / 255 + (shadow[ch]! / 255 - base[ch]! / 255) * k;
      lut[(code * 256 + g) * 3 + ch] = Math.min(1, Math.max(0, v)) * 255;
    }
  }
}

/** The lookup table for a look's skin, hair and accent colors (and the stubble film, a dark shade of the hair). */
export function buildLut(look: McLook, constants: RecolorConstants = LOOKS.recolor): RecolorLut {
  const p = paletteOf(look);
  const lut = new Float64Array(5 * 256 * 3);
  ramp(lut, REGION.skin, hexToRgb(p.skin.base), hexToRgb(p.skin.shadow), constants);
  ramp(lut, REGION.hair, hexToRgb(p.hair.base), hexToRgb(p.hair.shadow), constants);
  ramp(lut, REGION.accent, hexToRgb(p.accent.base), hexToRgb(p.accent.shadow), constants);
  const film = hexToRgb(p.hair.shadow).map((v) => v * constants.filmShade);
  for (let g = 0; g < 256; g++) for (let ch = 0; ch < 3; ch++) lut[(REGION.film * 256 + g) * 3 + ch] = film[ch]!;
  return lut;
}

/**
 * Recolor `art` (RGBA) with `data` (RGBA or RGB, `dataStride` bytes per pixel) into `out` (RGBA, may be `art`).
 * All three cover the same pixels.
 */
export function recolorPixels(
  art: Uint8ClampedArray,
  data: Uint8ClampedArray,
  lut: RecolorLut,
  out: Uint8ClampedArray,
  dataStride: 3 | 4 = 4,
): void {
  const n = art.length >> 2;
  for (let i = 0, j = 0; i < n; i++, j += dataStride) {
    const o = i << 2;
    const a = art[o + 3]!;
    const code = Math.min(4, Math.round(data[j + 2]! / 64));
    if (a === 0 || code === 0) {
      out[o] = art[o]!;
      out[o + 1] = art[o + 1]!;
      out[o + 2] = art[o + 2]!;
      out[o + 3] = a;
      continue;
    }
    const t = data[j]! / 255;
    const l = (code * 256 + data[j + 1]!) * 3;
    const r = art[o]!;
    const g = art[o + 1]!;
    const b = art[o + 2]!;
    // Uint8ClampedArray rounds half to even; the Python reference rounds the same way (numpy.round).
    out[o] = r + t * (lut[l]! - r);
    out[o + 1] = g + t * (lut[l + 1]! - g);
    out[o + 2] = b + t * (lut[l + 2]! - b);
    out[o + 3] = a;
  }
}

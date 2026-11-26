// Builds the main character's pictures in the browser from the packed layers: loads each layer once, recolors it
// for the look (recolor.ts) and stacks the layers on a canvas. Results are cached by look, so drawing the same look
// again is free. A missing layer is skipped, and a missing base draws a plain placeholder shape, so the game never
// waits on art. Plain TypeScript and canvas; no Phaser.

import { artFileUrl, imageMeta } from '../manifest';
import { buildLut, recolorPixels, type RecolorLut } from './recolor';
import {
  hexToRgb,
  lookKey,
  paletteOf,
  poseLayerIds,
  portraitLayerIds,
  tokenLayerIds,
  type McExpression,
  type McLook,
  type McPose,
} from './look';

/** Canvas sizes, as packed by tools/art/mc_build.py (and tools/art/pack.py for the other characters). */
export const MC_CANVAS = {
  portrait: { w: 384, h: 384 },
  token: { w: 192, h: 192 },
  pose: { w: 512, h: 384 },
} as const;

type Kind = keyof typeof MC_CANVAS;

interface RawLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  art: Uint8ClampedArray;
  data: Uint8ClampedArray;
}

const layers = new Map<string, Promise<RawLayer | null>>();
const composed = new Map<string, Promise<HTMLCanvasElement>>();
const luts = new Map<string, RecolorLut>();
/** Composed pictures kept in memory; the oldest is dropped past this. */
const COMPOSED_MAX = 64;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function decode(url: string): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    // No color management and no premultiplying: the data image holds numbers, not colors.
    return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function pixels(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

/** One packed layer's art and data pixels, loaded once. Null when the layer is not in the manifest or fails. */
function loadLayer(id: string): Promise<RawLayer | null> {
  let p = layers.get(id);
  if (!p) {
    p = (async () => {
      const meta = imageMeta(id);
      const info = meta?.layer;
      if (!meta || !info) return null;
      const artUrl = artFileUrl(meta.path);
      const dataUrl = artFileUrl(info.data);
      if (!artUrl || !dataUrl) return null;
      try {
        const [a, d] = await Promise.all([decode(artUrl), decode(dataUrl)]);
        const [x, y, w, h] = info.rect;
        const layer = { x, y, w, h, art: pixels(a, w, h), data: pixels(d, w, h) };
        if ('close' in a) a.close();
        if ('close' in d) d.close();
        return layer;
      } catch (e) {
        console.warn(`MC layer ${id} did not load`, e);
        return null;
      }
    })();
    layers.set(id, p);
  }
  return p;
}

function lutFor(look: McLook): RecolorLut {
  const key = `${look.skin}|${look.hairColor}|${look.accent}`;
  let lut = luts.get(key);
  if (!lut) {
    lut = buildLut(look);
    luts.set(key, lut);
  }
  return lut;
}

/** A plain stand-in when the base layer is missing: a head and shoulders in the look's colors. */
function placeholder(ctx: CanvasRenderingContext2D, kind: Kind, look: McLook): void {
  const { w, h } = MC_CANVAS[kind];
  const pal = paletteOf(look);
  const rgb = (hex: string) => `rgb(${hexToRgb(hex).join(',')})`;
  const cx = kind === 'pose' ? 192 : w / 2;
  const scale = kind === 'portrait' ? 1 : kind === 'token' ? 0.5 : 0.62;
  const top = kind === 'pose' ? 120 : h * 0.18;
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#2a2830';
  ctx.strokeStyle = '#0c0a0f';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-150, 330);
  ctx.quadraticCurveTo(-140, 170, 0, 160);
  ctx.quadraticCurveTo(140, 170, 150, 330);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgb(pal.accent.base);
  ctx.fillRect(-70, 160, 140, 34);
  ctx.fillStyle = rgb(pal.skin.base);
  ctx.beginPath();
  ctx.arc(0, 80, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgb(pal.hair.base);
  ctx.beginPath();
  ctx.arc(0, 66, 76, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  ctx.restore();
}

/**
 * Source-over of one recolored layer (straight alpha) onto the picture's pixels. Done on plain arrays on purpose:
 * mobile Safari can hand drawImage a stale copy of a canvas that was just filled with putImageData, which drew
 * layers with the previous layer's pixels (a doubled face in the creator).
 */
function blendLayer(dst: Uint8ClampedArray, dw: number, dh: number, src: Uint8ClampedArray, l: RawLayer): void {
  for (let y = 0; y < l.h; y++) {
    const dy = l.y + y;
    if (dy < 0 || dy >= dh) continue;
    for (let x = 0; x < l.w; x++) {
      const dx = l.x + x;
      if (dx < 0 || dx >= dw) continue;
      const s = (y * l.w + x) << 2;
      const sa = src[s + 3]! / 255;
      if (sa === 0) continue;
      const d = (dy * dw + dx) << 2;
      const da = (dst[d + 3]! / 255) * (1 - sa);
      const oa = sa + da;
      dst[d] = (src[s]! * sa + dst[d]! * da) / oa;
      dst[d + 1] = (src[s + 1]! * sa + dst[d + 1]! * da) / oa;
      dst[d + 2] = (src[s + 2]! * sa + dst[d + 2]! * da) / oa;
      dst[d + 3] = oa * 255;
    }
  }
}

async function composeLayers(kind: Kind, ids: string[], look: McLook): Promise<HTMLCanvasElement> {
  const loaded = await Promise.all(ids.map(loadLayer));
  const { w, h } = MC_CANVAS[kind];
  const out = canvas(w, h);
  const ctx = out.getContext('2d')!;
  if (!loaded[0]) placeholder(ctx, kind, look);
  const lut = lutFor(look);
  const picture = ctx.getImageData(0, 0, w, h);
  for (const l of loaded) {
    if (!l) continue;
    const recolored = new Uint8ClampedArray(l.w * l.h * 4);
    recolorPixels(l.art, l.data, lut, recolored);
    blendLayer(picture.data, w, h, recolored, l);
  }
  ctx.putImageData(picture, 0, 0);
  return out;
}

function cached(key: string, make: () => Promise<HTMLCanvasElement>): Promise<HTMLCanvasElement> {
  let p = composed.get(key);
  if (p) {
    // keep recently used pictures at the back of the eviction order
    composed.delete(key);
    composed.set(key, p);
    return p;
  }
  p = make();
  composed.set(key, p);
  p.catch(() => composed.delete(key));
  while (composed.size > COMPOSED_MAX) composed.delete(composed.keys().next().value!);
  return p;
}

/**
 * The dialogue portrait (384 x 384, bottom aligned like the other portraits) for a look and expression. The
 * returned canvas is shared by every caller with the same look: draw it, do not change it.
 */
export function composeMcPortrait(look: McLook, expr: McExpression = 'neutral'): Promise<HTMLCanvasElement> {
  return cached(`portrait|${lookKey(look)}|${expr}`, () => composeLayers('portrait', portraitLayerIds(look, expr), look));
}

/** The map token (192 x 192, laid out like the packed class tokens) for a look and combat style. */
export function composeMcToken(look: McLook, style: string): Promise<HTMLCanvasElement> {
  return cached(`token|${lookKey(look)}|${style}`, () => composeLayers('token', tokenLayerIds(look, style), look));
}

/** One battle pose (512 x 384, feet on y 360 at x 192, like the other battle poses) for a look and style. */
export function composeMcPose(look: McLook, style: string, pose: McPose): Promise<HTMLCanvasElement> {
  return cached(`pose|${lookKey(look)}|${style}|${pose}`, () => composeLayers('pose', poseLayerIds(look, style, pose), look));
}

/** Forget composed pictures (the loaded layers stay). For timing a fresh compose. */
export function clearComposedMc(): void {
  composed.clear();
}

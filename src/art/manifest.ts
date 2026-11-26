import assets from './assets.json';

/** Where an image sits on its canvas, in canvas pixels: [x, y, width, height] of the visible art. */
export type Box = [number, number, number, number];

/** One image in `assets.json`. `path` is relative to `src/art`. */
export interface ArtEntry {
  path: string;
  width: number;
  height: number;
  /** Tight box around the visible pixels. */
  bbox?: Box;
  /** Battle poses only: the y of the feet baseline, the same on every pose canvas. */
  groundY?: number;
  /** Battle poses only: the x of the character's feet center, the same on every pose canvas. */
  anchorX?: number;
  /** Battle poses only: source to canvas scale (the idle body is drawn about 240 px tall). */
  scale?: number;
  /** Main character layers only (see src/art/mc): where the files sit on the canvas and the data file. */
  layer?: McLayerInfo;
}

/** A packed main character layer: `path` is the art, `data` the recolor data, both covering `rect` of the canvas. */
export interface McLayerInfo {
  encoding: 'mc1';
  rect: Box;
  data: string;
}

export interface Manifest {
  images: Record<string, ArtEntry | string>;
}

const manifest: Manifest = assets as unknown as Manifest;

// Vite bundles every packed WebP and hands back its final (hashed, base-prefixed) URL, keyed by './<path>'.
const urls = import.meta.glob('./**/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function entryOf(id: string): ArtEntry | undefined {
  const e = manifest.images[id];
  if (!e) return undefined;
  return typeof e === 'string' ? { path: e, width: 0, height: 0 } : e;
}

/** Resolve an image id to a URL, or undefined when the art is missing (draw a placeholder). */
export function imageUrl(id: string): string | undefined {
  const e = entryOf(id);
  if (!e) return undefined;
  return artFileUrl(e.path);
}

/** URL of any packed file by its path relative to src/art, or undefined when it is not bundled. */
export function artFileUrl(path: string): string | undefined {
  return urls[`./${path.replace(/^\.?\//, '')}`];
}

/** Size and placement data for an image id, or undefined when it is not in the manifest. */
export function imageMeta(id: string): ArtEntry | undefined {
  return entryOf(id);
}

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artFileUrl, imageMeta, imageUrl } from '../src/art/manifest';
import { LOOKS, MC_POSES, poseLayerIds, portraitLayerIds, tokenLayerIds, type McLook } from '../src/art/mc/look';
import terrain from '../src/data/terrain.json';

const root = join(__dirname, '..', 'src', 'art');
const images = JSON.parse(readFileSync(join(root, 'assets.json'), 'utf8')).images as Record<string, Record<string, unknown>>;
const ids = Object.keys(images);

describe('art manifest', () => {
  it('lists images', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it('keeps its ids sorted', () => {
    expect(ids).toEqual([...ids].sort());
  });

  it.each(ids)('%s is well formed and its file exists', (id) => {
    expect(id).toMatch(/^(token\.[a-z_]+|tile\.[a-z_]+|backdrop\.[a-z_]+|portrait\.[a-z_]+\.[a-z]+|battle\.[a-z_]+\.[a-z]+|mc\.[a-z]+\.[a-z.]+)$/);
    const e = images[id] as { path: string; width: number; height: number; bbox: number[]; groundY?: number; anchorX?: number };
    expect(existsSync(join(root, e.path))).toBe(true);
    if (id.startsWith('mc.')) {
      const layer = (e as { layer?: { encoding: string; rect: number[]; data: string } }).layer;
      expect(layer?.encoding).toBe('mc1');
      expect(existsSync(join(root, layer!.data))).toBe(true);
      const [lx, ly, lw, lh] = layer!.rect;
      expect(lx! >= 0 && ly! >= 0 && lx! + lw! <= e.width && ly! + lh! <= e.height).toBe(true);
      expect(artFileUrl(layer!.data)).toBeTruthy();
    }
    expect(e.width).toBeGreaterThan(0);
    expect(e.height).toBeGreaterThan(0);
    const [x, y, w, h] = e.bbox;
    expect(x! >= 0 && y! >= 0 && x! + w! <= e.width && y! + h! <= e.height).toBe(true);
    if (id.startsWith('battle.')) {
      expect(e.groundY).toBeGreaterThan(0);
      expect(e.anchorX).toBeGreaterThan(0);
    }
    expect(imageMeta(id)?.path).toBe(e.path);
    expect(imageUrl(id)).toBeTruthy();
  });

  it('gives all four poses of a character one canvas and one ground line', () => {
    for (const c of ['stranger', 'archer']) {
      const poses = ['idle', 'windup', 'strike', 'hit'].map((p) => images[`battle.${c}.${p}`]!);
      for (const p of poses) {
        expect([p.width, p.height, p.groundY, p.anchorX]).toEqual([poses[0]!.width, poses[0]!.height, poses[0]!.groundY, poses[0]!.anchorX]);
      }
    }
  });

  it.each(Object.keys(terrain))('has a square tile for the terrain %s', (t) => {
    const e = images[`tile.${t}`] as { width: number; height: number } | undefined;
    expect(e).toBeDefined();
    expect(e!.width).toBe(e!.height);
  });

  it('has every main character layer a look can ask for', () => {
    const missing: string[] = [];
    const want = (ids: string[]) => ids.forEach((i) => images[i] || missing.push(i));
    for (const body of LOOKS.bodies) {
      for (const hair of LOOKS.hairStyles) {
        for (const eyes of LOOKS.eyes) {
          for (const scar of LOOKS.scars) {
            const look: McLook = { ...LOOKS.default, body: body.id, hairStyle: hair.id, eyes: eyes.id, scar: scar.id };
            for (const expr of LOOKS.expressions) want(portraitLayerIds(look, expr));
          }
        }
        const look: McLook = { ...LOOKS.default, body: body.id, hairStyle: hair.id };
        for (const style of ['vanguard', 'duelist', 'spiritblade']) {
          want(tokenLayerIds(look, style));
          for (const pose of MC_POSES) want(poseLayerIds(look, style, pose));
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('gives every main character pose the shared battle canvas and ground line', () => {
    for (const [id, e] of Object.entries(images)) {
      if (!/^mc\.[a-z]+\.(hair\.[a-z]+\.)?pose\./.test(id)) continue;
      expect([e.width, e.height, e.groundY, e.anchorX]).toEqual([512, 384, 360, 192]);
    }
  });

  it('returns undefined for a missing id', () => {
    expect(imageUrl('token.nobody')).toBeUndefined();
  });
});

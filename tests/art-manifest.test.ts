import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageMeta, imageUrl } from '../src/art/manifest';

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
    expect(id).toMatch(/^(token\.[a-z_]+|portrait\.[a-z_]+\.[a-z]+|battle\.[a-z_]+\.[a-z]+)$/);
    const e = images[id] as { path: string; width: number; height: number; bbox: number[]; groundY?: number; anchorX?: number };
    expect(existsSync(join(root, e.path))).toBe(true);
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

  it('returns undefined for a missing id', () => {
    expect(imageUrl('token.nobody')).toBeUndefined();
  });
});

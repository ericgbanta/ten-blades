import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E, N, S, W, crossingRunsEastWest, groundKeys, hash01, links, pickVariants, planGround, roadOps, shoreOps, wallOps, type GroundInput } from '../src/game/groundPlan';
import { gameData } from '../src/data';

const images = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'art', 'assets.json'), 'utf8')).images as Record<string, unknown>;
const has = (k: string) => k in images;
const CHARS: Record<string, string> = { '.': 'plain', '=': 'road', '#': 'wall', '~': 'water', B: 'bridge', f: 'ford', T: 'fort', F: 'forest', V: 'village', c: 'canal', ',': 'cobble', G: 'gate', X: 'building' };

function grid(rows: string[], mapId = 'test'): GroundInput {
  return { mapId, width: rows[0]!.length, height: rows.length, terrain: rows.join('').split('').map((c) => CHARS[c]!) };
}
const keys = (ops: { key: string; rot: number }[]) => ops.map((o) => `${o.key.split('.').slice(1).join('.')}@${o.rot}`);

describe('road and wall links', () => {
  const g = grid([
    '.=...', // (1,0) leaves the map to the north
    '.===.', // (1,1) corner N... (2,1) T, (3,1) end
    '.=.#.',
    '.=.#T',
    '~B~#.',
  ]);
  it('joins roads, crossings along their run and the map edge', () => {
    expect(links(g, 1, 0)).toBe(N | S);
    expect(links(g, 1, 1)).toBe(N | E | S);
    expect(links(g, 2, 1)).toBe(E | W);
    expect(links(g, 3, 1)).toBe(W);
    expect(links(g, 1, 3)).toBe(N | S); // the bridge below runs north to south
    expect(crossingRunsEastWest(g, 1, 4)).toBe(false);
  });
  it('joins walls to walls and forts, and to the edge where a wall runs on', () => {
    expect(links(g, 3, 2)).toBe(S);
    expect(links(g, 3, 3)).toBe(N | E | S);
    expect(links(g, 3, 4)).toBe(N | S);
  });
});

describe('road pieces', () => {
  it('straight runs use the whole straight, turned for north to south', () => {
    expect(keys(roadOps(E | W))).toEqual(['road.straight@0']);
    expect(keys(roadOps(N | S))).toEqual(['road.straight@1']);
  });
  it('corners, T junctions, crossings and dead ends use arms, the hub and lips on the closed sides', () => {
    expect(keys(roadOps(N | E))).toEqual(['road.arm@3', 'road.arm@0', 'road.hub@0', 'road.lip@2', 'road.lip@3']);
    expect(keys(roadOps(N | E | W))).toEqual(['road.arm@3', 'road.arm@0', 'road.arm@2', 'road.hub@0', 'road.lip@2']);
    expect(keys(roadOps(N | E | S | W))).toEqual(['road.arm@3', 'road.arm@0', 'road.arm@1', 'road.arm@2', 'road.hub@0']);
    expect(keys(roadOps(S))).toEqual(['road.arm@1', 'road.hub@0', 'road.lip@0', 'road.lip@1', 'road.lip@3']);
  });
});

describe('wall pieces', () => {
  it('a straight east to west wall has no post; every other shape gets one', () => {
    expect(keys(wallOps(E | W))).toEqual(['wall.west@0', 'wall.east@0']);
    expect(keys(wallOps(N | E))).toEqual(['wall.north@0', 'wall.east@0', 'wall.post@0']);
    expect(keys(wallOps(S))).toEqual(['wall.south@0', 'wall.post@0']);
    expect(keys(wallOps(N | S | E | W))).toEqual(['wall.north@0', 'wall.west@0', 'wall.east@0', 'wall.south@0', 'wall.post@0']);
  });
});

describe('shores', () => {
  it('a one tile wide river gets a bank on both sides', () => {
    const g = grid(['...', '~~~', '...']);
    expect(keys(shoreOps(g, 1, 1))).toEqual(['shore.bank@0', 'shore.bank@2', 'shore.land@0', 'shore.land@2']);
  });
  it('a pond corner gets two banks and no corner piece; off the map counts as water', () => {
    const g = grid(['...', '.~~', '.~~']);
    expect(keys(shoreOps(g, 1, 1))).toEqual(['shore.bank@0', 'shore.bank@3', 'shore.land@0', 'shore.land@3']);
    expect(keys(shoreOps(g, 2, 2))).toEqual([]);
  });
  it('land only on a diagonal gets the small inner corner', () => {
    const g = grid(['~~~', '~~~', '~~.']);
    expect(keys(shoreOps(g, 1, 1))).toEqual(['shore.inner@2']);
  });
  it('bridges and fords count as water for the banks and turn across the river', () => {
    const g = grid(['.~.', '.B.', '.f.', '.~.']);
    const plan = planGround(g, has);
    expect(keys(plan[4]!.ops)).toEqual(['water@0', 'shore.bank@1', 'shore.bank@3', 'shore.land@1', 'shore.land@3', 'bridge.deck@0']);
    expect(keys(plan[7]!.ops)).toEqual(['water@0', 'shore.bank@1', 'shore.bank@3', 'shore.land@1', 'shore.land@3', 'ford.deck@0']);
  });
});

describe('variants', () => {
  const g = grid(Array.from({ length: 12 }, () => '.'.repeat(12)), 'prologue');
  it('are stable for a map and change with the map id', () => {
    expect(pickVariants(g, has)).toEqual(pickVariants(g, has));
    expect(pickVariants({ ...g, mapId: 'other' }, has)).not.toEqual(pickVariants(g, has));
    expect(hash01('a')).toBe(hash01('a'));
  });
  it('keep plain mostly the quiet base and never put an accent next to the same accent', () => {
    const v = pickVariants(g, has);
    const base = v.filter((n) => n === 1).length;
    expect(base / v.length).toBeGreaterThan(0.6);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const n = v[y * 12 + x]!;
        if (n === 1) continue;
        if (x > 0) expect(v[y * 12 + x - 1]).not.toBe(n);
        if (y > 0) expect(v[(y - 1) * 12 + x]).not.toBe(n);
      }
    }
  });
  it('mix forests freely without a 2 by 2 block of one variant', () => {
    const f = grid(Array.from({ length: 8 }, () => 'F'.repeat(8)));
    const v = pickVariants(f, has);
    for (let y = 1; y < 8; y++) {
      for (let x = 1; x < 8; x++) {
        const n = v[y * 8 + x]!;
        expect(n === v[y * 8 + x - 1] && n === v[(y - 1) * 8 + x] && n === v[(y - 1) * 8 + x - 1]).toBe(false);
      }
    }
    expect(new Set(v).size).toBe(3);
  });
});

describe('town pieces', () => {
  it('walls join gates and houses', () => {
    expect(links(grid(['#G#']), 0, 0)).toBe(E | W);
    expect(links(grid([',,,', 'X#X', ',,,']), 1, 1)).toBe(E | W);
  });
  it('a bridge over a canal is the canal tile with the planks turned north to south; over a river it keeps its banks', () => {
    const g = grid([',,,', 'cBc', ',,,']);
    expect(keys(planGround(g, has)[4]!.ops)).toEqual(['canal@0', 'bridge.deck@1']);
    const river = grid(['...', '~B~', '...']);
    expect(keys(planGround(river, has)[4]!.ops)[0]).toBe('water@0');
    expect(groundKeys(g)).toContain('tile.canal');
  });
});

describe('ground plan', () => {
  it('falls back to the single tile, then to the coded placeholder, when art is missing', () => {
    const g = grid(['.=#~']);
    const none = planGround(g, () => false);
    expect(none.every((c) => c.placeholder && c.ops.length === 0)).toBe(true);
    const tilesOnly = planGround(g, (k) => /^tile\.[a-z]+$/.test(k));
    expect(tilesOnly.map((c) => c.ops.map((o) => o.key))).toEqual([['tile.plain'], ['tile.road'], ['tile.wall'], ['tile.water']]);
  });
  it('asks only for images the manifest has on every shipped map', () => {
    for (const m of Object.values(gameData.maps)) {
      const g: GroundInput = { mapId: m.id, width: m.width, height: m.height, terrain: m.tiles.join('').split('').map((c) => m.legend[c]!) };
      for (const k of groundKeys(g)) if (k.startsWith('piece.') || /^tile\.[a-z]+$/.test(k)) expect(has(k), k).toBe(true);
      for (const c of planGround(g, has)) {
        expect(c.placeholder).toBe(false);
        for (const o of c.ops) expect(has(o.key), o.key).toBe(true);
      }
    }
  });
});

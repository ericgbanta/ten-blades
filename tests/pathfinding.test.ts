import { describe, expect, it } from 'vitest';
import {
  attackRange,
  attackTargets,
  attackTilesFrom,
  canMoveTo,
  distance,
  moveTiles,
  pathTo,
  reachableTiles,
  terrainAt,
  threatTiles,
  unitThreatTiles,
} from '../src/core';
import { fixtureData, makeBattle, place, pos } from './fixtures';

const data = fixtureData();
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('movement range', () => {
  const tiles = ['.....', '.F...', '..#..', '.....'];

  it('uses terrain move costs and skips walls', () => {
    const s = makeBattle(tiles, [place('a', 'fighter', 'player', 0, 0, { isLord: true })]);
    const reach = new Map(reachableTiles(s, 'a', data).map((t) => [key(t.pos), t.cost]));
    expect(reach.get('0,0')).toBe(0);
    expect(reach.get('1,1')).toBe(3); // forest costs 2
    expect(reach.get('4,0')).toBe(4);
    expect(reach.has('4,1')).toBe(false); // cost 5 > mov 4
    expect(reach.has('2,2')).toBe(false); // wall
    expect(reach.get('2,1')).toBe(3);
  });

  it('cannot pass through enemies', () => {
    const s = makeBattle(tiles, [
      place('a', 'fighter', 'player', 0, 0, { isLord: true }),
      place('e', 'fighter', 'enemy', 1, 0),
    ]);
    const reach = new Set(reachableTiles(s, 'a', data).map((t) => key(t.pos)));
    expect(reach.has('1,0')).toBe(false);
    expect(reach.has('2,0')).toBe(false); // the only cheap way is through the enemy
    expect(canMoveTo(s, 'a', pos(2, 0), data)).toBe(false);
  });

  it('passes through allies but cannot stop on them', () => {
    const s = makeBattle(tiles, [
      place('a', 'fighter', 'player', 0, 0, { isLord: true }),
      place('b', 'fighter', 'player', 1, 0),
    ]);
    const reach = reachableTiles(s, 'a', data);
    const onAlly = reach.find((t) => key(t.pos) === '1,0');
    expect(onAlly).toEqual({ pos: pos(1, 0), cost: 1, canStop: false });
    expect(reach.find((t) => key(t.pos) === '2,0')?.cost).toBe(2);
    expect(moveTiles(s, 'a', data).some((p) => key(p) === '1,0')).toBe(false);
    expect(moveTiles(s, 'a', data).some((p) => key(p) === '0,0')).toBe(true);
  });

  it('ally-team units also block enemies and let players through', () => {
    const s = makeBattle(tiles, [
      place('a', 'fighter', 'player', 0, 0, { isLord: true }),
      place('g', 'fighter', 'ally', 1, 0),
      place('e', 'fighter', 'enemy', 2, 0),
    ]);
    expect(reachableTiles(s, 'a', data).some((t) => key(t.pos) === '1,0' && !t.canStop)).toBe(true);
    expect(reachableTiles(s, 'e', data).some((t) => key(t.pos) === '1,0')).toBe(false);
  });
});

describe('paths', () => {
  it('returns the cheapest path with both ends', () => {
    const s = makeBattle(['.....', '.F...', '..#..', '.....'], [place('a', 'fighter', 'player', 0, 0, { isLord: true })]);
    const path = pathTo(s, 'a', pos(2, 1), data)!;
    expect(path[0]).toEqual(pos(0, 0));
    expect(path[path.length - 1]).toEqual(pos(2, 1));
    for (let i = 1; i < path.length; i++) expect(distance(path[i - 1]!, path[i]!)).toBe(1);
    const cost = path.slice(1).reduce((c, p) => c + (terrainAt(s, p, data).moveCost.foot ?? 99), 0);
    expect(cost).toBe(3);
    expect(path.some((p) => key(p) === '1,1')).toBe(false); // avoids the forest
  });

  it('is null for unreachable tiles and a single tile for staying', () => {
    const s = makeBattle(['.....', '.....'], [place('a', 'fighter', 'player', 0, 0, { isLord: true })]);
    expect(pathTo(s, 'a', pos(4, 1), data)).toBeNull();
    expect(pathTo(s, 'a', pos(0, 0), data)).toEqual([pos(0, 0)]);
  });
});

describe('attack and threat ranges', () => {
  const open = ['.....', '.....', '.....', '.....', '.....'];

  it('weapon range from a tile', () => {
    const s = makeBattle(open, [
      place('m', 'mage', 'player', 2, 2, { isLord: true }),
      place('b', 'archer', 'player', 0, 0),
      place('f', 'fighter', 'player', 4, 4),
    ]);
    expect(attackTilesFrom(s, 'm', pos(2, 2), data)).toHaveLength(12); // 1 to 2
    expect(attackTilesFrom(s, 'b', pos(2, 2), data)).toHaveLength(8); // exactly 2
    expect(attackTilesFrom(s, 'f', pos(2, 2), data)).toHaveLength(4);
  });

  it('attack targets respect min range', () => {
    const s = makeBattle(open, [
      place('b', 'archer', 'player', 0, 0, { isLord: true }),
      place('e1', 'fighter', 'enemy', 1, 0),
      place('e2', 'fighter', 'enemy', 2, 0),
    ]);
    expect(attackTargets(s, 'b', pos(0, 0), data)).toEqual(['e2']);
  });

  it('attack range covers move tiles plus weapon reach', () => {
    const s = makeBattle(['.........'], [place('f', 'fighter', 'player', 0, 0, { isLord: true })]);
    const r = attackRange(s, 'f', data).map(key);
    expect(r).toContain('5,0'); // move 4, hit 1 further
    expect(r).not.toContain('6,0');
  });

  it('guard units threaten only from their guard area', () => {
    const s = makeBattle(['.........'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('g', 'fighter', 'enemy', 6, 0, { ai: { behavior: 'guard', radius: 0 } }),
      place('c', 'fighter', 'enemy', 8, 0),
    ]);
    expect(unitThreatTiles(s, 'g', data).map(key)).toEqual(['5,0', '7,0']);
    const all = threatTiles(s, data).map(key);
    // The charger passes through its guarding friend, stops as far as 4,0 and hits 3,0.
    expect(all).toContain('3,0');
    expect(all).not.toContain('2,0');
  });
});

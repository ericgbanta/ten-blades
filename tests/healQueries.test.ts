import { describe, expect, it } from 'vitest';
import { applyAction, healAmount, healRange } from '../src/core';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();

describe('healAmount', () => {
  const base = () =>
    makeBattle(['....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('h', 'healer', 'player', 1, 0),
      place('e', 'rogue', 'enemy', 3, 0),
    ]);

  it('matches what the heal action restores, capped at missing HP', () => {
    for (const hp of [1, 10, 19]) {
      const s = patchUnit(base(), 'p', { hp });
      const amount = healAmount(s, 'h', 'p', data);
      const r = applyAction(s, { type: 'heal', unitId: 'h', to: pos(1, 0), targetId: 'p' }, data);
      expect(r.events.find((e) => e.type === 'unitHealed')).toMatchObject({ amount });
    }
    expect(healAmount(patchUnit(base(), 'p', { hp: 19 }), 'h', 'p', data)).toBe(1);
  });

  it('is 0 without a staff', () => {
    expect(healAmount(patchUnit(base(), 'h', { hp: 5 }), 'p', 'h', data)).toBe(0);
  });

  it('covers staff range from every move tile, and nothing without a staff', () => {
    const s = makeBattle(['.....', '.....'], [
      place('p', 'fighter', 'player', 4, 1, { isLord: true }),
      place('h', 'healer', 'player', 0, 0),
      place('e', 'rogue', 'enemy', 4, 0),
    ]);
    const tiles = healRange(s, 'h', data);
    // The healer (mov 4, staff range 1) reaches 3,1 and 4,0 is blocked, so 4,1 is covered.
    expect(tiles).toContainEqual(pos(4, 1));
    expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(tiles.length);
    expect(healRange(s, 'p', data)).toEqual([]);
  });
});

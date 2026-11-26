import { describe, expect, it } from 'vitest';
import { applyAction, planAiAction, planUnitAction, runAiPhase, type BattleState } from '../src/core';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();
const toEnemy = (s: BattleState) => applyAction(s, { type: 'endPhase' }, data).state;

describe('charge', () => {
  it('attacks a target in reach', () => {
    const s = toEnemy(makeBattle(['......'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 4, 0)]));
    expect(planAiAction(s, data)).toEqual({ type: 'attack', unitId: 'e', to: pos(1, 0), targetId: 'p' });
  });

  it('moves toward the nearest hostile when none is in reach', () => {
    const s = toEnemy(makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0)]));
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(5, 0) });
  });

  it('paths around walls', () => {
    const tiles = ['.....', '####.', '.....'];
    const s = toEnemy(makeBattle(tiles, [place('p', 'fighter', 'player', 0, 2, { isLord: true }), place('e', 'fighter', 'enemy', 0, 0)]));
    // Straight down is walled off; the way round goes right first.
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(4, 0) });
  });

  it('prefers a kill', () => {
    let s = makeBattle(['.....', '.....'], [
      place('p1', 'fighter', 'player', 0, 0, { isLord: true }),
      place('p2', 'fighter', 'player', 2, 1),
      place('e', 'fighter', 'enemy', 1, 1, { weaponId: 'sure_axe' }),
    ]);
    s = patchUnit(s, 'p2', { hp: 3 });
    const a = planAiAction(toEnemy(s), data);
    expect(a).toMatchObject({ type: 'attack', targetId: 'p2' });
  });

  it('prefers a tile out of counter range', () => {
    const s = toEnemy(makeBattle(['.....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'archer', 'enemy', 4, 0)]));
    expect(planAiAction(s, data)).toEqual({ type: 'attack', unitId: 'e', to: pos(2, 0), targetId: 'p' });
  });

  it('is deterministic', () => {
    const s = toEnemy(makeBattle(['......', '......', '......'], [
      place('p1', 'fighter', 'player', 0, 0, { isLord: true }),
      place('p2', 'rogue', 'player', 0, 2),
      place('e1', 'fighter', 'enemy', 5, 1),
      place('e2', 'mage', 'enemy', 5, 2),
    ]));
    const a = runAiPhase(s, data);
    const b = runAiPhase(structuredClone(s), data);
    expect(b).toEqual(a);
  });
});

describe('hold', () => {
  const map = ['..........'];
  it('waits in place until a hostile is in reach', () => {
    const s = toEnemy(makeBattle(map, [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })]));
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(9, 0) });
  });

  it('attacks once something enters its range, then charges for good', () => {
    let s = makeBattle(map, [place('p', 'fighter', 'player', 4, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })]);
    s = patchUnit(s, 'p', { stats: { hp: 60, def: 20 }, hp: 60 });
    s = toEnemy(s);
    expect(planAiAction(s, data)).toEqual({ type: 'attack', unitId: 'e', to: pos(5, 0), targetId: 'p' });
    s = runAiPhase(s, data).state;
    expect(s.units.find((u) => u.id === 'e')!.ai!.active).toBe(true);
    // Put the player out of reach; an inactive hold unit would stay, the activated one follows.
    s = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data).state;
    s = patchUnit(s, 'e', { pos: pos(9, 0) });
    s = toEnemy(s);
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(5, 0) });
  });

  it('is triggered by being attacked', () => {
    let s = makeBattle(['..........'], [
      place('p', 'archer', 'player', 0, 0, { isLord: true }),
      place('e', 'fighter', 'enemy', 6, 0, { ai: { behavior: 'hold' } }),
    ]);
    s = patchUnit(s, 'e', { stats: { mov: 0 } });
    s = applyAction(s, { type: 'attack', unitId: 'p', to: pos(4, 0), targetId: 'e' }, data).state;
    expect(s.units.find((u) => u.id === 'e')!.ai!.active).toBe(true);
  });
});

describe('guard', () => {
  it('radius 0 attacks only from its tile', () => {
    const s = toEnemy(makeBattle(['......'], [place('p', 'fighter', 'player', 2, 0, { isLord: true }), place('g', 'fighter', 'enemy', 5, 0, { ai: { behavior: 'guard' } })]));
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'g', to: pos(5, 0) });
    const near = toEnemy(makeBattle(['......'], [place('p', 'fighter', 'player', 4, 0, { isLord: true }), place('g', 'fighter', 'enemy', 5, 0, { ai: { behavior: 'guard' } })]));
    expect(planAiAction(near, data)).toEqual({ type: 'attack', unitId: 'g', to: pos(5, 0), targetId: 'p' });
  });

  it('attacks within its radius and returns when pulled away', () => {
    const spec = { behavior: 'guard' as const, tile: pos(8, 0), radius: 2 };
    const s = toEnemy(makeBattle(['..........'], [place('p', 'fighter', 'player', 5, 0, { isLord: true }), place('g', 'fighter', 'enemy', 8, 0, { ai: spec })]));
    expect(planAiAction(s, data)).toEqual({ type: 'attack', unitId: 'g', to: pos(6, 0), targetId: 'p' });
    const far = toEnemy(makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('g', 'fighter', 'enemy', 2, 0, { ai: spec })]));
    // Out of its area: it does not chase the player at 0,0; it walks back toward 8,0.
    expect(planAiAction(far, data)).toEqual({ type: 'wait', unitId: 'g', to: pos(6, 0) });
  });

  it('bosses default to guarding their tile', () => {
    const s = toEnemy(makeBattle(['......'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      { kind: 'unit', id: 'boss', name: 'Boss', classId: 'fighter', team: 'enemy', level: 5, pos: pos(4, 0), isBoss: true },
    ]));
    const boss = s.units.find((u) => u.id === 'boss')!;
    expect(boss.ai).toEqual({ behavior: 'guard', guardTile: pos(4, 0), guardRadius: 0, active: false });
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'boss', to: pos(4, 0) });
  });
});

describe('healers', () => {
  it('heal the most wounded friend in reach', () => {
    let s = makeBattle(['......'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('e1', 'fighter', 'enemy', 4, 0, { ai: { behavior: 'hold' } }),
      place('h', 'healer', 'enemy', 5, 0),
      place('e2', 'fighter', 'enemy', 3, 0, { ai: { behavior: 'hold' } }),
    ]);
    s = patchUnit(s, 'e1', { hp: 15 });
    s = patchUnit(s, 'e2', { hp: 5 });
    s = toEnemy(s);
    s = applyAction(s, planAiAction(s, data)!, data).state; // e1 holds
    const heal = planAiAction(s, data);
    expect(heal).toMatchObject({ type: 'heal', unitId: 'h', targetId: 'e2' });
    const r = applyAction(s, heal!, data);
    expect(r.events).toContainEqual({ type: 'unitHealed', unitId: 'e2', sourceId: 'h', cause: 'staff', amount: 14, hpAfter: 19 });
  });
});

describe('phase stepping', () => {
  it('returns null in the player phase and endPhase when all have acted', () => {
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0)]);
    expect(planAiAction(s, data)).toBeNull();
    s = toEnemy(s);
    s = applyAction(s, planAiAction(s, data)!, data).state;
    expect(planAiAction(s, data)).toEqual({ type: 'endPhase' });
    const r = runAiPhase(s, data);
    expect(r.state.phase).toBe('player');
    expect(r.state.turn).toBe(2);
  });

  it('planUnitAction can drive player units', () => {
    const s = makeBattle(['......'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 4, 0)]);
    expect(planUnitAction(s, 'p', data, { behavior: 'charge', guardTile: null, guardRadius: 0, active: false })).toEqual({
      type: 'attack',
      unitId: 'p',
      to: pos(3, 0),
      targetId: 'e',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createBattle,
  objectiveStatus,
  partyAfterBattle,
  runAiPhase,
  turnLimitReached,
  type Action,
  type BattleState,
} from '../src/core';
import { fixtureData, makeBattle, makeMap, patchUnit, place, pos, SETUP } from './fixtures';

const data = fixtureData();
const end: Action = { type: 'endPhase' };
const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;

describe('attacker killed by the counter', () => {
  const setup = (attackerIsLord: boolean) => {
    let s = makeBattle(['....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('q', 'fighter', 'player', 3, 0),
      place('e', 'fighter', 'enemy', 2, 0, { weaponId: 'sure_axe' }),
    ]);
    const attacker = attackerIsLord ? 'p' : 'q';
    s = patchUnit(s, attacker, { hp: 1, weaponId: 'miss_axe' });
    const to = attackerIsLord ? pos(1, 0) : pos(3, 0);
    return applyAction(s, { type: 'attack', unitId: attacker, to, targetId: 'e' }, data);
  };

  it('falls, gets no unitActed and no xp, and the battle goes on', () => {
    const r = setup(false);
    expect(r.events).toContainEqual({ type: 'unitDefeated', unitId: 'q', byId: 'e' });
    expect(r.events.some((e) => e.type === 'unitActed')).toBe(false);
    expect(r.events.some((e) => e.type === 'xpGained')).toBe(false);
    expect(unit(r.state, 'q')).toMatchObject({ alive: false, hp: 0 });
    expect(r.state.result).toBe('ongoing');
  });

  it('a lord dying while attacking in the player phase loses at once', () => {
    const r = setup(true);
    expect(r.state.result).toBe('defeat');
    expect(r.events.some((e) => e.type === 'unitActed')).toBe(false);
    expect(r.events[r.events.length - 1]).toEqual({ type: 'battleEnded', result: 'defeat', fallenPlayerUnitIds: ['p'] });
  });
});

describe('heal xp', () => {
  it('a player healer gains healXp for a staff heal', () => {
    let s = makeBattle(['.....'], [
      place('h', 'healer', 'player', 0, 0, { isLord: true }),
      place('q', 'fighter', 'player', 2, 0),
      place('e', 'fighter', 'enemy', 4, 0, { ai: { behavior: 'hold' } }),
    ]);
    s = patchUnit(s, 'q', { hp: 5 });
    const r = applyAction(s, { type: 'heal', unitId: 'h', to: pos(1, 0), targetId: 'q' }, data);
    expect(r.events).toContainEqual({ type: 'unitHealed', unitId: 'q', sourceId: 'h', cause: 'staff', amount: 14, hpAfter: 19 });
    expect(r.events).toContainEqual({ type: 'xpGained', unitId: 'h', amount: data.balance.xp.healXp, xpAfter: data.balance.xp.healXp });
    expect(unit(r.state, 'h').xp).toBe(data.balance.xp.healXp);
  });
});

describe('partyAfterBattle', () => {
  it('returns survivors and fallen player units with their new level, xp and stats', () => {
    let s = makeBattle(['......'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true, weaponId: 'sure_axe' }),
      place('q', 'fighter', 'player', 4, 0, { weaponId: 'miss_axe' }),
      place('e', 'rogue', 'enemy', 1, 0),
      place('f', 'fighter', 'enemy', 5, 0, { weaponId: 'sure_axe' }),
      place('a', 'fighter', 'ally', 3, 0, { ai: { behavior: 'hold' } }),
    ], { seed: 3 });
    s = patchUnit(s, 'p', { xp: 90 });
    s = patchUnit(s, 'e', { hp: 5 });
    s = patchUnit(s, 'q', { hp: 1 });
    s = applyAction(s, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, data).state;
    s = applyAction(s, { type: 'attack', unitId: 'q', to: pos(4, 0), targetId: 'f' }, data).state;
    const p = unit(s, 'p');
    expect(p.level).toBe(2);
    const { survivors, fallen } = partyAfterBattle(s);
    expect(survivors).toEqual([
      { id: 'p', name: 'p', classId: 'fighter', level: 2, xp: p.xp, stats: p.stats, weaponId: 'sure_axe', isLord: true, inventory: ['sure_axe'] },
    ]);
    expect(fallen.map((m) => m.id)).toEqual(['q']);
    // The result is a copy, and it feeds straight into the next battle's party.
    survivors[0]!.stats.hp = 999;
    expect(unit(s, 'p').stats.hp).not.toBe(999);
    const d = fixtureData();
    d.classes.vanguard = d.classes.fighter!;
    const next = createBattle(makeMap(['...'], [{ kind: 'mc', pos: pos(0, 0) }, place('z', 'rogue', 'enemy', 2, 0)]), { ...SETUP, party: partyAfterBattle(s).survivors }, 1, d);
    expect(unit(next, 'p')).toMatchObject({ level: 2, stats: p.stats, hp: p.stats.hp });
  });
});

describe('objectiveStatus', () => {
  it('counts turns left for survive, including the current turn', () => {
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })], {
      objective: { type: 'survive', turns: 2 },
    });
    expect(objectiveStatus(s)).toEqual({ type: 'survive', turnLimit: 2, turnsLeft: 2 });
    expect(turnLimitReached(s, s.turn)).toBe(false);
    s = runAiPhase(applyAction(s, end, data).state, data).state;
    expect(objectiveStatus(s)).toEqual({ type: 'survive', turnLimit: 2, turnsLeft: 1 });
    expect(turnLimitReached(s, s.turn)).toBe(true);
  });

  it('has no limit for rout', () => {
    const s = makeBattle(['...'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 2, 0)]);
    expect(objectiveStatus(s)).toEqual({ type: 'rout', turnLimit: null, turnsLeft: null });
  });
});

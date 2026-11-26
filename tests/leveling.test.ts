import { describe, expect, it } from 'vitest';
import { applyAction, averageStats, combatXp, createRng, rollLevelUp, type BattleEvent, type Unit } from '../src/core';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();
const b = data.balance;

describe('combat xp', () => {
  it('follows the level-difference formula', () => {
    expect(combatXp(1, 1, false, false, false, b)).toBe(1); // miss
    expect(combatXp(1, 1, true, false, false, b)).toBe(10); // floor(31 / 3)
    expect(combatXp(1, 1, true, true, false, b)).toBe(30); // + 20
    expect(combatXp(1, 3, true, true, false, b)).toBe(37); // 11 + 26
    expect(combatXp(11, 1, true, true, false, b)).toBe(14); // 7 + killMin 7
    expect(combatXp(1, 1, true, true, true, b)).toBe(70); // + boss 40
    expect(combatXp(1, 1, false, true, false, b)).toBe(30); // a kill always counts as damage
    expect(combatXp(20, 1, true, false, false, b)).toBe(4); // floor(12 / 3)
    expect(combatXp(1, 20, true, true, true, b)).toBe(100); // capped
  });

  it('never drops below hitMin for a damaging hit', () => {
    const d = fixtureData();
    d.balance.xp.hitBase = 0;
    expect(combatXp(20, 1, true, false, false, d.balance)).toBe(1);
  });
});

describe('level-ups', () => {
  const unit = (classId: string, stats?: Partial<Unit['stats']>): Unit => ({
    id: 'u',
    name: 'u',
    classId,
    team: 'player',
    level: 1,
    xp: 0,
    stats: { ...data.classes[classId]!.baseStats, ...stats },
    hp: 1,
    weaponId: null,
    pos: { x: 0, y: 0 },
    acted: false,
    alive: true,
    ai: null,
    isBoss: false,
    isLord: false,
    tags: [],
    left: false,
    resolve: 0,
    devourStacks: 0,
  });

  it('is deterministic for a seed', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(rollLevelUp(unit('fighter'), createRng(seed), data)).toEqual(rollLevelUp(unit('fighter'), createRng(seed), data));
    }
    const all = new Set<string>();
    for (let seed = 0; seed < 20; seed++) all.add(JSON.stringify(rollLevelUp(unit('fighter'), createRng(seed), data)[0]));
    expect(all.size).toBeGreaterThan(1);
  });

  it('growths over 100 give a sure point plus a roll; 0 never grows', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      const [g] = rollLevelUp(unit('brute'), createRng(seed), data);
      seen.add(g.hp);
      expect(g.str).toBe(1);
      expect(g.skl).toBe(0);
      expect(g.mov).toBe(0);
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });

  it('respects stat caps', () => {
    const [g] = rollLevelUp(unit('brute', { hp: 60, str: 30 }), createRng(1), data);
    expect(g.hp).toBe(0);
    expect(g.str).toBe(0);
  });

  it('average stats add rounded growths per level', () => {
    expect(averageStats('fighter', 1, data)).toEqual(data.classes.fighter!.baseStats);
    const s = averageStats('fighter', 4, data); // +1.5 per stat -> +2 (rounded)
    expect(s.str).toBe(8);
    expect(s.mov).toBe(4);
  });
});

describe('xp in battle', () => {
  const kill = (xp: number, level = 1, seed = 1) => {
    let s = makeBattle(['...'], [place('a', 'fighter', 'player', 0, 0, { isLord: true, weaponId: 'sure_axe' }), place('d', 'rogue', 'enemy', 1, 0)], {
      seed,
    });
    s = patchUnit(s, 'a', { xp, level });
    s = patchUnit(s, 'd', { hp: 5 });
    return applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data);
  };
  const of = <T extends BattleEvent['type']>(ev: BattleEvent[], t: T) => ev.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);

  it('a kill gives xp and levels up at 100, rolling growths', () => {
    const r = kill(90);
    expect(of(r.events, 'xpGained')).toEqual([{ type: 'xpGained', unitId: 'a', amount: 30, xpAfter: 20 }]);
    const ups = of(r.events, 'levelUp');
    expect(ups).toHaveLength(1);
    expect(ups[0]!.level).toBe(2);
    const a = r.state.units.find((u) => u.id === 'a')!;
    expect(a.level).toBe(2);
    expect(a.xp).toBe(20);
    for (const k of ['hp', 'str', 'def'] as const) expect(a.stats[k]).toBe(data.classes.fighter!.baseStats[k] + ups[0]!.gains[k]);
    // The same seed rolls the same gains.
    expect(of(kill(90).events, 'levelUp')).toEqual(ups);
  });

  it('no xp at the level cap', () => {
    const r = kill(0, 20);
    expect(of(r.events, 'xpGained')).toHaveLength(0);
    expect(r.state.units.find((u) => u.id === 'a')!.xp).toBe(0);
  });

  it('defending player units gain xp, enemies never do', () => {
    let s = makeBattle(['...'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 1, 0, { weaponId: 'dagger' })]);
    s = patchUnit(s, 'p', { stats: { hp: 60 }, hp: 60 });
    s = applyAction(s, { type: 'endPhase' }, data).state;
    const r = applyAction(s, { type: 'attack', unitId: 'e', to: pos(1, 0), targetId: 'p' }, data);
    const xp = of(r.events, 'xpGained');
    expect(xp).toHaveLength(1);
    expect(xp[0]!.unitId).toBe('p');
  });
});

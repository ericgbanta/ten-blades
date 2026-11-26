// Regression tests for defects found in review of the phase 1 rules engine.
// Each test fails on the code before its fix.

import { describe, expect, it } from 'vitest';
import {
  ActionError,
  applyAction,
  createBattle,
  forecast,
  planAiAction,
  reachableTiles,
  runAiPhase,
  validateAction,
  validateGameData,
  type Action,
  type BattleState,
  type GameData,
  type Pos,
} from '../src/core';
import { fixtureData, makeBattle, makeMap, patchUnit, place, pos, SETUP } from './fixtures';

const data = fixtureData();
const end: Action = { type: 'endPhase' };
const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;
const toEnemy = (s: BattleState) => applyAction(s, end, data).state;

/** Fixture data with a map registered and a vanguard class, so validateGameData can run on it. */
function dataWithMap(map: ReturnType<typeof makeMap>): GameData {
  const d = fixtureData();
  d.maps[map.id] = map;
  d.classes.vanguard = d.classes.fighter!;
  return d;
}

describe('defect 1: the AI never attacks for zero expected damage', () => {
  it('a charger that cannot hurt its only foe closes in but does not attack', () => {
    let s = makeBattle(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 2, 0)]);
    s = patchUnit(s, 'p', { stats: { def: 30, hp: 60, str: 30 }, hp: 60 });
    s = toEnemy(s);
    expect(forecast(s, 'e', 'p', pos(1, 0), data).attacker.damage).toBe(0);
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(1, 0) });
  });

  it('a charger skips a foe it cannot hurt and goes for one it can', () => {
    // The tank is next door, but the rogue walks round it toward the lord it can hurt.
    const s2 = makeBattle(['..........', '..........'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('tank', 'fighter', 'player', 7, 0),
      place('e', 'rogue', 'enemy', 8, 0),
    ]);
    const s3 = toEnemy(patchUnit(s2, 'tank', { stats: { def: 30 } }));
    expect(planAiAction(s3, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(5, 0) });
  });

  it('with a hurtable and an unhurtable target in reach, it attacks the hurtable one', () => {
    let s = makeBattle(['.....'], [
      place('tank', 'fighter', 'player', 1, 0, { isLord: true }),
      place('p', 'fighter', 'player', 3, 0),
      place('e', 'rogue', 'enemy', 2, 0),
    ]);
    s = patchUnit(s, 'tank', { stats: { def: 30, str: 30 } });
    s = toEnemy(s);
    expect(planAiAction(s, data)).toMatchObject({ type: 'attack', targetId: 'p' });
  });

  it('a hold unit with only an unhurtable foe in reach stays put', () => {
    let s = makeBattle(['.....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 3, 0, { ai: { behavior: 'hold' } })]);
    s = toEnemy(patchUnit(s, 'p', { stats: { def: 30 } }));
    expect(planAiAction(s, data)).toEqual({ type: 'wait', unitId: 'e', to: pos(3, 0) });
  });
});

describe('defect 2: protect and defeatBoss targets must exist at battle start', () => {
  const start = [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })];

  it('rejects a protect target that only arrives in a wave', () => {
    const map = makeMap(['..........'], [{ kind: 'mc', pos: pos(0, 0) }, start[1]!], { type: 'protect', unitId: 'v', turns: 5 }, [
      { turn: 2, difficulties: ['normal'], units: [place('v', 'healer', 'ally', 3, 0, { ai: { behavior: 'hold' } })] },
    ]);
    expect(validateGameData(dataWithMap(map)).join('\n')).toMatch(/protect target v/);
    expect(() => createBattle(map, SETUP, 1, dataWithMap(map))).toThrow(/protect target v/);
  });

  it('rejects a protect target on the enemy team', () => {
    const map = makeMap(['..........'], [{ kind: 'mc', pos: pos(0, 0) }, start[1]!], { type: 'protect', unitId: 'e', turns: 5 });
    expect(validateGameData(dataWithMap(map)).join('\n')).toMatch(/protect target e/);
  });

  it('accepts a protect target placed on the ally team', () => {
    const map = makeMap(['..........'], [{ kind: 'mc', pos: pos(0, 0) }, start[1]!, place('v', 'healer', 'ally', 3, 0, { ai: { behavior: 'hold' } })], {
      type: 'protect',
      unitId: 'v',
      turns: 5,
    });
    expect(validateGameData(dataWithMap(map))).toEqual([]);
  });

  it('rejects a defeatBoss boss that arrives in a wave', () => {
    const map = makeMap(['..........'], [{ kind: 'mc', pos: pos(0, 0) }, place('b', 'fighter', 'enemy', 9, 0, { isBoss: true })], { type: 'defeatBoss' }, [
      { turn: 2, difficulties: ['normal'], units: [place('b2', 'fighter', 'enemy', 8, 0, { isBoss: true })] },
    ]);
    expect(validateGameData(dataWithMap(map)).join('\n')).toMatch(/boss b2 arrives in a wave/);
  });
});

describe('defect 3: reinforcements act in the next phase of their team', () => {
  it('a player reinforcement acts in the next player phase', () => {
    const wave = { turn: 1, difficulties: ['normal' as const], units: [place('r', 'fighter', 'player', 2, 0)] };
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })], {
      reinforcements: [wave],
    });
    s = runAiPhase(toEnemy(s), data).state;
    expect([s.turn, s.phase]).toEqual([2, 'player']);
    expect(unit(s, 'r').acted).toBe(false);
    expect(validateAction(s, { type: 'wait', unitId: 'r', to: pos(3, 0) }, data)).toBeNull();
  });

  it('an ally reinforcement arriving in the enemy phase acts in the ally phase of that turn', () => {
    const wave = { turn: 1, difficulties: ['normal' as const], units: [place('r', 'fighter', 'ally', 2, 0)] };
    const s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })], {
      reinforcements: [wave],
    });
    const r = runAiPhase(toEnemy(s), data);
    expect(r.events).toContainEqual({ type: 'unitActed', unitId: 'r' });
  });

  it('an enemy reinforcement still waits for the next enemy phase', () => {
    const wave = { turn: 1, difficulties: ['normal' as const], units: [place('r', 'fighter', 'enemy', 2, 0)] };
    const s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })], {
      reinforcements: [wave],
    });
    const r = runAiPhase(toEnemy(s), data);
    expect(r.events).not.toContainEqual({ type: 'unitActed', unitId: 'r' });
    expect(unit(r.state, 'r').acted).toBe(false);
  });
});

describe('defect 4: duplicate unit ids are rejected at createBattle', () => {
  const d = fixtureData();
  d.classes.vanguard = d.classes.fighter!;
  const kit = { id: 'kit', name: 'Kit', classId: 'rogue', level: 1, xp: 0, stats: d.classes.rogue!.baseStats, weaponId: 'dagger', isLord: false, inventory: ['dagger'] };

  it('a party member with the id of a map placement', () => {
    const map = makeMap(['....'], [{ kind: 'mc', pos: pos(0, 0) }, { kind: 'party', pos: pos(1, 0) }, place('kit', 'rogue', 'player', 2, 0), place('e', 'rogue', 'enemy', 3, 0)]);
    expect(() => createBattle(map, { ...SETUP, party: [kit] }, 1, d)).toThrow(/duplicate unit id kit/);
  });

  it('a wave unit with the id of a starting unit', () => {
    const map = makeMap(['....'], [{ kind: 'mc', pos: pos(0, 0) }, place('e', 'rogue', 'enemy', 3, 0)], { type: 'rout' }, [
      { turn: 2, difficulties: ['hard'], units: [place('e', 'rogue', 'enemy', 2, 0)] },
    ]);
    expect(() => createBattle(map, SETUP, 1, d)).toThrow(/duplicate unit id e/);
  });
});

describe('defect 5: difficulty scaling respects stat caps', () => {
  it('a level 20 brute on lunatic stays within the caps', () => {
    const s = makeBattle(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'brute', 'enemy', 3, 0, { level: 20 })], {
      setup: { ...SETUP, difficulty: 'lunatic' },
    });
    const e = unit(s, 'e');
    const caps = data.balance.statCaps;
    for (const k of Object.keys(caps) as (keyof typeof caps)[]) expect(e.stats[k], k).toBeLessThanOrEqual(caps[k]);
    expect(e.stats).toMatchObject({ hp: 60, str: 30 });
    expect(e.hp).toBe(60);
  });
});

describe('defect 6: the AI approaches by true remaining movement cost', () => {
  // The reviewer's probe map. Forest (F) costs 2 to enter.
  const tiles = ['...F.FFFF', '...F...F.', 'FF..F.F.F'];
  const target = pos(8, 1);

  /** Cost for e to walk from `from` to any tile next to the target, with unlimited movement. */
  function trueCost(s: BattleState, from: Pos): number {
    const s2 = structuredClone(s);
    const e = s2.units.find((u) => u.id === 'e')!;
    e.pos = { ...from };
    e.stats.mov = 999;
    let best = Infinity;
    for (const r of reachableTiles(s2, 'e', data)) {
      if (r.canStop && Math.abs(r.pos.x - target.x) + Math.abs(r.pos.y - target.y) === 1) best = Math.min(best, r.cost);
    }
    return best;
  }

  it('moves to the reachable tile with the least remaining cost', () => {
    const s = toEnemy(makeBattle(tiles, [place('p', 'fighter', 'player', 8, 1, { isLord: true }), place('e', 'fighter', 'enemy', 0, 0)]));
    const a = planAiAction(s, data)!;
    expect(a.type).toBe('wait');
    if (a.type !== 'wait') return;
    const best = Math.min(...reachableTiles(s, 'e', data).filter((t) => t.canStop).map((t) => trueCost(s, t.pos)));
    expect(trueCost(s, a.to)).toBe(best);
    expect(a.to).toEqual(pos(3, 0));
  });
});

describe('hardening: malformed actions and invalid forecasts', () => {
  const s = makeBattle(['......'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('h', 'healer', 'player', 1, 0), place('e', 'fighter', 'enemy', 5, 0)]);
  const bad: [string, unknown][] = [
    ['null', null],
    ['a string', 'wait'],
    ['an unknown type', { type: 'dance', unitId: 'p', to: pos(0, 0) }],
    ['a missing to', { type: 'wait', unitId: 'p' }],
    ['a non-integer to', { type: 'wait', unitId: 'p', to: { x: 0.5, y: 0 } }],
    ['a missing unitId', { type: 'wait', to: pos(0, 0) }],
    ['an unknown unit', { type: 'attack', unitId: 'zz', to: pos(0, 0), targetId: 'e' }],
    ['a missing targetId', { type: 'attack', unitId: 'p', to: pos(0, 0) }],
    ['an unknown target', { type: 'heal', unitId: 'h', to: pos(1, 0), targetId: 'zz' }],
  ];
  for (const [name, a] of bad) {
    it(`validateAction and applyAction handle ${name}`, () => {
      expect(typeof validateAction(s, a as Action, data)).toBe('string');
      expect(() => applyAction(s, a as Action, data)).toThrow(ActionError);
    });
  }

  it('forecast throws ActionError for out of range, no weapon, or unknown units', () => {
    expect(() => forecast(s, 'p', 'e', pos(0, 0), data)).toThrow(ActionError);
    expect(() => forecast(s, 'h', 'e', pos(4, 0), data)).toThrow(ActionError);
    expect(() => forecast(s, 'zz', 'e', pos(4, 0), data)).toThrow(ActionError);
    expect(() => forecast(s, 'p', 'e', pos(4, 0), data)).not.toThrow();
  });

  it('validateGameData rejects zero balance divisors', () => {
    const d = fixtureData();
    d.balance.combat.hitLckDiv = 0;
    d.balance.combat.critSklDiv = 0;
    d.balance.xp.hitDiv = 0;
    d.balance.xp.perLevel = 0;
    const errs = validateGameData(d).join('\n');
    for (const k of ['hitLckDiv', 'critSklDiv', 'hitDiv', 'perLevel']) expect(errs).toMatch(new RegExp(k));
  });
});

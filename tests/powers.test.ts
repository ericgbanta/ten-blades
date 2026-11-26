import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canUsePower,
  createBattle,
  lineTiles,
  planAiAction,
  planUnitAction,
  powerDirections,
  powerForecast,
  powerPlan,
  powerTargets,
  validateAction,
  validateGameData,
  type BattleEvent,
  type BattleState,
  type GameData,
  type PowerSummary,
} from '../src/core';
import { gameData } from '../src/data';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

/** Fixture data where the blades always hit and never crit, and plain axes always hit. */
function sureData(): GameData {
  const d = fixtureData();
  for (const id of ['maw', 'hush', 'needles']) {
    d.weapons[id]!.hit = 300;
    d.weapons[id]!.crit = 0;
  }
  return d;
}

const ROW = ['........', '........', '........', '........', '........'];

function strikesOf(events: BattleEvent[]) {
  return events.filter((e): e is Extract<BattleEvent, { type: 'strike' }> => e.type === 'strike');
}

function summaryOf(events: BattleEvent[]): PowerSummary {
  const e = events.find((x): x is Extract<BattleEvent, { type: 'powerUsed' }> => x.type === 'powerUsed');
  if (!e) throw new Error('no powerUsed');
  return e.summary;
}

const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;

describe('the blade data', () => {
  it('lists the ten blades, three Dormant and three Awakened powers built and seven marked not built', () => {
    expect(Object.keys(gameData.blades)).toHaveLength(10);
    const built = Object.entries(gameData.powers).filter(([, p]) => p.implemented).map(([id]) => id);
    expect(built.sort()).toEqual(['cleave', 'devour', 'echo', 'hush', 'pin', 'scatter']);
    for (const b of Object.values(gameData.blades)) expect(gameData.powers[b.power]).toBeDefined();
    expect(validateGameData(gameData)).toEqual([]);
  });

  it('flags a weapon naming an unknown blade and a bad power', () => {
    const d = structuredClone(gameData);
    d.weapons.gravemaw!.blade = 'nope';
    d.powers.scatter = { ...d.powers.scatter!, cost: 0 };
    const errs = validateGameData(d);
    expect(errs).toContain('weapon gravemaw: unknown blade nope');
    expect(errs.some((e) => e.startsWith('power scatter: cost'))).toBe(true);
  });
});

describe('Resolve', () => {
  it('starts bearers at the starting value and everyone else at 0', () => {
    const s = makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 5, 0)]);
    expect(unit(s, 'b').resolve).toBe(20);
    expect(unit(s, 'f').resolve).toBe(0);
    expect(unit(s, 'b').devourStacks).toBe(0);
  });

  it('gains for a hit landed and a hit taken, and only bearers gain', () => {
    const d = sureData();
    const s = makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 1, 0, { weaponId: 'sure_axe' })], { data: d });
    const r = applyAction(s, { type: 'attack', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d);
    expect(strikesOf(r.events).every((x) => x.hit)).toBe(true);
    expect(unit(r.state, 'b').resolve).toBe(20 + 15 + 10);
    expect(unit(r.state, 'f').resolve).toBe(0);
    expect(r.events).toContainEqual({ type: 'resolveChanged', unitId: 'b', amount: 25, resolveAfter: 45 });
  });

  it('adds the crit and kill gains and caps at the maximum', () => {
    const d = sureData();
    d.weapons.maw!.crit = 300;
    let s = makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 1, 0), place('g', 'fighter', 'enemy', 7, 4)], { data: d });
    const r = applyAction(s, { type: 'attack', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d);
    expect(unit(r.state, 'f').alive).toBe(false);
    expect(unit(r.state, 'b').resolve).toBe(20 + 15 + 10 + 25);
    s = patchUnit(s, 'b', { resolve: 95 });
    expect(unit(applyAction(s, { type: 'attack', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d).state, 'b').resolve).toBe(100);
  });

  it('does not change a fight between units without blades', () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('a', 'fighter', 'player', 0, 0), place('f', 'fighter', 'enemy', 1, 0)], { data: d, seed: 9 });
    const r = applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'f' }, d);
    expect(r.events.some((e) => e.type === 'resolveChanged' || e.type === 'powerUsed')).toBe(false);
  });
});

describe('validation', () => {
  const d = sureData();
  const s0 = makeBattle(ROW, [
    place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }),
    place('t', 'rogue', 'player', 0, 2, { weaponId: 'needles' }),
    place('p', 'fighter', 'player', 0, 4),
    place('f', 'fighter', 'enemy', 2, 0),
    place('g', 'fighter', 'enemy', 3, 2),
  ], { data: d });

  it('needs a full gauge, a power, and a valid aim', () => {
    expect(validateAction(s0, { type: 'power', unitId: 'b', to: pos(1, 0), targetId: 'f' }, d)).toBe('Resolve 20/100');
    expect(validateAction(s0, { type: 'power', unitId: 'p', to: pos(0, 4), targetId: 'f' }, d)).toBe('p has no power');
    const s = patchUnit(patchUnit(s0, 'b', { resolve: 100 }), 't', { resolve: 100 });
    expect(validateAction(s, { type: 'power', unitId: 'b', to: pos(1, 0), targetId: 'f' }, d)).toBeNull();
    expect(validateAction(s, { type: 'power', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d)).toBe('f is not a target of Devour');
    expect(validateAction(s, { type: 'power', unitId: 'b', to: pos(1, 0), dir: 'right' }, d)).toBe('Devour needs a target');
    expect(validateAction(s, { type: 'power', unitId: 't', to: pos(0, 2), targetId: 'g' }, d)).toBe('Scatter needs a direction');
    expect(validateAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'up' }, d)).toBe('No enemy in the line up');
    expect(validateAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right' }, d)).toBeNull();
    expect(validateAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right', targetId: 'g' }, d)).toBe('power needs a targetId or a direction');
    expect(validateAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'north' as never }, d)).toBe('Unknown direction north');
    expect(() => applyAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'up' }, d)).toThrow('No enemy in the line up');
  });
});

describe('Devour', () => {
  const d = sureData();
  const base = () =>
    patchUnit(
      makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 2, 0, { weaponId: 'sure_axe' }), place('g', 'fighter', 'enemy', 7, 4)], {
        data: d,
      }),
      'b',
      { resolve: 100, hp: 10 },
    );

  it('targets enemies in weapon range and forecasts the empowered fight', () => {
    const s = base();
    expect(powerTargets(s, 'b', pos(1, 0), d)).toEqual(['f']);
    expect(canUsePower(s, 'b', pos(0, 0), d)).toBe(false);
    const fc = powerForecast(s, 'b', pos(1, 0), { targetId: 'f' }, d);
    expect(fc.plan.powerId).toBe('devour');
    expect(fc.combat!.attacker.damage).toBe(10 + 8 + 4 - 3);
    expect(fc.combat!.counter).not.toBeNull();
    expect(fc.healMax).toBe(15);
  });

  it('strikes with the bonus, takes the counter, heals capped, spends the gauge', () => {
    const s = base();
    const fc = powerForecast(s, 'b', pos(1, 0), { targetId: 'f' }, d);
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(1, 0), targetId: 'f' }, d);
    const st = strikesOf(r.events);
    expect(st[0]).toMatchObject({ attackerId: 'b', hit: true, damage: fc.combat!.attacker.damage, hpAfter: 20 - 19 });
    expect(st[1]).toMatchObject({ attackerId: 'f', damage: fc.combat!.counter!.damage });
    const b = unit(r.state, 'b');
    const counter = fc.combat!.counter!.damage;
    expect(b.hp).toBe(10 - counter + 15);
    expect(r.events).toContainEqual({ type: 'unitHealed', unitId: 'b', sourceId: 'b', cause: 'power', amount: 15, hpAfter: b.hp });
    expect(b.resolve).toBe(0);
    expect(b.acted).toBe(true);
    const sum = summaryOf(r.events);
    expect(sum).toMatchObject({ powerId: 'devour', bearerId: 'b', targetIds: ['f'], heal: 15, stacksAfter: 0 });
    expect(sum.results).toEqual([{ unitId: 'f', damage: 19, hit: true, crit: false, hpAfter: 1, defeated: false }]);
    expect(r.events[r.events.length - 1]).not.toMatchObject({ type: 'powerUsed' });
    expect(r.state.powerLog).toEqual([{ powerId: 'devour', bearerId: 'b', at: pos(1, 0), turn: 1, witnesses: [] }]);
  });

  it('heals only the damage dealt when that is less than the cap', () => {
    const s = patchUnit(base(), 'f', { hp: 5 });
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(1, 0), targetId: 'f' }, d);
    expect(summaryOf(r.events).heal).toBe(5);
    expect(unit(r.state, 'b').hp).toBe(15);
  });

  it('stacks attack per kill for the rest of the map, up to the cap, from normal attacks too', () => {
    let s = patchUnit(base(), 'f', { hp: 5 });
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(1, 0), targetId: 'f' }, d);
    expect(unit(r.state, 'b').devourStacks).toBe(1);
    expect(r.events).toContainEqual({ type: 'devourStack', unitId: 'b', stacks: 1, attackBonus: 1 });
    s = patchUnit(r.state, 'b', { acted: false, pos: pos(6, 4) });
    const before = powerForecast(patchUnit(s, 'b', { resolve: 100 }), 'b', pos(6, 4), { targetId: 'g' }, d).combat!.attacker.attack;
    expect(before).toBe(10 + 8 + 4 + 1);
    s = patchUnit(s, 'b', { devourStacks: 5 });
    s = patchUnit(s, 'g', { hp: 1 });
    const r2 = applyAction(s, { type: 'attack', unitId: 'b', to: pos(6, 4), targetId: 'g' }, d);
    expect(unit(r2.state, 'b').devourStacks).toBe(5);
  });

  it('XP and the objective are checked after a power kill', () => {
    const s = patchUnit(makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 1, 0)], { data: d }), 'b', { resolve: 100 });
    const r = applyAction(patchUnit(s, 'f', { hp: 3 }), { type: 'power', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d);
    expect(r.events.some((e) => e.type === 'xpGained' && e.unitId === 'b' && e.amount > 10)).toBe(true);
    expect(r.state.result).toBe('victory');
    expect(r.events[r.events.length - 1]).toMatchObject({ type: 'battleEnded', result: 'victory' });
  });
});

describe('Scatter', () => {
  const d = sureData();
  const tiles = ['........', '........', '........', '........', '........'];
  const s0 = () =>
    patchUnit(
      makeBattle(
        tiles,
        [
          place('t', 'rogue', 'player', 0, 2, { weaponId: 'needles' }),
          place('ally', 'fighter', 'player', 2, 2),
          place('e1', 'fighter', 'enemy', 1, 2),
          place('e2', 'mage', 'enemy', 4, 2),
          place('e3', 'fighter', 'enemy', 5, 2),
          place('e4', 'fighter', 'enemy', 0, 4),
        ],
        { data: d },
      ),
      't',
      { resolve: 100 },
    );

  it('walks a straight line and stops at the map edge', () => {
    const s = s0();
    expect(lineTiles(s, pos(0, 2), 'right', 4)).toEqual([pos(1, 2), pos(2, 2), pos(3, 2), pos(4, 2)]);
    expect(lineTiles(s, pos(0, 2), 'left', 4)).toEqual([]);
    expect(lineTiles(s, pos(6, 0), 'right', 4)).toEqual([pos(7, 0)]);
    expect(lineTiles(s, pos(0, 2), 'down', 4)).toEqual([pos(0, 3), pos(0, 4)]);
  });

  it('offers only directions with an enemy in reach', () => {
    expect(powerDirections(s0(), 't', pos(0, 2), d)).toEqual(['right', 'down']);
    expect(powerTargets(s0(), 't', pos(0, 2), d)).toEqual([]);
  });

  it('hits every enemy in the line at reduced damage, skips friends and anyone past the end, with no counters', () => {
    const s = s0();
    const fc = powerForecast(s, 't', pos(0, 2), { dir: 'right' }, d);
    expect(fc.targets.map((t) => t.unitId)).toEqual(['e1', 'e2']);
    expect(fc.combat).toBeNull();
    const full = 4 + 4 - 3 - 1; // str + might - def, and heavy beats swift: -1
    expect(fc.targets[0]!.side.damage).toBe(Math.floor((full * 70) / 100));
    const r = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right' }, d);
    const st = strikesOf(r.events);
    expect(st.map((x) => [x.attackerId, x.defenderId])).toEqual([
      ['t', 'e1'],
      ['t', 'e2'],
    ]);
    expect(st.map((x) => x.damage)).toEqual(fc.targets.map((t) => t.side.damage));
    expect(unit(r.state, 'e3').hp).toBe(unit(s, 'e3').hp);
    expect(unit(r.state, 'ally').hp).toBe(unit(s, 'ally').hp);
    expect(unit(r.state, 't').hp).toBe(unit(s, 't').hp);
    expect(unit(r.state, 't').resolve).toBe(20); // the fixture's Scatter costs 80
    expect(summaryOf(r.events)).toMatchObject({ powerId: 'scatter', dir: 'right', targetIds: ['e1', 'e2'], tiles: lineTiles(s, pos(0, 2), 'right', 4) });
  });

  it('kills in the line give XP once, capped, and can win the map', () => {
    let s = s0();
    for (const id of ['e3', 'e4']) s = patchUnit(s, id, { alive: false, hp: 0 });
    s = patchUnit(patchUnit(s, 'e1', { hp: 1 }), 'e2', { hp: 1 });
    const r = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right' }, d);
    expect(r.events.filter((e) => e.type === 'unitDefeated').map((e) => (e as { unitId: string }).unitId)).toEqual(['e1', 'e2']);
    expect(r.events.filter((e) => e.type === 'xpGained')).toHaveLength(1);
    expect(r.state.result).toBe('victory');
  });
});

describe('Echo', () => {
  const d = sureData();
  const battle = (brute: [number, number]) =>
    patchUnit(
      patchUnit(
        makeBattle(
          ROW,
          [
            place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }),
            place('b', 'brute', 'player', brute[0], brute[1], { weaponId: 'maw' }),
            place('f', 'fighter', 'enemy', 1, 1, { weaponId: 'sure_axe' }),
            place('g', 'fighter', 'enemy', 7, 3),
          ],
          { data: d },
        ),
        'h',
        { resolve: 100 },
      ),
      'b',
      { resolve: 100 },
    );

  it('with nothing to echo, falls back to an attack on an adjacent enemy with a weaker repeat strike', () => {
    const s = battle([5, 4]);
    const plan = powerPlan(s, 'h', d)!;
    expect(plan).toMatchObject({ bladePowerId: 'echo', powerId: 'echo', fallback: true, echoOf: null, aim: 'unit' });
    expect(powerTargets(s, 'h', pos(1, 0), d)).toEqual(['f']);
    expect(powerTargets(s, 'h', pos(0, 0), d)).toEqual([]);
    const fc = powerForecast(s, 'h', pos(1, 0), { targetId: 'f' }, d);
    expect(fc.echoStrike!.damage).toBe(Math.floor((fc.combat!.attacker.damage * 50) / 100));
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(1, 0), targetId: 'f' }, d);
    const st = strikesOf(r.events);
    const last = st[st.length - 1]!;
    expect(last).toMatchObject({ attackerId: 'h', defenderId: 'f', echo: true, damage: fc.echoStrike!.damage });
    // The repeat strike comes after the counter and before the fight ends.
    expect(st.filter((x) => x.attackerId === 'f')).toHaveLength(1);
    const ended = r.events.findIndex((e) => e.type === 'combatEnded');
    expect(r.events.indexOf(st[st.length - 1]!)).toBeLessThan(ended);
    expect(summaryOf(r.events)).toMatchObject({ powerId: 'echo', fallback: true });
    expect(r.state.powerLog[0]).toMatchObject({ powerId: 'echo', bearerId: 'h' });
  });

  it('re-casts a power used within 3 tiles, from the bearer with its own stats', () => {
    let s = battle([2, 1]);
    // The brute devours f from (2,1); h at (0,0) is 3 tiles away and witnesses it.
    let r = applyAction(s, { type: 'power', unitId: 'b', to: pos(2, 1), targetId: 'f' }, d);
    expect(r.state.powerLog[0]!.witnesses).toEqual(['h']);
    s = r.state;
    const plan = powerPlan(s, 'h', d)!;
    expect(plan).toMatchObject({ bladePowerId: 'echo', powerId: 'devour', echoOf: 'b', fallback: false });
    const fc = powerForecast(s, 'h', pos(1, 0), { targetId: 'f' }, d);
    // The MC's numbers: fighter str 6 + hush might 6 + Devour's 4 - def 3.
    expect(fc.combat!.attacker.damage).toBe(6 + 6 + 4 - 3);
    r = applyAction(s, { type: 'power', unitId: 'h', to: pos(1, 0), targetId: 'f' }, d);
    const sum = summaryOf(r.events);
    expect(sum).toMatchObject({ powerId: 'devour', bladePowerId: 'echo', echoOf: 'b', bearerId: 'h' });
    expect(unit(r.state, 'h').resolve).toBe(0);
    // An echo is logged as the power it re-cast; the echoer cannot echo its own echo.
    expect(r.state.powerLog[1]).toMatchObject({ powerId: 'devour', bearerId: 'h' });
  });

  it('does not echo a power used out of range', () => {
    const s = battle([4, 1]);
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(2, 1), targetId: 'f' }, d);
    expect(r.state.powerLog[0]!.witnesses).toEqual(['h']);
    const far = battle([5, 3]);
    const r2 = applyAction(patchUnit(far, 'f', { pos: pos(6, 3) }), { type: 'power', unitId: 'b', to: pos(5, 3), targetId: 'f' }, d);
    expect(r2.state.powerLog[0]!.witnesses).toEqual([]);
    expect(powerPlan(r2.state, 'h', d)!.fallback).toBe(true);
  });

  it('echoes Scatter as a line power aimed by direction', () => {
    const d2 = sureData();
    let s = makeBattle(
      ROW,
      [place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }), place('t', 'rogue', 'player', 0, 2, { weaponId: 'needles' }), place('e1', 'fighter', 'enemy', 1, 2), place('e2', 'fighter', 'enemy', 3, 0)],
      { data: d2 },
    );
    s = patchUnit(patchUnit(s, 'h', { resolve: 100 }), 't', { resolve: 100 });
    s = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right' }, d2).state;
    const plan = powerPlan(s, 'h', d2)!;
    expect(plan).toMatchObject({ powerId: 'scatter', aim: 'line', echoOf: 't' });
    expect(powerDirections(s, 'h', pos(0, 0), d2)).toEqual(['right']);
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 0), dir: 'right' }, d2);
    expect(strikesOf(r.events).map((x) => x.defenderId)).toEqual(['e2']);
    // Echo costs Echo's price (the full gauge), not the echoed power's.
    expect(unit(r.state, 'h').resolve).toBe(0);
  });
});

describe('AI', () => {
  const d = sureData();
  const fixture = (resolve: number) =>
    patchUnit(
      makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('b', 'brute', 'enemy', 2, 0, { weaponId: 'maw' })], { data: d }),
      'b',
      { resolve },
    );

  it('an enemy bearer fires its power when the gauge is full and it beats an attack', () => {
    let s = applyAction(fixture(100), { type: 'endPhase' }, d).state;
    const plan = planAiAction(s, d);
    expect(plan).toMatchObject({ type: 'power', unitId: 'b', targetId: 'p' });
    s = applyAction(s, plan!, d).state;
    expect(unit(s, 'b').resolve).toBe(0);
  });

  it('attacks normally with the gauge short, and is deterministic', () => {
    const s = applyAction(fixture(40), { type: 'endPhase' }, d).state;
    expect(planAiAction(s, d)).toMatchObject({ type: 'attack', unitId: 'b', targetId: 'p' });
    const full = applyAction(fixture(100), { type: 'endPhase' }, d).state;
    expect(planAiAction(full, d)).toEqual(planAiAction(structuredClone(full), d));
  });

  it('never fires powers for player units it plans (the simulator side)', () => {
    const s = patchUnit(makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 2, 0)], { data: d }), 'b', { resolve: 100 });
    const ai = { behavior: 'charge' as const, guardTile: null, guardRadius: 0, active: false };
    expect(planUnitAction(s, 'b', d, ai).type).toBe('attack');
  });
});

describe('determinism', () => {
  it('a suspend and resume across a power gives the same game', () => {
    const d = fixtureData();
    const make = () =>
      patchUnit(
        createBattle(
          {
            id: 'test',
            name: 'Test',
            width: 8,
            height: 5,
            tiles: ROW,
            legend: { '.': 'plain' },
            placements: [
              place('b', 'brute', 'player', 0, 0, { weaponId: 'maw', isLord: true }),
              place('t', 'rogue', 'player', 0, 2, { weaponId: 'needles' }),
              place('f', 'fighter', 'enemy', 2, 0),
              place('e1', 'fighter', 'enemy', 2, 2),
              place('e2', 'fighter', 'enemy', 4, 2),
            ],
            objective: { type: 'rout' },
            reinforcements: [],
          },
          { difficulty: 'normal', permadeath: 'classic', mc: { name: 'x', style: 'vanguard' } },
          77,
          d,
        ),
        't',
        { resolve: 100 },
      );
    const actions = [
      { type: 'power', unitId: 't', to: pos(0, 2), dir: 'right' },
      { type: 'attack', unitId: 'b', to: pos(1, 0), targetId: 'f' },
      { type: 'endPhase' },
    ] as const;
    let a = make();
    let b = make();
    const evA: BattleEvent[] = [];
    const evB: BattleEvent[] = [];
    for (const act of actions) {
      const ra = applyAction(a, act, d);
      a = ra.state;
      evA.push(...ra.events);
      const rb = applyAction(JSON.parse(JSON.stringify(b)) as BattleState, act, d);
      b = rb.state;
      evB.push(...JSON.parse(JSON.stringify(rb.events)));
    }
    expect(b).toEqual(a);
    expect(evB).toEqual(JSON.parse(JSON.stringify(evA)));
  });
});

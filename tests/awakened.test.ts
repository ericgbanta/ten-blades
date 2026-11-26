// The Awakened (tier 2) powers, two powers per bearer, the blood price and the statuses they put on foes. The
// fixture's blades (tests/fixtures.ts): hush (Echo, then Silence), maw (Devour, then Cleave), needles (Scatter,
// then Pin); tier 2 takes 2 HP per power.

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  forecast,
  moveTiles,
  planAiAction,
  powerBlock,
  powerForecast,
  powerIds,
  powerPlan,
  powerTargets,
  validateAction,
  type BattleEvent,
  type BattleState,
  type GameData,
  type PowerSummary,
} from '../src/core';
import { SETUP, fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

function sureData(): GameData {
  const d = fixtureData();
  for (const id of ['maw', 'hush', 'needles', 'axe']) {
    d.weapons[id]!.hit = 300;
    d.weapons[id]!.crit = 0;
  }
  return d;
}

const d = sureData();
const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;
const ROW = ['........', '........', '........', '........', '........'];
const AWAKE = { ...SETUP, bladeTiers: { hush: 2, maw: 2, needles: 2 } };

function summaryOf(events: BattleEvent[]): PowerSummary {
  const e = events.find((x): x is Extract<BattleEvent, { type: 'powerUsed' }> => x.type === 'powerUsed');
  if (!e) throw new Error('no powerUsed');
  return e.summary;
}

describe('two powers on an Awakened blade', () => {
  it('a Dormant blade has its first power only; tier 2 adds the second', () => {
    const p = [place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }), place('e', 'rogue', 'enemy', 1, 0)];
    const dormant = makeBattle(ROW, p, { data: d });
    const awake = makeBattle(ROW, p, { data: d, setup: AWAKE });
    expect(powerIds(dormant, 'h', d)).toEqual(['echo']);
    expect(powerIds(awake, 'h', d)).toEqual(['echo', 'silence']);
    expect(powerPlan(dormant, 'h', d, 'silence')).toBeNull();
    expect(powerPlan(awake, 'h', d, 'silence')).toMatchObject({ powerId: 'silence', cost: 50, aim: 'unit' });
    const full = patchUnit(dormant, 'h', { resolve: 100 });
    expect(validateAction(full, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d)).toMatch(/cannot use silence/);
  });

  it('both powers share one gauge, each at its own cost', () => {
    const s = patchUnit(makeBattle(ROW, [place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }), place('e', 'brute', 'enemy', 1, 0)], { data: d, setup: AWAKE }), 'h', { resolve: 60 });
    expect(powerBlock(s, 'h', d)).toBe('Resolve 60/100');
    expect(powerBlock(s, 'h', d, 'silence')).toBeNull();
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d);
    expect(unit(r.state, 'h').resolve).toBe(10);
  });
});

describe('Silence (a strike that hushes)', () => {
  const base = () =>
    patchUnit(
      makeBattle(ROW, [place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }), place('e', 'fighter', 'enemy', 1, 0), place('far', 'fighter', 'enemy', 3, 0)], { data: d, setup: AWAKE }),
      'h',
      { resolve: 100 },
    );

  it('targets foes at its own range, forecasts one uncounterable strike at full damage', () => {
    const s = base();
    expect(powerTargets(s, 'h', pos(0, 0), d, 'silence')).toEqual(['e']);
    const fc = powerForecast(s, 'h', pos(0, 0), { targetId: 'e' }, d, 'silence');
    expect(fc.combat).toBeNull();
    expect(fc.status).toBe('silence');
    expect(fc.statusOnHit).toBe(false);
    expect(fc.bloodPrice).toBe(2);
    expect(fc.targets).toHaveLength(1);
    expect(fc.targets[0]!.side.damage).toBe(forecast(s, 'h', 'e', pos(0, 0), d).attacker.damage);
  });

  it('resolves as forecast: the strike, the status, no counter, the gauge and the blood price', () => {
    const s = base();
    const fc = powerForecast(s, 'h', pos(0, 0), { targetId: 'e' }, d, 'silence');
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d);
    const e = unit(r.state, 'e');
    expect(e.hp).toBe(unit(s, 'e').hp - fc.targets[0]!.side.damage);
    expect(e.statuses).toEqual([{ kind: 'silence', by: 'player', turn: 1 }]);
    expect(r.events.filter((x) => x.type === 'strike').map((x) => (x as { attackerId: string }).attackerId)).toEqual(['h']);
    const sum = summaryOf(r.events);
    expect(sum.statuses).toEqual([{ unitId: 'e', status: 'silence' }]);
    expect(sum.bloodPrice).toBe(2);
    expect(unit(r.state, 'h').hp).toBe(unit(s, 'h').hp - 2);
    const types = r.events.map((x) => x.type);
    expect(types.indexOf('statusApplied')).toBeLessThan(types.indexOf('powerEnded'));
    expect(r.events[types.indexOf('powerEnded') + 1]).toEqual({ type: 'unitDamaged', unitId: 'h', amount: 2, hpAfter: unit(s, 'h').hp - 2, cause: 'bloodPrice' });
  });

  it('a silenced foe cannot counter or fire a power until the next player phase', () => {
    let s = applyAction(base(), { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d).state;
    s = patchUnit(s, 'h', { acted: false });
    expect(forecast(s, 'h', 'e', pos(0, 0), d).counter).toBeNull();
    s = patchUnit(s, 'e', { weaponId: 'maw', inventory: ['maw'], resolve: 100 });
    expect(powerBlock(s, 'e', d)).toBe('Silenced');
    // End turn: the enemy phase keeps it, the next player phase clears it.
    s = applyAction(s, { type: 'endPhase' }, d).state;
    expect(unit(s, 'e').statuses).toHaveLength(1);
    s = applyAction(s, { type: 'endPhase' }, d).state;
    expect(s.phase).toBe('player');
    expect(unit(s, 'e').statuses).toEqual([]);
  });

  it('the blood price never kills: it stops at 1 HP', () => {
    const s = patchUnit(base(), 'h', { hp: 2 });
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d);
    expect(unit(r.state, 'h').hp).toBe(1);
    const at1 = patchUnit(base(), 'h', { hp: 1 });
    expect(powerForecast(at1, 'h', pos(0, 0), { targetId: 'e' }, d, 'silence').bloodPrice).toBe(0);
    const r1 = applyAction(at1, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' }, d);
    expect(r1.events.some((x) => x.type === 'unitDamaged')).toBe(false);
  });

  it('a Dormant power on an Awakened blade pays the price too', () => {
    const r = applyAction(base(), { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e' }, d);
    expect(summaryOf(r.events)).toMatchObject({ powerId: 'echo', fallback: true, bloodPrice: 2 });
  });
});

describe('Cleave', () => {
  const base = () =>
    patchUnit(
      makeBattle(
        ROW,
        [
          place('b', 'brute', 'player', 2, 2, { weaponId: 'maw' }),
          place('t', 'fighter', 'enemy', 3, 2),
          place('n', 'rogue', 'enemy', 2, 1),
          place('s', 'rogue', 'enemy', 2, 3),
          place('ally', 'fighter', 'player', 1, 2),
          place('far', 'rogue', 'enemy', 6, 2),
        ],
        { data: d, setup: AWAKE },
      ),
      'b',
      { resolve: 100 },
    );

  it('forecasts the fight with its bonus, plus a half-damage blow on every other foe beside the bearer', () => {
    const s = base();
    const fc = powerForecast(s, 'b', pos(2, 2), { targetId: 't' }, d, 'cleave');
    expect(fc.combat).not.toBeNull();
    expect(fc.combat!.attacker.attack).toBe(forecast(s, 'b', 't', pos(2, 2), d).attacker.attack + 2);
    expect(fc.targets.map((t) => t.unitId)).toEqual(['t', 'n', 's']);
    for (const t of fc.targets.slice(1)) expect(t.side.crit).toBe(0);
  });

  it('resolves as forecast: the fight, then the splash strikes in order, then the price', () => {
    const s = base();
    const fc = powerForecast(s, 'b', pos(2, 2), { targetId: 't' }, d, 'cleave');
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(2, 2), targetId: 't', powerId: 'cleave' }, d);
    for (const t of fc.targets.slice(1)) expect(unit(r.state, t.unitId).hp).toBe(Math.max(0, t.hp - t.side.damage));
    expect(unit(r.state, 'ally').hp).toBe(unit(s, 'ally').hp);
    expect(unit(r.state, 'far').hp).toBe(unit(s, 'far').hp);
    const sum = summaryOf(r.events);
    expect(sum.results.map((x) => x.unitId)).toEqual(['t', 'n', 's']);
    expect(sum.bloodPrice).toBe(2);
    expect(r.events.filter((x) => x.type === 'combatStarted')).toHaveLength(1);
  });

  it('a bearer felled by the counter swings no further', () => {
    const s = patchUnit(base(), 'b', { hp: 1 });
    const tough = patchUnit(s, 't', { stats: { hp: 99 }, hp: 99, weaponId: 'sure_axe', inventory: ['sure_axe'] });
    const r = applyAction(tough, { type: 'power', unitId: 'b', to: pos(2, 2), targetId: 't', powerId: 'cleave' }, d);
    expect(unit(r.state, 'b').alive).toBe(false);
    expect(unit(r.state, 'n').hp).toBe(unit(s, 'n').hp);
    expect(summaryOf(r.events).bloodPrice).toBe(0);
  });
});

describe('Pin', () => {
  const base = () =>
    patchUnit(
      makeBattle(ROW, [place('t', 'rogue', 'player', 0, 0, { weaponId: 'needles' }), place('e', 'fighter', 'enemy', 3, 0), place('x', 'fighter', 'enemy', 4, 0)], { data: d, setup: AWAKE }),
      't',
      { resolve: 100 },
    );

  it('reaches 3 tiles, at 60% damage, no counter, pinning on a hit', () => {
    const s = base();
    expect(powerTargets(s, 't', pos(0, 0), d, 'pin')).toEqual(['e']);
    const fc = powerForecast(s, 't', pos(0, 0), { targetId: 'e' }, d, 'pin');
    expect(fc.statusOnHit).toBe(true);
    const r = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 0), targetId: 'e', powerId: 'pin' }, d);
    expect(unit(r.state, 'e').hp).toBe(unit(s, 'e').hp - fc.targets[0]!.side.damage);
    expect(unit(r.state, 'e').statuses.map((x) => x.kind)).toEqual(['pin']);
    expect(unit(r.state, 't').resolve).toBe(60);
  });

  it('a miss pins no one', () => {
    const miss = fixtureData();
    miss.weapons.needles!.hit = -300;
    const s = patchUnit(makeBattle(ROW, [place('t', 'rogue', 'player', 0, 0, { weaponId: 'needles' }), place('e', 'fighter', 'enemy', 3, 0)], { data: miss, setup: AWAKE }), 't', { resolve: 100 });
    const r = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 0), targetId: 'e', powerId: 'pin' }, miss);
    expect(unit(r.state, 'e').statuses).toEqual([]);
    expect(summaryOf(r.events).statuses).toEqual([]);
  });

  it('a pinned unit cannot move through the enemy phase; it can still strike from its tile', () => {
    let s = applyAction(base(), { type: 'power', unitId: 't', to: pos(0, 0), targetId: 'e', powerId: 'pin' }, d).state;
    s = applyAction(s, { type: 'endPhase' }, d).state;
    expect(moveTiles(s, 'e', d)).toEqual([pos(3, 0)]);
    const plan = planAiAction(s, d)!;
    expect(plan.type === 'wait' || plan.type === 'attack' ? plan.to : null).toEqual(pos(3, 0));
  });
});

describe('the AI with two powers, and Echo', () => {
  it('an enemy bearer with an Awakened blade picks the power that scores best, naming the second one', () => {
    let s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 2), place('q', 'fighter', 'player', 1, 1), place('r', 'fighter', 'player', 1, 3), place('b', 'brute', 'enemy', 2, 2, { weaponId: 'maw', ai: { behavior: 'hold' } })], { data: d, setup: AWAKE });
    s = applyAction(s, { type: 'endPhase' }, d).state;
    s = patchUnit(s, 'b', { resolve: 60 });
    const plan = planAiAction(s, d)!;
    expect(plan).toMatchObject({ type: 'power', unitId: 'b', powerId: 'cleave' });
  });

  it('an Echo bearer that saw a Pin re-casts it: the pin is the echoer\'s', () => {
    let s = makeBattle(
      ROW,
      [place('h', 'fighter', 'player', 0, 1, { weaponId: 'hush' }), place('t', 'rogue', 'player', 0, 0, { weaponId: 'needles' }), place('e', 'fighter', 'enemy', 3, 0), place('f', 'fighter', 'enemy', 3, 1)],
      { data: d, setup: AWAKE },
    );
    s = patchUnit(patchUnit(s, 't', { resolve: 100 }), 'h', { resolve: 100 });
    s = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 0), targetId: 'e', powerId: 'pin' }, d).state;
    expect(powerPlan(s, 'h', d)).toMatchObject({ powerId: 'pin', echoOf: 't' });
    const r = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 1), targetId: 'f' }, d);
    expect(unit(r.state, 'f').statuses).toEqual([{ kind: 'pin', by: 'player', turn: 1 }]);
  });
});

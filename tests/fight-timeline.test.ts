import { describe, expect, it } from 'vitest';
import { applyAction, type BattleEvent, type BattleState, type GameData } from '../src/core';
import { buildFightScript, finalHp, FIGHT_MS, isSceneStart, sceneGroupEnd, sideOf, type FighterFacts, type FightScript, type SceneStep } from '../src/battle/fightTimeline';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

function sure(): GameData {
  const d = fixtureData();
  for (const id of ['maw', 'hush', 'needles']) {
    d.weapons[id]!.hit = 300;
    d.weapons[id]!.crit = 0;
  }
  return d;
}

const ROW = ['........', '........', '........', '........', '........'];

function factsOf(state: BattleState, data: GameData) {
  return (id: string): FighterFacts | null => {
    const u = state.units.find((x) => x.id === id);
    if (!u) return null;
    return { team: u.team, weapon: u.weaponId ? data.weapons[u.weaponId]! : null, maxHp: u.stats.hp, hp: u.hp };
  };
}

/** Every scene group in an action's events, with its script. */
function scenes(events: BattleEvent[], state: BattleState, data: GameData): { group: BattleEvent[]; script: FightScript }[] {
  const out: { group: BattleEvent[]; script: FightScript }[] = [];
  for (let i = 0; i < events.length; i++) {
    if (!isSceneStart(events[i]!)) continue;
    const end = sceneGroupEnd(events, i);
    const group = events.slice(i, end);
    const script = buildFightScript(group, factsOf(state, data));
    if (script) out.push({ group, script });
    i = end - 1;
  }
  return out;
}

const kinds = (s: FightScript) => s.steps.map((x) => x.kind);

function expectOrdered(s: FightScript): void {
  for (let i = 1; i < s.steps.length; i++) expect(s.steps[i]!.at).toBeGreaterThanOrEqual(s.steps[i - 1]!.at);
  const last = s.steps[s.steps.length - 1]!;
  expect(s.total).toBe(last.at + last.dur);
  expect(s.steps[0]!.kind).toBe('intro');
  expect(last.kind).toBe('outro');
}

describe('the scene timeline', () => {
  it('puts the player side on the left and enemies on the right', () => {
    expect(sideOf('player')).toBe('left');
    expect(sideOf('ally')).toBe('left');
    expect(sideOf('enemy')).toBe('right');
  });

  it('a melee exchange: wind-up, lunge, impact, recover per strike, in the core order, then the outro', () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { weaponId: 'sure_axe' }), place('e', 'fighter', 'enemy', 1, 0, { weaponId: 'sure_axe' }), place('z', 'rogue', 'enemy', 7, 4)], { data: d });
    const r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, d);
    const [sc] = scenes(r.events, r.state, d);
    expect(sc).toBeDefined();
    const script = sc!.script;
    expectOrdered(script);
    expect(script.kind).toBe('combat');
    expect(script.fighters.map((f) => [f.unitId, f.side])).toEqual([
      ['p', 'left'],
      ['e', 'right'],
    ]);
    expect(kinds(script)).toEqual(['intro', 'windup', 'strike', 'impact', 'recover', 'windup', 'strike', 'impact', 'recover', 'outro']);
    const strikes = script.steps.filter((x): x is Extract<SceneStep, { kind: 'strike' }> => x.kind === 'strike');
    expect(strikes.map((x) => [x.actor, x.motion, x.fx])).toEqual([
      ['p', 'melee', 'chop'],
      ['e', 'melee', 'chop'],
    ]);
    // HP before comes from the forecast; HP after each impact matches the strike events and the state.
    expect(script.fighters.map((f) => f.hpBefore)).toEqual([20, 20]);
    const hp = finalHp(script);
    expect(hp.get('p')).toBe(r.state.units.find((u) => u.id === 'p')!.hp);
    expect(hp.get('e')).toBe(r.state.units.find((u) => u.id === 'e')!.hp);
  });

  it('a miss and a crit are staged as such', () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { weaponId: 'crit_axe' }), place('e', 'fighter', 'enemy', 1, 0, { weaponId: 'miss_axe' }), place('z', 'rogue', 'enemy', 7, 4)], { data: d });
    const r = applyAction(patchUnit(s, 'e', { stats: { hp: 99 }, hp: 99 }), { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, d);
    const script = scenes(r.events, r.state, d)[0]!.script;
    const impact = script.steps.find((x) => x.kind === 'impact');
    expect(impact).toMatchObject({ actor: 'p', crit: true });
    expect(script.steps.find((x) => x.kind === 'miss')).toMatchObject({ actor: 'e', target: 'p' });
    // A crit holds the hit longer before the recovery.
    const rec = script.steps.find((x) => x.kind === 'recover')!;
    expect(rec.at - impact!.at).toBe(FIGHT_MS.impact + FIGHT_MS.critStop);
  });

  it('bows and magic stay back and fire a shot; a kill ends with the fall', () => {
    const d = fixtureData();
    d.weapons.bow!.hit = 300;
    const s = makeBattle(ROW, [place('a', 'archer', 'player', 0, 0), place('e', 'mage', 'enemy', 2, 0), place('z', 'rogue', 'enemy', 7, 4)], { data: d });
    const r = applyAction(patchUnit(s, 'e', { hp: 1 }), { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'e' }, d);
    const script = scenes(r.events, r.state, d)[0]!.script;
    expect(kinds(script)).toEqual(['intro', 'windup', 'strike', 'projectile', 'impact', 'recover', 'defeat', 'outro']);
    expect(script.steps.find((x) => x.kind === 'strike')).toMatchObject({ motion: 'ranged', fx: 'arrow' });
    expect(script.steps.find((x) => x.kind === 'defeat')).toMatchObject({ unitId: 'e' });
  });

  it('a staff heal: the healer on the left, a warm glow and the HP on the target', () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('h', 'healer', 'player', 0, 0), place('p', 'fighter', 'player', 1, 0), place('z', 'rogue', 'enemy', 7, 4)], { data: d });
    const r = applyAction(patchUnit(s, 'p', { hp: 5 }), { type: 'heal', unitId: 'h', to: pos(0, 0), targetId: 'p' }, d);
    const script = scenes(r.events, r.state, d)[0]!.script;
    expectOrdered(script);
    expect(script.kind).toBe('heal');
    expect(script.fighters.map((f) => [f.unitId, f.side, f.hpBefore])).toEqual([
      ['h', 'left', 15],
      ['p', 'right', 5],
    ]);
    const after = r.state.units.find((u) => u.id === 'p')!.hp;
    expect(after).toBe(19);
    expect(script.steps.find((x) => x.kind === 'heal')).toMatchObject({ actor: 'h', target: 'p', drain: false, hpAfter: after, amount: 14 });
  });

  it('terrain heals and moves are not scenes', () => {
    expect(isSceneStart({ type: 'unitHealed', unitId: 'p', sourceId: null, cause: 'terrain', amount: 2, hpAfter: 9 })).toBe(false);
    expect(isSceneStart({ type: 'unitMoved', unitId: 'p', from: pos(0, 0), to: pos(1, 0), path: [] })).toBe(false);
  });

  it('a fight group takes the falls right after it, and nothing else', () => {
    const ev: BattleEvent[] = [
      { type: 'combatStarted', attackerId: 'a', defenderId: 'b', forecast: null as never },
      { type: 'strike', attackerId: 'a', defenderId: 'b', hit: true, crit: false, damage: 3, hpAfter: 0 },
      { type: 'combatEnded', attackerId: 'a', defenderId: 'b' },
      { type: 'unitDefeated', unitId: 'b', byId: 'a' },
      { type: 'xpGained', unitId: 'a', amount: 30, xpAfter: 30 },
    ];
    expect(sceneGroupEnd(ev, 0)).toBe(4);
    expect(sceneGroupEnd(ev, 4)).toBe(4);
  });

  it('Devour: the empowered fight, then the red drain back into the bearer', () => {
    const d = sure();
    const s = patchUnit(
      makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw' }), place('f', 'fighter', 'enemy', 1, 0), place('z', 'rogue', 'enemy', 7, 4)], { data: d }),
      'b',
      { resolve: 100, hp: 10 },
    );
    const r = applyAction(s, { type: 'power', unitId: 'b', to: pos(0, 0), targetId: 'f' }, d);
    const [sc] = scenes(r.events, r.state, d);
    const script = sc!.script;
    expectOrdered(script);
    expect(script.kind).toBe('power');
    expect(script.power?.powerId).toBe('devour');
    expect(sc!.group[sc!.group.length - 1]!.type).toBe('powerEnded');
    const heal = script.steps.find((x) => x.kind === 'heal');
    expect(heal).toMatchObject({ actor: 'b', target: 'b', drain: true, from: 'f' });
    expect(script.steps.indexOf(heal!)).toBeGreaterThan(script.steps.findIndex((x) => x.kind === 'impact'));
    expect(finalHp(script).get('b')).toBe(r.state.units.find((u) => u.id === 'b')!.hp);
  });

  it('Scatter: one throw, needles to each of up to three shown targets, no counters', () => {
    const d = sure();
    const s = patchUnit(
      makeBattle(
        ['........', '........'],
        [
          place('t', 'rogue', 'player', 0, 0, { weaponId: 'needles' }),
          place('a', 'fighter', 'enemy', 1, 0),
          place('b', 'fighter', 'enemy', 2, 0),
          place('c', 'fighter', 'enemy', 3, 0),
          place('e', 'fighter', 'enemy', 4, 0),
        ],
        { data: d },
      ),
      't',
      { resolve: 100 },
    );
    const r = applyAction(s, { type: 'power', unitId: 't', to: pos(0, 0), dir: 'right' }, d);
    const script = scenes(r.events, r.state, d)[0]!.script;
    expectOrdered(script);
    expect(script.fighters.map((f) => [f.unitId, f.side, f.slot])).toEqual([
      ['t', 'left', 0],
      ['a', 'right', 0],
      ['b', 'right', 1],
      ['c', 'right', 2],
    ]);
    expect(script.steps.filter((x) => x.kind === 'windup')).toHaveLength(1);
    const shots = script.steps.filter((x): x is Extract<SceneStep, { kind: 'projectile' }> => x.kind === 'projectile');
    expect(shots.map((x) => [x.target, x.fx])).toEqual([
      ['a', 'needles'],
      ['b', 'needles'],
      ['c', 'needles'],
    ]);
    expect(shots[1]!.at - shots[0]!.at).toBe(FIGHT_MS.volley);
    // Only the bearer strikes.
    expect(script.steps.filter((x) => x.kind === 'impact' || x.kind === 'miss').every((x) => 'actor' in x && x.actor === 't')).toBe(true);
    expect(script.power?.targetIds).toEqual(['a', 'b', 'c', 'e']);
  });

  it('Echo: the fallback repeat strike and an echoed power are ghosted', () => {
    const d = sure();
    let s = makeBattle(
      ROW,
      [
        place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }),
        place('b', 'brute', 'player', 2, 1, { weaponId: 'maw' }),
        place('f', 'fighter', 'enemy', 1, 0, { weaponId: 'miss_axe' }),
        place('g', 'fighter', 'enemy', 3, 1),
        place('z', 'rogue', 'enemy', 7, 4),
      ],
      { data: d },
    );
    s = patchUnit(patchUnit(patchUnit(s, 'h', { resolve: 100 }), 'b', { resolve: 100 }), 'f', { stats: { hp: 60 }, hp: 60 });
    const fb = applyAction(s, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'f' }, d);
    const fbScript = scenes(fb.events, fb.state, d)[0]!.script;
    const fbStrikes = fbScript.steps.filter((x): x is Extract<SceneStep, { kind: 'strike' }> => x.kind === 'strike');
    expect(fbStrikes.map((x) => [x.actor, x.ghost])).toEqual([
      ['h', false],
      ['f', false],
      ['h', true],
    ]);
    // The brute devours g within 3 tiles of h; h then echoes Devour, and every strike of h is ghosted.
    let st = applyAction(s, { type: 'power', unitId: 'b', to: pos(2, 1), targetId: 'g' }, d).state;
    st = patchUnit(st, 'f', { hp: 60 });
    const ec = applyAction(st, { type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'f' }, d);
    const ecScript = scenes(ec.events, ec.state, d)[0]!.script;
    expect(ecScript.power).toMatchObject({ powerId: 'devour', bladePowerId: 'echo', echoOf: 'b' });
    expect(ecScript.steps.filter((x): x is Extract<SceneStep, { kind: 'strike' }> => x.kind === 'strike' && x.actor === 'h').every((x) => x.ghost)).toBe(true);
  });

  it('every scene of a full enemy phase builds and ends', () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 2, 0), place('m', 'mage', 'enemy', 2, 2)], { data: d, seed: 5 });
    let state = applyAction(s, { type: 'endPhase' }, d).state;
    for (let i = 0; i < 4 && state.phase === 'enemy'; i++) {
      const e = state.units.find((u) => u.alive && u.team === 'enemy' && !u.acted);
      if (!e) break;
      const r = applyAction(state, { type: 'wait', unitId: e.id, to: e.pos }, d);
      for (const sc of scenes(r.events, r.state, d)) expectOrdered(sc.script);
      state = r.state;
    }
  });
});

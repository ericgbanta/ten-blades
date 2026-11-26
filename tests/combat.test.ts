import { describe, expect, it } from 'vitest';
import {
  applyAction,
  forecast,
  nextInt,
  rollPercent,
  triangleEdge,
  type BattleEvent,
  type BattleState,
  type Forecast,
  type GameData,
  type RngState,
} from '../src/core';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();

function duel(attackerClass: string, defenderClass: string, tiles = ['...'], defenderX = 1, extra: { aw?: string; dw?: string } = {}) {
  return makeBattle(tiles, [
    place('a', attackerClass, 'player', 0, 0, { isLord: true, ...(extra.aw ? { weaponId: extra.aw } : {}) }),
    place('d', defenderClass, 'enemy', defenderX, 0, extra.dw ? { weaponId: extra.dw } : {}),
  ]);
}

const strikes = (ev: BattleEvent[]) => ev.filter((e) => e.type === 'strike');

describe('triangle', () => {
  it('heavy > swift > arcane > heavy, none is neutral', () => {
    const b = data.balance;
    expect(triangleEdge('heavy', 'swift', b)).toBe('advantage');
    expect(triangleEdge('swift', 'heavy', b)).toBe('disadvantage');
    expect(triangleEdge('swift', 'arcane', b)).toBe('advantage');
    expect(triangleEdge('arcane', 'swift', b)).toBe('disadvantage');
    expect(triangleEdge('arcane', 'heavy', b)).toBe('advantage');
    expect(triangleEdge('heavy', 'arcane', b)).toBe('disadvantage');
    expect(triangleEdge('heavy', 'heavy', b)).toBe('neutral');
    expect(triangleEdge('none', 'swift', b)).toBe('neutral');
    expect(triangleEdge('arcane', 'none', b)).toBe('neutral');
  });

  it('applies +15 hit and +1 damage with advantage, mirrored with disadvantage', () => {
    // Fighter (axe, heavy) attacks rogue (dagger, swift).
    const fc = forecast(duel('fighter', 'rogue'), 'a', 'd', pos(0, 0), data);
    expect(fc.attacker).toEqual({
      unitId: 'a',
      hp: 20,
      attack: 12, // str 6 + might 5 + 1
      damage: 10, // 12 - def 2
      hit: 83, // 80 + skl 5*2 + lck 4/2 + 15 - (spd 9*2 + lck 6)
      crit: 0, // 0 + 5/2 - lck 6, clamped
      strikes: 1,
      triangle: 'advantage',
    });
    expect(fc.counter).toEqual({
      unitId: 'd',
      hp: 18,
      attack: 6, // 4 + 3 - 1
      damage: 3, // 6 - def 3
      hit: 80, // 90 + 16 + 3 - 15 - (5*2 + 4)
      crit: 5, // 5 + 8/2 - 4
      strikes: 2, // spd 9 vs 5
      triangle: 'disadvantage',
    });
    expect(fc.defenderTriangle).toBe('disadvantage');
  });

  it('magic uses mag against res', () => {
    const fc = forecast(duel('mage', 'fighter'), 'a', 'd', pos(0, 0), data);
    expect(fc.attacker.attack).toBe(11); // mag 6 + 4 + 1 (arcane beats heavy)
    expect(fc.attacker.damage).toBe(10); // vs res 1
    expect(fc.attacker.hit).toBe(97);
    expect(fc.counter?.damage).toBe(9); // axe 6 + 5 - 1 vs def 1
  });
});

describe('terrain in combat', () => {
  it('forest adds avoid and defense to the defender', () => {
    const fc = forecast(duel('fighter', 'rogue', ['.F.']), 'a', 'd', pos(0, 0), data);
    expect(fc.attacker.damage).toBe(9);
    expect(fc.attacker.hit).toBe(63);
  });

  it('the attacker gets the terrain of the tile it attacks from', () => {
    const s = makeBattle(['F..'], [place('a', 'fighter', 'player', 2, 0, { isLord: true }), place('d', 'rogue', 'enemy', 1, 0)]);
    const fc = forecast(s, 'a', 'd', pos(0, 0), data);
    expect(fc.counter?.damage).toBe(2); // 6 - (def 3 + forest 1)
    expect(fc.counter?.hit).toBe(60); // 80 - 20 forest avoid
  });
});

describe('doubling', () => {
  it('needs a speed lead of 4', () => {
    const s = duel('rogue', 'fighter');
    expect(forecast(s, 'a', 'd', pos(0, 0), data).attacker.strikes).toBe(2);
    const slower = patchUnit(s, 'a', { stats: { spd: 8 } });
    expect(forecast(slower, 'a', 'd', pos(0, 0), data).attacker.strikes).toBe(1);
  });

  it('strikes go attacker, counter, attacker follow-up', () => {
    let s = duel('rogue', 'fighter', ['...'], 1, { dw: 'sure_axe' });
    s = patchUnit(s, 'd', { stats: { hp: 60 }, hp: 60 });
    s = patchUnit(s, 'a', { stats: { hp: 60 }, hp: 60 });
    const ev = strikes(applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data).events);
    expect(ev.map((e) => e.attackerId)).toEqual(['a', 'd', 'a']);
  });

  it('counter follow-up comes last', () => {
    let s = duel('fighter', 'rogue', ['...'], 1, { aw: 'sure_axe' });
    s = patchUnit(s, 'd', { stats: { hp: 60 }, hp: 60 });
    const ev = strikes(applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data).events);
    expect(ev.map((e) => e.attackerId)).toEqual(['a', 'd', 'd']);
  });

  it('combat stops when someone falls', () => {
    let s = duel('fighter', 'rogue', ['...'], 1, { aw: 'sure_axe' });
    s = patchUnit(s, 'd', { hp: 5 });
    const r = applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data);
    expect(strikes(r.events)).toHaveLength(1);
    expect(strikes(r.events)[0]).toMatchObject({ hit: true, damage: 5, hpAfter: 0 });
    expect(r.events.some((e) => e.type === 'unitDefeated' && e.unitId === 'd' && e.byId === 'a')).toBe(true);
  });
});

describe('counter range rules', () => {
  it('a bow cannot counter at range 1', () => {
    const fc = forecast(duel('fighter', 'archer'), 'a', 'd', pos(0, 0), data);
    expect(fc.counter).toBeNull();
    expect(fc.defenderTriangle).toBe('disadvantage'); // the swift bow loses to the heavy axe
  });

  it('a melee weapon cannot counter at range 2, a bow can', () => {
    expect(forecast(duel('mage', 'fighter', ['...'], 2), 'a', 'd', pos(0, 0), data).counter).toBeNull();
    const fc = forecast(duel('mage', 'archer', ['...'], 2), 'a', 'd', pos(0, 0), data);
    expect(fc.counter).not.toBeNull();
    expect(fc.counter?.triangle).toBe('advantage'); // swift beats arcane
  });

  it('a 1-2 range weapon counters at both ranges', () => {
    expect(forecast(duel('fighter', 'mage'), 'a', 'd', pos(0, 0), data).counter).not.toBeNull();
    expect(forecast(duel('archer', 'mage', ['...'], 2), 'a', 'd', pos(0, 0), data).counter).not.toBeNull();
  });

  it('staff users never counter', () => {
    expect(forecast(duel('fighter', 'healer'), 'a', 'd', pos(0, 0), data).counter).toBeNull();
  });

  it('forecast throws out of range', () => {
    expect(() => forecast(duel('fighter', 'rogue', ['...'], 2), 'a', 'd', pos(0, 0), data)).toThrow();
  });
});

describe('crits', () => {
  it('triple damage', () => {
    let s = duel('fighter', 'rogue', ['...'], 1, { aw: 'crit_axe' });
    s = patchUnit(s, 'd', { stats: { hp: 60 }, hp: 60 });
    const fc = forecast(s, 'a', 'd', pos(0, 0), data);
    expect(fc.attacker.crit).toBe(100);
    const ev = strikes(applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data).events);
    expect(ev[0]).toMatchObject({ hit: true, crit: true, damage: 30, hpAfter: 30 });
  });

  it('a miss never crits and deals 0', () => {
    const s = duel('fighter', 'rogue', ['...'], 1, { aw: 'miss_axe' });
    const ev = strikes(applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, data).events);
    expect(ev[0]).toMatchObject({ hit: false, crit: false, damage: 0, hpAfter: 18 });
  });
});

/** Replays a combat by hand from a forecast and the RNG, independent of resolveCombat. */
function replay(fc: Forecast, rng: RngState, d: GameData) {
  const order = [fc.attacker];
  if (fc.counter) order.push(fc.counter);
  if (fc.attacker.strikes === 2) order.push(fc.attacker);
  if (fc.counter && fc.counter.strikes === 2) order.push(fc.counter);
  const hp: Record<string, number> = { [fc.attacker.unitId]: fc.attacker.hp, [fc.defenderId]: fc.defenderHp };
  const out: { attackerId: string; hit: boolean; crit: boolean; damage: number }[] = [];
  let s = rng;
  for (const side of order) {
    let hit: boolean;
    if (d.balance.hitRollMode === '2rn') {
      const [a, s1] = nextInt(s, 0, 99);
      const [b, s2] = nextInt(s1, 0, 99);
      s = s2;
      hit = (a + b) / 2 < side.hit;
    } else {
      const [a, s1] = nextInt(s, 0, 99);
      s = s1;
      hit = a < side.hit;
    }
    let crit = false;
    if (hit) [crit, s] = rollPercent(s, side.crit);
    const target = side.unitId === fc.attacker.unitId ? fc.defenderId : fc.attacker.unitId;
    const dmg = Math.min(hp[target]!, hit ? side.damage * (crit ? d.balance.combat.critMultiplier : 1) : 0);
    hp[target] = hp[target]! - dmg;
    out.push({ attackerId: side.unitId, hit, crit, damage: dmg });
    if (hp[target] === 0) break;
  }
  return out;
}

describe('forecast equals resolution', () => {
  const cases: [string, string, number][] = [
    ['fighter', 'rogue', 1],
    ['rogue', 'fighter', 1],
    ['mage', 'fighter', 1],
    ['mage', 'archer', 2],
    ['archer', 'rogue', 2],
  ];
  for (const mode of ['1rn', '2rn'] as const) {
    it(`matches a hand replay over many seeds (${mode})`, () => {
      const d = fixtureData();
      d.balance.hitRollMode = mode;
      for (const [ac, dc, x] of cases) {
        for (let seed = 1; seed <= 40; seed++) {
          let s: BattleState = makeBattle(['F..'], [place('a', ac, 'player', 0, 0, { isLord: true }), place('d', dc, 'enemy', x, 0)], {
            seed,
            data: d,
          });
          s = patchUnit(s, 'a', { stats: { lck: 0 } });
          const fc = forecast(s, 'a', 'd', pos(0, 0), d);
          const r = applyAction(s, { type: 'attack', unitId: 'a', to: pos(0, 0), targetId: 'd' }, d);
          const started = r.events.find((e) => e.type === 'combatStarted');
          expect(started && started.type === 'combatStarted' ? started.forecast : null).toEqual(fc);
          const got = strikes(r.events).map((e) => ({ attackerId: e.attackerId, hit: e.hit, crit: e.crit, damage: e.damage }));
          expect(got).toEqual(replay(fc, s.rng, d));
        }
      }
    });
  }

  it('forecast from another tile matches attacking after moving there', () => {
    const s = makeBattle(['.....', '..F..'], [place('a', 'fighter', 'player', 0, 1, { isLord: true }), place('d', 'rogue', 'enemy', 3, 1)]);
    const fc = forecast(s, 'a', 'd', pos(2, 1), data);
    const r = applyAction(s, { type: 'attack', unitId: 'a', to: pos(2, 1), targetId: 'd' }, data);
    const started = r.events.find((e) => e.type === 'combatStarted');
    expect(started && started.type === 'combatStarted' ? started.forecast : null).toEqual(fc);
    expect(fc.counter?.hit).toBe(60); // the attacker gets the forest's avoid
  });
});

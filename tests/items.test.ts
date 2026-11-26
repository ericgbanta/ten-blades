import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createBattle,
  forecast,
  parseWeaponId,
  planAiAction,
  rankedWeaponId,
  validateAction,
  validateGameData,
  weaponDef,
  type BattleEvent,
  type BattleState,
} from '../src/core';
import { gameData } from '../src/data';
import { SETUP, fixtureData, makeBattle, makeMap, patchUnit, place, pos } from './fixtures';

const d = fixtureData();
const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;
const ROW = ['......', '......', '......'];

describe('inventories', () => {
  it('a placed unit carries its weapon and its items; a party unit its own inventory with its weapon in it', () => {
    const s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0), place('e', 'rogue', 'enemy', 5, 0, { items: ['salve'] })], { data: d });
    expect(unit(s, 'p').inventory).toEqual(['axe']);
    expect(unit(s, 'e').inventory).toEqual(['dagger', 'salve']);
    const map = makeMap(['....'], [{ kind: 'mc', pos: pos(0, 0) }, place('e', 'rogue', 'enemy', 3, 0)]);
    const lord = {
      id: 'hero',
      name: 'Hero',
      classId: 'fighter',
      level: 1,
      xp: 0,
      stats: d.classes.fighter!.baseStats,
      weaponId: 'axe',
      isLord: true,
      inventory: ['salve', 'sure_axe'],
    };
    const b = createBattle(map, { ...SETUP, party: [lord] }, 1, d);
    expect(unit(b, 'hero').inventory).toEqual(['axe', 'salve', 'sure_axe']);
    expect(unit(b, 'hero').statuses).toEqual([]);
    expect(b.version).toBe(4);
    expect(b.bladeTiers).toEqual({});
  });

  it('forge ranks are weapon ids with +N: more might and hit, a new name, capped, never on a legendary', () => {
    expect(parseWeaponId('iron_lance+2')).toEqual({ base: 'iron_lance', rank: 2 });
    expect(rankedWeaponId('iron_lance', 1)).toBe('iron_lance+1');
    const w = weaponDef('iron_lance+2', gameData)!;
    expect(w).toMatchObject({ name: 'Iron Lance +2', might: 6 + 2, hit: 80 + 10, kind: 'lance' });
    expect(weaponDef('iron_lance+3', gameData)).toBeNull();
    expect(weaponDef('gravemaw+1', gameData)).toBeNull();
    expect(weaponDef('healing_salve', gameData)).toBeNull();
  });

  it('the shipped items and prices pass the data checks', () => {
    expect(validateGameData(gameData)).toEqual([]);
    const bad = structuredClone(gameData);
    bad.items.nothing = { name: 'Nothing', description: '', price: 1, heal: 0, resolve: 0 };
    bad.weapons.gravemaw!.price = 10;
    const errs = validateGameData(bad);
    expect(errs).toContain('item nothing: does nothing');
    expect(errs).toContain('weapon gravemaw: a legendary weapon has no price');
  });
});

describe('the item action', () => {
  const base = () =>
    patchUnit(makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { items: ['salve', 'draught'] }), place('e', 'rogue', 'enemy', 5, 2)], { data: d }), 'p', {
      hp: 8,
    });

  it('moves, heals up to the item, uses it up and ends the turn', () => {
    const r = applyAction(base(), { type: 'item', unitId: 'p', to: pos(1, 0), itemIndex: 1 }, d);
    const p = unit(r.state, 'p');
    expect(p.pos).toEqual(pos(1, 0));
    expect(p.hp).toBe(18);
    expect(p.inventory).toEqual(['axe', 'draught']);
    expect(p.acted).toBe(true);
    const types = r.events.map((e) => e.type);
    expect(types).toEqual(['unitMoved', 'itemUsed', 'unitHealed', 'unitActed']);
    expect(r.events.find((e) => e.type === 'unitHealed')).toMatchObject({ cause: 'item', amount: 10, hpAfter: 18 });
  });

  it('never heals past max HP', () => {
    const r = applyAction(patchUnit(base(), 'p', { hp: 17 }), { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 1 }, d);
    expect(unit(r.state, 'p').hp).toBe(20);
  });

  it('refuses a weapon, an empty slot, a heal at full HP, and Resolve for someone with no blade', () => {
    const s = base();
    expect(validateAction(s, { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 0 }, d)).toMatch(/not an item/);
    expect(validateAction(s, { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 7 }, d)).toMatch(/nothing in slot/);
    expect(validateAction(patchUnit(s, 'p', { hp: 20 }), { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 1 }, d)).toMatch(/not wounded/);
    expect(validateAction(s, { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 2 }, d)).toMatch(/would do nothing/);
    expect(validateAction(s, { type: 'item', unitId: 'p', to: pos(0, 0), itemIndex: 1.5 } as never, d)).toMatch(/itemIndex/);
  });

  it("a draught fills a bearer's gauge", () => {
    const s = makeBattle(ROW, [place('b', 'brute', 'player', 0, 0, { weaponId: 'maw', items: ['draught'] }), place('e', 'rogue', 'enemy', 5, 2)], { data: d });
    const r = applyAction(s, { type: 'item', unitId: 'b', to: pos(0, 0), itemIndex: 1 }, d);
    expect(unit(r.state, 'b').resolve).toBe(50);
    expect(r.events.some((e) => e.type === 'resolveChanged')).toBe(true);
  });
});

describe('the equip action', () => {
  const base = () =>
    makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { items: ['sure_axe', 'dagger'] }), place('e', 'rogue', 'enemy', 1, 0)], { data: d });

  it('is free: swaps the weapon in hand, keeps the unit ready and in place, and the forecast uses it', () => {
    const s = base();
    const before = forecast(s, 'p', 'e', pos(0, 0), d).attacker.hit;
    s.units.find((u) => u.id === 'p')!.inventory.splice(1, 0); // no-op: inventory is ['axe', 'sure_axe', 'dagger']
    const r = applyAction(s, { type: 'equip', unitId: 'p', itemIndex: 1 }, d);
    const p = unit(r.state, 'p');
    expect(p.weaponId).toBe('sure_axe');
    expect(p.acted).toBe(false);
    expect(p.pos).toEqual(pos(0, 0));
    expect(r.events).toEqual([{ type: 'weaponChanged', unitId: 'p', weaponId: 'sure_axe' }]);
    expect(forecast(r.state, 'p', 'e', pos(0, 0), d).attacker.hit).toBe(100);
    expect(before).toBeLessThan(100);
    // And the attack rolls the new numbers.
    const hit = applyAction(r.state, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, d);
    expect(hit.events.find((e) => e.type === 'strike')).toMatchObject({ attackerId: 'p', hit: true });
  });

  it('refuses what the class cannot wield, an item, the weapon already in hand, and a unit that has acted', () => {
    const s = patchUnit(base(), 'p', { inventory: ['axe', 'sure_axe', 'dagger', 'salve'] });
    expect(validateAction(s, { type: 'equip', unitId: 'p', itemIndex: 2 }, d)).toMatch(/cannot wield/);
    expect(validateAction(s, { type: 'equip', unitId: 'p', itemIndex: 3 }, d)).toMatch(/not a weapon/);
    expect(validateAction(s, { type: 'equip', unitId: 'p', itemIndex: 0 }, d)).toMatch(/already holds/);
    expect(validateAction(patchUnit(s, 'p', { acted: true }), { type: 'equip', unitId: 'p', itemIndex: 1 }, d)).toMatch(/already acted/);
    expect(validateAction(s, { type: 'equip', unitId: 'e', itemIndex: 0 }, d)).toMatch(/cannot act in the player phase/);
  });
});

describe('the AI and items', () => {
  it('an enemy low on HP drinks its salve where it stands; at fuller HP it fights', () => {
    let s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0), place('e', 'fighter', 'enemy', 4, 0, { items: ['salve'] })], { data: d, seed: 9 });
    s = applyAction(s, { type: 'endPhase' }, d).state;
    const low = patchUnit(s, 'e', { hp: 5 });
    expect(planAiAction(low, d)).toEqual({ type: 'item', unitId: 'e', to: pos(4, 0), itemIndex: 1 });
    const r = applyAction(low, planAiAction(low, d)!, d);
    expect(unit(r.state, 'e').hp).toBe(15);
    expect(planAiAction(patchUnit(s, 'e', { hp: 19 }), d)?.type).toBe('attack');
  });

  it('a give-weapon event puts the weapon in the inventory and in hand', () => {
    const map = makeMap(['....'], [place('p', 'fighter', 'player', 0, 0), place('e', 'rogue', 'enemy', 3, 0)]);
    map.events = [{ id: 'gift', trigger: { type: 'battleStart' }, effects: [{ type: 'giveWeapon', unitId: 'p', weaponId: 'sure_axe' }] }];
    const data = { ...d, maps: { test: map } };
    const s = createBattle(map, SETUP, 1, data);
    const events: BattleEvent[] = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data).events;
    expect(events[0]).toMatchObject({ type: 'eventFired' });
    const after = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data).state;
    expect(unit(after, 'p')).toMatchObject({ weaponId: 'sure_axe', inventory: ['axe', 'sure_axe'] });
  });
});

describe('skirmish scaling in the core', () => {
  it('shifts enemy levels (placements and waves) by the setup, never below 1, and leaves players alone', () => {
    const map = makeMap(['......'], [place('p', 'fighter', 'player', 0, 0, { level: 2 }), place('e', 'rogue', 'enemy', 5, 0, { level: 2 })], { type: 'rout' }, [
      { turn: 2, difficulties: ['normal'], units: [place('w', 'rogue', 'enemy', 4, 0, { level: 1 })] },
    ]);
    const up = createBattle(map, { ...SETUP, enemyLevelShift: 3 }, 1, d);
    expect(unit(up, 'e').level).toBe(5);
    expect(unit(up, 'p').level).toBe(2);
    expect(up.reinforcements[0]!.units[0]!.level).toBe(4);
    expect(map.reinforcements[0]!.units[0]!.level).toBe(1);
    const down = createBattle(map, { ...SETUP, enemyLevelShift: -5 }, 1, d);
    expect(unit(down, 'e').level).toBe(1);
  });
});

describe('suspend and resume across item and equip actions', () => {
  it('a JSON round trip between actions plays out exactly like an uninterrupted run', () => {
    const start = patchUnit(
      makeBattle(
        ['......', '......', '......'],
        [place('p', 'fighter', 'player', 0, 0, { items: ['sure_axe', 'salve'] }), place('e', 'fighter', 'enemy', 3, 0, { items: ['salve'] })],
        { data: d, seed: 77 },
      ),
      'p',
      { hp: 9 },
    );
    const script = [{ type: 'equip', unitId: 'p', itemIndex: 1 }, { type: 'item', unitId: 'p', to: pos(1, 0), itemIndex: 2 }, { type: 'endPhase' }] as const;
    const run = (resumeEach: boolean) => {
      let s = start;
      const events: BattleEvent[][] = [];
      for (const a of script) {
        if (resumeEach) s = JSON.parse(JSON.stringify(s)) as BattleState;
        const r = applyAction(s, a, d);
        s = r.state;
        events.push(r.events);
      }
      for (let a = planAiAction(s, d); a; a = planAiAction(s, d)) {
        if (resumeEach) s = JSON.parse(JSON.stringify(s)) as BattleState;
        const r = applyAction(s, a, d);
        s = r.state;
        events.push(r.events);
      }
      return { s, events };
    };
    const straight = run(false);
    const resumed = run(true);
    expect(resumed.s).toEqual(straight.s);
    expect(resumed.events).toEqual(straight.events);
    expect(unit(straight.s, 'p')).toMatchObject({ weaponId: 'sure_axe', inventory: ['axe', 'sure_axe'] });
  });
});

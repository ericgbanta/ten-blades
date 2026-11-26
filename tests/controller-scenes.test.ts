import { describe, expect, it } from 'vitest';
import { applyAction, type BattleEvent, type BattleState, type GameData, type Pos } from '../src/core';
import { BattleController, CUT_IN_MS, type SceneMode } from '../src/battle/controller';
import type { FightScript } from '../src/battle/fightTimeline';
import type { Overlay } from '../src/battle/selection';
import type { FightPlayOptions, FightStage, Stage, Timing } from '../src/battle/stage';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

class MapStage implements Stage {
  played: BattleEvent[] = [];
  settled: BattleEvent[][] = [];
  sync(): void {}
  setOverlay(_o: Overlay): void {}
  preview(_u: string, _p: Pos[] | null): void {}
  async play(ev: BattleEvent, _s: BattleState, t: Timing): Promise<void> {
    t.ms(100);
    this.played.push(ev);
  }
  settle(events: readonly BattleEvent[]): void {
    this.settled.push([...events]);
  }
}

/** A scene player that records what it is asked and finishes when told (or at once). */
class FakeFight implements FightStage {
  scripts: FightScript[] = [];
  options: FightPlayOptions[] = [];
  skips = 0;
  hold = false;
  failPrepare = false;
  private release: (() => void) | null = null;
  async prepare(): Promise<void> {
    if (this.failPrepare) throw new Error('no art');
  }
  play(script: FightScript, _s: BattleState, o: FightPlayOptions): Promise<void> {
    this.scripts.push(script);
    this.options.push(o);
    for (const st of script.steps) if (st.kind === 'impact') o.onHp(st.target, st.hpAfter, 10);
    if (!this.hold) return Promise.resolve();
    return new Promise((r) => (this.release = r));
  }
  skip(): void {
    this.skips++;
    this.release?.();
  }
}

function sure(): GameData {
  const d = fixtureData();
  for (const id of ['maw', 'hush', 'needles']) {
    d.weapons[id]!.hit = 300;
    d.weapons[id]!.crit = 0;
  }
  return d;
}

const ROW = ['........', '........', '........', '........'];
const battle = (d: GameData) =>
  makeBattle(
    ROW,
    [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('b', 'brute', 'player', 0, 2, { weaponId: 'maw' }),
      place('t', 'rogue', 'player', 0, 3, { weaponId: 'needles' }),
      place('e', 'rogue', 'enemy', 2, 0),
      place('g', 'fighter', 'enemy', 2, 2),
      place('f', 'rogue', 'enemy', 7, 3, { ai: { behavior: 'hold' } }),
    ],
    { data: d, seed: 11 },
  );

function rig(state: BattleState, data: GameData, mode: SceneMode = 'full') {
  const waits: number[] = [];
  const map = new MapStage();
  const fight = new FakeFight();
  const c = new BattleController(state, data, {
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    sceneMode: mode,
  });
  c.attachStage(map);
  c.attachFightStage(fight);
  return { c, map, fight, waits };
}

async function attack(c: BattleController, unit: Pos, to: Pos, target: Pos): Promise<void> {
  c.tapTile(unit);
  c.tapTile(to);
  c.command('attack');
  c.tapTile(target);
  c.command('confirm');
  await c.whenIdle();
}

describe('battle scenes in the controller', () => {
  it('a fight plays a scene, the map snaps to the outcome, and the state is the map-only result', async () => {
    const d = fixtureData();
    const s = battle(d);
    const { c, map, fight } = rig(s, d);
    await c.start();
    await attack(c, pos(0, 0), pos(1, 0), pos(2, 0));
    expect(fight.scripts).toHaveLength(1);
    expect(fight.scripts[0]!.kind).toBe('combat');
    expect(map.settled).toHaveLength(1);
    expect(map.settled[0]![0]!.type).toBe('combatStarted');
    expect(map.played.some((e) => e.type === 'strike')).toBe(false);
    const expected = applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, d).state;
    expect(c.view.state).toEqual(expected);
    expect(c.view.fight).toBeNull();
  });

  it('scenes Off plays the fight on the map, with the same state', async () => {
    const d = fixtureData();
    const s = battle(d);
    const { c, map, fight } = rig(s, d, 'off');
    await c.start();
    await attack(c, pos(0, 0), pos(1, 0), pos(2, 0));
    expect(fight.scripts).toHaveLength(0);
    expect(map.played.some((e) => e.type === 'strike')).toBe(true);
    expect(c.view.state).toEqual(applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, d).state);
  });

  it('Fast halves scene time, and the speed setting scales it too', async () => {
    const d = fixtureData();
    const { c, fight } = rig(battle(d), d, 'fast');
    await c.start();
    c.setSpeed('fast');
    await attack(c, pos(0, 0), pos(1, 0), pos(2, 0));
    expect(fight.options[0]!.scale).toBeCloseTo(0.5 * 0.45);
  });

  it('a tap during a scene skips it to the end; the rest of that playback is instant', async () => {
    const d = fixtureData();
    const s = battle(d);
    const { c, fight } = rig(s, d);
    fight.hold = true;
    await c.start();
    c.tapTile(pos(0, 0));
    c.tapTile(pos(1, 0));
    c.command('attack');
    c.tapTile(pos(2, 0));
    c.command('confirm');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.view.fight).not.toBeNull();
    expect(c.view.fight!.hp.e!.hp).toBe(c.view.state.units.find((u) => u.id === 'e')!.hp);
    c.tapTile(pos(5, 3));
    await c.whenIdle();
    expect(fight.skips).toBe(1);
    expect(c.view.fight).toBeNull();
    expect(c.view.state).toEqual(applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, d).state);
  });

  it('a scene that fails to load leaves the game going, with the outcome on the map', async () => {
    const d = fixtureData();
    const s = battle(d);
    const { c, map, fight } = rig(s, d);
    fight.failPrepare = true;
    await c.start();
    await attack(c, pos(0, 0), pos(1, 0), pos(2, 0));
    expect(map.settled).toHaveLength(1);
    expect(c.view.busy).toBe(false);
    expect(c.view.state).toEqual(applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, d).state);
  });

  it('enemy phase fights play scenes too', async () => {
    const d = fixtureData();
    const s = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 2, 0)], { data: d, seed: 3 });
    const { c, fight } = rig(s, d);
    await c.start();
    c.requestEndTurn();
    c.confirmEndTurn();
    await c.whenIdle();
    expect(fight.scripts.length).toBeGreaterThan(0);
    expect(fight.scripts[0]!.fighters[0]!.unitId).toBe('e');
    expect(fight.scripts[0]!.fighters[0]!.side).toBe('right');
  });
});

describe('powers in the controller', () => {
  it('the menu lists Power for bearers, disabled with the gauge when it is not full', async () => {
    const d = sure();
    const { c } = rig(battle(d), d);
    await c.start();
    c.tapTile(pos(0, 2));
    c.tapTile(pos(1, 2));
    expect(c.view.menu).toContain('power');
    expect(c.view.powerOption).toEqual({ name: 'Devour', resolve: 20, cost: 100, reason: 'Resolve 20/100' });
    c.command('power');
    expect(c.view.selection.kind).toBe('menu');
    c.command('cancel');
    c.tapTile(pos(0, 0));
    expect(c.view.selection).toEqual({ kind: 'unit', unitId: 'p' });
    c.tapTile(pos(1, 0));
    expect(c.view.menu).not.toContain('power');
  });

  it('Devour: pick a target, see the forecast, confirm; the cut-in plays, then the scene', async () => {
    const d = sure();
    const s = patchUnit(battle(d), 'b', { resolve: 100 });
    const { c, fight, waits } = rig(s, d);
    await c.start();
    c.tapTile(pos(0, 2));
    c.tapTile(pos(1, 2));
    expect(c.view.powerOption?.reason).toBeNull();
    c.command('power');
    expect(c.view.selection).toMatchObject({ kind: 'target', mode: 'power' });
    c.tapTile(pos(2, 2));
    expect(c.view.selection).toMatchObject({ kind: 'powerConfirm', aim: { targetId: 'g' } });
    expect(c.view.power?.plan.powerId).toBe('devour');
    c.command('back');
    expect(c.view.selection).toMatchObject({ kind: 'target', mode: 'power' });
    c.tapTile(pos(2, 2));
    c.command('confirm');
    await c.whenIdle();
    expect(waits).toContain(CUT_IN_MS);
    expect(fight.scripts[0]!.power?.powerId).toBe('devour');
    expect(c.view.state.units.find((u) => u.id === 'b')!.resolve).toBe(0);
  });

  it('Scatter: a direction from the pad or a tap on the red line; the forecast lists each target', async () => {
    const d = sure();
    const s = patchUnit(patchUnit(battle(d), 't', { resolve: 100 }), 'f', { pos: pos(3, 3) });
    const { c, fight } = rig(s, d);
    await c.start();
    c.tapTile(pos(0, 3));
    c.tapTile(pos(0, 3));
    c.command('power');
    expect(c.view.selection).toMatchObject({ kind: 'target', mode: 'power' });
    c.command('up');
    expect(c.view.selection.kind).toBe('target');
    c.tapTile(pos(2, 3));
    expect(c.view.selection).toMatchObject({ kind: 'powerConfirm', aim: { dir: 'right' } });
    expect(c.view.power?.targets.map((t) => t.unitId)).toEqual(['f']);
    c.command('back');
    c.command('right');
    expect(c.view.selection).toMatchObject({ kind: 'powerConfirm', aim: { dir: 'right' } });
    c.command('confirm');
    await c.whenIdle();
    expect(fight.scripts[0]!.power?.powerId).toBe('scatter');
  });

  it('with scenes Off a power still gets its cut-in and plays on the map', async () => {
    const d = sure();
    const s = patchUnit(battle(d), 'b', { resolve: 100 });
    const { c, fight, map, waits } = rig(s, d, 'off');
    await c.start();
    c.tapTile(pos(0, 2));
    c.tapTile(pos(1, 2));
    c.command('power');
    c.tapTile(pos(2, 2));
    c.command('confirm');
    await c.whenIdle();
    expect(fight.scripts).toHaveLength(0);
    expect(waits.some((w) => w === Math.round(CUT_IN_MS * 0.5))).toBe(true);
    expect(map.played.some((e) => e.type === 'powerUsed')).toBe(true);
  });
});

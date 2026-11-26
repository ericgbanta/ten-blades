import { describe, expect, it } from 'vitest';
import { createBattle, healAmount, type BattleEvent, type BattleState, type Pos } from '../src/core';
import { gameData } from '../src/data';
import { BattleController } from '../src/battle/controller';
import type { Overlay } from '../src/battle/selection';
import type { Stage, Timing } from '../src/battle/stage';
import { NEW_GAME } from '../src/battle/setup';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

class FakeStage implements Stage {
  events: BattleEvent[] = [];
  overlays: Overlay[] = [];
  previews: { unitId: string; path: Pos[] | null }[] = [];
  syncs = 0;
  sync(): void {
    this.syncs++;
  }
  setOverlay(o: Overlay): void {
    this.overlays.push(o);
  }
  preview(unitId: string, path: Pos[] | null): void {
    this.previews.push({ unitId, path });
  }
  async play(ev: BattleEvent, _s: BattleState, t: Timing): Promise<void> {
    t.ms(100);
    this.events.push(ev);
  }
}

const instant = () => Promise.resolve();

function setup(state: BattleState, data = fixtureData()) {
  const stage = new FakeStage();
  const c = new BattleController(state, data, { sleep: instant });
  c.attachStage(stage);
  return { c, stage };
}

// Fighter p at 0,0 can reach the rogue at 3,0; a far rogue at 7,3 keeps the battle going.
const small = () =>
  makeBattle(
    ['........', '........', '........', '........'],
    [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('q', 'fighter', 'player', 0, 3),
      place('e', 'rogue', 'enemy', 3, 0),
      place('f', 'rogue', 'enemy', 7, 3, { ai: { behavior: 'hold' } }),
    ],
  );

describe('BattleController', () => {
  it('previews a move and returns the token home on cancel', () => {
    const { c, stage } = setup(small());
    c.tapTile(pos(0, 0));
    expect(c.view.selection).toEqual({ kind: 'unit', unitId: 'p' });
    expect(stage.overlays.at(-1)!.move.length).toBeGreaterThan(0);
    c.tapTile(pos(2, 0));
    expect(c.view.menu).toEqual(['attack', 'wait', 'cancel']);
    expect(stage.previews.at(-1)).toEqual({ unitId: 'p', path: [pos(0, 0), pos(1, 0), pos(2, 0)] });
    c.command('cancel');
    expect(c.view.selection).toEqual({ kind: 'unit', unitId: 'p' });
    expect(stage.previews.at(-1)).toEqual({ unitId: 'p', path: null });
  });

  it('shows the forecast, applies the attack and plays every event', async () => {
    const { c, stage } = setup(small());
    c.tapTile(pos(0, 0));
    c.tapTile(pos(2, 0));
    c.command('attack');
    c.tapTile(pos(3, 0));
    const fc = c.view.forecast!;
    expect(fc.attacker.unitId).toBe('p');
    expect(fc.defenderId).toBe('e');
    c.command('confirm');
    expect(c.view.busy).toBe(true);
    expect(c.view.forecast).toBeNull();
    await c.whenIdle();
    expect(c.view.busy).toBe(false);
    const types = stage.events.map((e) => e.type);
    expect(types.slice(0, 2)).toEqual(['unitMoved', 'combatStarted']);
    expect(types).toContain('strike');
    const p = c.view.state.units.find((u) => u.id === 'p')!;
    expect(p.pos).toEqual(pos(2, 0));
    expect(p.acted).toBe(true);
    // q has not acted, so it stays the player phase.
    expect(c.view.state.phase).toBe('player');
  });

  it('asks before ending the turn while units can act, then runs the enemy phase', async () => {
    const { c, stage } = setup(small());
    c.requestEndTurn();
    expect(c.view.confirmEnd).toBe(2);
    c.cancelEndTurn();
    expect(c.view.confirmEnd).toBeNull();
    c.requestEndTurn();
    c.confirmEndTurn();
    await c.whenIdle();
    const s = c.view.state;
    expect(s.phase).toBe('player');
    expect(s.turn).toBe(2);
    // The charging rogue moved during the enemy phase.
    expect(stage.events.some((e) => e.type === 'unitMoved' && e.unitId === 'e')).toBe(true);
    expect(c.view.banner).toBeNull();
  });

  it('ends the turn by itself once every player unit has acted', async () => {
    const { c } = setup(small());
    c.tapTile(pos(0, 3));
    c.tapTile(pos(0, 3));
    c.command('wait');
    await c.whenIdle();
    expect(c.view.state.phase).toBe('player');
    c.tapTile(pos(0, 0));
    c.tapTile(pos(0, 1));
    c.command('wait');
    await c.whenIdle();
    expect(c.view.state.turn).toBe(2);
    expect(c.view.state.phase).toBe('player');
  });

  it('ignores map taps while busy and turns them into a skip', async () => {
    let release: () => void = () => {};
    const stage = new FakeStage();
    const c = new BattleController(small(), fixtureData(), {
      sleep: (_ms, onCancel) => new Promise<void>((r) => {
        release = r;
        onCancel(r);
      }),
    });
    c.attachStage(stage);
    const started = c.start();
    expect(c.view.banner).toEqual({ phase: 'player', turn: 1 });
    c.tapTile(pos(0, 0));
    expect(c.view.selection).toEqual({ kind: 'none' });
    await started;
    expect(c.view.banner).toBeNull();
    expect(c.view.busy).toBe(false);
    release();
  });

  it('reports the summary when the battle ends', async () => {
    const one = makeBattle(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 1, 0)]);
    const weak = patchUnit(one, 'e', { hp: 1, stats: { spd: 0, lck: 0 } });
    const data = fixtureData();
    data.weapons.axe!.hit = 300;
    const { c } = setup(weak, data);
    c.tapTile(pos(0, 0));
    c.tapTile(pos(0, 0));
    c.command('attack');
    c.tapTile(pos(1, 0));
    c.command('confirm');
    await c.whenIdle();
    expect(c.view.ended).toMatchObject({ result: 'victory', turns: 1, fallenPlayerUnitIds: [] });
    c.tapTile(pos(0, 0));
    expect(c.view.selection).toEqual({ kind: 'none' });
  });

  it('previews heals with the amount the core will apply', () => {
    const s = patchUnit(
      makeBattle(['....'], [
        place('p', 'fighter', 'player', 0, 0, { isLord: true }),
        place('h', 'healer', 'player', 1, 0),
        place('e', 'rogue', 'enemy', 3, 0),
      ]),
      'p',
      { hp: 4 },
    );
    const { c } = setup(s);
    c.tapTile(pos(1, 0));
    c.tapTile(pos(1, 0));
    expect(c.view.menu).toEqual(['heal', 'wait', 'cancel']);
    c.command('heal');
    c.tapTile(pos(0, 0));
    expect(c.view.heal).toEqual({ targetId: 'p', amount: healAmount(s, 'h', 'p', fixtureData()) });
    expect(c.view.heal!.amount).toBe(14);
  });

  it('plays the real prologue through two turns on a fixed seed', async () => {
    const state = createBattle(gameData.maps.prologue!, NEW_GAME, 7, gameData);
    const { c } = setup(state, gameData);
    for (let turn = 1; turn <= 2; turn++) {
      c.requestEndTurn();
      c.confirmEndTurn();
      await c.whenIdle();
    }
    expect(c.view.state.turn).toBe(3);
    expect(c.view.state.units.some((u) => u.team === 'enemy' && (u.pos.x !== 3 || u.pos.y !== 1))).toBe(true);
  });
});

// Mid-battle scenes through the real controller: the controller pauses on a scene until the UI says it is done,
// the suspend checkpoint carries the scenes still owed, and a resume plays them once without applying anything
// twice. Also talking through taps on the skirmish test map.

import { describe, expect, it } from 'vitest';
import { createBattle, type BattleEvent, type BattleState } from '../src/core';
import { gameData } from '../src/data';
import { QUICK_BATTLE } from '../src/battle/setup';
import { BattleController, type CheckpointExtra } from '../src/battle/controller';
import type { Stage, Timing } from '../src/battle/stage';

class FakeStage implements Stage {
  events: BattleEvent[] = [];
  sync(): void {}
  setOverlay(): void {}
  preview(): void {}
  async play(ev: BattleEvent, _s: BattleState, t: Timing): Promise<void> {
    t.ms(1);
    this.events.push(ev);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function until(_c: BattleController, check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  expect(check()).toBe(true);
}

function rig(state: BattleState, o: { scenes?: boolean; pending?: string[] } = {}) {
  const checkpoints: { state: BattleState; extra: CheckpointExtra }[] = [];
  const c = new BattleController(state, gameData, {
    sleep: () => Promise.resolve(),
    scenes: o.scenes ?? true,
    pendingScenes: o.pending,
    onCheckpoint: (s, extra) => checkpoints.push({ state: s, extra }),
  });
  c.attachStage(new FakeStage());
  return { c, checkpoints };
}

const prologue = (seed = 7) => createBattle(gameData.maps.prologue!, QUICK_BATTLE, seed, gameData);

describe('mid-battle scenes', () => {
  it('the opening scene holds the battle until the UI is done, and the checkpoint owes it until then', async () => {
    const { c, checkpoints } = rig(prologue());
    const started = c.start();
    await until(c, () => c.view.scene !== null);
    expect(c.view.scene).toBe('prologue_b_start');
    expect(c.view.busy).toBe(true);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.state.started).toBe(true);
    expect(checkpoints[0]!.extra.scenes).toEqual(['prologue_b_start']);
    // Map taps while a scene is up do nothing to the battle.
    c.tapTile({ x: 4, y: 10 });
    expect(c.view.scene).toBe('prologue_b_start');
    c.sceneDone();
    await started;
    expect(c.view.scene).toBeNull();
    expect(c.view.busy).toBe(false);
    expect(checkpoints.at(-1)!.extra.scenes).toEqual([]);
    expect(checkpoints.at(-1)!.state).toBe(checkpoints[0]!.state);
  });

  it('a resume owes the scene: it plays first, once, and the state is not touched again', async () => {
    const first = rig(prologue());
    void first.c.start();
    await until(first.c, () => first.c.view.scene !== null);
    const saved = JSON.parse(JSON.stringify(first.checkpoints[0]!)) as { state: BattleState; extra: CheckpointExtra };

    const again = rig(saved.state, { pending: saved.extra.scenes });
    const started = again.c.start();
    await until(again.c, () => again.c.view.scene !== null);
    expect(again.c.view.scene).toBe('prologue_b_start');
    again.c.sceneDone();
    await started;
    expect(again.c.view.state).toEqual(saved.state);
    expect(again.c.view.state.firedEvents).toEqual(['start_lesson']);
    expect(again.checkpoints.at(-1)!.extra.scenes).toEqual([]);
  });

  it('with scenes off (quick battles) the events still fire but nothing waits', async () => {
    const { c, checkpoints } = rig(prologue(), { scenes: false });
    await c.start();
    expect(c.view.scene).toBeNull();
    expect(c.view.state.firedEvents).toEqual(['start_lesson']);
    expect(checkpoints.every((k) => k.extra.scenes.length === 0)).toBe(true);
  });

  it('a scene fired in the enemy phase plays in order, then the AI goes on', async () => {
    const { c } = rig(prologue());
    const started = c.start();
    await until(c, () => c.view.scene !== null);
    c.sceneDone();
    await started;
    c.requestEndTurn();
    c.confirmEndTurn();
    // Turn 2's player phase brings the terrain lesson once the enemy phase is over.
    await until(c, () => c.view.scene !== null);
    expect(c.view.scene).toBe('prologue_b_terrain');
    expect(c.view.state.turn).toBe(2);
    expect(c.view.state.phase).toBe('player');
    c.sceneDone();
    await c.whenIdle();
    expect(c.view.busy).toBe(false);
  });
});

describe('talking by taps', () => {
  it('the skirmish deserter: the menu offers Talk next to it, a tap on it talks, and it joins', async () => {
    const s = createBattle(gameData.maps.skirmish_test!, QUICK_BATTLE, 7, gameData);
    const { c } = rig(s, { scenes: false });
    await c.start();
    c.tapTile({ x: 5, y: 16 });
    c.tapTile({ x: 7, y: 13 });
    expect(c.view.menu).toEqual(['attack', 'talk', 'wait', 'cancel']);
    c.command('talk');
    expect(c.view.selection).toMatchObject({ kind: 'target', mode: 'talk' });
    c.tapTile({ x: 8, y: 13 });
    await c.whenIdle();
    const d = c.view.state.units.find((u) => u.id === 'deserter')!;
    expect(d.team).toBe('player');
    expect(c.view.state.recruited).toEqual(['deserter']);
    expect(c.view.state.flags.skirmish_deserter_joined).toBe(true);
  });
});

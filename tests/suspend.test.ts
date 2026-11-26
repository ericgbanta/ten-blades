// Suspend and resume through the real controller, the BattleSaver and the
// in-memory storage, on the prologue with fixed seeds.

import { describe, expect, it } from 'vitest';
import { createBattle, planUnitAction, type Action, type AiState, type BattleEvent, type BattleState } from '../src/core';
import { chapters, gameData } from '../src/data';
import { BattleController } from '../src/battle/controller';
import type { Stage, Timing } from '../src/battle/stage';
import { BattleSaver } from '../src/save/battleSaver';
import { battleSetup, newCampaign } from '../src/save/campaign';
import type { CampaignSave, SaveContext, SuspendSave } from '../src/save/format';
import { readSuspend } from '../src/save/load';
import { SaveQueue } from '../src/save/queue';
import { memoryStorage, type SaveStorage } from '../src/save/storage';

const ctx: SaveContext = { data: gameData, chapters };
const CHARGE: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };

class LogStage implements Stage {
  constructor(private readonly log: string[] = []) {}
  events: BattleEvent[] = [];
  sync(): void {}
  setOverlay(): void {}
  preview(): void {}
  async play(ev: BattleEvent, _s: BattleState, t: Timing): Promise<void> {
    t.ms(100);
    this.events.push(ev);
    this.log.push(ev.type);
  }
}

const campaign = (style: 'vanguard' | 'duelist' = 'vanguard'): CampaignSave =>
  newCampaign({ settings: { difficulty: 'hard', permadeath: 'classic' }, mc: { name: 'Ash', pronouns: 'they', style } }, chapters, 1);

interface Rig {
  c: BattleController;
  stage: LogStage;
  store: SaveStorage;
  queue: SaveQueue;
  checkpoints: BattleState[];
  /** How many events the stage had played at each checkpoint. */
  eventCounts: number[];
  log: string[];
}

function rig(state: BattleState, store: SaveStorage, camp: CampaignSave, showDanger = false): Rig {
  const queue = new SaveQueue((e) => {
    throw e;
  });
  const log: string[] = [];
  const checkpoints: BattleState[] = [];
  const eventCounts: number[] = [];
  let clock = 1000;
  const saver = new BattleSaver({ store, queue, slot: 1, campaign: camp, chapters, now: () => clock++ });
  const stage = new LogStage(log);
  const c = new BattleController(state, gameData, {
    sleep: () => Promise.resolve(),
    showDanger,
    onCheckpoint: (s, extra) => {
      log.push('checkpoint');
      checkpoints.push(s);
      eventCounts.push(stage.events.length);
      saver.checkpoint(s, extra);
    },
  });
  c.attachStage(stage);
  return { c, stage, store, queue, checkpoints, eventCounts, log };
}

/** Play one player action the way a player would: taps and menu commands. */
async function play(c: BattleController, a: Action): Promise<void> {
  const s = c.view.state;
  if (a.type === 'endPhase') {
    c.requestEndTurn();
    if (c.view.confirmEnd !== null) c.confirmEndTurn();
  } else {
    const unit = s.units.find((u) => u.id === a.unitId)!;
    c.tapTile(unit.pos);
    c.tapTile(a.to);
    if (a.type === 'wait') c.command('wait');
    else {
      c.command(a.type);
      const target = s.units.find((u) => u.id === a.targetId)!;
      c.tapTile(target.pos);
      c.command('confirm');
    }
  }
  await c.whenIdle();
}

/** The scripted player: the first ready unit does what the charge AI would. */
function nextMove(s: BattleState): Action | null {
  if (s.result !== 'ongoing' || s.phase !== 'player') return null;
  const ready = s.units.find((u) => u.team === 'player' && u.alive && !u.acted);
  return ready ? planUnitAction(s, ready.id, gameData, CHARGE) : null;
}

async function playMoves(r: Rig, n: number): Promise<Action[]> {
  const done: Action[] = [];
  for (let i = 0; i < n; i++) {
    const a = nextMove(r.c.view.state);
    if (!a) break;
    await play(r.c, a);
    done.push(a);
  }
  return done;
}

/** What a page reload does: read the stored suspend save through JSON. */
async function reload(store: SaveStorage, queue: SaveQueue): Promise<SuspendSave> {
  await queue.idle();
  const r = await store.loadSuspend();
  if (!r.ok || !r.value) throw new Error(`no suspend save: ${r.ok ? 'empty' : r.error}`);
  const again = readSuspend(JSON.parse(JSON.stringify(r.value)), ctx);
  if (!again.ok) throw new Error(again.error);
  return again.value;
}

async function freshRig(seed: number, camp = campaign()): Promise<Rig> {
  const battle = createBattle(gameData.maps.prologue!, battleSetup(camp), seed, gameData);
  const r = rig(battle, memoryStorage(ctx), camp);
  await r.c.start();
  return r;
}

describe('suspend and resume', () => {
  it('writes a suspend save at the start, before the first action', async () => {
    const r = await freshRig(11);
    const s = await reload(r.store, r.queue);
    expect(s.battle).toEqual(r.c.view.state);
    expect(s.slot).toBe(1);
  });

  for (const [seed, k] of [
    [11, 1],
    [11, 2],
    [23, 3],
    [23, 5],
  ] as const) {
    it(`seed ${seed}: suspending after ${k} actions and resuming gives the same states and events`, async () => {
      const N = 9;
      const full = await freshRig(seed);
      await playMoves(full, N);
      const fullState = full.c.view.state;

      const first = await freshRig(seed);
      await playMoves(first, k);
      const saved = await reload(first.store, first.queue);
      expect(saved.battle).toEqual(first.c.view.state);

      const second = rig(saved.battle, first.store, saved.campaign);
      await second.c.start();
      await playMoves(second, N - k);
      expect(second.c.view.state).toEqual(fullState);
      expect([...first.stage.events, ...second.stage.events]).toEqual(full.stage.events);
    });
  }

  it('resuming from a checkpoint taken before the enemy phase replays it exactly', async () => {
    const full = await freshRig(11);
    await playMoves(full, 8);
    // A checkpoint written right after the player's last action of a turn, before the AI moved.
    const mid = full.checkpoints.find((s) => s.result === 'ongoing' && (s.phase !== 'player' || !nextMove(s)));
    expect(mid).toBeDefined();
    const index = full.checkpoints.indexOf(mid!);
    const store = memoryStorage(ctx);
    const r = rig(JSON.parse(JSON.stringify(mid)) as BattleState, store, campaign());
    await r.c.start();
    // It played on to the same rest as the uninterrupted run.
    expect(r.c.view.state).toEqual(full.checkpoints[index + 1]);
    // Its events are the AI's part of what the uninterrupted run played up to that rest.
    const end = full.eventCounts[index + 1]!;
    expect(r.stage.events.length).toBeGreaterThan(0);
    expect(r.stage.events).toEqual(full.stage.events.slice(end - r.stage.events.length, end));
    expect(r.stage.events.some((e) => e.type === 'unitMoved' && e.unitId !== 'mc' && e.unitId !== 'stranger')).toBe(true);
  });

  it('reloading before an attack cannot change its outcome', async () => {
    // Find a state where an attack is the next move.
    const r = await freshRig(11);
    let a = nextMove(r.c.view.state);
    for (let i = 0; i < 12 && a && a.type !== 'attack'; i++) {
      await play(r.c, a);
      a = nextMove(r.c.view.state);
    }
    expect(a?.type).toBe('attack');
    const saved = await reload(r.store, r.queue);

    const outcomes: BattleState[] = [];
    const events: BattleEvent[][] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const again = rig(structuredClone(saved.battle), memoryStorage(ctx), saved.campaign);
      await again.c.start();
      await play(again.c, a!);
      outcomes.push(again.c.view.state);
      events.push(again.stage.events);
    }
    await play(r.c, a!);
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(r.c.view.state).toEqual(outcomes[0]);
    expect(events[1]).toEqual(events[0]);
    expect(events[0]!.some((e) => e.type === 'strike')).toBe(true);
  });

  it('saves the outcome of an attack before its animation plays', async () => {
    const r = await freshRig(11);
    let a = nextMove(r.c.view.state);
    for (let i = 0; i < 12 && a && a.type !== 'attack'; i++) {
      await play(r.c, a);
      a = nextMove(r.c.view.state);
    }
    expect(a?.type).toBe('attack');
    r.log.length = 0;
    const before = r.checkpoints.length;
    await play(r.c, a!);
    expect(r.log[0]).toBe('checkpoint');
    expect(r.log.indexOf('strike')).toBeGreaterThan(0);
    // That first checkpoint already holds the result of the strikes.
    const afterAttack = r.checkpoints[before]!;
    const target = afterAttack.units.find((u) => u.id === (a as { targetId: string }).targetId)!;
    const startHp = r.checkpoints[before - 1]!.units.find((u) => u.id === target.id)!.hp;
    const struck = r.stage.events.filter((e) => e.type === 'strike' && e.defenderId === target.id && e.hit);
    expect(target.hp).toBe(struck.length > 0 ? (struck.at(-1) as { hpAfter: number }).hpAfter : startHp);
  });

  it('keeps the danger zone toggle across a resume', async () => {
    const r = await freshRig(11);
    r.c.toggleDanger();
    await playMoves(r, 1);
    const saved = await reload(r.store, r.queue);
    expect(saved.controller.showDanger).toBe(true);
    const again = rig(saved.battle, r.store, saved.campaign, saved.controller.showDanger);
    expect(again.c.view.showDanger).toBe(true);
  });

  it('on victory writes the campaign to its slot and clears the suspend save', async () => {
    const camp = newCampaign({ settings: { difficulty: 'normal', permadeath: 'casual' }, mc: { name: 'Ash', pronouns: 'he', style: 'duelist' } }, chapters, 1);
    const battle = createBattle(gameData.maps.prologue!, battleSetup(camp), 7, gameData);
    const r = rig(battle, memoryStorage(ctx), camp);
    await r.c.start();
    await playMoves(r, 60);
    expect(r.c.view.state.result).toBe('victory');
    expect(r.c.view.ended).not.toBeNull();
    await r.queue.idle();
    expect(await r.store.loadSuspend()).toEqual({ ok: true, value: null });
    const slot = await r.store.loadSlot(1);
    expect(slot.ok && slot.value?.progress).toEqual({ current: null, completed: ['prologue'] });
    expect(slot.ok && slot.value?.party.map((u) => u.id)).toEqual(['mc', 'stranger']);
  });

  it('a suspend save holding a finished battle completes it on resume', async () => {
    const camp = campaign();
    const store = memoryStorage(ctx);
    const battle = createBattle(gameData.maps.prologue!, battleSetup(camp), 7, gameData);
    const r = rig({ ...battle, result: 'victory' }, store, camp);
    await r.c.start();
    await r.queue.idle();
    expect(r.c.view.ended?.result).toBe('victory');
    expect(await store.loadSuspend()).toEqual({ ok: true, value: null });
    const slot = await store.loadSlot(1);
    expect(slot.ok && slot.value?.progress.completed).toEqual(['prologue']);
  });

  it('on defeat clears the suspend save and leaves the slot alone', async () => {
    const camp = campaign();
    const store = memoryStorage(ctx);
    await store.saveSlot(1, camp);
    const battle = createBattle(gameData.maps.prologue!, battleSetup(camp), 7, gameData);
    const r = rig(battle, store, camp);
    await r.c.start();
    await r.queue.idle();
    expect((await store.loadSuspend()).ok).toBe(true);
    // The MC falls.
    const lost: BattleState = { ...r.c.view.state, result: 'defeat' };
    const after = rig(lost, store, camp);
    await after.c.start();
    await after.queue.idle();
    expect(await store.loadSuspend()).toEqual({ ok: true, value: null });
    expect(await store.loadSlot(1)).toEqual({ ok: true, value: camp });
  });
});

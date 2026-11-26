import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/core';
import { chapters, gameData } from '../src/data';
import { battleSetup, newCampaign, suspendSave } from '../src/save/campaign';
import type { CampaignSave, SaveContext } from '../src/save/format';
import { SaveQueue } from '../src/save/queue';
import { MemoryBackend, createSaveStorage, memoryStorage } from '../src/save/storage';
import v5 from './fixtures/save-v5.json';

const ctx: SaveContext = { data: gameData, chapters };
const campaign = (name = 'Ash'): CampaignSave =>
  newCampaign({ settings: { difficulty: 'normal', permadeath: 'classic' }, mc: { name, pronouns: 'he', style: 'vanguard' } }, chapters, 10);

describe('save storage (in memory)', () => {
  it('round trips a campaign through a slot', async () => {
    const store = memoryStorage(ctx);
    expect(store.persistent).toBe(false);
    expect(await store.loadSlot(1)).toEqual({ ok: true, value: null });
    await store.saveSlot(2, v5 as unknown as CampaignSave);
    expect(await store.loadSlot(2)).toEqual({ ok: true, value: v5 });
    const slots = await store.listSlots();
    expect(slots.map((s) => [s.slot, s.save?.mc.name ?? null, s.error])).toEqual([
      [1, null, null],
      [2, 'Ysolde Ærwyn', null],
      [3, null, null],
    ]);
    await store.deleteSlot(2);
    expect(await store.loadSlot(2)).toEqual({ ok: true, value: null });
  });

  it('stores a copy, not the caller object', async () => {
    const store = memoryStorage(ctx);
    const c = campaign();
    await store.saveSlot(1, c);
    c.gold = 999;
    const r = await store.loadSlot(1);
    expect(r.ok && r.value?.gold).toBe(0);
  });

  it('round trips the suspend save and clears it', async () => {
    const store = memoryStorage(ctx);
    const c = campaign();
    const battle = createBattle(gameData.maps.prologue!, battleSetup(c), 3, gameData);
    const s = suspendSave(3, c, battle, { showDanger: true, scenes: [] }, 50);
    expect(await store.loadSuspend()).toEqual({ ok: true, value: null });
    await store.saveSuspend(s);
    expect(await store.loadSuspend()).toEqual({ ok: true, value: s });
    await store.clearSuspend();
    expect(await store.loadSuspend()).toEqual({ ok: true, value: null });
  });

  it('refuses to write an invalid save', async () => {
    const store = memoryStorage(ctx);
    await expect(store.saveSlot(1, { ...campaign(), gold: -5 })).rejects.toThrow(/invalid save: gold/);
  });

  it('reports a damaged slot without hiding the others', async () => {
    const backend = new MemoryBackend();
    const store = createSaveStorage(backend, ctx, true);
    await backend.put('slot1', { version: 1, kind: 'campaign' });
    await store.saveSlot(3, campaign('Bryn'));
    const slots = await store.listSlots();
    expect(slots[0]!.save).toBeNull();
    expect(slots[0]!.error).toMatch(/could not be read/);
    expect(slots[2]!.save?.mc.name).toBe('Bryn');
  });
});

describe('save queue', () => {
  it('runs writes in order and coalesces waiting writes with the same key', async () => {
    const log: string[] = [];
    let release: () => void = () => {};
    const q = new SaveQueue();
    q.push(() => new Promise<void>((r) => (release = () => (log.push('first'), r()))), 'suspend');
    q.push(async () => void log.push('a'), 'suspend');
    q.push(async () => void log.push('b'), 'suspend');
    q.push(async () => void log.push('commit'));
    q.push(async () => void log.push('c'), 'suspend');
    q.push(async () => void log.push('d'), 'suspend');
    release();
    await q.idle();
    expect(log).toEqual(['first', 'b', 'commit', 'd']);
  });

  it('reports errors and keeps going', async () => {
    const errors: unknown[] = [];
    const q = new SaveQueue((e) => errors.push(e));
    const log: string[] = [];
    q.push(async () => {
      throw new Error('disk full');
    });
    q.push(async () => void log.push('after'));
    await q.idle();
    expect(errors).toHaveLength(1);
    expect(log).toEqual(['after']);
  });
});

import { describe, expect, it } from 'vitest';
import { chapters, gameData } from '../src/data';
import { SAVE_VERSION, type SaveContext } from '../src/save/format';
import { readCampaign, readSuspend } from '../src/save/load';
import { MIGRATIONS, migrate, type MigrationStep } from '../src/save/migrate';
import v1 from './fixtures/save-v1.json';
import v1Suspend from './fixtures/suspend-v1.json';
import v2 from './fixtures/save-v2.json';
import v2Suspend from './fixtures/suspend-v2.json';
import v3 from './fixtures/save-v3.json';
import v3Suspend from './fixtures/suspend-v3.json';
import v4 from './fixtures/save-v4.json';
import { DEFAULT_LOOK } from '../src/art/mc/look';

const ctx: SaveContext = { data: gameData, chapters };

describe('migration pipeline', () => {
  it('is at version 4 with three steps, from 1, 2 and 3', () => {
    expect(SAVE_VERSION).toBe(4);
    expect(Object.keys(MIGRATIONS)).toEqual(['1', '2', '3']);
  });

  it('loads the v1 campaign fixture: everything kept, the default look added, back at the prologue outro', () => {
    const r = readCampaign(v1, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(4);
    expect(r.value.mc).toEqual({ name: 'Ysolde Ærwyn', pronouns: 'she', style: 'duelist', look: DEFAULT_LOOK });
    expect(r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
    expect(r.value.party.map((u) => u.id)).toEqual(['mc', 'stranger']);
    expect({ ...r.value, mc: null, version: null, progress: null, blades: null }).toEqual({ ...v1, mc: null, version: null, progress: null, blades: null });
  });

  it('loads the v1 suspend fixture: the nested campaign gets the look, the battle the story fields', () => {
    const r = readSuspend(v1Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(4);
    expect(r.value.campaign.version).toBe(4);
    expect(r.value.campaign.mc.look).toEqual(DEFAULT_LOOK);
    expect(r.value.campaign.progress.stage).toBe('battle');
    expect(r.value.slot).toBe(1);
    expect(r.value.controller).toEqual({ showDanger: true, scenes: [] });
    expect(r.value.battle.version).toBe(3);
  });

  it('loads the v2 campaign fixture: a finished prologue goes back to its outro, nothing else changes', () => {
    const r = readCampaign(v2, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(4);
    expect(r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
    const { blades, ...rest } = r.value;
    expect(blades).toEqual({});
    expect({ ...rest, version: 2, progress: v2.progress }).toEqual(v2);
  });

  it('a v2 campaign still in its chapter starts at the intro', () => {
    const before = { ...structuredClone(v2), progress: { current: 'prologue', completed: [] } };
    const r = readCampaign(before, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'intro', scenes: null });
  });

  it('loads the v2 suspend fixture: started, no flags or events, every unit untagged and on the map', () => {
    const r = readSuspend(v2Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.value.battle;
    expect(b).toMatchObject({ version: 3, started: true, flags: {}, firedEvents: [], recruited: [], powerLog: [] });
    expect(b.units.every((u) => u.tags.length === 0 && !u.left)).toBe(true);
    const old = v2Suspend.battle as unknown as { units: object[] };
    const strip = (u: object) => ({ ...u, tags: undefined, left: undefined, resolve: undefined, devourStacks: undefined });
    expect(b.units.map(strip)).toEqual(old.units.map(strip));
    expect(r.value.campaign.progress).toEqual({ current: 'prologue', completed: [], stage: 'battle', scenes: [] });
    expect(r.value.controller.scenes).toEqual([]);
  });

  it('loads the v3 campaign fixture: the blades its party holds go on record at tier 1, nothing else changes', () => {
    const r = readCampaign(v3, { ...ctx, sceneIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.blades).toEqual({ widows_hush: { tier: 1 } });
    expect({ ...r.value, version: 3, blades: undefined }).toEqual({ ...v3, blades: undefined });
  });

  it('loads the v3 suspend fixture: a power log, no stacks, and a starting gauge for bearers only', () => {
    const r = readSuspend(v3Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.value.battle;
    expect(b.version).toBe(3);
    expect(b.powerLog).toEqual([]);
    const start = gameData.balance.resolve.start;
    expect(b.units.map((u) => [u.id, u.resolve])).toEqual(
      b.units.map((u) => [u.id, u.weaponId === 'widows_hush_duelist' ? start : 0]),
    );
    expect(b.units.every((u) => u.devourStacks === 0)).toBe(true);
    const old = v3Suspend.battle as unknown as { units: object[] };
    const strip = (u: object) => ({ ...u, resolve: undefined, devourStacks: undefined });
    expect(b.units.map(strip)).toEqual(old.units.map(strip));
    expect(r.value.campaign.blades).toEqual({});
    expect({ ...b, version: 2, units: null, powerLog: undefined }).toEqual({ ...v3Suspend.battle, units: null });
  });

  it('loads the v4 fixture as it is', () => {
    const r = readCampaign(v4, { ...ctx, sceneIds: [] });
    expect(r).toEqual({ ok: true, value: v4 });
  });

  it('the steps never change their input and land on version 4', () => {
    for (const fixture of [v1, v1Suspend, v2, v2Suspend, v3, v3Suspend]) {
      const input = structuredClone(fixture);
      const r = migrate(input);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.version).toBe(4);
      expect(input).toEqual(fixture);
    }
  });

  it('runs the steps in order up to the target and never changes the input', () => {
    // A pretend future: v1 -> v2 adds a look, v2 -> v3 renames gold to coins.
    const steps: Record<number, MigrationStep> = {
      1: (s) => ({ ...s, version: 2, mc: { ...(s.mc as object), look: { hair: 0 } } }),
      2: (s) => {
        const { gold, ...rest } = s;
        return { ...rest, version: 3, coins: gold };
      },
    };
    const input = structuredClone(v1);
    const r = migrate(input, steps, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(3);
    expect(r.value.coins).toBe(0);
    expect(r.value.gold).toBeUndefined();
    expect((r.value.mc as { look: unknown }).look).toEqual({ hair: 0 });
    expect(input).toEqual(v1);
  });

  it('refuses a save with a missing step, a bad step, a newer or no version', () => {
    expect(migrate({ ...v1 }, {}, 2)).toEqual({ ok: false, error: 'This save version (1) can no longer be loaded.' });
    expect(migrate({ ...v1 }, { 1: (s) => ({ ...s, version: 5 }) }, 2).ok).toBe(false);
    expect(migrate({ ...v1, version: 9 })).toEqual({
      ok: false,
      error: 'This save is from a newer version of the game (save version 9). Update the game to load it.',
    });
    expect(migrate({ kind: 'campaign' })).toEqual({ ok: false, error: 'This save has no version number.' });
    expect(migrate(null).ok).toBe(false);
  });
});

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
import { DEFAULT_LOOK } from '../src/art/mc/look';

const ctx: SaveContext = { data: gameData, chapters };

describe('migration pipeline', () => {
  it('is at version 3 with two steps, from 1 and 2', () => {
    expect(SAVE_VERSION).toBe(3);
    expect(Object.keys(MIGRATIONS)).toEqual(['1', '2']);
  });

  it('loads the v1 campaign fixture: everything kept, the default look added, back at the prologue outro', () => {
    const r = readCampaign(v1, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(3);
    expect(r.value.mc).toEqual({ name: 'Ysolde Ærwyn', pronouns: 'she', style: 'duelist', look: DEFAULT_LOOK });
    expect(r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
    expect(r.value.party.map((u) => u.id)).toEqual(['mc', 'stranger']);
    expect({ ...r.value, mc: null, version: null, progress: null }).toEqual({ ...v1, mc: null, version: null, progress: null });
  });

  it('loads the v1 suspend fixture: the nested campaign gets the look, the battle the story fields', () => {
    const r = readSuspend(v1Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(3);
    expect(r.value.campaign.version).toBe(3);
    expect(r.value.campaign.mc.look).toEqual(DEFAULT_LOOK);
    expect(r.value.campaign.progress.stage).toBe('battle');
    expect(r.value.slot).toBe(1);
    expect(r.value.controller).toEqual({ showDanger: true, scenes: [] });
    expect(r.value.battle.version).toBe(2);
  });

  it('loads the v2 campaign fixture: a finished prologue goes back to its outro, nothing else changes', () => {
    const r = readCampaign(v2, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(3);
    expect(r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
    expect({ ...r.value, version: 2, progress: v2.progress }).toEqual(v2);
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
    expect(b).toMatchObject({ version: 2, started: true, flags: {}, firedEvents: [], recruited: [] });
    expect(b.units.every((u) => u.tags.length === 0 && !u.left)).toBe(true);
    const old = v2Suspend.battle as unknown as { units: object[] };
    expect(b.units.map((u) => ({ ...u, tags: undefined, left: undefined }))).toEqual(old.units.map((u) => ({ ...u, tags: undefined, left: undefined })));
    expect(r.value.campaign.progress).toEqual({ current: 'prologue', completed: [], stage: 'battle', scenes: [] });
    expect(r.value.controller.scenes).toEqual([]);
  });

  it('loads the v3 fixture as it is', () => {
    const r = readCampaign(v3, { ...ctx, sceneIds: [] });
    expect(r).toEqual({ ok: true, value: v3 });
  });

  it('the steps never change their input and land on version 3', () => {
    for (const fixture of [v1, v1Suspend, v2, v2Suspend]) {
      const input = structuredClone(fixture);
      const r = migrate(input);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.version).toBe(3);
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

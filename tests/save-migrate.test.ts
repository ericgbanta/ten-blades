import { describe, expect, it } from 'vitest';
import { chapters, gameData } from '../src/data';
import { SAVE_VERSION, type SaveContext } from '../src/save/format';
import { readCampaign, readSuspend } from '../src/save/load';
import { MIGRATIONS, migrate, type MigrationStep } from '../src/save/migrate';
import v1 from './fixtures/save-v1.json';
import v1Suspend from './fixtures/suspend-v1.json';
import v2 from './fixtures/save-v2.json';
import { DEFAULT_LOOK } from '../src/art/mc/look';

const ctx: SaveContext = { data: gameData, chapters };

describe('migration pipeline', () => {
  it('is at version 2 with one step, from 1', () => {
    expect(SAVE_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
  });

  it('loads the v1 campaign fixture: everything kept, the default look added', () => {
    const r = readCampaign(v1, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(2);
    expect(r.value.mc).toEqual({ name: 'Ysolde Ærwyn', pronouns: 'she', style: 'duelist', look: DEFAULT_LOOK });
    expect(r.value.progress).toEqual({ current: null, completed: ['prologue'] });
    expect(r.value.party.map((u) => u.id)).toEqual(['mc', 'stranger']);
    expect({ ...r.value, mc: null, version: null }).toEqual({ ...v1, mc: null, version: null });
  });

  it('loads the v1 suspend fixture: the nested campaign gets the look, the battle is untouched', () => {
    const r = readSuspend(v1Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(2);
    expect(r.value.campaign.version).toBe(2);
    expect(r.value.campaign.mc.look).toEqual(DEFAULT_LOOK);
    expect(r.value.slot).toBe(1);
    expect(r.value.controller.showDanger).toBe(true);
    expect(r.value.battle).toEqual(v1Suspend.battle);
  });

  it('loads the v2 fixture as it is', () => {
    const r = readCampaign(v2, ctx);
    expect(r).toEqual({ ok: true, value: v2 });
  });

  it('the 1 to 2 step never changes its input and lands on version 2', () => {
    const input = structuredClone(v1);
    const r = migrate(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(2);
    expect(input).toEqual(v1);
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

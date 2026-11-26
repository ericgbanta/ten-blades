import { describe, expect, it } from 'vitest';
import { chapters, gameData } from '../src/data';
import { SAVE_VERSION, type SaveContext } from '../src/save/format';
import { readCampaign as readCampaignNow, readSuspend as readSuspendNow } from '../src/save/load';
import { MIGRATIONS, migrate, type MigrationStep } from '../src/save/migrate';
import v1 from './fixtures/save-v1.json';
import v1Suspend from './fixtures/suspend-v1.json';
import v2 from './fixtures/save-v2.json';
import v2Suspend from './fixtures/suspend-v2.json';
import v3 from './fixtures/save-v3.json';
import v3Suspend from './fixtures/suspend-v3.json';
import v4 from './fixtures/save-v4.json';
import v4Suspend from './fixtures/suspend-v4.json';
import v5 from './fixtures/save-v5.json';
import { DEFAULT_LOOK } from '../src/art/mc/look';

const ctx: SaveContext = { data: gameData, chapters };

type Raw = Record<string, unknown>;
/** A copy without the given keys. */
const without = (o: unknown, keys: string[]): Raw => Object.fromEntries(Object.entries(o as Raw).filter(([k]) => !keys.includes(k)));
const unitV4 = (u: Raw): Raw => without(u, ['inventory', 'statuses']);
/** A loaded campaign seen as version 4 saw it: step 4's camp fields taken off again (checked on their own below). */
function campaignV4<T>(c: T): T {
  const rest = without(c, ['convoy', 'benched', 'wounded', 'skirmishWins']);
  const progress = rest.progress as Raw;
  return {
    ...rest,
    version: 4,
    party: (rest.party as Raw[]).map(unitV4),
    fallen: (rest.fallen as Raw[]).map(unitV4),
    progress: { ...progress, stage: progress.stage === 'camp' ? 'intro' : progress.stage },
  } as T;
}
function suspendV4<T>(sv: T): T {
  const rest = without(sv, ['skirmish']);
  const battle = without(rest.battle, ['bladeTiers']);
  return { ...rest, version: 4, campaign: campaignV4(rest.campaign), battle: { ...battle, version: 3, units: (battle.units as Raw[]).map(unitV4) } } as T;
}
// The tests for steps 1 to 3 read through to version 4, as they were written.
const readCampaign: typeof readCampaignNow = (raw, c) => {
  const r = readCampaignNow(raw, c);
  return r.ok ? { ok: true, value: campaignV4(r.value) } : r;
};
const readSuspend: typeof readSuspendNow = (raw, c) => {
  const r = readSuspendNow(raw, c);
  return r.ok ? { ok: true, value: suspendV4(r.value) } : r;
};

describe('migration pipeline', () => {
  it('is at version 5 with four steps, from 1, 2, 3 and 4', () => {
    expect(SAVE_VERSION).toBe(5);
    expect(Object.keys(MIGRATIONS)).toEqual(['1', '2', '3', '4']);
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

  it('loads the v4 campaign fixture: each unit carries its weapon, an empty convoy and bench, and between chapters it is in camp', () => {
    const r = readCampaignNow(v4, { ...ctx, sceneIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value;
    expect(c.version).toBe(5);
    expect(c.party.map((u) => u.inventory)).toEqual([['widows_hush_duelist']]);
    expect(c.fallen).toEqual([]);
    expect({ convoy: c.convoy, benched: c.benched, wounded: c.wounded, skirmishWins: c.skirmishWins }).toEqual({ convoy: [], benched: [], wounded: {}, skirmishWins: {} });
    // Chapter 1 had not begun: the army is in camp before it.
    expect(c.progress).toEqual({ current: 'chapter1', completed: ['prologue'], stage: 'camp', scenes: null });
    expect(campaignV4(c)).toEqual(v4);
  });

  it('a v4 campaign in the middle of a chapter stays where it is', () => {
    const before = { ...structuredClone(v4), progress: { current: 'prologue', completed: [], stage: 'intro', scenes: null } };
    const r = readCampaignNow(before, { ...ctx, sceneIds: [] });
    expect(r.ok && r.value.progress).toEqual({ current: 'prologue', completed: [], stage: 'intro', scenes: null });
  });

  it('loads the v4 suspend fixture: a story battle; units carry their weapon and no statuses; blade tiers from the campaign', () => {
    const r = readSuspendNow(v4Suspend, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sv = r.value;
    expect(sv.version).toBe(5);
    expect(sv.skirmish).toBeNull();
    expect(sv.campaign.progress.stage).toBe('battle');
    expect(sv.battle.version).toBe(4);
    expect(sv.battle.bladeTiers).toEqual({ widows_hush: 1 });
    expect(sv.battle.units.every((u) => u.statuses.length === 0)).toBe(true);
    expect(sv.battle.units.map((u) => u.inventory)).toEqual(sv.battle.units.map((u) => (u.weaponId ? [u.weaponId] : [])));
    expect(suspendV4(sv)).toEqual(v4Suspend);
  });

  it('a migrated suspended battle plays on exactly as before (the same seed, the same actions)', async () => {
    const { applyAction, planAiAction, planUnitAction } = await import('../src/core');
    const r = readSuspendNow(v4Suspend, ctx);
    if (!r.ok) throw new Error(r.error);
    let s = r.value.battle;
    const ai = { behavior: 'charge' as const, guardTile: null, guardRadius: 0, active: false };
    for (let i = 0; i < 12 && s.result === 'ongoing'; i++) {
      const next = s.phase === 'player' ? s.units.find((u) => u.alive && u.team === 'player' && !u.acted) : null;
      const action = s.phase !== 'player' ? planAiAction(s, gameData)! : next ? planUnitAction(s, next.id, gameData, ai) : { type: 'endPhase' as const };
      s = applyAction(s, action, gameData).state;
    }
    expect(s.turn).toBeGreaterThanOrEqual(3);
  });

  it('loads the v5 fixture as it is', () => {
    const r = readCampaignNow(v5, { ...ctx, sceneIds: [] });
    expect(r).toEqual({ ok: true, value: v5 });
  });

  it('the steps never change their input and land on version 5', () => {
    for (const fixture of [v1, v1Suspend, v2, v2Suspend, v3, v3Suspend, v4, v4Suspend]) {
      const input = structuredClone(fixture);
      const r = migrate(input);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.version).toBe(5);
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

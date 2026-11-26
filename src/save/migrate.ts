// Brings an older save up to SAVE_VERSION, one step at a time. Each step takes a
// save object at version N and returns it at version N + 1. To change the save
// shape: bump SAVE_VERSION, add the step for the old version here, and add a
// fixture of the old version under tests/fixtures (see docs/SAVES.md).

import { DEFAULT_LOOK } from '../art/mc/look';
import balance from '../data/balance.json';
import weapons from '../data/weapons.json';
import { SAVE_VERSION, fail, ok, type Result } from './format';
import type { Obj } from './shape';

/** A save object at some version. Steps may assume the shape of their own version. */
export type RawSave = Obj & { version: number };

export type MigrationStep = (save: RawSave) => RawSave;

/** Version 1 to 2: the main character gets a look. Version 1 saves predate the creator, so they get the default. */
function addLook(save: RawSave): RawSave {
  const withLook = (c: Obj): Obj => {
    const mc = c.mc;
    if (typeof mc !== 'object' || mc === null || Array.isArray(mc)) return { ...c, version: 2 };
    return { ...c, version: 2, mc: { ...(mc as Obj), look: { ...DEFAULT_LOOK } } };
  };
  if (save.kind === 'suspend' && typeof save.campaign === 'object' && save.campaign !== null) {
    return { ...save, version: 2, campaign: withLook(save.campaign as Obj) };
  }
  return withLook(save) as RawSave;
}

/**
 * Version 2 to 3: the story layer.
 * - The campaign's progress gets a stage and the scenes left in it. A campaign that had finished the story so
 *   far (current null) goes back to the outro of the last chapter it won, so the outro plays and its party
 *   changes apply; any other campaign starts its chapter at the intro. Scenes are null: the chapter data picks
 *   them when the stage begins.
 * - A suspend save's campaign is in its battle; its controller gets an empty list of unfinished scenes.
 * - The battle state moves to version 2: it counts as started, with no flags, events fired or recruits, and
 *   every unit gets no tags and has not left the map.
 */
function addStory(save: RawSave): RawSave {
  const progressOf = (c: Obj, inBattle: boolean): Obj => {
    const p = (typeof c.progress === 'object' && c.progress !== null ? c.progress : {}) as Obj;
    const completed = Array.isArray(p.completed) ? [...(p.completed as unknown[])] : [];
    if (inBattle) return { ...p, stage: 'battle', scenes: [] };
    if (p.current === null && completed.length > 0) {
      const last = completed.pop();
      return { ...p, current: last, completed, stage: 'outro', scenes: null };
    }
    return { ...p, stage: 'intro', scenes: null };
  };
  const campaign = (c: Obj, inBattle: boolean): Obj => ({ ...c, version: 3, progress: progressOf(c, inBattle) });
  if (save.kind === 'suspend') {
    const camp = typeof save.campaign === 'object' && save.campaign !== null ? campaign(save.campaign as Obj, true) : save.campaign;
    const controller = { ...((save.controller ?? {}) as Obj), scenes: [] };
    let battle = save.battle;
    if (typeof battle === 'object' && battle !== null) {
      const b = battle as Obj;
      const units = Array.isArray(b.units) ? (b.units as Obj[]).map((u) => ({ ...u, tags: [], left: false })) : b.units;
      battle = { ...b, version: 2, units, started: true, flags: {}, firedEvents: [], recruited: [] };
    }
    return { ...save, version: 3, campaign: camp, controller, battle };
  }
  return campaign(save, false) as RawSave;
}

/** The blade a weapon id is, from the shipped weapon data (a save step may not depend on later data shapes). */
function bladeOfWeapon(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const w = (weapons as Record<string, { blade?: string }>)[id];
  return w?.blade ?? null;
}

/**
 * Version 3 to 4: blade powers.
 * - The campaign records the blades its party holds, each at tier 1 (Dormant).
 * - A suspended battle state moves to version 3: an empty power log, and every unit gets no Devour stacks and a
 *   Resolve gauge at the starting value if it holds a blade (0 otherwise).
 */
function addBlades(save: RawSave): RawSave {
  const campaign = (c: Obj): Obj => {
    const blades: Record<string, { tier: number }> = {};
    for (const u of Array.isArray(c.party) ? (c.party as Obj[]) : []) {
      const b = bladeOfWeapon(u.weaponId);
      if (b) blades[b] = { tier: 1 };
    }
    return { ...c, version: 4, blades };
  };
  if (save.kind === 'suspend') {
    const camp = typeof save.campaign === 'object' && save.campaign !== null ? campaign(save.campaign as Obj) : save.campaign;
    let battle = save.battle;
    if (typeof battle === 'object' && battle !== null) {
      const b = battle as Obj;
      const start = Math.min(balance.resolve.start, balance.resolve.max);
      const units = Array.isArray(b.units)
        ? (b.units as Obj[]).map((u) => ({ ...u, resolve: bladeOfWeapon(u.weaponId) ? start : 0, devourStacks: 0 }))
        : b.units;
      battle = { ...b, version: 3, units, powerLog: [] };
    }
    return { ...save, version: 4, campaign: camp, battle };
  }
  return campaign(save) as RawSave;
}

/** A unit's inventory before version 5: just the weapon in its hand. */
function inventoryOf(u: Obj): Obj {
  return { ...u, inventory: typeof u.weaponId === 'string' ? [u.weaponId] : [] };
}

/**
 * Version 4 to 5: camp.
 * - Every party and fallen unit carries an inventory holding the weapon in its hand. The campaign gets an empty
 *   convoy, bench, wounded list and skirmish count.
 * - A campaign between chapters (at the start of an intro that has not begun, with a chapter already won) is in
 *   camp now: that is where the army rests between chapters.
 * - A suspended battle is a story battle (skirmish null). Its battle state moves to version 4: every unit's
 *   inventory holds its weapon and it has no statuses, and the blades' tiers come from the campaign (all
 *   Dormant at version 4).
 */
function addCamp(save: RawSave): RawSave {
  const campaign = (c: Obj): Obj => {
    const party = Array.isArray(c.party) ? (c.party as Obj[]).map(inventoryOf) : c.party;
    const fallen = Array.isArray(c.fallen) ? (c.fallen as Obj[]).map(inventoryOf) : c.fallen;
    let progress = c.progress;
    if (typeof progress === 'object' && progress !== null) {
      const p = progress as Obj;
      const between = p.stage === 'intro' && p.scenes === null && Array.isArray(p.completed) && p.completed.length > 0 && p.current !== null;
      if (between) progress = { ...p, stage: 'camp' };
    }
    return { ...c, version: 5, party, fallen, progress, convoy: [], benched: [], wounded: {}, skirmishWins: {} };
  };
  if (save.kind === 'suspend') {
    const camp = typeof save.campaign === 'object' && save.campaign !== null ? campaign(save.campaign as Obj) : save.campaign;
    let battle = save.battle;
    if (typeof battle === 'object' && battle !== null) {
      const b = battle as Obj;
      const units = Array.isArray(b.units) ? (b.units as Obj[]).map((u) => ({ ...inventoryOf(u), statuses: [] })) : b.units;
      const blades = (typeof camp === 'object' && camp !== null ? (camp as Obj).blades : null) as Record<string, { tier?: unknown }> | null;
      const bladeTiers = Object.fromEntries(Object.entries(blades ?? {}).map(([id, r]) => [id, typeof r?.tier === 'number' ? r.tier : 1]));
      battle = { ...b, version: 4, units, bladeTiers };
    }
    return { ...save, version: 5, campaign: camp, battle, skirmish: null };
  }
  return campaign(save) as RawSave;
}

/**
 * Steps keyed by the version they upgrade from. A step must handle both kinds
 * (`campaign` and `suspend`, whose `campaign` field is a campaign save of the
 * same version).
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = { 1: addLook, 2: addStory, 3: addBlades, 4: addCamp };

/**
 * Upgrade a parsed save to `target`. Returns the upgraded object, still unchecked:
 * run the validator on it next. Never changes the input.
 */
export function migrate(raw: unknown, steps: Readonly<Record<number, MigrationStep>> = MIGRATIONS, target: number = SAVE_VERSION): Result<RawSave> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('This is not a save: expected an object.');
  const v = (raw as Obj).version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('This save has no version number.');
  if (v > target) return fail(`This save is from a newer version of the game (save version ${v}). Update the game to load it.`);
  let save = structuredClone(raw) as RawSave;
  while (save.version < target) {
    const from = save.version;
    const step = steps[from];
    if (!step) return fail(`This save version (${from}) can no longer be loaded.`);
    save = step(save);
    if (save.version !== from + 1) return fail(`The upgrade from save version ${from} did not reach version ${from + 1}.`);
  }
  return ok(save);
}

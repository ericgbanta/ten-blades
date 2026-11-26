import { describe, expect, it } from 'vitest';
import { createBattle } from '../src/core';
import { chapters, gameData } from '../src/data';
import { battleSetup, newCampaign, suspendSave } from '../src/save/campaign';
import type { CampaignSave, SaveContext, SuspendSave } from '../src/save/format';
import { readCampaign, readSuspend } from '../src/save/load';
import { validateCampaign, validateSuspend } from '../src/save/validate';
import fixture from './fixtures/save-v5.json';
import v2 from './fixtures/save-v2.json';

const ctx: SaveContext = { data: gameData, chapters };

const campaign = (): CampaignSave =>
  newCampaign({ settings: { difficulty: 'hard', permadeath: 'casual' }, mc: { name: 'Ash', pronouns: 'they', style: 'spiritblade' } }, chapters, 1000);

const suspend = (): SuspendSave => {
  const c = campaign();
  const battle = createBattle(gameData.maps.prologue!, battleSetup(c), 5, gameData);
  return suspendSave(2, c, battle, { showDanger: false, scenes: [] }, 2000);
};

/** Deep copy, then let the test break one thing. */
function broken<T>(good: T, edit: (o: Record<string, never> & T) => void): unknown {
  const copy = structuredClone(good) as Record<string, never> & T;
  edit(copy);
  return copy;
}

function errorOf(r: { ok: boolean; error?: string }): string {
  expect(r.ok).toBe(false);
  return r.error ?? '';
}

describe('campaign validator', () => {
  it('accepts a new campaign and the v5 fixture', () => {
    expect(validateCampaign(campaign(), ctx)).toEqual({ ok: true, value: campaign() });
    expect(validateCampaign(fixture, ctx).ok).toBe(true);
  });

  it('accepts flags of every allowed kind', () => {
    const c = { ...campaign(), flags: { metStranger: true, choice: 'spare', bonds: 3 } };
    expect(validateCampaign(c, ctx).ok).toBe(true);
  });

  const cases: [string, (c: CampaignSave) => unknown, RegExp][] = [
    ['not an object', () => 'hello', /expected an object/],
    ['a list', () => [], /expected an object, found a list/],
    ['wrong version', (c) => ({ ...c, version: 1 }), /^version: expected 5, found 1/],
    ['wrong kind', (c) => ({ ...c, kind: 'suspend' }), /not a campaign save/],
    ['missing field', (c) => broken(c, (o) => delete (o as Partial<CampaignSave>).gold), /^gold: missing/],
    ['unknown field', (c) => ({ ...c, cheat: true }), /^cheat: not a known field/],
    ['bad difficulty', (c) => broken(c, (o) => ((o.settings as { difficulty: string }).difficulty = 'easy')), /settings.difficulty: expected one of normal, hard, lunatic/],
    ['bad permadeath', (c) => broken(c, (o) => ((o.settings as { permadeath: string }).permadeath = 'hardcore')), /settings.permadeath/],
    ['empty name', (c) => broken(c, (o) => (o.mc.name = '   ')), /mc.name: the name is empty/],
    ['long name', (c) => broken(c, (o) => (o.mc.name = 'x'.repeat(17))), /longer than 16/],
    ['control char in name', (c) => broken(c, (o) => (o.mc.name = 'A\nB')), /control character/],
    ['bad pronouns', (c) => broken(c, (o) => ((o.mc as { pronouns: string }).pronouns = 'it')), /mc.pronouns/],
    ['bad style', (c) => broken(c, (o) => ((o.mc as { style: string }).style = 'medic')), /mc.style/],
    ['no look', (c) => broken(c, (o) => delete (o.mc as Partial<CampaignSave['mc']>).look), /^mc.look: missing/],
    ['an unknown skin tone', (c) => broken(c, (o) => (o.mc.look.skin = 'green')), /^mc.look: skin: unknown skin tone "green"/],
    ['an unknown hair style', (c) => broken(c, (o) => (o.mc.look.hairStyle = 'mohawk')), /mc.look: hairStyle: unknown hair style/],
    ['an unknown scar', (c) => broken(c, (o) => (o.mc.look.scar = 'eyepatch')), /mc.look: scar: unknown scar or marking/],
    ['a look field that is not text', (c) => broken(c, (o) => ((o.mc.look as unknown as { eyes: number }).eyes = 2)), /mc.look: eyes: expected text/],
    ['an extra look field', (c) => broken(c, (o) => ((o.mc.look as unknown as { hat: string }).hat = 'tricorn')), /mc.look: hat: unknown field/],
    ['unknown chapter', (c) => broken(c, (o) => (o.progress.current = 'chapter9')), /progress.current: expected one of prologue/],
    ['completed twice', (c) => broken(c, (o) => (o.progress = { current: null, completed: ['prologue', 'prologue'], stage: 'intro', scenes: null })), /listed twice/],
    ['current already done', (c) => broken(c, (o) => (o.progress.completed = ['prologue'])), /already completed/],
    ['negative gold', (c) => ({ ...c, gold: -1 }), /^gold: -1 is out of range/],
    ['fractional shards', (c) => ({ ...c, shards: 1.5 }), /^shards: expected a whole number/],
    ['bad timestamp', (c) => ({ ...c, createdAt: 'yesterday' }), /createdAt: expected a time/],
    ['bad flag', (c) => ({ ...c, flags: { x: null } }), /flags.x: expected true, false, a number or text/],
    ['no stage', (c) => broken(c, (o) => delete (o.progress as Partial<CampaignSave['progress']>).stage), /^progress.stage: missing/],
    ['a bad stage', (c) => broken(c, (o) => ((o.progress as { stage: string }).stage = 'epilogue')), /progress.stage: expected one of camp, intro, battle, outro/],
    ['an unknown scene', (c) => broken(c, (o) => (o.progress.scenes = ['nope'])), /progress.scenes\[0\]: unknown scene "nope"/],
  ];
  const withScenes: SaveContext = { ...ctx, sceneIds: ['prologue_intro'] };
  for (const [name, make, message] of cases) {
    it(`rejects ${name}`, () => {
      expect(errorOf(validateCampaign(make(campaign()), withScenes))).toMatch(message);
    });
  }

  const partyCases: [string, (c: CampaignSave) => void, RegExp][] = [
    ['an unknown class', (c) => (c.party[0]!.classId = 'dragon'), /party\[0\].classId: unknown class "dragon"/],
    ['an unknown weapon', (c) => (c.party[1]!.weaponId = 'laser'), /party\[1\].weaponId: unknown weapon "laser"/],
    ['a level over the cap', (c) => (c.party[0]!.level = 99), /party\[0\].level: 99 is out of range/],
    ['a missing stat', (c) => delete (c.party[0]!.stats as Partial<CampaignSave['party'][0]['stats']>).spd, /party\[0\].stats.spd: missing/],
    ['a duplicate id', (c) => (c.party[1]!.id = 'mc'), /appears twice/],
    ['two lords', (c) => (c.party[1]!.isLord = true), /more than one lord/],
    ['no lord', (c) => (c.party[0]!.isLord = false), /main character is missing/],
    ['a fallen lord', (c) => c.fallen.push({ ...c.party[0]!, id: 'other' }), /cannot be among the fallen/],
  ];
  for (const [name, edit, message] of partyCases) {
    it(`rejects a party with ${name}`, () => {
      const r = readCampaign(v2, ctx);
      if (!r.ok) throw new Error(r.error);
      const c = structuredClone(r.value);
      edit(c);
      expect(errorOf(validateCampaign(c, ctx))).toMatch(message);
    });
  }
});

describe('suspend validator', () => {
  it('accepts a suspend save straight from createBattle', () => {
    expect(validateSuspend(suspend(), ctx).ok).toBe(true);
  });

  const cases: [string, (s: SuspendSave) => void, RegExp][] = [
    ['an unknown map', (s) => (s.mapId = 'moon'), /^mapId: unknown map "moon"/],
    ['a battle on another map', (s) => (s.battle.mapId = 'moon'), /battle.mapId: unknown map/],
    ['a bad slot', (s) => ((s as { slot: number }).slot = 4), /^slot: expected one of 1, 2, 3/],
    ['options that differ from the campaign', (s) => (s.battle.options.difficulty = 'lunatic'), /battle.options: do not match/],
    ['an unknown class', (s) => (s.battle.units[0]!.classId = 'dragon'), /battle.units\[0\].classId: unknown class/],
    ['a unit off the map', (s) => (s.battle.units[0]!.pos = { x: 99, y: 0 }), /battle.units\[0\].pos.x: 99 is out of range/],
    ['a living unit at 0 HP', (s) => (s.battle.units[0]!.hp = 0), /battle.units\[0\].hp: 0 is out of range/],
    ['HP above max', (s) => (s.battle.units[0]!.hp = 999), /battle.units\[0\].hp/],
    ['an enemy with no AI', (s) => (s.battle.units.find((u) => u.team === 'enemy')!.ai = null), /need an AI/],
    ['a short terrain list', (s) => s.battle.map.terrain.pop(), /battle.map.terrain: expected 120 tiles/],
    ['unknown terrain', (s) => (s.battle.map.terrain[0] = 'lava'), /unknown terrain "lava"/],
    ['a bad phase', (s) => ((s.battle as { phase: string }).phase = 'night'), /battle.phase/],
    ['an RNG state out of range', (s) => (s.battle.rng = -1), /battle.rng/],
    ['a bad objective', (s) => (s.battle.objective = { type: 'survive', turns: 0 }), /battle.objective.turns/],
    ['a reinforcement with an unknown class', (s) => (s.battle.reinforcements[0]!.units[0]!.classId = 'ghost'), /reinforcements\[0\].units\[0\].classId/],
    ['a missing controller field', (s) => ((s as { controller: object }).controller = {}), /controller.showDanger: missing/],
    ['an extra battle field', (s) => ((s.battle as unknown as Record<string, unknown>).cheat = 1), /battle.cheat: not a known field/],
    ['an unknown fired event', (s) => s.battle.firedEvents.push('ghost_event'), /battle.firedEvents\[0\]: expected one of/],
    ['an event fired twice', (s) => s.battle.firedEvents.push('start_lesson', 'start_lesson'), /an event is listed twice/],
    ['a recruit that is not on the map', (s) => s.battle.recruited.push('ghost'), /battle.recruited\[0\]: unknown unit "ghost"/],
    ['a bad flag in the battle', (s) => ((s.battle.flags as Record<string, unknown>).x = null), /battle.flags.x/],
    ['a unit both on the map and gone', (s) => (s.battle.units[0]!.left = true), /battle.units\[0\].left: a unit that left the map cannot be on it/],
    ['tags that are not text', (s) => ((s.battle.units[0]! as unknown as { tags: unknown[] }).tags = [3]), /battle.units\[0\].tags\[0\]: expected text/],
    ['an unknown owed scene', (s) => s.controller.scenes.push('nope'), /controller.scenes\[0\]: unknown scene "nope"/],
  ];
  for (const [name, edit, message] of cases) {
    it(`rejects ${name}`, () => {
      const s = structuredClone(suspend());
      edit(s);
      expect(errorOf(validateSuspend(s, { ...ctx, sceneIds: ['prologue_b_start'] }))).toMatch(message);
    });
  }

  it('readSuspend wraps errors in plain words', () => {
    const s = structuredClone(suspend());
    s.mapId = 'moon';
    expect(errorOf(readSuspend(s, ctx))).toMatch(/^The suspended battle could not be read \(mapId: unknown map "moon"\)\.$/);
    expect(errorOf(readCampaign({ version: 1 }, ctx))).toMatch(/^This save could not be read \(kind: missing\)\.$/);
  });
});

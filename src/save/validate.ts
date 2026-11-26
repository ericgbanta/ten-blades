// Strict runtime checks for saves at the current version: the shape, every id
// against game data, and a few invariants. Returns a typed save or a readable error.
// Run migrate() first; this only accepts SAVE_VERSION.

import { STAT_KEYS, itemDef, weaponDef, type BattleState, type GameData, type PartyUnit, type Pos } from '../core';
import { lookProblem } from '../art/mc/look';
import {
  CHAPTER_STAGES,
  DIFFICULTIES,
  MC_NAME_MAX,
  MC_STYLES,
  PERMADEATH_MODES,
  PRONOUNS,
  SAVE_VERSION,
  SLOT_IDS,
  fail,
  ok,
  type CampaignSave,
  type Result,
  type SaveContext,
  type SuspendSave,
} from './format';
import { ShapeError, arr, bool, exactObj, int, join, obj, oneOf, str, type Obj } from './shape';

const TEAMS = ['player', 'enemy', 'ally'] as const;
const PHASES = TEAMS;
const RESULTS = ['ongoing', 'victory', 'defeat'] as const;
const BEHAVIORS = ['charge', 'hold', 'guard'] as const;
const MAX_STAT = 999;
const MAX_COUNTER = 1_000_000_000;

function guard<T>(check: () => T): Result<T> {
  try {
    return ok(check());
  } catch (e) {
    if (e instanceof ShapeError) return fail(e.message);
    throw e;
  }
}

export function validateCampaign(raw: unknown, ctx: SaveContext): Result<CampaignSave> {
  return guard(() => checkCampaign(raw, '', ctx));
}

export function validateSuspend(raw: unknown, ctx: SaveContext): Result<SuspendSave> {
  return guard(() => checkSuspend(raw, ctx));
}

export function validateBattleState(raw: unknown, data: GameData): Result<BattleState> {
  return guard(() => checkBattle(raw, 'battle', data));
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

const CAMPAIGN_KEYS = [
  'version',
  'kind',
  'createdAt',
  'updatedAt',
  'settings',
  'mc',
  'party',
  'fallen',
  'progress',
  'flags',
  'gold',
  'shards',
  'blades',
  'convoy',
  'benched',
  'wounded',
  'skirmishWins',
];
/** Most entries the convoy may hold in a save (the game's own cap is economy.convoyMax). */
const MAX_CONVOY = 1000;

function timestamp(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ShapeError(path, 'expected a time in milliseconds');
  return v;
}

function version(o: Obj, path: string): void {
  if (o.version !== SAVE_VERSION) throw new ShapeError(join(path, 'version'), `expected ${SAVE_VERSION}, found ${String(o.version)}`);
}

function checkCampaign(raw: unknown, path: string, ctx: SaveContext): CampaignSave {
  const o = exactObj(raw, path, CAMPAIGN_KEYS);
  version(o, path);
  if (o.kind !== 'campaign') throw new ShapeError(join(path, 'kind'), 'this is not a campaign save');
  timestamp(o.createdAt, join(path, 'createdAt'));
  timestamp(o.updatedAt, join(path, 'updatedAt'));

  const settings = exactObj(o.settings, join(path, 'settings'), ['difficulty', 'permadeath']);
  oneOf(settings.difficulty, join(path, 'settings.difficulty'), DIFFICULTIES);
  oneOf(settings.permadeath, join(path, 'settings.permadeath'), PERMADEATH_MODES);

  const mc = exactObj(o.mc, join(path, 'mc'), ['name', 'pronouns', 'style', 'look']);
  checkName(mc.name, join(path, 'mc.name'));
  oneOf(mc.pronouns, join(path, 'mc.pronouns'), PRONOUNS);
  oneOf(mc.style, join(path, 'mc.style'), MC_STYLES);
  const lookWhy = lookProblem(mc.look);
  if (lookWhy) throw new ShapeError(join(path, 'mc.look'), lookWhy);

  const ids = new Set<string>();
  const party = arr(o.party, join(path, 'party')).map((u, i) => checkPartyUnit(u, join(join(path, 'party'), i), ctx.data, ids));
  const fallen = arr(o.fallen, join(path, 'fallen')).map((u, i) => checkPartyUnit(u, join(join(path, 'fallen'), i), ctx.data, ids));
  if (party.filter((u) => u.isLord).length > 1) throw new ShapeError(join(path, 'party'), 'more than one lord');
  if (party.length > 0 && !party.some((u) => u.isLord)) throw new ShapeError(join(path, 'party'), 'the main character is missing');
  if (fallen.some((u) => u.isLord)) throw new ShapeError(join(path, 'fallen'), 'the main character cannot be among the fallen');

  const progress = exactObj(o.progress, join(path, 'progress'), ['current', 'completed', 'stage', 'scenes']);
  const chapterIds = ctx.chapters.map((c) => c.id);
  if (progress.current !== null) oneOf(progress.current, join(path, 'progress.current'), chapterIds);
  const done = arr(progress.completed, join(path, 'progress.completed')).map((c, i) => oneOf(c, join(join(path, 'progress.completed'), i), chapterIds));
  if (new Set(done).size !== done.length) throw new ShapeError(join(path, 'progress.completed'), 'a chapter is listed twice');
  if (typeof progress.current === 'string' && done.includes(progress.current)) {
    throw new ShapeError(join(path, 'progress.current'), 'the current chapter is already completed');
  }
  oneOf(progress.stage, join(path, 'progress.stage'), CHAPTER_STAGES);
  if (progress.scenes !== null) checkSceneList(progress.scenes, join(path, 'progress.scenes'), ctx);

  checkFlags(o.flags, join(path, 'flags'));
  int(o.gold, join(path, 'gold'), 0, MAX_COUNTER);
  int(o.shards, join(path, 'shards'), 0, MAX_COUNTER);
  const blades = obj(o.blades, join(path, 'blades'));
  for (const [id, rec] of Object.entries(blades)) {
    const p = join(join(path, 'blades'), id);
    const blade = ctx.data.blades[id];
    if (!blade) throw new ShapeError(p, `unknown blade "${id}"`);
    int(exactObj(rec, p, ['tier']).tier, join(p, 'tier'), 1, blade.tiers.length);
  }
  const convoy = arr(o.convoy, join(path, 'convoy'));
  if (convoy.length > MAX_CONVOY) throw new ShapeError(join(path, 'convoy'), `more than ${MAX_CONVOY} entries`);
  convoy.forEach((e, i) => checkEntry(e, join(join(path, 'convoy'), i), ctx.data));
  const partyIds = new Set(party.map((u) => u.id));
  const benched = arr(o.benched, join(path, 'benched')).map((id, i) => str(id, join(join(path, 'benched'), i)));
  for (const [i, id] of benched.entries()) if (!partyIds.has(id)) throw new ShapeError(join(join(path, 'benched'), i), `"${id}" is not in the party`);
  if (new Set(benched).size !== benched.length) throw new ShapeError(join(path, 'benched'), 'a unit is listed twice');
  for (const [id, act] of Object.entries(obj(o.wounded, join(path, 'wounded')))) {
    if (!partyIds.has(id)) throw new ShapeError(join(join(path, 'wounded'), id), `"${id}" is not in the party`);
    int(act, join(join(path, 'wounded'), id), 1, 99);
  }
  for (const [id, n] of Object.entries(obj(o.skirmishWins, join(path, 'skirmishWins')))) {
    oneOf(id, join(join(path, 'skirmishWins'), id), chapterIds);
    int(n, join(join(path, 'skirmishWins'), id), 0, MAX_COUNTER);
  }
  return o as unknown as CampaignSave;
}

/** A weapon (any forge rank) or an item id. */
function checkEntry(v: unknown, path: string, data: GameData): string {
  const id = str(v, path);
  if (!weaponDef(id, data) && !itemDef(id, data)) throw new ShapeError(path, `unknown weapon or item "${id}"`);
  return id;
}

/** An inventory: known entries, no more than the slots, holding the equipped weapon. */
function checkInventory(v: unknown, path: string, weaponId: unknown, data: GameData): void {
  const inv = arr(v, path).map((e, i) => checkEntry(e, join(path, i), data));
  if (inv.length > data.balance.inventory.slots) throw new ShapeError(path, `more than ${data.balance.inventory.slots} entries`);
  if (typeof weaponId === 'string' && !inv.includes(weaponId)) throw new ShapeError(path, `the equipped "${weaponId}" is not in it`);
}

function checkSceneList(v: unknown, path: string, ctx: SaveContext): string[] {
  return arr(v, path).map((id, i) => {
    const s = str(id, join(path, i));
    if (ctx.sceneIds && !ctx.sceneIds.includes(s)) throw new ShapeError(join(path, i), `unknown scene "${s}"`);
    return s;
  });
}

function checkFlags(v: unknown, path: string): void {
  const flags = obj(v, path);
  for (const [k, val] of Object.entries(flags)) {
    const ok = typeof val === 'boolean' || typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val));
    if (!ok) throw new ShapeError(join(path, k), 'expected true, false, a number or text');
  }
}

export function checkName(v: unknown, path: string): string {
  const name = str(v, path);
  const length = [...name].length;
  if (name.trim() === '') throw new ShapeError(path, 'the name is empty');
  if (length > MC_NAME_MAX) throw new ShapeError(path, `the name is longer than ${MC_NAME_MAX} characters`);
  // Control characters (tabs, new lines, and so on) have no place in a name.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ShapeError(path, 'the name has a control character');
  return name;
}

function checkStats(v: unknown, path: string): void {
  const s = exactObj(v, path, STAT_KEYS);
  for (const k of STAT_KEYS) int(s[k], join(path, k), 0, MAX_STAT);
}

function checkClass(v: unknown, path: string, data: GameData): string {
  const id = str(v, path);
  if (!data.classes[id]) throw new ShapeError(path, `unknown class "${id}"`);
  return id;
}

function checkWeapon(v: unknown, path: string, data: GameData): void {
  if (v === null) return;
  const id = str(v, path);
  if (!weaponDef(id, data)) throw new ShapeError(path, `unknown weapon "${id}"`);
}

function checkPartyUnit(raw: unknown, path: string, data: GameData, ids: Set<string>): PartyUnit {
  const u = exactObj(raw, path, ['id', 'name', 'classId', 'level', 'xp', 'stats', 'weaponId', 'isLord', 'inventory']);
  const id = str(u.id, join(path, 'id'));
  if (ids.has(id)) throw new ShapeError(join(path, 'id'), `unit "${id}" appears twice`);
  ids.add(id);
  str(u.name, join(path, 'name'));
  checkClass(u.classId, join(path, 'classId'), data);
  int(u.level, join(path, 'level'), 1, data.balance.xp.levelCap);
  int(u.xp, join(path, 'xp'), 0, data.balance.xp.perLevel);
  checkStats(u.stats, join(path, 'stats'));
  checkWeapon(u.weaponId, join(path, 'weaponId'), data);
  bool(u.isLord, join(path, 'isLord'));
  checkInventory(u.inventory, join(path, 'inventory'), u.weaponId, data);
  return u as unknown as PartyUnit;
}

// ---------------------------------------------------------------------------
// Suspend
// ---------------------------------------------------------------------------

function checkSuspend(raw: unknown, ctx: SaveContext): SuspendSave {
  const o = exactObj(raw, '', ['version', 'kind', 'savedAt', 'slot', 'campaign', 'mapId', 'battle', 'controller', 'skirmish']);
  version(o, '');
  if (o.kind !== 'suspend') throw new ShapeError('kind', 'this is not a suspended battle');
  timestamp(o.savedAt, 'savedAt');
  oneOf(o.slot, 'slot', SLOT_IDS);
  const campaign = checkCampaign(o.campaign, 'campaign', ctx);
  const mapId = str(o.mapId, 'mapId');
  if (!ctx.data.maps[mapId]) throw new ShapeError('mapId', `unknown map "${mapId}"`);
  const battle = checkBattle(o.battle, 'battle', ctx.data);
  if (battle.mapId !== mapId) throw new ShapeError('battle.mapId', `does not match mapId "${mapId}"`);
  if (battle.options.difficulty !== campaign.settings.difficulty || battle.options.permadeath !== campaign.settings.permadeath) {
    throw new ShapeError('battle.options', 'do not match the campaign settings');
  }
  const controller = exactObj(o.controller, 'controller', ['showDanger', 'scenes']);
  bool(controller.showDanger, 'controller.showDanger');
  checkSceneList(controller.scenes, 'controller.scenes', ctx);
  if (o.skirmish !== null) {
    const sk = str(o.skirmish, 'skirmish');
    if (ctx.skirmishIds && !ctx.skirmishIds.includes(sk)) throw new ShapeError('skirmish', `unknown skirmish "${sk}"`);
  }
  return o as unknown as SuspendSave;
}

// ---------------------------------------------------------------------------
// Battle state
// ---------------------------------------------------------------------------

const BATTLE_KEYS = [
  'version',
  'mapId',
  'map',
  'units',
  'turn',
  'phase',
  'rng',
  'objective',
  'reinforcements',
  'options',
  'result',
  'started',
  'flags',
  'firedEvents',
  'recruited',
  'powerLog',
  'bladeTiers',
];
const UNIT_KEYS = [
  'id',
  'name',
  'classId',
  'team',
  'level',
  'xp',
  'stats',
  'hp',
  'weaponId',
  'pos',
  'acted',
  'alive',
  'ai',
  'isBoss',
  'isLord',
  'tags',
  'left',
  'resolve',
  'devourStacks',
  'inventory',
  'statuses',
];
const PLACEMENT_KEYS = ['kind', 'id', 'name', 'classId', 'team', 'level', 'pos'];
const PLACEMENT_OPTIONAL = ['weaponId', 'ai', 'isBoss', 'isLord', 'tags', 'items'];
const STATUS_KINDS = ['silence', 'pin'] as const;

function checkPos(v: unknown, path: string, w: number, h: number): Pos {
  const p = exactObj(v, path, ['x', 'y']);
  int(p.x, join(path, 'x'), 0, w - 1);
  int(p.y, join(path, 'y'), 0, h - 1);
  return p as unknown as Pos;
}

function checkBattle(raw: unknown, path: string, data: GameData): BattleState {
  const o = exactObj(raw, path, BATTLE_KEYS);
  if (o.version !== 4) throw new ShapeError(join(path, 'version'), `unknown battle version ${String(o.version)}`);
  const mapId = str(o.mapId, join(path, 'mapId'));
  const source = data.maps[mapId];
  if (!source) throw new ShapeError(join(path, 'mapId'), `unknown map "${mapId}"`);

  const map = exactObj(o.map, join(path, 'map'), ['width', 'height', 'terrain']);
  const w = int(map.width, join(path, 'map.width'), 1);
  const h = int(map.height, join(path, 'map.height'), 1);
  if (w !== source.width || h !== source.height) throw new ShapeError(join(path, 'map'), `size does not match map "${mapId}"`);
  const terrain = arr(map.terrain, join(path, 'map.terrain'));
  if (terrain.length !== w * h) throw new ShapeError(join(path, 'map.terrain'), `expected ${w * h} tiles, found ${terrain.length}`);
  terrain.forEach((t, i) => {
    const id = str(t, join(join(path, 'map.terrain'), i));
    if (!data.terrain[id]) throw new ShapeError(join(join(path, 'map.terrain'), i), `unknown terrain "${id}"`);
  });

  const ids = new Set<string>();
  arr(o.units, join(path, 'units')).forEach((u, i) => checkUnit(u, join(join(path, 'units'), i), data, ids, w, h));
  int(o.turn, join(path, 'turn'), 1, 10_000);
  oneOf(o.phase, join(path, 'phase'), PHASES);
  int(o.rng, join(path, 'rng'), 0, 0xffffffff);
  checkObjective(o.objective, join(path, 'objective'), w, h);
  arr(o.reinforcements, join(path, 'reinforcements')).forEach((wave, i) =>
    checkWave(wave, join(join(path, 'reinforcements'), i), data, ids, w, h),
  );
  const options = exactObj(o.options, join(path, 'options'), ['difficulty', 'permadeath']);
  oneOf(options.difficulty, join(path, 'options.difficulty'), DIFFICULTIES);
  oneOf(options.permadeath, join(path, 'options.permadeath'), PERMADEATH_MODES);
  oneOf(o.result, join(path, 'result'), RESULTS);
  bool(o.started, join(path, 'started'));
  checkFlags(o.flags, join(path, 'flags'));
  const eventIds = (source.events ?? []).map((e) => e.id);
  const fired = arr(o.firedEvents, join(path, 'firedEvents')).map((e, i) => oneOf(e, join(join(path, 'firedEvents'), i), eventIds));
  if (new Set(fired).size !== fired.length) throw new ShapeError(join(path, 'firedEvents'), 'an event is listed twice');
  const recruited = arr(o.recruited, join(path, 'recruited')).map((id, i) => str(id, join(join(path, 'recruited'), i)));
  for (const [i, id] of recruited.entries()) {
    if (!ids.has(id)) throw new ShapeError(join(join(path, 'recruited'), i), `unknown unit "${id}"`);
  }
  arr(o.powerLog, join(path, 'powerLog')).forEach((raw2, i) => {
    const p = join(join(path, 'powerLog'), i);
    const e = exactObj(raw2, p, ['powerId', 'bearerId', 'at', 'turn', 'witnesses']);
    const powerId = str(e.powerId, join(p, 'powerId'));
    if (!data.powers[powerId]) throw new ShapeError(join(p, 'powerId'), `unknown power "${powerId}"`);
    const bearer = str(e.bearerId, join(p, 'bearerId'));
    if (!ids.has(bearer)) throw new ShapeError(join(p, 'bearerId'), `unknown unit "${bearer}"`);
    checkPos(e.at, join(p, 'at'), w, h);
    int(e.turn, join(p, 'turn'), 1, 10_000);
    arr(e.witnesses, join(p, 'witnesses')).forEach((id, j) => {
      const wid = str(id, join(join(p, 'witnesses'), j));
      if (!ids.has(wid)) throw new ShapeError(join(join(p, 'witnesses'), j), `unknown unit "${wid}"`);
    });
  });
  for (const [id, tier] of Object.entries(obj(o.bladeTiers, join(path, 'bladeTiers')))) {
    const blade = data.blades[id];
    if (!blade) throw new ShapeError(join(join(path, 'bladeTiers'), id), `unknown blade "${id}"`);
    int(tier, join(join(path, 'bladeTiers'), id), 1, blade.tiers.length);
  }
  return o as unknown as BattleState;
}

function checkTags(v: unknown, path: string): void {
  arr(v, path).forEach((t, i) => str(t, join(path, i)));
}

function checkUnit(raw: unknown, path: string, data: GameData, ids: Set<string>, w: number, h: number): void {
  const u = exactObj(raw, path, UNIT_KEYS);
  const id = str(u.id, join(path, 'id'));
  if (ids.has(id)) throw new ShapeError(join(path, 'id'), `unit "${id}" appears twice`);
  ids.add(id);
  str(u.name, join(path, 'name'));
  checkClass(u.classId, join(path, 'classId'), data);
  const team = oneOf(u.team, join(path, 'team'), TEAMS);
  int(u.level, join(path, 'level'), 1, 999);
  int(u.xp, join(path, 'xp'), 0, data.balance.xp.perLevel);
  checkStats(u.stats, join(path, 'stats'));
  const maxHp = (u.stats as Obj).hp as number;
  const alive = bool(u.alive, join(path, 'alive'));
  const left = bool(u.left, join(path, 'left'));
  if (alive && left) throw new ShapeError(join(path, 'left'), 'a unit that left the map cannot be on it');
  // A fallen unit has 0 HP; one that left keeps the HP it had.
  int(u.hp, join(path, 'hp'), alive ? 1 : 0, alive || left ? maxHp : 0);
  checkTags(u.tags, join(path, 'tags'));
  checkWeapon(u.weaponId, join(path, 'weaponId'), data);
  checkPos(u.pos, join(path, 'pos'), w, h);
  bool(u.acted, join(path, 'acted'));
  bool(u.isBoss, join(path, 'isBoss'));
  bool(u.isLord, join(path, 'isLord'));
  int(u.resolve, join(path, 'resolve'), 0, data.balance.resolve.max);
  int(u.devourStacks, join(path, 'devourStacks'), 0, 999);
  checkInventory(u.inventory, join(path, 'inventory'), u.weaponId, data);
  arr(u.statuses, join(path, 'statuses')).forEach((raw2, i) => {
    const p = join(join(path, 'statuses'), i);
    const st = exactObj(raw2, p, ['kind', 'by', 'turn']);
    oneOf(st.kind, join(p, 'kind'), STATUS_KINDS);
    oneOf(st.by, join(p, 'by'), TEAMS);
    int(st.turn, join(p, 'turn'), 1, 10_000);
  });
  if (u.ai === null) {
    if (team !== 'player') throw new ShapeError(join(path, 'ai'), 'enemy and ally units need an AI');
  } else {
    const ai = exactObj(u.ai, join(path, 'ai'), ['behavior', 'guardTile', 'guardRadius', 'active']);
    oneOf(ai.behavior, join(path, 'ai.behavior'), BEHAVIORS);
    if (ai.guardTile !== null) checkPos(ai.guardTile, join(path, 'ai.guardTile'), w, h);
    int(ai.guardRadius, join(path, 'ai.guardRadius'), 0, 999);
    bool(ai.active, join(path, 'ai.active'));
  }
}

function checkObjective(raw: unknown, path: string, w: number, h: number): void {
  const type = oneOf(obj(raw, path).type, join(path, 'type'), ['rout', 'defeatBoss', 'survive', 'escape', 'protect'] as const);
  if (type === 'rout' || type === 'defeatBoss') exactObj(raw, path, ['type']);
  else if (type === 'survive') int(exactObj(raw, path, ['type', 'turns']).turns, join(path, 'turns'), 1);
  else if (type === 'escape') {
    const o = exactObj(raw, path, ['type', 'tiles']);
    arr(o.tiles, join(path, 'tiles')).forEach((t, i) => checkPos(t, join(join(path, 'tiles'), i), w, h));
  } else {
    const o = exactObj(raw, path, ['type', 'unitId', 'turns']);
    str(o.unitId, join(path, 'unitId'));
    int(o.turns, join(path, 'turns'), 1);
  }
}

function checkWave(raw: unknown, path: string, data: GameData, ids: Set<string>, w: number, h: number): void {
  const wave = exactObj(raw, path, ['turn', 'difficulties', 'units']);
  int(wave.turn, join(path, 'turn'), 1);
  arr(wave.difficulties, join(path, 'difficulties')).forEach((d, i) => oneOf(d, join(join(path, 'difficulties'), i), DIFFICULTIES));
  arr(wave.units, join(path, 'units')).forEach((raw2, i) => {
    const p = join(join(path, 'units'), i);
    const u = exactObj(raw2, p, PLACEMENT_KEYS, PLACEMENT_OPTIONAL);
    if (u.kind !== 'unit') throw new ShapeError(join(p, 'kind'), 'expected "unit"');
    const id = str(u.id, join(p, 'id'));
    if (ids.has(id)) throw new ShapeError(join(p, 'id'), `unit "${id}" appears twice`);
    ids.add(id);
    str(u.name, join(p, 'name'));
    checkClass(u.classId, join(p, 'classId'), data);
    oneOf(u.team, join(p, 'team'), TEAMS);
    int(u.level, join(p, 'level'), 1, 999);
    checkPos(u.pos, join(p, 'pos'), w, h);
    if ('weaponId' in u) checkWeapon(u.weaponId, join(p, 'weaponId'), data);
    if ('isBoss' in u) bool(u.isBoss, join(p, 'isBoss'));
    if ('isLord' in u) bool(u.isLord, join(p, 'isLord'));
    if ('tags' in u) checkTags(u.tags, join(p, 'tags'));
    if ('items' in u) arr(u.items, join(p, 'items')).forEach((it, j) => checkEntry(it, join(join(p, 'items'), j), data));
    if ('ai' in u) {
      const ai = exactObj(u.ai, join(p, 'ai'), ['behavior'], ['tile', 'radius']);
      oneOf(ai.behavior, join(p, 'ai.behavior'), BEHAVIORS);
      if ('tile' in ai) checkPos(ai.tile, join(p, 'ai.tile'), w, h);
      if ('radius' in ai) int(ai.radius, join(p, 'ai.radius'), 0);
    }
  });
}

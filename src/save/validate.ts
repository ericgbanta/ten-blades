// Strict runtime checks for saves at the current version: the shape, every id
// against game data, and a few invariants. Returns a typed save or a readable error.
// Run migrate() first; this only accepts SAVE_VERSION.

import { STAT_KEYS, type BattleState, type GameData, type PartyUnit, type Pos } from '../core';
import {
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

const CAMPAIGN_KEYS = ['version', 'kind', 'createdAt', 'updatedAt', 'settings', 'mc', 'party', 'fallen', 'progress', 'flags', 'gold', 'shards'];

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

  const mc = exactObj(o.mc, join(path, 'mc'), ['name', 'pronouns', 'style']);
  checkName(mc.name, join(path, 'mc.name'));
  oneOf(mc.pronouns, join(path, 'mc.pronouns'), PRONOUNS);
  oneOf(mc.style, join(path, 'mc.style'), MC_STYLES);

  const ids = new Set<string>();
  const party = arr(o.party, join(path, 'party')).map((u, i) => checkPartyUnit(u, join(join(path, 'party'), i), ctx.data, ids));
  const fallen = arr(o.fallen, join(path, 'fallen')).map((u, i) => checkPartyUnit(u, join(join(path, 'fallen'), i), ctx.data, ids));
  if (party.filter((u) => u.isLord).length > 1) throw new ShapeError(join(path, 'party'), 'more than one lord');
  if (party.length > 0 && !party.some((u) => u.isLord)) throw new ShapeError(join(path, 'party'), 'the main character is missing');
  if (fallen.some((u) => u.isLord)) throw new ShapeError(join(path, 'fallen'), 'the main character cannot be among the fallen');

  const progress = exactObj(o.progress, join(path, 'progress'), ['current', 'completed']);
  const chapterIds = ctx.chapters.map((c) => c.id);
  if (progress.current !== null) oneOf(progress.current, join(path, 'progress.current'), chapterIds);
  const done = arr(progress.completed, join(path, 'progress.completed')).map((c, i) => oneOf(c, join(join(path, 'progress.completed'), i), chapterIds));
  if (new Set(done).size !== done.length) throw new ShapeError(join(path, 'progress.completed'), 'a chapter is listed twice');
  if (typeof progress.current === 'string' && done.includes(progress.current)) {
    throw new ShapeError(join(path, 'progress.current'), 'the current chapter is already completed');
  }

  const flags = obj(o.flags, join(path, 'flags'));
  for (const [k, v] of Object.entries(flags)) {
    const ok = typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
    if (!ok) throw new ShapeError(join(join(path, 'flags'), k), 'expected true, false, a number or text');
  }
  int(o.gold, join(path, 'gold'), 0, MAX_COUNTER);
  int(o.shards, join(path, 'shards'), 0, MAX_COUNTER);
  return o as unknown as CampaignSave;
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
  if (!data.weapons[id]) throw new ShapeError(path, `unknown weapon "${id}"`);
}

function checkPartyUnit(raw: unknown, path: string, data: GameData, ids: Set<string>): PartyUnit {
  const u = exactObj(raw, path, ['id', 'name', 'classId', 'level', 'xp', 'stats', 'weaponId', 'isLord']);
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
  return u as unknown as PartyUnit;
}

// ---------------------------------------------------------------------------
// Suspend
// ---------------------------------------------------------------------------

function checkSuspend(raw: unknown, ctx: SaveContext): SuspendSave {
  const o = exactObj(raw, '', ['version', 'kind', 'savedAt', 'slot', 'campaign', 'mapId', 'battle', 'controller']);
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
  const controller = exactObj(o.controller, 'controller', ['showDanger']);
  bool(controller.showDanger, 'controller.showDanger');
  return o as unknown as SuspendSave;
}

// ---------------------------------------------------------------------------
// Battle state
// ---------------------------------------------------------------------------

const BATTLE_KEYS = ['version', 'mapId', 'map', 'units', 'turn', 'phase', 'rng', 'objective', 'reinforcements', 'options', 'result'];
const UNIT_KEYS = ['id', 'name', 'classId', 'team', 'level', 'xp', 'stats', 'hp', 'weaponId', 'pos', 'acted', 'alive', 'ai', 'isBoss', 'isLord'];
const PLACEMENT_KEYS = ['kind', 'id', 'name', 'classId', 'team', 'level', 'pos'];
const PLACEMENT_OPTIONAL = ['weaponId', 'ai', 'isBoss', 'isLord'];

function checkPos(v: unknown, path: string, w: number, h: number): Pos {
  const p = exactObj(v, path, ['x', 'y']);
  int(p.x, join(path, 'x'), 0, w - 1);
  int(p.y, join(path, 'y'), 0, h - 1);
  return p as unknown as Pos;
}

function checkBattle(raw: unknown, path: string, data: GameData): BattleState {
  const o = exactObj(raw, path, BATTLE_KEYS);
  if (o.version !== 1) throw new ShapeError(join(path, 'version'), `unknown battle version ${String(o.version)}`);
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
  return o as unknown as BattleState;
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
  int(u.hp, join(path, 'hp'), alive ? 1 : 0, alive ? maxHp : 0);
  checkWeapon(u.weaponId, join(path, 'weaponId'), data);
  checkPos(u.pos, join(path, 'pos'), w, h);
  bool(u.acted, join(path, 'acted'));
  bool(u.isBoss, join(path, 'isBoss'));
  bool(u.isLord, join(path, 'isLord'));
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
    if ('ai' in u) {
      const ai = exactObj(u.ai, join(p, 'ai'), ['behavior'], ['tile', 'radius']);
      oneOf(ai.behavior, join(p, 'ai.behavior'), BEHAVIORS);
      if ('tile' in ai) checkPos(ai.tile, join(p, 'ai.tile'), w, h);
      if ('radius' in ai) int(ai.radius, join(p, 'ai.radius'), 0);
    }
  });
}

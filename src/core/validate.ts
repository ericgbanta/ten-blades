// Cross-reference checks for game data. Returns a list of problems (empty when valid).

import {
  STAT_KEYS,
  type AiSpec,
  type EventCondition,
  type GameData,
  type MapData,
  type MapEvent,
  type Objective,
  type Pos,
  type UnitPlacement,
} from './types';

const SCHOOLS = ['heavy', 'swift', 'arcane', 'none'];
const TEAMS = ['player', 'enemy', 'ally'];
const BEHAVIORS = ['charge', 'hold', 'guard'];
const DIFFICULTIES = ['normal', 'hard', 'lunatic'] as const;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Story content the map events refer to. When given, scene ids in events are checked against it. */
export interface StoryRefs {
  sceneIds: readonly string[];
}

/** Check every id reference and basic shape in the game data. */
export function validateGameData(data: GameData, story?: StoryRefs): string[] {
  const errs: string[] = [];
  const moveTypes = new Set<string>();

  for (const [id, c] of Object.entries(data.classes)) {
    if (!SCHOOLS.includes(c.school)) errs.push(`class ${id}: bad school ${c.school}`);
    moveTypes.add(c.movementType);
    for (const k of STAT_KEYS) {
      if (!isInt(c.baseStats[k])) errs.push(`class ${id}: baseStats.${k} missing`);
      if (!isInt(c.growths[k])) errs.push(`class ${id}: growths.${k} missing`);
    }
    const w = data.weapons[c.startingWeapon];
    if (!w) errs.push(`class ${id}: unknown startingWeapon ${c.startingWeapon}`);
    else if (!c.weaponKinds.includes(w.kind)) errs.push(`class ${id}: cannot use its startingWeapon ${c.startingWeapon}`);
  }

  for (const [id, w] of Object.entries(data.weapons)) {
    if (!SCHOOLS.includes(w.school)) errs.push(`weapon ${id}: bad school ${w.school}`);
    if (w.range.length !== 2 || !isInt(w.range[0]) || !isInt(w.range[1]) || w.range[0] < 1 || w.range[1] < w.range[0]) {
      errs.push(`weapon ${id}: bad range`);
    }
    for (const k of ['might', 'hit', 'crit', 'heal'] as const) if (!isInt(w[k])) errs.push(`weapon ${id}: ${k} missing`);
    if (w.heal > 0 && w.school !== 'none') errs.push(`weapon ${id}: staves sit outside the triangle`);
  }

  errs.push(...validateBlades(data));

  for (const [id, t] of Object.entries(data.terrain)) {
    for (const m of moveTypes) {
      if (!(m in t.moveCost)) errs.push(`terrain ${id}: no moveCost for ${m}`);
    }
    for (const k of ['avoid', 'def', 'res', 'healPercent'] as const) if (!isInt(t[k])) errs.push(`terrain ${id}: ${k} missing`);
  }

  for (const d of DIFFICULTIES) if (!data.balance.difficulty[d]) errs.push(`balance: no difficulty ${d}`);
  for (const k of STAT_KEYS) if (!isInt(data.balance.statCaps[k])) errs.push(`balance: statCaps.${k} missing`);
  const divisors: [string, number][] = [
    ['combat.hitLckDiv', data.balance.combat.hitLckDiv],
    ['combat.critSklDiv', data.balance.combat.critSklDiv],
    ['xp.hitDiv', data.balance.xp.hitDiv],
    ['xp.perLevel', data.balance.xp.perLevel],
  ];
  for (const [k, v] of divisors) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) errs.push(`balance: ${k} must be above 0`);
  }

  for (const [id, m] of Object.entries(data.maps)) {
    if (m.id !== id) errs.push(`map ${id}: id field is ${m.id}`);
    errs.push(...validateMap(m, data, story));
  }
  return errs;
}

const BLADE_SCHOOLS = ['heavy', 'swift', 'arcane', 'style'];

/** Blades, powers, the weapons that are blades, and the Resolve numbers. */
function validateBlades(data: GameData): string[] {
  const errs: string[] = [];
  const r = data.balance.resolve;
  if (!r) errs.push('balance: resolve missing');
  else {
    for (const k of ['max', 'start', 'dealHit', 'takeHit', 'crit', 'kill', 'aiMargin'] as const) {
      if (!isInt(r[k]) || r[k] < 0) errs.push(`balance: resolve.${k} must be a whole number of 0 or more`);
    }
    if (isInt(r.max) && r.max <= 0) errs.push('balance: resolve.max must be above 0');
  }
  for (const [id, b] of Object.entries(data.blades)) {
    if (!BLADE_SCHOOLS.includes(b.school)) errs.push(`blade ${id}: bad school ${b.school}`);
    if (!data.powers[b.power]) errs.push(`blade ${id}: unknown power ${b.power}`);
    if (!Array.isArray(b.tiers) || b.tiers.length === 0 || b.tiers.some((t, i) => t.tier !== i + 1)) errs.push(`blade ${id}: tiers must count up from 1`);
  }
  for (const [id, p] of Object.entries(data.powers)) {
    if (p.cost !== null && (!isInt(p.cost) || p.cost <= 0 || (r && p.cost > r.max))) errs.push(`power ${id}: cost must be 1 to resolve.max, or null`);
    if (p.implemented && !p.effect) errs.push(`power ${id}: implemented without an effect`);
    const e = p.effect;
    if (!e) continue;
    const nums: [string, number][] =
      e.type === 'echo'
        ? [['range', e.range], ['fallback.damagePercent', e.fallback.damagePercent], ['fallback.range[0]', e.fallback.range[0]], ['fallback.range[1]', e.fallback.range[1]]]
        : e.type === 'devour'
          ? [['bonusMight', e.bonusMight], ['healPercent', e.healPercent], ['healCap', e.healCap], ['attackPerKill', e.attackPerKill], ['maxStacks', e.maxStacks]]
          : [['length', e.length], ['damagePercent', e.damagePercent]];
    if (!['echo', 'devour', 'scatter'].includes(e.type)) errs.push(`power ${id}: unknown effect ${String(e.type)}`);
    for (const [k, v] of nums) if (!isInt(v) || v < 0) errs.push(`power ${id}: ${k} must be a whole number of 0 or more`);
    if (e.type === 'scatter' && e.length < 1) errs.push(`power ${id}: length must be at least 1`);
  }
  for (const [id, w] of Object.entries(data.weapons)) {
    if (w.blade === undefined) continue;
    if (!data.blades[w.blade]) errs.push(`weapon ${id}: unknown blade ${w.blade}`);
    if (!w.legendary) errs.push(`weapon ${id}: a blade must be legendary`);
    if (w.heal > 0) errs.push(`weapon ${id}: a blade cannot be a staff`);
  }
  return errs;
}

function validateMap(m: MapData, data: GameData, story: StoryRefs | undefined): string[] {
  const errs: string[] = [];
  const where = `map ${m.id}`;
  if (m.tiles.length !== m.height) errs.push(`${where}: ${m.tiles.length} rows, height ${m.height}`);
  m.tiles.forEach((row, y) => {
    if (row.length !== m.width) errs.push(`${where}: row ${y} has ${row.length} tiles, width ${m.width}`);
    for (const ch of row) if (!(ch in m.legend)) errs.push(`${where}: row ${y} char '${ch}' not in legend`);
  });
  for (const [ch, t] of Object.entries(m.legend)) if (!data.terrain[t]) errs.push(`${where}: legend '${ch}' unknown terrain ${t}`);

  const terrainAt = (p: Pos): string | null => {
    const ch = m.tiles[p.y]?.[p.x];
    return ch === undefined ? null : (m.legend[ch] ?? null);
  };
  const ids = new Set<string>();
  const used = new Set<string>();
  const checkPos = (p: Pos, label: string, classId: string | null): void => {
    const t = terrainAt(p);
    if (t === null) {
      errs.push(`${where}: ${label} off the map at ${p.x},${p.y}`);
      return;
    }
    const cls = classId ? data.classes[classId] : null;
    const moveType = cls ? cls.movementType : 'foot';
    const cost = data.terrain[t]?.moveCost[moveType];
    if (cost === null || cost === undefined) errs.push(`${where}: ${label} on impassable ${t}`);
  };
  const checkUnit = (p: UnitPlacement, label: string): void => {
    if (ids.has(p.id)) errs.push(`${where}: duplicate unit id ${p.id}`);
    ids.add(p.id);
    const cls = data.classes[p.classId];
    if (!cls) errs.push(`${where}: ${label} unknown class ${p.classId}`);
    if (!TEAMS.includes(p.team)) errs.push(`${where}: ${label} bad team ${p.team}`);
    if (!isInt(p.level) || p.level < 1) errs.push(`${where}: ${label} bad level`);
    if (p.weaponId !== undefined) {
      const w = data.weapons[p.weaponId];
      if (!w) errs.push(`${where}: ${label} unknown weapon ${p.weaponId}`);
      else if (cls && !cls.weaponKinds.includes(w.kind)) errs.push(`${where}: ${label} cannot use ${p.weaponId}`);
    }
    if (p.team !== 'player' && !p.ai && !p.isBoss) errs.push(`${where}: ${label} needs an ai`);
    if (p.ai && !BEHAVIORS.includes(p.ai.behavior)) errs.push(`${where}: ${label} bad ai ${p.ai.behavior}`);
    checkPos(p.pos, label, p.classId);
  };

  let mcSlots = 0;
  for (const p of m.placements) {
    const key = `${p.pos.x},${p.pos.y}`;
    if (used.has(key)) errs.push(`${where}: two placements on ${key}`);
    used.add(key);
    if (p.kind === 'mc') {
      mcSlots++;
      checkPos(p.pos, 'mc slot', null);
      for (const [style, wid] of Object.entries(p.weapons ?? {})) {
        const w = data.weapons[wid];
        const c = data.classes[style];
        if (!w) errs.push(`${where}: mc slot unknown weapon ${wid}`);
        else if (!c) errs.push(`${where}: mc slot unknown style ${style}`);
        else if (!c.weaponKinds.includes(w.kind)) errs.push(`${where}: mc slot ${style} cannot use ${wid}`);
      }
    } else if (p.kind === 'party') checkPos(p.pos, 'party slot', null);
    else checkUnit(p, p.id);
  }
  if (mcSlots !== 1) errs.push(`${where}: needs exactly one mc slot, has ${mcSlots}`);

  m.reinforcements.forEach((w, i) => {
    if (!isInt(w.turn) || w.turn < 1) errs.push(`${where}: wave ${i} bad turn`);
    for (const d of w.difficulties) if (!DIFFICULTIES.includes(d)) errs.push(`${where}: wave ${i} bad difficulty ${d}`);
    for (const p of w.units) checkUnit(p, `wave ${i} ${p.id}`);
  });

  const obj = m.objective;
  if (obj.type === 'defeatBoss' && !m.placements.some((p) => p.kind === 'unit' && p.isBoss && p.team === 'enemy')) {
    errs.push(`${where}: defeatBoss without a boss`);
  }
  if (obj.type === 'defeatBoss') {
    // A boss arriving later would let the battle be won before it shows up, and a
    // blocked arrival tile would make the map unwinnable, so bosses start on the map.
    m.reinforcements.forEach((w, i) => {
      for (const p of w.units) if (p.isBoss && p.team === 'enemy') errs.push(`${where}: boss ${p.id} arrives in a wave (wave ${i}); defeatBoss bosses must start on the map`);
    });
  }
  if (obj.type === 'protect') {
    // The protected unit must be on the field from the start, on the player or ally team.
    const t = m.placements.find((p): p is UnitPlacement => p.kind === 'unit' && p.id === obj.unitId);
    if (!t) errs.push(`${where}: protect target ${obj.unitId} is not placed at the start`);
    else if (t.team === 'enemy') errs.push(`${where}: protect target ${obj.unitId} is an enemy`);
  }
  if (obj.type === 'escape') for (const t of obj.tiles) checkPos(t, 'escape tile', null);
  const propTiles = new Set<string>();
  for (const p of m.props ?? []) {
    if (typeof p.id !== 'string' || !/^[a-z_]+$/.test(p.id)) errs.push(`${where}: prop with a bad id ${String(p.id)}`);
    if (!isInt(p.x) || !isInt(p.y) || terrainAt(p) === null) errs.push(`${where}: prop ${p.id} off the map at ${p.x},${p.y}`);
    const k = `${p.x},${p.y}`;
    if (propTiles.has(k)) errs.push(`${where}: two props on ${k}`);
    propTiles.add(k);
  }
  if (m.backdrop !== undefined && (typeof m.backdrop !== 'string' || !/^[a-z_]+$/.test(m.backdrop))) {
    errs.push(`${where}: bad backdrop id ${String(m.backdrop)}`);
  }
  if ((obj.type === 'survive' || obj.type === 'protect') && (!isInt(obj.turns) || obj.turns < 1)) {
    errs.push(`${where}: bad turns`);
  }
  // Every unit the map can ever hold: placements, waves, event spawns, and the MC (always id "mc").
  const spawns = (m.events ?? []).flatMap((ev) => ev.effects.flatMap((fx) => (fx.type === 'spawn' ? fx.units : [])));
  const known = new Set<string>(['mc', ...ids]);
  for (const p of spawns) known.add(p.id);
  const tags = new Set<string>();
  for (const p of [...m.placements, ...m.reinforcements.flatMap((w) => w.units), ...spawns]) {
    if (p.kind !== 'unit') continue;
    if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== 'string' || t === ''))) {
      errs.push(`${where}: ${p.id} has bad tags`);
    }
    for (const t of p.tags ?? []) tags.add(t);
  }
  errs.push(...validateEvents(m, data, story, { known, tags, checkUnit, terrainAt }));
  return errs;
}

const PHASES = ['player', 'enemy', 'ally'];
const REPEATABLE = ['enter', 'defeated', 'talk'];
const FLAG_NAME = /^[a-z][a-z0-9_]*$/;

interface MapRefs {
  known: Set<string>;
  tags: Set<string>;
  checkUnit: (p: UnitPlacement, label: string) => void;
  terrainAt: (p: Pos) => string | null;
}

function isFlagValue(v: unknown): boolean {
  return typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

/** Check a map's scripted events: shapes, ids, unit ids, tags, tiles, scenes and weapons. */
function validateEvents(m: MapData, data: GameData, story: StoryRefs | undefined, refs: MapRefs): string[] {
  const errs: string[] = [];
  const events: MapEvent[] = m.events ?? [];
  const where = `map ${m.id}`;
  const seen = new Set<string>();
  const unit = (id: unknown, label: string) => {
    if (typeof id !== 'string' || !refs.known.has(id)) errs.push(`${label}: unknown unit ${String(id)}`);
  };
  const tile = (p: Pos, label: string) => {
    if (!isInt(p?.x) || !isInt(p?.y) || refs.terrainAt(p) === null) errs.push(`${label}: tile off the map`);
  };
  const tag = (t: unknown, label: string) => {
    if (typeof t !== 'string' || !refs.tags.has(t)) errs.push(`${label}: no unit has tag ${String(t)}`);
  };
  const flag = (f: unknown, label: string) => {
    if (typeof f !== 'string' || !FLAG_NAME.test(f)) errs.push(`${label}: bad flag name ${String(f)}`);
  };
  const team = (t: unknown, label: string) => {
    if (!TEAMS.includes(t as string)) errs.push(`${label}: bad team ${String(t)}`);
  };
  const ai = (a: AiSpec, label: string) => {
    if (!a || !BEHAVIORS.includes(a.behavior)) errs.push(`${label}: bad ai`);
    else {
      if (a.tile) tile(a.tile, `${label} ai.tile`);
      if (a.radius !== undefined && (!isInt(a.radius) || a.radius < 0)) errs.push(`${label}: bad ai radius`);
    }
  };
  const condition = (c: EventCondition, label: string) => {
    switch (c.type) {
      case 'flag':
        flag(c.flag, label);
        if (c.value !== undefined && !isFlagValue(c.value)) errs.push(`${label}: bad flag value`);
        return;
      case 'permadeath':
        if (c.mode !== 'classic' && c.mode !== 'casual') errs.push(`${label}: bad permadeath ${String(c.mode)}`);
        return;
      case 'difficulty':
        if (!Array.isArray(c.difficulties) || c.difficulties.some((d) => !DIFFICULTIES.includes(d))) errs.push(`${label}: bad difficulties`);
        return;
      case 'alive':
      case 'fallen':
        unit(c.unitId, label);
        return;
      default:
        errs.push(`${label}: unknown condition ${String((c as { type: unknown }).type)}`);
    }
  };
  const objective = (o: Objective, label: string) => {
    switch (o.type) {
      case 'rout':
      case 'defeatBoss':
        return;
      case 'survive':
        if (!isInt(o.turns) || o.turns < 1) errs.push(`${label}: bad turns`);
        return;
      case 'protect':
        unit(o.unitId, label);
        if (!isInt(o.turns) || o.turns < 1) errs.push(`${label}: bad turns`);
        return;
      case 'escape':
        for (const t of o.tiles) tile(t, label);
        return;
      default:
        errs.push(`${label}: unknown objective ${String((o as { type: unknown }).type)}`);
    }
  };

  events.forEach((ev, i) => {
    const label = `${where}: event ${typeof ev.id === 'string' && ev.id ? ev.id : `#${i}`}`;
    if (typeof ev.id !== 'string' || !/^[a-z0-9_]+$/.test(ev.id)) errs.push(`${label}: bad id`);
    else if (seen.has(ev.id)) errs.push(`${label}: duplicate event id`);
    seen.add(ev.id);
    const t = ev.trigger;
    if (ev.repeatable && !REPEATABLE.includes(t?.type)) errs.push(`${label}: only enter, defeated and talk events can repeat`);
    switch (t?.type) {
      case 'battleStart':
        break;
      case 'flag':
        flag(t.flag, label);
        if (t.value !== undefined && !isFlagValue(t.value)) errs.push(`${label}: bad flag value`);
        break;
      case 'phaseStart':
        if (!isInt(t.turn) || t.turn < 1) errs.push(`${label}: bad turn`);
        if (t.phase !== undefined && !PHASES.includes(t.phase)) errs.push(`${label}: bad phase ${String(t.phase)}`);
        break;
      case 'enter':
        if (t.unitId !== undefined) unit(t.unitId, label);
        if (t.team !== undefined) team(t.team, label);
        if (!t.tiles && !t.area) errs.push(`${label}: enter needs tiles or an area`);
        for (const p of t.tiles ?? []) tile(p, label);
        if (t.area) {
          const a = t.area;
          if (![a.x, a.y, a.w, a.h].every(isInt) || a.w < 1 || a.h < 1 || a.x < 0 || a.y < 0 || a.x + a.w > m.width || a.y + a.h > m.height) {
            errs.push(`${label}: area off the map`);
          }
        }
        break;
      case 'defeated':
        if (t.unitId !== undefined) unit(t.unitId, label);
        if (t.byId !== undefined) unit(t.byId, label);
        if (t.tag !== undefined) tag(t.tag, label);
        if (t.team !== undefined) team(t.team, label);
        break;
      case 'hpBelow':
        unit(t.unitId, label);
        if (!isInt(t.percent) || t.percent < 1 || t.percent > 100) errs.push(`${label}: percent must be 1 to 100`);
        break;
      case 'talk':
        unit(t.unitId, label);
        unit(t.targetId, label);
        if (t.unitId === t.targetId) errs.push(`${label}: a unit cannot talk to itself`);
        break;
      case 'allDefeated':
        tag(t.tag, label);
        break;
      default:
        errs.push(`${label}: unknown trigger ${String((t as { type?: unknown })?.type)}`);
    }
    for (const c of ev.conditions ?? []) condition(c, label);
    if (!Array.isArray(ev.effects) || ev.effects.length === 0) errs.push(`${label}: no effects`);
    for (const fx of ev.effects ?? []) {
      switch (fx.type) {
        case 'scene':
          if (typeof fx.sceneId !== 'string') errs.push(`${label}: scene needs a sceneId`);
          else if (story && !story.sceneIds.includes(fx.sceneId)) errs.push(`${label}: unknown scene ${fx.sceneId}`);
          break;
        case 'spawn':
          if (!Array.isArray(fx.units) || fx.units.length === 0) errs.push(`${label}: spawn needs units`);
          for (const p of fx.units ?? []) refs.checkUnit(p, `${label} spawn ${p.id}`);
          break;
        case 'remove':
        case 'lock':
        case 'unlock':
          unit(fx.unitId, label);
          break;
        case 'setTeam':
          unit(fx.unitId, label);
          team(fx.team, label);
          if (fx.ai) ai(fx.ai, label);
          break;
        case 'setAi':
          unit(fx.unitId, label);
          ai(fx.ai, label);
          break;
        case 'setFlag':
          flag(fx.flag, label);
          if (!isFlagValue(fx.value)) errs.push(`${label}: bad flag value`);
          break;
        case 'objective':
          objective(fx.objective, label);
          break;
        case 'endBattle':
          if (fx.result !== 'victory' && fx.result !== 'defeat') errs.push(`${label}: bad result`);
          break;
        case 'giveWeapon':
          unit(fx.unitId, label);
          if (!data.weapons[fx.weaponId]) errs.push(`${label}: unknown weapon ${fx.weaponId}`);
          break;
        case 'heal':
        case 'damage':
          unit(fx.unitId, label);
          if (!isInt(fx.amount) || fx.amount < 1) errs.push(`${label}: amount must be a whole number above 0`);
          break;
        default:
          errs.push(`${label}: unknown effect ${String((fx as { type?: unknown }).type)}`);
      }
    }
  });
  return errs;
}

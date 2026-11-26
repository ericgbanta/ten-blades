// Cross-reference checks for game data. Returns a list of problems (empty when valid).

import { STAT_KEYS, type GameData, type MapData, type Pos, type UnitPlacement } from './types';

const SCHOOLS = ['heavy', 'swift', 'arcane', 'none'];
const TEAMS = ['player', 'enemy', 'ally'];
const BEHAVIORS = ['charge', 'hold', 'guard'];
const DIFFICULTIES = ['normal', 'hard', 'lunatic'] as const;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Check every id reference and basic shape in the game data. */
export function validateGameData(data: GameData): string[] {
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
    errs.push(...validateMap(m, data));
  }
  return errs;
}

function validateMap(m: MapData, data: GameData): string[] {
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
  if ((obj.type === 'survive' || obj.type === 'protect') && (!isInt(obj.turns) || obj.turns < 1)) {
    errs.push(`${where}: bad turns`);
  }
  return errs;
}

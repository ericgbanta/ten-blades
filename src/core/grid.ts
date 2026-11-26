// Grid helpers: positions, terrain lookup, unit lookup, team relations.

import type { BattleState, GameData, Pos, Team, TerrainDef, Unit, WeaponDef } from './types';

/** Manhattan distance between two tiles. */
export function distance(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(state: BattleState, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.map.width && p.y < state.map.height;
}

/** Flat tile index (y * width + x). */
export function tileIndex(state: BattleState, p: Pos): number {
  return p.y * state.map.width + p.x;
}

export function indexToPos(state: BattleState, i: number): Pos {
  return { x: i % state.map.width, y: Math.floor(i / state.map.width) };
}

/** Terrain id at a tile. Throws when out of bounds. */
export function terrainIdAt(state: BattleState, p: Pos): string {
  const id = inBounds(state, p) ? state.map.terrain[tileIndex(state, p)] : undefined;
  if (id === undefined) throw new Error(`No tile at ${p.x},${p.y}`);
  return id;
}

export function terrainAt(state: BattleState, p: Pos, data: GameData): TerrainDef {
  const id = terrainIdAt(state, p);
  const t = data.terrain[id];
  if (!t) throw new Error(`Unknown terrain ${id}`);
  return t;
}

/** Move cost to enter a tile for a movement type, or null if impassable. */
export function moveCostAt(state: BattleState, p: Pos, movementType: string, data: GameData): number | null {
  const cost = terrainAt(state, p, data).moveCost[movementType];
  return cost === undefined ? null : cost;
}

/** The four orthogonal neighbors that are on the map, in a fixed order (up, right, down, left). */
export function neighbors(state: BattleState, p: Pos): Pos[] {
  const out: Pos[] = [];
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const n = { x: p.x + dx, y: p.y + dy };
    if (inBounds(state, n)) out.push(n);
  }
  return out;
}

/** Every tile within Manhattan distance [min, max] of `center`, on the map. */
export function tilesInRange(state: BattleState, center: Pos, min: number, max: number): Pos[] {
  const out: Pos[] = [];
  for (let dy = -max; dy <= max; dy++) {
    for (let dx = -max; dx <= max; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < min || d > max) continue;
      const p = { x: center.x + dx, y: center.y + dy };
      if (inBounds(state, p)) out.push(p);
    }
  }
  return out;
}

export function getUnit(state: BattleState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`No unit ${id}`);
  return u;
}

export function findUnit(state: BattleState, id: string): Unit | null {
  return state.units.find((x) => x.id === id) ?? null;
}

/** The living unit on a tile, or null. */
export function unitAt(state: BattleState, p: Pos): Unit | null {
  return state.units.find((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y) ?? null;
}

export function livingUnits(state: BattleState, team?: Team): Unit[] {
  return state.units.filter((u) => u.alive && (team === undefined || u.team === team));
}

/** Player and ally are friends; enemy is hostile to both. */
export function areHostile(a: Team, b: Team): boolean {
  return (a === 'enemy') !== (b === 'enemy');
}

export function weaponOf(unit: Unit, data: GameData): WeaponDef | null {
  if (unit.weaponId === null) return null;
  const w = data.weapons[unit.weaponId];
  if (!w) throw new Error(`Unknown weapon ${unit.weaponId}`);
  return w;
}

/** The unit's weapon if it can attack with it (not a staff), else null. */
export function attackWeaponOf(unit: Unit, data: GameData): WeaponDef | null {
  const w = weaponOf(unit, data);
  return w && w.heal === 0 ? w : null;
}

/** The unit's staff if it holds one, else null. */
export function staffOf(unit: Unit, data: GameData): WeaponDef | null {
  const w = weaponOf(unit, data);
  return w && w.heal > 0 ? w : null;
}

export function movementTypeOf(unit: Unit, data: GameData): string {
  const c = data.classes[unit.classId];
  if (!c) throw new Error(`Unknown class ${unit.classId}`);
  return c.movementType;
}

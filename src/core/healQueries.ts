// Heal previews for the UI: how much a staff heal restores, and where a staff
// user could heal after moving. Pure, like the other queries.

import { getUnit, staffOf, tilesInRange } from './grid';
import { moveTiles } from './pathfinding';
import type { BattleState, GameData, Pos } from './types';

/** HP a staff heal from `healerId` would restore to `targetId` now (0 without a staff). */
export function healAmount(state: BattleState, healerId: string, targetId: string, data: GameData): number {
  const healer = getUnit(state, healerId);
  const staff = staffOf(healer, data);
  if (!staff) return 0;
  const target = getUnit(state, targetId);
  return Math.min(target.stats.hp - target.hp, staff.heal + healer.stats.mag);
}

/** Every tile a staff user could heal after moving anywhere it can stop. Empty without a staff. */
export function healRange(state: BattleState, unitId: string, data: GameData): Pos[] {
  const staff = staffOf(getUnit(state, unitId), data);
  if (!staff) return [];
  const seen = new Map<number, Pos>();
  for (const from of moveTiles(state, unitId, data)) {
    for (const p of tilesInRange(state, from, staff.range[0], staff.range[1])) seen.set(p.y * state.map.width + p.x, p);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

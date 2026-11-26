// Public surface of the rules engine. The UI and game layers import from here.

export * from './types';
export { createRng, nextFloat, nextInt, rollPercent, type RngState } from './rng';
export {
  distance,
  samePos,
  inBounds,
  terrainIdAt,
  terrainAt,
  getUnit,
  findUnit,
  unitAt,
  livingUnits,
  areHostile,
  weaponOf,
  attackWeaponOf,
  staffOf,
} from './grid';
export {
  reachableTiles,
  moveTiles,
  canMoveTo,
  pathTo,
  attackTilesFrom,
  attackTargets,
  healTargets,
  attackRange,
  actionTiles,
  unitThreatTiles,
  threatTiles,
  type ReachTile,
} from './pathfinding';
export { forecast, triangleEdge, resolveCombat, type CombatResolution, type StrikeResult } from './combat';
export { combatXp, rollLevelUp, averageStats } from './leveling';
export { checkOutcome, battleSummary, fallenPlayerUnitIds, type BattleSummary } from './objectives';
export { createBattle, applyAction, validateAction, newMc, ActionError } from './battle';
export { planAiAction, planUnitAction, runAiPhase } from './ai';
export { validateGameData } from './validate';

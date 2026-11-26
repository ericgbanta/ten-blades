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
export {
  checkOutcome,
  battleSummary,
  fallenPlayerUnitIds,
  turnLimitReached,
  objectiveStatus,
  partyAfterBattle,
  endBattle,
  type BattleSummary,
  type ObjectiveStatus,
  type PartyAfterBattle,
} from './objectives';
export { ActionError } from './errors';
export { createBattle, startBattle, applyAction, validateAction, newMc } from './battle';
export { unitFromPlacement, aiStateFrom } from './units';
export {
  runEvents,
  talkTargets,
  canTalk,
  mapEvents,
  flagValue,
  storyConditionHolds,
  storyConditionsHold,
  type StoryContext,
} from './events';
export { planAiAction, planUnitAction, runAiPhase } from './ai';
export { validateGameData } from './validate';
export { healAmount, healRange } from './healQueries';

// Building units: from map placements (with the difficulty's changes for enemies), from party members, and
// the new main character. Also the AI state for a placement or an event's AI spec.

import { averageStats } from './leveling';
import { startingResolve } from './resolve';
import {
  STAT_KEYS,
  type AiSpec,
  type AiState,
  type BattleSetup,
  type Difficulty,
  type GameData,
  type PartyUnit,
  type Pos,
  type Stats,
  type Team,
  type Unit,
  type UnitPlacement,
} from './types';


/** Scale enemy stats for the difficulty, then clamp to the stat caps (and at least 0). */
function applyDifficulty(stats: Stats, difficulty: Difficulty, data: GameData): Stats {
  const d = data.balance.difficulty[difficulty];
  const caps = data.balance.statCaps;
  const out = { ...stats };
  for (const k of STAT_KEYS) {
    if (k === 'mov') continue;
    const v = Math.round(stats[k] * d.statMultiplier) + (d.statBonus[k] ?? 0);
    out[k] = Math.max(0, Math.min(v, caps[k]));
  }
  return out;
}

/**
 * The AI state for a unit on `team` standing on `pos`, from a spec (null for player units). Lunatic turns
 * enemies set to hold into chargers.
 */
export function aiStateFrom(spec: AiSpec, team: Team, pos: Pos, difficulty: Difficulty, data: GameData): AiState | null {
  if (team === 'player') return null;
  let behavior = spec.behavior;
  if (behavior === 'hold' && team === 'enemy' && data.balance.difficulty[difficulty].aggressive) behavior = 'charge';
  return {
    behavior,
    guardTile: behavior === 'guard' ? { ...(spec.tile ?? pos) } : null,
    guardRadius: behavior === 'guard' ? (spec.radius ?? 0) : 0,
    active: false,
  };
}

function aiFromPlacement(p: UnitPlacement, difficulty: Difficulty, data: GameData): AiState | null {
  const spec = p.ai ?? (p.isBoss ? { behavior: 'guard' as const } : { behavior: 'charge' as const });
  return aiStateFrom(spec, p.team, p.pos, difficulty, data);
}

/** Build a unit from map data. Enemies get the difficulty's level and stat changes. */
export function unitFromPlacement(p: UnitPlacement, difficulty: Difficulty, data: GameData): Unit {
  const cls = data.classes[p.classId];
  if (!cls) throw new Error(`Unknown class ${p.classId}`);
  const isEnemy = p.team === 'enemy';
  const level = Math.min(p.level + (isEnemy ? data.balance.difficulty[difficulty].levelBonus : 0), data.balance.xp.levelCap);
  let stats = averageStats(p.classId, level, data);
  if (isEnemy) stats = applyDifficulty(stats, difficulty, data);
  const unit: Unit = {
    id: p.id,
    name: p.name,
    classId: p.classId,
    team: p.team,
    level,
    xp: 0,
    stats,
    hp: stats.hp,
    weaponId: p.weaponId ?? cls.startingWeapon,
    pos: { ...p.pos },
    acted: false,
    alive: true,
    ai: aiFromPlacement(p, difficulty, data),
    isBoss: p.isBoss ?? false,
    isLord: p.isLord ?? false,
    tags: [...(p.tags ?? [])],
    left: false,
    resolve: 0,
    devourStacks: 0,
  };
  unit.resolve = startingResolve(unit, data);
  return unit;
}

export function unitFromParty(m: PartyUnit, pos: Pos): Unit {
  return {
    id: m.id,
    name: m.name,
    classId: m.classId,
    team: 'player',
    level: m.level,
    xp: m.xp,
    stats: { ...m.stats },
    hp: m.stats.hp,
    weaponId: m.weaponId,
    pos: { ...pos },
    acted: false,
    alive: true,
    ai: null,
    isBoss: false,
    isLord: m.isLord,
    tags: [],
    left: false,
    resolve: 0,
    devourStacks: 0,
  };
}

/** The MC as a fresh level 1 unit of the chosen style, with the style's starting weapon. */
export function newMc(setup: BattleSetup, data: GameData): PartyUnit {
  const cls = data.classes[setup.mc.style];
  if (!cls) throw new Error(`Unknown MC style ${setup.mc.style}`);
  return {
    id: 'mc',
    name: setup.mc.name,
    classId: setup.mc.style,
    level: 1,
    xp: 0,
    stats: { ...cls.baseStats },
    weaponId: cls.startingWeapon,
    isLord: true,
  };
}

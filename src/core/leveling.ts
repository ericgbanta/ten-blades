// XP and level-ups. Growth rolls use the seeded RNG, so a reload can't reroll them.

import { rollPercent, type RngState } from './rng';
import { STAT_KEYS, type Balance, type BattleEvent, type GameData, type Stats, type Unit } from './types';

/**
 * XP for one combat against a foe.
 * - No damaging hit landed: `missXp`.
 * - Damaging hit: (hitBase + level diff) / hitDiv, at least hitMin.
 * - Kill: adds max(killMin, killBase + diff * killLevelMult), plus bossBonus for a boss.
 * Diff is foe level minus unit level. Capped at maxPerAction.
 */
export function combatXp(
  unitLevel: number,
  foeLevel: number,
  dealtDamage: boolean,
  killed: boolean,
  foeIsBoss: boolean,
  balance: Balance,
): number {
  const x = balance.xp;
  if (!dealtDamage && !killed) return x.missXp;
  const diff = foeLevel - unitLevel;
  let xp = Math.max(x.hitMin, Math.floor((x.hitBase + diff) / x.hitDiv));
  if (killed) {
    xp += Math.max(x.killMin, x.killBase + diff * x.killLevelMult);
    if (foeIsBoss) xp += x.bossBonus;
  }
  return Math.min(x.maxPerAction, xp);
}

function zeroStats(): Stats {
  return { hp: 0, str: 0, mag: 0, skl: 0, spd: 0, lck: 0, def: 0, res: 0, mov: 0 };
}

/**
 * Roll a level-up for a unit: each stat gains floor(growth / 100) plus 1 more on a
 * roll under growth % 100, capped by statCaps. Stats roll in STAT_KEYS order.
 * Returns the gains and the new RNG state.
 */
export function rollLevelUp(unit: Unit, rng: RngState, data: GameData): [Stats, RngState] {
  const cls = data.classes[unit.classId];
  if (!cls) throw new Error(`Unknown class ${unit.classId}`);
  const gains = zeroStats();
  let s = rng;
  for (const k of STAT_KEYS) {
    const g = cls.growths[k];
    let gain = Math.floor(g / 100);
    const rest = g % 100;
    if (rest > 0) {
      const [up, s1] = rollPercent(s, rest);
      s = s1;
      if (up) gain++;
    }
    gains[k] = Math.max(0, Math.min(gain, data.balance.statCaps[k] - unit.stats[k]));
  }
  return [gains, s];
}

/**
 * Give XP to a unit in place (the caller owns a fresh copy) and roll any level-ups.
 * At the level cap no XP is gained. Returns the new RNG state.
 */
export function grantXp(unit: Unit, amount: number, rng: RngState, data: GameData, events: BattleEvent[]): RngState {
  const x = data.balance.xp;
  if (unit.level >= x.levelCap || amount <= 0) return rng;
  let s = rng;
  unit.xp += amount;
  const ups: BattleEvent[] = [];
  while (unit.xp >= x.perLevel && unit.level < x.levelCap) {
    unit.xp -= x.perLevel;
    unit.level += 1;
    const [gains, s1] = rollLevelUp(unit, s, data);
    s = s1;
    for (const k of STAT_KEYS) unit.stats[k] += gains[k];
    unit.hp += gains.hp;
    ups.push({ type: 'levelUp', unitId: unit.id, level: unit.level, gains });
  }
  if (unit.level >= x.levelCap) unit.xp = 0;
  events.push({ type: 'xpGained', unitId: unit.id, amount, xpAfter: unit.xp }, ...ups);
  return s;
}

/**
 * Stats of a unit created at `level` without rolls: base plus the average growth
 * for each level past 1, rounded, capped. Used for enemies and new recruits.
 */
export function averageStats(classId: string, level: number, data: GameData): Stats {
  const cls = data.classes[classId];
  if (!cls) throw new Error(`Unknown class ${classId}`);
  const out = zeroStats();
  for (const k of STAT_KEYS) {
    const v = cls.baseStats[k] + Math.round((cls.growths[k] * (level - 1)) / 100);
    out[k] = Math.min(v, data.balance.statCaps[k]);
  }
  return out;
}

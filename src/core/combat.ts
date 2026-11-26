// Combat math (forecast) and resolution. Resolution uses the forecast numbers, so
// what the player previews is exactly what is rolled.

import { ActionError } from './errors';
import { attackWeaponOf, distance, findUnit, getUnit, inBounds, terrainAt } from './grid';
import { nextInt, rollPercent, type RngState } from './rng';
import type {
  Balance,
  BattleState,
  CombatSide,
  Forecast,
  GameData,
  Pos,
  School,
  TriangleEdge,
  Unit,
  WeaponDef,
} from './types';

/** Triangle edge of school `a` against school `b`. `none` is always neutral. */
export function triangleEdge(a: School, b: School, balance: Balance): TriangleEdge {
  if (a === 'none' || b === 'none' || a === b) return 'neutral';
  if (balance.triangle.beats[a] === b) return 'advantage';
  if (balance.triangle.beats[b] === a) return 'disadvantage';
  return 'neutral';
}

function edgeSign(e: TriangleEdge): number {
  return e === 'advantage' ? 1 : e === 'disadvantage' ? -1 : 0;
}

const clampPct = (v: number): number => Math.max(0, Math.min(100, v));

/**
 * Numbers for `unit` striking `foe`, with `foe` standing on `foePos` (its terrain counts).
 * `w` is the unit's attack weapon, `foeW` the foe's weapon (for the triangle) or null.
 */
function sideNumbers(
  unit: Unit,
  w: WeaponDef,
  foe: Unit,
  foePos: Pos,
  foeW: WeaponDef | null,
  state: BattleState,
  data: GameData,
): CombatSide {
  const b = data.balance;
  const c = b.combat;
  const edge = triangleEdge(w.school, foeW ? foeW.school : 'none', b);
  const sign = edgeSign(edge);
  const foeTerrain = terrainAt(state, foePos, data);
  const attack = (w.magic ? unit.stats.mag : unit.stats.str) + w.might + sign * b.triangle.damageBonus;
  const defense = w.magic ? foe.stats.res + foeTerrain.res : foe.stats.def + foeTerrain.def;
  const damage = Math.max(0, attack - defense);
  const hitRate = w.hit + unit.stats.skl * c.hitSklMult + Math.floor(unit.stats.lck / c.hitLckDiv) + sign * b.triangle.hitBonus;
  const avoid = foe.stats.spd * c.avoidSpdMult + foe.stats.lck * c.avoidLckMult + foeTerrain.avoid;
  const critRate = w.crit + Math.floor(unit.stats.skl / c.critSklDiv);
  const strikes = unit.stats.spd - foe.stats.spd >= c.doubleSpeedLead ? 2 : 1;
  return {
    unitId: unit.id,
    hp: unit.hp,
    attack,
    damage,
    hit: clampPct(hitRate - avoid),
    crit: clampPct(critRate - foe.stats.lck),
    strikes,
    triangle: edge,
  };
}

/**
 * True if `unitId` could land damage on `targetId` where it stands: hit above 0 and
 * damage above 0, ignoring range. The AI uses it to skip foes it cannot hurt.
 */
export function canHurt(state: BattleState, unitId: string, targetId: string, data: GameData): boolean {
  const a = getUnit(state, unitId);
  const d = getUnit(state, targetId);
  const aw = attackWeaponOf(a, data);
  if (!aw) return false;
  const side = sideNumbers(a, aw, d, d.pos, attackWeaponOf(d, data), state, data);
  return side.hit > 0 && side.damage > 0;
}

/**
 * Preview a fight: `attackerId` standing on `from` attacks `defenderId` where it stands.
 * Throws ActionError if either unit is unknown, the attacker has no attack weapon,
 * `from` is off the map, or the defender is out of range from `from`.
 */
export function forecast(
  state: BattleState,
  attackerId: string,
  defenderId: string,
  from: Pos,
  data: GameData,
): Forecast {
  const a = findUnit(state, attackerId);
  const d = findUnit(state, defenderId);
  if (!a) throw new ActionError(`No unit ${attackerId}`);
  if (!d) throw new ActionError(`No unit ${defenderId}`);
  const aw = attackWeaponOf(a, data);
  if (!aw) throw new ActionError(`${a.id} has no attack weapon`);
  if (!inBounds(state, from)) throw new ActionError(`${from.x},${from.y} is off the map`);
  const dist = distance(from, d.pos);
  if (dist < aw.range[0] || dist > aw.range[1]) throw new ActionError(`${d.id} is out of ${a.id}'s range`);
  const dw = attackWeaponOf(d, data);
  const attacker = sideNumbers(a, aw, d, d.pos, dw, state, data);
  const canCounter = dw !== null && dist >= dw.range[0] && dist <= dw.range[1];
  const counter = canCounter ? sideNumbers(d, dw, a, from, aw, state, data) : null;
  return {
    attacker,
    counter,
    defenderId: d.id,
    defenderHp: d.hp,
    defenderTriangle: triangleEdge(dw ? dw.school : 'none', aw.school, data.balance),
    distance: dist,
  };
}

/** Roll one hit with the balance's hit mode. */
export function rollHit(rng: RngState, hit: number, balance: Balance): [boolean, RngState] {
  if (balance.hitRollMode === '2rn') {
    const [r1, s1] = nextInt(rng, 0, 99);
    const [r2, s2] = nextInt(s1, 0, 99);
    return [(r1 + r2) / 2 < hit, s2];
  }
  const [r, s] = nextInt(rng, 0, 99);
  return [r < hit, s];
}

/** One strike in a resolved combat. */
export interface StrikeResult {
  attackerId: string;
  defenderId: string;
  hit: boolean;
  crit: boolean;
  damage: number;
  hpAfter: number;
}

export interface CombatResolution {
  strikes: StrikeResult[];
  attackerHp: number;
  defenderHp: number;
  /** Unit id that fell, or null. */
  defeatedId: string | null;
  rng: RngState;
}

/**
 * Roll a forecast out. Order: attacker, counter, attacker follow-up, counter
 * follow-up; it stops when someone falls. Crits are rolled only on a hit.
 */
export function resolveCombat(fc: Forecast, rng: RngState, balance: Balance): CombatResolution {
  const a = fc.attacker;
  const c = fc.counter;
  const seq: CombatSide[] = [a];
  if (c) seq.push(c);
  if (a.strikes > 1) seq.push(a);
  if (c && c.strikes > 1) seq.push(c);
  let aHp = a.hp;
  let dHp = fc.defenderHp;
  let s = rng;
  const strikes: StrikeResult[] = [];
  let defeatedId: string | null = null;
  for (const side of seq) {
    const fromAttacker = side === a;
    const [hit, s1] = rollHit(s, side.hit, balance);
    s = s1;
    let crit = false;
    if (hit) {
      const [cr, s2] = rollPercent(s, side.crit);
      s = s2;
      crit = cr;
    }
    const raw = hit ? side.damage * (crit ? balance.combat.critMultiplier : 1) : 0;
    const targetHp = fromAttacker ? dHp : aHp;
    const damage = Math.min(raw, targetHp);
    const hpAfter = targetHp - damage;
    if (fromAttacker) dHp = hpAfter;
    else aHp = hpAfter;
    const targetId = fromAttacker ? fc.defenderId : a.unitId;
    strikes.push({ attackerId: side.unitId, defenderId: targetId, hit, crit, damage, hpAfter });
    if (hpAfter <= 0) {
      defeatedId = targetId;
      break;
    }
  }
  return { strikes, attackerHp: aHp, defenderHp: dHp, defeatedId, rng: s };
}

// Blade powers: what a bearer's power does right now (Echo resolves to what it would re-cast), its targets, a
// forecast that resolution rolls exactly, and the resolution itself. Pure; resolution works on the caller's copy.
//
// Implemented (src/data/blades.json): the Dormant powers Echo (Widow's Hush), Devour (Gravemaw) and Scatter
// (Thousand Needles), and the Awakened powers Hush, Cleave and Pin. A bearer whose blade is Awakened has two
// powers; every query takes an optional `powerId` (the blade's first power when left out).

import { forecastWith, rollHit, strikeSide } from './combat';
import { activateHold, clash, defeat, onKill } from './clash';
import { ActionError } from './errors';
import { areHostile, attackWeaponOf, distance, findUnit, getUnit, inBounds, livingUnits, neighbors, unitAt } from './grid';
import { combatXp, grantXp } from './leveling';
import { attackTargets } from './pathfinding';
import { bearerPower, bearerPowers, bloodPriceOf, changeResolve, gainFromStrikes, implementedPower, powerCost } from './resolve';
import { rollPercent } from './rng';
import { applyStatus, hasStatus } from './status';
import type {
  BattleEvent,
  BattleState,
  CombatSide,
  Direction,
  Forecast,
  GameData,
  Pos,
  PowerEffect,
  PowerSummary,
  PowerUse,
  StatusKind,
  Unit,
} from './types';

export const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

const STEP: Record<Direction, Pos> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** How a power is aimed: at one unit, or along a direction. */
export type PowerAim = { targetId: string } | { dir: Direction };

/** What a unit's power would do if fired now. */
export interface PowerPlan {
  /** The bearer's own power (echo for Widow's Hush). */
  bladePowerId: string;
  /** The power that takes effect: the echoed one, or the bearer's own (echo for the fallback). */
  powerId: string;
  name: string;
  effect: PowerEffect;
  /** The unit whose power an Echo re-casts, or null. */
  echoOf: string | null;
  /** True for Echo with nothing to echo: the repeat-strike fallback. */
  fallback: boolean;
  /** `unit` takes a targetId, `line` a direction. */
  aim: 'unit' | 'line';
  cost: number;
}

/** The last power used near an Echo bearer (it witnessed it), not its own and not an echo: what Echo re-casts. */
export function echoSource(state: BattleState, unitId: string, data: GameData): PowerUse | null {
  for (let i = state.powerLog.length - 1; i >= 0; i--) {
    const e = state.powerLog[i]!;
    if (e.bearerId === unitId || !e.witnesses.includes(unitId)) continue;
    const p = implementedPower(e.powerId, data);
    if (p && p.effect.type !== 'echo') return e;
  }
  return null;
}

/** Ids of the powers the unit can pick from, in tier order (two for an Awakened blade). Empty for no blade. */
export function powerIds(state: BattleState, unitId: string, data: GameData): string[] {
  const u = findUnit(state, unitId);
  return u ? bearerPowers(state, u, data).map((p) => p.id) : [];
}

/**
 * The unit's plan for one of its powers (`powerId`, default its first), or null when it holds no blade with that
 * power built and unlocked.
 */
export function powerPlan(state: BattleState, unitId: string, data: GameData, powerId?: string): PowerPlan | null {
  const u = findUnit(state, unitId);
  if (!u) return null;
  const powers = bearerPowers(state, u, data);
  const own = powerId === undefined ? powers[0] : powers.find((p) => p.id === powerId);
  if (!own) return null;
  const cost = powerCost(own.def, data);
  const base = { bladePowerId: own.id, cost };
  if (own.effect.type !== 'echo') {
    return { ...base, powerId: own.id, name: own.def.name, effect: own.effect, echoOf: null, fallback: false, aim: aimOf(own.effect) };
  }
  const src = echoSource(state, unitId, data);
  const echoed = src ? implementedPower(src.powerId, data) : null;
  if (src && echoed) {
    return { ...base, powerId: echoed.id, name: `${own.def.name}: ${echoed.def.name}`, effect: echoed.effect, echoOf: src.bearerId, fallback: false, aim: aimOf(echoed.effect) };
  }
  return { ...base, powerId: own.id, name: own.def.name, effect: own.effect, echoOf: null, fallback: true, aim: 'unit' };
}

function aimOf(e: PowerEffect): 'unit' | 'line' {
  return e.type === 'scatter' ? 'line' : 'unit';
}

/** Why the unit cannot fire the power at all right now (ignoring targets), or null if the gauge is ready. */
export function powerBlock(state: BattleState, unitId: string, data: GameData, powerId?: string): string | null {
  const u = findUnit(state, unitId);
  if (!u) return `No unit ${unitId}`;
  const plan = powerPlan(state, unitId, data, powerId);
  if (!plan) return powerId === undefined ? `${u.id} has no power` : `${u.id} cannot use ${powerId}`;
  if (!attackWeaponOf(u, data)) return `${u.id} has no attack weapon`;
  if (hasStatus(u, 'silence')) return 'Silenced';
  if (u.resolve < plan.cost) return `Resolve ${u.resolve}/${plan.cost}`;
  return null;
}

/** The tiles of a line from `from` (not included), `length` long, stopping at the map edge. */
export function lineTiles(state: BattleState, from: Pos, dir: Direction, length: number): Pos[] {
  const out: Pos[] = [];
  const st = STEP[dir];
  for (let i = 1; i <= length; i++) {
    const p = { x: from.x + st.x * i, y: from.y + st.y * i };
    if (!inBounds(state, p)) break;
    out.push(p);
  }
  return out;
}

/** Hostile living units on the tiles, in tile order. */
function hostilesOn(state: BattleState, unit: Unit, tiles: Pos[]): Unit[] {
  const out: Unit[] = [];
  for (const t of tiles) {
    const v = unitAt(state, t);
    if (v && v.id !== unit.id && areHostile(unit.team, v.team)) out.push(v);
  }
  return out;
}

/** The unit with its tile set to `from` (where it fires from), in a shallow copy of the state. */
function standingAt(state: BattleState, unitId: string, from: Pos): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, pos: { ...from } } : u)) };
}

/** Unit ids a unit-aimed power could hit from `from`. Empty for line powers or when the power is not ready. */
export function powerTargets(state: BattleState, unitId: string, from: Pos, data: GameData, powerId?: string): string[] {
  if (powerBlock(state, unitId, data, powerId) !== null) return [];
  const plan = powerPlan(state, unitId, data, powerId)!;
  if (plan.aim !== 'unit') return [];
  if (plan.effect.type === 'strike') {
    // Its own reach, past the weapon's: every living foe at a distance in range.
    const [min, max] = plan.effect.range;
    const u = getUnit(state, unitId);
    return livingUnits(state)
      .filter((v) => v.id !== unitId && areHostile(u.team, v.team))
      .filter((v) => {
        const d = distance(from, v.pos);
        return d >= min && d <= max;
      })
      .map((v) => v.id);
  }
  if (plan.fallback && plan.effect.type === 'echo') {
    const [min, max] = plan.effect.fallback.range;
    const u = getUnit(state, unitId);
    const w = attackWeaponOf(u, data)!;
    return attackTargets(state, unitId, from, data).filter((id) => {
      const d = distance(from, getUnit(state, id).pos);
      return d >= min && d <= max && d >= w.range[0] && d <= w.range[1];
    });
  }
  return attackTargets(state, unitId, from, data);
}

/** Directions a line power could fire in from `from` (at least one hostile in the line). */
export function powerDirections(state: BattleState, unitId: string, from: Pos, data: GameData, powerId?: string): Direction[] {
  if (powerBlock(state, unitId, data, powerId) !== null) return [];
  const plan = powerPlan(state, unitId, data, powerId)!;
  if (plan.effect.type !== 'scatter') return [];
  const unit = { ...getUnit(state, unitId), pos: from };
  const len = plan.effect.length;
  return DIRECTIONS.filter((d) => hostilesOn(state, unit, lineTiles(state, from, d, len)).length > 0);
}

/** True if the power has any target from `from`. */
export function canUsePower(state: BattleState, unitId: string, from: Pos, data: GameData, powerId?: string): boolean {
  return powerTargets(state, unitId, from, data, powerId).length > 0 || powerDirections(state, unitId, from, data, powerId).length > 0;
}

/** One unit a power strikes: its numbers (resolution rolls exactly these). */
export interface PowerTargetForecast {
  unitId: string;
  hp: number;
  /** The bearer's strike on it. For a fight, the whole exchange is in `PowerForecast.combat`. */
  side: CombatSide;
}

export interface PowerForecast {
  plan: PowerPlan;
  bearerId: string;
  from: Pos;
  dir: Direction | null;
  /** Tiles the power covers: the line, or the target's tile. */
  tiles: Pos[];
  targets: PowerTargetForecast[];
  /** The fight for Devour and Echo's fallback (counters included), else null. */
  combat: Forecast | null;
  /** Echo's fallback repeat strike, or null. */
  echoStrike: CombatSide | null;
  /** Most the bearer can heal (Devour), 0 otherwise. */
  healMax: number;
  /** The status the power puts on its target (Hush, Pin), or null; with `statusOnHit` only when the strike lands. */
  status: StatusKind | null;
  statusOnHit: boolean;
  /** HP the blade takes from its bearer after the power (an Awakened blade's price), 0 for none. */
  bloodPrice: number;
}

/**
 * Preview a power fired from `from`. Throws ActionError when the power is not ready or the aim is not valid
 * (call it with ids from powerTargets or directions from powerDirections).
 */
export function powerForecast(state: BattleState, unitId: string, from: Pos, aim: PowerAim, data: GameData, powerId?: string): PowerForecast {
  const block = powerBlock(state, unitId, data, powerId);
  if (block !== null) throw new ActionError(block);
  const plan = powerPlan(state, unitId, data, powerId)!;
  const at = standingAt(state, unitId, from);
  const bearer = getUnit(state, unitId);
  const e = plan.effect;
  const base = {
    plan,
    bearerId: unitId,
    from: { ...from },
    combat: null,
    echoStrike: null,
    healMax: 0,
    status: e.type === 'strike' ? e.status : null,
    statusOnHit: e.type === 'strike' ? e.onHit : false,
    bloodPrice: Math.min(bloodPriceOf(state, bearer, data), Math.max(0, bearer.hp - 1)),
  };
  if (plan.aim === 'line') {
    if (!('dir' in aim) || e.type !== 'scatter') throw new ActionError(`${plan.name} needs a direction`);
    const unit = getUnit(at, unitId);
    const tiles = lineTiles(at, from, aim.dir, e.length);
    const hit = hostilesOn(at, unit, tiles);
    if (hit.length === 0) throw new ActionError(`No enemy in the line ${aim.dir}`);
    const targets = hit.map((v) => {
      const side = strikeSide(at, unitId, v.id, data);
      return { unitId: v.id, hp: v.hp, side: { ...side, damage: Math.floor((side.damage * e.damagePercent) / 100), strikes: 1 } };
    });
    return { ...base, dir: aim.dir, tiles, targets };
  }
  if (!('targetId' in aim)) throw new ActionError(`${plan.name} needs a target`);
  if (!powerTargets(state, unitId, from, data, powerId).includes(aim.targetId)) throw new ActionError(`${aim.targetId} is not a target of ${plan.name}`);
  const target = getUnit(state, aim.targetId);
  if (e.type === 'strike') {
    const side = strikeSide(at, unitId, target.id, data);
    const struck = { ...side, damage: Math.floor((side.damage * e.damagePercent) / 100), strikes: 1 };
    return { ...base, dir: null, tiles: [{ ...target.pos }], targets: [{ unitId: target.id, hp: target.hp, side: struck }] };
  }
  const bonus = e.type === 'devour' || e.type === 'cleave' ? e.bonusMight : 0;
  const combat = forecastWith(state, unitId, aim.targetId, from, bonus, data);
  const unit = getUnit(state, unitId);
  // Cleave: every other foe next to the bearer takes a weaker blow after the fight.
  const splash =
    e.type === 'cleave'
      ? neighbors(at, from)
          .map((p) => unitAt(at, p))
          .filter((v): v is Unit => v !== null && v.id !== target.id && v.id !== unitId && areHostile(unit.team, v.team))
          .map((v) => {
            const side = strikeSide(at, unitId, v.id, data);
            return { unitId: v.id, hp: v.hp, side: { ...side, damage: Math.floor((side.damage * e.splashPercent) / 100), crit: 0, strikes: 1 } };
          })
      : [];
  return {
    ...base,
    dir: null,
    tiles: [{ ...target.pos }, ...splash.map((t) => ({ ...getUnit(state, t.unitId).pos }))],
    targets: [{ unitId: target.id, hp: target.hp, side: combat.attacker }, ...splash],
    combat,
    echoStrike:
      e.type === 'echo'
        ? { ...combat.attacker, damage: Math.floor((combat.attacker.damage * e.fallback.damagePercent) / 100), crit: 0, strikes: 1 }
        : null,
    healMax: e.type === 'devour' ? Math.min(e.healCap, unit.stats.hp - unit.hp) : 0,
  };
}

/** Echo bearers within their range of `at` that could echo this use later. */
function witnessesOf(s: BattleState, bearerId: string, at: Pos, data: GameData): string[] {
  return s.units
    .filter((u) => u.alive && u.id !== bearerId)
    .filter((u) => {
      const p = bearerPower(u, data);
      return p !== null && p.effect.type === 'echo' && distance(u.pos, at) <= p.effect.range;
    })
    .map((u) => u.id);
}

/**
 * Fire `unit`'s power (already moved to its tile) in `s`, the caller's own copy, pushing the events. The
 * caller has validated the action. Spends the gauge, resolves, logs the use for Echo.
 */
export function resolvePower(s: BattleState, unit: Unit, aim: PowerAim, data: GameData, events: BattleEvent[], powerId?: string): void {
  const fc = powerForecast(s, unit.id, unit.pos, aim, data, powerId);
  const plan = fc.plan;
  const summary: PowerSummary = {
    powerId: plan.powerId,
    bladePowerId: plan.bladePowerId,
    echoOf: plan.echoOf,
    fallback: plan.fallback,
    bearerId: unit.id,
    from: { ...unit.pos },
    dir: fc.dir,
    tiles: fc.tiles.map((t) => ({ ...t })),
    targetIds: fc.targets.map((t) => t.unitId),
    odds: fc.targets.map((t) => ({ unitId: t.unitId, damage: t.side.damage, hit: t.side.hit, crit: t.side.crit })),
    results: [],
    heal: 0,
    stacksAfter: null,
    statuses: [],
    bloodPrice: 0,
  };
  // The summary is filled in as the power resolves; the UI reads it when it plays `powerUsed`, after the fact.
  events.push({ type: 'powerUsed', summary });
  changeResolve(unit, -plan.cost, data, events);
  const e = plan.effect;
  if (fc.combat) {
    const target = getUnit(s, fc.targets[0]!.unitId);
    const r = clash(s, unit, target, fc.combat, data, events, {
      casterId: unit.id,
      devour: e.type === 'devour',
      echoPercent: e.type === 'echo' ? e.fallback.damagePercent : null,
    });
    const mine = r.strikes.filter((st) => st.attackerId === unit.id);
    summary.results.push({
      unitId: target.id,
      damage: mine.reduce((n, st) => n + st.damage, 0),
      hit: mine.some((st) => st.hit),
      crit: mine.some((st) => st.crit),
      hpAfter: target.hp,
      defeated: !target.alive,
    });
    if (e.type === 'devour') {
      if (unit.alive) {
        const dealt = mine.reduce((n, st) => n + st.damage, 0);
        const amount = Math.min(unit.stats.hp - unit.hp, e.healCap, Math.floor((dealt * e.healPercent) / 100));
        if (amount > 0) {
          unit.hp += amount;
          summary.heal = amount;
          events.push({ type: 'unitHealed', unitId: unit.id, sourceId: unit.id, cause: 'power', amount, hpAfter: unit.hp });
        }
      }
      summary.stacksAfter = unit.devourStacks;
    }
    if (e.type === 'cleave' && unit.alive && fc.targets.length > 1) volley(s, unit, fc.targets.slice(1), summary, null, data, events);
  } else {
    volley(s, unit, fc.targets, summary, e.type === 'strike' && e.status ? { kind: e.status, onHit: e.onHit } : null, data, events);
  }
  s.powerLog.push({ powerId: plan.powerId, bearerId: unit.id, at: { ...unit.pos }, turn: s.turn, witnesses: witnessesOf(s, unit.id, unit.pos, data) });
  events.push({ type: 'powerEnded', powerId: plan.powerId, bearerId: unit.id });
  // The curse's price: an Awakened blade drinks from its bearer after every power, never to death.
  const price = unit.alive ? Math.min(fc.bloodPrice, unit.hp - 1) : 0;
  if (price > 0) {
    unit.hp -= price;
    summary.bloodPrice = price;
    events.push({ type: 'unitDamaged', unitId: unit.id, amount: price, hpAfter: unit.hp, cause: 'bloodPrice' });
  }
}

/**
 * One uncounterable strike on each target in order, with the forecast's numbers: Scatter's line, a Hush or Pin,
 * Cleave's splash. A status lands on each living target struck (only on a hit with `onHit`).
 */
function volley(
  s: BattleState,
  unit: Unit,
  targets: readonly PowerTargetForecast[],
  summary: PowerSummary,
  status: { kind: StatusKind; onHit: boolean } | null,
  data: GameData,
  events: BattleEvent[],
): void {
  const strikes: { attackerId: string; defenderId: string; hit: boolean; crit: boolean }[] = [];
  const killed: Unit[] = [];
  let xp = 0;
  for (const t of targets) {
    const v = getUnit(s, t.unitId);
    const [hit, s1] = rollHit(s.rng, t.side.hit, data.balance);
    s.rng = s1;
    let crit = false;
    if (hit) {
      const [cr, s2] = rollPercent(s.rng, t.side.crit);
      s.rng = s2;
      crit = cr;
    }
    const raw = hit ? t.side.damage * (crit ? data.balance.combat.critMultiplier : 1) : 0;
    const damage = Math.min(raw, v.hp);
    v.hp -= damage;
    strikes.push({ attackerId: unit.id, defenderId: v.id, hit, crit });
    events.push({ type: 'strike', attackerId: unit.id, defenderId: v.id, hit, crit, damage, hpAfter: v.hp });
    activateHold(v);
    if (v.hp <= 0) {
      defeat(v, unit.id, events);
      killed.push(v);
    } else if (status && (hit || !status.onHit)) {
      applyStatus(s, v, status.kind, unit, events);
      summary.statuses.push({ unitId: v.id, status: status.kind });
    }
    summary.results.push({ unitId: v.id, damage, hit, crit, hpAfter: v.hp, defeated: !v.alive });
    if (unit.team === 'player') xp += combatXp(unit.level, v.level, damage > 0, !v.alive, v.isBoss, data.balance);
  }
  gainFromStrikes(s.units, strikes, killed.map(() => unit.id), unit.id, data, events);
  for (let i = 0; i < killed.length; i++) onKill(unit, false, data, events);
  if (unit.team === 'player') s.rng = grantXp(unit, Math.min(data.balance.xp.maxPerAction, xp), s.rng, data, events);
}

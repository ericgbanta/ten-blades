// Deterministic AI for enemy and ally phases (and the simulator's player side).
//
// Behaviors:
// - charge: attack the best target in reach, else move toward the nearest hostile it
//   can hurt (or a hostile lord if it can hurt nobody). It never attacks for zero
//   expected damage; that holds for every behavior.
// - hold: stay put until a hostile is in reach (or it is attacked), then charge for good.
// - guard: only act from tiles within `guardRadius` of `guardTile`; otherwise return
//   toward it. Bosses default to guarding their own tile with radius 0 (stay put).
// Staff users heal the most wounded friend they can reach, else stay put.
// Items: an enemy or ally below balance.ai.itemBelowPercent of its max HP drinks the first healing item it carries,
// where it stands, before anything else. Bearers score each of their powers (two for an Awakened blade).

import { applyAction } from './battle';
import { canHurt, forecast } from './combat';
import { areHostile, attackWeaponOf, distance, getUnit, livingUnits, staffOf, tileIndex } from './grid';
import { actionTiles, attackTargets, distanceField, healTargets, moveTiles, reachableTiles } from './pathfinding';
import { itemDef } from './items';
import { canUsePower, powerDirections, powerForecast, powerIds, powerTargets, type PowerAim, type PowerForecast } from './powers';
import type { Action, ActionResult, AiState, BattleEvent, BattleState, Forecast, GameData, Pos, Unit } from './types';

interface Candidate {
  action: Action;
  score: number;
}

/** Score of attacking `targetId` from `from`: expected damage, a lethal bonus, minus expected counter damage. */
export function attackScore(state: BattleState, unit: Unit, targetId: string, from: Pos, data: GameData): number {
  return fightScore(state, unit, forecast(state, unit.id, targetId, from, data));
}

function fightScore(state: BattleState, unit: Unit, fc: Forecast): number {
  const target = getUnit(state, fc.defenderId);
  const a = fc.attacker;
  const dealt = (Math.min(target.hp, a.damage * a.strikes) * a.hit) / 100;
  const lethal = a.damage * a.strikes >= target.hp ? (40 * a.hit) / 100 : 0;
  const c = fc.counter;
  const taken = c ? (Math.min(unit.hp, c.damage * c.strikes) * c.hit) / 100 : 0;
  return dealt * 2 + lethal - taken + (target.isLord ? 5 : 0);
}

/**
 * The highest-scoring attack from any of `tiles`, or null. Attacks with zero
 * expected damage (hit 0 or damage 0) are never chosen: they only feed the counter.
 */
function bestAttack(state: BattleState, unit: Unit, tiles: Pos[], data: GameData): Candidate | null {
  let best: Candidate | null = null;
  for (const to of tiles) {
    for (const targetId of attackTargets(state, unit.id, to, data)) {
      const a = forecast(state, unit.id, targetId, to, data).attacker;
      if (a.hit <= 0 || a.damage <= 0) continue;
      const score = attackScore(state, unit, targetId, to, data);
      if (!best || score > best.score) best = { action: { type: 'attack', unitId: unit.id, to, targetId }, score };
    }
  }
  return best;
}

/**
 * Score of firing a power: a fight is scored like an attack (plus Devour's expected heal and Echo's repeat
 * strike); Scatter adds up the expected damage and lethal bonus over every target, with no counters.
 */
export function powerScore(state: BattleState, unit: Unit, fc: PowerForecast, data?: GameData): number {
  // Hush and Pin are worth a little more than their damage: the status, weighted by its chance to land.
  const statusValue = data?.balance.ai.statusValue ?? 0;
  let status = 0;
  if (fc.status !== null) for (const t of fc.targets) status += (statusValue * (fc.statusOnHit ? t.side.hit : 100)) / 100;
  if (fc.combat) {
    const a = fc.combat.attacker;
    const target = getUnit(state, fc.combat.defenderId);
    const dealt = (Math.min(target.hp, a.damage * a.strikes) * a.hit) / 100;
    const echo = fc.echoStrike ? (Math.min(target.hp, fc.echoStrike.damage) * fc.echoStrike.hit) / 100 : 0;
    // Cleave's splash: the expected damage on every other foe beside the bearer.
    let splash = 0;
    for (const t of fc.targets.slice(1)) splash += ((Math.min(getUnit(state, t.unitId).hp, t.side.damage) * t.side.hit) / 100) * 2;
    return fightScore(state, unit, fc.combat) + echo * 2 + Math.min(fc.healMax, dealt) + splash + status - fc.bloodPrice;
  }
  let score = status - fc.bloodPrice;
  for (const t of fc.targets) {
    const target = getUnit(state, t.unitId);
    score += ((Math.min(target.hp, t.side.damage) * t.side.hit) / 100) * 2;
    if (t.side.damage >= target.hp) score += (40 * t.side.hit) / 100;
    if (target.isLord) score += 5;
  }
  return score;
}

/**
 * The best power use from any of `tiles`, or null when no power is ready or none hits anything. Each power the
 * bearer has is scored; the first power's action carries no `powerId`, so a Dormant blade plans as before.
 */
function bestPower(state: BattleState, unit: Unit, tiles: Pos[], data: GameData): Candidate | null {
  let best: Candidate | null = null;
  powerIds(state, unit.id, data).forEach((powerId, i) => {
    const pick = i === 0 ? {} : { powerId };
    for (const to of tiles) {
      if (!canUsePower(state, unit.id, to, data, powerId)) continue;
      const aims: PowerAim[] = [
        ...powerTargets(state, unit.id, to, data, powerId).map((targetId) => ({ targetId })),
        ...powerDirections(state, unit.id, to, data, powerId).map((dir) => ({ dir })),
      ];
      for (const aim of aims) {
        const fc = powerForecast(state, unit.id, to, aim, data, powerId);
        if (fc.targets.every((t) => t.side.hit <= 0 || t.side.damage <= 0)) continue;
        const score = powerScore(state, unit, fc, data);
        if (!best || score > best.score) best = { action: { type: 'power', unitId: unit.id, to, ...aim, ...pick }, score };
      }
    }
  });
  return best;
}

/** A healing item to drink where it stands, for an AI unit low on HP, or null. */
function drinkIfLow(unit: Unit, data: GameData): Action | null {
  if (unit.team === 'player' || unit.hp * 100 >= unit.stats.hp * data.balance.ai.itemBelowPercent) return null;
  const itemIndex = unit.inventory.findIndex((id) => (itemDef(id, data)?.heal ?? 0) > 0);
  return itemIndex < 0 ? null : { type: 'item', unitId: unit.id, to: { ...unit.pos }, itemIndex };
}

/**
 * The best strike from `tiles`: an attack, or the unit's power when it is ready and beats the best attack by
 * balance.resolve.aiMargin. Player units (the simulator's side) never fire powers here.
 */
function bestStrike(state: BattleState, unit: Unit, tiles: Pos[], data: GameData): Candidate | null {
  const attack = bestAttack(state, unit, tiles, data);
  if (unit.team === 'player') return attack;
  const power = bestPower(state, unit, tiles, data);
  if (power && (!attack || power.score >= attack.score + data.balance.resolve.aiMargin)) return power;
  return attack;
}

function bestHeal(state: BattleState, unit: Unit, tiles: Pos[], data: GameData): Action | null {
  let best: { action: Action; missing: number } | null = null;
  for (const to of tiles) {
    for (const targetId of healTargets(state, unit.id, to, data)) {
      const t = getUnit(state, targetId);
      const missing = t.stats.hp - t.hp;
      if (!best || missing > best.missing) best = { action: { type: 'heal', unitId: unit.id, to, targetId }, missing };
    }
  }
  return best ? best.action : null;
}

/** Move to the stoppable tile with the lowest field value (ties: less movement, then tile order). */
function moveToward(state: BattleState, unit: Unit, sources: Pos[], data: GameData): Action {
  const stay: Action = { type: 'wait', unitId: unit.id, to: { ...unit.pos } };
  if (sources.length === 0) return stay;
  const field = distanceField(state, unit, sources, data);
  let best: { to: Pos; d: number; cost: number } | null = null;
  for (const t of reachableTiles(state, unit.id, data)) {
    if (!t.canStop) continue;
    const d = field[tileIndex(state, t.pos)]!;
    if (!best || d < best.d || (d === best.d && t.cost < best.cost)) best = { to: t.pos, d, cost: t.cost };
  }
  if (!best || best.d === Infinity) return stay;
  return { type: 'wait', unitId: unit.id, to: best.to };
}

/**
 * Attack the best target in reach; otherwise walk toward the nearest foe it can
 * hurt. If it can hurt nobody, it walks toward the nearest hostile lord (or any
 * hostile when there is no lord), and never attacks.
 */
function charge(state: BattleState, unit: Unit, data: GameData): Action {
  const attack = bestStrike(state, unit, moveTiles(state, unit.id, data), data);
  if (attack) return attack.action;
  const foes = livingUnits(state).filter((u) => areHostile(unit.team, u.team));
  const hurtable = foes.filter((u) => canHurt(state, unit.id, u.id, data));
  const lords = foes.filter((u) => u.isLord);
  const goals = hurtable.length > 0 ? hurtable : lords.length > 0 ? lords : foes;
  return moveToward(
    state,
    unit,
    goals.map((u) => u.pos),
    data,
  );
}

/**
 * Plan one unit's action with its own AI, or with `ai` if given (the simulator
 * uses this to drive player units). Pure and deterministic.
 */
export function planUnitAction(state: BattleState, unitId: string, data: GameData, ai?: AiState): Action {
  const unit = getUnit(state, unitId);
  const brain = ai ?? unit.ai ?? { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };
  const view: Unit = { ...unit, ai: brain };
  const viewState: BattleState = ai ? { ...state, units: state.units.map((u) => (u.id === unitId ? view : u)) } : state;
  const stay: Action = { type: 'wait', unitId, to: { ...unit.pos } };

  const drink = ai ? null : drinkIfLow(unit, data);
  if (drink) return drink;
  if (staffOf(unit, data)) return bestHeal(viewState, view, actionTiles(viewState, unitId, data), data) ?? stay;
  if (!attackWeaponOf(unit, data)) return stay;

  switch (brain.behavior) {
    case 'charge':
      return charge(viewState, view, data);
    case 'hold': {
      if (brain.active) return charge(viewState, view, data);
      const attack = bestStrike(viewState, view, moveTiles(viewState, unitId, data), data);
      return attack ? attack.action : stay;
    }
    case 'guard': {
      const attack = bestStrike(viewState, view, actionTiles(viewState, unitId, data), data);
      if (attack) return attack.action;
      const g = brain.guardTile ?? unit.pos;
      if (distance(unit.pos, g) <= brain.guardRadius) return stay;
      return moveToward(viewState, view, [g], data);
    }
  }
}

/**
 * The next AI action for the current phase: the first living, un-acted unit of the
 * phase's team (in unit order) acts; when none is left, `endPhase`. Returns null in
 * the player phase or once the battle is over.
 */
export function planAiAction(state: BattleState, data: GameData): Action | null {
  if (state.result !== 'ongoing' || state.phase === 'player') return null;
  const unit = state.units.find((u) => u.alive && u.team === state.phase && !u.acted);
  if (!unit) return { type: 'endPhase' };
  return planUnitAction(state, unit.id, data);
}

/** Run AI phases until the player phase begins or the battle ends. For tests and the simulator. */
export function runAiPhase(state: BattleState, data: GameData): ActionResult {
  let s = state;
  const events: BattleEvent[] = [];
  for (let guard = 0; guard < 10000; guard++) {
    const action = planAiAction(s, data);
    if (!action) return { state: s, events };
    const r = applyAction(s, action, data);
    s = r.state;
    events.push(...r.events);
  }
  throw new Error('runAiPhase did not finish');
}

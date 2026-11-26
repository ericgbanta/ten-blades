// Battle creation and the action reducer.

import { forecast } from './combat';
import { clash } from './clash';
import { ActionError } from './errors';
import {
  areHostile,
  attackWeaponOf,
  distance,
  findUnit,
  getUnit,
  inBounds,
  livingUnits,
  samePos,
  staffOf,
  terrainAt,
  unitAt,
} from './grid';
import { grantXp } from './leveling';
import { DIRECTIONS, powerBlock, powerDirections, powerPlan, powerTargets, resolvePower, type PowerAim } from './powers';
import { startingResolve } from './resolve';
import { canTalk, runEvents } from './events';
import { checkOutcome, endBattle, turnLimitReached } from './objectives';
import { canMoveTo, pathTo } from './pathfinding';
import { createRng } from './rng';
import { newMc, unitFromParty, unitFromPlacement } from './units';
import type { Action, ActionResult, Direction, McSlot, BattleEvent, BattleSetup, BattleState, GameData, MapData, PartyUnit, Pos, Team, Unit } from './types';

export { ActionError, newMc, unitFromPlacement };

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Create a battle on `map`. The MC slot takes the party's lord, or a new MC built
 * from `setup.mc`. Party slots take the other party members in order (unused slots
 * stay empty). Turn 1, player phase.
 *
 * Throws an Error if two units would share an id (party members, map placements
 * and every reinforcement wave count), or if a protect objective's unit is not on
 * the player or ally team at the start.
 */
export function createBattle(map: MapData, setup: BattleSetup, seed: number, data: GameData): BattleState {
  const party = setup.party ?? [];
  const lord = (slot: McSlot): PartyUnit => {
    const carried = party.find((m) => m.isLord);
    if (carried) return carried;
    const mc = newMc(setup, data);
    const w = slot.weapons?.[setup.mc.style];
    return w ? { ...mc, weaponId: w } : mc;
  };
  const others = party.filter((m) => !m.isLord);
  const units: Unit[] = [];
  let next = 0;
  for (const p of map.placements) {
    if (p.kind === 'mc') units.push(unitFromParty(lord(p), p.pos));
    else if (p.kind === 'party') {
      const m = others[next++];
      if (m) units.push(unitFromParty(m, p.pos));
    } else units.push(unitFromPlacement(p, setup.difficulty, data));
  }
  const ids = new Set<string>();
  const spawned = (map.events ?? []).flatMap((ev) => ev.effects.flatMap((fx) => (fx.type === 'spawn' ? fx.units.map((p) => p.id) : [])));
  for (const id of [...units.map((u) => u.id), ...map.reinforcements.flatMap((w) => w.units.map((p) => p.id)), ...spawned]) {
    if (ids.has(id)) throw new Error(`Map ${map.id}: duplicate unit id ${id}`);
    ids.add(id);
  }
  const obj = map.objective;
  if (obj.type === 'protect' && !units.some((u) => u.id === obj.unitId && u.team !== 'enemy')) {
    throw new Error(`Map ${map.id}: protect target ${obj.unitId} is not a player or ally unit at the start`);
  }
  for (const u of units) u.resolve = startingResolve(u, data);
  const terrain: string[] = [];
  for (const row of map.tiles) {
    for (const ch of row) {
      const id = map.legend[ch];
      if (id === undefined) throw new Error(`Map ${map.id}: no legend entry for '${ch}'`);
      terrain.push(id);
    }
  }
  return {
    version: 3,
    mapId: map.id,
    map: { width: map.width, height: map.height, terrain },
    units,
    turn: 1,
    phase: 'player',
    rng: createRng(seed),
    objective: structuredClone(map.objective),
    reinforcements: structuredClone(map.reinforcements.filter((w) => w.difficulties.includes(setup.difficulty))),
    options: { difficulty: setup.difficulty, permadeath: setup.permadeath },
    result: 'ongoing',
    started: false,
    flags: { ...(setup.flags ?? {}) },
    firedEvents: [],
    recruited: [],
    powerLog: [],
  };
}

/**
 * Start the battle: fire the battle start events (battleStart, flag, and turn 1's player phase) and return the
 * started state with their events. Does nothing to a battle already started. The first action of a battle that
 * was never started starts it first, so callers that never call this still get the same game.
 */
export function startBattle(state: BattleState, data: GameData): ActionResult {
  if (state.started) return { state, events: [] };
  const s = structuredClone(state);
  const events: BattleEvent[] = [];
  s.started = true;
  runEvents(s, [], data, events, true);
  if (s.result === 'ongoing') {
    const r = checkOutcome(s);
    if (r !== 'ongoing') endBattle(s, r, events);
  }
  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ACTION_TYPES = ['wait', 'attack', 'heal', 'talk', 'power', 'endPhase'];

function isPos(v: unknown): v is Pos {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return Number.isInteger(p.x) && Number.isInteger(p.y);
}

/** Why a value is not a well-formed Action, or null. Guards against malformed input from the UI or a save. */
function shapeError(action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return 'Not an action';
  const a = action as Record<string, unknown>;
  if (typeof a.type !== 'string' || !ACTION_TYPES.includes(a.type)) return `Unknown action type ${String(a.type)}`;
  if (a.type === 'endPhase') return null;
  if (typeof a.unitId !== 'string') return `${a.type} needs a unitId`;
  if (!isPos(a.to)) return `${a.type} needs a target tile`;
  if (a.type === 'power') {
    if (a.targetId !== undefined && typeof a.targetId !== 'string') return 'power needs a targetId or a direction';
    if (a.dir !== undefined && !DIRECTIONS.includes(a.dir as never)) return `Unknown direction ${String(a.dir)}`;
    if ((a.targetId === undefined) === (a.dir === undefined)) return 'power needs a targetId or a direction';
    return null;
  }
  if (a.type !== 'wait' && typeof a.targetId !== 'string') return `${a.type} needs a targetId`;
  return null;
}

/** Why `action` is illegal in `state`, or null if it is legal. */
export function validateAction(state: BattleState, action: Action, data: GameData): string | null {
  if (state.result !== 'ongoing') return 'The battle is over';
  const shape = shapeError(action);
  if (shape !== null) return shape;
  if (action.type === 'endPhase') return null;
  const unit = findUnit(state, action.unitId);
  if (!unit || !unit.alive) return `No living unit ${action.unitId}`;
  if (unit.team !== state.phase) return `${unit.id} cannot act in the ${state.phase} phase`;
  if (unit.acted) return `${unit.id} has already acted`;
  if (!inBounds(state, action.to) || !canMoveTo(state, unit.id, action.to, data)) {
    return `${unit.id} cannot move to ${action.to.x},${action.to.y}`;
  }
  if (action.type === 'wait') return null;
  if (action.type === 'power') return powerError(state, action.unitId, action.to, action, data);
  const target = findUnit(state, action.targetId);
  if (!target || !target.alive) return `No living target ${action.targetId}`;
  const d = distance(action.to, target.pos);
  if (action.type === 'talk') {
    if (target.id === unit.id) return `${unit.id} cannot talk to itself`;
    if (!canTalk(state, unit.id, target.id, data)) return `${unit.id} has nothing to say to ${target.id}`;
    if (d !== 1) return `${target.id} is not next to ${action.to.x},${action.to.y}`;
    return null;
  }
  if (action.type === 'attack') {
    const w = attackWeaponOf(unit, data);
    if (!w) return `${unit.id} has no attack weapon`;
    if (!areHostile(unit.team, target.team)) return `${target.id} is not hostile`;
    if (d < w.range[0] || d > w.range[1]) return `${target.id} is out of range`;
    return null;
  }
  const staff = staffOf(unit, data);
  if (!staff) return `${unit.id} has no staff`;
  if (target.id === unit.id || areHostile(unit.team, target.team)) return `${target.id} is not a friendly unit`;
  if (target.hp >= target.stats.hp) return `${target.id} is not wounded`;
  if (d < staff.range[0] || d > staff.range[1]) return `${target.id} is out of range`;
  return null;
}

/** Why a power action is illegal (the unit can act and reach `to`), or null. */
function powerError(state: BattleState, unitId: string, to: Pos, aim: { targetId?: string; dir?: string }, data: GameData): string | null {
  const block = powerBlock(state, unitId, data);
  if (block !== null) return block;
  const plan = powerPlan(state, unitId, data)!;
  if (plan.aim === 'line') {
    if (aim.dir === undefined) return `${plan.name} needs a direction`;
    if (!powerDirections(state, unitId, to, data).includes(aim.dir as never)) return `No enemy in the line ${aim.dir}`;
    return null;
  }
  if (aim.targetId === undefined) return `${plan.name} needs a target`;
  const target = findUnit(state, aim.targetId);
  if (!target || !target.alive) return `No living target ${aim.targetId}`;
  if (!powerTargets(state, unitId, to, data).includes(target.id)) return `${target.id} is not a target of ${plan.name}`;
  return null;
}

/** The aim of a valid power action. */
function aimOf(a: { targetId?: string; dir?: string }): PowerAim {
  return a.dir !== undefined ? { dir: a.dir as Direction } : { targetId: a.targetId! };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Apply one action and return the new state plus the events to animate. Never
 * mutates `state`. Throws ActionError for an illegal action.
 */
export function applyAction(state: BattleState, action: Action, data: GameData): ActionResult {
  if (!state.started) {
    // A battle nobody started (tests, the simulator) starts with its first action.
    const begun = startBattle(state, data);
    const r = applyAction(begun.state, action, data);
    return { state: r.state, events: [...begun.events, ...r.events] };
  }
  const err = validateAction(state, action, data);
  if (err !== null) throw new ActionError(err);
  const s = structuredClone(state);
  const events: BattleEvent[] = [];
  switch (action.type) {
    case 'wait': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      finishUnit(u, events);
      break;
    }
    case 'attack': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      fight(s, u, getUnit(s, action.targetId), data, events);
      if (u.alive) finishUnit(u, events);
      break;
    }
    case 'power': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      resolvePower(s, u, aimOf(action), data, events);
      if (u.alive) finishUnit(u, events);
      break;
    }
    case 'heal': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      heal(s, u, getUnit(s, action.targetId), data, events);
      finishUnit(u, events);
      break;
    }
    case 'talk': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      finishUnit(u, events);
      events.push({ type: 'talked', unitId: u.id, targetId: action.targetId });
      break;
    }
    case 'endPhase':
      advancePhase(s, data, events);
      break;
  }
  if (s.result === 'ongoing') runEvents(s, events.slice(), data, events);
  if (s.result === 'ongoing') {
    const r = checkOutcome(s);
    if (r !== 'ongoing') endBattle(s, r, events);
  }
  return { state: s, events };
}

function moveUnit(s: BattleState, u: Unit, to: Pos, data: GameData, events: BattleEvent[]): void {
  if (samePos(u.pos, to)) return;
  const path = pathTo(s, u.id, to, data);
  if (!path) throw new ActionError(`${u.id} cannot reach ${to.x},${to.y}`);
  events.push({ type: 'unitMoved', unitId: u.id, from: { ...u.pos }, to: { ...to }, path });
  u.pos = { ...to };
}

function finishUnit(u: Unit, events: BattleEvent[]): void {
  u.acted = true;
  events.push({ type: 'unitActed', unitId: u.id });
}

function fight(s: BattleState, a: Unit, d: Unit, data: GameData, events: BattleEvent[]): void {
  clash(s, a, d, forecast(s, a.id, d.id, a.pos, data), data, events);
}

function heal(s: BattleState, u: Unit, t: Unit, data: GameData, events: BattleEvent[]): void {
  const staff = staffOf(u, data);
  if (!staff) throw new ActionError(`${u.id} has no staff`);
  const amount = Math.min(t.stats.hp - t.hp, staff.heal + u.stats.mag);
  t.hp += amount;
  events.push({ type: 'unitHealed', unitId: t.id, sourceId: u.id, cause: 'staff', amount, hpAfter: t.hp });
  if (u.team === 'player') s.rng = grantXp(u, data.balance.xp.healXp, s.rng, data, events);
}

/** Phase order: player, enemy, then ally if any allies live, then the next turn. */
function advancePhase(s: BattleState, data: GameData, events: BattleEvent[]): void {
  for (const u of s.units) if (u.team === s.phase) u.acted = false;
  let next: Team;
  if (s.phase === 'player') next = 'enemy';
  else if (s.phase === 'enemy' && livingUnits(s, 'ally').length > 0) next = 'ally';
  else next = 'player';
  if (next === 'player') {
    if (turnLimitReached(s, s.turn)) {
      endBattle(s, 'victory', events);
      return;
    }
    s.turn += 1;
    events.push({ type: 'turnStarted', turn: s.turn });
  }
  s.phase = next;
  events.push({ type: 'phaseChanged', phase: next, turn: s.turn });
  if (next === 'enemy') spawnReinforcements(s, data, events);
  terrainHeal(s, next, data, events);
}

/**
 * Waves for this turn arrive at the start of the enemy phase. A blocked tile drops
 * that unit. Each arrival acts in its team's next phase: enemies next turn, allies
 * in this turn's ally phase, player units in the next player phase.
 */
function spawnReinforcements(s: BattleState, data: GameData, events: BattleEvent[]): void {
  const due = s.reinforcements.filter((w) => w.turn === s.turn);
  if (due.length === 0) return;
  s.reinforcements = s.reinforcements.filter((w) => w.turn !== s.turn);
  const ids: string[] = [];
  for (const w of due) {
    for (const p of w.units) {
      if (unitAt(s, p.pos) || findUnit(s, p.id)) continue;
      const u = unitFromPlacement(p, s.options.difficulty, data);
      // Only units of the phase in progress wait; the others reset when their phase comes.
      u.acted = u.team === s.phase;
      s.units.push(u);
      ids.push(u.id);
    }
  }
  if (ids.length > 0) events.push({ type: 'reinforcementsArrived', unitIds: ids });
}

function terrainHeal(s: BattleState, team: Team, data: GameData, events: BattleEvent[]): void {
  for (const u of livingUnits(s, team)) {
    const pct = terrainAt(s, u.pos, data).healPercent;
    if (pct <= 0 || u.hp >= u.stats.hp) continue;
    const amount = Math.min(u.stats.hp - u.hp, Math.max(1, Math.floor((u.stats.hp * pct) / 100)));
    u.hp += amount;
    events.push({ type: 'unitHealed', unitId: u.id, sourceId: null, cause: 'terrain', amount, hpAfter: u.hp });
  }
}

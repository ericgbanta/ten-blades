// Battle creation and the action reducer.

import { forecast, resolveCombat } from './combat';
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
import { averageStats, combatXp, grantXp } from './leveling';
import { checkOutcome, fallenPlayerUnitIds, turnLimitReached } from './objectives';
import { canMoveTo, pathTo } from './pathfinding';
import { createRng } from './rng';
import {
  STAT_KEYS,
  type Action,
  type ActionResult,
  type AiState,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type Difficulty,
  type GameData,
  type MapData,
  type PartyUnit,
  type Pos,
  type Stats,
  type Team,
  type Unit,
  type UnitPlacement,
} from './types';

/** Thrown by applyAction for an action that is not legal in the given state. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

function applyDifficulty(stats: Stats, difficulty: Difficulty, data: GameData): Stats {
  const d = data.balance.difficulty[difficulty];
  const out = { ...stats };
  for (const k of STAT_KEYS) {
    if (k === 'mov') continue;
    out[k] = Math.round(stats[k] * d.statMultiplier) + (d.statBonus[k] ?? 0);
  }
  return out;
}

function aiFromPlacement(p: UnitPlacement, difficulty: Difficulty, data: GameData): AiState | null {
  if (p.team === 'player') return null;
  const spec = p.ai ?? (p.isBoss ? { behavior: 'guard' as const } : { behavior: 'charge' as const });
  let behavior = spec.behavior;
  if (behavior === 'hold' && p.team === 'enemy' && data.balance.difficulty[difficulty].aggressive) behavior = 'charge';
  return {
    behavior,
    guardTile: behavior === 'guard' ? { ...(spec.tile ?? p.pos) } : null,
    guardRadius: behavior === 'guard' ? (spec.radius ?? 0) : 0,
    active: false,
  };
}

/** Build a unit from map data. Enemies get the difficulty's level and stat changes. */
export function unitFromPlacement(p: UnitPlacement, difficulty: Difficulty, data: GameData): Unit {
  const cls = data.classes[p.classId];
  if (!cls) throw new Error(`Unknown class ${p.classId}`);
  const isEnemy = p.team === 'enemy';
  const level = Math.min(p.level + (isEnemy ? data.balance.difficulty[difficulty].levelBonus : 0), data.balance.xp.levelCap);
  let stats = averageStats(p.classId, level, data);
  if (isEnemy) stats = applyDifficulty(stats, difficulty, data);
  return {
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
  };
}

function unitFromParty(m: PartyUnit, pos: Pos): Unit {
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

/**
 * Create a battle on `map`. The MC slot takes the party's lord, or a new MC built
 * from `setup.mc`. Party slots take the other party members in order (unused slots
 * stay empty). Turn 1, player phase.
 */
export function createBattle(map: MapData, setup: BattleSetup, seed: number, data: GameData): BattleState {
  const party = setup.party ?? [];
  const lord = (): PartyUnit => party.find((m) => m.isLord) ?? newMc(setup, data);
  const others = party.filter((m) => !m.isLord);
  const units: Unit[] = [];
  let next = 0;
  for (const p of map.placements) {
    if (p.kind === 'mc') units.push(unitFromParty(lord(), p.pos));
    else if (p.kind === 'party') {
      const m = others[next++];
      if (m) units.push(unitFromParty(m, p.pos));
    } else units.push(unitFromPlacement(p, setup.difficulty, data));
  }
  const terrain: string[] = [];
  for (const row of map.tiles) {
    for (const ch of row) {
      const id = map.legend[ch];
      if (id === undefined) throw new Error(`Map ${map.id}: no legend entry for '${ch}'`);
      terrain.push(id);
    }
  }
  return {
    version: 1,
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
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Why `action` is illegal in `state`, or null if it is legal. */
export function validateAction(state: BattleState, action: Action, data: GameData): string | null {
  if (state.result !== 'ongoing') return 'The battle is over';
  if (action.type === 'endPhase') return null;
  const unit = findUnit(state, action.unitId);
  if (!unit || !unit.alive) return `No living unit ${action.unitId}`;
  if (unit.team !== state.phase) return `${unit.id} cannot act in the ${state.phase} phase`;
  if (unit.acted) return `${unit.id} has already acted`;
  if (!inBounds(state, action.to) || !canMoveTo(state, unit.id, action.to, data)) {
    return `${unit.id} cannot move to ${action.to.x},${action.to.y}`;
  }
  if (action.type === 'wait') return null;
  const target = findUnit(state, action.targetId);
  if (!target || !target.alive) return `No living target ${action.targetId}`;
  const d = distance(action.to, target.pos);
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Apply one action and return the new state plus the events to animate. Never
 * mutates `state`. Throws ActionError for an illegal action.
 */
export function applyAction(state: BattleState, action: Action, data: GameData): ActionResult {
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
    case 'heal': {
      const u = getUnit(s, action.unitId);
      moveUnit(s, u, action.to, data, events);
      heal(s, u, getUnit(s, action.targetId), data, events);
      finishUnit(u, events);
      break;
    }
    case 'endPhase':
      advancePhase(s, data, events);
      break;
  }
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

function activateHold(u: Unit): void {
  if (u.ai && u.ai.behavior === 'hold') u.ai.active = true;
}

function fight(s: BattleState, a: Unit, d: Unit, data: GameData, events: BattleEvent[]): void {
  const fc = forecast(s, a.id, d.id, a.pos, data);
  events.push({ type: 'combatStarted', attackerId: a.id, defenderId: d.id, forecast: fc });
  const r = resolveCombat(fc, s.rng, data.balance);
  s.rng = r.rng;
  for (const st of r.strikes) events.push({ type: 'strike', ...st });
  a.hp = r.attackerHp;
  d.hp = r.defenderHp;
  activateHold(a);
  activateHold(d);
  events.push({ type: 'combatEnded', attackerId: a.id, defenderId: d.id });
  if (r.defeatedId !== null) {
    const dead = r.defeatedId === a.id ? a : d;
    dead.alive = false;
    dead.acted = true;
    events.push({ type: 'unitDefeated', unitId: dead.id, byId: dead === a ? d.id : a.id });
  }
  for (const [u, foe] of [
    [a, d],
    [d, a],
  ] as const) {
    if (u.team !== 'player' || !u.alive) continue;
    const dealt = r.strikes.some((st) => st.attackerId === u.id && st.damage > 0);
    const amount = combatXp(u.level, foe.level, dealt, !foe.alive, foe.isBoss, data.balance);
    s.rng = grantXp(u, amount, s.rng, data, events);
  }
}

function heal(s: BattleState, u: Unit, t: Unit, data: GameData, events: BattleEvent[]): void {
  const staff = staffOf(u, data);
  if (!staff) throw new ActionError(`${u.id} has no staff`);
  const amount = Math.min(t.stats.hp - t.hp, staff.heal + u.stats.mag);
  t.hp += amount;
  events.push({ type: 'unitHealed', unitId: t.id, sourceId: u.id, cause: 'staff', amount, hpAfter: t.hp });
  if (u.team === 'player') s.rng = grantXp(u, data.balance.xp.healXp, s.rng, data, events);
}

function endBattle(s: BattleState, result: 'victory' | 'defeat', events: BattleEvent[]): void {
  s.result = result;
  events.push({ type: 'battleEnded', result, fallenPlayerUnitIds: fallenPlayerUnitIds(s) });
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

/** Waves for this turn arrive at the start of the enemy phase. A blocked tile drops that unit. They act next turn. */
function spawnReinforcements(s: BattleState, data: GameData, events: BattleEvent[]): void {
  const due = s.reinforcements.filter((w) => w.turn === s.turn);
  if (due.length === 0) return;
  s.reinforcements = s.reinforcements.filter((w) => w.turn !== s.turn);
  const ids: string[] = [];
  for (const w of due) {
    for (const p of w.units) {
      if (unitAt(s, p.pos) || findUnit(s, p.id)) continue;
      const u = unitFromPlacement(p, s.options.difficulty, data);
      u.acted = true;
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

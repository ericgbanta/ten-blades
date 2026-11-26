// The Resolve gauge and blade lookups. A unit is a bearer when its weapon names a blade (WeaponDef.blade); only
// bearers have a gauge. The gauge fills when the bearer lands or takes hits, crits and kills (balance.resolve),
// and a power spends it. Pure: helpers that change a unit work on the caller's own copy.

import type { BattleEvent, BladeDef, GameData, PowerDef, PowerEffect, Unit } from './types';

/** The blade a unit holds, or null. */
export function bladeOf(unit: Unit, data: GameData): BladeDef | null {
  if (unit.weaponId === null) return null;
  const id = data.weapons[unit.weaponId]?.blade;
  return id ? (data.blades[id] ?? null) : null;
}

/** Id of the blade a unit holds, or null. */
export function bladeIdOf(unit: Unit, data: GameData): string | null {
  if (unit.weaponId === null) return null;
  const id = data.weapons[unit.weaponId]?.blade;
  return id && data.blades[id] ? id : null;
}

/** True if the unit holds a blade and so runs a gauge. */
export function isBearer(unit: Unit, data: GameData): boolean {
  return bladeOf(unit, data) !== null;
}

export interface BearerPower {
  id: string;
  def: PowerDef;
  effect: PowerEffect;
}

/** The power of the blade a unit holds, when it is implemented; else null. */
export function bearerPower(unit: Unit, data: GameData): BearerPower | null {
  const blade = bladeOf(unit, data);
  if (!blade) return null;
  return implementedPower(blade.power, data);
}

/** A power by id when it is implemented, else null. */
export function implementedPower(id: string, data: GameData): BearerPower | null {
  const def = data.powers[id];
  if (!def || !def.implemented || !def.effect) return null;
  return { id, def, effect: def.effect };
}

/** Resolve a power spends. */
export function powerCost(def: PowerDef, data: GameData): number {
  return def.cost ?? data.balance.resolve.max;
}

/** Gauge for a unit at the start of a battle (or on arrival). */
export function startingResolve(unit: Unit, data: GameData): number {
  return isBearer(unit, data) ? Math.min(data.balance.resolve.start, data.balance.resolve.max) : 0;
}

/** Devour's attack per stack: from the first devour power in the data. */
function attackPerStack(data: GameData): number {
  for (const p of Object.values(data.powers ?? {})) if (p.effect?.type === 'devour') return p.effect.attackPerKill;
  return 0;
}

/** Attack the unit's Devour stacks add. */
export function devourBonus(unit: Unit, data: GameData): number {
  return unit.devourStacks > 0 ? unit.devourStacks * attackPerStack(data) : 0;
}

function maxStacks(data: GameData): number {
  for (const p of Object.values(data.powers)) if (p.effect?.type === 'devour') return p.effect.maxStacks;
  return 0;
}

/** One more Devour stack, up to the cap. */
export function addDevourStack(unit: Unit, data: GameData, events: BattleEvent[]): void {
  if (unit.devourStacks >= maxStacks(data)) return;
  unit.devourStacks += 1;
  events.push({ type: 'devourStack', unitId: unit.id, stacks: unit.devourStacks, attackBonus: devourBonus(unit, data) });
}

/** Change a bearer's gauge by `amount`, clamped to 0 and max. Non-bearers have no gauge. */
export function changeResolve(unit: Unit, amount: number, data: GameData, events: BattleEvent[]): void {
  if (!isBearer(unit, data) || amount === 0) return;
  const after = Math.max(0, Math.min(data.balance.resolve.max, unit.resolve + amount));
  if (after === unit.resolve) return;
  const delta = after - unit.resolve;
  unit.resolve = after;
  events.push({ type: 'resolveChanged', unitId: unit.id, amount: delta, resolveAfter: after });
}

export interface StrikeLike {
  attackerId: string;
  defenderId: string;
  hit: boolean;
  crit: boolean;
}

/**
 * Gauge gains from some strikes and kills, one change per unit in unit order. `casterId` is the unit firing a
 * power: it gains nothing from its own power (so a power cannot refill itself); everyone else gains as usual.
 */
export function gainFromStrikes(
  units: Unit[],
  strikes: readonly StrikeLike[],
  killerIds: readonly string[],
  casterId: string | null,
  data: GameData,
  events: BattleEvent[],
): void {
  const r = data.balance.resolve;
  const gain = new Map<string, number>();
  const add = (id: string, n: number) => {
    if (id !== casterId) gain.set(id, (gain.get(id) ?? 0) + n);
  };
  for (const st of strikes) {
    if (!st.hit) continue;
    add(st.attackerId, r.dealHit + (st.crit ? r.crit : 0));
    add(st.defenderId, r.takeHit);
  }
  for (const id of killerIds) add(id, r.kill);
  for (const u of units) {
    const n = gain.get(u.id);
    if (n !== undefined && u.alive) changeResolve(u, n, data, events);
  }
}

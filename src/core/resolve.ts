// The Resolve gauge and blade lookups. A unit is a bearer when its weapon names a blade (WeaponDef.blade); only
// bearers have a gauge. The gauge fills when the bearer lands or takes hits, crits and kills (balance.resolve),
// and a power spends it. Pure: helpers that change a unit work on the caller's own copy.

import { weaponDef } from './items';
import type { BattleEvent, BattleState, BladeDef, GameData, PowerDef, PowerEffect, Unit } from './types';

/** The blade a unit holds, or null. */
export function bladeOf(unit: Pick<Unit, 'weaponId'>, data: GameData): BladeDef | null {
  const id = bladeIdOf(unit, data);
  return id ? data.blades[id]! : null;
}

/** Id of the blade a unit holds, or null. */
export function bladeIdOf(unit: Pick<Unit, 'weaponId'>, data: GameData): string | null {
  if (unit.weaponId === null) return null;
  const id = weaponDef(unit.weaponId, data)?.blade;
  return id && data.blades[id] ? id : null;
}

/** A blade's tier in this battle: 1 (Dormant) unless the campaign awakened it. */
export function bladeTier(state: Pick<BattleState, 'bladeTiers'>, bladeId: string): number {
  return state.bladeTiers[bladeId] ?? 1;
}

/** The unit's blade tier, or 0 for a unit holding no blade. */
export function unitBladeTier(state: Pick<BattleState, 'bladeTiers'>, unit: Pick<Unit, 'weaponId'>, data: GameData): number {
  const id = bladeIdOf(unit, data);
  return id ? bladeTier(state, id) : 0;
}

/**
 * Every built power the unit's blade has at its tier, in tier order: the Dormant power first, then the one an
 * Awakened (tier 2) or Unbound (tier 3) blade adds. Empty for a unit with no blade.
 */
export function bearerPowers(state: Pick<BattleState, 'bladeTiers'>, unit: Pick<Unit, 'weaponId'>, data: GameData): BearerPower[] {
  const id = bladeIdOf(unit, data);
  if (!id) return [];
  const blade = data.blades[id]!;
  const tier = bladeTier(state, id);
  const out: BearerPower[] = [];
  const first = implementedPower(blade.power, data);
  if (first) out.push(first);
  for (const t of blade.tiers) {
    if (t.tier < 2 || t.tier > tier || !t.power) continue;
    const p = implementedPower(t.power, data);
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

/** HP an Awakened blade takes from its bearer for each power fired (its current tier's price), 0 for none. */
export function bloodPriceOf(state: Pick<BattleState, 'bladeTiers'>, unit: Pick<Unit, 'weaponId'>, data: GameData): number {
  const id = bladeIdOf(unit, data);
  if (!id) return 0;
  const tier = bladeTier(state, id);
  return data.blades[id]!.tiers.find((t) => t.tier === tier)?.bloodPrice ?? 0;
}

/** True if the unit holds a blade and so runs a gauge. */
export function isBearer(unit: Pick<Unit, 'weaponId'>, data: GameData): boolean {
  return bladeOf(unit, data) !== null;
}

export interface BearerPower {
  id: string;
  def: PowerDef;
  effect: PowerEffect;
}

/** The (Dormant) power of the blade a unit holds, when it is implemented; else null. */
export function bearerPower(unit: Pick<Unit, 'weaponId'>, data: GameData): BearerPower | null {
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

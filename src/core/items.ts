// Weapons and items as the inventory holds them. An inventory is a list of ids: weapon ids from weapons.json, a
// forged weapon as `<id>+<rank>` (the forge's ranks, balance.weaponRanks), and item ids from items.json. A unit's
// equipped weapon (`weaponId`) is one of its entries. Pure lookups and checks; nothing here changes a unit.

import type { ClassDef, GameData, ItemDef, WeaponDef } from './types';

/** A weapon id split into its base weapon and forge rank (0 for an unforged weapon). */
export function parseWeaponId(id: string): { base: string; rank: number } {
  const m = /^(.+)\+(\d+)$/.exec(id);
  if (!m) return { base: id, rank: 0 };
  return { base: m[1]!, rank: Number(m[2]) };
}

/** The id of `base` at forge rank `rank` (rank 0 is the base id). */
export function rankedWeaponId(base: string, rank: number): string {
  return rank > 0 ? `${base}+${rank}` : base;
}

const cache = new WeakMap<GameData, Map<string, WeaponDef | null>>();

/**
 * The weapon an id names, with its forge rank applied: each rank adds balance.weaponRanks.might and .hit, and the
 * name gains " +N". Null for an unknown id, a rank above the cap, or a rank on a legendary weapon.
 */
export function weaponDef(id: string, data: GameData): WeaponDef | null {
  let byId = cache.get(data);
  if (!byId) {
    byId = new Map();
    cache.set(data, byId);
  }
  const hit = byId.get(id);
  if (hit !== undefined) return hit;
  const { base, rank } = parseWeaponId(id);
  const def = data.weapons[base];
  let out: WeaponDef | null = null;
  if (def && rank === 0) out = def;
  else if (def && !def.legendary && rank <= data.balance.weaponRanks.max) {
    const r = data.balance.weaponRanks;
    out = { ...def, name: `${def.name} +${rank}`, might: def.might + r.might * rank, hit: def.hit + r.hit * rank };
  }
  byId.set(id, out);
  return out;
}

export function itemDef(id: string, data: GameData): ItemDef | null {
  return data.items[id] ?? null;
}

/** True when the id is a weapon (any rank), false for an item or an unknown id. */
export function isWeaponId(id: string, data: GameData): boolean {
  return weaponDef(id, data) !== null;
}

/** True when a class can hold the weapon: its kind is one the class uses. */
export function classCanWield(cls: ClassDef | undefined, w: WeaponDef): boolean {
  return !!cls && cls.weaponKinds.includes(w.kind);
}

/**
 * A blade binds to its bearer: a weapon that is one of the ten blades (or the Stranger's copy) never leaves the
 * inventory it is in. Everything else can be traded to the convoy, sold or equipped by anyone who can wield it.
 */
export function isBound(id: string, data: GameData): boolean {
  return weaponDef(id, data)?.legendary ?? false;
}

/** An inventory with its equipped weapon in it: the given one, plus the weapon at the front when it is missing. */
export function inventoryWith(weaponId: string | null, inventory: readonly string[] = []): string[] {
  const out = [...inventory];
  if (weaponId !== null && !out.includes(weaponId)) out.unshift(weaponId);
  return out;
}

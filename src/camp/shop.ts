// The merchant: the stock for the current chapter, prices, buying into a unit's inventory or the convoy, and
// selling at economy.sellPercent of the price (a forged weapon's forge costs count). Pure.

import { isBound, itemDef, parseWeaponId, weaponDef } from '../core';
import type { CampaignSave, Result } from '../save/format';
import { entryName, partyUnit } from './barracks';
import { no, okv, type CampCtx } from './ctx';
import type { ShopDef } from './types';

/** What the merchant sells while the campaign is on its current chapter. */
export function shopStock(c: CampaignSave, ctx: CampCtx): ShopDef {
  const shops = ctx.camp.economy.shops;
  return shops[c.progress.current ?? ''] ?? shops.default ?? { weapons: [], items: [] };
}

/** Price to buy an entry, or null for something the merchant never sells (a blade, an unknown id). */
export function buyPrice(id: string, ctx: CampCtx): number | null {
  const item = itemDef(id, ctx.data);
  if (item) return item.price;
  const w = weaponDef(id, ctx.data);
  if (!w || w.legendary || w.price === undefined) return null;
  const { rank } = parseWeaponId(id);
  return w.price + ctx.camp.economy.upgradeCosts.slice(0, rank).reduce((n, g) => n + g, 0);
}

/** What the merchant pays for an entry, or null when it cannot be sold (a blade). */
export function sellPrice(id: string, ctx: CampCtx): number | null {
  if (isBound(id, ctx.data)) return null;
  const p = buyPrice(id, ctx);
  return p === null ? null : Math.floor((p * ctx.camp.economy.sellPercent) / 100);
}

/** Where a purchase goes, or where a sale comes from. */
export type Holder = { unitId: string } | { convoy: true };

/** Buy one `id` from the stock into a unit's inventory or the convoy. */
export function buy(c: CampaignSave, id: string, to: Holder, ctx: CampCtx): Result<CampaignSave> {
  const stock = shopStock(c, ctx);
  if (!stock.weapons.includes(id) && !stock.items.includes(id)) return no(`${entryName(id, ctx.data)} is not for sale here`);
  const price = buyPrice(id, ctx);
  if (price === null) return no(`${entryName(id, ctx.data)} is not for sale`);
  if (c.gold < price) return no(`Not enough gold: ${price} needed, ${c.gold} held`);
  const gold = c.gold - price;
  if ('convoy' in to) {
    if (c.convoy.length >= ctx.camp.economy.convoyMax) return no('The convoy is full');
    return okv({ ...c, gold, convoy: [...c.convoy, id] });
  }
  const u = partyUnit(c, to.unitId);
  if (!u) return no(`No unit ${to.unitId}`);
  if (u.inventory.length >= ctx.data.balance.inventory.slots) return no(`${u.name} has no free slot`);
  return okv({ ...c, gold, party: c.party.map((p) => (p.id === u.id ? { ...p, inventory: [...p.inventory, id] } : p)) });
}

/** Sell the entry at `index` of a unit's inventory or the convoy. A unit's equipped weapon cannot be sold. */
export function sell(c: CampaignSave, from: Holder, index: number, ctx: CampCtx): Result<CampaignSave> {
  if ('convoy' in from) {
    const id = c.convoy[index];
    if (id === undefined) return no('Nothing there in the convoy');
    const price = sellPrice(id, ctx);
    if (price === null) return no(`${entryName(id, ctx.data)} cannot be sold`);
    return okv({ ...c, gold: c.gold + price, convoy: c.convoy.filter((_, i) => i !== index) });
  }
  const u = partyUnit(c, from.unitId);
  if (!u) return no(`No unit ${from.unitId}`);
  const id = u.inventory[index];
  if (id === undefined) return no('Nothing in that slot');
  const price = sellPrice(id, ctx);
  if (price === null) return no(`${entryName(id, ctx.data)} cannot be sold`);
  if (u.weaponId === id && u.inventory.filter((x) => x === id).length === 1) return no(`${u.name} has it in hand: equip something else first`);
  const inventory = u.inventory.filter((_, i) => i !== index);
  return okv({ ...c, gold: c.gold + price, party: c.party.map((p) => (p.id === u.id ? { ...p, inventory } : p)) });
}

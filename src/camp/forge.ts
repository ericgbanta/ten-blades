// The forge: sword awakening (a blade's next tier for Blade Shards and a story condition) and gold upgrades for
// generic weapons. Pure. See docs/CAMP.md for the numbers.
//
// Awakening a blade to a tier: spends the tier's shards, raises the blade's tier in the save (the battle then
// offers the tier's power and charges its blood price), and adds the tier's statBoost to the bearer once. Reaching
// the last tier (Unbound) also counts up the story flag `unbound_blades`, the endings hook.

import { STAT_KEYS, flagValue, isBound, parseWeaponId, rankedWeaponId, weaponDef, type BladeDef, type BladeTierDef, type PartyUnit } from '../core';
import type { CampaignSave, Result } from '../save/format';
import { partyUnit } from './barracks';
import { no, okv, requirementMet, type CampCtx } from './ctx';
import type { Holder } from './shop';

/** The story flag that counts Unbound blades, for endings. */
export const UNBOUND_FLAG = 'unbound_blades';

export interface NextTier {
  def: BladeTierDef;
  shards: number;
  /** The story condition in plain words, and whether it holds now. */
  requirement: string;
  met: boolean;
  /** Why it cannot be awakened now, or null when it can. */
  block: string | null;
}

export interface BladeView {
  bladeId: string;
  blade: BladeDef;
  tier: number;
  tierName: string;
  /** The party member who holds it, or null (a blade on record whose bearer is gone). */
  bearer: PartyUnit | null;
  /** Its powers at this tier, in order. */
  powers: { id: string; name: string; description: string }[];
  next: NextTier | null;
}

/** The party member holding a blade, or null. */
export function bearerOf(c: CampaignSave, bladeId: string, ctx: CampCtx): PartyUnit | null {
  return c.party.find((u) => u.weaponId !== null && weaponDef(u.weaponId, ctx.data)?.blade === bladeId) ?? null;
}

function powersAt(blade: BladeDef, tier: number, ctx: CampCtx): BladeView['powers'] {
  const ids = [blade.power, ...blade.tiers.filter((t) => t.tier >= 2 && t.tier <= tier && t.power).map((t) => t.power!)];
  return ids.map((id) => ({ id, name: ctx.data.powers[id]?.name ?? id, description: ctx.data.powers[id]?.description ?? '' }));
}

/** Why the blade cannot move up a tier now, or null. */
export function awakenBlock(c: CampaignSave, bladeId: string, ctx: CampCtx): string | null {
  const blade = ctx.data.blades[bladeId];
  const rec = c.blades[bladeId];
  if (!blade || !rec) return 'The party does not hold that blade';
  const def = blade.tiers.find((t) => t.tier === rec.tier + 1);
  if (!def) return `${blade.name} is at its last tier`;
  if (def.shards === undefined || !def.requires) return 'Not designed yet';
  if (!bearerOf(c, bladeId, ctx)) return `No one in the party holds ${blade.name}`;
  if (!requirementMet(c, def.requires, ctx.chapters)) return def.requires?.text ?? 'Not yet';
  const cost = def.shards ?? 0;
  if (c.shards < cost) return `Needs ${cost} Blade Shards (you have ${c.shards})`;
  return null;
}

/** Every blade on record with its tier, powers and next tier, in roster number order. */
export function bladeViews(c: CampaignSave, ctx: CampCtx): BladeView[] {
  return Object.entries(c.blades)
    .map(([bladeId, rec]) => {
      const blade = ctx.data.blades[bladeId]!;
      const def = blade.tiers.find((t) => t.tier === rec.tier + 1);
      const next: NextTier | null = def
        ? {
            def,
            shards: def.shards ?? 0,
            requirement: def.requires?.text ?? '',
            met: requirementMet(c, def.requires, ctx.chapters),
            block: awakenBlock(c, bladeId, ctx),
          }
        : null;
      return {
        bladeId,
        blade,
        tier: rec.tier,
        tierName: blade.tiers.find((t) => t.tier === rec.tier)?.name ?? `Tier ${rec.tier}`,
        bearer: bearerOf(c, bladeId, ctx),
        powers: powersAt(blade, rec.tier, ctx),
        next,
      };
    })
    .sort((a, b) => a.blade.number - b.blade.number);
}

/** The powers a blade would have at a tier (for showing what the next tier grants). */
export function powersAtTier(bladeId: string, tier: number, ctx: CampCtx): BladeView['powers'] {
  const blade = ctx.data.blades[bladeId];
  return blade ? powersAt(blade, tier, ctx) : [];
}

/** Awaken a blade to its next tier. */
export function awaken(c: CampaignSave, bladeId: string, ctx: CampCtx): Result<CampaignSave> {
  const block = awakenBlock(c, bladeId, ctx);
  if (block !== null) return no(block);
  const blade = ctx.data.blades[bladeId]!;
  const tier = c.blades[bladeId]!.tier + 1;
  const def = blade.tiers.find((t) => t.tier === tier)!;
  const bearer = bearerOf(c, bladeId, ctx)!;
  const caps = ctx.data.balance.statCaps;
  const stats = { ...bearer.stats };
  for (const k of STAT_KEYS) {
    const add = def.statBoost?.[k] ?? 0;
    if (add !== 0) stats[k] = Math.max(0, Math.min(caps[k], stats[k] + add));
  }
  const last = tier === blade.tiers.length;
  const before = flagValue(c.flags, UNBOUND_FLAG);
  const flags = last ? { ...c.flags, [UNBOUND_FLAG]: (typeof before === 'number' ? before : 0) + 1 } : c.flags;
  return okv({
    ...c,
    shards: c.shards - (def.shards ?? 0),
    blades: { ...c.blades, [bladeId]: { tier } },
    party: c.party.map((u) => (u.id === bearer.id ? { ...u, stats } : u)),
    flags,
  });
}

/** Blades at their last tier (Unbound). */
export function unboundCount(c: CampaignSave, ctx: CampCtx): number {
  return Object.entries(c.blades).filter(([id, rec]) => rec.tier === (ctx.data.blades[id]?.tiers.length ?? 0)).length;
}

// ---------------------------------------------------------------------------
// Generic weapon upgrades
// ---------------------------------------------------------------------------

/** Gold to forge a weapon one rank up, or null when it cannot be (a blade, an item, the top rank). */
export function upgradeCost(id: string, ctx: CampCtx): number | null {
  const w = weaponDef(id, ctx.data);
  if (!w || w.legendary || isBound(id, ctx.data)) return null;
  const { rank } = parseWeaponId(id);
  if (rank >= ctx.data.balance.weaponRanks.max) return null;
  return ctx.camp.economy.upgradeCosts[rank] ?? null;
}

/** Why a weapon cannot be forged up now, or null. */
export function upgradeBlock(id: string, gold: number, ctx: CampCtx): string | null {
  const w = weaponDef(id, ctx.data);
  if (!w) return 'Only weapons can be forged';
  if (w.legendary) return 'A legendary blade answers to shards, not gold';
  const cost = upgradeCost(id, ctx);
  if (cost === null) return `${w.name} is at its best`;
  if (gold < cost) return `Needs ${cost} gold (you have ${gold})`;
  return null;
}

/** Forge the weapon at `index` of a unit's inventory or the convoy one rank up. The equipped one stays equipped. */
export function forgeWeapon(c: CampaignSave, from: Holder, index: number, ctx: CampCtx): Result<CampaignSave> {
  const list = 'convoy' in from ? c.convoy : partyUnit(c, from.unitId)?.inventory;
  if (!list) return no('No such unit');
  const id = list[index];
  if (id === undefined) return no('Nothing there');
  const block = upgradeBlock(id, c.gold, ctx);
  if (block !== null) return no(block);
  const cost = upgradeCost(id, ctx)!;
  const { base, rank } = parseWeaponId(id);
  const next = rankedWeaponId(base, rank + 1);
  const replaced = list.map((x, i) => (i === index ? next : x));
  if ('convoy' in from) return okv({ ...c, gold: c.gold - cost, convoy: replaced });
  return okv({
    ...c,
    gold: c.gold - cost,
    party: c.party.map((u) =>
      u.id === from.unitId ? { ...u, inventory: replaced, weaponId: u.weaponId === id && u.inventory.indexOf(id) === index ? next : u.weaponId } : u,
    ),
  });
}

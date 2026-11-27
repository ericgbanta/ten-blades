// Small pieces the camp screens share: the purse, a party member's medallion, entry icons and names, the
// stat line of a weapon, and a short status line after an action.

import type { JSX } from 'preact';
import { itemDef, weaponDef, type PartyUnit, type WeaponDef } from '../../core';
import { gameData } from '../../data';
import type { CampaignSave } from '../../save/format';
import { Icon, Medallion, entryIcon as entryIconFor, type IconName } from '../kit';

/** Gold and Blade Shards: chips on the hub, or a compact pair for a screen's header (`compact`). */
export function Purse({ c, compact }: { c: CampaignSave; compact?: boolean }): JSX.Element {
  const size = compact ? 14 : 20;
  return (
    <p class={`purse${compact ? ' compact' : ''}`} aria-label={`${c.gold} gold, ${c.shards} Blade Shards`}>
      <span class="purse-chip">
        <Icon name="coins" size={size} />
        <span class="num">{c.gold}</span>
      </span>
      <span class="purse-chip">
        <Icon name="shard" size={size} />
        <span class="num">{c.shards}</span>
      </span>
    </p>
  );
}

/** The tier of the blade a party unit holds (0 for none). */
export function tierOf(c: CampaignSave, u: PartyUnit): number {
  const blade = u.inventory.map((id) => weaponDef(id, gameData)?.blade).find((b) => b !== undefined);
  return blade ? (c.blades[blade]?.tier ?? 1) : 0;
}

/** A party member's medallion; an Awakened bearer's glows. */
export function UnitMedal({ c, u, size }: { c: CampaignSave; u: PartyUnit; size: number }): JSX.Element {
  return <Medallion unit={{ ...u, team: 'player' }} look={c.mc.look} size={size} glow={tierOf(c, u) >= 2} />;
}

export function entryName(id: string): string {
  return weaponDef(id, gameData)?.name ?? itemDef(id, gameData)?.name ?? id;
}

export function entryIcon(id: string): IconName {
  return entryIconFor(id, gameData);
}

/** A weapon's numbers in one short line: Mt, Hit, Crit, Rng (Heals for a staff). */
export function weaponLine(w: WeaponDef): string {
  const rng = w.range[0] === w.range[1] ? `${w.range[0]}` : `${w.range[0]}-${w.range[1]}`;
  if (w.heal > 0) return `Heals ${w.heal} · Rng ${rng}`;
  return `Mt ${w.might} · Hit ${w.hit} · Crit ${w.crit} · Rng ${rng}`;
}

/** One line of what an entry is: a weapon's numbers or an item's description. */
export function entryLine(id: string): string {
  const w = weaponDef(id, gameData);
  if (w) return weaponLine(w);
  return itemDef(id, gameData)?.description ?? '';
}

/** A short line after an action: what happened, or why it could not. */
export function StatusLine({ msg }: { msg: { text: string; bad: boolean } | null }): JSX.Element {
  return (
    <p class={`camp-status${msg?.bad ? ' bad' : ''}`} role="status" aria-live="polite">
      {msg?.text ?? ''}
    </p>
  );
}

export const CLASS_NAME = (classId: string): string => gameData.classes[classId]?.name ?? classId;

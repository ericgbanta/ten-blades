// What a won map pays: its gold and shards, each bonus objective met, and the drops of fallen enemies that carried
// one. Worked out from the final battle state, so the end screen and the save agree. Pure.

import { flagValue, type BattleState } from '../core';
import type { CampaignSave } from '../save/format';
import type { BonusDef, EconomyDef, RewardDef } from './types';

export interface BonusResult {
  id: string;
  text: string;
  met: boolean;
  gold: number;
  shards: number;
}

export interface Rewards {
  /** Everything paid, bonuses met included. */
  gold: number;
  shards: number;
  /** Item ids from drops, for the convoy. */
  items: string[];
  /** The map's base pay, before bonuses. */
  baseGold: number;
  baseShards: number;
  bonuses: BonusResult[];
}

export const NO_REWARDS: Rewards = { gold: 0, shards: 0, items: [], baseGold: 0, baseShards: 0, bonuses: [] };

function bonusMet(b: BonusDef, state: BattleState): boolean {
  switch (b.kind) {
    case 'turns':
      return state.turn <= b.turns;
    case 'noLoss':
      return !state.units.some((u) => u.team === 'player' && !u.alive && !u.left);
    case 'flag':
      return flagValue(state.flags, b.flag) !== false;
  }
}

/** The pay for a battle. Nothing unless it was won. */
export function battleRewards(state: BattleState, def: RewardDef | undefined): Rewards {
  if (!def || state.result !== 'victory') return NO_REWARDS;
  const bonuses = (def.bonus ?? []).map((b) => ({ id: b.id, text: b.text, met: bonusMet(b, state), gold: b.gold, shards: b.shards }));
  const items = (def.drops ?? []).filter((d) => state.units.some((u) => u.id === d.unitId && !u.alive && !u.left)).map((d) => d.item);
  const met = bonuses.filter((b) => b.met);
  return {
    gold: def.gold + met.reduce((n, b) => n + b.gold, 0),
    shards: def.shards + met.reduce((n, b) => n + b.shards, 0),
    items,
    baseGold: def.gold,
    baseShards: def.shards,
    bonuses,
  };
}

/** The campaign with the pay added: gold, shards, and the drops into the convoy (while it has room). */
export function applyRewards(c: CampaignSave, r: Rewards, economy: EconomyDef): CampaignSave {
  const room = Math.max(0, economy.convoyMax - c.convoy.length);
  return { ...c, gold: c.gold + r.gold, shards: c.shards + r.shards, convoy: [...c.convoy, ...r.items.slice(0, room)] };
}

// Content types for the camp between chapters: facilities, campfire talk, rewards, the merchant's stock and side
// skirmishes. The JSON is src/data/economy.json, src/data/skirmishes.json and the camp fields of chapters.json
// (docs/CAMP.md).

import type { StoryCondition } from '../core';

export type Facility = 'forge' | 'merchant' | 'barracks' | 'warmap';
export const FACILITIES: readonly Facility[] = ['forge', 'merchant', 'barracks', 'warmap'];

/** A campfire scene offered in camp once its conditions hold. Reading it sets `flag` (default `read_<scene>`). */
export interface TalkDef {
  scene: string;
  /** The name in the camp's list (the scene id when left out). */
  title?: string;
  when?: StoryCondition[];
  flag?: string;
}

/** The camp that follows a chapter (chapters.json `campAfter`). */
export interface CampDef {
  /** Facilities this camp opens. Once open, a facility stays open. */
  unlocks?: Facility[];
  /** Campfire scenes offered from this camp on. */
  talk?: TalkDef[];
  /** Backdrop id (art `backdrop.<id>`); the camp travels with the army. Default `camp`. */
  backdrop?: string;
}

/** Who may deploy on a map: at most `max` units, the main character included, and the ids that must. */
export interface DeployRule {
  max?: number;
  required?: string[];
}

/** A bonus objective: met when the map is won by turn N, with no player unit fallen, or with a story flag set. */
export type BonusDef = { id: string; text: string; gold: number; shards: number } & (
  | { kind: 'turns'; turns: number }
  | { kind: 'noLoss' }
  | { kind: 'flag'; flag: string }
);

/** What a won map pays. Drops: an enemy's item, taken when that enemy has fallen. */
export interface RewardDef {
  gold: number;
  shards: number;
  bonus?: BonusDef[];
  drops?: { unitId: string; item: string }[];
}

export interface ShopDef {
  weapons: string[];
  items: string[];
}

/** src/data/economy.json */
export interface EconomyDef {
  /** A sale pays this percent of the price (forge ranks included). */
  sellPercent: number;
  /** Gold to forge a generic weapon to rank 1, rank 2, ... (balance.weaponRanks.max entries). */
  upgradeCosts: number[];
  /** Most entries the convoy holds. */
  convoyMax: number;
  /** Rewards for each story map, by map id. */
  rewards: Record<string, RewardDef>;
  /** The merchant's stock by the current chapter's id, with `default` for the rest. */
  shops: Record<string, ShopDef>;
}

/** How a skirmish keeps up with the party: enemy levels move by (party average + offset, clamped) minus baseLevel. */
export interface ScalingDef {
  /** The level the map's enemies were placed for. */
  baseLevel: number;
  offset: number;
  min: number;
  max: number;
}

export interface SkirmishDef {
  name: string;
  /** One line for the war map. */
  blurb: string;
  mapId: string;
  rewards: RewardDef;
  scaling: ScalingDef;
  deploy?: DeployRule;
  /** A lore scene played before the first attempt (sets `read_<scene>`). */
  lore?: string;
}

/** src/data/skirmishes.json */
export interface SkirmishData {
  skirmishes: Record<string, SkirmishDef>;
}

/** Everything camp content the pure camp modules read, besides game data and chapters. */
export interface CampContent {
  economy: EconomyDef;
  skirmishes: Record<string, SkirmishDef>;
}

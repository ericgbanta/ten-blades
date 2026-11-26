// The save format: plain JSON objects with a `version` field. Pure types and
// constants only. See docs/SAVES.md for the rules on changing this shape.

import type { BattleState, Difficulty, GameData, McStyle, PartyUnit, Permadeath } from '../core';
import type { McLook } from '../art/mc/look';

export type { McLook };

/** The version every save is written at. Bump it and add a step in migrate.ts on any shape change. */
export const SAVE_VERSION = 2;

/** Campaign slots. The suspend save has its own slot and remembers which of these it belongs to. */
export type SlotId = 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = [1, 2, 3];

export type Pronouns = 'he' | 'she' | 'they';
export const PRONOUNS: readonly Pronouns[] = ['he', 'she', 'they'];
export const MC_STYLES: readonly McStyle[] = ['vanguard', 'duelist', 'spiritblade'];
export const DIFFICULTIES: readonly Difficulty[] = ['normal', 'hard', 'lunatic'];
export const PERMADEATH_MODES: readonly Permadeath[] = ['classic', 'casual'];

/** Longest MC name, in characters (code points). */
export const MC_NAME_MAX = 16;

/** Chosen once at new game. */
export interface CampaignSettings {
  difficulty: Difficulty;
  permadeath: Permadeath;
}

/**
 * The main character as the player built them. `look` arrived in save version 2
 * (the migration gives version 1 saves the default look); its ids are checked
 * against src/data/looks.json.
 */
export interface McProfile {
  name: string;
  pronouns: Pronouns;
  style: McStyle;
  look: McLook;
}

export interface ChapterProgress {
  /** The chapter to play next, or null once the story so far is finished. */
  current: string | null;
  /** Chapters won, in the order they were won. */
  completed: string[];
}

export type FlagValue = boolean | number | string;

export interface CampaignSave {
  version: typeof SAVE_VERSION;
  kind: 'campaign';
  /** Epoch milliseconds, passed in from the UI. */
  createdAt: number;
  updatedAt: number;
  settings: CampaignSettings;
  mc: McProfile;
  /** Units carried into the next map, as built by partyAfterBattle. Empty before the prologue. */
  party: PartyUnit[];
  /** Units lost for good (Classic mode). */
  fallen: PartyUnit[];
  progress: ChapterProgress;
  flags: Record<string, FlagValue>;
  gold: number;
  shards: number;
}

/** Controller state kept across a resume. The selection is never kept: a resume starts with nothing selected. */
export interface SuspendController {
  showDanger: boolean;
}

/** A battle in progress, written whenever the battle is at rest. */
export interface SuspendSave {
  version: typeof SAVE_VERSION;
  kind: 'suspend';
  savedAt: number;
  /** The campaign slot this battle belongs to. */
  slot: SlotId;
  /** The campaign as it was when the map started. */
  campaign: CampaignSave;
  mapId: string;
  battle: BattleState;
  controller: SuspendController;
}

export type AnySave = CampaignSave | SuspendSave;

/** One entry of the chapter order (src/data/chapters.json). */
export interface ChapterDef {
  id: string;
  name: string;
  mapId: string;
}

/** What the validator checks ids against. */
export interface SaveContext {
  data: GameData;
  chapters: readonly ChapterDef[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });

// The save format: plain JSON objects with a `version` field. Pure types and
// constants only. See docs/SAVES.md for the rules on changing this shape.

import type { BattleState, Difficulty, FlagValue, GameData, McStyle, PartyUnit, Permadeath } from '../core';
import type { McLook } from '../art/mc/look';
import { PRONOUNS, type ChapterDef, type Pronouns } from '../story/types';

export type { McLook, ChapterDef, Pronouns, FlagValue };
export { PRONOUNS };

/** The version every save is written at. Bump it and add a step in migrate.ts on any shape change. */
export const SAVE_VERSION = 4;

/** Campaign slots. The suspend save has its own slot and remembers which of these it belongs to. */
export type SlotId = 1 | 2 | 3;
export const SLOT_IDS: readonly SlotId[] = [1, 2, 3];

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

/** Where in a chapter the campaign stands (src/story/flow.ts). */
export type ChapterStage = 'intro' | 'battle' | 'outro';
export const CHAPTER_STAGES: readonly ChapterStage[] = ['intro', 'battle', 'outro'];

export interface ChapterProgress {
  /** The chapter being played, or null once the story so far is finished. */
  current: string | null;
  /** Chapters finished (outro played), in order. */
  completed: string[];
  /** intro scenes, then the battle, then outro scenes. Added in version 3. */
  stage: ChapterStage;
  /**
   * Scenes of this stage still to play, the first being the one in progress (a scene resumes from its first
   * line). Null until the stage begins, when the chapter data picks the variant. Added in version 3.
   */
  scenes: string[] | null;
}

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
  /**
   * The legendary blades the party has held, by blade id (src/data/blades.json), with each blade's tier: 1
   * (Dormant) until awakening arrives in phase 6. Added in version 4.
   */
  blades: Record<string, BladeRecord>;
}

export interface BladeRecord {
  tier: number;
}

/** Controller state kept across a resume. The selection is never kept: a resume starts with nothing selected. */
export interface SuspendController {
  showDanger: boolean;
  /** Mid-battle scenes from the last player action that had not finished playing. A resume plays them first. Added in version 3. */
  scenes: string[];
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

/** What the validator checks ids against. */
export interface SaveContext {
  data: GameData;
  chapters: readonly ChapterDef[];
  /** Dialogue scene ids; when given, scene ids in a save are checked against them. */
  sceneIds?: readonly string[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });

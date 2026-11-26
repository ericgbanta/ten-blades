// What the camp's pure modules read, and the story position questions they share: the chapter in hand, its act,
// whether a tier's requirement is met. Pure.

import { storyConditionsHold, type GameData } from '../core';
import type { CampaignSave, Result } from '../save/format';
import type { ChapterDef } from '../story/types';
import type { CampContent } from './types';

export interface CampCtx {
  data: GameData;
  chapters: readonly ChapterDef[];
  camp: CampContent;
}

export const okv = <T>(value: T): Result<T> => ({ ok: true, value });
export const no = <T>(error: string): Result<T> => ({ ok: false, error });

export function chapterById(chapters: readonly ChapterDef[], id: string | null): ChapterDef | null {
  return chapters.find((c) => c.id === id) ?? null;
}

/** The chapter the campaign is on (the next story chapter, while in camp). */
export function currentChapterOf(c: CampaignSave, chapters: readonly ChapterDef[]): ChapterDef | null {
  return chapterById(chapters, c.progress.current);
}

/** The act the campaign is in: the current chapter's, else the last completed one's, else 1. */
export function actOf(c: CampaignSave, chapters: readonly ChapterDef[]): number {
  const ch = currentChapterOf(c, chapters) ?? chapterById(chapters, c.progress.completed.at(-1) ?? null);
  return ch?.act ?? 1;
}

/** True once the campaign has reached `chapterId`: it is the current chapter, a later one, or completed. */
export function reachedChapter(c: CampaignSave, chapterId: string, chapters: readonly ChapterDef[]): boolean {
  if (c.progress.completed.includes(chapterId)) return true;
  const want = chapters.findIndex((ch) => ch.id === chapterId);
  const at = chapters.findIndex((ch) => ch.id === c.progress.current);
  return want >= 0 && at >= want;
}

/** A requirement as data (blade tiers): chapter and act reached, flags. */
export interface Requirement {
  chapter?: string;
  act?: number;
  flags?: Parameters<typeof storyConditionsHold>[0];
}

export function requirementMet(c: CampaignSave, req: Requirement | undefined, chapters: readonly ChapterDef[]): boolean {
  if (!req) return true;
  if (req.chapter !== undefined && !reachedChapter(c, req.chapter, chapters)) return false;
  if (req.act !== undefined && actOf(c, chapters) < req.act) return false;
  return storyConditionsHold(req.flags, { flags: c.flags, permadeath: c.settings.permadeath, difficulty: c.settings.difficulty });
}

// Plain-words text for the menus: modes, difficulties, styles and slot summaries.

import type { Difficulty, McStyle, Permadeath } from '../../core';
import { chapters, gameData } from '../../data';
import type { CampaignSave, ChapterStage, Pronouns } from '../../save/format';
import { SCHOOL_LABEL } from '../battle/text';

export const PERMADEATH_TEXT: Record<Permadeath, { name: string; line: string }> = {
  classic: { name: 'Classic', line: 'Fallen units are gone for good, and if you fall it is game over.' },
  casual: { name: 'Casual', line: 'Fallen units come back after the map. If you fall, the battle is lost.' },
};

export const DIFFICULTY_TEXT: Record<Difficulty, { name: string; line: string }> = {
  normal: { name: 'Normal', line: 'Enemies fight at their usual strength.' },
  hard: { name: 'Hard', line: 'Tougher enemies and extra reinforcements.' },
  lunatic: { name: 'Lunatic', line: 'The toughest enemies, the most reinforcements, and foes who charge at once.' },
};

/** The "feel" line from the design doc's combat style table. */
export const STYLE_TEXT: Record<McStyle, { name: string; feel: string }> = {
  vanguard: { name: 'Vanguard', feel: 'High HP and defense, holds the line.' },
  duelist: { name: 'Duelist', feel: 'High speed and crit, hit and run.' },
  spiritblade: { name: 'Spiritblade', feel: 'Short-range sword techniques, fragile.' },
};

export function styleSchool(style: McStyle): string {
  const school = gameData.classes[style]?.school ?? 'none';
  return SCHOOL_LABEL[school];
}

export const PRONOUN_TEXT: Record<Pronouns, string> = {
  he: 'He / him',
  she: 'She / her',
  they: 'They / them',
};

export function chapterName(id: string | null): string {
  if (id === null) return 'To be continued';
  return chapters.find((c) => c.id === id)?.name ?? id;
}

/** Where in a chapter a campaign stands, for Continue. */
export const STAGE_TEXT: Record<ChapterStage, string> = { intro: 'Story', battle: 'Battle', outro: 'Story' };

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One line under the MC's name in a slot card. */
export function slotLine(save: CampaignSave): string {
  return [
    STYLE_TEXT[save.mc.style].name,
    chapterName(save.progress.current),
    PERMADEATH_TEXT[save.settings.permadeath].name,
    DIFFICULTY_TEXT[save.settings.difficulty].name,
  ].join(' · ');
}

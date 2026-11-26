// The camp hub's rules: which facilities are open, the campfire talk on offer, the war map (the story chapter and
// the side skirmishes with their per-chapter cap), and the camp's backdrop. Pure.

import { storyConditionsHold } from '../core';
import type { CampaignSave } from '../save/format';
import { chapterById, currentChapterOf, type CampCtx } from './ctx';
import type { CampDef, Facility, SkirmishDef, TalkDef } from './types';

/** The camp settings of every chapter finished so far, in story order. */
function campsSoFar(c: CampaignSave, ctx: Pick<CampCtx, 'chapters'>): CampDef[] {
  return ctx.chapters.filter((ch) => c.progress.completed.includes(ch.id) && ch.campAfter).map((ch) => ch.campAfter!);
}

/** True once a finished chapter's camp opened the facility. */
export function facilityOpen(c: CampaignSave, f: Facility, ctx: Pick<CampCtx, 'chapters'>): boolean {
  return campsSoFar(c, ctx).some((camp) => camp.unlocks?.includes(f));
}

/** When a closed facility opens, in plain words ("Opens after Chapter 2"): the next chapter still to finish whose camp opens it. */
export function facilityOpensText(c: CampaignSave, f: Facility, ctx: Pick<CampCtx, 'chapters'>): string {
  const ch = ctx.chapters.find((x) => !c.progress.completed.includes(x.id) && x.campAfter?.unlocks?.includes(f));
  return ch ? `Opens after ${ch.name}` : 'Opens later in the story';
}

/** The camp's backdrop id: the latest camp's, else `camp`. */
export function campBackdrop(c: CampaignSave, ctx: Pick<CampCtx, 'chapters'>): string {
  return [...campsSoFar(c, ctx)].reverse().find((camp) => camp.backdrop)?.backdrop ?? 'camp';
}

export interface TalkEntry {
  scene: string;
  flag: string;
  read: boolean;
}

export function talkFlag(t: TalkDef): string {
  return t.flag ?? `read_${t.scene}`;
}

/** Campfire scenes on offer (every finished chapter's, conditions holding), unread first marked. */
export function talkList(c: CampaignSave, ctx: Pick<CampCtx, 'chapters'>): TalkEntry[] {
  const story = { flags: c.flags, permadeath: c.settings.permadeath, difficulty: c.settings.difficulty };
  const out: TalkEntry[] = [];
  for (const camp of campsSoFar(c, ctx)) {
    for (const t of camp.talk ?? []) {
      if (!storyConditionsHold(t.when, story) || out.some((o) => o.scene === t.scene)) continue;
      const flag = talkFlag(t);
      out.push({ scene: t.scene, flag, read: c.flags[flag] === true });
    }
  }
  return out;
}

/** A campfire scene has been read: its flag is set, with the flags its choices set. */
export function readTalk(
  c: CampaignSave,
  scene: string,
  set: Record<string, boolean | number | string>,
  ctx: Pick<CampCtx, 'chapters'>,
  now: number,
): CampaignSave {
  const entry = talkList(c, ctx).find((t) => t.scene === scene);
  return { ...c, updatedAt: now, flags: { ...c.flags, ...set, ...(entry ? { [entry.flag]: true } : {}) } };
}

// ---------------------------------------------------------------------------
// War map
// ---------------------------------------------------------------------------

export interface SkirmishEntry {
  id: string;
  def: SkirmishDef;
  /** Wins still allowed while the campaign is on this chapter, and the cap. */
  left: number;
  cap: number;
  /** False when the cap is reached or the map is missing. */
  open: boolean;
  /** The lore scene, when it has not been read. */
  loreUnread: boolean;
}

/** Side skirmishes on the war map for the current chapter, with the wins left under its cap. */
export function skirmishList(c: CampaignSave, ctx: CampCtx): SkirmishEntry[] {
  const ch = currentChapterOf(c, ctx.chapters);
  if (!ch?.skirmishes) return [];
  const won = c.skirmishWins[ch.id] ?? 0;
  const cap = ch.skirmishes.cap;
  const left = Math.max(0, cap - won);
  return ch.skirmishes.ids.flatMap((id) => {
    const def = ctx.camp.skirmishes[id];
    if (!def) return [];
    return [{ id, def, left, cap, open: left > 0 && !!ctx.data.maps[def.mapId], loreUnread: !!def.lore && c.flags[`read_${def.lore}`] !== true }];
  });
}

export type RouteNode =
  | { kind: 'done'; chapterId: string; name: string; title: string }
  /** The next story chapter: playable, or coming soon (no map yet). */
  | { kind: 'next'; chapterId: string; name: string; title: string; playable: boolean }
  | { kind: 'later'; chapterId: string; name: string; title: string };

/** The story route for the war map: chapters done, the next one, and those after it. */
export function routeNodes(c: CampaignSave, ctx: CampCtx): RouteNode[] {
  return ctx.chapters.map((ch) => {
    const base = { chapterId: ch.id, name: ch.name, title: ch.title };
    if (c.progress.completed.includes(ch.id)) return { kind: 'done', ...base };
    if (ch.id === c.progress.current) return { kind: 'next', ...base, playable: !!ch.mapId && !!ctx.data.maps[ch.mapId] };
    return { kind: 'later', ...base };
  });
}

/** The chapter the war map's Start begins (the current one), when it has a map. */
export function startableChapter(c: CampaignSave, ctx: CampCtx): string | null {
  const ch = chapterById(ctx.chapters, c.progress.current);
  return ch?.mapId && ctx.data.maps[ch.mapId] && c.progress.stage === 'camp' ? ch.id : null;
}

/** Leave camp for the current chapter: its intro begins (the chapter flow picks the scenes). */
export function leaveCamp(c: CampaignSave, now: number): CampaignSave {
  if (c.progress.stage !== 'camp') return c;
  return { ...c, updatedAt: now, progress: { ...c.progress, stage: 'intro', scenes: null } };
}

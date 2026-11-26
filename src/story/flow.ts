// The chapter flow: intro scenes, the battle, outro scenes, then the next chapter. A pure state machine over the
// campaign save's `progress` (stage and the scenes left in it), so quitting anywhere resumes at the start of
// the scene in progress, and a scene's flags are applied in the same write that moves past it.
//
//   [camp] -> intro (scenes) -> battle -> outro (scenes) -> after rules -> next chapter: its camp (campAfter) or intro
//
// A chapter marked campAfter sends the army to camp before the next chapter: the campaign rests at stage `camp`
// until the war map starts the chapter (src/camp/camp.ts, leaveCamp). Camp works even when the next chapter has
// no map yet. Otherwise a chapter whose map does not exist yet stops the story there ("To be continued"); its
// intro is not played.

import { averageStats, storyConditionsHold, weaponDef, type Flags, type GameData, type PartyUnit, type StoryContext } from '../core';
import type { CampaignSave } from '../save/format';
import { withBlades } from '../save/campaign';
import type { ChapterAfter, ChapterDef, SceneVariant } from './types';

export type FlowStep =
  | { kind: 'scene'; sceneId: string; stage: 'intro' | 'outro'; chapter: ChapterDef }
  | { kind: 'battle'; mapId: string; chapter: ChapterDef }
  /** In camp before the chapter (the war map starts it). */
  | { kind: 'camp'; chapter: ChapterDef }
  /** The chapter exists but has no map yet. */
  | { kind: 'unavailable'; chapter: ChapterDef }
  /** No chapter left: the story so far is over. */
  | { kind: 'finished' };

export function storyContextOf(c: CampaignSave): StoryContext {
  return { flags: c.flags, permadeath: c.settings.permadeath, difficulty: c.settings.difficulty };
}

export function chapterOf(c: CampaignSave, chapters: readonly ChapterDef[]): ChapterDef | null {
  return chapters.find((ch) => ch.id === c.progress.current) ?? null;
}

/** The scenes of the first variant whose conditions hold, or none. */
export function pickVariant(variants: readonly SceneVariant[], ctx: StoryContext): string[] {
  return [...(variants.find((v) => storyConditionsHold(v.when, ctx))?.scenes ?? [])];
}

function playable(ch: ChapterDef, data: GameData): boolean {
  return ch.mapId !== null && !!data.maps[ch.mapId];
}

/** Apply a chapter's after rules (every entry whose conditions hold). */
export function applyAfter(c: CampaignSave, after: readonly ChapterAfter[], data: GameData): CampaignSave {
  let party = c.party.map((u) => ({ ...u, stats: { ...u.stats }, inventory: [...u.inventory] }));
  let convoy = c.convoy;
  const ctx = storyContextOf(c);
  for (const a of after) {
    if (!storyConditionsHold(a.when, ctx)) continue;
    const leave = new Set(a.leave ?? []);
    party = party.filter((u) => u.isLord || !leave.has(u.id));
    for (const j of a.join ?? []) {
      if (party.some((u) => u.id === j.id)) continue;
      const cls = data.classes[j.classId];
      if (!cls) throw new Error(`Unknown class ${j.classId}`);
      const weaponId = j.weaponId ?? cls.startingWeapon;
      const unit: PartyUnit = {
        id: j.id,
        name: j.name,
        classId: j.classId,
        level: j.level,
        xp: 0,
        stats: averageStats(j.classId, j.level, data),
        weaponId,
        isLord: false,
        inventory: [weaponId],
      };
      party.push(unit);
    }
    const weapon = a.mcWeapon?.[c.mc.style];
    if (weapon) {
      // The new weapon takes the old one's slot; the old one (not a blade) goes to the convoy.
      party = party.map((u) => {
        if (!u.isLord || u.weaponId === weapon) return u;
        const old = u.weaponId;
        const kept = old !== null && !weaponDef(old, data)?.legendary;
        if (kept) convoy = [...convoy, old];
        const at = old === null ? -1 : u.inventory.indexOf(old);
        const inventory = at >= 0 ? u.inventory.map((x, i) => (i === at ? weapon : x)) : [weapon, ...u.inventory];
        return { ...u, weaponId: weapon, inventory };
      });
    }
  }
  // Blades that joined (the MC's inheritance, a recruit's) go on record at tier 1.
  return withBlades({ ...c, party, convoy }, data);
}

/** The act a chapter id belongs to (1 when unknown). */
function actOfChapter(chapters: readonly ChapterDef[], id: string | null): number {
  return chapters.find((ch) => ch.id === id)?.act ?? 1;
}

/**
 * Bring the campaign to a point where something can be shown: pick the scenes of a stage that has not begun,
 * go from an intro with no scenes left to the battle, and finish a chapter whose outro is done (after rules,
 * then the next chapter). Returns the same object when nothing changed.
 */
export function settle(c: CampaignSave, chapters: readonly ChapterDef[], data: GameData, now: number): CampaignSave {
  let s = c;
  for (let guard = 0; guard < 100; guard++) {
    const ch = chapterOf(s, chapters);
    if (!ch || s.progress.stage === 'camp' || !playable(ch, data)) return s;
    const p = s.progress;
    if (p.stage === 'battle') return s;
    if (p.scenes === null) {
      s = { ...s, progress: { ...p, scenes: pickVariant(p.stage === 'intro' ? ch.intro : ch.outro, storyContextOf(s)) } };
      continue;
    }
    if (p.scenes.length > 0) return s;
    if (p.stage === 'intro') return { ...s, progress: { ...p, stage: 'battle', scenes: [] } };
    // Outro done: the chapter is complete. The army makes camp first if the chapter says so; a new act sends the
    // wounded back to the ranks.
    const after = applyAfter(s, ch.after, data);
    const act = actOfChapter(chapters, ch.next);
    const wounded = Object.fromEntries(Object.entries(after.wounded).filter(([, a]) => a === act));
    s = {
      ...after,
      updatedAt: now,
      wounded,
      progress: {
        current: ch.next,
        completed: [...p.completed.filter((id) => id !== ch.id), ch.id],
        stage: ch.campAfter && ch.next !== null ? 'camp' : 'intro',
        scenes: null,
      },
    };
  }
  throw new Error('The chapter flow did not settle; check chapters.json for a loop');
}

/** What to show for a settled campaign. */
export function flowStep(c: CampaignSave, chapters: readonly ChapterDef[], data: GameData): FlowStep {
  const ch = chapterOf(c, chapters);
  if (!ch) return { kind: 'finished' };
  if (c.progress.stage === 'camp') return { kind: 'camp', chapter: ch };
  if (!playable(ch, data)) return { kind: 'unavailable', chapter: ch };
  const p = c.progress;
  if (p.stage === 'battle' || p.stage === 'camp' || p.scenes === null || p.scenes.length === 0) return { kind: 'battle', mapId: ch.mapId!, chapter: ch };
  return { kind: 'scene', sceneId: p.scenes[0]!, stage: p.stage, chapter: ch };
}

/**
 * The scene at the head of the stage has played to the end: keep the flags its choices set and move past it,
 * then settle. Flags and the move are one change, so a scene's choices can never be applied twice.
 */
export function finishScene(c: CampaignSave, sceneId: string, set: Flags, chapters: readonly ChapterDef[], data: GameData, now: number): CampaignSave {
  const p = c.progress;
  if (!p.scenes || p.scenes[0] !== sceneId) throw new Error(`Scene ${sceneId} is not the one in progress`);
  const next: CampaignSave = { ...c, updatedAt: now, flags: { ...c.flags, ...set }, progress: { ...p, scenes: p.scenes.slice(1) } };
  return settle(next, chapters, data, now);
}

/** True when the campaign has something to play now (a scene or a battle), for Continue on the title. */
export function canPlay(c: CampaignSave, chapters: readonly ChapterDef[], data: GameData): boolean {
  const step = flowStep(c, chapters, data);
  return step.kind === 'scene' || step.kind === 'battle' || step.kind === 'camp';
}

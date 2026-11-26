// Campaign rules between battles: a new campaign from the new game choices, the
// battle setup for the current chapter, and what a won battle does to the save
// (party carried over, permadeath applied, chapter marked complete). Pure.

import { partyAfterBattle, type BattleSetup, type BattleState, type PartyUnit, type Permadeath } from '../core';
import {
  SAVE_VERSION,
  type CampaignSave,
  type CampaignSettings,
  type ChapterDef,
  type McProfile,
  type SlotId,
  type SuspendController,
  type SuspendSave,
} from './format';

/** What the new game flow collects. Phase 4 adds the look to `mc`. */
export interface NewGameChoices {
  settings: CampaignSettings;
  mc: McProfile;
}

export function newCampaign(choices: NewGameChoices, chapters: readonly ChapterDef[], now: number): CampaignSave {
  const first = chapters[0];
  if (!first) throw new Error('No chapters in the chapter order');
  return {
    version: SAVE_VERSION,
    kind: 'campaign',
    createdAt: now,
    updatedAt: now,
    settings: { ...choices.settings },
    mc: { ...choices.mc, name: choices.mc.name.trim() },
    party: [],
    fallen: [],
    progress: { current: first.id, completed: [] },
    flags: {},
    gold: 0,
    shards: 0,
  };
}

export function currentChapter(c: CampaignSave, chapters: readonly ChapterDef[]): ChapterDef | null {
  return chapters.find((ch) => ch.id === c.progress.current) ?? null;
}

/** The setup for the next map of this campaign. */
export function battleSetup(c: CampaignSave): BattleSetup {
  return {
    difficulty: c.settings.difficulty,
    permadeath: c.settings.permadeath,
    mc: { name: c.mc.name, style: c.mc.style },
    party: c.party.map((u) => ({ ...u, stats: { ...u.stats } })),
  };
}

export function suspendSave(slot: SlotId, campaign: CampaignSave, battle: BattleState, controller: SuspendController, now: number): SuspendSave {
  return { version: SAVE_VERSION, kind: 'suspend', savedAt: now, slot, campaign, mapId: battle.mapId, battle, controller: { ...controller } };
}

/**
 * Hook for the Classic rule "bearers the plot still needs retreat badly wounded
 * and sit out the rest of that act" (docs/DESIGN.md, Permadeath and difficulty).
 * Not built yet: no unit retreats, so every fallen unit in Classic is lost.
 * When it is built, units for which this returns true go to a resting list
 * (a save version bump) instead of `fallen`, and rejoin when the act ends.
 */
export function plotCriticalRetreats(_unit: PartyUnit, _campaign: CampaignSave): boolean {
  return false;
}

export interface PermadeathOutcome {
  /** Carried into the next map, in unit order. */
  party: PartyUnit[];
  /** Lost for good by this battle. */
  lost: PartyUnit[];
}

/**
 * Who comes back after a won battle. Casual: everyone, the fallen included.
 * Classic: the fallen are lost (unless plotCriticalRetreats, not built yet).
 * The MC falling is always a defeat, so it never reaches here.
 */
export function applyPermadeath(battle: BattleState, mode: Permadeath, campaign: CampaignSave): PermadeathOutcome {
  const { survivors, fallen } = partyAfterBattle(battle);
  const order = new Map(battle.units.map((u, i) => [u.id, i]));
  const byOrder = (a: PartyUnit, b: PartyUnit) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  if (mode === 'casual') return { party: [...survivors, ...fallen].sort(byOrder), lost: [] };
  const kept = fallen.filter((u) => plotCriticalRetreats(u, campaign));
  return { party: [...survivors, ...kept].sort(byOrder), lost: fallen.filter((u) => !kept.includes(u)) };
}

/** The campaign after winning the current chapter's battle. */
export function completeChapter(c: CampaignSave, battle: BattleState, chapters: readonly ChapterDef[], now: number): CampaignSave {
  if (battle.result !== 'victory') throw new Error('Only a won battle completes a chapter');
  const { party, lost } = applyPermadeath(battle, c.settings.permadeath, c);
  const done = c.progress.current;
  const completed = done && !c.progress.completed.includes(done) ? [...c.progress.completed, done] : [...c.progress.completed];
  const index = chapters.findIndex((ch) => ch.id === done);
  const next = index >= 0 ? (chapters[index + 1]?.id ?? null) : null;
  return {
    ...c,
    updatedAt: now,
    party,
    fallen: [...c.fallen, ...lost],
    progress: { current: next, completed },
  };
}

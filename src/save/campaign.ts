// Campaign rules between battles: a new campaign from the new game choices, the
// battle setup for the current chapter, and what a won battle does to the save
// (party carried over, permadeath applied, rewards paid, chapter marked complete,
// or a skirmish counted). Pure.

import { partyAfterBattle, weaponDef, type BattleSetup, type BattleState, type GameData, type PartyUnit, type Permadeath } from '../core';
import { applyRewards, battleRewards } from '../camp/rewards';
import type { EconomyDef, SkirmishDef } from '../camp/types';
import { DEFAULT_LOOK, type McLook } from '../art/mc/look';
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

/** What the new game flow collects. A missing look gets the default one. */
export interface NewGameChoices {
  settings: CampaignSettings;
  mc: Omit<McProfile, 'look'> & { look?: McLook };
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
    mc: { ...choices.mc, name: choices.mc.name.trim(), look: { ...(choices.mc.look ?? DEFAULT_LOOK) } },
    party: [],
    fallen: [],
    progress: { current: first.id, completed: [], stage: 'intro', scenes: null },
    flags: {},
    gold: 0,
    shards: 0,
    blades: {},
    convoy: [],
    benched: [],
    wounded: {},
    skirmishWins: {},
  };
}

/**
 * The campaign with every blade the party holds on record (new ones at tier 1, Dormant); blades already on record
 * keep their tier. Returns the same object when nothing changed.
 */
export function withBlades(c: CampaignSave, data: GameData): CampaignSave {
  let blades: CampaignSave['blades'] | null = null;
  for (const u of c.party) {
    const id = u.weaponId === null ? undefined : weaponDef(u.weaponId, data)?.blade;
    if (!id || c.blades[id] || blades?.[id]) continue;
    blades ??= { ...c.blades };
    blades[id] = { tier: 1 };
  }
  return blades ? { ...c, blades } : c;
}

export function currentChapter(c: CampaignSave, chapters: readonly ChapterDef[]): ChapterDef | null {
  return chapters.find((ch) => ch.id === c.progress.current) ?? null;
}

/** Who goes into the next battle and how its enemies scale (src/camp/barracks.ts, deployInfo). */
export interface DeployPlan {
  party: PartyUnit[];
  enemyLevelShift: number;
}

/**
 * The setup for the next map of this campaign: the story flags and the blades' tiers go into the battle. With a
 * deploy plan, only its units deploy (in its order) and the enemies scale by its shift; without one, the whole
 * party deploys.
 */
export function battleSetup(c: CampaignSave, plan?: DeployPlan): BattleSetup {
  const party = plan ? plan.party : c.party;
  const setup: BattleSetup = {
    difficulty: c.settings.difficulty,
    permadeath: c.settings.permadeath,
    mc: { name: c.mc.name, style: c.mc.style },
    party: party.map((u) => ({ ...u, stats: { ...u.stats }, inventory: [...u.inventory] })),
    flags: { ...c.flags },
    bladeTiers: Object.fromEntries(Object.entries(c.blades).map(([id, b]) => [id, b.tier])),
  };
  if (plan && plan.enemyLevelShift !== 0) setup.enemyLevelShift = plan.enemyLevelShift;
  return setup;
}

export function suspendSave(
  slot: SlotId,
  campaign: CampaignSave,
  battle: BattleState,
  controller: SuspendController,
  now: number,
  skirmish: string | null = null,
): SuspendSave {
  return {
    version: SAVE_VERSION,
    kind: 'suspend',
    savedAt: now,
    slot,
    campaign,
    mapId: battle.mapId,
    battle,
    controller: { showDanger: controller.showDanger, scenes: [...controller.scenes] },
    skirmish,
  };
}

/** The act of the campaign's current chapter (1 when unknown). */
function actNow(c: CampaignSave, chapters: readonly ChapterDef[]): number {
  return chapters.find((ch) => ch.id === c.progress.current)?.act ?? 1;
}

/**
 * The Classic rule "bearers the plot still needs retreat badly wounded and sit out the rest of that act"
 * (docs/DESIGN.md, Permadeath and difficulty): true for a fallen unit the current chapter lists as plot critical
 * (chapters.json `plotCritical`). Such a unit stays in the party, marked wounded until the act ends.
 */
export function plotCriticalRetreats(unit: PartyUnit, campaign: CampaignSave, chapters: readonly ChapterDef[] = []): boolean {
  const ch = chapters.find((x) => x.id === campaign.progress.current);
  return !!ch?.plotCritical?.includes(unit.id);
}

export interface PermadeathOutcome {
  /** Carried into the next map, in unit order. */
  party: PartyUnit[];
  /** Lost for good by this battle. */
  lost: PartyUnit[];
  /** Plot-critical units that fell in Classic and retreated badly wounded (they are in `party`). */
  wounded: string[];
}

/**
 * Who comes back after a won battle, of the units that were in it. Casual: everyone, the fallen included.
 * Classic: the fallen are lost, except plot-critical bearers (plotCriticalRetreats), who retreat wounded.
 * The MC falling is always a defeat, so it never reaches here.
 */
export function applyPermadeath(battle: BattleState, mode: Permadeath, campaign: CampaignSave, chapters: readonly ChapterDef[] = []): PermadeathOutcome {
  // Units that left the map during the battle left alive, so they stay (the chapter data may drop them).
  const { survivors, fallen, left } = partyAfterBattle(battle);
  const order = new Map(battle.units.map((u, i) => [u.id, i]));
  const byOrder = (a: PartyUnit, b: PartyUnit) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  if (mode === 'casual') return { party: [...survivors, ...left, ...fallen].sort(byOrder), lost: [], wounded: [] };
  const kept = fallen.filter((u) => plotCriticalRetreats(u, campaign, chapters));
  return {
    party: [...survivors, ...left, ...kept].sort(byOrder),
    lost: fallen.filter((u) => !kept.includes(u)),
    wounded: kept.map((u) => u.id),
  };
}

/**
 * The party after a battle: each unit that fought as the battle left it (or gone, if lost), each unit that stayed
 * in camp as it was, in roster order; then the newcomers (recruits, and with `keepGuests` the map's guests such
 * as the Stranger) in battle order.
 */
export function mergeParty(before: readonly PartyUnit[], outcome: PermadeathOutcome, recruited: readonly string[], keepGuests: boolean): PartyUnit[] {
  const after = new Map(outcome.party.map((u) => [u.id, u]));
  const lost = new Set(outcome.lost.map((u) => u.id));
  const out: PartyUnit[] = [];
  for (const u of before) {
    if (lost.has(u.id)) continue;
    out.push(after.get(u.id) ?? u);
  }
  const known = new Set(before.map((u) => u.id));
  for (const u of outcome.party) if (!known.has(u.id) && (keepGuests || recruited.includes(u.id))) out.push(u);
  return out;
}

/**
 * The campaign after winning the current chapter's battle: the party carried over (recruits included, units that
 * stayed in camp kept), the permadeath rule applied (plot-critical bearers wounded for the act in Classic), the
 * battle's story flags kept, the map's rewards paid (with `economy`), and the chapter moved on to its outro. The
 * chapter is marked complete once the outro has played (src/story/flow.ts).
 */
export function completeChapter(c: CampaignSave, battle: BattleState, chapters: readonly ChapterDef[], now: number, economy?: EconomyDef): CampaignSave {
  if (battle.result !== 'victory') throw new Error('Only a won battle completes a chapter');
  const outcome = applyPermadeath(battle, c.settings.permadeath, c, chapters);
  const act = actNow(c, chapters);
  const next: CampaignSave = {
    ...c,
    updatedAt: now,
    party: mergeParty(c.party, outcome, battle.recruited, true),
    fallen: [...c.fallen, ...outcome.lost],
    wounded: { ...c.wounded, ...Object.fromEntries(outcome.wounded.map((id) => [id, act])) },
    flags: { ...c.flags, ...battle.flags },
    progress: { ...c.progress, stage: 'outro', scenes: null },
  };
  return economy ? applyRewards(next, battleRewards(battle, economy.rewards[battle.mapId]), economy) : next;
}

/**
 * The campaign after winning a side skirmish: as a chapter's battle for the party, permadeath and flags (the map's
 * guests do not join), its rewards paid, and one more win counted against the current chapter's cap. The campaign
 * stays in camp.
 */
export function completeSkirmish(
  c: CampaignSave,
  battle: BattleState,
  skirmishId: string,
  def: SkirmishDef,
  chapters: readonly ChapterDef[],
  economy: EconomyDef,
  now: number,
): CampaignSave {
  if (battle.result !== 'victory') throw new Error('Only a won battle completes a skirmish');
  const outcome = applyPermadeath(battle, c.settings.permadeath, c, chapters);
  const act = actNow(c, chapters);
  const chapter = c.progress.current ?? skirmishId;
  const next: CampaignSave = {
    ...c,
    updatedAt: now,
    party: mergeParty(c.party, outcome, battle.recruited, false),
    fallen: [...c.fallen, ...outcome.lost],
    wounded: { ...c.wounded, ...Object.fromEntries(outcome.wounded.map((id) => [id, act])) },
    flags: { ...c.flags, ...battle.flags },
    skirmishWins: { ...c.skirmishWins, [chapter]: (c.skirmishWins[chapter] ?? 0) + 1 },
  };
  return applyRewards(next, battleRewards(battle, def.rewards), economy);
}

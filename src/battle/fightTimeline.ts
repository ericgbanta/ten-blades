// The battle scene's script: a pure function from the core's events for one fight (an attack, a staff heal or a
// power) to an ordered list of timed steps. The scene player (src/game/FightScene.ts) only draws these steps; it
// never reads the rules. Times are in ms at Full speed; the player scales them.

import type { BattleEvent, PowerSummary, School, Team, WeaponDef } from '../core';

/** The look of a strike, from the weapon kind. */
export type FxKind = 'slash' | 'thrust' | 'chop' | 'arrow' | 'bolt' | 'smoke' | 'needles' | 'mend';

export type Side = 'left' | 'right';

/** What the script needs to know about a unit, read from the state by the caller. */
export interface FighterFacts {
  team: Team;
  weapon: Pick<WeaponDef, 'kind' | 'school' | 'magic' | 'heal'> | null;
  maxHp: number;
  /** HP after the action: used for units the events do not show taking damage (a healer, Scatter's bearer). */
  hp: number;
  /** Bears an Awakened (or Unbound) blade: its strikes carry the blade's glow. Optional for older callers. */
  awakened?: boolean;
}

export interface Fighter {
  unitId: string;
  side: Side;
  /** 0 for the front fighter of a side; Scatter's extra targets stand behind at 1 and 2. */
  slot: number;
  hpBefore: number;
  maxHp: number;
  fx: FxKind;
  school: School;
  /** Bears an Awakened blade: its strikes glow. */
  awakened: boolean;
}

interface StepBase {
  /** Start, ms from the start of the scene at Full speed. */
  at: number;
  dur: number;
}

export type SceneStep =
  | (StepBase & { kind: 'intro' })
  | (StepBase & { kind: 'windup'; actor: string })
  /** Snap to the strike pose: melee lunges across most of the gap, ranged and magic stay back. */
  | (StepBase & { kind: 'strike'; actor: string; target: string; motion: 'melee' | 'ranged'; fx: FxKind; ghost: boolean })
  | (StepBase & { kind: 'projectile'; actor: string; target: string; fx: FxKind })
  | (StepBase & { kind: 'impact'; actor: string; target: string; fx: FxKind; damage: number; crit: boolean; hpAfter: number })
  | (StepBase & { kind: 'miss'; actor: string; target: string })
  | (StepBase & { kind: 'recover'; actor: string; target: string })
  | (StepBase & { kind: 'defeat'; unitId: string })
  /** A heal on `target`: a staff's warm glow, or Devour's red drain trail back to the bearer (`drain`). */
  | (StepBase & { kind: 'heal'; actor: string; target: string; amount: number; hpAfter: number; drain: boolean; from: string | null })
  | (StepBase & { kind: 'outro' });

export interface FightScript {
  kind: 'combat' | 'heal' | 'power';
  fighters: Fighter[];
  power: PowerSummary | null;
  steps: SceneStep[];
  /** End of the last step. */
  total: number;
}

/** Base lengths in ms at Full speed. */
export const FIGHT_MS = {
  intro: 320,
  windup: 260,
  strikeMelee: 130,
  strikeRanged: 110,
  projectile: 230,
  impact: 300,
  hitStop: 60,
  critStop: 150,
  recover: 230,
  gap: 90,
  defeat: 700,
  heal: 650,
  drain: 520,
  outro: 280,
  /** Gap between Scatter's needles on successive targets. */
  volley: 110,
} as const;

/** Most Scatter targets drawn in the side view; the rest only take their damage on the map. */
export const MAX_SHOWN_TARGETS = 3;

const FX_BY_KIND: Record<string, FxKind> = {
  greatsword: 'slash',
  katana: 'slash',
  legendary: 'slash',
  axe: 'chop',
  lance: 'thrust',
  dagger: 'thrust',
  bow: 'arrow',
  tome: 'bolt',
  spiritstaff: 'bolt',
  talisman: 'smoke',
  staff: 'mend',
};

/** Powers with a look of their own: Pin throws a needle like Scatter's. */
const POWER_FX: Record<string, FxKind> = { pin: 'needles' };

export function fxOf(weapon: FighterFacts['weapon']): FxKind {
  if (!weapon) return 'thrust';
  if (weapon.heal > 0) return 'mend';
  return FX_BY_KIND[weapon.kind] ?? (weapon.magic ? 'bolt' : 'slash');
}

/** Which side a team stands on: the player's side (and allies) on the left facing right, enemies on the right. */
export function sideOf(team: Team): Side {
  return team === 'enemy' ? 'right' : 'left';
}

/** True when a strike stays back and fires: bows, magic, and anything from two tiles or more. */
function isRanged(weapon: FighterFacts['weapon'], distance: number): boolean {
  if (!weapon) return false;
  return weapon.magic || weapon.kind === 'bow' || distance >= 2;
}

type Strike = Extract<BattleEvent, { type: 'strike' }>;

/** The events that make up one scene, as the controller groups them. */
export function isSceneStart(ev: BattleEvent): boolean {
  return ev.type === 'combatStarted' || ev.type === 'powerUsed' || (ev.type === 'unitHealed' && ev.cause === 'staff');
}

/**
 * Split off the scene that starts at `events[i]`: a fight runs to its `combatEnded` plus the falls right after
 * it; a power to its `powerEnded`; a staff heal is the one event. Returns the index after the group.
 */
export function sceneGroupEnd(events: readonly BattleEvent[], i: number): number {
  const first = events[i];
  if (!first || !isSceneStart(first)) return i;
  if (first.type === 'unitHealed') return i + 1;
  const closer = first.type === 'powerUsed' ? 'powerEnded' : 'combatEnded';
  let j = i + 1;
  while (j < events.length && events[j]!.type !== closer) j++;
  j = Math.min(events.length, j + 1);
  if (first.type === 'combatStarted') while (j < events.length && events[j]!.type === 'unitDefeated') j++;
  return j;
}

/**
 * Build the scene for one group of events (from sceneGroupEnd). `facts` describes each unit as it stands after
 * the action (team, weapon, max HP). Returns null when the group has nothing to stage.
 */
export function buildFightScript(group: readonly BattleEvent[], facts: (unitId: string) => FighterFacts | null): FightScript | null {
  const first = group[0];
  if (!first) return null;
  if (first.type === 'unitHealed') return healScript(first, facts);
  const power = first.type === 'powerUsed' ? first.summary : null;
  const started = group.find((e): e is Extract<BattleEvent, { type: 'combatStarted' }> => e.type === 'combatStarted');
  const strikes = group.filter((e): e is Strike => e.type === 'strike');
  if (!started && strikes.length === 0) return null;

  // Who stands where. A fight: its two sides. Scatter: the bearer and up to three targets.
  const bearerId = power ? power.bearerId : started!.attackerId;
  const bearer = facts(bearerId);
  if (!bearer) return null;
  const firstFoeId = started ? started.defenderId : strikes[0]!.defenderId;
  const foeIds = started ? [started.defenderId] : power ? power.targetIds.slice(0, MAX_SHOWN_TARGETS) : [firstFoeId];
  const hpBefore = new Map<string, number>();
  if (started) {
    hpBefore.set(started.attackerId, started.forecast.attacker.hp);
    hpBefore.set(started.defenderId, started.forecast.defenderHp);
  }
  for (const st of strikes) if (!hpBefore.has(st.defenderId)) hpBefore.set(st.defenderId, st.hpAfter + st.damage);
  const fighters: Fighter[] = [];
  const bearerSide = sideOf(bearer.team);
  const foeSide: Side = bearerSide === 'left' ? 'right' : 'left';
  const add = (id: string, side: Side, slot: number) => {
    const f = facts(id);
    if (!f) return;
    // HP before: from the forecast for a fight or the strikes taken; Scatter's bearer takes no damage.
    const before = hpBefore.get(id) ?? f.hp;
    const fx = power && id === bearerId && POWER_FX[power.powerId] ? POWER_FX[power.powerId]! : fxOf(f.weapon);
    fighters.push({ unitId: id, side, slot, hpBefore: before, maxHp: f.maxHp, fx, school: f.weapon?.school ?? 'none', awakened: f.awakened ?? false });
  };
  add(bearerId, bearerSide, 0);
  foeIds.forEach((id, i) => add(id, foeSide, i));
  // A fight between two units of one side (a player attacking an ally never happens; a heal is handled apart).
  if (fighters.length < 2) return null;
  const shown = new Set(fighters.map((f) => f.unitId));
  const distance = started ? started.forecast.distance : 2;

  const steps: SceneStep[] = [];
  let t = 0;
  steps.push({ kind: 'intro', at: 0, dur: FIGHT_MS.intro });
  t = FIGHT_MS.intro;
  const kind: FightScript['kind'] = power ? 'power' : 'combat';

  if (power && power.powerId === 'scatter') {
    // One wind-up, one throw: needles streak to each shown target in turn.
    const shownStrikes = strikes.filter((st) => shown.has(st.defenderId));
    const fx: FxKind = 'needles';
    steps.push({ kind: 'windup', at: t, dur: FIGHT_MS.windup, actor: bearerId });
    t += FIGHT_MS.windup;
    steps.push({ kind: 'strike', at: t, dur: FIGHT_MS.strikeRanged, actor: bearerId, target: foeIds[0]!, motion: 'ranged', fx, ghost: power.echoOf !== null });
    t += FIGHT_MS.strikeRanged;
    let last = t;
    shownStrikes.forEach((st, i) => {
      const at = t + i * FIGHT_MS.volley;
      steps.push({ kind: 'projectile', at, dur: FIGHT_MS.projectile, actor: bearerId, target: st.defenderId, fx });
      const hitAt = at + FIGHT_MS.projectile;
      steps.push(...landing(st, hitAt, fx));
      last = Math.max(last, hitAt + FIGHT_MS.impact);
    });
    t = last;
    steps.push({ kind: 'recover', at: t, dur: FIGHT_MS.recover, actor: bearerId, target: foeIds[0]! });
    t += FIGHT_MS.recover;
    t = defeats(group, shown, steps, t);
  } else {
    for (const st of strikes) {
      if (!shown.has(st.attackerId) || !shown.has(st.defenderId)) continue;
      const af = facts(st.attackerId);
      const fx = power && st.attackerId === bearerId && POWER_FX[power.powerId] ? POWER_FX[power.powerId]! : fxOf(af?.weapon ?? null);
      const motion = isRanged(af?.weapon ?? null, distance) ? 'ranged' : 'melee';
      const ghost = st.echo === true || (power !== null && power.echoOf !== null && st.attackerId === bearerId);
      steps.push({ kind: 'windup', at: t, dur: FIGHT_MS.windup, actor: st.attackerId });
      t += FIGHT_MS.windup;
      const strikeMs = motion === 'melee' ? FIGHT_MS.strikeMelee : FIGHT_MS.strikeRanged;
      steps.push({ kind: 'strike', at: t, dur: strikeMs, actor: st.attackerId, target: st.defenderId, motion, fx, ghost });
      t += strikeMs;
      if (motion === 'ranged') {
        steps.push({ kind: 'projectile', at: t, dur: FIGHT_MS.projectile, actor: st.attackerId, target: st.defenderId, fx });
        t += FIGHT_MS.projectile;
      }
      steps.push(...landing(st, t, fx));
      t += st.hit ? FIGHT_MS.impact + (st.crit ? FIGHT_MS.critStop : FIGHT_MS.hitStop) : FIGHT_MS.impact;
      steps.push({ kind: 'recover', at: t, dur: FIGHT_MS.recover, actor: st.attackerId, target: st.defenderId });
      t += FIGHT_MS.recover + FIGHT_MS.gap;
    }
    t = defeats(group, shown, steps, t);
    const healed = group.find((e): e is Extract<BattleEvent, { type: 'unitHealed' }> => e.type === 'unitHealed' && e.cause === 'power');
    if (healed && power) {
      const dur = FIGHT_MS.drain;
      steps.push({ kind: 'heal', at: t, dur, actor: bearerId, target: healed.unitId, amount: healed.amount, hpAfter: healed.hpAfter, drain: true, from: foeIds[0] ?? null });
      t += dur;
    }
  }
  steps.push({ kind: 'outro', at: t, dur: FIGHT_MS.outro });
  t += FIGHT_MS.outro;
  // Scatter's volley overlaps its shots; keep the list in time order (the sort is stable).
  steps.sort((x, y) => x.at - y.at);
  return { kind, fighters, power, steps, total: t };
}

/** Impact or miss for one strike at `at`. */
function landing(st: Strike, at: number, fx: FxKind): SceneStep[] {
  if (!st.hit) return [{ kind: 'miss', at, dur: FIGHT_MS.impact, actor: st.attackerId, target: st.defenderId }];
  return [{ kind: 'impact', at, dur: FIGHT_MS.impact, actor: st.attackerId, target: st.defenderId, fx, damage: st.damage, crit: st.crit, hpAfter: st.hpAfter }];
}

/** Falls of shown units, all at once after the last strike. */
function defeats(group: readonly BattleEvent[], shown: Set<string>, steps: SceneStep[], t: number): number {
  const down = group.filter((e): e is Extract<BattleEvent, { type: 'unitDefeated' }> => e.type === 'unitDefeated' && shown.has(e.unitId));
  if (down.length === 0) return t;
  for (const d of down) steps.push({ kind: 'defeat', at: t, dur: FIGHT_MS.defeat, unitId: d.unitId });
  return t + FIGHT_MS.defeat;
}

function healScript(ev: Extract<BattleEvent, { type: 'unitHealed' }>, facts: (unitId: string) => FighterFacts | null): FightScript | null {
  if (ev.sourceId === null) return null;
  const healer = facts(ev.sourceId);
  const target = facts(ev.unitId);
  if (!healer || !target) return null;
  const fighters: Fighter[] = [
    { unitId: ev.sourceId, side: 'left', slot: 0, hpBefore: healer.hp, maxHp: healer.maxHp, fx: 'mend', school: 'none', awakened: false },
    {
      unitId: ev.unitId,
      side: 'right',
      slot: 0,
      hpBefore: ev.hpAfter - ev.amount,
      maxHp: target.maxHp,
      fx: fxOf(target.weapon),
      school: target.weapon?.school ?? 'none',
      awakened: target.awakened ?? false,
    },
  ];
  const steps: SceneStep[] = [];
  let t = 0;
  steps.push({ kind: 'intro', at: t, dur: FIGHT_MS.intro });
  t += FIGHT_MS.intro;
  steps.push({ kind: 'windup', at: t, dur: FIGHT_MS.windup, actor: ev.sourceId });
  t += FIGHT_MS.windup;
  steps.push({ kind: 'strike', at: t, dur: FIGHT_MS.strikeRanged, actor: ev.sourceId, target: ev.unitId, motion: 'ranged', fx: 'mend', ghost: false });
  t += FIGHT_MS.strikeRanged;
  steps.push({ kind: 'heal', at: t, dur: FIGHT_MS.heal, actor: ev.sourceId, target: ev.unitId, amount: ev.amount, hpAfter: ev.hpAfter, drain: false, from: null });
  t += FIGHT_MS.heal;
  steps.push({ kind: 'recover', at: t, dur: FIGHT_MS.recover, actor: ev.sourceId, target: ev.unitId });
  t += FIGHT_MS.recover;
  steps.push({ kind: 'outro', at: t, dur: FIGHT_MS.outro });
  t += FIGHT_MS.outro;
  return { kind: 'heal', fighters, power: null, steps, total: t };
}

/** HP of every shown fighter at the end of the script, in fighter order. */
export function finalHp(script: FightScript): Map<string, number> {
  const hp = new Map(script.fighters.map((f) => [f.unitId, f.hpBefore]));
  for (const s of script.steps) {
    if (s.kind === 'impact') hp.set(s.target, s.hpAfter);
    if (s.kind === 'heal') hp.set(s.target, s.hpAfter);
  }
  return hp;
}

// Scripted map events: triggers, conditions and effects. Pure.
//
// A map's events (MapData.events, from src/data/maps/<id>.events.json) are read from the game data; the battle
// state only keeps which have fired (`firedEvents`) and the story flags, so a suspend save resumes exactly.
//
// When triggers are checked:
// - once at battle start (startBattle): battleStart, flag, and phaseStart for turn 1's player phase;
// - after every action, against the events that action produced and the state after it.
// Events are checked in the order the map lists them. An event fires at most once unless it is repeatable.
// The events its effects produce (a unit falling to a damage effect, say) are checked again in a further
// pass, until nothing new fires. Nothing here waits for the UI: a `scene` effect only emits
// `sceneRequested`, and the UI plays the scene before it plays the next event.

import { distance, findUnit, inBounds, samePos, unitAt } from './grid';
import { endBattle } from './objectives';
import { aiStateFrom, unitFromPlacement } from './units';
import type {
  BattleEvent,
  BattleState,
  EventCondition,
  EventEffect,
  EventTrigger,
  FlagValue,
  Flags,
  GameData,
  MapEvent,
  Pos,
  StoryCondition,
  Unit,
} from './types';

/** Passes after the first; a script that keeps firing new events past this is a data bug. */
const MAX_PASSES = 16;

/** The events of the map a battle is on (none if the map has none or is not in the data). */
export function mapEvents(state: BattleState, data: GameData): readonly MapEvent[] {
  return data.maps[state.mapId]?.events ?? [];
}

/** A flag's value; an unset flag reads as false. */
export function flagValue(flags: Flags, flag: string): FlagValue {
  return flags[flag] ?? false;
}

/** Context for story conditions outside a battle (dialogue and chapter data). */
export interface StoryContext {
  flags: Flags;
  permadeath: BattleState['options']['permadeath'];
  difficulty: BattleState['options']['difficulty'];
}

export function storyConditionHolds(c: StoryCondition, ctx: StoryContext): boolean {
  switch (c.type) {
    case 'flag':
      return flagValue(ctx.flags, c.flag) === (c.value ?? true);
    case 'permadeath':
      return ctx.permadeath === c.mode;
    case 'difficulty':
      return c.difficulties.includes(ctx.difficulty);
  }
}

export function storyConditionsHold(cs: readonly StoryCondition[] | undefined, ctx: StoryContext): boolean {
  return (cs ?? []).every((c) => storyConditionHolds(c, ctx));
}

function conditionHolds(s: BattleState, c: EventCondition): boolean {
  switch (c.type) {
    case 'alive': {
      const u = findUnit(s, c.unitId);
      return !!u && u.alive;
    }
    case 'fallen': {
      const u = findUnit(s, c.unitId);
      return !!u && !u.alive && !u.left;
    }
    default:
      return storyConditionHolds(c, { flags: s.flags, permadeath: s.options.permadeath, difficulty: s.options.difficulty });
  }
}

/** True if the event may fire now: not spent, and every condition holds. */
function ready(s: BattleState, ev: MapEvent): boolean {
  if (!ev.repeatable && s.firedEvents.includes(ev.id)) return false;
  return (ev.conditions ?? []).every((c) => conditionHolds(s, c));
}

function inRegion(t: Extract<EventTrigger, { type: 'enter' }>, p: Pos): boolean {
  if (t.tiles?.some((q) => samePos(q, p))) return true;
  const a = t.area;
  return !!a && p.x >= a.x && p.y >= a.y && p.x < a.x + a.w && p.y < a.y + a.h;
}

/** Does `trigger` match the batch of events just produced (or the battle start)? */
function matches(s: BattleState, t: EventTrigger, batch: readonly BattleEvent[], atStart: boolean): boolean {
  switch (t.type) {
    case 'battleStart':
      return atStart;
    case 'flag':
      return atStart && flagValue(s.flags, t.flag) === (t.value ?? true);
    case 'phaseStart': {
      const phase = t.phase ?? 'player';
      if (atStart) return t.turn === 1 && phase === 'player';
      return batch.some((e) => e.type === 'phaseChanged' && e.turn === t.turn && e.phase === phase);
    }
    case 'enter':
      return batch.some((e) => {
        if (e.type !== 'unitMoved' || !inRegion(t, e.to)) return false;
        const u = findUnit(s, e.unitId);
        if (!u || !u.alive) return false;
        if (t.unitId !== undefined) return u.id === t.unitId;
        return u.team === (t.team ?? 'player');
      });
    case 'defeated':
      return batch.some((e) => {
        if (e.type !== 'unitDefeated') return false;
        const u = findUnit(s, e.unitId);
        if (!u) return false;
        if (t.unitId !== undefined && u.id !== t.unitId) return false;
        if (t.tag !== undefined && !u.tags.includes(t.tag)) return false;
        if (t.team !== undefined && u.team !== t.team) return false;
        if (t.byId !== undefined && e.byId !== t.byId) return false;
        return true;
      });
    case 'hpBelow': {
      const u = findUnit(s, t.unitId);
      return !!u && u.alive && u.hp * 100 < t.percent * u.stats.hp;
    }
    case 'talk':
      return batch.some((e) => e.type === 'talked' && e.unitId === t.unitId && e.targetId === t.targetId);
    case 'allDefeated': {
      const tagged = s.units.filter((u) => u.tags.includes(t.tag));
      if (tagged.some((u) => u.alive && u.team === 'enemy')) return false;
      if (s.reinforcements.some((w) => w.units.some((p) => p.team === 'enemy' && (p.tags ?? []).includes(t.tag)))) return false;
      return tagged.some((u) => !u.alive && !u.left);
    }
  }
}

function living(s: BattleState, id: string): Unit | null {
  const u = findUnit(s, id);
  return u && u.alive ? u : null;
}

function applyEffect(s: BattleState, ev: MapEvent, fx: EventEffect, data: GameData, out: BattleEvent[]): void {
  switch (fx.type) {
    case 'scene':
      out.push({ type: 'sceneRequested', sceneId: fx.sceneId, eventId: ev.id });
      return;
    case 'spawn': {
      const ids: string[] = [];
      for (const p of fx.units) {
        if (!inBounds(s, p.pos) || unitAt(s, p.pos) || findUnit(s, p.id)) continue;
        const u = unitFromPlacement(p, s.options.difficulty, data);
        // As with reinforcements, only units of the phase in progress wait for their next phase.
        u.acted = u.team === s.phase;
        s.units.push(u);
        ids.push(u.id);
      }
      if (ids.length > 0) out.push({ type: 'reinforcementsArrived', unitIds: ids });
      return;
    }
    case 'remove': {
      const u = living(s, fx.unitId);
      if (!u) return;
      u.alive = false;
      u.left = true;
      u.acted = true;
      out.push({ type: 'unitLeft', unitId: u.id });
      return;
    }
    case 'setTeam': {
      const u = living(s, fx.unitId);
      if (!u || u.team === fx.team) return;
      const from = u.team;
      u.team = fx.team;
      u.ai = aiStateFrom(fx.ai ?? { behavior: 'charge' }, fx.team, u.pos, s.options.difficulty, data);
      u.acted = fx.team === s.phase;
      if (fx.team === 'player' && !s.recruited.includes(u.id)) s.recruited.push(u.id);
      if (fx.team !== 'player') s.recruited = s.recruited.filter((id) => id !== u.id);
      out.push({ type: 'unitTeamChanged', unitId: u.id, from, to: fx.team });
      return;
    }
    case 'setAi': {
      const u = living(s, fx.unitId);
      if (!u || u.team === 'player') return;
      u.ai = aiStateFrom(fx.ai, u.team, u.pos, s.options.difficulty, data);
      out.push({ type: 'aiChanged', unitId: u.id });
      return;
    }
    case 'setFlag':
      s.flags[fx.flag] = fx.value;
      out.push({ type: 'flagSet', flag: fx.flag, value: fx.value });
      return;
    case 'objective':
      s.objective = structuredClone(fx.objective);
      out.push({ type: 'objectiveChanged', objective: structuredClone(fx.objective) });
      return;
    case 'endBattle':
      endBattle(s, fx.result, out);
      return;
    case 'giveWeapon': {
      const u = findUnit(s, fx.unitId);
      if (!u) return;
      u.weaponId = fx.weaponId;
      out.push({ type: 'weaponChanged', unitId: u.id, weaponId: fx.weaponId });
      return;
    }
    case 'heal': {
      const u = living(s, fx.unitId);
      if (!u) return;
      const amount = Math.min(u.stats.hp - u.hp, Math.max(0, fx.amount));
      if (amount <= 0) return;
      u.hp += amount;
      out.push({ type: 'unitHealed', unitId: u.id, sourceId: null, cause: 'event', amount, hpAfter: u.hp });
      return;
    }
    case 'damage': {
      const u = living(s, fx.unitId);
      if (!u) return;
      const amount = Math.max(0, Math.min(fx.amount, fx.lethal ? u.hp : u.hp - 1));
      if (amount <= 0) return;
      u.hp -= amount;
      out.push({ type: 'unitDamaged', unitId: u.id, amount, hpAfter: u.hp });
      if (u.hp === 0) {
        u.alive = false;
        u.acted = true;
        out.push({ type: 'unitDefeated', unitId: u.id, byId: null });
      }
      return;
    }
    case 'lock':
    case 'unlock': {
      const u = living(s, fx.unitId);
      if (!u) return;
      u.acted = fx.type === 'lock';
      out.push({ type: 'unitLocked', unitId: u.id, locked: u.acted });
      return;
    }
  }
}

/**
 * Check every map event against `batch` (or the battle start) and fire the ones that match, then check again
 * against what those produced. Changes `s` in place and appends to `out`. Stops once the battle is over.
 */
export function runEvents(s: BattleState, batch: readonly BattleEvent[], data: GameData, out: BattleEvent[], atStart = false): void {
  const events = mapEvents(s, data);
  if (events.length === 0) return;
  let current = batch;
  let start = atStart;
  for (let pass = 0; pass <= MAX_PASSES && s.result === 'ongoing'; pass++) {
    const produced: BattleEvent[] = [];
    for (const ev of events) {
      if (s.result !== 'ongoing') break;
      if (!ready(s, ev) || !matches(s, ev.trigger, current, start)) continue;
      if (!s.firedEvents.includes(ev.id)) s.firedEvents.push(ev.id);
      produced.push({ type: 'eventFired', eventId: ev.id });
      for (const fx of ev.effects) {
        if (s.result !== 'ongoing') break;
        applyEffect(s, ev, fx, data, produced);
      }
    }
    out.push(...produced);
    if (produced.length === 0) return;
    current = produced;
    start = false;
  }
  if (s.result === 'ongoing') throw new Error(`Map ${s.mapId}: events keep firing each other`);
}

/**
 * Units `unitId` could talk to from `from`: a talk event for the pair is ready, and the target lives on a tile
 * next to `from`. Empty when the unit cannot act.
 */
export function talkTargets(state: BattleState, unitId: string, from: Pos, data: GameData): string[] {
  const out: string[] = [];
  for (const ev of mapEvents(state, data)) {
    const t = ev.trigger;
    if (t.type !== 'talk' || t.unitId !== unitId || out.includes(t.targetId) || !ready(state, ev)) continue;
    const target = living(state, t.targetId);
    if (!target || target.id === unitId || distance(from, target.pos) !== 1) continue;
    out.push(target.id);
  }
  return out;
}

/** True if a ready talk event links the two units (wherever they stand). */
export function canTalk(state: BattleState, unitId: string, targetId: string, data: GameData): boolean {
  return mapEvents(state, data).some(
    (ev) => ev.trigger.type === 'talk' && ev.trigger.unitId === unitId && ev.trigger.targetId === targetId && ready(state, ev),
  );
}

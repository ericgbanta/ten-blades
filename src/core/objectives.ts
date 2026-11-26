// Win and loss conditions.
//
// Loss, always: a lord falls, or no player units remain. Protect also loses when
// the protected unit falls. Win depends on the objective:
// - rout: no living enemies.
// - defeatBoss: every boss is down.
// - survive N: the enemy (and ally) phases of turn N end with the battle still going.
// - escape: a lord ends its action on an escape tile.
// - protect N: as survive, while the protected unit lives.

import { livingUnits, samePos } from './grid';
import type { BattleResult, BattleState, Objective, PartyUnit } from './types';

/** Outcome right now, ignoring turn-count objectives (see `turnLimitReached`). */
export function checkOutcome(state: BattleState): BattleResult {
  const players = livingUnits(state, 'player');
  if (players.length === 0) return 'defeat';
  if (state.units.some((u) => u.team === 'player' && u.isLord && !u.alive)) return 'defeat';
  const obj = state.objective;
  if (obj.type === 'protect') {
    const target = state.units.find((u) => u.id === obj.unitId);
    if (!target || !target.alive) return 'defeat';
  }
  switch (obj.type) {
    case 'rout':
      return livingUnits(state, 'enemy').length === 0 ? 'victory' : 'ongoing';
    case 'defeatBoss': {
      const bosses = state.units.filter((u) => u.team === 'enemy' && u.isBoss);
      return bosses.length > 0 && bosses.every((u) => !u.alive) ? 'victory' : 'ongoing';
    }
    case 'escape':
      return players.some((u) => u.isLord && u.acted && obj.tiles.some((t) => samePos(t, u.pos)))
        ? 'victory'
        : 'ongoing';
    case 'survive':
    case 'protect':
      return 'ongoing';
  }
}

/** True if finishing `turn` completes a survive or protect objective. */
export function turnLimitReached(state: BattleState, turn: number): boolean {
  const obj = state.objective;
  return (obj.type === 'survive' || obj.type === 'protect') && turn >= obj.turns;
}

export interface ObjectiveStatus {
  type: Objective['type'];
  /** The last turn for survive and protect (winning when its enemy phase ends), else null. */
  turnLimit: number | null;
  /** Turns still to play, the current one included (0 once the limit has passed), or null without a limit. */
  turnsLeft: number | null;
}

/** The objective with its turn count worked out, for the HUD. */
export function objectiveStatus(state: BattleState): ObjectiveStatus {
  const obj = state.objective;
  const turnLimit = obj.type === 'survive' || obj.type === 'protect' ? obj.turns : null;
  return {
    type: obj.type,
    turnLimit,
    turnsLeft: turnLimit === null ? null : Math.max(0, turnLimit - state.turn + 1),
  };
}

export interface PartyAfterBattle {
  /** Living player units, in unit order. */
  survivors: PartyUnit[];
  /** Fallen player units, in unit order. Whether they are gone for good is up to permadeath (see battleSummary). */
  fallen: PartyUnit[];
}

/**
 * Every player-team unit as a PartyUnit with its level, xp and max stats as they
 * stand now, so the campaign can carry units to the next map. Guests placed on the
 * player team by the map (such as the Stranger) are included; ally-team units are
 * not. Current HP is not kept, since units start each map at full HP.
 */
export function partyAfterBattle(state: BattleState): PartyAfterBattle {
  const out: PartyAfterBattle = { survivors: [], fallen: [] };
  for (const u of state.units) {
    if (u.team !== 'player') continue;
    const m: PartyUnit = {
      id: u.id,
      name: u.name,
      classId: u.classId,
      level: u.level,
      xp: u.xp,
      stats: { ...u.stats },
      weaponId: u.weaponId,
      isLord: u.isLord,
    };
    (u.alive ? out.survivors : out.fallen).push(m);
  }
  return out;
}

/** Ids of player units that fell, in unit order. */
export function fallenPlayerUnitIds(state: BattleState): string[] {
  return state.units.filter((u) => u.team === 'player' && !u.alive).map((u) => u.id);
}

export interface BattleSummary {
  result: BattleResult;
  turns: number;
  fallenPlayerUnitIds: string[];
  /** Fallen player units that are gone for good: all of them in classic, none in casual. */
  lostForGood: string[];
}

/** What the campaign layer needs after a battle. */
export function battleSummary(state: BattleState): BattleSummary {
  const fallen = fallenPlayerUnitIds(state);
  return {
    result: state.result,
    turns: state.turn,
    fallenPlayerUnitIds: fallen,
    lostForGood: state.options.permadeath === 'classic' ? fallen : [],
  };
}

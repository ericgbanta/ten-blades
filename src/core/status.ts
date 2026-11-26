// Battle statuses. Silenced: the unit cannot counter-attack or fire a power. Pinned: the unit cannot move (it can
// still act from its tile). A status wears off when the inflicting team's next phase begins after the turn it was
// put on, so a player's Hush or Pin lasts through the enemy phase and ends at the next player phase. Pure.

import type { BattleEvent, BattleState, StatusKind, Team, Unit } from './types';

export function hasStatus(unit: Pick<Unit, 'statuses'>, kind: StatusKind): boolean {
  return unit.statuses.some((s) => s.kind === kind);
}

/** Put a status on a unit (the caller's copy). A unit already under it gets the newer one. */
export function applyStatus(s: BattleState, target: Unit, kind: StatusKind, by: Unit, events: BattleEvent[]): void {
  target.statuses = [...target.statuses.filter((x) => x.kind !== kind), { kind, by: by.team, turn: s.turn }];
  events.push({ type: 'statusApplied', unitId: target.id, status: kind, byId: by.id });
}

/**
 * Clear what wears off as `phase` begins: statuses its own team put on before this turn. Anything two turns old
 * goes too, so a status put on by a team that no longer gets a phase (the last ally fell) still ends.
 */
export function expireStatuses(s: BattleState, phase: Team, events: BattleEvent[]): void {
  for (const u of s.units) {
    if (u.statuses.length === 0) continue;
    const keep = u.statuses.filter((st) => !((st.by === phase && s.turn > st.turn) || s.turn > st.turn + 1));
    if (keep.length === u.statuses.length) continue;
    for (const st of u.statuses) if (!keep.includes(st) && u.alive) events.push({ type: 'statusCleared', unitId: u.id, status: st.kind });
    u.statuses = keep;
  }
}

/** Movement this turn: none while pinned. */
export function moveBudget(unit: Unit): number {
  return hasStatus(unit, 'pin') ? 0 : unit.stats.mov;
}

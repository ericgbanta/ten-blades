// Plain-words labels for the battle overlays.

import type { BattleState, Objective, School, StatKey, Team, TriangleEdge } from '../../core';

export function objectiveText(o: Objective, state: BattleState): string {
  switch (o.type) {
    case 'rout':
      return 'Rout the enemy';
    case 'defeatBoss':
      return 'Defeat the boss';
    case 'survive':
      return `Survive ${o.turns} turns`;
    case 'escape':
      return 'Reach the escape point';
    case 'protect': {
      const name = state.units.find((u) => u.id === o.unitId)?.name ?? 'your ally';
      return `Protect ${name} for ${o.turns} turns`;
    }
  }
}

export const PHASE_LABEL: Record<Team, string> = {
  player: 'Player phase',
  enemy: 'Enemy phase',
  ally: 'Ally phase',
};

export const SCHOOL_LABEL: Record<School, string> = {
  heavy: 'Heavy',
  swift: 'Swift',
  arcane: 'Arcane',
  none: 'No school',
};

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  str: 'Str',
  mag: 'Mag',
  skl: 'Skl',
  spd: 'Spd',
  lck: 'Lck',
  def: 'Def',
  res: 'Res',
  mov: 'Mov',
};

/** Arrow and accessible label for a triangle edge. */
export function triangleMark(edge: TriangleEdge): { arrow: string; label: string } | null {
  if (edge === 'advantage') return { arrow: '▲', label: 'Triangle advantage' };
  if (edge === 'disadvantage') return { arrow: '▼', label: 'Triangle disadvantage' };
  return null;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

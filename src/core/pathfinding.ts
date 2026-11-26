// Movement ranges, paths, and attack and threat ranges.
//
// Movement is Dijkstra over terrain move costs. A unit can pass through friendly
// units but not stop on them, and cannot pass through hostile units.

import {
  areHostile,
  attackWeaponOf,
  distance,
  getUnit,
  indexToPos,
  inBounds,
  livingUnits,
  moveCostAt,
  movementTypeOf,
  neighbors,
  samePos,
  staffOf,
  tileIndex,
  tilesInRange,
  unitAt,
} from './grid';
import { moveBudget } from './status';
import type { BattleState, GameData, Pos, Unit } from './types';

/** A tile a unit can reach this turn. */
export interface ReachTile {
  pos: Pos;
  /** Movement spent to get there. */
  cost: number;
  /** False when a friendly unit stands there (can pass through, not stop). */
  canStop: boolean;
}

interface Field {
  cost: number[];
  prev: number[];
}

/**
 * Dijkstra from `sources` over the map for `mover`. Tiles holding units hostile to
 * the mover are impassable (except sources). Stops expanding past `budget`.
 *
 * Forward (the default) charges the cost of entering each new tile, so `cost` is the
 * movement spent walking out from a source. Reverse charges the cost of the tile
 * stepped from, so `cost[t]` is the movement needed to walk from t back to a source.
 * In reverse, a source holding a hostile unit costs nothing to "enter" (the mover
 * stops next to it), so the cost is to reach a tile beside that unit.
 */
function dijkstra(state: BattleState, mover: Unit, sources: Pos[], budget: number, data: GameData, reverse = false): Field {
  const n = state.map.width * state.map.height;
  const cost = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  const blocked = new Array<boolean>(n).fill(false);
  for (const u of livingUnits(state)) {
    if (areHostile(u.team, mover.team)) blocked[tileIndex(state, u.pos)] = true;
  }
  const heap = new MinHeap();
  for (const s of sources) {
    const i = tileIndex(state, s);
    cost[i] = 0;
    heap.push(0, i);
  }
  const moveType = movementTypeOf(mover, data);
  for (;;) {
    // Cheapest open tile first; ties go to the lowest index, which keeps it deterministic.
    const top = heap.pop();
    if (top === null) break;
    const [bestCost, best] = top;
    if (done[best] || bestCost !== cost[best]) continue;
    done[best] = true;
    const here = indexToPos(state, best);
    // Reverse: travelling toward the source, the mover steps from a neighbor into `here`.
    const into = reverse ? (blocked[best] ? 0 : moveCostAt(state, here, moveType, data)) : 0;
    if (into === null) continue;
    for (const nb of neighbors(state, here)) {
      const ni = tileIndex(state, nb);
      if (done[ni] || blocked[ni]) continue;
      const step = reverse ? into : moveCostAt(state, nb, moveType, data);
      if (step === null) continue;
      const c = bestCost + step;
      if (c <= budget && c < cost[ni]!) {
        cost[ni] = c;
        prev[ni] = best;
        heap.push(c, ni);
      }
    }
  }
  return { cost, prev };
}

/** Binary min-heap of [cost, index] ordered by cost, then index. */
class MinHeap {
  private items: [number, number][] = [];

  push(cost: number, index: number): void {
    const a = this.items;
    a.push([cost, index]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): [number, number] | null {
    const a = this.items;
    const top = a[0];
    if (top === undefined) return null;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

function less(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

function moveField(state: BattleState, unit: Unit, data: GameData): Field {
  return dijkstra(state, unit, [unit.pos], moveBudget(unit), data);
}

function reachFromField(state: BattleState, unit: Unit, field: Field): ReachTile[] {
  const out: ReachTile[] = [];
  field.cost.forEach((c, i) => {
    if (c === Infinity) return;
    const pos = indexToPos(state, i);
    const occupant = unitAt(state, pos);
    out.push({ pos, cost: c, canStop: occupant === null || occupant.id === unit.id });
  });
  return out;
}

/** Every tile the unit can move onto or through this turn, including its own tile (cost 0). */
export function reachableTiles(state: BattleState, unitId: string, data: GameData): ReachTile[] {
  const unit = getUnit(state, unitId);
  return reachFromField(state, unit, moveField(state, unit, data));
}

/** Tiles the unit can end its move on (its own tile included). */
export function moveTiles(state: BattleState, unitId: string, data: GameData): Pos[] {
  return reachableTiles(state, unitId, data)
    .filter((t) => t.canStop)
    .map((t) => t.pos);
}

/** True if the unit can end its move on `to` this turn. */
export function canMoveTo(state: BattleState, unitId: string, to: Pos, data: GameData): boolean {
  if (!inBounds(state, to)) return false;
  return moveTiles(state, unitId, data).some((p) => samePos(p, to));
}

/**
 * Cheapest path from the unit to `to`, both ends included, or null if the unit
 * cannot stop there this turn.
 */
export function pathTo(state: BattleState, unitId: string, to: Pos, data: GameData): Pos[] | null {
  const unit = getUnit(state, unitId);
  if (!canMoveTo(state, unitId, to, data)) return null;
  const field = moveField(state, unit, data);
  const path: Pos[] = [];
  let i = tileIndex(state, to);
  while (i >= 0) {
    path.push(indexToPos(state, i));
    i = field.prev[i]!;
  }
  return path.reverse();
}

/** Tiles in the unit's weapon range if it stood on `from`. Empty without an attack weapon. */
export function attackTilesFrom(state: BattleState, unitId: string, from: Pos, data: GameData): Pos[] {
  const w = attackWeaponOf(getUnit(state, unitId), data);
  if (!w) return [];
  return tilesInRange(state, from, w.range[0], w.range[1]);
}

/** Ids of living hostile units the unit could attack from `from`. */
export function attackTargets(state: BattleState, unitId: string, from: Pos, data: GameData): string[] {
  const unit = getUnit(state, unitId);
  const w = attackWeaponOf(unit, data);
  if (!w) return [];
  return livingUnits(state)
    .filter((t) => areHostile(unit.team, t.team))
    .filter((t) => {
      const d = distance(from, t.pos);
      return d >= w.range[0] && d <= w.range[1];
    })
    .map((t) => t.id);
}

/** Ids of wounded friendly units the unit could heal from `from` with its staff. */
export function healTargets(state: BattleState, unitId: string, from: Pos, data: GameData): string[] {
  const unit = getUnit(state, unitId);
  const staff = staffOf(unit, data);
  if (!staff) return [];
  return livingUnits(state)
    .filter((t) => t.id !== unit.id && !areHostile(unit.team, t.team) && t.hp < t.stats.hp)
    .filter((t) => {
      const d = distance(from, t.pos);
      return d >= staff.range[0] && d <= staff.range[1];
    })
    .map((t) => t.id);
}

function uniqueSorted(state: BattleState, tiles: Pos[]): Pos[] {
  const seen = new Set<number>();
  for (const p of tiles) seen.add(tileIndex(state, p));
  return [...seen].sort((a, b) => a - b).map((i) => indexToPos(state, i));
}

/** Union of tiles the unit could attack after moving anywhere it can stop this turn. */
export function attackRange(state: BattleState, unitId: string, data: GameData): Pos[] {
  const all: Pos[] = [];
  for (const p of moveTiles(state, unitId, data)) all.push(...attackTilesFrom(state, unitId, p, data));
  return uniqueSorted(state, all);
}

/**
 * Tiles the unit may act from this turn, as its AI sees it: move tiles, limited to
 * the guard radius for guard units. Player units get all move tiles.
 */
export function actionTiles(state: BattleState, unitId: string, data: GameData): Pos[] {
  const unit = getUnit(state, unitId);
  const tiles = moveTiles(state, unitId, data);
  const ai = unit.ai;
  if (ai && ai.behavior === 'guard') {
    const g = ai.guardTile ?? unit.pos;
    return tiles.filter((p) => distance(p, g) <= ai.guardRadius);
  }
  return tiles;
}

/** Tiles one unit threatens this turn (respects guard limits). */
export function unitThreatTiles(state: BattleState, unitId: string, data: GameData): Pos[] {
  const all: Pos[] = [];
  for (const p of actionTiles(state, unitId, data)) all.push(...attackTilesFrom(state, unitId, p, data));
  return uniqueSorted(state, all);
}

/** Union of tiles threatened by every living unit of `team` (default enemy). */
export function threatTiles(state: BattleState, data: GameData, team: Unit['team'] = 'enemy'): Pos[] {
  const all: Pos[] = [];
  for (const u of livingUnits(state, team)) all.push(...unitThreatTiles(state, u.id, data));
  return uniqueSorted(state, all);
}

/**
 * For every tile, the movement `mover` would need to walk from it to the nearest
 * source, ignoring its move budget: to the source tile itself, or to a tile beside
 * it when a hostile unit stands there. Infinity where unreachable. Used by the AI
 * to approach targets.
 */
export function distanceField(state: BattleState, mover: Unit, sources: Pos[], data: GameData): number[] {
  return dijkstra(state, mover, sources, Infinity, data, true).cost;
}

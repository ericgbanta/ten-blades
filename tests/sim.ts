// Balance simulator: auto-battles of the prologue on each difficulty, the first side skirmish (Ashfall Ridge)
// as a lone main character fresh from the prologue would meet it, with the skirmish's level scaling, and
// chapters 1 to 3 with the party a player would plausibly have at each point.
// The player side is driven by the same charge AI the enemies use (it never fires powers), with two additions
// the story maps need: a unit that can talk to someone (a recruit) does so, and on an escape map the main
// character heads for the nearest escape tile, striking only what stands in reach of the tile it moves to.
// Usage: npm run sim [-- battles [only]]   (default 1000 per difficulty; `only` limits it to the tables whose
// map id starts with it, for example `chapter2`)

import {
  applyAction,
  attackTargets,
  averageStats,
  createBattle,
  getUnit,
  moveTiles,
  planUnitAction,
  runAiPhase,
  talkTargets,
  type Action,
  type AiState,
  type BattleState,
  type Difficulty,
  type GameData,
  type McStyle,
  type PartyUnit,
} from '../src/core';
import { attackScore } from '../src/core/ai';
import { distanceField } from '../src/core/pathfinding';
import { campContent, gameData } from '../src/data';
import { scalingShift } from '../src/camp/barracks';

const PLAYER_AI: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };
const STYLES: McStyle[] = ['vanguard', 'duelist', 'spiritblade'];
const DIFFICULTIES: Difficulty[] = ['normal', 'hard', 'lunatic'];
const TURN_LIMIT = 40;

export interface SimOutcome {
  won: boolean;
  turns: number;
  lost: number;
  mcFell: boolean;
}

/** The simulator's choice for a player unit: talk to a recruit in reach, head for the exit as the lord on an escape map, else charge. */
export function planPlayer(s: BattleState, unitId: string, data: GameData): Action {
  for (const to of moveTiles(s, unitId, data)) {
    const [targetId] = talkTargets(s, unitId, to, data);
    if (targetId) return { type: 'talk', unitId, to, targetId };
  }
  const unit = getUnit(s, unitId);
  const obj = s.objective;
  if (unit.isLord && obj.type === 'escape') {
    const field = distanceField(s, unit, obj.tiles, data);
    const tiles = moveTiles(s, unitId, data);
    let to = tiles[0]!;
    for (const t of tiles) if (field[t.y * s.map.width + t.x]! < field[to.y * s.map.width + to.x]!) to = t;
    const targets = attackTargets(s, unitId, to, data);
    if (targets.length > 0 && !obj.tiles.some((t) => t.x === to.x && t.y === to.y)) {
      const best = targets.reduce((a, b) => (attackScore(s, unit, b, to, data) > attackScore(s, unit, a, to, data) ? b : a));
      return { type: 'attack', unitId, to, targetId: best };
    }
    return { type: 'wait', unitId, to };
  }
  return planUnitAction(s, unitId, data, PLAYER_AI);
}

/** Play one battle to the end with charge AI on both sides. */
export function simulateBattle(mapId: string, difficulty: Difficulty, style: McStyle, seed: number, data: GameData, party?: PartyUnit[], enemyLevelShift = 0): SimOutcome {
  const map = data.maps[mapId];
  if (!map) throw new Error(`No map ${mapId}`);
  let s: BattleState = createBattle(map, { difficulty, permadeath: 'classic', mc: { name: 'Hero', style }, party, enemyLevelShift }, seed, data);
  while (s.result === 'ongoing' && s.turn <= TURN_LIMIT) {
    for (;;) {
      const next = s.units.find((u) => u.alive && u.team === 'player' && !u.acted);
      if (!next || s.result !== 'ongoing') break;
      s = applyAction(s, planPlayer(s, next.id, data), data).state;
    }
    if (s.result !== 'ongoing') break;
    s = applyAction(s, { type: 'endPhase' }, data).state;
    s = runAiPhase(s, data).state;
  }
  const players = s.units.filter((u) => u.team === 'player');
  return {
    won: s.result === 'victory',
    turns: s.turn,
    lost: players.filter((u) => !u.alive).length,
    mcFell: players.some((u) => u.isLord && !u.alive),
  };
}

/** The main character as the prologue leaves them: level `level` with the style's Widow's Hush. */
function mcAfterPrologue(style: McStyle, level: number, data: GameData): PartyUnit {
  const weaponId = `widows_hush_${style}`;
  return { id: 'mc', name: 'Hero', classId: style, level, xp: 0, stats: averageStats(style, level, data), weaponId, isLord: true, inventory: [weaponId] };
}

/** A party unit at a level, with its class's starting weapon (or the one given) and average stats. */
function member(id: string, name: string, classId: string, level: number, data: GameData, weaponId?: string): PartyUnit {
  const w = weaponId ?? data.classes[classId]!.startingWeapon;
  return { id, name, classId, level, xp: 0, stats: averageStats(classId, level, data), weaponId: w, isLord: false, inventory: [w] };
}

/**
 * The party a player plausibly has at the start of each chapter. Calibrated on a chained run of the simulator
 * (prologue, then each chapter with the party the last one left, on Normal): the main character reaches about
 * level 2 to 3 by Chapter 2, the recruits about 3, and Garrow stays near his map level of 5. A human player who
 * gives the main character more kills, or fights the side skirmishes, will be a level or so ahead of this.
 */
export function chapterParty(chapter: 1 | 2 | 3, style: McStyle, data: GameData): PartyUnit[] {
  if (chapter === 1) return [mcAfterPrologue(style, 2, data)];
  const lv = chapter === 2 ? 3 : 4;
  const party = [
    mcAfterPrologue(style, lv, data),
    member('hask', 'Hask', 'soldier', lv, data),
    member('lise', 'Lise', 'ranger', lv, data),
    member('tobin', 'Tobin', 'adept', lv, data),
    member('marra', 'Marra', 'medic', lv, data),
  ];
  if (chapter === 3) party.push(member('gravemaw', 'Garrow', 'gravemaw_bearer', 5, data));
  return party;
}

function table(title: string, n: number, run: (d: Difficulty, style: McStyle, seed: number) => SimOutcome): void {
  console.log(title);
  console.log('difficulty  win%   avg turns  avg units lost  MC fell%  | win% vanguard / duelist / spiritblade');
  for (const d of DIFFICULTIES) {
    let wins = 0;
    let turns = 0;
    let lost = 0;
    let mcFell = 0;
    const styleWins = [0, 0, 0];
    const styleCount = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const si = i % STYLES.length;
      const r = run(d, STYLES[si]!, 1000 + i);
      if (r.won) {
        wins++;
        styleWins[si]!++;
      }
      styleCount[si]!++;
      turns += r.turns;
      lost += r.lost;
      if (r.mcFell) mcFell++;
    }
    const pct = (a: number, b: number): string => (b === 0 ? '-' : ((100 * a) / b).toFixed(1));
    console.log(
      `${d.padEnd(10)}  ${pct(wins, n).padStart(5)}  ${(turns / n).toFixed(2).padStart(9)}  ${(lost / n).toFixed(2).padStart(14)}  ${pct(mcFell, n).padStart(8)}  | ${STYLES.map((_, i) => pct(styleWins[i]!, styleCount[i]!)).join(' / ')}`,
    );
  }
}

function main(): void {
  const arg = Number(process.argv[2]);
  const n = Number.isInteger(arg) && arg > 0 ? arg : 1000;
  const only = process.argv[3] ?? '';
  const want = (mapId: string): boolean => mapId.startsWith(only);
  if (want('prologue')) table(`Prologue, ${n} battles per difficulty (MC style rotates), charge AI on both sides\n`, n, (d, style, seed) =>
    simulateBattle('prologue', d, style, seed, gameData),
  );
  // The first skirmish, for a lone MC at levels 2 and 4 with the two Ridge wardens; enemies scale to the MC.
  const ridge = campContent.skirmishes.ridge!;
  for (const level of want(ridge.mapId) ? [2, 4] : []) {
    table(`\nAshfall Ridge skirmish, lone MC at level ${level} (enemy level shift ${scalingShift([mcAfterPrologue('vanguard', level, gameData)], ridge.scaling)}), ${n} battles per difficulty\n`, n, (d, style, seed) => {
      const mc = mcAfterPrologue(style, level, gameData);
      return simulateBattle(ridge.mapId, d, style, seed, gameData, [mc], scalingShift([mc], ridge.scaling));
    });
  }
  const parties: Record<1 | 2 | 3, string> = {
    1: 'MC level 2 (Hask, Lise, Tobin and Marra are on the map)',
    2: 'MC and four recruits at level 3',
    3: 'MC and four recruits at level 4, Garrow level 5 (Pell joins on the map)',
  };
  for (const ch of [1, 2, 3] as const) {
    if (!want(`chapter${ch}`)) continue;
    table(`\nChapter ${ch}, ${parties[ch]}, ${n} battles per difficulty\n`, n, (d, style, seed) =>
      simulateBattle(`chapter${ch}`, d, style, seed, gameData, chapterParty(ch, style, gameData)),
    );
  }
}

// Run only as the script (tests/_trace.ts and others may import the helpers).
if (process.argv[1]?.endsWith('sim.ts')) main();

// Balance simulator: auto-battles of the prologue on each difficulty, then the first side skirmish (Ashfall Ridge)
// as a lone main character fresh from the prologue would meet it, with the skirmish's level scaling.
// The player side is driven by the same charge AI the enemies use (it never fires powers).
// Usage: npm run sim [-- battles]   (default 1000 per difficulty)

import {
  applyAction,
  averageStats,
  createBattle,
  planUnitAction,
  runAiPhase,
  type AiState,
  type BattleState,
  type Difficulty,
  type GameData,
  type McStyle,
  type PartyUnit,
} from '../src/core';
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

/** Play one battle to the end with charge AI on both sides. */
export function simulateBattle(mapId: string, difficulty: Difficulty, style: McStyle, seed: number, data: GameData, party?: PartyUnit[], enemyLevelShift = 0): SimOutcome {
  const map = data.maps[mapId];
  if (!map) throw new Error(`No map ${mapId}`);
  let s: BattleState = createBattle(map, { difficulty, permadeath: 'classic', mc: { name: 'Hero', style }, party, enemyLevelShift }, seed, data);
  while (s.result === 'ongoing' && s.turn <= TURN_LIMIT) {
    for (;;) {
      const next = s.units.find((u) => u.alive && u.team === 'player' && !u.acted);
      if (!next || s.result !== 'ongoing') break;
      s = applyAction(s, planUnitAction(s, next.id, data, PLAYER_AI), data).state;
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
  table(`Prologue, ${n} battles per difficulty (MC style rotates), charge AI on both sides\n`, n, (d, style, seed) =>
    simulateBattle('prologue', d, style, seed, gameData),
  );
  // The first skirmish, for a lone MC at levels 2 and 4 with the two Ridge wardens; enemies scale to the MC.
  const ridge = campContent.skirmishes.ridge!;
  for (const level of [2, 4]) {
    table(`\nAshfall Ridge skirmish, lone MC at level ${level} (enemy level shift ${scalingShift([mcAfterPrologue('vanguard', level, gameData)], ridge.scaling)}), ${n} battles per difficulty\n`, n, (d, style, seed) => {
      const mc = mcAfterPrologue(style, level, gameData);
      return simulateBattle(ridge.mapId, d, style, seed, gameData, [mc], scalingShift([mc], ridge.scaling));
    });
  }
}

main();

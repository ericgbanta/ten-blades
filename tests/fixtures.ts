// Small hand-made game data and map helpers for unit tests, so tests don't move
// when the real balance JSON is tuned.

import { createBattle } from '../src/core';
import type {
  AiSpec,
  Balance,
  BladeDef,
  PowerDef,
  BattleSetup,
  BattleState,
  ClassDef,
  GameData,
  MapData,
  Objective,
  Placement,
  ReinforcementWave,
  Stats,
  Team,
  UnitPlacement,
  Unit,
  WeaponDef,
} from '../src/core';

const stats = (hp: number, str: number, mag: number, skl: number, spd: number, lck: number, def: number, res: number, mov: number): Stats => ({
  hp,
  str,
  mag,
  skl,
  spd,
  lck,
  def,
  res,
  mov,
});

const balance: Balance = {
  hitRollMode: '1rn',
  combat: { hitSklMult: 2, hitLckDiv: 2, avoidSpdMult: 2, avoidLckMult: 1, critSklDiv: 2, critMultiplier: 3, doubleSpeedLead: 4 },
  triangle: { beats: { heavy: 'swift', swift: 'arcane', arcane: 'heavy' }, hitBonus: 15, damageBonus: 1 },
  xp: {
    perLevel: 100,
    levelCap: 20,
    hitBase: 31,
    hitDiv: 3,
    hitMin: 1,
    missXp: 1,
    killBase: 20,
    killLevelMult: 3,
    killMin: 7,
    bossBonus: 40,
    healXp: 11,
    maxPerAction: 100,
  },
  statCaps: stats(60, 30, 30, 30, 30, 30, 30, 30, 15),
  difficulty: {
    normal: { statMultiplier: 1, statBonus: {}, levelBonus: 0, aggressive: false },
    hard: { statMultiplier: 1.5, statBonus: { str: 1 }, levelBonus: 1, aggressive: false },
    lunatic: { statMultiplier: 2, statBonus: { hp: 5 }, levelBonus: 2, aggressive: true },
  },
  resolve: { max: 100, start: 20, dealHit: 15, takeHit: 10, crit: 10, kill: 25, aiMargin: 2 },
};

const cls = (school: ClassDef['school'], weaponKinds: string[], startingWeapon: string, base: Stats, growths: Stats): ClassDef => ({
  name: startingWeapon,
  school,
  movementType: 'foot',
  weaponKinds,
  startingWeapon,
  baseStats: base,
  growths,
});

const g = stats(50, 50, 50, 50, 50, 50, 50, 50, 0);

const classes: Record<string, ClassDef> = {
  fighter: cls('heavy', ['axe'], 'axe', stats(20, 6, 0, 5, 5, 4, 3, 1, 4), g),
  rogue: cls('swift', ['dagger'], 'dagger', stats(18, 4, 0, 8, 9, 6, 2, 1, 5), g),
  mage: cls('arcane', ['tome'], 'tome', stats(16, 0, 6, 5, 4, 2, 1, 5, 4), g),
  archer: cls('swift', ['bow'], 'bow', stats(17, 5, 0, 6, 5, 2, 2, 0, 4), g),
  healer: cls('none', ['staff'], 'staff', stats(15, 0, 4, 3, 4, 5, 1, 5, 4), g),
  brute: cls('heavy', ['axe'], 'axe', stats(30, 10, 0, 4, 3, 0, 5, 0, 4), stats(150, 100, 0, 0, 0, 0, 0, 0, 0)),
};

const weapon = (school: WeaponDef['school'], kind: string, might: number, hit: number, crit: number, range: [number, number], magic = false, heal = 0): WeaponDef => ({
  name: kind,
  kind,
  school,
  might,
  hit,
  crit,
  range,
  magic,
  heal,
  legendary: false,
});

const weapons: Record<string, WeaponDef> = {
  axe: weapon('heavy', 'axe', 5, 80, 0, [1, 1]),
  dagger: weapon('swift', 'dagger', 3, 90, 5, [1, 1]),
  tome: weapon('arcane', 'tome', 4, 85, 0, [1, 2], true),
  bow: weapon('swift', 'bow', 5, 85, 0, [2, 2]),
  staff: weapon('none', 'staff', 0, 0, 0, [1, 1], true, 10),
  sure_axe: weapon('heavy', 'axe', 5, 300, 0, [1, 1]),
  crit_axe: weapon('heavy', 'axe', 5, 300, 300, [1, 1]),
  miss_axe: weapon('heavy', 'axe', 5, -300, 0, [1, 1]),
  hush: { ...weapon('heavy', 'axe', 6, 80, 0, [1, 1]), legendary: true, blade: 'hush' },
  maw: { ...weapon('heavy', 'axe', 8, 80, 0, [1, 1]), legendary: true, blade: 'maw' },
  needles: { ...weapon('swift', 'dagger', 4, 90, 10, [1, 2]), legendary: true, blade: 'needles' },
  storm: { ...weapon('arcane', 'tome', 4, 85, 0, [1, 2], true), legendary: true, blade: 'storm' },
};

const tier = (n: number) => ({ tier: n, name: `T${n}`, note: '' });
const blades: Record<string, BladeDef> = {
  hush: { name: 'Hush', number: 1, school: 'style', wielder: 'mc', power: 'echo', tiers: [tier(1), tier(2), tier(3)] },
  maw: { name: 'Maw', number: 2, school: 'heavy', wielder: 'brute', power: 'devour', tiers: [tier(1), tier(2), tier(3)] },
  needles: { name: 'Needles', number: 3, school: 'swift', wielder: 'thief', power: 'scatter', tiers: [tier(1), tier(2), tier(3)] },
  storm: { name: 'Storm', number: 4, school: 'arcane', wielder: 'priestess', power: 'chain', tiers: [tier(1), tier(2), tier(3)] },
};

const powers: Record<string, PowerDef> = {
  echo: { name: 'Echo', description: '', implemented: true, cost: null, effect: { type: 'echo', range: 3, fallback: { range: [1, 1], damagePercent: 50 } } },
  devour: {
    name: 'Devour',
    description: '',
    implemented: true,
    cost: null,
    effect: { type: 'devour', bonusMight: 4, healPercent: 100, healCap: 15, attackPerKill: 1, maxStacks: 5 },
  },
  scatter: { name: 'Scatter', description: '', implemented: true, cost: 80, effect: { type: 'scatter', length: 4, damagePercent: 70 } },
  chain: { name: 'Chain', description: '', implemented: false, cost: null, effect: null },
};

/** Fixture game data. Terrain: . plain, F forest (cost 2, +20 avoid, +1 def), T fort, # wall, ~ water. */
export function fixtureData(): GameData {
  return structuredClone({
    balance,
    classes,
    weapons,
    terrain: {
      plain: { name: 'Plain', moveCost: { foot: 1 }, avoid: 0, def: 0, res: 0, healPercent: 0 },
      forest: { name: 'Forest', moveCost: { foot: 2 }, avoid: 20, def: 1, res: 0, healPercent: 0 },
      fort: { name: 'Fort', moveCost: { foot: 2 }, avoid: 20, def: 2, res: 2, healPercent: 20 },
      wall: { name: 'Wall', moveCost: { foot: null }, avoid: 0, def: 0, res: 0, healPercent: 0 },
      water: { name: 'Water', moveCost: { foot: null }, avoid: 0, def: 0, res: 0, healPercent: 0 },
    },
    maps: {},
    blades,
    powers,
  });
}

export interface UnitOpts {
  level?: number;
  weaponId?: string;
  ai?: AiSpec;
  isBoss?: boolean;
  isLord?: boolean;
  name?: string;
  tags?: string[];
}

/** A unit placement. Non-player units default to charge AI. */
export function place(id: string, classId: string, team: Team, x: number, y: number, o: UnitOpts = {}): UnitPlacement {
  const p: UnitPlacement = { kind: 'unit', id, name: o.name ?? id, classId, team, level: o.level ?? 1, pos: { x, y } };
  if (o.weaponId !== undefined) p.weaponId = o.weaponId;
  if (team !== 'player') p.ai = o.ai ?? { behavior: 'charge' };
  if (o.ai && team === 'player') p.ai = o.ai;
  if (o.isBoss !== undefined) p.isBoss = o.isBoss;
  if (o.isLord !== undefined) p.isLord = o.isLord;
  if (o.tags !== undefined) p.tags = o.tags;
  return p;
}

export function makeMap(
  tiles: string[],
  placements: Placement[],
  objective: Objective = { type: 'rout' },
  reinforcements: ReinforcementWave[] = [],
): MapData {
  return {
    id: 'test',
    name: 'Test',
    width: tiles[0]!.length,
    height: tiles.length,
    tiles,
    legend: { '.': 'plain', F: 'forest', T: 'fort', '#': 'wall', '~': 'water' },
    placements,
    objective,
    reinforcements,
  };
}

export const SETUP: BattleSetup = { difficulty: 'normal', permadeath: 'classic', mc: { name: 'Hero', style: 'vanguard' } };

export function makeBattle(
  tiles: string[],
  placements: Placement[],
  opts: { objective?: Objective; reinforcements?: ReinforcementWave[]; seed?: number; setup?: BattleSetup; data?: GameData } = {},
): BattleState {
  return createBattle(
    makeMap(tiles, placements, opts.objective, opts.reinforcements),
    opts.setup ?? SETUP,
    opts.seed ?? 1,
    opts.data ?? fixtureData(),
  );
}

/** Return a copy of the state with one unit patched (stats are merged). */
export function patchUnit(state: BattleState, id: string, patch: Partial<Omit<Unit, 'stats'>> & { stats?: Partial<Stats> }): BattleState {
  const s = structuredClone(state);
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  const { stats: st, ...rest } = patch;
  Object.assign(u, rest);
  if (st) Object.assign(u.stats, st);
  return s;
}

/** Recursively freeze an object so any mutation throws in strict mode. */
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const pos = (x: number, y: number) => ({ x, y });

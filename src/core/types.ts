// Shared types for the rules engine: game data (loaded from JSON), battle state,
// actions and events. Everything in BattleState is plain JSON: no classes, Maps,
// Sets, functions or undefined values. Its own fields are never optional. The one
// place optional keys appear is `reinforcements`, which holds the map's wave
// placements as written (UnitPlacement and AiSpec keys such as `weaponId`, `ai`,
// `isBoss`, `tile` may be absent, never undefined); they become full Units on arrival.

import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** A grid position. x is the column (0 at the left), y is the row (0 at the top). */
export interface Pos {
  x: number;
  y: number;
}

export type StatKey = 'hp' | 'str' | 'mag' | 'skl' | 'spd' | 'lck' | 'def' | 'res' | 'mov';

/** All nine stats. In a unit, `hp` is max HP; current HP is `Unit.hp`. */
export type Stats = Record<StatKey, number>;

export const STAT_KEYS: readonly StatKey[] = ['hp', 'str', 'mag', 'skl', 'spd', 'lck', 'def', 'res', 'mov'];

/** The three schools of the triangle, plus `none` (healers, outside it). */
export type School = 'heavy' | 'swift' | 'arcane' | 'none';

export type Team = 'player' | 'enemy' | 'ally';

export type Difficulty = 'normal' | 'hard' | 'lunatic';

export type Permadeath = 'classic' | 'casual';

/** The MC's three starting combat styles. Each is also a class id. */
export type McStyle = 'vanguard' | 'duelist' | 'spiritblade';

// ---------------------------------------------------------------------------
// Game data (JSON under src/data)
// ---------------------------------------------------------------------------

export interface TerrainDef {
  name: string;
  /** Cost to enter, per movement type. null means impassable for that type. */
  moveCost: Record<string, number | null>;
  avoid: number;
  def: number;
  res: number;
  /** Percent of max HP restored at the start of the owner's phase (forts). 0 for none. */
  healPercent: number;
}

export interface ClassDef {
  name: string;
  /** The school the class fights in, for display. Weapons decide the triangle. */
  school: School;
  /** Key into each terrain's moveCost. */
  movementType: string;
  /** Weapon kinds the class can equip. */
  weaponKinds: string[];
  /** Weapon given when a unit of this class is created without one. */
  startingWeapon: string;
  baseStats: Stats;
  /** Percent chance per level of +1 in each stat. Over 100 gives a sure +1 per 100. */
  growths: Stats;
}

export interface WeaponDef {
  name: string;
  /** Free-form kind matched against ClassDef.weaponKinds (sword, lance, bow, tome, staff, legendary...). */
  kind: string;
  school: School;
  might: number;
  hit: number;
  crit: number;
  /** Inclusive Manhattan range [min, max]. */
  range: [number, number];
  /** Magic weapons use mag against res; others use str against def. */
  magic: boolean;
  /** HP restored by a staff. A weapon with heal > 0 is a staff: it heals and never attacks. */
  heal: number;
  legendary: boolean;
}

export interface DifficultyDef {
  /** Every enemy stat except mov is multiplied by this, then rounded. */
  statMultiplier: number;
  /** Flat bonus added to enemy stats after the multiplier. */
  statBonus: Partial<Stats>;
  /** Extra levels added to every enemy (stats from average growths). */
  levelBonus: number;
  /** If true, enemies set to hold charge from the start. */
  aggressive: boolean;
}

export type HitRollMode = '1rn' | '2rn';

export interface Balance {
  /** '1rn': one roll per hit. '2rn': average of two rolls (true hit). */
  hitRollMode: HitRollMode;
  combat: {
    hitSklMult: number;
    hitLckDiv: number;
    avoidSpdMult: number;
    avoidLckMult: number;
    critSklDiv: number;
    critMultiplier: number;
    /** Speed lead needed to strike twice. */
    doubleSpeedLead: number;
  };
  triangle: {
    /** Each school maps to the school it beats. */
    beats: Record<'heavy' | 'swift' | 'arcane', School>;
    hitBonus: number;
    damageBonus: number;
  };
  xp: {
    perLevel: number;
    levelCap: number;
    hitBase: number;
    hitDiv: number;
    hitMin: number;
    missXp: number;
    killBase: number;
    killLevelMult: number;
    killMin: number;
    bossBonus: number;
    healXp: number;
    maxPerAction: number;
  };
  statCaps: Stats;
  difficulty: Record<Difficulty, DifficultyDef>;
}

/** AI behavior names used in map data. */
export type AiBehavior = 'charge' | 'hold' | 'guard';

/** AI settings in map data. `tile` and `radius` only matter for guard. */
export interface AiSpec {
  behavior: AiBehavior;
  /** Guard tile. Defaults to the unit's start tile. */
  tile?: Pos;
  /** How far from the guard tile the unit may move. Defaults to 0. */
  radius?: number;
}

/** A fixed unit in map data (enemies, guests such as the Stranger, reinforcements). */
export interface UnitPlacement {
  kind: 'unit';
  id: string;
  name: string;
  classId: string;
  team: Team;
  level: number;
  /** Defaults to the class's starting weapon. */
  weaponId?: string;
  pos: Pos;
  /** Required for enemy and ally units unless isBoss (bosses default to guarding their tile). */
  ai?: AiSpec;
  isBoss?: boolean;
  isLord?: boolean;
}

/** The MC's start tile. */
export interface McSlot {
  kind: 'mc';
  pos: Pos;
}

/** A deploy slot filled from the setup's party (non-lord members, in order). */
export interface PartySlot {
  kind: 'party';
  pos: Pos;
}

export type Placement = UnitPlacement | McSlot | PartySlot;

export type Objective =
  | { type: 'rout' }
  | { type: 'defeatBoss' }
  | { type: 'survive'; turns: number }
  | { type: 'escape'; tiles: Pos[] }
  | { type: 'protect'; unitId: string; turns: number };

export interface ReinforcementWave {
  /** Arrives at the start of the enemy phase of this turn. */
  turn: number;
  /** Difficulties the wave appears on. */
  difficulties: Difficulty[];
  units: UnitPlacement[];
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  /** One string per row, one character per tile, looked up in `legend`. */
  tiles: string[];
  /** Tile character to terrain id. */
  legend: Record<string, string>;
  placements: Placement[];
  objective: Objective;
  reinforcements: ReinforcementWave[];
  /** Decorative props drawn over the tiles (see src/data/props.json). The rules ignore them. */
  props?: MapProp[];
}

/** A decorative prop on a map tile. */
export interface MapProp {
  id: string;
  x: number;
  y: number;
}

/** Everything the engine reads from JSON, passed into every core function. */
export interface GameData {
  balance: Balance;
  terrain: Record<string, TerrainDef>;
  classes: Record<string, ClassDef>;
  weapons: Record<string, WeaponDef>;
  maps: Record<string, MapData>;
}

// ---------------------------------------------------------------------------
// Battle setup
// ---------------------------------------------------------------------------

/** A persistent party member carried between maps (later phases fill this). */
export interface PartyUnit {
  id: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  /** Max stats. Units start each map at full HP. */
  stats: Stats;
  weaponId: string | null;
  isLord: boolean;
}

export interface BattleSetup {
  difficulty: Difficulty;
  permadeath: Permadeath;
  /** Used to build the MC when the party has no lord. */
  mc: { name: string; style: McStyle };
  /** Carried-over units. A lord here fills the MC slot. */
  party?: PartyUnit[];
}

// ---------------------------------------------------------------------------
// Battle state (plain JSON)
// ---------------------------------------------------------------------------

export interface AiState {
  behavior: AiBehavior;
  /** Guard tile; null unless behavior is guard. */
  guardTile: Pos | null;
  guardRadius: number;
  /** For hold: true once triggered (it attacked or was attacked). Then it charges. */
  active: boolean;
}

export interface Unit {
  id: string;
  name: string;
  classId: string;
  team: Team;
  level: number;
  xp: number;
  /** Max stats (hp is max HP). */
  stats: Stats;
  /** Current HP. */
  hp: number;
  weaponId: string | null;
  pos: Pos;
  /** True once the unit has acted this phase. */
  acted: boolean;
  alive: boolean;
  /** null for player units (the player controls them). */
  ai: AiState | null;
  isBoss: boolean;
  /** Defeat of a lord loses the battle. */
  isLord: boolean;
}

export type BattleResult = 'ongoing' | 'victory' | 'defeat';

export interface BattleMap {
  width: number;
  height: number;
  /** Terrain ids, row-major: index = y * width + x. */
  terrain: string[];
}

export interface BattleState {
  version: 1;
  mapId: string;
  map: BattleMap;
  /** All units, including fallen ones (alive false). Order is stable. */
  units: Unit[];
  turn: number;
  phase: Team;
  rng: RngState;
  objective: Objective;
  /** Waves not yet arrived, already filtered by difficulty. Placements are as in the map (optional keys may be absent). */
  reinforcements: ReinforcementWave[];
  options: { difficulty: Difficulty; permadeath: Permadeath };
  result: BattleResult;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Move to `to` (may equal the current tile) and end the unit's action. */
export interface WaitAction {
  type: 'wait';
  unitId: string;
  to: Pos;
}

/** Move to `to` (may equal the current tile) and attack `targetId`. */
export interface AttackAction {
  type: 'attack';
  unitId: string;
  to: Pos;
  targetId: string;
}

/** Move to `to` and heal a friendly unit with a staff. */
export interface HealAction {
  type: 'heal';
  unitId: string;
  to: Pos;
  targetId: string;
}

/** End the current phase. */
export interface EndPhaseAction {
  type: 'endPhase';
}

// Later phases add item, talk and power actions here.
export type Action = WaitAction | AttackAction | HealAction | EndPhaseAction;

// ---------------------------------------------------------------------------
// Events (flat, in order, for the UI to animate)
// ---------------------------------------------------------------------------

export type TriangleEdge = 'advantage' | 'disadvantage' | 'neutral';

export type BattleEvent =
  | { type: 'unitMoved'; unitId: string; from: Pos; to: Pos; path: Pos[] }
  | { type: 'combatStarted'; attackerId: string; defenderId: string; forecast: Forecast }
  | {
      type: 'strike';
      attackerId: string;
      defenderId: string;
      hit: boolean;
      crit: boolean;
      damage: number;
      hpAfter: number;
    }
  | { type: 'combatEnded'; attackerId: string; defenderId: string }
  | { type: 'unitDefeated'; unitId: string; byId: string | null }
  | { type: 'xpGained'; unitId: string; amount: number; xpAfter: number }
  | { type: 'levelUp'; unitId: string; level: number; gains: Stats }
  | {
      type: 'unitHealed';
      unitId: string;
      sourceId: string | null;
      cause: 'staff' | 'terrain';
      amount: number;
      hpAfter: number;
    }
  | { type: 'unitActed'; unitId: string }
  | { type: 'turnStarted'; turn: number }
  | { type: 'phaseChanged'; phase: Team; turn: number }
  | { type: 'reinforcementsArrived'; unitIds: string[] }
  | { type: 'battleEnded'; result: 'victory' | 'defeat'; fallenPlayerUnitIds: string[] };

export interface ActionResult {
  state: BattleState;
  events: BattleEvent[];
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

/** One side of a combat forecast. */
export interface CombatSide {
  unitId: string;
  /** HP before combat. */
  hp: number;
  /** Attack power (str or mag + might + triangle). */
  attack: number;
  /** Damage per normal hit, after defense, min 0. A crit deals this times the crit multiplier. */
  damage: number;
  /** Hit chance 0 to 100. */
  hit: number;
  /** Crit chance 0 to 100 (rolled only on a hit). */
  crit: number;
  /** 1 or 2 (double strike). */
  strikes: number;
  triangle: TriangleEdge;
}

export interface Forecast {
  attacker: CombatSide;
  /** null when the defender cannot counter (no weapon, staff, or out of range). */
  counter: CombatSide | null;
  defenderId: string;
  /** Defender HP before combat. */
  defenderHp: number;
  /** Triangle edge of the defender, also given when it cannot counter. */
  defenderTriangle: TriangleEdge;
  distance: number;
}

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

/** A story flag value. Flags live in the campaign save and, during a battle, in BattleState.flags. */
export type FlagValue = boolean | number | string;

export type Flags = Record<string, FlagValue>;

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
  /** The legendary blade this weapon is (an id in blades.json). Its bearer runs a Resolve gauge and has its power. */
  blade?: string;
  /** Merchant price in gold. Legendary blades have none: they cannot be bought or sold. */
  price?: number;
}

/**
 * A consumable (src/data/items.json). Used from the unit's inventory with the item action: it restores up to
 * `heal` HP and adds `resolve` to a bearer's gauge, then it is gone. Items share inventory slots with weapons.
 */
export interface ItemDef {
  name: string;
  description: string;
  price: number;
  heal: number;
  resolve: number;
}

/** A battle status (src/core/status.ts). Silenced: no counters and no powers. Pinned: cannot move. */
export type StatusKind = 'silence' | 'pin';

export interface StatusEffect {
  kind: StatusKind;
  /** The team that inflicted it. It wears off when that team's next phase begins, after the turn it was put on. */
  by: Team;
  /** The turn it was put on. */
  turn: number;
}

// ---------------------------------------------------------------------------
// Blades and powers (src/data/blades.json)
// ---------------------------------------------------------------------------

/** A blade's school: one of the triangle's, or `style` for Widow's Hush, which takes the MC's combat style. */
export type BladeSchool = 'heavy' | 'swift' | 'arcane' | 'style';

/** What a tier needs besides its shards: a chapter reached, an act reached, story flags. `text` says it in plain words. */
export interface TierRequirement {
  /** Reached once this chapter is the current one or is completed. */
  chapter?: string;
  /** Reached once the current chapter's act is at least this. */
  act?: number;
  flags?: StoryCondition[];
  text: string;
}

export interface BladeTierDef {
  tier: number;
  name: string;
  /** What the tier adds. Tier 1 (Dormant) is the base power. */
  note: string;
  /** The power this tier adds (tier 1's is the blade's `power`). */
  power?: string;
  /** Blade Shards it costs to reach this tier (tier 1 costs nothing). */
  shards?: number;
  requires?: TierRequirement;
  /** Added to the bearer's stats once, when the blade reaches this tier (clamped to the stat caps). */
  statBoost?: Partial<Stats>;
  /**
   * The curse's price from this tier on: every power the bearer fires costs this much HP, never below 1
   * (docs/CAMP.md, The price of power).
   */
  bloodPrice?: number;
}

export interface BladeDef {
  name: string;
  /** Its number in the design doc's roster, 1 to 10. */
  number: number;
  school: BladeSchool;
  /** Who carries it (an archetype until the bearers are written). */
  wielder: string;
  power: string;
  tiers: BladeTierDef[];
}

/**
 * What a power does. Every number is tunable here.
 * - echo: re-casts the last other power used within `range` tiles of the bearer (it witnessed it), from the
 *   bearer with the bearer's stats. With nothing to echo, the fallback: an attack on an enemy at a distance in
 *   `fallback.range`, then the bearer's strike repeats once at `fallback.damagePercent` damage, uncounterable.
 * - devour: an empowered attack in weapon range (counters as usual): `bonusMight` on every strike, the bearer
 *   heals `healPercent` of the damage it dealt (at most `healCap`), and each kill by the bearer for the rest of
 *   the map adds `attackPerKill` attack, up to `maxStacks` kills.
 * - scatter: pick a direction; every hostile unit within `length` tiles in a straight line from the bearer takes
 *   one strike at `damagePercent` of normal damage. No counters.
 */
export type PowerEffect =
  | { type: 'echo'; range: number; fallback: { range: [number, number]; damagePercent: number } }
  | { type: 'devour'; bonusMight: number; healPercent: number; healCap: number; attackPerKill: number; maxStacks: number }
  | { type: 'scatter'; length: number; damagePercent: number }
  /**
   * strike: one blow at a hostile unit `range` tiles away (its own reach, not the weapon's) at `damagePercent` of
   * normal damage, no counter. Then `status` (if any) lands on the target: always, or only on a hit with `onHit`.
   */
  | { type: 'strike'; range: [number, number]; damagePercent: number; status: StatusKind | null; onHit: boolean }
  /**
   * cleave: an attack in weapon range with `bonusMight` (counters as usual); if the bearer still stands, every
   * other hostile unit next to it takes one strike at `splashPercent` of normal damage (no crit, no counter).
   */
  | { type: 'cleave'; bonusMight: number; splashPercent: number };

export interface PowerDef {
  name: string;
  description: string;
  /** False for powers not built yet: they show in data but cannot be used. */
  implemented: boolean;
  /** Resolve spent to fire it. Null spends the full gauge (balance.resolve.max). */
  cost: number | null;
  /** Null while not implemented. */
  effect: PowerEffect | null;
}

/** Resolve gauge numbers (balance.json). Only units holding a blade with a power have a gauge. */
export interface ResolveBalance {
  max: number;
  /** Gauge at the start of a battle. */
  start: number;
  /** Gains per strike: landing a hit, being hit, a crit landed (on top of the hit), and a kill. */
  dealHit: number;
  takeHit: number;
  crit: number;
  kill: number;
  /** The AI fires a ready power when it scores at least this much above its best attack. */
  aiMargin: number;
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
  resolve: ResolveBalance;
  /** Inventory slots per unit (weapons and items together). */
  inventory: { slots: number };
  /** Forge ranks for generic weapons: `+N` on a weapon id adds N times these, up to `max`. */
  weaponRanks: { max: number; might: number; hit: number };
  ai: {
    /** An AI unit below this percent of its max HP drinks a healing item if it carries one. */
    itemBelowPercent: number;
    /** What the AI adds to a power's score for each status it would put on a foe. */
    statusValue: number;
  };
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
  /** Free labels that scripted events can match (`defeated` and `allDefeated` triggers). */
  tags?: string[];
  /** Items it carries besides its weapon (item ids from items.json). */
  items?: string[];
}

/** The MC's start tile. */
export interface McSlot {
  kind: 'mc';
  pos: Pos;
  /**
   * Weapon per combat style for a main character the battle creates (no lord in the party), such as a test map
   * that hands the MC Widow's Hush. A lord carried in the party keeps its own weapon.
   */
  weapons?: Partial<Record<McStyle, string>>;
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
  /** Backdrop of the side-view battle scenes (art id `backdrop.<id>`). The rules ignore it. */
  backdrop?: string;
  /**
   * Scripted events (src/core/events.ts). Kept in a sidecar file, src/data/maps/<id>.events.json, which
   * src/data/index.ts merges in, so importing a map from Tiled never touches them (docs/MAPS.md).
   */
  events?: MapEvent[];
}

// ---------------------------------------------------------------------------
// Scripted events (map data)
// ---------------------------------------------------------------------------

/** A rectangle of tiles: x, y is the top left, w and h the size in tiles. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A condition on the story. Shared by map events, dialogue `if` nodes and chapter data. An unset flag reads
 * as false. `value` defaults to true.
 */
export type StoryCondition =
  | { type: 'flag'; flag: string; value?: FlagValue }
  | { type: 'permadeath'; mode: Permadeath }
  | { type: 'difficulty'; difficulties: Difficulty[] };

/** A condition an event checks when it would fire: a story condition, or whether a unit lives. */
export type EventCondition =
  | StoryCondition
  /** The unit is on the map and alive. */
  | { type: 'alive'; unitId: string }
  /** The unit has fallen (not merely left the map). */
  | { type: 'fallen'; unitId: string };

/**
 * What makes an event fire. Triggers are checked after every action (and once at battle start), against the
 * events that action produced and the state after it.
 */
export type EventTrigger =
  /** Once, when the battle starts (before the first player action). */
  | { type: 'battleStart' }
  /** At battle start, if the story flag has this value (default true). */
  | { type: 'flag'; flag: string; value?: FlagValue }
  /** At the start of a phase of a turn. `phase` defaults to player; turn 1's player phase is the battle start. */
  | { type: 'phaseStart'; turn: number; phase?: Team }
  /** A unit ends a move on one of the tiles. With neither unitId nor team, any player unit. */
  | { type: 'enter'; unitId?: string; team?: Team; tiles?: Pos[]; area?: Region }
  /** A unit falls. Narrow it by unit id, by tag, by team, and by who struck the blow (`byId`). */
  | { type: 'defeated'; unitId?: string; tag?: string; team?: Team; byId?: string }
  /** A living unit's HP is below `percent` of its max. */
  | { type: 'hpBelow'; unitId: string; percent: number }
  /** The `talk` action from unitId to targetId. */
  | { type: 'talk'; unitId: string; targetId: string }
  /** No enemy with the tag is left alive, and at least one has fallen. */
  | { type: 'allDefeated'; tag: string };

/** What an event does, in order. */
export type EventEffect =
  /** Ask the UI to play a dialogue scene (src/data/dialogue/<sceneId>.json). The core does not wait. */
  | { type: 'scene'; sceneId: string }
  /** Units arrive, like a reinforcement wave. A taken tile drops that unit. */
  | { type: 'spawn'; units: UnitPlacement[] }
  /** The unit leaves the map. Not a death: it is not counted as fallen. */
  | { type: 'remove'; unitId: string }
  /** The unit changes side. Joining the player team recruits it: it stays with the party after the battle. */
  | { type: 'setTeam'; unitId: string; team: Team; ai?: AiSpec }
  | { type: 'setAi'; unitId: string; ai: AiSpec }
  | { type: 'setFlag'; flag: string; value: FlagValue }
  | { type: 'objective'; objective: Objective }
  | { type: 'endBattle'; result: 'victory' | 'defeat' }
  /** Put a weapon in the unit's hand (the blade binding). */
  | { type: 'giveWeapon'; unitId: string; weaponId: string }
  | { type: 'heal'; unitId: string; amount: number }
  /** Damage that leaves at least 1 HP unless `lethal`. */
  | { type: 'damage'; unitId: string; amount: number; lethal?: boolean }
  /** The unit cannot act this turn (it counts as having acted). */
  | { type: 'lock'; unitId: string }
  /** The unit can act again this phase. */
  | { type: 'unlock'; unitId: string };

export interface MapEvent {
  /** Unique on the map. BattleState.firedEvents lists the ids that have fired. */
  id: string;
  trigger: EventTrigger;
  /** All must hold when the trigger matches, or the event does not fire (and stays ready). */
  conditions?: EventCondition[];
  effects: EventEffect[];
  /** Fire every time the trigger matches, not just once. Only for enter, defeated and talk triggers. */
  repeatable?: boolean;
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
  /** The ten legendary blades and their powers (src/data/blades.json). */
  blades: Record<string, BladeDef>;
  powers: Record<string, PowerDef>;
  /** Consumables (src/data/items.json). */
  items: Record<string, ItemDef>;
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
  /**
   * What the unit carries: weapon ids (a forged one as `<id>+<rank>`) and item ids, at most
   * `balance.inventory.slots`. The equipped weapon is one of them.
   */
  inventory: string[];
}

export interface BattleSetup {
  difficulty: Difficulty;
  permadeath: Permadeath;
  /** Used to build the MC when the party has no lord. */
  mc: { name: string; style: McStyle };
  /** Carried-over units. A lord here fills the MC slot. */
  party?: PartyUnit[];
  /** The campaign's story flags, copied into the battle. */
  flags?: Flags;
  /** Each blade's tier (1 Dormant, 2 Awakened, 3 Unbound) from the campaign. A blade not listed is at tier 1. */
  bladeTiers?: Record<string, number>;
  /** Levels added to every enemy placement and wave (a skirmish scaled to the party). Default 0. */
  enemyLevelShift?: number;
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
  /** Labels from the map, for event triggers. */
  tags: string[];
  /** True once an event took the unit off the map. A unit that left also has `alive` false, but it did not fall. */
  left: boolean;
  /** Resolve gauge, 0 to balance.resolve.max. Only bearers (a weapon with a blade) gain it; 0 for everyone else. */
  resolve: number;
  /** Kills that count for Devour's attack bonus this map (see PowerEffect devour). */
  devourStacks: number;
  /** Weapons and items carried (version 4). `weaponId`, when set, is one of them. */
  inventory: string[];
  /** Statuses on the unit (version 4). */
  statuses: StatusEffect[];
}

/** One use of a power, kept for Echo. */
export interface PowerUse {
  /** The power that took effect (an echo is logged as the power it re-cast). */
  powerId: string;
  bearerId: string;
  /** Where the bearer stood. */
  at: Pos;
  turn: number;
  /** Echo bearers within their echo range of `at`, living, when it was used: they can echo it later. */
  witnesses: string[];
}

export type BattleResult = 'ongoing' | 'victory' | 'defeat';

export interface BattleMap {
  width: number;
  height: number;
  /** Terrain ids, row-major: index = y * width + x. */
  terrain: string[];
}

export interface BattleState {
  version: 4;
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
  /** False until startBattle has run the battle start events (the first action also starts the battle). */
  started: boolean;
  /** Story flags: the campaign's, plus whatever events set. Returned to the campaign after a win. */
  flags: Flags;
  /** Ids of map events that have fired (repeatable ones are listed once). */
  firedEvents: string[];
  /** Ids of units that joined the player team during this battle, in order. */
  recruited: string[];
  /** Every power used this battle, in order (version 3). */
  powerLog: PowerUse[];
  /** Each blade's tier, from the campaign (version 4). A blade not listed is at tier 1. */
  bladeTiers: Record<string, number>;
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

/** Move to `to` and talk to an adjacent unit. Needs a talk event on the map for the pair. */
export interface TalkAction {
  type: 'talk';
  unitId: string;
  to: Pos;
  targetId: string;
}

export type Direction = 'up' | 'right' | 'down' | 'left';

/**
 * Move to `to` and fire the unit's blade power. Powers aimed at one unit take `targetId`; line powers (Scatter)
 * take `dir`. Uses the unit's action, like an attack.
 */
export interface PowerAction {
  type: 'power';
  unitId: string;
  to: Pos;
  targetId?: string;
  dir?: Direction;
  /** Which of the bearer's powers (an Awakened blade has two). Defaults to the blade's first power. */
  powerId?: string;
}

/** Move to `to` and use the item at `itemIndex` of the unit's inventory on itself. Uses the unit's action. */
export interface ItemAction {
  type: 'item';
  unitId: string;
  to: Pos;
  itemIndex: number;
}

/** Equip the weapon at `itemIndex` of the unit's inventory. Free: the unit does not move and can still act. */
export interface EquipAction {
  type: 'equip';
  unitId: string;
  itemIndex: number;
}

export type Action = WaitAction | AttackAction | HealAction | TalkAction | PowerAction | ItemAction | EquipAction | EndPhaseAction;

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
      /** Set on the repeat strike of Echo's fallback. */
      echo?: boolean;
    }
  | { type: 'combatEnded'; attackerId: string; defenderId: string }
  | { type: 'unitDefeated'; unitId: string; byId: string | null }
  | { type: 'xpGained'; unitId: string; amount: number; xpAfter: number }
  | { type: 'levelUp'; unitId: string; level: number; gains: Stats }
  | {
      type: 'unitHealed';
      unitId: string;
      sourceId: string | null;
      cause: 'staff' | 'terrain' | 'event' | 'power' | 'item';
      amount: number;
      hpAfter: number;
    }
  | { type: 'unitActed'; unitId: string }
  | { type: 'turnStarted'; turn: number }
  | { type: 'phaseChanged'; phase: Team; turn: number }
  | { type: 'reinforcementsArrived'; unitIds: string[] }
  | { type: 'battleEnded'; result: 'victory' | 'defeat'; fallenPlayerUnitIds: string[] }
  // Scripted events (src/core/events.ts)
  | { type: 'talked'; unitId: string; targetId: string }
  | { type: 'eventFired'; eventId: string }
  /** Play this dialogue scene now. The core does not wait; the UI plays it, then goes on with the next event. */
  | { type: 'sceneRequested'; sceneId: string; eventId: string }
  | { type: 'unitLeft'; unitId: string }
  | { type: 'unitTeamChanged'; unitId: string; from: Team; to: Team }
  | { type: 'aiChanged'; unitId: string }
  | { type: 'flagSet'; flag: string; value: FlagValue }
  | { type: 'objectiveChanged'; objective: Objective }
  | { type: 'weaponChanged'; unitId: string; weaponId: string }
  /** Damage from an event, or a power's blood price (`cause` bloodPrice). */
  | { type: 'unitDamaged'; unitId: string; amount: number; hpAfter: number; cause?: 'bloodPrice' }
  | { type: 'unitLocked'; unitId: string; locked: boolean }
  // Powers (src/core/powers.ts)
  /** A power fires. Its strikes, falls, heals and gauge changes follow, then `powerEnded`. */
  | { type: 'powerUsed'; summary: PowerSummary }
  | { type: 'powerEnded'; powerId: string; bearerId: string }
  /** A gauge changed: `amount` gained (or spent, negative). */
  | { type: 'resolveChanged'; unitId: string; amount: number; resolveAfter: number }
  /** Devour's kill bonus grew. */
  | { type: 'devourStack'; unitId: string; stacks: number; attackBonus: number }
  // Items and statuses
  /** An item was used up. Its heal and gauge changes follow. */
  | { type: 'itemUsed'; unitId: string; itemId: string }
  | { type: 'statusApplied'; unitId: string; status: StatusKind; byId: string }
  | { type: 'statusCleared'; unitId: string; status: StatusKind };

/** What a power did, announced up front so the UI can stage it. */
export interface PowerSummary {
  /** The power that took effect (an Echo re-casting Devour says devour). */
  powerId: string;
  /** The bearer's own power (echo when echoing). */
  bladePowerId: string;
  /** For an echo: the unit whose power was re-cast, or null for the fallback or no echo. */
  echoOf: string | null;
  /** True for Echo's fallback (repeat strike). */
  fallback: boolean;
  bearerId: string;
  from: Pos;
  dir: Direction | null;
  /** Tiles the power covers (the line for Scatter, the target's tile otherwise). */
  tiles: Pos[];
  /** Units struck, in strike order. */
  targetIds: string[];
  /** The bearer's numbers against each target, as forecast (what was rolled). */
  odds: { unitId: string; damage: number; hit: number; crit: number }[];
  /** Each target's final HP and whether it fell. */
  results: { unitId: string; damage: number; hit: boolean; crit: boolean; hpAfter: number; defeated: boolean }[];
  /** HP the bearer healed, 0 if none. */
  heal: number;
  /** Devour stacks after the power, or null when the power gives none. */
  stacksAfter: number | null;
  /** Statuses the power put on its targets. */
  statuses: { unitId: string; status: StatusKind }[];
  /** HP the bearer paid to the blade (an Awakened blade's price), 0 if none. */
  bloodPrice: number;
}

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

# Core API

This is a reference for building the battle UI on the rules engine in `src/core`. Import everything from `src/core` (the index) and the loaded data from `src/data`:

```ts
import { createBattle, applyAction, planAiAction /* ... */ } from '../core';
import { gameData } from '../data';
```

The core is pure. Every function takes the state and data as arguments and returns new values. Nothing in it touches the DOM, Phaser, Preact or storage. All functions take `data: GameData` as the last argument.

## Battle state

`BattleState` is plain JSON, so it can be saved with `JSON.stringify` and restored with `JSON.parse` (the suspend save in phase 3). It has no optional fields.

| Field | Meaning |
| --- | --- |
| `version` | Always 1 for now. |
| `mapId` | Id of the map in `gameData.maps`. |
| `map` | `width`, `height` and `terrain`, a flat row-major list of terrain ids (`terrain[y * width + x]`). |
| `units` | Every unit, fallen ones included (`alive: false`). Order never changes, except that reinforcements are appended. |
| `turn`, `phase` | Turn number from 1, and whose phase it is: `player`, `enemy` or `ally`. |
| `rng` | The seeded RNG state. Never touch it. |
| `objective` | Copied from the map. See below. |
| `reinforcements` | Waves still to come, already filtered by difficulty. |
| `options` | `difficulty` and `permadeath`. |
| `result` | `ongoing`, `victory` or `defeat`. |

A `Unit` has `id`, `name`, `classId`, `team`, `level`, `xp`, `stats` (max stats, so `stats.hp` is max HP), `hp` (current), `weaponId`, `pos`, `acted`, `alive`, `ai` (null for player units), `isBoss` and `isLord`. Look up class and weapon details in `gameData.classes` and `gameData.weapons`.

Positions are `{ x, y }`, with x the column and y the row, and (0, 0) at the top left. Distances are Manhattan.

## Creating a battle

`createBattle(map, setup, seed, data)` returns a state on turn 1, player phase. `setup` is a `BattleSetup`:

- `difficulty`: `normal`, `hard` or `lunatic`. Enemies get extra levels, a stat multiplier and flat bonuses from `balance.json`. Lunatic also turns enemies set to hold into chargers. Some reinforcement waves only appear on harder difficulties.
- `permadeath`: `classic` or `casual`. It changes nothing during the battle. `battleSummary(state).lostForGood` lists the fallen player units that are gone for good.
- `mc`: `{ name, style }`, where style is `vanguard`, `duelist` or `spiritblade`. Used to build the MC (id `mc`) when the party has no lord.
- `party` (optional): carried-over units. A lord fills the map's MC slot, and the others fill its party slots in order.

## Actions

Pass one to `applyAction(state, action, data)`. It returns `{ state, events }` and never changes the input. An illegal action throws `ActionError`. Call `validateAction(state, action, data)` first if you want the reason as a string instead.

| Action | Meaning |
| --- | --- |
| `{ type: 'wait', unitId, to }` | Move to `to` (it can be the current tile) and end the unit's turn. |
| `{ type: 'attack', unitId, to, targetId }` | Move to `to`, then fight `targetId`. |
| `{ type: 'heal', unitId, to, targetId }` | Move to `to`, then heal a wounded friend with a staff. |
| `{ type: 'endPhase' }` | End the current phase. |

The move is part of the action, so the UI keeps the "moved but not yet confirmed" step locally and only calls `applyAction` once the player picks Wait, Attack or Heal. Cancel needs no core call.

## Events

Events come back in order. Play them one after another.

| Event | Fields |
| --- | --- |
| `unitMoved` | `unitId`, `from`, `to`, `path` (every tile, both ends included) |
| `combatStarted` | `attackerId`, `defenderId`, `forecast` |
| `strike` | `attackerId`, `defenderId`, `hit`, `crit`, `damage`, `hpAfter` |
| `combatEnded` | `attackerId`, `defenderId` |
| `unitDefeated` | `unitId`, `byId` |
| `xpGained` | `unitId`, `amount`, `xpAfter` (after any level-up) |
| `levelUp` | `unitId`, `level`, `gains` (a full stats object) |
| `unitHealed` | `unitId`, `sourceId`, `cause` (`staff` or `terrain`), `amount`, `hpAfter` |
| `unitActed` | `unitId` (grey it out) |
| `turnStarted` | `turn` |
| `phaseChanged` | `phase`, `turn` |
| `reinforcementsArrived` | `unitIds` |
| `battleEnded` | `result`, `fallenPlayerUnitIds` |

In a strike, `attackerId` is the unit swinging, so a counter has the defender as `attackerId`. Damage is already capped at the target's remaining HP.

## Queries

All are pure and cheap enough to call on every tap.

- `reachableTiles(state, unitId, data)`: every tile the unit can move onto or through, with `cost` and `canStop` (false on a friendly unit's tile). Use the `canStop` tiles for the blue overlay.
- `moveTiles(state, unitId, data)`: only the tiles it can stop on, its own included.
- `pathTo(state, unitId, to, data)`: the path the move will take, or null.
- `attackTilesFrom(state, unitId, from, data)`: tiles in weapon range from a tile.
- `attackTargets(state, unitId, from, data)` and `healTargets(...)`: unit ids it could hit or heal from a tile.
- `attackRange(state, unitId, data)`: every tile it could attack after moving (the red overlay).
- `unitThreatTiles(state, unitId, data)` and `threatTiles(state, data, team = 'enemy')`: tiles an enemy unit, or all of them, can attack this turn. Guard units only count from their guard area.
- `forecast(state, attackerId, defenderId, from, data)`: the fight preview. `attacker` and `counter` each give `hp`, `attack`, `damage` per hit, `hit` %, `crit` %, `strikes` (2 means a double) and `triangle` (`advantage`, `disadvantage` or `neutral`). `counter` is null when the defender cannot strike back, and `defenderTriangle` still gives its triangle edge. Resolution uses exactly these numbers.
- `getUnit`, `unitAt`, `livingUnits`, `terrainAt`, `distance`, `areHostile`.
- `healAmount(state, healerId, targetId, data)`: HP a staff heal would restore now. `healRange(state, unitId, data)`: every tile a staff user could heal after moving (the green overlay).
- `checkOutcome(state)` and `battleSummary(state)`.

## Objectives

`objective.type` is one of these:

- `rout`: defeat every enemy.
- `defeatBoss`: defeat every enemy with `isBoss`.
- `survive` with `turns`: win when the enemy phase of that turn ends.
- `escape` with `tiles`: win when a lord ends its action on one of the tiles.
- `protect` with `unitId` and `turns`: as survive, and losing that unit loses.

The battle is always lost if a lord falls or no player units are left.

## Turn order

Player phase, then enemy phase, then an ally phase if any allies are alive, then the next turn. Each phase starts with fort healing for that team. Reinforcements for a turn arrive at the start of its enemy phase and act from the next turn. If a reinforcement's tile is taken, that unit does not arrive.

## Enemy AI

`planAiAction(state, data)` returns the next action of the current AI phase, `endPhase` when every unit of that team has acted, or null during the player phase or after the battle. Behaviors: `charge` attacks the best target it can reach or walks toward the nearest hostile, `hold` waits until a hostile is in reach or it gets attacked and then charges for the rest of the battle, and `guard` only acts from tiles within its radius of its guard tile. Bosses guard their own tile with radius 0 unless the map says otherwise. Staff users heal the most wounded friend they can reach. The AI is deterministic.

`runAiPhase(state, data)` plays every AI phase until the player phase or the end, for tests and the simulator.

## Example

```ts
let state = createBattle(gameData.maps.prologue!, {
  difficulty: 'normal', permadeath: 'classic', mc: { name: 'Ash', style: 'duelist' },
}, Date.now() >>> 0, gameData);

// Player taps the MC, then a tile, then an enemy.
const blue = moveTiles(state, 'mc', gameData);
const to = { x: 4, y: 6 };
const targets = attackTargets(state, 'mc', to, gameData);
const preview = forecast(state, 'mc', targets[0]!, to, gameData); // show the panel
let r = applyAction(state, { type: 'attack', unitId: 'mc', to, targetId: targets[0]! }, gameData);
await play(r.events);
state = r.state;

// End turn, then step the enemy phase one unit at a time.
r = applyAction(state, { type: 'endPhase' }, gameData);
await play(r.events);
state = r.state;
for (let a = planAiAction(state, gameData); a; a = planAiAction(state, gameData)) {
  r = applyAction(state, a, gameData);
  await play(r.events);
  state = r.state;
}
// Now it is the player's phase again, or state.result is victory or defeat.
```

## Data

`gameData` (from `src/data/index.ts`) bundles `balance.json`, `terrain.json`, `classes.json`, `weapons.json` and the maps. Every balance number is in `balance.json`, including the hit roll mode (`1rn` or `2rn`). Terrain move costs are given per movement type, so new movement types only need new keys. A weapon with `heal` above 0 is a staff: it heals and never attacks or counters. `validateGameData(gameData)` checks every cross reference, and a unit test runs it.

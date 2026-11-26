# Core API

This is a reference for building the battle UI on the rules engine in `src/core`. Import everything from `src/core` (the index) and the loaded data from `src/data`:

```ts
import { createBattle, applyAction, planAiAction /* ... */ } from '../core';
import { gameData } from '../data';
```

The core is pure. Every function takes the state and data as arguments and returns new values. Nothing in it touches the DOM, Phaser, Preact or storage. All functions take `data: GameData` as the last argument.

## Battle state

`BattleState` is plain JSON, so it can be saved with `JSON.stringify` and restored with `JSON.parse` (the suspend save in phase 3). Its own fields are never optional and nothing in it is `undefined`. The one place optional keys appear is `reinforcements`: it holds the map's wave placements as written, so keys such as `weaponId`, `ai` or `isBoss` may be absent there. They become full units when they arrive.

| Field | Meaning |
| --- | --- |
| `version` | 4 (version 1 had no story fields, version 2 no powers, version 3 no inventories, statuses or blade tiers; the save migration adds them). |
| `mapId` | Id of the map in `gameData.maps`. |
| `map` | `width`, `height` and `terrain`, a flat row-major list of terrain ids (`terrain[y * width + x]`). |
| `units` | Every unit, fallen ones included (`alive: false`). Order never changes, except that reinforcements are appended. |
| `turn`, `phase` | Turn number from 1, and whose phase it is: `player`, `enemy` or `ally`. |
| `rng` | The seeded RNG state. Never touch it. |
| `objective` | Copied from the map. See below. |
| `reinforcements` | Waves still to come, already filtered by difficulty. |
| `options` | `difficulty` and `permadeath`. |
| `result` | `ongoing`, `victory` or `defeat`. |
| `started` | False until the battle start events have run (see Scripted events). |
| `flags` | Story flags: the campaign's, copied in at creation, plus whatever events set. Returned to the campaign after a win. |
| `firedEvents` | Ids of the map events that have fired. |
| `recruited` | Ids of units that joined the player team during the battle, in order. |
| `powerLog` | Every power used this battle, in order: `powerId` (the power that took effect; an echo is logged as what it re-cast), `bearerId`, `at` (the bearer's tile), `turn`, and `witnesses` (Echo bearers within their echo range of `at`). Echo reads it. |
| `bladeTiers` | Each blade's tier (1 Dormant, 2 Awakened, 3 Unbound) from the campaign, by blade id. A blade not listed is at tier 1. |

A `Unit` has `id`, `name`, `classId`, `team`, `level`, `xp`, `stats` (max stats, so `stats.hp` is max HP), `hp` (current), `weaponId`, `pos`, `acted`, `alive`, `ai` (null for player units), `isBoss`, `isLord`, `tags` (labels from the map for event triggers), `left`, `resolve` (the Resolve gauge, see Powers) `devourStacks` (kills that count for Devour's attack bonus), `inventory` (weapon and item ids, the equipped weapon among them; see Items) and `statuses` (`{ kind, by, turn }`: `silence` or `pin`, the team that put it on and the turn; see Statuses). A unit an event took off the map has `alive` false and `left` true: every query treats it as gone, but it did not fall, so it is never among the fallen and keeps its HP. Look up class and weapon details in `gameData.classes` and `gameData.weapons`.

Positions are `{ x, y }`, with x the column and y the row, and (0, 0) at the top left. Distances are Manhattan.

## Creating a battle

`createBattle(map, setup, seed, data)` returns a state on turn 1, player phase. `setup` is a `BattleSetup`:

- `difficulty`: `normal`, `hard` or `lunatic`. Enemies get extra levels, a stat multiplier and flat bonuses from `balance.json`. Lunatic also turns enemies set to hold into chargers. Some reinforcement waves only appear on harder difficulties.
- `permadeath`: `classic` or `casual`. It changes nothing during the battle. `battleSummary(state).lostForGood` lists the fallen player units that are gone for good.
- `mc`: `{ name, style }`, where style is `vanguard`, `duelist` or `spiritblade`. Used to build the MC (id `mc`) when the party has no lord.
- `party` (optional): carried-over units. A lord fills the map's MC slot, and the others fill its party slots in order. `partyAfterBattle` (below) builds this list from a finished battle.
- `flags` (optional): the campaign's story flags, copied into `state.flags`.
- `bladeTiers` (optional): each blade's tier, copied into `state.bladeTiers`.
- `enemyLevelShift` (optional, default 0): levels added to every enemy placement and wave (never below 1), for a skirmish scaled to the party (`docs/CAMP.md`). Units an event spawns are not shifted.

A party unit carries its own `inventory`; a unit from a placement carries its weapon and the placement's optional `items`. The new main character carries their starting weapon, or the weapon the map's MC slot gives their style.

Enemy stats are clamped to `balance.statCaps` after difficulty scaling.

`createBattle` throws an `Error` if two units would share an id (party members, map placements, every reinforcement wave and every unit an event can spawn all count), or if a `protect` objective's unit is not a player or ally unit at the start.

`startBattle(state, data)` runs the battle start events and returns `{ state, events }` with `started` true. Call it once before the first action and play its events (an opening scene, say). It does nothing to a battle already started. If it is never called, the first `applyAction` starts the battle and returns the start events ahead of its own, so tests and the simulator need no change.

## Actions

Pass one to `applyAction(state, action, data)`. It returns `{ state, events }` and never changes the input. An illegal action throws `ActionError`. Call `validateAction(state, action, data)` first if you want the reason as a string instead. A malformed action (not an object, an unknown `type`, a missing or non-integer `to`, a missing `unitId` or `targetId`, an unknown unit) gets a reason from `validateAction` and an `ActionError` from `applyAction`, never a `TypeError`.

| Action | Meaning |
| --- | --- |
| `{ type: 'wait', unitId, to }` | Move to `to` (it can be the current tile) and end the unit's turn. |
| `{ type: 'attack', unitId, to, targetId }` | Move to `to`, then fight `targetId`. |
| `{ type: 'heal', unitId, to, targetId }` | Move to `to`, then heal a wounded friend with a staff. |
| `{ type: 'power', unitId, to, targetId? , dir?, powerId? }` | Move to `to`, then fire one of the unit's blade powers (`powerId`, default the blade's first): aimed at `targetId` (Devour, Hush, Cleave, Pin, Echo's fallback, an echoed one) or along `dir` (`up`, `right`, `down`, `left`: Scatter, an echoed Scatter). Exactly one of the two. Uses the unit's action. See Powers. |
| `{ type: 'item', unitId, to, itemIndex }` | Move to `to`, then use the item at `itemIndex` of the unit's inventory on itself: it heals up to its `heal` and adds its `resolve` to a bearer's gauge, and is used up. It must do something (a wounded unit, or a bearer whose gauge is not full). Uses the unit's action. |
| `{ type: 'equip', unitId, itemIndex }` | Equip the weapon at `itemIndex`. Free: no move, and the unit can still act this phase (the next forecast uses the weapon). The class must be able to wield it, and it must not be the weapon already in hand. |
| `{ type: 'talk', unitId, to, targetId }` | Move to `to`, then talk to `targetId`. Legal when the map has a ready talk event from `unitId` to `targetId` and the target stands next to `to`. Uses the unit's action and fires the event. |
| `{ type: 'endPhase' }` | End the current phase. |

The move is part of the action, so the UI keeps the "moved but not yet confirmed" step locally and only calls `applyAction` once the player picks Wait, Attack or Heal. Cancel needs no core call.

## Events

Events come back in order. Play them one after another.

| Event | Fields |
| --- | --- |
| `unitMoved` | `unitId`, `from`, `to`, `path` (every tile, both ends included) |
| `combatStarted` | `attackerId`, `defenderId`, `forecast` |
| `strike` | `attackerId`, `defenderId`, `hit`, `crit`, `damage`, `hpAfter`; `echo: true` on the repeat strike of Echo's fallback |
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
| `talked` | `unitId`, `targetId` (the talk action; events match it) |
| `eventFired` | `eventId` (a map event fired; its effects' events follow) |
| `sceneRequested` | `sceneId`, `eventId`. Play this dialogue scene now. The core does not wait. |
| `unitLeft` | `unitId` (an event took it off the map) |
| `unitTeamChanged` | `unitId`, `from`, `to` (a recruit when `to` is `player`) |
| `aiChanged` | `unitId` |
| `flagSet` | `flag`, `value` |
| `objectiveChanged` | `objective` |
| `weaponChanged` | `unitId`, `weaponId` |
| `unitDamaged` | `unitId`, `amount`, `hpAfter` (an event's damage; a lethal one is followed by `unitDefeated` with `byId` null) |
| `unitLocked` | `unitId`, `locked` |
| `powerUsed` | `summary`: `powerId`, `bladePowerId`, `echoOf`, `fallback`, `bearerId`, `from`, `dir`, `tiles`, `targetIds`, `odds` (the forecast numbers per target), `results` (per target: damage, hit, crit, hpAfter, defeated), `heal` and `stacksAfter`. It comes first; the power's own events follow, then `powerEnded`. |
| `powerEnded` | `powerId`, `bearerId` |
| `resolveChanged` | `unitId`, `amount` (negative when spent), `resolveAfter` |
| `devourStack` | `unitId`, `stacks`, `attackBonus` |
| `itemUsed` | `unitId`, `itemId` (its `unitHealed` with cause `item` and its `resolveChanged` follow) |
| `statusApplied` | `unitId`, `status`, `byId` |
| `statusCleared` | `unitId`, `status` (it wore off as a phase began) |

`unitHealed` has the cause `event` for an event's heal, `power` for Devour's and `item` for an item's. `unitDamaged` has `cause: 'bloodPrice'` for an Awakened blade's price (it comes right after `powerEnded`). `powerUsed`'s summary also carries `statuses` (each status put on a target) and `bloodPrice` (HP the bearer paid).

A power that fights (Devour, Echo's fallback, an echoed Devour) emits the usual `combatStarted`, `strike`s and `combatEnded` between `powerUsed` and `powerEnded`; Scatter emits one `strike` per target and no `combatStarted`.

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
- `forecast(state, attackerId, defenderId, from, data)`: the fight preview. `attacker` and `counter` each give `hp`, `attack`, `damage` per hit, `hit` %, `crit` %, `strikes` (2 means a double) and `triangle` (`advantage`, `disadvantage` or `neutral`). `counter` is null when the defender cannot strike back, and `defenderTriangle` still gives its triangle edge. Resolution uses exactly these numbers. On an invalid pairing (an unknown unit, an attacker with no attack weapon, `from` off the map, or the defender out of range from `from`) it throws `ActionError`, so only call it for ids from `attackTargets`.
- `getUnit`, `unitAt`, `livingUnits`, `terrainAt`, `distance`, `areHostile`.
- `weaponDef(id, data)`: the weapon an inventory id names, with its forge rank applied (`iron_katana+1`: +`balance.weaponRanks.might` might and +`hit` hit per rank, " +1" on the name), or null. Use it instead of `data.weapons[id]` for any id that may be forged. `parseWeaponId`, `rankedWeaponId`, `itemDef`, `isWeaponId`, `classCanWield`, `isBound` (a legendary weapon: it never leaves its bearer) and `inventoryWith` are in `src/core/items.ts`.
- `hasStatus(unit, kind)` and `moveBudget(unit)` (0 while pinned).
- `healAmount(state, healerId, targetId, data)`: HP a staff heal would restore now. `healRange(state, unitId, data)`: every tile a staff user could heal after moving (the green overlay).
- `checkOutcome(state)` and `battleSummary(state)`.
- `objectiveStatus(state)`: `{ type, turnLimit, turnsLeft }`. For `survive` and `protect`, `turnLimit` is the objective's last turn and `turnsLeft` counts the turns still to play, the current one included (so 1 on the last turn, 0 once it has passed). Both are null for other objectives.
- `turnLimitReached(state, turn)`: true if finishing `turn` completes a `survive` or `protect` objective.
- `partyAfterBattle(state)`: `{ survivors, fallen, left, recruited }`. The first three are lists of `PartyUnit`s in unit order, for every player-team unit with its current level, xp, max stats and weapon: living, fallen, and taken off the map by an event. Guests placed on the player team by the map (such as the Stranger) are included, and so are units recruited during the battle; ally-team units are not. `recruited` lists the ids that joined. HP is not carried, since units start each map at full HP. The campaign carries `survivors`, `left` and any fallen units that casual permadeath keeps into the next battle; the chapter data can then drop units (see `docs/STORY.md`).
- `talkTargets(state, unitId, from, data)`: units `unitId` could talk to from a tile (a ready talk event for the pair, the target living next to `from`). `canTalk(state, unitId, targetId, data)`: a ready talk event links the pair, wherever they stand.
- `battleSummary(state)` also gives `flags` (the story flags as the battle leaves them) and `recruited`.

## Powers

The ten blades and their powers are data: `src/data/blades.json` holds `blades` (id, `name`, `number`, `school` (`style` for Widow's Hush), `wielder`, `power`, `tiers`) and `powers` (`name`, `description`, `implemented`, `cost` (null spends the full gauge) and `effect`). Echo, Devour and Scatter are built; the other seven are `implemented: false` with no effect and cannot be used. A weapon is a blade when it has `blade` (a blade id); its holder is a bearer. The Stranger's own copy of Widow's Hush (`widows_hush_stranger`) names no blade on purpose, so the prologue has no gauge and no power: Widow's Hush wakes for the MC after it. The code is `src/core/resolve.ts` (gauge, lookups), `src/core/powers.ts` (plans, targeting, forecast, resolution) and `src/core/clash.ts` (the fight shared by attacks and fighting powers).

Resolve (`balance.resolve`): bearers start a battle (or arrive) at `start` (20) out of `max` (100). Each landed hit gives the striker `dealHit` (15) plus `crit` (10) on a crit and the struck unit `takeHit` (10); a kill gives the killer `kill` (25). Only bearers gain; a unit firing a power gains nothing from that power (others struck by it do). The gauge carries through the battle and clamps at the max. A power spends `cost`, or the full gauge when `cost` is null (all three now).

| Power | Effect (numbers in `blades.json`) |
| --- | --- |
| Devour (Gravemaw) | An attack on a foe in weapon range with `bonusMight` 4 on every strike; counters as usual. Afterwards the bearer heals the damage it dealt (`healPercent` 100) up to `healCap` 15 and its missing HP. Passive: every kill by a Gravemaw bearer, with any attack, adds a Devour stack worth `attackPerKill` 1 attack for the rest of the map, up to `maxStacks` 5 (a kill by an echoed Devour also stacks, on the echoer). |
| Scatter (Thousand Needles) | Pick a direction: every hostile unit within `length` 4 tiles in a straight line from the bearer takes one strike at `damagePercent` 70 of normal damage (hit and crit rolled as usual, crits included). The line passes friends and terrain, stops at the map edge, and no one counters. XP is summed over the targets and capped at `xp.maxPerAction`. |
| Echo (Widow's Hush) | Re-casts the last other power used within `range` 3 tiles of the bearer (it witnessed it, see `powerLog`), from the bearer's tile with the bearer's weapon and stats, aimed the way that power aims. It never echoes its own use or an echo. With nothing to echo, the fallback: an attack on a foe at a distance in `fallback.range` (adjacent), then the bearer's strike rings once more at `fallback.damagePercent` 50 of its damage, rolled at the same hit rate, no crit, no counter. The fallback is a design addition so the MC always has a power; Eric to confirm. Echo always costs its own price. |

Two powers: a blade's tiers (`tiers` in `blades.json`) may each add a `power`; at its tier in `state.bladeTiers` the bearer has the Dormant power and each power its tiers up to that one add (`bearerPowers`, `powerIds(state, unitId)`). Every power query below takes an optional last argument `powerId` (default the first power). Both powers share the gauge, each at its own cost.

| Power (Awakened) | Effect (numbers in `blades.json`) |
| --- | --- |
| Hush (Widow's Hush, `strike`) | One strike at a hostile unit within `range` [1, 1] (its own reach) at `damagePercent` 100, no counter. Then the target is silenced (`status` silence; `onHit` false: hit or miss). |
| Cleave (Gravemaw, `cleave`) | An attack in weapon range with `bonusMight` 2, counters as usual. If the bearer still stands, each other hostile unit next to it takes one strike at `splashPercent` 50 of normal damage, crit 0, no counter, in tile order (up, right, down, left). |
| Pin (Thousand Needles, `strike`) | One strike within [1, 3] at 60 percent, no counter; on a hit (`onHit` true) the target is pinned. |

The blood price: from the tier on that names `bloodPrice` (2 at Awakened), each power the bearer fires costs it that much HP after the power, never below 1 (`bloodPriceOf`). `powerForecast` gives it as `bloodPrice`, along with `status` and `statusOnHit`. For Cleave, `targets` lists the main target and then the splash targets.

Queries: `powerPlan(state, unitId)` (what the power would do now: `powerId`, `bladePowerId`, `name` such as "Echo: Devour", `effect`, `echoOf`, `fallback`, `aim` `unit` or `line`, `cost`, or null for a unit with no built power), `powerBlock` (why it cannot fire at all: no power, no attack weapon, or "Resolve 40/100"), `powerTargets(state, unitId, from)` and `powerDirections(state, unitId, from)` (valid aims from a tile), `canUsePower`, `lineTiles(state, from, dir, length)`, `echoSource`, and `powerForecast(state, unitId, from, aim)`: the plan, the tiles covered, each target's `side` numbers, the whole `combat` forecast for a fighting power, Echo's `echoStrike` and Devour's `healMax`. Resolution rolls exactly these numbers. `forecastWith` is `forecast` with an attack bonus, and `strikeSide` gives one strike's numbers at any distance. `validateAction` explains a bad power action ("Resolve 20/100", "Scatter needs a direction", "No enemy in the line up", "g is not a target of Devour").

`validateGameData` checks blades (school, power, tiers counting up from 1, each tier's power, shards, requirement, stat boost and blood price), powers (cost, effect numbers, statuses), blade weapons (known blade, legendary, not a staff), prices, items, and the Resolve, inventory, forge rank and AI item numbers.

## Statuses

`src/core/status.ts`. Silenced: the unit cannot counter-attack (the forecast's `counter` is null) and cannot fire a power (`powerBlock` says "Silenced"). Pinned: the unit cannot move (`moveBudget` 0, so its move and threat tiles shrink to its own tile); it can still attack from where it stands. A status wears off when the inflicting team's next phase begins after the turn it was put on (a `statusCleared` event), so a player's Hush or Pin lasts through the enemy phase; anything two turns old also goes. A unit already under a status gets the newer one.

## Items

`src/core/items.ts` and `docs/CAMP.md`. An inventory holds weapon ids and item ids (`items.json`), at most `balance.inventory.slots`. A weapon id may carry a forge rank as `+N`. Equipping and using items are the `equip` and `item` actions above; `giveWeapon` events add the weapon to the inventory (replacing the one in hand when every slot is full) and equip it.

## Objectives

`objective.type` is one of these:

- `rout`: defeat every enemy.
- `defeatBoss`: defeat every enemy with `isBoss`.
- `survive` with `turns`: win when the enemy phase of that turn ends.
- `escape` with `tiles`: win when a lord ends its action on one of the tiles.
- `protect` with `unitId` and `turns`: as survive, and losing that unit loses. The unit must be placed by the map on the player or ally team from the start; it cannot arrive in a wave.

For `defeatBoss`, every boss must start on the map: `validateGameData` rejects a boss in a reinforcement wave, since the battle could be won before it arrived.

The battle is always lost if a lord falls or no player units are left.

## Scripted events

A map can list events (`MapData.events`). Each has an `id` (unique on the map), a `trigger`, optional `conditions`, a list of `effects`, and `repeatable` (default false). The definitions are read from `gameData.maps[state.mapId]`; the state only keeps `firedEvents` and `flags`, so a suspended battle resumes exactly. The code is `src/core/events.ts`.

When triggers are checked: once at battle start (`startBattle`), then after every action, against the events that action produced and the state after it. Events are checked in the order the map lists them. An event fires at most once unless it is repeatable. The events its effects produce (a unit falling to a damage effect, say) are checked in a further pass, until nothing new fires. Checking stops as soon as the battle is over. Events fired during an AI phase come back in order inside that AI action's events, and the AI never looks at scenes.

Triggers:

| Trigger | Fires |
| --- | --- |
| `{ type: 'battleStart' }` | At battle start. |
| `{ type: 'flag', flag, value? }` | At battle start, if the flag has that value (default true). |
| `{ type: 'phaseStart', turn, phase? }` | At the start of that phase (default `player`) of that turn. Turn 1's player phase is the battle start. |
| `{ type: 'enter', unitId?, team?, tiles?, area? }` | A unit ends a move on one of the `tiles` or inside `area` (`{ x, y, w, h }`). Matches `unitId`, else any unit of `team`, else any player unit. Staying in place is not entering. |
| `{ type: 'defeated', unitId?, tag?, team?, byId? }` | A unit falls. Each given field narrows it; `byId` is the unit that struck the blow. |
| `{ type: 'hpBelow', unitId, percent }` | The unit is alive with HP below `percent` of its max. |
| `{ type: 'talk', unitId, targetId }` | The talk action from `unitId` to `targetId`. |
| `{ type: 'allDefeated', tag }` | No enemy with the tag is alive or still due in a wave, and at least one has fallen. |

Only enter, defeated and talk events may repeat. Conditions must all hold when the trigger matches, or the event does not fire and stays ready: `{ type: 'flag', flag, value? }` (an unset flag reads as false), `{ type: 'permadeath', mode }`, `{ type: 'difficulty', difficulties }`, `{ type: 'alive', unitId }` and `{ type: 'fallen', unitId }` (fell, not left).

Effects, applied in order:

| Effect | Does |
| --- | --- |
| `{ type: 'scene', sceneId }` | Emits `sceneRequested`. The UI plays the scene before the next event. |
| `{ type: 'spawn', units }` | Units arrive like a wave: a taken tile drops that unit, and only units of the phase in progress wait for their next phase. Emits `reinforcementsArrived`. |
| `{ type: 'remove', unitId }` | The unit leaves the map (`left`), not a death. |
| `{ type: 'setTeam', unitId, team, ai? }` | The unit changes side with its current HP. Joining the player team recruits it: it is listed in `recruited` and joins the party after the battle. A unit leaving the player team gets the `ai` given, or charge. |
| `{ type: 'setAi', unitId, ai }` | New AI for a non-player unit. |
| `{ type: 'setFlag', flag, value }` | Sets a story flag. |
| `{ type: 'objective', objective }` | Replaces the objective. |
| `{ type: 'endBattle', result }` | Ends the battle now. Later effects do not run. |
| `{ type: 'giveWeapon', unitId, weaponId }` | Puts the weapon in the unit's hand. |
| `{ type: 'heal', unitId, amount }`, `{ type: 'damage', unitId, amount, lethal? }` | Damage leaves at least 1 HP unless `lethal`. |
| `{ type: 'lock', unitId }`, `{ type: 'unlock', unitId }` | Lock: the unit counts as having acted, so it cannot act this turn (an enemy locked in the player phase skips the enemy phase). Unlock lets it act again this phase. |

`validateGameData(data, story?)` checks every event: unique ids, known unit ids (placements, waves, spawns and `mc`), tags that some unit carries, tiles and areas on the map, flag names, weapons, objectives, the repeat rule, and, when `story.sceneIds` is given, the scene ids. `src/story/validate.ts` also checks that each scene an event plays is marked as a mid-battle scene.

## Turn order

Player phase, then enemy phase, then an ally phase if any allies are alive, then the next turn. Each phase starts with fort healing for that team. Reinforcements for a turn arrive at the start of its enemy phase, and each acts in its team's next phase: enemy units in the next turn's enemy phase, ally units in this turn's ally phase, and player units in the next player phase. If a reinforcement's tile is taken, that unit does not arrive.

## Enemy AI

`planAiAction(state, data)` returns the next action of the current AI phase, `endPhase` when every unit of that team has acted, or null during the player phase or after the battle. No behavior ever attacks for zero expected damage (hit 0 or damage 0). Behaviors: `charge` attacks the best target it can reach, or else walks toward the nearest hostile it can hurt (if it can hurt nobody, toward the nearest hostile lord, without attacking); "nearest" is the true movement cost to reach a tile beside the target, `hold` waits until a hostile is in reach or it gets attacked and then charges for the rest of the battle, and `guard` only acts from tiles within its radius of its guard tile. Bosses guard their own tile with radius 0 unless the map says otherwise. Staff users heal the most wounded friend they can reach. An enemy or ally bearer whose power is ready scores every use of each of its powers from the tiles its behavior allows (a fight like an attack plus Devour's expected heal, Echo's repeat strike and Cleave's splash; Scatter, Hush and Pin as the sum over their targets; plus `balance.ai.statusValue` for each status weighted by its chance to land, minus the blood price) and fires the best when it scores at least `balance.resolve.aiMargin` (2) above its best attack. Before anything else, an enemy or ally below `balance.ai.itemBelowPercent` of its max HP drinks the first healing item it carries where it stands. Player units planned by the simulator never fire powers or use items. The AI is deterministic.

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

`gameData` (from `src/data/index.ts`) bundles `balance.json`, `terrain.json`, `classes.json`, `weapons.json`, `items.json`, `blades.json` and the maps (`prologue`; `skirmish_ridge`, the first side skirmish; and `skirmish_test`, a 14 by 18 map only the quick battle URL reaches), each with its events from `<id>.events.json`. The camp's content (`economy.json`, `skirmishes.json`) is `campContent`, beside it. Every balance number is in `balance.json`, including the hit roll mode (`1rn` or `2rn`). Terrain move costs are given per movement type, so new movement types only need new keys. A weapon with `heal` above 0 is a staff: it heals and never attacks or counters. `validateGameData(gameData)` checks every cross reference, that the balance divisors (`combat.hitLckDiv`, `combat.critSklDiv`, `xp.hitDiv`, `xp.perLevel`) are above 0, and the objective rules above. A unit test runs it, and another checks that every foot-passable tile on every map can be reached from the MC slot.

### Terrain

| Id | Foot cost | Avoid | Def | Res | Heal | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| plain, road | 1 | 0 | 0 | 0 | 0 | Road is drawn differently but plays as plain. |
| forest | 2 | 20 | 1 | 0 | 0 | |
| hill | 3 | 30 | 2 | 0 | 0 | |
| fort | 2 | 20 | 2 | 2 | 20% | Heals at the start of its team's phase. |
| village | 1 | 10 | 0 | 0 | 0 | |
| water, wall | impassable | | | | | |
| bridge | 1 | 0 | 0 | 0 | 0 | A way over water. |
| ford | 2 | -10 | 0 | 0 | 0 | Shallow water: slow to wade, and a unit standing in it is easier to hit. |

The numbers live in `terrain.json`; this table is a summary. `tests/crossings.test.ts` checks the bridge and ford.

### Map files

A map in `src/data/maps/<id>.json` has `id`, `name`, `width`, `height`, `tiles` (one string per row) with a `legend` from tile character to terrain id, `placements`, `objective`, `reinforcements`, and an optional `props` list of `{ id, x, y }`. A unit placement may carry `tags` and `items` (item ids it carries besides its weapon). The MC slot may carry `weapons` (by combat style) for an MC the battle creates. A map may name a `backdrop` for its battle scenes. The map's events live beside it in `src/data/maps/<id>.events.json` (a list of events), which `src/data/index.ts` merges in as `events`. Props are decorative: the rules ignore them. `validateGameData` only checks that each prop has a plain id, sits on the map and does not share a tile with another prop; which prop suits which terrain, and that no tall prop stands on a unit's start tile, is checked by `checkProps` in `tools/maps/tiled.ts` (used by the Tiled import and by `tests/maps-tiled.test.ts`) against `src/data/props.json`. Maps are drawn in Tiled and imported with `npm run maps`; see `docs/MAPS.md`.

## Errors

`ActionError` (exported from the core index) is thrown by `applyAction` for an illegal or malformed action and by `forecast` for an invalid pairing. `createBattle` throws a plain `Error` for bad map or party data (unknown class, duplicate ids, a missing protect target).

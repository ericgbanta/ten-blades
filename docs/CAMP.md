# Camp

The camp is the hub between chapters: the forge, the merchant, the barracks and the war map, plus campfire talk. This page covers the economy, items, the forge and sword awakening, the merchant, the barracks and deployment, the war map and side skirmishes, and the data files that tune all of it. The rules are pure TypeScript in `src/camp` (tested in `tests/camp.test.ts`), the core's part (items, statuses, Awakened powers) is in `src/core` (`tests/items.test.ts`, `tests/awakened.test.ts`), and the screens are in `src/ui/camp`.

Numbers marked "to confirm" are first guesses for Eric.

## Files

| Path | What it holds |
| --- | --- |
| `src/data/items.json` | The consumables: name, description, price, `heal` and `resolve`. |
| `src/data/weapons.json` | Weapons, now with a `price` (legendary blades have none). |
| `src/data/balance.json` | `inventory.slots` (5), `weaponRanks` (forge ranks: `max` 2, `might` 1 and `hit` 5 per rank), `ai.itemBelowPercent` (35) and `ai.statusValue` (6). |
| `src/data/economy.json` | `sellPercent` (50), `upgradeCosts` (gold per forge rank), `convoyMax` (100), `rewards` per story map, `shops` per chapter. |
| `src/data/skirmishes.json` | The side skirmishes: map, blurb, rewards, scaling, deploy rule, lore scene. |
| `src/data/blades.json` | Each blade's tiers: the power a tier adds, its shards, its requirement, the bearer's stat boost and the blood price. The Awakened powers. |
| `src/data/chapters.json` | Per chapter: `act`, `campAfter` (unlocks, campfire talk, backdrop), `skirmishes` (ids and cap), `deploy` and `plotCritical`. See `docs/STORY.md`. |
| `src/camp/ctx.ts` | What the camp rules read (game data, chapters, camp content) and the story position helpers (act, chapter reached, requirements). |
| `src/camp/rewards.ts` | The pay for a won map and adding it to the save. |
| `src/camp/shop.ts` | Stock, prices, buying and selling. |
| `src/camp/forge.ts` | Awakening and weapon upgrades. |
| `src/camp/barracks.ts` | Inventories and the convoy, equipping, the roster order, the bench, wounded units and deployment, skirmish scaling. |
| `src/camp/camp.ts` | Facility unlocks, campfire talk, the war map route and skirmish list, leaving camp. |

Every camp rule takes the campaign save and returns a new one, or a plain reason it was refused (`Result`). Nothing changes in place. The UI saves each accepted change to the slot at once.

## Economy

The campaign save has `gold` and `shards` (Blade Shards). They come from won maps:

- A story map pays `economy.rewards[<map id>]`: `gold`, `shards`, and each bonus objective met. A skirmish pays its own `rewards` (`skirmishes.json`).
- Bonus objectives are listed per map as `bonus`: `{ id, text, kind, gold, shards }` with `kind` `turns` (won by that turn, `turns` given), `noLoss` (no player unit fell) or `flag` (a story flag set, `flag` given). `text` is what the end screen shows.
- Drops are `drops: [{ unitId, item }]`: when that enemy has fallen in a won battle, the item goes to the convoy (while it has room).
- `battleRewards(state, def)` works the pay out from the final battle state; the end screen shows it under Spoils and the save applies the same numbers (`completeChapter` and `completeSkirmish` in `src/save/campaign.ts`). A lost battle pays nothing.

Current numbers (to confirm):

| Map | Pays | Bonuses | Drops |
| --- | --- | --- | --- |
| Prologue | 500 gold, 1 shard | Win by turn 5: 200 gold. Lose no one: 1 shard. | Legion Sergeant: Healing Salve |
| Chapter 1 | 600 gold, 1 shard | Escape by turn 6: 200 gold. Lose no one: 1 shard. | Hunt Sergeant: Healing Salve |
| Chapter 2 | 700 gold, 1 shard | Win the deserter over (`garrow_joined`): 1 shard. Win by turn 9: 200 gold. | Legion Sergeant: Healing Salve |
| Chapter 3 | 900 gold, 1 shard | Win by turn 8: 200 gold. Lose no one: 1 shard. | Hunter-Captain: Mender's Tonic |
| Ashfall Ridge | 300 gold, 1 shard | Win by turn 6: 100 gold. | Deserter Sergeant: Healing Salve |

By the camp after Chapter 2, where the forge opens, a player has 3 to 6 shards from the story maps alone, enough for the first awakening.

## Items and inventories

Each unit carries an inventory of up to `balance.inventory.slots` entries (5): weapon ids and item ids. The equipped weapon (`weaponId`) is one of them. A forged weapon is written `<id>+<rank>`, such as `iron_katana+1`; `weaponDef` in `src/core/items.ts` applies the rank (`balance.weaponRanks`) and names it "Iron Katana +1". Weapons do not break.

Items (`items.json`, to confirm):

| Item | Does | Price |
| --- | --- | --- |
| Healing Salve | Restores 10 HP. | 150 |
| Mender's Tonic | Restores 20 HP. | 350 |
| Grave Wine | Adds 30 Resolve to a bearer's gauge. | 500 |

In battle, the action menu shows Items when the unit carries an item or a second weapon:

- Use: the item action, `{ type: 'item', unitId, to, itemIndex }`. The unit moves, uses the item on itself (it must do something: heal a wounded unit, or fill a bearer's gauge that is not full) and its turn ends. The item is used up.
- Equip: the equip action, `{ type: 'equip', unitId, itemIndex }`. Free: the unit does not move and can still act, so the forecast that follows uses the new weapon. The class must be able to wield it.

An enemy or ally below `ai.itemBelowPercent` (35) of its max HP drinks the first healing item it carries, where it stands, before anything else. The Ashfall Ridge sergeant carries a salve.

The convoy (`convoy` in the save) holds what no one carries, up to `convoyMax` (100). Trading between units is not in this build: gear goes through the convoy.

A blade binds to its bearer: a legendary weapon never leaves the inventory it is in, cannot be sold, and cannot be forged with gold.

## Forge

### Sword awakening

Each blade has three tiers in `blades.json`: Dormant (tier 1, its first power), Awakened (tier 2) and Unbound (tier 3). The campaign records each blade's tier (`blades` in the save); the battle gets the tiers through the setup (`bladeTiers` in the battle state).

A tier lists:

| Field | Meaning |
| --- | --- |
| `power` | The power the tier adds. The bearer then has two powers, picked in the Power menu; both share the Resolve gauge, each at its own `cost`. |
| `shards` | Blade Shards it costs. A tier without `shards` and `requires` is not designed yet and cannot be reached. |
| `requires` | `{ chapter?, act?, flags?, text }`: the chapter reached (current or completed), the act reached, story flags, and the condition in plain words. |
| `statBoost` | Added once to the bearer's stats when the blade reaches the tier, clamped to the stat caps. |
| `bloodPrice` | The cost of power, below. |

`awaken(c, bladeId, ctx)` spends the shards, raises the tier and adds the stat boost to the bearer (the party unit carrying the blade). Reaching the last tier adds one to the story flag `unbound_blades`, the hook for endings; `unboundCount` gives the same count from the tiers. The forge shows each blade with its tier, powers, what the next tier grants, its shards and its condition (met or not), and later tiers as locked lines.

An Awakened bearer glows: a breathing pale ring on the portrait medallion (steady under reduced motion), a pale ring on the map token's base, and a cold glow along each strike in the battle scene. No new art.

Current tiers (to confirm):

| Blade | Tier 2 needs | Tier 2 gives | Tier 3 needs |
| --- | --- | --- | --- |
| Widow's Hush | 3 shards, reach Chapter 3 | Hush; +2 Skl, +1 Spd, +1 Lck; blood price 2 | 8 shards, reach Act 3 |
| Gravemaw | 3 shards, reach Chapter 3 | Cleave; +2 Str, +1 Def; blood price 2 | 8 shards, reach Act 3 |
| Thousand Needles | 3 shards, reach Chapter 3 | Pin; +2 Spd, +1 Skl; blood price 2 | 8 shards, reach Act 3 |

The design puts the first awakening in Chapter 3. Reaching a chapter counts from the camp before it, so all three blades can awaken in the camp after Chapter 2, where the forge first opens. Tier 3 has no ultimate power yet (blood price 4); Act 3 is not reachable in this build.

### The Awakened powers

These are proposals for Eric. The numbers live in `blades.json` under `powers`.

| Power | Blade | Cost | Effect |
| --- | --- | --- | --- |
| Hush | Widow's Hush | 50 | Strike one adjacent foe (range 1) at full damage; it cannot counter. Hit or miss, the foe is silenced until your next turn: no counters, no powers. |
| Cleave | Gravemaw | 60 | An attack on a foe in weapon range with +2 might (counters as usual). If the bearer still stands, every other foe beside it takes one strike at 50 percent damage, no crit, no counter. |
| Pin | Thousand Needles | 40 | A needle at a foe 1 to 3 tiles away at 60 percent damage, no counter. On a hit, the foe is pinned until your next turn: it cannot move, though it can still strike from where it stands. |

They are two new effect types in the core: `strike` (one uncounterable strike at its own range, with an optional status always or on a hit; Hush and Pin) and `cleave`. Statuses are kept on the unit (`statuses`) and wear off when the inflicting team's next phase begins after the turn they were put on (`src/core/status.ts`). Echo can echo all three. The AI scores each power a bearer has and adds `ai.statusValue` for each status it expects to land.

### The price of power

"Power has a cost, which keeps the curse in the gameplay": from the Awakened tier on, every power the bearer fires, the Dormant one included, costs it `bloodPrice` HP (2 at tier 2, 4 at tier 3), taken after the power resolves and never below 1 HP. The power forecast says so ("The blade's price: Ash loses 2 HP."), the map shows the loss, and the AI weighs it. It is felt on every use but cannot kill. To confirm with Eric.

### Weapon upgrades

Gold raises a generic weapon one rank at a time, up to `weaponRanks.max` (2): +1 might and +5 hit per rank, for `upgradeCosts` gold (300 for rank 1, 600 for rank 2; to confirm). The weapon keeps its slot and stays equipped. Legendary blades answer to shards, not gold.

## Merchant

The stock is `economy.shops[<current chapter id>]`, else `shops.default`. The merchant first opens in the camp before Chapter 3, whose stock is the iron weapons, the bow, the two tomes, the staffs and the three items; the default adds the javelin and the greatsword: weapons and items. Buying puts the entry in the chosen unit's inventory or the convoy; it is refused without the gold or the room. Each row shows who in the company can wield the weapon (a ring per unit, green when the class can use it), and the open row compares the weapon with the chosen unit's equipped one (Mt, Hit, Crit, Rng). Selling pays `sellPercent` (50) of the price, forge ranks included (the price of a forged weapon counts its upgrade costs). Blades cannot be sold, and neither can the weapon in a unit's hand.

Class change seals are not sold: classes do not promote in the first build (`docs/PLAN.md`).

Weapon prices (to confirm): Woodcutter's Axe 300, Iron Dagger 350, Hunting Knife 400, Iron Lance 450, Iron Axe 500, Short Bow 500, Mending Rod 500, Ember Tome 550, Spirit Staff 550, Javelin 600, Warding Talisman 600, Iron Katana 650, Iron Greatsword 700.

## Barracks and deployment

The barracks lists the company in roster order. The order is the order units take a map's party slots in; the main character always takes the main character's slot. Each unit's sheet shows its class, level, XP, stats, the stats it grows best in, its blade with tier and powers, its inventory (equip, or store in the convoy) and the convoy (take). A unit can be kept in camp (benched) from its sheet or the deploy step.

Deployment (`deployInfo`) reads the map's rule: `deploy: { max, required }` on the chapter (`chapters.json`) or the skirmish (`skirmishes.json`). `max` counts the main character and defaults to the map's slots. The main character always deploys, then required units, then the rest in roster order until the map is full. Benched units and wounded units stay in camp. Units that stay in camp keep everything as it was; after a battle, the ones that fought come back as the battle left them.

### Wounded bearers and the fallen

Classic: fallen units are lost for good (`fallen` in the save), and the barracks lists them under The fallen. The exception is the design's rule for bearers the plot still needs: a unit named in the current chapter's `plotCritical` list that falls in a won battle retreats badly wounded instead. It stays in the party, marked wounded with the act it fell in (`wounded` in the save), shows a Wounded tag and cannot deploy until the story moves on to a new act. Casual: every fallen unit comes back after the map, and nothing is wounded.

## War map and side skirmishes

The war map is a vertical route of the chapters: those done, the next one (March, or "Coming soon" while its map does not exist), and those ahead. Beside the next chapter are its side skirmishes (`chapters.json` `skirmishes.ids`), each with its blurb, pay, bonus and "N of M left this chapter".

- The cap: `skirmishes.cap` wins per chapter (3 now). Wins are counted in `skirmishWins` by the chapter they were won in, so the count starts over when the story moves on. A lost skirmish does not count.
- Scaling: enemy levels move by `clamp(average level of the deployed units + offset, min, max) - baseLevel` (`scalingShift`), applied to every enemy placement and wave when the battle is made (`enemyLevelShift` in the battle setup). Ashfall Ridge has base level 1 and offset -1, so its foes sit about a level under the party (to confirm).
- A skirmish's lore scene plays before its first attempt and sets `read_<scene>`.
- A won skirmish pays out, counts its win, keeps the party in camp and returns there. The map's own guests (the two wardens) fight but do not join.

Ashfall Ridge (`skirmish_ridge`, 11 by 11, forest backdrop): five enemies (a hunter, a legionary, an inquisitor guarding near the fort, an archer holding a hill, and their sergeant guarding the fort with a salve), two Ridge wardens on your side, three party slots, rout. Carries the lore scene `skirmish_ridge_lore`. `npm run sim` plays it for a lone main character at levels 2 and 4 after the prologue table, and the three chapters after it (see `docs/PLAN.md`) (about 88, 65 and 33 percent wins on Normal, Hard and Lunatic at level 2 under the simulator's reckless charge AI).

## Camp flow

A chapter with `campAfter` sends the army to camp before the next chapter: the save's `progress.stage` is `camp`, and Continue and Load land there. Entering camp saves the slot, and so does every change made in it (the hub also has a Save button). The war map's March leaves camp (`leaveCamp`): the chapter's intro begins, then its battle. A skirmish starts from its deploy step and comes back to camp.

Facilities open when a finished chapter's camp lists them in `campAfter.unlocks`; until then their plate is locked and says when it opens ("Opens after Chapter 2"). The prologue's camp opens the barracks and the war map; the camp after Chapter 2 opens the merchant and the forge, as the design has it. Chapter 1 has no camp after it (its outro leads straight into Chapter 2), and the camp after Chapter 3 opens nothing new.

Deploy rules: Chapter 1's map has only the main character's slot (Hask and Lise are on the map already), Chapter 2 takes 5 and Chapter 3 takes 6. Chapters 2 and 3 name Garrow (and Chapter 3 Pell) as plot critical.

## Tuning

- Prices: `price` in `weapons.json` and `items.json`; the sell share and forge costs in `economy.json`.
- Pay: `economy.json` `rewards` per map, `skirmishes.json` `rewards` per skirmish.
- Stock: `economy.json` `shops`, per chapter id with a `default`.
- Awakening: each tier in `blades.json`; the Awakened powers under `powers`.
- Skirmishes: the cap per chapter in `chapters.json`, the scaling and deploy rule in `skirmishes.json`.
- Inventory slots, forge rank numbers and the AI's item threshold: `balance.json`.

`validateGameData` checks prices, items, tiers (powers, shards, requirements, stat boosts, blood prices) and the new power effects; `tests/story.test.ts` and `tests/data.test.ts` run it on the shipped data.

## Test hook

With `test=1` in the URL, `window.__camp` offers `campaign()`, `grant(gold, shards)`, `setFlag(flag, value)`, `lock(facilities)` (show facilities as locked, display only) and `saved()`. `e2e/camp.spec.ts` uses it with a prepared save to reach every screen (the first test moves the fixture to the camp after Chapter 2, where every facility is open); with `SHOTS=<dir>` it also saves screenshots there.

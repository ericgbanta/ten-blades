# Saves

How Ten Blades keeps progress: the save shape, the versioning rule, the storage API, the suspend save and save codes. The code is in `src/save`. The modules that define and check the shape (`format.ts`, `shape.ts`, `validate.ts`, `migrate.ts`, `load.ts`, `campaign.ts`, `queue.ts`) are pure: lint keeps them free of the DOM, storage, the clock and `Math.random`, as it does for `src/core`. Times and seeds come in from the UI.

## Modules

| Path | What it does |
| --- | --- |
| `src/save/format.ts` | The save types, `SAVE_VERSION`, slot ids, enums and the `Result` type. |
| `src/save/validate.ts` | Strict runtime checks for a campaign save, a suspend save and a battle state. |
| `src/save/migrate.ts` | The migration pipeline and the `MIGRATIONS` table. |
| `src/save/load.ts` | `readCampaign` and `readSuspend`: migrate, then validate. |
| `src/save/campaign.ts` | New campaign, battle setup for the next map (the deployment and the blades' tiers), permadeath with wounded bearers, a won chapter battle (rewards, on to the outro) or skirmish (rewards, the win counted), building a suspend save. |
| `src/story/flow.ts` | The chapter flow over the campaign's progress: intro scenes, battle, outro scenes, the chapter's after rules, the next chapter. See `docs/STORY.md`. |
| `src/save/battleSaver.ts` | Turns the battle controller's checkpoints into save writes for one attempt at a map. |
| `src/save/queue.ts` | `SaveQueue`: runs writes one at a time in the background and coalesces suspend writes. |
| `src/save/storage.ts` | The `SaveStorage` interface, the in-memory backend and `openSaveStorage`. |
| `src/save/idb.ts` | The IndexedDB backend. |
| `src/save/code.ts` | Save codes for export and import. |
| `src/save/prefs.ts` | Small UI preferences in `localStorage` (animation speed). Not part of any save. |
| `src/data/chapters.json` | The campaign script: chapters, their scenes, maps and after rules (`docs/STORY.md`). |
| `src/ui/saves.ts` | The app's storage instance, write queue, the campaign run the battle route plays and the camp session (the campaign the camp screens show, saved on every change). |
| `src/camp/*` | The camp's rules over the campaign save (`docs/CAMP.md`). |

## Campaign save

One JSON object per slot.

| Field | Meaning |
| --- | --- |
| `version` | The save version, 5 now. |
| `kind` | Always `campaign`. |
| `createdAt`, `updatedAt` | Epoch milliseconds, passed in by the UI. `updatedAt` is the "last played" time on the load screen. It changes when the campaign is written: at new game and after each won chapter. |
| `settings` | `difficulty` (`normal`, `hard`, `lunatic`) and `permadeath` (`classic`, `casual`), chosen at new game and fixed after. |
| `mc` | `name` (1 to 16 characters, any script, no control characters), `pronouns` (`he`, `she`, `they`), `style` (`vanguard`, `duelist`, `spiritblade`) and `look`. |
| `mc.look` | The creator's choices: `body`, `skin`, `hairStyle`, `hairColor`, `eyes`, `scar` (or `none`) and `accent`, each an id from `src/data/looks.json`. Added in version 2. |
| `party` | `PartyUnit[]`, the company in roster order (the order units take a map's party slots). Empty before the prologue, when the MC is built from `mc`. When not empty it holds exactly one lord (the MC). Each unit has an `inventory` (version 5): weapon and item ids, at most `balance.inventory.slots`, holding its `weaponId`. |
| `fallen` | `PartyUnit[]` lost for good in Classic mode. Never the MC. |
| `progress` | `current`: the chapter being played (in camp: the next one), or null once the story so far is finished. `completed`: chapter ids finished (outro played), in order. `stage`: `camp` (version 5), `intro`, `battle` or `outro` (version 3). `scenes`: the scenes of this stage still to play, the first being the one in progress, or null until the stage begins and the chapter data picks them (version 3). |
| `flags` | Story flags: a record of string keys to `true`/`false`, numbers or text. Set by scene choices and by map events (a won battle hands its flags back). An unset flag reads as false. |
| `gold`, `shards` | Gold and Blade Shards, earned on won maps and spent in camp. |
| `blades` | The legendary blades the party has held, by blade id (`src/data/blades.json`), each `{ tier }`: 1 Dormant, 2 Awakened, 3 Unbound (the forge raises it). A blade goes on record when a party member holds it after a chapter's after rules (`withBlades` in `campaign.ts`, called by the flow), and keeps its tier. Version 4. |
| `convoy` | Weapon and item ids no one carries (version 5). |
| `benched` | Party unit ids kept in camp for the next deployment (version 5). |
| `wounded` | Unit id to the act it fell in, for plot-critical bearers who retreated wounded in Classic (version 5). They cannot deploy during that act; the flow drops the entries when a new act begins. |
| `skirmishWins` | Side skirmishes won, by the chapter they were won in, for the per-chapter cap (version 5). |

The number of Unbound blades is kept as the story flag `unbound_blades` (and can be counted from `blades`), so chapter conditions can read it.

## Suspend save

There is one suspend slot. It holds the battle in progress, written whenever the battle is at rest.

| Field | Meaning |
| --- | --- |
| `version`, `kind` | `kind` is `suspend`. |
| `savedAt` | Epoch milliseconds. |
| `slot` | The campaign slot (1, 2 or 3) the battle belongs to. |
| `campaign` | The full campaign save as it was when the map started. A victory is applied to this. |
| `mapId` | The map being played. Must match `battle.mapId`. |
| `battle` | The whole `BattleState`, RNG state included. Its options must match `campaign.settings`. |
| `controller` | Small controller state a resume keeps: `showDanger`, and `scenes`, the mid-battle scenes from the last player action (or the battle start) that had not finished playing (version 3). The selection is never kept. |
| `skirmish` | The side skirmish being played (an id in `skirmishes.json`), or null for the chapter's story map (version 5). A resumed skirmish is completed as a skirmish and returns to camp. |

## Validation

`validateCampaign`, `validateSuspend` and `validateBattleState` return `{ ok: true, value }` with a typed save, or `{ ok: false, error }` with a readable path and problem, such as `party[0].classId: unknown class "dragon"`. They check:

- The shape: every field present, no unknown fields, the right types, whole numbers in range.
- Ids against game data: classes, weapons, maps, terrain and chapter ids, every field of `mc.look` against `src/data/looks.json` (`lookProblem` in `src/art/mc/look.ts`), fired event ids against the map's events, recruits against the battle's units, and scene ids against the dialogue scenes when the context lists them (`SaveContext.sceneIds`; the app always passes them).
- Invariants: unit ids unique, at most one lord and none among the fallen, the current chapter not already completed, a living unit with HP from 1 to its max and a fallen one at 0, positions on the map, enemy and ally units with an AI, the battle's map size matching the map data, blade ids and tiers against `blades.json` (in the campaign and in `bladeTiers`), a gauge from 0 to `balance.resolve.max`, power log entries naming known powers, units and tiles, inventories (known weapons at a valid forge rank or items, no more than the slots, the equipped weapon in it), convoy entries, statuses, bench and wounded ids in the party, skirmish counts by known chapters, and a suspended skirmish against the skirmish ids when the context lists them (`SaveContext.skirmishIds`; the app always passes them).

`readCampaign` and `readSuspend` run `migrate` first and wrap any error in a plain sentence for the player. Storage also validates every save before writing it, so a bad object never reaches the disk.

## Versioning rule

`SAVE_VERSION` in `format.ts` is the version every save is written at. Any change to the shape of a campaign or suspend save, including the `BattleState` inside a suspend save, needs all of these:

1. Bump `SAVE_VERSION`.
2. Add a step to `MIGRATIONS` in `migrate.ts`, keyed by the old version, that turns a save of the old version into the new one. A step must handle both kinds, and for a suspend save also its nested `campaign`.
3. Update the validator for the new shape.
4. Keep `tests/fixtures/save-v1.json` (and every later fixture) as it is, add a fixture of the version you are leaving if there is none yet, and add a test that loads each old fixture through `readCampaign` and checks the result.

`migrate(raw)` checks that the object has a whole-number version, refuses versions newer than the game knows, then runs the steps one at a time and checks that each step lands on the next version. It never changes its input.

Steps so far:

| From | To | Change |
| --- | --- | --- |
| 1 | 2 | `mc.look` added. Version 1 saves predate the creator, so they get the default look from `looks.json`. A suspend save gets it in its nested `campaign`; the battle state is untouched. |
| 2 | 3 | The story layer. `progress` gets `stage` and `scenes`: a campaign that had finished the story so far (current null) goes back to the outro of the last chapter it won, so the outro plays and its party changes apply (the Stranger leaves, the MC gets the Widow's Hush); any other campaign starts its chapter at the intro; scenes are null, picked when the stage begins. A suspend save's campaign is in its battle (`stage` battle, no scenes) and its controller owes no scenes. The battle state goes to version 2: `started` true, no flags, fired events or recruits, every unit with no tags and not left. A battle suspended before the update therefore plays on without the events that would have fired before its turn. |
| 3 | 4 | Blade powers. The campaign gets `blades`: every blade a party member holds, at tier 1. A suspended battle state goes to version 3: `powerLog` empty, every unit `devourStacks` 0 and `resolve` at `balance.resolve.start` when it holds a blade, else 0. The step reads the shipped `weapons.json` and `balance.json` for that. |
| 4 | 5 | Camp. Every party and fallen unit gets an `inventory` holding its weapon; the campaign gets an empty `convoy`, `benched`, `wounded` and `skirmishWins`. A campaign between chapters (stage `intro` with scenes null, a chapter completed, a current chapter) goes to stage `camp`. A suspend save gets `skirmish` null; its battle state goes to version 4: every unit's `inventory` holds its weapon, `statuses` is empty, and `bladeTiers` comes from the campaign's blades. |

`tests/save-migrate.test.ts` loads `tests/fixtures/save-v1.json`, `suspend-v1.json`, `save-v2.json` and `suspend-v2.json` through `readCampaign` and `readSuspend` and checks each step's changes, loads `save-v3.json` and `suspend-v3.json` and checks step 3 (blades on record, gauges and an empty power log), loads `save-v4.json` and `suspend-v4.json` and checks step 4 (inventories, the empty camp fields, camp between chapters, the battle's inventories, statuses and tiers, and that the migrated battle plays on), loads `tests/fixtures/save-v5.json` as it is, checks that no step changes its input, and runs a pretend chain to prove the pipeline. The checks for steps 1 to 3 read through to version 4 by taking step 4's additions off again, so they keep checking what they were written for. `tests/save-code.test.ts` also imports a save code made from a version 1 save.

## Storage

`SaveStorage` (in `storage.ts`) is a small promise API:

| Method | Does |
| --- | --- |
| `listSlots()` | All three slots: `{ slot, save, error }`. A slot holding something unreadable has `save: null` and the error. |
| `loadSlot(slot)` | `ok(null)` for an empty slot, the save, or an error. |
| `saveSlot(slot, save)` | Validates, then writes. |
| `deleteSlot(slot)` | Removes the slot. |
| `loadSuspend()`, `saveSuspend(save)`, `clearSuspend()` | The same for the suspend slot. |
| `persistent` | False when saves only last until the tab closes. |

It sits on a `KeyValueBackend` with keys `slot1`, `slot2`, `slot3` and `suspend`. `openSaveStorage` opens IndexedDB (database `ten-blades`, store `saves`). If IndexedDB is missing or will not open within a few seconds (private browsing in some browsers), it falls back to the in-memory backend, and Settings shows a notice that saves last only until the tab closes. Unit tests use the in-memory backend; the e2e tests cover the IndexedDB path, including a page reload.

The IndexedDB connection closes itself when another tab or a test deletes or upgrades the database, and reopens on the next read or write.

## Suspend and resume

The battle controller calls `onCheckpoint(state, extra)` with every state the battle can be resumed from:

- when the battle starts or resumes (a new battle right after its start events, with the opening scenes owed),
- right after each player action is applied, before its animations play, with that action's scenes owed,
- after each owed scene has played, with it crossed off,
- when playback comes to rest: the player has a choice again, or the battle is over.

Mid-battle scenes never change the battle state (they have no choices), so suspending inside one is safe. A resume plays the scenes the save still owes from their first line, then goes on. Scenes fired by the enemy phase are not owed: the resume replays that phase from the last checkpoint, and the scene with it. Either way a scene can play again after a reload, but nothing is applied twice.

The enemy and ally phases are not saved step by step. A checkpoint taken just after a player's action can be in the middle of a turn (for example right after End turn). `start()` on such a state plays the automatic actions on to the next rest: it is the same code path as live play, the AI is deterministic and the RNG state is in the battle state, so a resume replays the enemy phase exactly. This was simpler than saving after every AI action and needs no extra state.

`BattleSaver` turns checkpoints into writes through a `SaveQueue`. Writes run in the background, one at a time, so animations never wait for storage. A suspend write that is still waiting is replaced by a newer one, so a quick run of checkpoints becomes a single write. Write errors are logged and the queue keeps going.

When the battle ends, `BattleSaver` writes the final state to the suspend slot first, then:

- on victory, applies the result to the campaign (`completeChapter`: party, permadeath, flags, rewards, on to the outro; or, for a skirmish, `completeSkirmish`: party, permadeath, flags, rewards, the win counted, still in camp) and writes it to its slot, then clears the suspend save;
- on defeat, clears the suspend save and leaves the slot as it was.

If the tab closes between those writes, the suspend slot holds a finished battle; Continue shows its end screen and finishes the same writes.

Why a reload cannot reroll: the RNG state is part of `BattleState`, and the state after an action, outcome included, is queued for saving before the first animation frame of that action. Reloading gives back either that state (the outcome stands) or, if the write had not finished, the state before the action with the same RNG state, where the same action gives the same result. The tests in `tests/suspend.test.ts` check both, and that a run suspended and resumed at several points matches an uninterrupted run with the same seed, state for state and event for event. Retry after a defeat and Load game restart the map with a new seed; that is a deliberate restart of the whole map, not a reroll of one action.

The battle route takes its run once (`takeRun`), so going back to it in the browser history cannot replay a stale resume. Starting a new game or loading a slot while a battle is suspended asks first, since it ends that battle.

## Story position

Between battles the campaign save is the only record. In camp, entering saves the slot and so does every change made there (a purchase, an awakening, the bench). The story route writes the slot each time a scene finishes: the scene leaves the head of `progress.scenes`, and the flags its choices set are merged in, in one write. Closing the tab during a scene therefore replays that scene from its first line, with its choices still to make. When the last outro scene finishes, the chapter's after rules apply and the next chapter begins, in the same write. See `docs/STORY.md`.

## Save codes

`encodeSaveCode(save)` turns a campaign save into text: the JSON as UTF-8, gzipped with `CompressionStream` when the browser has it, then base64. Codes start with `TB1.z.` (gzipped) or `TB1.j.` (plain). `decodeSaveCode(code, ctx)` ignores spaces and line breaks from pasting, also accepts bare base64 of the JSON, then migrates and validates. Errors are plain sentences, such as "This save code is damaged. Copy the whole code and try again." Only campaign saves are exported; a suspended battle is not.

In Settings, Export picks a slot and shows the code with a Copy button; Import takes a pasted code (or the Paste button where the clipboard can be read), then asks for a slot and confirms before overwriting one.

## Preferences

The default animation speed and the battle scene setting (`sceneMode`: `full`, `fast` or `off`, null until chosen) live in `localStorage` under `ten-blades.prefs`, read and written through `prefs.ts`, which ignores any storage error. The Speed and Scenes buttons in battle and Settings update them. `sceneModeOf` gives Off under `prefers-reduced-motion` while the player has not chosen.

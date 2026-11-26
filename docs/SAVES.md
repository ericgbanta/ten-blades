# Saves

How Ten Blades keeps progress: the save shape, the versioning rule, the storage API, the suspend save and save codes. The code is in `src/save`. The modules that define and check the shape (`format.ts`, `shape.ts`, `validate.ts`, `migrate.ts`, `load.ts`, `campaign.ts`, `queue.ts`) are pure: lint keeps them free of the DOM, storage, the clock and `Math.random`, as it does for `src/core`. Times and seeds come in from the UI.

## Modules

| Path | What it does |
| --- | --- |
| `src/save/format.ts` | The save types, `SAVE_VERSION`, slot ids, enums and the `Result` type. |
| `src/save/validate.ts` | Strict runtime checks for a campaign save, a suspend save and a battle state. |
| `src/save/migrate.ts` | The migration pipeline and the `MIGRATIONS` table. |
| `src/save/load.ts` | `readCampaign` and `readSuspend`: migrate, then validate. |
| `src/save/campaign.ts` | New campaign, battle setup for the current chapter, permadeath, chapter completion, building a suspend save. |
| `src/save/battleSaver.ts` | Turns the battle controller's checkpoints into save writes for one attempt at a map. |
| `src/save/queue.ts` | `SaveQueue`: runs writes one at a time in the background and coalesces suspend writes. |
| `src/save/storage.ts` | The `SaveStorage` interface, the in-memory backend and `openSaveStorage`. |
| `src/save/idb.ts` | The IndexedDB backend. |
| `src/save/code.ts` | Save codes for export and import. |
| `src/save/prefs.ts` | Small UI preferences in `localStorage` (animation speed). Not part of any save. |
| `src/data/chapters.json` | The chapter order. Only the prologue for now. |
| `src/ui/saves.ts` | The app's storage instance, write queue and the campaign run the battle route plays. |

## Campaign save

One JSON object per slot.

| Field | Meaning |
| --- | --- |
| `version` | The save version, 1 now. |
| `kind` | Always `campaign`. |
| `createdAt`, `updatedAt` | Epoch milliseconds, passed in by the UI. `updatedAt` is the "last played" time on the load screen. It changes when the campaign is written: at new game and after each won chapter. |
| `settings` | `difficulty` (`normal`, `hard`, `lunatic`) and `permadeath` (`classic`, `casual`), chosen at new game and fixed after. |
| `mc` | `name` (1 to 16 characters, any script, no control characters), `pronouns` (`he`, `she`, `they`) and `style` (`vanguard`, `duelist`, `spiritblade`). Phase 4 adds `look` here. |
| `party` | `PartyUnit[]` carried into the next map, in unit order, as built by `partyAfterBattle`. Empty before the prologue, when the MC is built from `mc`. When not empty it holds exactly one lord (the MC). |
| `fallen` | `PartyUnit[]` lost for good in Classic mode. Never the MC. |
| `progress` | `current`: the chapter id to play next, or null once the story so far is finished. `completed`: chapter ids won, in order. |
| `flags` | Story flags: a record of string keys to `true`/`false`, numbers or text. Empty until phase 4. |
| `gold`, `shards` | Counters, 0 for now. |

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
| `controller` | Small controller state a resume keeps: `showDanger`. The selection is never kept. |

## Validation

`validateCampaign`, `validateSuspend` and `validateBattleState` return `{ ok: true, value }` with a typed save, or `{ ok: false, error }` with a readable path and problem, such as `party[0].classId: unknown class "dragon"`. They check:

- The shape: every field present, no unknown fields, the right types, whole numbers in range.
- Ids against game data: classes, weapons, maps, terrain and chapter ids.
- Invariants: unit ids unique, at most one lord and none among the fallen, the current chapter not already completed, a living unit with HP from 1 to its max and a fallen one at 0, positions on the map, enemy and ally units with an AI, the battle's map size matching the map data.

`readCampaign` and `readSuspend` run `migrate` first and wrap any error in a plain sentence for the player. Storage also validates every save before writing it, so a bad object never reaches the disk.

## Versioning rule

`SAVE_VERSION` in `format.ts` is the version every save is written at. Any change to the shape of a campaign or suspend save, including the `BattleState` inside a suspend save, needs all of these:

1. Bump `SAVE_VERSION`.
2. Add a step to `MIGRATIONS` in `migrate.ts`, keyed by the old version, that turns a save of the old version into the new one. A step must handle both kinds, and for a suspend save also its nested `campaign`.
3. Update the validator for the new shape.
4. Keep `tests/fixtures/save-v1.json` (and every later fixture) as it is, add a fixture of the version you are leaving if there is none yet, and add a test that loads each old fixture through `readCampaign` and checks the result.

`migrate(raw)` checks that the object has a whole-number version, refuses versions newer than the game knows, then runs the steps one at a time and checks that each step lands on the next version. It never changes its input. Version 1 has no steps yet; `tests/save-migrate.test.ts` runs a pretend two-step chain to prove the pipeline, and loads `tests/fixtures/save-v1.json` and `tests/fixtures/suspend-v1.json`.

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

- when the battle starts or resumes,
- right after each player action is applied, before its animations play,
- when playback comes to rest: the player has a choice again, or the battle is over.

The enemy and ally phases are not saved step by step. A checkpoint taken just after a player's action can be in the middle of a turn (for example right after End turn). `start()` on such a state plays the automatic actions on to the next rest: it is the same code path as live play, the AI is deterministic and the RNG state is in the battle state, so a resume replays the enemy phase exactly. This was simpler than saving after every AI action and needs no extra state.

`BattleSaver` turns checkpoints into writes through a `SaveQueue`. Writes run in the background, one at a time, so animations never wait for storage. A suspend write that is still waiting is replaced by a newer one, so a quick run of checkpoints becomes a single write. Write errors are logged and the queue keeps going.

When the battle ends, `BattleSaver` writes the final state to the suspend slot first, then:

- on victory, applies the result to the campaign (`completeChapter`) and writes it to its slot, then clears the suspend save;
- on defeat, clears the suspend save and leaves the slot as it was.

If the tab closes between those writes, the suspend slot holds a finished battle; Continue shows its end screen and finishes the same writes.

Why a reload cannot reroll: the RNG state is part of `BattleState`, and the state after an action, outcome included, is queued for saving before the first animation frame of that action. Reloading gives back either that state (the outcome stands) or, if the write had not finished, the state before the action with the same RNG state, where the same action gives the same result. The tests in `tests/suspend.test.ts` check both, and that a run suspended and resumed at several points matches an uninterrupted run with the same seed, state for state and event for event. Retry after a defeat and Load game restart the map with a new seed; that is a deliberate restart of the whole map, not a reroll of one action.

The battle route takes its run once (`takeRun`), so going back to it in the browser history cannot replay a stale resume. Starting a new game or loading a slot while a battle is suspended asks first, since it ends that battle.

## Save codes

`encodeSaveCode(save)` turns a campaign save into text: the JSON as UTF-8, gzipped with `CompressionStream` when the browser has it, then base64. Codes start with `TB1.z.` (gzipped) or `TB1.j.` (plain). `decodeSaveCode(code, ctx)` ignores spaces and line breaks from pasting, also accepts bare base64 of the JSON, then migrates and validates. Errors are plain sentences, such as "This save code is damaged. Copy the whole code and try again." Only campaign saves are exported; a suspended battle is not.

In Settings, Export picks a slot and shows the code with a Copy button; Import takes a pasted code (or the Paste button where the clipboard can be read), then asks for a slot and confirms before overwriting one.

## Preferences

The default animation speed lives in `localStorage` under `ten-blades.prefs`, read and written through `prefs.ts`, which ignores any storage error. The speed button in battle also updates it.

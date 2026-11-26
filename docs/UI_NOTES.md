# Battle UI notes

How the battle screen is put together (phase 2). The rules live in `src/core`; everything here only displays state and sends actions. See `docs/CORE_API.md` for the core itself.

## Modules

| Path | What it does |
| --- | --- |
| `src/battle/setup.ts` | The hardcoded new game (`NEW_GAME`: MC "Wanderer", Vanguard, Normal, Casual) and URL overrides. Phases 3 and 4 replace it with the mode pickers and the creator. |
| `src/battle/selection.ts` | The selection state machine as pure functions: what a tap or a menu command means, which menu options exist, and which tiles to highlight. |
| `src/battle/controller.ts` | `BattleController`: owns the `BattleState`, the selection and the event playback queue. Plain TypeScript, no DOM or Phaser. |
| `src/battle/stage.ts` | The `Stage` interface the controller draws through. |
| `src/game/MapScene.ts` | The Phaser scene. Implements `Stage`: terrain, highlights, tokens, camera, touch input and the in-map animations. |
| `src/game/token.ts`, `terrainArt.ts`, `palette.ts` | Placeholder tokens and tiles drawn in code. |
| `src/game/camera.ts`, `gestures.ts` | Pure camera math (clamp, zoom around a point, reveal a tile) and the tap, pan and pinch tracker. |
| `src/game/start.ts` | Boots Phaser and returns a small `GameHandle`. |
| `src/ui/Battle.tsx` | The battle route: builds the controller, mounts Phaser, renders the overlays, measures them for the camera. |
| `src/ui/battle/*` | Preact overlays: top bar, bottom bar, unit card, action menu, forecast, heal preview, phase banner, level-up, dialogs, end screen, and the test hook. |

## Selection state machine

`Selection` is one of:

- `none`: nothing selected.
- `inspect`: looking at a unit that cannot take orders (an enemy, an ally, or a player unit that has acted). Enemies show their move tiles in blue and their threat beyond them in red.
- `unit`: a ready player unit, showing its move tiles (blue), strike tiles beyond them (red) and, for staff users, heal tiles (green).
- `menu`: the unit previews on a tile and the action menu is open.
- `target`: choosing whom to attack or heal; valid targets pulse.
- `confirm`: the forecast or heal preview is open, waiting for Confirm.

`tapTile` and `runCommand` move between them. Taps: a ready unit selects it; any other unit inspects it; a reachable tile (the unit's own included) opens the menu there; tapping another reachable tile from the menu moves the preview; anything else steps back one level or clears the selection. Commands: Attack and Heal go to `target`, Back steps back, Cancel returns to `unit`, and Wait or Confirm return an `Action`. Every question goes through core queries (`moveTiles`, `attackTargets`, `healTargets`, `forecast`, `healAmount`, ...), and a committed action is checked with `validateAction` first.

The menu only offers what is valid from the previewed tile: Attack when `attackTargets` is not empty, Heal when `healTargets` is not empty, then Wait and Cancel.

## Controller and playback queue

The controller exposes a read-only `view` (state, selection, menu, forecast, heal preview, banner, level-up popup, end-turn confirm, danger toggle, speed, end summary) and input methods (`tapTile`, `command`, `requestEndTurn`, `confirmEndTurn`, `toggleDanger`, `setSpeed`, `skip`, `dismissPopup`). Preact subscribes and re-renders on every change.

When the player commits an action, the controller:

1. Clears the selection and marks itself busy (map taps then mean "skip").
2. Calls `applyAction` and plays the events one by one. `phaseChanged` shows the phase banner and `levelUp` shows the level-up card; every other event goes to `Stage.play`, which returns a promise when its animation ends.
3. Snaps the stage to the new state with `Stage.sync`, so the picture always matches the core at the end of each action.
4. Picks the next automatic action: `planAiAction` during enemy and ally phases, or `endPhase` once no player unit can act (the turn ends by itself when everyone has acted). It loops until the player has a choice or the battle ends, then shows the end screen.

The opening "Turn 1, Player phase" banner is shown by `start()`, because turn 1 has no phase event.

Timing: every animation length goes through `Timing.ms(base)`, scaled by the speed setting (normal or fast) and shortened under `prefers-reduced-motion` (which also drops the lunge and the screen shake). A tap during playback sets the skip flag, which makes the remaining animations of that playback instant. The level-up card is still shown while skipping; a tap closes it.

## Map scene

- One tile is 64 world units. The camera has its origin at the top left, so screen = (world - scroll) x zoom. The canvas is sized in device pixels and shown at CSS size.
- Default zoom fits the map if tiles stay at least 46 CSS px, otherwise 46 px tiles and the player pans. Drag pans, pinch and the mouse wheel zoom. A press that moves more than 10 CSS px is a pan and never a tap.
- The overlays report the screen area they cover (`coveredInsets`); the camera clamps to the uncovered area and pans the selected tile into it when panels open. In landscape the dock becomes a column on the right.
- Art: tiles use texture `tile.<terrainId>` and tokens `token.<classId>` when `src/art/assets.json` lists them; otherwise they are drawn in code. Adding an image to the manifest needs no code change.
- The previewed move walks the real token to the tile; Cancel snaps it home. When the action is confirmed, a token already standing on the destination skips the walk.

## Test hook

With `test=1` in the URL (`?test=1&seed=7#/battle`), `window.__tb` offers:

| Member | Use |
| --- | --- |
| `getState()`, `getSelection()` | The current battle state and selection. |
| `isBusy()`, `isEnded()` | Whether events are playing, and whether the end screen is up. |
| `tileToScreen(x, y)` | CSS client point of a tile's center, for `page.touchscreen.tap`. |
| `reveal(x, y)` | Pan instantly so the tile is clear of the overlays. |
| `settled()` | Resolves true once Phaser has handled the last input and no camera pan runs. |
| `tileSize()` | Current tile size in CSS px. |
| `suggest(unitId)` | The charge AI's choice for a player unit, so a test can script a strategy and still play it by taps. |

URL overrides (query or after the hash route): `seed=N`, `style=vanguard|duelist|spiritblade`, `difficulty=normal|hard|lunatic`, `mode=classic|casual`. Without `seed`, each battle seeds from the clock.

`e2e/battle.spec.ts` uses the hook to play a turn by taps (select, move, wait, end turn, forecast, attack, enemy phase) and to play the whole prologue to the victory screen.

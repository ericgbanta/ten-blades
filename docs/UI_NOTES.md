# UI notes

How the battle screen is put together (phase 2). The rules live in `src/core`; everything here only displays state and sends actions. See `docs/CORE_API.md` for the core itself.

## Modules

| Path | What it does |
| --- | --- |
| `src/battle/setup.ts` | URL launch options: the fixed seed, the test hook, and the quick battle (`QUICK_BATTLE`: MC "Wanderer", Vanguard, Normal, Casual, plus overrides). Campaign battles take their setup from the save (see `docs/SAVES.md`). |
| `src/battle/selection.ts` | The selection state machine as pure functions: what a tap or a menu command means, which menu options exist, and which tiles to highlight. |
| `src/battle/controller.ts` | `BattleController`: owns the `BattleState`, the selection and the event playback queue. Plain TypeScript, no DOM or Phaser. |
| `src/battle/stage.ts` | The `Stage` interface the controller draws through. |
| `src/game/MapScene.ts` | The Phaser scene. Implements `Stage`: terrain, highlights, tokens, camera, touch input and the in-map animations. |
| `src/game/token.ts`, `terrainArt.ts`, `palette.ts` | Unit tokens, placeholder tiles drawn in code, and the colors. See Tokens below. |
| `src/game/camera.ts`, `gestures.ts` | Pure camera math (clamp, zoom around a point, reveal a tile) and the tap, pan and pinch tracker. |
| `src/game/start.ts` | Boots Phaser and returns a small `GameHandle`. |
| `src/ui/Battle.tsx` | The battle route: plays the campaign run (new, loaded or resumed) or a quick battle, builds the controller, mounts Phaser, renders the overlays, measures them for the camera. |
| `src/ui/Title.tsx`, `src/ui/menus/*` | Title (Continue, New game, Load game, Settings), the new game flow and creator, load game, settings and the chapter complete screen. |
| `src/ui/mc/McPicture.tsx` | Canvas elements that show a composed MC portrait, face crop, token or pose. |
| `src/ui/DevMc.tsx` | The hidden MC art check page, `#/dev/mc`. |
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
2. Calls `applyAction`, reports the new state through `onCheckpoint` (the suspend save, see `docs/SAVES.md`), and plays the events one by one. `phaseChanged` shows the phase banner and `levelUp` shows the level-up card; every other event goes to `Stage.play`, which returns a promise when its animation ends.
3. Snaps the stage to the new state with `Stage.sync`, so the picture always matches the core at the end of each action.
4. Picks the next automatic action: `planAiAction` during enemy and ally phases, or `endPhase` once no player unit can act (the turn ends by itself when everyone has acted). It loops until the player has a choice or the battle ends, checkpoints again, then shows the end screen if the battle is over.

The opening banner ("Turn 1, Player phase", or the current turn and phase on a resume) is shown by `start()`, because turn 1 has no phase event. On a resumed state that is not waiting on the player, `start()` then plays the automatic actions on to the next rest.

Timing: every animation length goes through `Timing.ms(base)`, scaled by the speed setting (normal or fast) and shortened under `prefers-reduced-motion` (which also drops the lunge and the screen shake). A tap during playback sets the skip flag, which makes the remaining animations of that playback instant. The level-up card is still shown while skipping; a tap closes it.

## Map scene

- One tile is 64 world units. The camera has its origin at the top left, so screen = (world - scroll) x zoom. The canvas is sized in device pixels and shown at CSS size.
- Default zoom fits the map if tiles stay at least 46 CSS px, otherwise 46 px tiles and the player pans. Drag pans, pinch and the mouse wheel zoom. A press that moves more than 10 CSS px is a pan and never a tap.
- The overlays report the screen area they cover (`coveredInsets`); the camera clamps to the uncovered area and pans the selected tile into it when panels open. In landscape the dock becomes a column on the right.
- Art: tiles use texture `tile.<terrainId>` and tokens `token.<classId>` when `src/art/assets.json` lists them; otherwise they are drawn in code. Adding an image to the manifest needs no code change.
- The previewed move walks the real token to the tile; Cancel snaps it home. When the action is confirmed, a token already standing on the destination skips the walk.

## Tokens

- Every unit stands on a flat team-colored base at its feet: player blue, enemy crimson, ally green (`TEAM_COLORS` in `palette.ts`), grey once the unit has acted. Team is read from the base, never from the sprite.
- A class with `token.<classId>` art is drawn about a tile tall, so its head may reach about a quarter of a tile into the tile above. Lower rows draw over upper rows (depth is 10 plus row times 0.01). The sprite gets a thin light outline, baked once per texture into a canvas texture (`<key>#outline`) so it works under WebGL and the canvas renderer, and a white silhouette (`<key>#flash`) for the hit flash.
- A class with no art (the MC's three style classes for now) shows a team-colored disc (a shield for enemies) with its initial and a school pip, standing on the same base.
- The HP bar and the lord star (top left) and boss crown (top right) live in a second container at depth 25, above every token, which `MapScene.update` keeps on its token. A unit below never covers them with its head.
- The camera allows a 0.3 tile strip above the map, so heads on the top row can be panned into view.

## New game flow and the creator

Steps: choose a slot, your path (permadeath and difficulty), your hero (name and pronouns), your look (the creator, which ends with Begin). The state and step rules are pure functions in `src/ui/menus/newGameDraft.ts`; `tests/new-game.test.ts` covers them.

The creator (`src/ui/menus/Creator.tsx`) keeps a live preview pinned under the header: the portrait (tap it to cycle neutral, angry, hurt and smiling) and the map token for the chosen combat style, with a Randomize button. Below it are four tabs: Look (body type, skin tone), Hair (style, color), Face (eyes, scar or marking) and Style (combat style, outfit accent). Option buttons and color swatches are at least 44 px; swatches carry the color's name as their label. In landscape on a phone the preview sits on the left and the options on the right. Randomize uses the seeded RNG with a seed from the clock and changes only the look. All options come from `src/data/looks.json`.

## Main character pictures

`src/art/mc/compose.ts` builds the MC's pictures from the packed layers (see `docs/ART_GENERATION.md`): `composeMcPortrait(look, expr)`, `composeMcToken(look, style)` and `composeMcPose(look, style, pose)` each return a canvas the size of the matching packed canvas. Each layer is fetched and decoded once; each composed picture is cached by look (up to 64), so drawing it again is free. The returned canvas is shared: draw it, do not change it. A missing layer is skipped and a missing base draws a plain head-and-shoulders shape. The pure parts (look checks, palette lookup, layer ids, the per-pixel recolor) are in `look.ts` and `recolor.ts`, tested in `tests/mc-look.test.ts` and `tests/mc-recolor.test.ts` (against pixels decoded by the Python build).

Measured in headless Chromium on the dev page: composing a 384 portrait from loaded layers takes about 3.5 ms, 17 ms with the CPU slowed four times and 25 ms at six times (a phone-class device). The first draw of a look, with fetching and decoding of its layers, took 40 to 90 ms unthrottled and 160 to 300 ms at four times slower with seven pictures loading at once.

On the map, the battle route composes the MC's token for their look and style before Phaser starts and hands a copy to the scene, which registers it as the texture `token.mc` and uses it for the player's lord unit, with the same baked outline and hit flash as other tokens. A quick battle (`quick=1`) uses the default look. The unit card shows the MC's face, cut from the neutral portrait, beside the name and HP.

`#/dev/mc` shows the newest saved campaign's look (or a random one; `#/dev/mc?seed=N` picks one) as the portrait in four expressions, the token in three styles and all twelve battle poses, with Randomize and first-draw times. It sets `window.__mc.timePortrait(runs)` for timing. Battle poses are composed but not shown in battle yet.

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
| `saved()` | Resolves true once every queued save write has finished, so a test can reload safely. |
| `tokenTexture(unitId)` | The texture key a unit's map token shows (`token.mc` for the composed MC), or null for a placeholder. |

URL overrides (query or after the hash route): `seed=N` fixes the seed of every battle, campaign ones included; without it each battle seeds from the clock. `quick=1` on the battle route (`?test=1&quick=1&seed=7#/battle`) plays an unsaved quick battle, which also takes `style=vanguard|duelist|spiritblade`, `difficulty=normal|hard|lunatic` and `mode=classic|casual`. Without `quick=1` and without a campaign run (for example after a page reload), the battle route goes back to the title, where Continue resumes the suspended battle.

`e2e/battle.spec.ts` uses the hook on a quick battle to play a turn by taps (select, move, wait, end turn, forecast, attack, enemy phase) and to play the whole prologue to the victory screen.

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
| `src/game/groundPlan.ts`, `ground.ts` | What to draw on each cell (variants, road, wall and shore pieces), as pure functions, and the painter that bakes it into cached textures. See Map rendering below. |
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
- Default zoom (`defaultTileCss`): the whole map if its tiles stay at least 36 CSS px, else the full width if that keeps them at 36 or more (the player pans up and down), else 44 px tiles. A 10 column map on a 375 px phone opens at about 37 px with the whole width in view; 12 columns need 432 px of width; the 14 column skirmish test map opens at 44 px. The view opens centered on the player's units (on an axis where the whole map fits, on the map), with the lord in view. Taps resolve to whole tiles with no gaps, so a 37 px tile is a 37 px tap target; the tap slop below keeps small drags from turning into taps on the wrong tile. Zooming out stops at the size that fits the whole map (or 44 px if that is larger); zooming in stops at 112 px. Drag pans, pinch and the mouse wheel zoom. A press that moves more than 10 CSS px is a pan and never a tap.
- The bars are measured after Phaser starts, so until the player first taps, pans or zooms, every change of the covered insets frames the default view again; after that a change only clamps and keeps the selected tile in view. The clamp keeps the map inside the area the top bar and dock leave free, so no row sits under them at rest.
- The overlays report the screen area they cover (`coveredInsets`); the camera clamps to the uncovered area and pans the selected tile into it when panels open. In landscape the dock becomes a column on the right.
- Art: tokens use `token.<classId>` when `src/art/assets.json` lists it; otherwise they are drawn in code. The ground is described under Map rendering. Adding an image to the manifest needs no code change.
- The previewed move walks the real token to the tile; Cancel snaps it home. When the action is confirmed, a token already standing on the destination skips the walk.

## Map rendering

The ground is planned per cell by `planGround` in `src/game/groundPlan.ts` (pure, tested in `tests/ground-plan.test.ts`) and painted once by `buildGround` in `src/game/ground.ts` into canvas textures of up to 20 by 20 tiles at 96 px per tile (the packed tile size), shown as one image each. A 14 by 18 map is one 1344 x 1728 texture, so the scene has a few ground images, one grid graphic, one image per prop and the units, however busy the ground looks. The pieces and how they were cut are described in `docs/ART_GENERATION.md`.

- Variants: each cell of a terrain with a rule in `VARIANT_RULES` picks `tile.<terrain>` or `tile.<terrain>.<n>` by weight with a small hash of the map id and the cell (not the game RNG, so a map looks the same on every load and every seed). Plain is mostly the quiet base (16 to 2 to 3), water has an occasional reed tile, forests, hills and villages mix freely. An accent variant is not put beside the same accent on its left or above, and no variant fills a 2 by 2 block, when another choice exists.
- Roads: a road cell is the plain tile plus pieces toward every road neighbour, toward a bridge or ford that runs its way, and off the map edge when the road continues from the other side (or has nothing else to join). A straight run is the whole straight piece (turned for north to south); anything else is an arm per joined side, the hub over the center, and a lip on each closed side, which gives corners, T junctions, crossings and dead ends.
- Walls: a wall cell is the plain tile plus wall pieces toward walls, forts and villages (a garden wall meets the cottage), and off the edge where the wall continues. A straight east to west wall is the two straight halves; anything else adds the north and south arms as needed and a post on top, so corners, ends and junctions have a pillar. A lone wall is drawn as a short straight wall. Wall pieces are never turned, because the art shows the wall's south face.
- Water: a water, bridge or ford cell gets a bank on each side that borders land (land is anything but water, bridge and ford; off the map counts as water so rivers run on), a small corner bank where only the diagonal neighbour is land, and then the land of each bank again so no inked lip shows inside land where two banks meet. A one tile river gets banks on both sides.
- Bridges and fords: drawn over water and the banks, turned to run across the water between the land sides (`crossingRunsEastWest`).
- Fallbacks: a road or wall with a missing piece uses its single `tile.<terrain>`; any terrain with no art at all gets the coded placeholder (`terrainArt.ts`), painted into the same texture.
- Props: a map's optional `props` list (`{ id, x, y }`, ids from `src/data/props.json`) is drawn as images anchored at the lower middle of the tile, depth 10 plus row times 0.01 minus a little, so a unit on the same row stands in front and a tall prop covers the feet of a unit on the row behind. HP bars live on the overlay layer above both. A tall prop fades to 35 percent while a unit stands on its tile. Highlights stay under props and tokens; the grid is drawn at 30 percent black.
- Measured in headless Chromium (software WebGL) at 375 x 667 and device scale 2, dragging the 14 by 18 skirmish map for four seconds: frames averaged 16.8 ms (median 16.7, 95th percentile 16.8), so 60 fps; with the CPU slowed four times, 28.9 ms average (median 33.3).

`?test=1&quick=1&map=skirmish_test#/battle` opens the 14 by 18 skirmish test map, which has a river with a bridge and a ford, a walled fort, a village, forest belts, hills, roads, five player units and eight enemies. It is not in the chapter list.

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

URL overrides (query or after the hash route): `seed=N` fixes the seed of every battle, campaign ones included; without it each battle seeds from the clock. `quick=1` on the battle route (`?test=1&quick=1&seed=7#/battle`) plays an unsaved quick battle, which also takes `style=vanguard|duelist|spiritblade`, `difficulty=normal|hard|lunatic`, `mode=classic|casual` and `map=<id>` (any map in `gameData.maps`; an unknown id plays the prologue). Without `quick=1` and without a campaign run (for example after a page reload), the battle route goes back to the title, where Continue resumes the suspended battle.

`e2e/battle.spec.ts` uses the hook on a quick battle to play a turn by taps (select, move, wait, end turn, forecast, attack, enemy phase) and to play the whole prologue to the victory screen.

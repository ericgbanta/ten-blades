# UI notes

How the battle screen is put together (phase 2). The rules live in `src/core`; everything here only displays state and sends actions. See `docs/CORE_API.md` for the core itself.

## Modules

| Path | What it does |
| --- | --- |
| `src/battle/setup.ts` | URL launch options: the fixed seed, the test hook, and the quick battle (`QUICK_BATTLE`: MC "Wanderer", Vanguard, Normal, Casual, plus overrides). Campaign battles take their setup from the save (see `docs/SAVES.md`). |
| `src/battle/selection.ts` | The selection state machine as pure functions: what a tap or a menu command means, which menu options exist, and which tiles to highlight. |
| `src/battle/controller.ts` | `BattleController`: owns the `BattleState`, the selection and the event playback queue. Plain TypeScript, no DOM or Phaser. |
| `src/battle/stage.ts` | The `Stage` interface the controller draws through, and `FightStage`, the battle scene player. |
| `src/battle/fightTimeline.ts` | The battle scene script: a pure function from one fight's events to timed steps. See Battle scenes. |
| `src/game/FightScene.ts`, `fightLayout.ts` | The Phaser battle scene over the map, and where it goes on screen (pure, shared with the HUD). |
| `src/ui/battle/FightHud.tsx` | The battle scene's HUD and the power cut-in. |
| `src/game/MapScene.ts` | The Phaser scene. Implements `Stage`: terrain, highlights, tokens, camera, touch input and the in-map animations. |
| `src/game/token.ts`, `terrainArt.ts`, `palette.ts` | Unit tokens, placeholder tiles drawn in code, and the colors. See Tokens below. |
| `src/game/groundPlan.ts`, `ground.ts` | What to draw on each cell (variants, road, wall and shore pieces), as pure functions, and the painter that bakes it into cached textures. See Map rendering below. |
| `src/game/camera.ts`, `gestures.ts` | Pure camera math (clamp, zoom around a point, reveal a tile) and the tap, pan and pinch tracker. |
| `src/game/start.ts` | Boots Phaser and returns a small `GameHandle`. |
| `src/ui/Battle.tsx` | The battle route: plays the campaign run (new, loaded or resumed) or a quick battle, builds the controller, mounts Phaser, renders the overlays, measures them for the camera. |
| `src/ui/Title.tsx`, `src/ui/menus/*` | Title (Continue, New game, Load game, Settings), the new game flow and creator, load game, settings and the chapter complete screen. |
| `src/ui/Story.tsx` | The story route, `#/story`: plays the campaign's intro or outro scenes one after another and saves after each (see `docs/STORY.md`). |
| `src/ui/camp/*` | The camp route, `#/camp` and its sub-routes: hub, forge, merchant, barracks, war map, deploy step and campfire talk (see Camp below and `docs/CAMP.md`). |
| `src/ui/dialogue/Dialogue.tsx`, `dialogue.css` | The dialogue player, used by the story route and over the battle map. See Dialogue below. |
| `src/ui/mc/McPicture.tsx` | Canvas elements that show a composed MC portrait, face crop, token or pose. |
| `src/ui/DevMc.tsx` | The hidden MC art check page, `#/dev/mc`. |
| `src/ui/battle/*` | Preact overlays: top bar, bottom bar, unit card, action menu, forecast, heal preview, phase banner, level-up, dialogs, end screen, and the test hook. |
| `src/ui/tokens.css`, `src/ui/kit.css`, `src/ui/styles.css` | The design tokens and fonts, the shared kit (plates, frames, ribbon, divider, medallion, icons, HP bars), and the base page styles. See Look and the UI kit below. |
| `src/ui/kit.tsx`, `src/ui/artMap.ts` | Hands the kit images to CSS, the `Icon` and `Medallion` components, and the lookups from stats, schools, weapon kinds and units to their art. |

## Selection state machine

`Selection` is one of:

- `none`: nothing selected.
- `inspect`: looking at a unit that cannot take orders (an enemy, an ally, or a player unit that has acted). Enemies show their move tiles in blue and their threat beyond them in red.
- `unit`: a ready player unit, showing its move tiles (blue), strike tiles beyond them (red) and, for staff users, heal tiles (green).
- `menu`: the unit previews on a tile and the action menu is open.
- `target`: choosing whom to attack or heal; valid targets pulse. With the power mode it may carry `powerId`, the second of two powers.
- `confirm`: the forecast or heal preview is open, waiting for Confirm.
- `powerConfirm`: the power forecast for an aim (a target or a direction), waiting for Confirm (with `powerId` for a second power).
- `items`: the unit's inventory, from the menu.

`tapTile` and `runCommand` move between them. Taps: a ready unit selects it; any other unit inspects it; a reachable tile (the unit's own included) opens the menu there; tapping another reachable tile from the menu moves the preview; anything else steps back one level or clears the selection. Commands: Attack and Heal go to `target`, Back steps back, Cancel returns to `unit`, and Wait or Confirm return an `Action`. Every question goes through core queries (`moveTiles`, `attackTargets`, `healTargets`, `forecast`, `healAmount`, ...), and a committed action is checked with `validateAction` first.

The menu only offers what is valid from the previewed tile: Attack when `attackTargets` is not empty, Heal when `healTargets` is not empty, Talk when `talkTargets` is not empty, Items when the unit carries an item or a second weapon, then Wait and Cancel. Talk goes to `target` with the talk mode ("Tap someone to talk to."), and tapping a talk target sends the talk action at once: there is no forecast to confirm (`tapTileAction`).

## Controller and playback queue

The controller exposes a read-only `view` (state, selection, menu, forecast, heal preview, banner, level-up popup, end-turn confirm, danger toggle, speed, end summary) and input methods (`tapTile`, `command`, `requestEndTurn`, `confirmEndTurn`, `toggleDanger`, `setSpeed`, `skip`, `dismissPopup`). Preact subscribes and re-renders on every change.

When the player commits an action, the controller:

1. Clears the selection and marks itself busy (map taps then mean "skip").
2. Calls `applyAction`, reports the new state through `onCheckpoint` (the suspend save, see `docs/SAVES.md`), and plays the events one by one. `phaseChanged` shows the phase banner and `levelUp` shows the level-up card; every other event goes to `Stage.play`, which returns a promise when its animation ends.
3. Snaps the stage to the new state with `Stage.sync`, so the picture always matches the core at the end of each action.
4. Picks the next automatic action: `planAiAction` during enemy and ally phases, or `endPhase` once no player unit can act (the turn ends by itself when everyone has acted). It loops until the player has a choice or the battle ends, checkpoints again, then shows the end screen if the battle is over.

The opening banner ("Turn 1, Player phase", or the current turn and phase on a resume) is shown by `start()`, because turn 1 has no phase event. Before it, `start()` runs the battle start events (`startBattle`) on a new battle and plays them, or on a resume plays the scenes the save still owes. On a resumed state that is not waiting on the player, `start()` then plays the automatic actions on to the next rest.

Mid-battle scenes: with the `scenes` option on (campaign battles, and quick battles with `scenes=1`), a `sceneRequested` event snaps the stage to the state, sets `view.scene` and waits until the UI calls `sceneDone()`. The playback queue does not move on meanwhile, so events fired during the enemy phase play in order and the AI only plans after the scene. Scenes from the player action just applied are listed in the checkpoint (`CheckpointExtra.scenes`) until they have played; see `docs/SAVES.md`. With the option off the events still fire and the scenes are passed over.

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

`?test=1&quick=1&map=skirmish_test#/battle` opens the 14 by 18 skirmish test map, which has a river with a bridge and a ford, a walled fort, a village, forest belts, hills, roads, five player units and eight enemies, plus a deserter who joins if the main character talks to him. It is not in the chapter list.

## Tokens

- Every unit stands on a flat team-colored base at its feet: player blue, enemy crimson, ally green (`TEAM_COLORS` in `palette.ts`), grey once the unit has acted. Team is read from the base, never from the sprite.
- A class with `token.<classId>` art is drawn about a tile tall, so its head may reach about a quarter of a tile into the tile above. Lower rows draw over upper rows (depth is 10 plus row times 0.01). The sprite gets a thin light outline, baked once per texture into a canvas texture (`<key>#outline`) so it works under WebGL and the canvas renderer, and a white silhouette (`<key>#flash`) for the hit flash.
- A class with no art (the MC's three style classes for now) shows a team-colored disc (a shield for enemies) with its initial and a school pip, standing on the same base.
- The HP bar and the lord star (top left) and boss crown (top right) live in a second container at depth 25, above every token, which `MapScene.update` keeps on its token. A unit below never covers them with its head.
- The camera allows a 0.3 tile strip above the map, so heads on the top row can be panned into view.

## Look and the UI kit

The UI matches the art: inked iron, bone and tarnished gold on near-black, crimson for the main action and the enemy. Everything is drawn from a few tokens and seven small kit images, so screens do not carry their own colors or sizes.

### Tokens

`src/ui/tokens.css` holds every value as a custom property on `:root`, and every screen uses them.

| Group | Tokens | Notes |
| --- | --- | --- |
| Surfaces | `--c-void`, `--c-bg`, `--c-panel`, `--c-panel-hi`, `--c-inset`, `--c-line`, `--c-iron`, `--c-iron-hi` | `--c-panel` is the center color of the frame art. |
| Text | `--c-bone`, `--c-bone-dim`, `--c-muted`, `--c-gold`, `--c-gold-dim` | On the panel: bone 13.9:1, dim 9.1:1, muted 6.1:1, gold 8.5:1. On the crimson plate: bone 8.8:1, dim 5.7:1, gold 5.4:1; muted text is never put on crimson. |
| Accents | `--c-crimson`, `--c-crimson-hi`, `--c-crimson-deep`, `--c-rust`, `--c-steel` | |
| Game colors | `--c-player`, `--c-enemy`, `--c-ally`, `--c-hp`, `--c-hp-low`, `--c-hp-crit`, `--c-hp-track`, `--c-good`, `--c-bad`, `--c-heavy`, `--c-swift`, `--c-arcane` | Teams, HP bar tones, triangle arrows and school colors. |
| Type | `--font-title`, `--font-display`, `--font-body`, `--fs-xs` to `--fs-xl` | See Fonts. |
| Space and shape | `--sp-1` to `--sp-5` (4 to 24 px), `--r-1`, `--r-2`, `--r-pill`, `--tap` (44 px), `--frame-w`, `--plate-w` | `--frame-w` and `--plate-w` are how wide the frame and plate art draw. |
| Depth | `--shadow-panel`, `--shadow-text`, `--z-hud`, `--z-banner`, `--z-dialog`, `--z-end` | Shadows go on small boxes only, never a blur over the map. |
| Safe areas | `--safe-t`, `--safe-r`, `--safe-b`, `--safe-l` | `env(safe-area-inset-*)`. |

### Fonts

Self-hosted from `@fontsource` packages (latin subset, woff2 only, declared in `tokens.css` so only the files used are bundled):

- Pirata One for the title logo only (8.9 KB).
- Cinzel 700 for headings, buttons, names, tabs and labels (15.2 KB). It is all capitals, so it is not used for typed text.
- Alegreya 400, 700 and 400 italic for body text and numbers (70.4 KB). It reads well at 13 to 16 px. Its default figures are old style, so the page sets `font-variant-numeric: lining-nums`, and stat blocks use the `.num` class (lining and tabular).

About 95 KB in all, loaded with `font-display: swap`. Names in other scripts fall back to the system font.

### The kit

`installKit()` (called once in `App.tsx`) reads the kit entries from the manifest and sets `--kit-<name>` (the image URL) and `--kit-<name>-slice` (its 9-slice numbers) on the root, and adds the `kit` class. The CSS uses the art only under `.kit` and the variables; without them each piece is a plain CSS border and fill, so missing art never breaks a screen.

| Piece | Manifest id | Used as |
| --- | --- | --- |
| Panel frame | `ui.frame` | `.framed`: `border-image` 9-slice, edges repeat (`round`), center filled. Dialogs, slot cards, the level-up card, the end screen stats, the creator preview. The top bar, the dock and the menu header use the same frame with `border-image-outset`, so only one straight edge shows: an iron rail along the map. |
| Dark plate, crimson plate | `ui.button`, `ui.button_primary` | Every `.btn`, choice, option and creator tab. Crimson for the main action and the chosen option. 9-slice, stretched. |
| Ribbon | `ui.ribbon` | `.ribbon`: the phase banner and the menu screen titles. The forked ends stay put and the middle stretches. The art is crimson (the enemy phase); the player and ally banners tint it with a hue rotation on that small element only. |
| Medallion | `ui.medallion` | The ring over round portraits (`Medallion`); `hole` in its entry sets how far in the portrait circle sits. A thin team-colored ring inside shows the side. |
| Divider | `ui.divider` | The sword ornament in the middle of `.divider`, with CSS gold lines either side. |
| Emblem | `ui.emblem` | The ten-blade star on the title and the end screen. |
| Backdrop | `backdrop.village` | Behind the title screen, darkened by gradients. |

### Icons

Icons are `icon.<name>` (96 px WebP, shown at 14 to 22 CSS px through `Icon`). An icon is decorative unless it is given a label; stat cells put the stat name next to the icon as text. A missing icon draws a disc with the first letter.

| Icons | Names |
| --- | --- |
| Stats | `hp`, `str`, `mag`, `skl`, `spd`, `lck`, `def`, `res`, `mov` |
| Schools | `heavy`, `swift`, `arcane` (`none` has no icon) |
| Items | `greatsword`, `axe`, `lance`, `sabre`, `dagger`, `bow`, `tome`, `talisman`, `staff`, `shard`, `coins`, `tenblade` |

Weapon kinds map to icons in `WEAPON_ICON` (`src/ui/artMap.ts`): greatsword, axe, lance, bow, tome, talisman and dagger to their own icon, katana to `sabre`, staff and spiritstaff to `staff`, and legendary to `tenblade` (the blades are the ten). A kind not in the map falls back by school (heavy greatsword, swift sabre, arcane tome, none staff). Other choices: the forecast labels use `str` for damage, `skl` for hit and `shard` for crit; the objective line uses `tenblade` for rout and boss maps, `def` for survive and protect, `mov` for escape; terrain bonuses use `def`, `res`, `spd` (avoid) and `hp` (healing).

Portraits: `portraitId(unit)` looks up `portrait.<sheet>.neutral` by unit id for named characters, then by class (`wanderer` is the Stranger, `hunter_captain` the captain, and the generic classes their own sheet). The main character has none: the medallion shows the composed face. `tests/ui-art.test.ts` checks every weapon in the data and every class against the manifest.

### Screens

- Battle top bar: Quit, turn and a phase tag in the team color, the objective with its icon, and Speed. Bottom bar: the terrain line with bonus icons, Danger and End turn.
- Unit card: medallion, name and tags, school with the triangle hint (beats and weak to, from `balance.json`), class, level and XP beside the HP bar, a 4 by 2 stat grid (icon, name, value), and the weapon row (weapon icon, name, Mt, Hit, Crit, Rng). The dock is 178 px tall with it at 375 x 667, the same as before the kit.
- Forecast: the two sides around a center column of labels (HP, Dmg, Hit, Crit), each side with its medallion, weapon and school icons and the triangle arrow. HP bars show the predicted loss as a hatched segment that pulses (steady under reduced motion). "No counter" replaces the defender's numbers when it cannot strike back. The dock is about 243 px tall with it (215 before) for the portraits and the label column.
- Level-up card: all nine stats with icons and new values, the ones that rose marked with the gain.
- Menus: the menu header carries the screen title on the ribbon, sections are headed in gold capitals between two thin rules, choices and options are plates (crimson when chosen), and step dots are diamonds.



Steps: choose a slot, your path (permadeath and difficulty), your hero (name and pronouns), your look (the creator, which ends with Begin). The state and step rules are pure functions in `src/ui/menus/newGameDraft.ts`; `tests/new-game.test.ts` covers them.

The creator (`src/ui/menus/Creator.tsx`) keeps a live preview pinned under the header: the portrait (tap it to cycle neutral, angry, hurt and smiling) and the map token for the chosen combat style, with a Randomize button. Below it are four tabs: Look (body type, skin tone), Hair (style, color), Face (eyes, scar or marking) and Style (combat style, outfit accent). Option buttons and color swatches are at least 44 px; swatches carry the color's name as their label. In landscape on a phone the preview sits on the left and the options on the right. Randomize uses the seeded RNG with a seed from the clock and changes only the look. All options come from `src/data/looks.json`.

## Main character pictures

`src/art/mc/compose.ts` builds the MC's pictures from the packed layers (see `docs/ART_GENERATION.md`): `composeMcPortrait(look, expr)`, `composeMcToken(look, style)` and `composeMcPose(look, style, pose)` each return a canvas the size of the matching packed canvas. Each layer is fetched and decoded once; each composed picture is cached by look (up to 64), so drawing it again is free. The returned canvas is shared: draw it, do not change it. A missing layer is skipped and a missing base draws a plain head-and-shoulders shape. The pure parts (look checks, palette lookup, layer ids, the per-pixel recolor) are in `look.ts` and `recolor.ts`, tested in `tests/mc-look.test.ts` and `tests/mc-recolor.test.ts` (against pixels decoded by the Python build).

Measured in headless Chromium on the dev page: composing a 384 portrait from loaded layers takes about 3.5 ms, 17 ms with the CPU slowed four times and 25 ms at six times (a phone-class device). The first draw of a look, with fetching and decoding of its layers, took 40 to 90 ms unthrottled and 160 to 300 ms at four times slower with seven pictures loading at once.

On the map, the battle route composes the MC's token for their look and style before Phaser starts and hands a copy to the scene, which registers it as the texture `token.mc` and uses it for the player's lord unit, with the same baked outline and hit flash as other tokens. A quick battle (`quick=1`) uses the default look. The unit card shows the MC's face, cut from the neutral portrait, beside the name and HP.

`#/dev/mc` shows the newest saved campaign's look (or a random one; `#/dev/mc?seed=N` picks one) as the portrait in four expressions, the token in three styles and all twelve battle poses, with Randomize and first-draw times. It sets `window.__mc.timePortrait(runs)` for timing. The battle scene composes the four poses of the MC's style when the MC first fights (see Battle scenes).

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
| `scene()` | The id of the mid-battle scene on screen, or null. While one is up, `isBusy()` is true. |
| `fight()`, `cutIn()` | The battle scene on screen (kind, power, fighters, total length, steps), and the cut-in's power name, or null. |
| `setSceneMode(mode)` | Full, Fast or Off, as the Scenes button. |
| `setResolve(unitId, value?)`, `patch(fn)`, `act(action)`, `slowScenes(factor)` | Test only: fill a gauge, change the state between actions, play a validated action directly, stretch scene time for frame captures. |

URL overrides (query or after the hash route): `seed=N` fixes the seed of every battle, campaign ones included; without it each battle seeds from the clock. `quick=1` on the battle route (`?test=1&quick=1&seed=7#/battle`) plays an unsaved quick battle, which also takes `style=vanguard|duelist|spiritblade`, `difficulty=normal|hard|lunatic`, `mode=classic|casual`, `map=<id>` (any map in `gameData.maps`; an unknown id plays the first chapter's map) and `scenes=1` (show mid-battle scenes; quick battles skip them otherwise). Without `quick=1` and without a campaign run (for example after a page reload), the battle route goes back to the title, where Continue resumes the suspended battle.

`window.__camp` (also `test=1`) is the camp's hook: `campaign()`, `grant(gold, shards)`, `setFlag(flag, value)`, `lock(facilities)` and `saved()` (`docs/CAMP.md`). `e2e/camp.spec.ts` plays the camp loop with it from a prepared save, and saves screenshots when `SHOTS=<dir>` is set.

`e2e/battle.spec.ts` uses the hook on a quick battle to play a turn by taps (select, move, wait, end turn, forecast, attack, enemy phase) and to play the whole prologue to the victory screen. `e2e/story.spec.ts` covers the intro, skipping, mid-battle scenes over the map, resuming in the middle of a scene and talking to recruit; `e2e/saves.spec.ts` plays the prologue through its outro and choice. The e2e helper `idle` skips any mid-battle scene that comes up unless told to stop at it.

## Camp

`#/camp` is the hub; `#/camp/forge`, `#/camp/merchant`, `#/camp/barracks` (and `#/camp/barracks/<unit>`), `#/camp/warmap`, `#/camp/deploy/<story or skirmish id>` and `#/camp/talk/<scene>` are its screens. They read the camp session (`src/ui/saves.ts`), which the flow sets when it reaches camp; every rule is in `src/camp` and each accepted change is saved to the slot at once. Without a session (a reload) the route goes to the title, whose Continue lands back in camp.

- Hub: the camp backdrop (the latest camp's, darkened at the top and fading into the page), Title and Save top left, the gold and shard chips top right, the Camp ribbon with "Next: Chapter 1 · Hunted", and the company either side of a small campfire drawn in CSS (the flame flickers unless reduced motion). Below, the four facilities as 2 by 2 plates (icon, name, a line of what is waiting; a locked plate is dimmed and says when it opens), then By the fire: campfire scenes with a New tag until read. In landscape the scene takes the left 44 percent and the facilities scroll on the right, each plate with its icon to the left.
- Facility screens use the menu screen frame (ribbon title, back to Camp) with the purse as two compact chips in the header, so it stays in view.
- Forge: tabs Blades and Weapons. A blade card shows the bearer's medallion, the name, three tier diamonds and the tier name, its powers, the next tier (new power, stat boost, the blood price in crimson, the shard cost and the condition with a check or cross), Awaken (a confirm first), and later tiers as locked lines. Weapons lists each generic weapon the company owns, its holder and what the next rank does (Mt 5 to 6), with the gold to forge it.
- Merchant: tabs Buy and Sell. Buy picks who it is for (each party member with free slots, or the convoy), then Weapons and Items as rows with the price; a ring per party member shows who can wield each weapon (green when they can). A tapped row opens: its numbers, the comparison with the chosen member's weapon (green up, red down) and Buy for N. Sell lists each member's inventory and the convoy with the price paid; blades say Keep and the weapon in hand cannot be sold.
- Barracks: the roster as framed cards (medallion, name, Lord, blade tier, Wounded and Stays in camp tags, class, level, HP and weapon) with up and down buttons; the convoy in a line; The fallen in Classic. A unit's sheet: medallion, class and level, XP bar, tags, the stats it grows best in, Keep in camp or Send to battle, a 3 by 3 stat grid, its blade, its inventory (Equip, Store; a blade shows Bound) and the convoy (Take), with Previous and Next.
- War map: a vertical route of round nodes joined by a gold line: done chapters with a check, the next one a crimson diamond with March (or "Coming soon" in a dashed box while its map is missing) and its side skirmishes beside it as framed cards (blurb, pay, bonus, "2 of 3 left this chapter", Lore tag, Fight), later chapters dimmed.
- Deploy: the map's name, "N of M deploying" and, for a skirmish, the foes' level and the map's own allies; each unit's row with its status (Must go, Deploying, Stays in camp, Wounded, No room), Stay or Send, and a move up button; then Begin (a story chapter: its intro) or To battle (a skirmish: its lore scene the first time).

## Dialogue

`Dialogue` plays one scene through the pure runner (`src/story/runner.ts`); it holds no story rules. Props: the scene, the text context (MC name, pronouns, world names), the story context for conditions, the speakers, the MC's look, `overlay` for a mid-battle scene, and `onDone` with the flags the choices set.

- Layout at 375 x 667: the tools (Auto, Log, Skip, each 44 px tall) top right; two portrait slots standing on the text box, left and right, about 230 px square; the framed text box at the bottom with the name plate (crimson plate art) over its top edge on the speaker's side. The speaker is lit; the other slot is darkened and slightly smaller. The art faces the viewer's right, so the right slot is mirrored to face the middle. In landscape on a phone the portraits stand at the sides and the box sits between them. At 320 px the box padding and text shrink a little; a 16 character name and a three line line still fit.
- Portraits: the MC is composed from their look in the line's expression (`McPortrait`); others are `portrait.<sheet>.<expr>` with the neutral fallback (`speakerPortraitId` in `artMap.ts`); anyone without art is a silhouette drawn in SVG.
- Text: Alegreya at 17 px, 1.42 line height, wrapping anywhere a word is too long. A typewriter reveals each line at 26 ms a character; the rest of the line is laid out but hidden, so the box never changes size as it types. A tap (anywhere outside the tools, or the Next arrow) shows the whole line, and a tap on a whole line goes on. Enter and Space do the same on a desktop. Under reduced motion lines appear whole, and shake, flash and the portrait slide are off.
- Narration is italic in dim bone with no plate. The blade's voice has no plate and no portrait: centered, spaced, cold blue italic text with a faint glow, in a darker box without the iron frame.
- Choices replace the box: two or three full-width plates at least 52 px tall.
- Log lists every line so far (speaker, text, and the answers picked), styled like the box. Skip asks first ("Skip this scene?", Keep reading or Skip) and then runs to the next choice or the end; a choice is never skipped. Auto, off by default, goes on 1.3 s plus 22 ms a character after a line is shown.
- Effects: shake moves the portraits and backdrop for 380 ms, flash is a white fade, fadeOut and fadeIn darken the whole scene (it stays dark until a fade in).
- Standalone scenes show their backdrop (`backdrop.<id>`, darkened by a gradient; a missing one is a plain dark gradient). Over the battle map the backdrop is replaced by a veil that keeps the map visible and darkens the top bar.

The story route keys each scene by its id and the number of scenes left, saves after each, then goes to the battle, the next scene or the chapter complete screen. Title shows Continue for a suspended battle, or else for the campaign played last when it has a scene or a battle to play ("Name · Prologue · Story"). The chapter complete screen lists each unit's weapon and says "To be continued" when the next chapter has no map.

## Items in the battle UI

Items opens a panel listing the inventory: each weapon with Equip (Equipped for the one in hand; disabled with the reason when the class cannot wield it) and each item with Use (disabled with the reason, such as "not wounded"). Use sends the item action from the previewed tile (`use:<index>`), which ends the unit's turn. Equip is free (`equip:<index>`): the controller applies it at once without playback or a stage sync (the token stays on its previewed tile), checkpoints it, and the menu comes back on the same tile, so the next forecast uses the new weapon. Back returns to the menu. With four or more orders in a row, the order buttons drop their icons so every word fits at 375 px.

## Powers in the battle UI

The action menu lists Power for every bearer whose blade has a built power (`powerOptions` in `selection.ts`; an Awakened blade has two, shown side by side, the second sent as `power:<id>`). It is a full-width plate under Attack, Wait and Cancel with the power's name (an Echo shows what it would re-cast, "Echo: Devour") and the gauge; when it cannot fire it is disabled and says why ("Resolve 70/100", or "No target in reach"). Power goes to `target` with the power mode: a unit-aimed power pulses its targets and shows "Devour: tap a red target."; a line power shows every valid line in red and a pad of four direction buttons (only valid ones enabled), and a tap on any tile of a valid line picks that direction. Then `powerConfirm` shows the power forecast: a fighting power reuses the combat forecast table, Scatter lists each target in the line with HP before and after, damage, hit and crit; notes under it give Devour's heal and kill bonus, Echo's repeat strike, or "No counters". Back steps back to aiming.

The unit card of a bearer shows a line with the powers' names (or "sealed" for one not built) and the Resolve gauge, and Silenced or Pinned tags for statuses. Bearer tokens carry a thin gold Resolve strip under the HP bar, bright with a pale rim when full. The power forecast adds notes for a status (on a hit, or hit or miss), Cleave's splash (its targets listed under the fight) and the blood price.

An Awakened bearer glows: a breathing pale ring around its medallion (steady under reduced motion) on the unit card, forecast, battle scene HUD and every camp screen; a pale halo and ring under its map token's base; and a cold glow along each of its strikes in the battle scene. Pin throws a needle like Scatter's.

The victory screen shows the spoils under the turn count: gold and Blade Shards earned, each bonus objective met (a check and its pay) or missed (a cross, its pay struck through), and drops to the convoy. It scrolls when it does not fit.

## Battle scenes

When a fight resolves, the controller has already applied the action and checkpointed the result (the suspend save), so a scene can only show what happened: it never changes the state, and a skipped, failed or interrupted scene leaves the game correct.

- Grouping: while playing an action's events, the controller cuts out each scene's group with `sceneGroupEnd`: a fight from `combatStarted` to `combatEnded` plus the falls right after it, a staff heal (`unitHealed` with cause `staff`), or a power from `powerUsed` to `powerEnded`. Other events play on the map as before. Level-ups and XP follow on the map after the scene.
- Timeline: `buildFightScript(group, facts)` (pure, `tests/fight-timeline.test.ts`) gives the fighters (side, slot, HP before, effect kind, school) and an ordered list of steps with start times and lengths at Full speed: `intro` (320 ms), then per strike `windup` (260), `strike` (130 melee lunge, 110 ranged), `projectile` (230, ranged only), `impact` (300, plus a 60 ms hit-stop, 150 on a crit) or `miss`, `recover` (230) and a 90 ms gap; `defeat` (700) for falls; `heal` (650 for a staff, 520 for Devour's drain); `outro` (280). A plain melee exchange of two strikes is about 2.2 s. Scatter has one wind-up and throw, and its needles reach each shown target 110 ms apart.
- Sides: the player's side and allies stand on the left facing right; enemies on the right, mirrored. A staff heal puts the healer left and the target right. Scatter shows its bearer at the left edge and up to three targets across the right half, slightly smaller; more targets are counted in the HUD ("and 2 more in the line") and take their damage on the map.
- Motion: melee lunges across most of the gap and stops short of the foe; bows, magic and anything from two tiles stay back and fire (arrow, light bolt for tomes and spirit staves, censer smoke for talismans, needles for Scatter). Effects by weapon kind: slash arcs for blades and katanas, thrust lines for lances and daggers, chops for axes, bursts for shots. Colors by school: Heavy rust-orange, Swift teal, Arcane violet (the `--c-heavy`, `--c-swift`, `--c-arcane` tokens). A hit swaps the target to its hit pose with knockback, a white flash, sparks and the number (gold, bigger, "CRITICAL" and a screen shake on a crit). A miss shows "Miss" and a dodge hop in idle. A lethal blow holds the hit pose, then the fighter greys, sinks and fades with "<Name> falls". Devour ends with a red drain trail from the victim into the bearer and a green number; a staff with warm light rising around the target. Echo draws two pale afterimages carrying the bearer's strike on past it (every strike of an echoed power, and the fallback's repeat strike).
- Poses: every pose of a character shares its feet anchor (`anchorX`, `groundY` in the manifest), so a pose swap never jumps. Mirroring is a negative x scale around that anchor (flipX is ignored for canvas textures under WebGL, which the composed MC poses are). Art comes from `battleArt` in `artMap.ts`: the MC (a player lord of a combat style) is composed from their look; others use their sheet by unit id, then class (the same sheets as portraits); anything else gets a hooded team-colored silhouette that leans per pose with the same timing.
- Layout (`fightLayout`): portrait puts the scene in a band across the top 52 percent of the screen (at least 290 and at most 460 px), with the ground line at 88 percent of the band and fighters at 28 and 72 percent of the width, an idle figure 56 percent of the band tall (about 194 px at 375 x 667). The HUD lies under the band down to the bottom of the screen. Landscape fills the screen with the scene and lays the HUD over its bottom 112 px. The backdrop (the map's `backdrop`, else village) is scaled to cover the band with its ground row on the ground line. The map's bars are hidden (kept in layout, so the camera never moves) and the map scene is not drawn while a scene plays; afterwards `Stage.settle` snaps the tokens to the outcome without animation or camera moves.
- HUD: both fighters' names in team colors, medallion portraits, weapon and school icons and weapon name, HP that drains as hits land (`FightPlayOptions.onHp`, a CSS width transition), and Dmg, Hit and Crit from the forecast (a power's own numbers for its bearer, "No counter" for a side that cannot strike back). A power shows its name on a ribbon over the HUD; Scatter's targets are listed with small HP bars.
- Cut-in: before a power's scene, the bearer's angry portrait (the composed one for the MC) slides across a dark skewed band with the power's name in the display font and school-colored streaks, about 760 ms at Full. It plays with scenes Off too, at the Fast length.
- Settings: Full, Fast (half the time) or Off (map only, the old lunge). The Scenes button in the top bar cycles them and Settings has them; the choice is kept in prefs. The animation speed (1x or 2x) also scales scene time. Under `prefers-reduced-motion` scenes start Off until the player picks; if they turn them on, scenes play calm: no shake, flash, lunge, knockback or slide-in. Any tap during a scene (or cut-in) skips it to its end and makes the rest of that playback instant, as a tap on the map always has. Enemy-phase fights play scenes too.
- Loading: `FightStage.prepare` loads only the two fighters' poses (and the backdrop) just before the scene, composes the MC's four poses for their style, and decodes the HUD portraits; textures stay cached for the battle. A scene whose art fails is passed over to the map.

Measured in headless Chromium (software WebGL) at 375 x 667 and device scale 2, on the skirmish map: a scene for a new pair starts 35 to 185 ms after the action (the first MC fight composes its poses), and a pair seen before starts in the same frame. During scenes frames averaged 17.6 to 19.7 ms (median 16.7, 95th percentile 33.4, worst 33.4). With the CPU slowed four times: entry 165 to 550 ms for a new pair, frames averaged 28 to 32 ms (median 33.3, 95th percentile 33 to 50), with one 100 to 130 ms frame at the start of a scene for a new pair (the HUD's first render); the map drag measured 28.9 ms on the same setup. Hiding the map behind the scene halved frame time (median 33 to 16.7 ms unthrottled), and drawing each effect once at start removed a 100 ms frame on the first impact.

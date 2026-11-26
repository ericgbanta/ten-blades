# Generating art

Every image in Ten Blades is made the same way, so the game keeps one look. The process is borrowed from DracoQuest. The style is not.

## The style

Eric picked it on 2026-11-26 from four samples: "A", a dark fantasy graphic novel look. Inked black lines of varying weight, flat two-tone cel shading with hard shadow shapes, heavy solid blacks, and a muted palette of charcoal, bone, rust and steel blue with at most one small accent color per character.

Two files pin it down, and every generation uses both:

| File | Role |
| --- | --- |
| `tools/art/style.txt` | The style paragraph that ends every prompt. Do not reword it per image. |
| `tools/art/anchor.jpg` | The style reference image (the Stranger sample), attached first to every generation. |

Styles Eric saw and did not pick: painterly anime with soft shading (B), a gothic woodcut look (C), and clean thin-line cel anime (D).

Shared looks so far: imperial troops wear ash-grey steel and black with a crimson tabard and a black sigil of a crown pierced by a sword. Militia recruits wear mismatched undyed gear with a faded teal scarf or armband.

## The tool

Images come from the Codex CLI's built-in image tool on Eric's ChatGPT subscription. Image turns use his Codex limits quickly, so tell him how many images a task needs and get his go-ahead before generating.

Setup, once per session:

1. The session's cloud environment must allow `chatgpt.com`, `auth.openai.com` and `api.openai.com` (the "dracoquest" environment does).
2. `npm install -g @openai/codex`
3. Run `codex login --device-auth` in the background, read its output, and give Eric the link and the one-time code. The code expires in 15 minutes. Never ask for a password or key in chat.
4. `codex login status` should say "Logged in using ChatGPT".
5. When finished: `codex logout`.

## Making images

Work in a scratch folder that holds a copy of `tools/art` (`style.txt`, `anchor.jpg`, `run.sh`, `prompts/`) plus empty `out/` and `refs/` folders.

1. Write `prompts/<name>.txt`. Every prompt tells Codex to use the built-in image tool, save to `./out/<name>.png`, and not draw with code. It says the first attached image is the style reference only, describes the subject, and ends with the contents of `style.txt`.
2. To keep a character on model, copy its sheet from `tools/art/sheets/` to `refs/<name>.png` (any image format works under that name). `run.sh` attaches it as the second reference. The prompt should say "the SAME character as the second attached image".
3. `./run.sh <name> ...` generates the named images, five at a time, and skips any that already exist. Each takes one to two minutes.
4. Look at every result before using it.
5. Art that needs a transparent background is generated on flat `#00ff00` green and cut out by `tools/art/pack.py` (see below). Character sheets are on grey because they are only references.
6. Packing writes every finished file into `src/art/assets.json`; do not edit that file by hand for packed art.

Gotchas carried over from DracoQuest: `codex exec` waits on stdin, so `run.sh` adds `< /dev/null`. `-i` takes several files, so `--` goes before the prompt. The image tool cannot make transparent backgrounds. Raw PNGs are about 2 MB each and are not committed; character sheets are kept as JPEGs in `tools/art/sheets/` because later generations need them as references.

## Packing

`python3 tools/art/pack.py <raw_dir> [names...]` turns the raw green-screen PNGs in `<raw_dir>` into WebP files under `src/art` and merges their entries into `src/art/assets.json` (sorted keys, so reruns give the same file). With no names it packs every sheet it finds; names limit it to a character (`archer`) or a group (`poses`, `expr`, `busts`, `tokens`). It needs numpy, scipy and Pillow, takes a few seconds, and writes a report, `tools/art/packed.json`, with each image's size, bytes and placement.

The raw sheets expected, by name:

| Raw file | Contents |
| --- | --- |
| `poses-<id>.png` | 2x2 battle poses, facing right: idle, windup, strike, hit (reading order). Ids: stranger, gravemaw, captain, soldier, ranger, adept, medic, legionary, hunter, inquisitor, archer. |
| `expr-<id>.png` | 2x2 bust expressions: neutral, angry, hurt, smile. For stranger, gravemaw, captain. |
| `busts-militia.png`, `busts-imperial.png` | 2x2 neutral busts: soldier, ranger, adept, medic; legionary, hunter, inquisitor, archer. |
| `tokens-named.png`, `tokens-militia.png`, `tokens-imperial.png` | One row of chibi map tokens: stranger, gravemaw, captain; the four militia; the four imperial. |
| `tiles-<set>.png` | A 4x2 grid of square terrain tiles on `#00ff00` green with green gaps, in order plain, road, forest, hill, fort, village, water, wall. Set so far: `village`. |
| `tiles-village2.png` | 4x2 variant tiles: plain (bare earth), plain (flowers), forest (pines and log), forest (pines and dead tree), hill (ridge), water (reeds), village (cottage with woodpile), village (barn). |
| `tiles-connect.png` | 4x2 flat connector tiles seen from straight above: road straight (east to west), road crossroads, wall straight, wall junction with pillar, shore edge (bank along the top), shore corner (bank in the top left), wooden bridge (east to west), ford. |
| `props-village.png` | 4x3 cut-out props with a small contact shadow: fence, cart, barrels, rubble; banner, well, haystack, dead tree; campfire, signpost, gravestones, wheel. |
| `backdrop-<name>.png` | One full-screen battle backdrop. Names so far: `village`, `forest`, `ruin`, `town`, `camp` (`BACKDROPS` in `pack.py`). |

How it works. Keying: the amount by which green exceeds red and blue says how much of a pixel is background, edge pixels are unmixed from the green (so no fringe or halo, and the anti-aliased edge stays), and enclosed pockets that reach strong green anywhere are keyed too (between an arm and the body, hair gaps). A pale yellow-green glow never reaches that level, so lantern light survives. Splitting: each connected piece goes to the grid cell that holds most of it, so a long weapon, a flying arrow or a smoke wisp stays with its character; specks under 40 px are dropped and reported. Specks and straddling pieces are printed as the script runs.

Output layout and size rules:

| Folder | Files | Canvas |
| --- | --- | --- |
| `src/art/battle/` | `<id>-<pose>.webp`, poses idle, windup, strike, hit | 512 x 384 for every character. The idle body is scaled to 240 px tall (`IDLE_HEIGHT` in the script overrides one character) and all four poses use that one scale. Feet baseline at y 360, feet center at x 192 on every pose, so poses swap or tween without jumping. |
| `src/art/portraits/` | `<id>-<expr>.webp`; generic units only `<id>-neutral.webp` | 384 x 384, bust cropped tight, bottom aligned and centered, one scale per character. |
| `src/art/tokens/` | `<classId>.webp` | 192 x 192, bottom centered with an 8 px margin. Reads at 48 px on a 2x or 3x screen. |

Tiles and backdrops are not keyed. `pack_tiles` finds the tile rectangles from the runs of non-green columns and rows (it stops if it does not find 4 by 2), insets each by 4 px to drop edge fringe, and resizes to 96 x 96 WebP; the map draws a tile at about 46 CSS px, so 96 is 2x on a 2x screen. `pack_backdrop` resizes to 1152 x 768. Run `python3 tools/art/pack.py <raw_dir> tiles backdrops` (or `village` for one set).

| Folder | Files | Canvas |
| --- | --- | --- |
| `src/art/tiles/` | `<terrainId>.webp`, one per id in `src/data/terrain.json` | 96 x 96, opaque |
| `src/art/backdrops/` | `<name>.webp` | 1152 x 768, opaque |

Ids in the manifest: `battle.<id>.<pose>`, `portrait.<id>.<expr>`, `token.<classId>`, `tile.<terrainId>` and `backdrop.<name>`, plus the map pass's `tile.<terrain>.<n>`, `tile.<connector>`, `piece.<group>.<name>` and `prop.<name>` (below). Battle and portrait ids use the sheet id (stranger, gravemaw, captain, soldier, and so on). Tokens use the class id the map asks for: the Stranger is `token.wanderer`, the Hunter-Captain is `token.hunter_captain`, and Gravemaw's bearer, who has no class yet, is `token.gravemaw_bearer`. Each entry holds `path` (relative to `src/art`), `width`, `height` and `bbox` ([x, y, w, h] of the visible art); battle entries add `groundY`, `anchorX` and `scale`. `imageUrl(id)` gives the bundled URL and `imageMeta(id)` the entry. `src/art/manifest.ts` bundles every `.webp` under `src/art` with `import.meta.glob`, so new folders need no change there. `tests/art-manifest.test.ts` checks every entry's file exists and ids are well formed.

### Map tiles, pieces and props

`python3 tools/art/pack.py <raw_dir> map props tiled` packs the map art added in the map pass (it needs `tiles-village.png` too, as the color reference). All tile work happens at 384 px, four times the packed size, and is reduced to 96 at the end.

- Variants: `tiles-village2.png` becomes `tile.<terrain>.<n>` (`tile.plain.2`, `tile.plain.3`, `tile.forest.2`, `tile.forest.3`, `tile.hill.2`, `tile.water.2`, `tile.village.2`, `tile.village.3`). `tile.<terrain>` stays variant 1.
- Connectors: `tiles-connect.png` becomes `tile.road.straight`, `tile.road.cross`, `tile.wall.straight`, `tile.wall.cross`, `tile.shore.edge`, `tile.shore.corner`, `tile.bridge` and `tile.ford`. `tile.bridge` and `tile.ford` are also the terrain tiles for those terrains (the Tiled tileset and the fallback use them).
- Pieces: overlays with soft alpha cut from the connectors, which the map turns and stacks per cell (see `docs/UI_NOTES.md`). `piece.road.straight` and `piece.road.arm` (the road band, whole or from the center to the east edge, moved so the band sits exactly on the middle row and turns cleanly), `piece.road.hub` (plain dirt from the crossroads center) and `piece.road.lip` (the north ink edge of the road, a little wider than the hub). `piece.wall.east` and `piece.wall.west` (halves of the straight wall, moved onto the junction's horizontal wall), `piece.wall.north`, `piece.wall.south` and `piece.wall.post` (from the junction tile; walls are never turned, because the art shows the wall's south face). `piece.shore.bank` (bank and inked lip along the north edge), `piece.shore.land` (the bank without the lip) and `piece.shore.inner` (the quarter-round bank). `piece.bridge.deck` (the planks) and `piece.ford.deck` (the five stepping stones and their ripple rings), both centered on the middle row. Walls are found as the rows or columns that are mostly not grass; roads by red over green; water by blue over red.
- Color matching: the two new sheets came out a little off the first tileset (the variants about 6 levels brighter and warmer in red, the connectors about 3 levels darker), which showed as a checkerboard where tiles from two sheets met. The packer fits, per sheet and per channel, an affine map that gives the sheet's grass pixels the mean and spread of the reference plain tile, and another for water against the reference water tile (spread changes are limited to 8 percent either way so ink and contrast stay). Each pixel takes the water map in proportion to how blue it is. The shifts are printed and stored in `tools/art/packed.json` under `_map_tiles`.
- Props: keyed like characters, split 4x3, cropped and scaled by one shared factor (`PROP_SCALE`, with a few per-prop factors in `PROP_SCALE_BY`), then placed bottom centered on a 96 or 128 px canvas with 4 px under the contact shadow. Each `prop.<name>` entry has `anchorX` and `groundY`, the point the map puts on the lower middle of a tile. Which terrain each prop may stand on, and whether it is small or tall, is in `src/data/props.json`.
- Tiled: `tiled` writes `tools/maps/tiles.png` (one base tile per terrain, in `terrain.json` order) and `tools/maps/tiles.tsj`, the tileset for drawing maps (see `docs/MAPS.md`).

| Folder | Files | Canvas |
| --- | --- | --- |
| `src/art/tiles/` | `<terrain>-<n>.webp`, `road-straight.webp` and the other connectors, `piece-<group>-<name>.webp` | 96 x 96; tiles opaque, pieces with alpha |
| `src/art/props/` | `<name>.webp` | 96 x 96, or 128 x 128 for a prop that does not fit |

## UI kit and icons

`python3 tools/art/pack_ui.py <raw_dir> [kit] [icons]` packs the UI kit and the two icon sheets. It imports keying, splitting, resizing and saving from `pack.py`, merges only `ui.*` and `icon.*` entries into `src/art/assets.json`, and writes its report to `tools/art/packed-ui.json`. It takes a few seconds.

| Raw file | Contents |
| --- | --- |
| `ui-kit.png` | 3 x 2: panel frame, dark button plate, crimson button plate; ribbon, medallion ring (green center), divider. |
| `icons-stats.png` | 4 x 3: hp, str, mag, skl; spd, lck, def, res; mov, heavy, swift, arcane. |
| `icons-items.png` | 4 x 3: greatsword, axe, lance, sabre; dagger, bow, tome, talisman; staff, shard, coins, tenblade. |

Packing notes:

- Icons are cropped tight and fitted to 96 x 96 with a 2 px margin, so the emblem stays as large as it can at 20 CSS px. They were checked at 16, 20, 24 and 28 px on the panel color: the stat and school icons read at 16 to 20, the thin diagonal weapons (sabre, lance, dagger, bow, staff) need 20 to 22, so the UI shows weapons at 20 or more. Smaller files were not crisper, since the browser downsamples the 96 px file well.
- The generated frame's edges each carry a rivet in the middle, so they could not stretch or repeat. `pack_ui.py` rebuilds the frame: the four 72 px corners are kept, each edge is made from one clean stretch of that side (between the corner plate and the rivet, source px 80 to 170) followed by its mirror image so it repeats without a seam, and the center is filled with the frame's own center color. It is scaled to 0.6 (194 px square, slice 43) and drawn about 15 px wide.
- The plates are kept as generated (scaled to 0.5, 216 x 74, slice 20 28 20 28) and stretch; their corners and gold line sit inside the slices.
- The ribbon keeps 77 px forked ends and stretches the middle (`slice` 0 77 0 77).
- The medallion is centered on a 192 px canvas and its entry records `hole` [cx, cy, r] for the portrait circle.
- The divider is scaled to 48 px tall, and the ten-blade star is also written at 192 px as `ui.emblem`.

Entries are the usual `path`, `width`, `height` and `bbox`; 9-slice entries add `slice` ([top, right, bottom, left] in image px, as `border-image-slice` takes it) and `repeat`, the frame adds `center` (its fill color). The set is 31 files, about 152 KB.

## The main character

The MC is built from layers, recolored at runtime to the look the player picks in the creator. The build is `tools/art/mc_build.py`; the runtime is `src/art/mc`.

### Key colors and sheets

Every MC sheet is drawn in key colors so the game can find each region: skin is a plain mid tan (the only warm hue), hair is royal blue, the accent cloth (neck scarf and waist sash) is red, and everything else is neutral (charcoal, grey, black, pale steel). Eyebrows are black ink and do not recolor. The text that says this to Codex is in `tools/art/prompts/mc-key.txt` and is repeated in every `mc-*.txt` prompt. Characters are drawn completely bald, and hair, faces and marks come from sheets that redraw the same bust with one thing changed.

There are two bodies, Lean (sheets `mc-*` and `mc-a-*`) and Broad (`mc-b-*`). Per body: a base sheet (bust, chibi, side view), three face sheets (2 x 2 expressions neutral, angry, hurt, smile; eye shapes almond, round, narrow), two hair sheets (2 x 2, hairs crop, shoulder, braid, topknot, then long, curls, ponytail, bob), a 3 x 2 scar sheet (cheek, brow, nose, claws, burn, tattoo), two chibi hair sheets, a sheet of three bald chibis (vanguard, duelist, spiritblade), and three pose sheets (2 x 2 idle, windup, strike, hit) per combat style. Both bodies share two side-profile hair sheets (`mc-hair-side`, `mc-hair-side2`), which put the hair on the battle poses.

### Building

`python3 tools/art/mc_build.py build <raw_dir>` writes every layer to `src/art/mc/<body>/` and replaces the `mc.` entries in `src/art/assets.json` (add `portraits`, `tokens` or `poses` to rebuild only those). It needs numpy, scipy, Pillow and opencv-python-headless, runs the jobs on four processes and takes about four minutes. `python3 tools/art/mc_build.py sheets` writes contact sheets made from the packed files (default folder `mcprod` in the session scratchpad), `fixture` writes `tests/fixtures/mc-recolor.json` for the recolor test, and `eval [raw_dir] [out]` still runs the first layer experiment and its evaluation sheets. A report of every registration is written next to the sheets as `build-report.json`.

How it works, briefly:

- Segmentation: each key region is found by hue, and every pixel is modelled as a mix of the region's flat color and the nearest neutral color (usually ink). Small specks of red inside the skin (a reddish shadow on a cheek) count as skin.
- Portraits: the twelve bald faces of a body are registered to its almond neutral bust. The body below the face is the same in all of them, so it ships once as the bust, and each face ships as a layer cut to the head and neck. Marks a sheet added that the reference face does not have are replaced by the reference's pixels (the broad narrow-eyed faces came with a scratch on the cheek). Hair layers are registered to the neutral bust and keep off the eyes, brows and mouth of all twelve faces. A shaved scalp becomes a translucent film. Scars are the difference from the neutral bust on the skin, with anything over a changing feature cut away. Every layer of a body uses one placement on the 384 x 384 canvas, bottom aligned like `pack.py` portraits.
- Tokens: each chibi hair is cut from its sheet against that sheet's bald chibi, then moved onto each style's bald chibi by registering the heads. One scale per body; 192 x 192, bottom centered with the 8 px margin.
- Poses: as `pack.py`, one scale per pose sheet with the idle body 240 px tall, feet on y 360 at x 192, on 512 x 384. The side hair heads are registered to the topknot head, which is fitted to each pose's head by shape (rotation kept to a plausible range per pose), thickened to the body's line weight and kept behind steel and hands. The Spiritblade's white light burst is neutral and stays.

### Runtime format

Each layer is two WebP files over the same rectangle of its canvas: the art (lossy, alpha lossless) holds the neutral part of every pixel, and `<name>.data.webp` (lossless) holds, per pixel, the region membership t, the tone u within the region and the region code. The game recolors with one table lookup and one blend per pixel: `out = N + t * (LUT[region][u] - N)`, where the table is the palette tone at u (base at 0, shadow at 1). Nothing is guessed from hue at runtime, so lossy compression of the art cannot shift a region, and the data compresses well because it is flat inside each region. This was chosen over shipping key-color art and classifying hue in the browser (edges drift, needs lossless art and the segmentation logic in TypeScript) and over per-region grayscale layers (three to four images per layer). Palettes are in `src/data/looks.json`.

Manifest ids: `mc.<body>.bust`, `mc.<body>.face.<eyes>.<expr>`, `mc.<body>.scar.<scar>`, `mc.<body>.hair.<hair>.portrait`, `mc.<body>.token.<style>`, `mc.<body>.hair.<hair>.token.<style>`, `mc.<body>.pose.<style>.<pose>` and `mc.<body>.hair.<hair>.pose.<style>.<pose>`. Each entry has the usual `path`, `width`, `height` (the canvas) and `bbox`, plus `layer` with `encoding` ("mc1"), `rect` and the `data` path; pose entries add `groundY`, `anchorX` and `scale`. The set is 651 files, about 2.2 MB.

## What exists

| Batch | Generations | Result |
| --- | --- | --- |
| Style samples A to D | 4 | A chosen; it is the anchor and the Stranger's sheet |
| Character sheets (bust, front, side) | 11 | Gravemaw's bearer, the Thousand Needles thief, the Hunter-Captain, Soldier, Ranger, Adept, Medic, Legionary, Hunter, Inquisitor, Archer. All usable first try. |
| Thief rework (sheet 1), pose sheets (11), expression sheets (3), generic bust sheets (2), token sheets (3) | 20 | All usable first try. Packed by `tools/art/pack.py` into 75 WebP files (44 battle poses, 20 portraits, 11 tokens), about 1.5 MB. |
| Thief and Adept follow-up | 7 | The thief's expressions, poses and token from the reworked sheet. The Adept redone as a fair-haired young man with spectacles (sheet, poses, bust, token), because the first one looked like the Ranger and the Stranger. The thief is packed shorter than the adults (`IDLE_HEIGHT` in `pack.py`). All usable first try. |

| Village tileset 1 | 1 | The eight terrain tiles (`tile.plain` to `tile.wall`). Usable first try. |
| Village battle backdrop 1 | 1 | `backdrop.village`, kept in the manifest for the later battle scene phase. Usable first try. |

| MC test (Lean body: base, faces, two hairs sheets, chibis, side hair, vanguard poses) | 6 | All usable first try. Judged good enough to build the full set. |
| MC full set (eye shapes, hairs 5 to 8, scars, chibi styles and hairs, duelist and spiritblade poses, the whole Broad body, side hairs 5 to 8) | 22 | All usable first try. 28 MC generations in total. Built by `tools/art/mc_build.py` into 651 files, about 2.2 MB. |

| Tile variants 1 (`tiles-village2`) | 1 | Eight variants. Usable first try. Grass about 6 levels brighter than the first tileset, corrected in the packer. |
| Connectors 1 (`tiles-connect`) | 1 | Road, wall, shore, bridge and ford tiles, flat and centered as asked. Usable first try. Grass about 3 levels darker, corrected in the packer. The road band sat 12 px (of 384) below center and is moved by the packer. |
| Props 1 (`props-village`) | 1 | Twelve props. Usable first try. |
| UI kit 1 | 1 | `ui-kit.png`: panel frame, dark and crimson button plates, ribbon, medallion ring, divider. All used; the frame was rebuilt for 9-slice (see UI kit and icons below). |
| Icon sheets (stats and schools, items) | 2 | `icons-stats.png` and `icons-items.png`, twelve icons each. All usable first try. |
| Backdrops and the stone tileset (`backdrop-forest`, `backdrop-ruin`, `backdrop-town`, `backdrop-camp`, `tiles-stone`) | 5 | All usable first try. The four backdrops are packed as `backdrop.forest`, `backdrop.ruin`, `backdrop.town` and `backdrop.camp` (about 280 KB); maps name theirs with the `backdrop` field and dialogue scenes by id. `tiles-stone.png` is not packed yet: phase 7 packs it with the chapter maps. |

The battle scenes draw each backdrop scaled to cover the scene's band with its row at 86 percent of the height on the fighters' ground line (`BACKDROP_GROUND` in `src/game/fightLayout.ts`), which lands their feet on the dirt or flagstones of all five.

Not made yet: other tilesets.

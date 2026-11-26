# Drawing maps in Tiled

Maps are drawn in Tiled, a free map editor, and converted into the game's JSON with `npm run maps`. The game only ever reads `src/data/maps/<id>.json`; the Tiled files in `tools/maps/src/` are the editable source. The JSON format itself is described in `docs/CORE_API.md` under "Map files".

## Installing Tiled

Download Tiled from mapeditor.org (Windows, macOS and Linux builds; on Linux the AppImage or Flatpak works, and many distributions package it). Version 1.9 or newer reads the files here. Nothing else is needed: the import runs with the repo's own tools.

## The files

| Path | What it is |
| --- | --- |
| `tools/maps/tiles.tsj` | The terrain tileset: one tile per terrain id, in `src/data/terrain.json` order. Each tile's class (type) and its `terrain` property name the terrain. |
| `tools/maps/tiles.png` | The tileset image, made from the packed tiles by `python3 tools/art/pack.py <raw_dir> tiled`. Rebuild it after adding a terrain. |
| `tools/maps/src/<id>.tmj` | One Tiled map per game map. |
| `tools/maps/tiled.ts` | The conversion both ways, and the prop checks. |
| `tools/maps/import.ts` | `npm run maps`: Tiled to game JSON. |
| `tools/maps/export.ts` | `npx tsx tools/maps/export.ts <id>`: game JSON to Tiled, for a map made before this workflow. |
| `src/data/maps/<id>.events.json` | The map's scripted events. Not in Tiled: see Events below. |

The tileset only holds the base tile of each terrain. The stone set (cobble `o`, flagstone `_`, building `X`, stall `S`, rubble `r`, canal `c`, gate `G`, crates `C`) is drawn one tile per cell with no joins, except that walls join gates and houses, and a bridge with a canal on its east or west side is drawn as the canal tile with the planks across it. Canals only run east to west, since the tile's stone lips are on its top and bottom edges. Variants, roads, walls, shores and crossings are drawn by the game from the terrain alone, so paint road where the road goes and the game joins it up.

## Making a map

1. In Tiled, File, New, New Map: orthogonal, tile layer format CSV (the import does not read Base64), tile size 96 by 96, fixed size, the width and height you want in tiles. Save it as `tools/maps/src/<id>.tmj` (JSON map format).
2. Map, Add External Tileset, and pick `tools/maps/tiles.tsj`. It must be the only tileset and must stay external (not embedded), so the import can find it.
3. Paint the terrain on one tile layer named `terrain`. Every cell needs a tile. Flip and rotation flags are ignored.
4. Add an object layer named `units`. Put a point object on each starting tile. Its class (type) says what it is:
   - `mc`: the main character's start. Exactly one. Optional string properties `weapon.vanguard`, `weapon.duelist` and `weapon.spiritblade` give a main character the battle creates (one with no lord in the party, such as the quick battle) that weapon for its style; `skirmish_test` uses them to hand over Widow's Hush.
   - `party`: a deploy slot filled from the player's party, in layer order.
   - `unit`: a fixed unit. Its name is the unit's display name, and it has custom properties `id` (string, unique on the map), `classId` (a class in `classes.json`), `team` (`player`, `enemy` or `ally`), `level` (int), and optionally `weaponId` (string), `ai` (`charge`, `hold` or `guard`; needed for enemies and allies unless the unit is a boss), `radius` (int, for guard), `guardTile` (string `x,y`, for guard; defaults to the start tile), `isBoss` (bool), `isLord` (bool) and `tags` (string, a comma list such as `recruitable,gate_guard`, for event triggers).
5. Reinforcements: one more object layer per wave, named `wave 1`, `wave 2` and so on, with layer properties `turn` (int: the wave arrives at the start of that turn's enemy phase) and `difficulties` (string, a comma list such as `hard,lunatic`; all three when left out). Its objects are `unit` objects as above.
6. Props: an object layer named `props`. Each point object's class (type) is a prop id from `src/data/props.json` (fence, cart, barrels, rubble, banner, well, haystack, dead_tree, campfire, signpost, graves, wheel). A prop may only stand on the terrains listed for it there, and a tall prop may not stand on a unit's start tile. Props are decorative: units can still walk onto their tile, and a tall prop fades while a unit stands there.
7. Map properties (Map, Map Properties, custom properties): `id` (string; defaults to the file name), `name` (string, shown in game), `objective` (`rout`, `defeatBoss`, `survive`, `escape` or `protect`; defaults to rout), and as the objective needs: `objectiveTurns` (int, for survive and protect), `objectiveUnit` (string unit id, for protect), `objectiveTiles` (string `x,y;x,y`, for escape), and optionally `backdrop` (string, a backdrop id such as `forest`: the art `backdrop.<id>` behind the side-view battle scenes; village when left out).

An object's tile is the tile under it: for a point object the point, for a tile or shape object its middle. Snap to the grid (View, Snapping) to place points on tile centers.

## Importing

Run `npm run maps` to convert every map in `tools/maps/src/`, or `npm run maps -- prologue` for one. Each map is checked with the core's `validateGameData` (unknown classes or weapons, units on impassable tiles, a missing MC slot, objective rules) and the prop rules, and only written to `src/data/maps/<id>.json` if it passes; otherwise the problems are printed and nothing is written. The JSON is written in a fixed layout (one row of tiles, one placement and one prop per line), so re-importing an unchanged map changes nothing.

A new map also needs a line in `src/data/index.ts` to join `gameData.maps`, and a chapter entry if it is part of the story.

`tests/maps-tiled.test.ts` imports every `.tmj` file and checks the result matches the shipped JSON byte for byte, so a map edited in JSON and not in Tiled (or the other way round) fails the tests until the two agree. The prologue was exported from its hand-written JSON with `export.ts`, and importing that export reproduced it exactly.

## Events

A map's scripted events (mid-battle scenes, reinforcements from a trigger, talk to recruit, flags) are not drawn in Tiled. They live in a sidecar file, `src/data/maps/<id>.events.json`: a JSON list of events in the format of `docs/CORE_API.md` (Scripted events). The import only ever writes `src/data/maps/<id>.json`, so redrawing a map in Tiled and importing it never touches its events. `src/data/index.ts` merges the two when it builds `gameData`.

Events refer to the map by unit id, tag and tile. The import checks the new map together with its existing events file, so if a redraw removes or renames a unit an event names, or moves the edge of the map past an event's tiles, the import reports it and writes nothing. Give units that events match as a group a `tags` property in Tiled.

A new map with events needs its events file imported in `src/data/index.ts` beside the map (the `withEvents` helper). A map with no events needs no file.

## The story maps

| Map | Size | Backdrop | Objective | Notes |
| --- | --- | --- | --- | --- |
| `prologue` | 10 x 12 | village | Rout | The tutorial. |
| `chapter1` (The River Road) | 13 x 18 | forest | Escape: the MC ends a move on (5, 0) or (6, 0), where the road leaves the north edge | A river across the middle with one bridge on the road and a ford to the east. The party starts at the south edge; hunters hold the bridge, the ford and the north road. The old fort (west, rows 11 and 12) holds Tobin and Marra as allies until a player unit enters x 0 to 3, y 9 to 13 or turn 3 begins. Waves: two hunters from the south on turn 2; a legionary and an archer on turn 3 (Hard and Lunatic); two hunters from the sides on turn 4 and an archer from the north west on turn 5 (Lunatic). |
| `chapter2` (The Hollow Fort) | 14 x 16 | ruin | Rout | A walled ruin with a gate in the south wall, breaches in the west (2, 5) and east (11, 7) walls, rubble inside and the keep (fort tiles) at the top. Garrow guards the keep. Waves: two hunters from the west on turn 3; a legionary and an archer from the east on turn 4 (Hard and Lunatic). |
| `chapter3` (Saltmarket) | 14 x 18 | town | Defeat the Hunter-Captain | Houses, a canal across the middle with two bridges (3, 8) and (10, 8), the market south of it with stalls and crates, a flagstone plaza, and houses along the north edge either side of the gate. Pell arrives at (12, 12) on turn 2. Waves: two hunters through the north gate on turn 3; a legionary and an archer from the canal banks on turn 3 (Hard and Lunatic); two hunters behind the party on turn 5 (Lunatic). |

The chapter maps were laid out as game JSON, exported to Tiled with `export.ts` and imported back, so their `.tmj` files are the source from now on.

Escape tiles are marked on the map with a gold frame and a chevron.

## Adding a terrain

Add it to `src/data/terrain.json`, give it a tile character in `TERRAIN_CHARS` in `tools/maps/tiled.ts`, pack its tile art as `tile.<id>`, and rebuild the tileset with `python3 tools/art/pack.py <raw_dir> tiled`. New tiles are appended in `terrain.json` order, so existing maps keep their tile numbers as long as terrains are only ever added at the end.

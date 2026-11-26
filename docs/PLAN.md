# Build plan

This plan takes Ten Blades from an empty repo to the first playable in `docs/DESIGN.md` (prologue plus 3 chapters). It is split into phases. Each one ends with something you can open on a phone.

The first working version is the end of phase 2: the prologue map, playable start to finish with placeholder art, live on GitHub Pages. Everything after that adds systems and content on top of a game that already runs.

## Decisions made for the plan

The design doc leaves some questions open. The build needs answers to a few of them now, so these are working defaults. Eric can change any of them, and each lives in data or one module so a change is cheap.

| Question | Working default |
| --- | --- |
| Who builds the code | Claude Code. Codex is used for art only. |
| Stack | TypeScript, Vite, Phaser 3 for the map and battle scenes, Preact for menus and dialogue over the canvas. |
| Level-ups | Fire Emblem style growth rates, rolled with the seeded RNG so a suspend save can't be rerolled. |
| Generic player classes (first build) | Soldier (lance, Heavy), Ranger (bow, Swift), Adept (tome, Arcane), Medic (healer, outside the triangle). |
| Enemy types (first build) | Legionary (Heavy), Hunter (Swift), Inquisitor (Arcane), Archer (Swift, ranged). Boss: the Hunter-Captain. |
| Promotion | Not in the first build. |
| Music and sound | Not in the first build. The code has a sound hook that does nothing yet. |
| Names | Placeholders in JSON (`[Emperor]`, "the Stranger"), so naming is a data edit. |

## Architecture

- `/src/core` is pure TypeScript with no DOM, Phaser or storage calls. It holds the rules: grid and pathfinding, combat math, the schools triangle, turn order, AI, objectives, leveling, powers, and the save shape. It runs under Vitest.
- `/src/data` holds every balance number and all content as JSON: classes, weapons, blades, units, maps, chapters, dialogue.
- `/src/game` is the Phaser layer: map scene, battle scene, camera, input.
- `/src/ui` is the Preact layer: title, creator, forecast panel, unit sheet, dialogue, camp, settings.
- `/src/art` holds images and `assets.json`, the manifest. Code loads art by id and draws a placeholder shape when a file is missing.
- A battle is a state object plus a list of actions. The core applies an action and returns the new state and a list of events (moved, hit, died, leveled). The Phaser layer plays the events. This is what makes the suspend save, the tests and the balance simulator simple: all three only need the state.
- All randomness goes through one seeded RNG whose state is part of the battle state.

## Phases

| # | Phase | What exists at the end |
| --- | --- | --- |
| 0 | Scaffold | Vite, TypeScript, Phaser, Preact, Vitest, ESLint, Playwright, the Pages deploy workflow, a title screen at a phone viewport. |
| 1 | Core rules | Grid, movement ranges, terrain, combat forecast and resolution, triangle, phases, three AI behaviors, objectives, XP and leveling, all tested with fixed seeds. A balance simulator script. |
| 2 | Battle map | The prologue map on screen. Tap to select, move, preview, attack, wait, end turn. Enemy phase plays out. Pan and pinch zoom. Win and lose screens. **First working version.** |
| 3 | Saves and modes | IndexedDB saves (3 slots plus suspend), suspend after every action, export and import code, new game flow with Classic or Casual and Normal, Hard or Lunatic. |
| 3.5 | Map and UI pass | Added 2026-11-26 at Eric's request, to run before the rest of the story layer. Maps: two or three variants per terrain, roads, walls and shorelines that join up with their neighbours, props drawn over tiles, the opening view framed properly at 375 wide, and maps drawn in Tiled and imported. UI: a panel and button kit, a display font, icons for stats, weapons and schools, and the unit card, forecast and menus reworked on that kit. About 6 to 10 Codex generations. |
| 4 | Story layer | Dialogue scenes with portraits, chapter flow from JSON, the character creator, talk to recruit, mid-battle events and reinforcements, story choices that set flags. |
| 5 | Battle scenes and powers | Side-view scenes tweened from four poses, particles drawn in code, speed-up and skip. Resolve gauge, Echo, Devour and Scatter, portrait cut-in. |
| 6 | Camp | Forge and awakening to tier 2, merchant, barracks and deployment, war map, one side skirmish. |
| 7 | Chapters 1 to 3 | Three more maps with their dialogue, recruits and objectives. Balance pass with the simulator on all three difficulties. |
| 8 | Art | Style samples for Eric to pick from, then the first build's art through the Codex process. Can start any time after phase 2 and run beside the code. |
| 9 | Finish | PWA install and offline, landscape, reduced motion, safe areas, full Playwright run, a pass on real mobile Safari and Chrome. |

A phase is done when `npm run test`, `npx tsc --noEmit`, `npm run lint` and `npm run e2e` pass, the work has been reviewed, and the result is pushed to `main`.

## How the work is run

One Claude Code session orchestrates. It writes the brief for each phase, hands the build to a subagent, and reviews what comes back before anything is called done.

- Opus builds the parts where a mistake is expensive: the core rules, the save format, the battle scene.
- Sonnet builds the scaffold, UI screens, content JSON and tests for existing code.
- A separate agent reviews each phase without being told what the builder concluded. The orchestrator runs the checks itself and plays the build in a phone-sized browser.
- Phases run one after another when they share files. Work that doesn't overlap (content JSON, art prompts, UI screens against a settled core API) runs in parallel.
- Commits are authored as Eric and pushed to `main`.

## Art

The process is DracoQuest's (`docs/ART_GENERATION.md` in that repo): the Codex CLI on Eric's ChatGPT subscription, signed in by device code, one fixed style paragraph, one anchor image attached to every generation, characters on flat green and cut out by a pack script, every file listed in a manifest. The look is not DracoQuest's. Ten Blades uses the style in the design doc: dark fantasy, illustrated portraits, chibi map tokens, side-view battle poses.

Steps, in order:

1. Write three or four candidate style paragraphs and generate one sample for each (the Stranger as a portrait, a token and a battle pose on one sheet). Eric picks one. That text becomes `tools/art/style.txt` and the chosen image becomes the anchor.
2. Make a character sheet per character, then generate that character's portrait expressions and battle poses with the sheet as the second reference.
3. Tokens and icons come as sheets of many small items.
4. The MC is built from layers on a shared template with palette masks, as the design doc says. This is the riskiest art task, because image models don't hold registration between separate generations. The first attempt will be a small test (one body, two hair styles, in all three views) before committing to the full set. If layers can't be made to line up, the fallback is a set of whole MC images per style with palette recoloring, and fewer hair options.

Rough count for the first build, in Codex generations:

| Set | Generations |
| --- | --- |
| Style samples | 4 |
| 12 characters (Stranger, 2 bearers, 4 classes, 4 enemies, boss), 3 each: sheet, portrait expressions, battle poses | 36 |
| Map tokens, as sheets | 4 |
| MC layers, all three views | 25 to 35 |
| 2 tilesets | 4 |
| Battle and camp backdrops | 5 |
| UI icons | 2 |
| Total | about 80 to 90 |

DracoQuest's redesign took 61 generations in a day and needed one top-up. Nothing is generated until Eric says go.

## Status

| Phase | State |
| --- | --- |
| 0 Scaffold | Done |
| 1 Core rules | Done (see `docs/CORE_API.md`) |
| 2 Battle map | Done (see `docs/UI_NOTES.md`) |
| 3 Saves and modes | Done (see `docs/SAVES.md`) |
| 3.5 Map and UI pass | Done (see `docs/MAPS.md` and `docs/UI_NOTES.md`). Known leftovers: the top row can sit under the header while the unit card is open, thin weapon icons are faint at small sizes, and the forecast panel is 28 px taller than before. |
| 4 Story layer | Done (see `docs/STORY.md`). The character creator (MC art layers, recolor and compositing, the look in save version 2), scripted map events with talk to recruit and story flags, the dialogue player, the chapter flow from `chapters.json` (save version 3), the prologue's story as a first draft, and draft intros for chapters 1 to 3. Known leftovers: the chapter 1 to 3 backdrops do not exist yet (plain fallback), and a battle suspended before version 3 plays on without the events that would already have fired. |
| 5 Battle scenes and powers | Done (see `docs/UI_NOTES.md`, Battle scenes, and `docs/CORE_API.md`, Powers). Side-view scenes from the four poses with code-drawn effects, Full, Fast or Off and tap to skip; the Resolve gauge, Echo, Devour and Scatter with the cut-in, aiming and forecasts (save version 4, battle state version 3); four backdrops packed. To confirm with Eric: Echo's fallback when there is nothing to echo, and the power numbers. Known leftovers: Scatter's three targets overlap in portrait, and a new pair's first scene can drop one frame on a slow phone. |
| 6 Camp | Done (see `docs/CAMP.md`). Items, inventories and the convoy; equip and item actions; the camp hub, forge (awakening to tier 2 with Hush, Cleave and Pin, the blood price, weapon upgrades), merchant, barracks with deployment and wounded bearers, war map, the Ashfall Ridge skirmish with scaling and a per-chapter cap, rewards and bonus objectives; save version 5, battle state version 4. To confirm with Eric: the three Awakened powers, the blood price, prices, rewards and skirmish scaling. Phase 7 should move the first camp's merchant and forge unlocks and the Widow's Hush awakening condition to the design's chapters. |
| 7 Chapters 1 to 3 | Done (see `docs/STORY.md`, `docs/MAPS.md` and `docs/CAMP.md`). Three maps drawn through the Tiled pipeline on the packed stone tileset (eight new terrains): Chapter 1, an escape over a river at night (13 x 18, forest); Chapter 2, a rout in a ruined fort where Garrow joins by talk or yields (14 x 16, ruin); Chapter 3, defeat the Hunter-Captain in a canal town where Pell drops in on turn 2 (14 x 18, town). Intro, mid-battle and outro scenes, campfire scenes for the camps after Chapters 2 and 3, rewards and bonuses, deploy rules, and a Chapter 4 stub so the war map has somewhere to point. The prologue's camp now opens only the barracks and the war map, the merchant and forge open after Chapter 2, and Widow's Hush awakens from Chapter 3. One small engine change: a spawn may land on the nearest free tile (`nearest`). The map marks escape tiles. For Eric to confirm: the names (Garrow, Pell, Hask, Lise, Tobin, Marra, Saltmarket, and Chapter 4's title "Storm and Root"), Garrow's two ways in and the chance to lose him, the first choice (`told_whispers`), the rewards and the new terrain numbers. Known leftovers: maps have no night look (Chapter 1 is lit like day), the stone set has no variants or joins (cobbles repeat, houses repeat their chimney), village props stand in for town props, and Tobin and Marra show as green allies before they join. |
| 8 to 9 | Not started |

## Balance (phase 7)

`npm run sim` (1,000 battles per difficulty, the simulator's charge AI on both sides; on Chapter 1 the main character heads for the exit, and a unit that can talk to a recruit does). Win percentages:

| Map | Party | Normal | Hard | Lunatic |
| --- | --- | --- | --- | --- |
| Prologue | The MC and the Stranger | 99.0 | 72.3 | 34.7 |
| Ashfall Ridge | Lone MC, level 2 | 87.9 | 65.0 | 32.7 |
| Ashfall Ridge | Lone MC, level 4 | 85.6 | 56.7 | 37.5 |
| Chapter 1 | MC level 2, with Hask, Lise, Tobin and Marra from the map | 99.8 | 61.1 | 39.4 |
| Chapter 2 | MC and four recruits at level 3 | 96.0 | 61.1 | 27.0 |
| Chapter 3 | MC and four recruits at level 4, Garrow level 5, Pell from the map | 92.8 | 69.1 | 36.5 |

The prologue and Ridge numbers did not change. The parties come from a chained run of the simulator (each chapter played with the party the one before left), which under its AI leaves the main character around level 2 to 3 by Chapter 2; a player who gives the main character kills or fights the skirmishes will be ahead of it. The duelist is the weakest style under the simulator on every map, as on the prologue.

## Questions for Eric

None of these block phases 0 to 2.

1. Level-ups: random growths (the default above) or fixed?
2. Are the four player classes and four enemy types above fine for the first build?
3. When should art start, and is about 80 to 90 generations acceptable?
4. GitHub Pages has to be switched on once by hand: repo Settings, Pages, Source: "GitHub Actions".

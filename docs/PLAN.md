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
| 4 Story layer | In progress. The character creator is done: MC art layers, runtime recolor and compositing, the creator in the new game flow, the look in the save (version 2) and the MC's token on the map. Dialogue, chapter flow, recruiting and events are not started. |
| 5 to 9 | Not started |

## Questions for Eric

None of these block phases 0 to 2.

1. Level-ups: random growths (the default above) or fixed?
2. Are the four player classes and four enemy types above fine for the first build?
3. When should art start, and is about 80 to 90 generations acceptable?
4. GitHub Pages has to be switched on once by hand: repo Settings, Pages, Source: "GitHub Actions".

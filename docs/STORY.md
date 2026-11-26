# Story

How the story is written and played: dialogue scenes, text tokens and pronouns, the speakers and the world's names, the campaign script in `chapters.json`, and scripted map events. All of it is data under `src/data`; adding a chapter's story needs no code.

## Files

| Path | What it is |
| --- | --- |
| `src/data/dialogue/<sceneId>.json` | One dialogue scene per file. The file name is the scene id. |
| `src/data/speakers.json` | Every speaker: name plate, portrait sheet, voice. |
| `src/data/names.json` | The world's placeholder names (empire, emperor, continent, village), used through text tokens. Rename them here. |
| `src/data/chapters.json` | The campaign script: chapters in order, with their scenes, maps and what changes afterwards. |
| `src/data/maps/<id>.events.json` | A map's scripted events (mid-battle scenes, talk to recruit, flags). See `docs/CORE_API.md`. |
| `src/story/text.ts` | The text token resolver. |
| `src/story/runner.ts` | The scene runner: a pure state machine over a scene. |
| `src/story/flow.ts` | The chapter flow over the campaign save. |
| `src/story/validate.ts` | Checks for all of the above. `tests/story.test.ts` runs them on the shipped data. |
| `src/ui/dialogue/Dialogue.tsx` | The dialogue player (see `docs/UI_NOTES.md`). |

## Scenes

A scene is `{ "id", "lines": [...] }` with optional `"backdrop"` (art id `backdrop.<id>`; a missing image falls back to a plain dark backdrop), `"battle": true` for a scene that plays over a battle, and `"draft": true` for a first draft. `lines` is a list of nodes; each node is one of these, told apart by its keys:

| Node | Example | Meaning |
| --- | --- | --- |
| Line | `{ "speaker": "stranger", "expr": "hurt", "side": "right", "text": "Go." }` | A spoken or narrated line. `expr` is `neutral`, `angry`, `hurt` or `smile` (default: the speaker's last, else neutral). `side` is `left` or `right` (default: the slot the speaker holds, else left for the MC and right for anyone else). An optional `backdrop` changes the backdrop as the line shows. |
| Effect | `{ "fx": "shake" }` | `shake`, `flash`, `fadeOut` (to black, stays dark) or `fadeIn`. Played as the next line arrives. |
| Enter | `{ "enter": "stranger", "side": "right", "expr": "hurt" }` | A speaker takes a slot without speaking. |
| Leave | `{ "leave": "stranger" }` | Empties that speaker's slot (or `"left"` / `"right"`). |
| Backdrop | `{ "backdrop": "forest" }` | Changes the backdrop. |
| Choice | `{ "choice": [{ "text": "...", "set": { "promise": true }, "goto": "label" }, ...] }` | Two or three answers. Each may set flags and jump to a label; without `goto` the scene goes on after the choice. |
| Label | `{ "label": "promised" }` | A place to jump to. |
| Jump | `{ "goto": "end" }`, `{ "goto": "fell", "if": [{ "type": "flag", "flag": "stranger_fell" }] }` | Jump always, or when every condition holds. Conditions are those of `docs/CORE_API.md` (flag, permadeath, difficulty). |
| End | `{ "end": true }` | Ends the scene here. |

The speaker on the current line is lit and the other slot is dimmed. Speakers with a voice (the narrator and the blade) take no slot. The scene ends after its last node.

Flags set by choices are collected while the scene plays and applied when it finishes, together with moving past it (see Chapters). A scene stopped halfway applies nothing, and replays from its first line.

Mid-battle scenes (`"battle": true`) play over the dimmed map and may not have choices, so they never change the battle state. That keeps suspend and resume exact.

Keep every line short enough for three lines of the text box at 375 px: the check allows 112 characters with tokens filled in and the longest MC name (16 characters).

## Speakers

`speakers.json` maps a speaker id to `{ "name", "portrait", "voice"? }`:

- `name`: the name plate, which may use tokens (`"{mc}"`). Empty for no plate.
- `portrait`: the portrait sheet. The art ids are `portrait.<sheet>.<expr>`; when an expression is missing (generic units only have neutral) the neutral one shows, and with no art at all a silhouette shows. `"mc"` is the composed main character in their look (`composeMcPortrait`). `null` for none.
- `voice`: `narration` (no plate, no portrait, italic) or `whisper` (the blade: no plate, no portrait, cold italic text in its own box).

A speaker id that is not in the file still plays, with a silhouette and its id as the name, but the story check reports it.

## Text tokens and pronouns

Text in lines, answers and speaker names can carry tokens in braces, resolved from the campaign save:

| Token | Gives |
| --- | --- |
| `{mc}` | The main character's name. |
| `{they}`, `{them}`, `{their}`, `{theirs}`, `{themself}` | The MC's pronouns: he, him, his, his, himself; she, her, her, hers, herself; or they, them, their, theirs, themself. |
| `{They}`, `{Them}`, ... | The same with a capital, for the start of a sentence. |
| `{is\|are}` | Two forms: the first for he and she, the second for they. Use it for every verb whose subject is the MC's pronoun: `{They} {has\|have} the sword.` |
| `{his\|her\|their}` | Three forms: he, she, they, for anything else that differs. |
| `{empire}`, `{emperor}`, `{continent}`, `{village}` | A name from `names.json`. `{Empire}` capitalizes the first letter. |

An unknown token shows as it is, and the story check fails on it. Tokens are not read twice: a name typed with braces in it stays as typed.

The current names are placeholders: empire "Ardent Empire", emperor "Emperor Haldric", continent "Hesper", village "Wrenfold". The Stranger is "The Stranger" in `speakers.json`. Write the empire as "the {empire}" so a rename to any proper noun still reads.

## Chapters

`chapters.json` is a list of chapters in story order:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `title` | `name` is the short menu name ("Prologue", "Chapter 1"). |
| `mapId` | The battle map, or null while the chapter has no map. The story stops at a chapter without a map: the player sees "To be continued" and its intro is not played. |
| `intro`, `outro` | Lists of variants `{ "scenes": [...], "when"?: [conditions] }`. The first variant whose conditions hold plays, its scenes in order. Outro conditions see the flags the battle set. |
| `after` | Changes once the outro has played: a list of `{ "when"?, "leave"?: [unit ids], "join"?: [{ id, name, classId, level, weaponId? }], "mcWeapon"?: { "vanguard": ..., "duelist": ..., "spiritblade": ... } }`. Every entry whose conditions hold applies, in order. The MC never leaves. |
| `next` | The next chapter's id, or null at the end of the story so far. |
| `draft` | True while the chapter is a stub. |
| `act` | The act the chapter belongs to (1 to 3). Wounded bearers sit out the rest of their act; the forge's requirements can ask for an act. |
| `campAfter` | Optional: after this chapter the army makes camp before the next one. `{ unlocks?, talk?, backdrop? }`: the facilities this camp opens (`forge`, `merchant`, `barracks`, `warmap`; once open they stay open), the campfire scenes it adds (`[{ scene, title?, when?, flag? }]`; `title` is the name in the camp's list), and the camp's backdrop (default `camp`). |
| `skirmishes` | Optional: `{ ids, cap }`, the side skirmishes on the war map while this is the next chapter, and how many may be won here. |
| `deploy` | Optional: `{ max?, required? }`, who may deploy on the chapter's map (`docs/CAMP.md`). |
| `plotCritical` | Optional: unit ids the plot still needs here. In Classic, such a unit that falls retreats badly wounded instead of dying, and sits out the rest of the act. |

The flow (`src/story/flow.ts`) walks a chapter through `camp` (when the chapter before has `campAfter`), `intro`, `battle` and `outro`, with the position in the campaign save (`progress.stage` and `progress.scenes`, see `docs/SAVES.md`):

1. A new chapter's stage begins: the variant is picked and its scenes stored.
2. Each finished scene is removed from the front, and its choice flags merged into the save, in one write.
3. When the intro runs out, the battle plays (its map from `mapId`). The campaign's flags go into the battle and come back on a win, with the party (recruits included, units that left alive kept, permadeath applied).
4. When the outro runs out, the after rules apply, the chapter is marked complete and the next one begins: in camp if the chapter has `campAfter`, else at its intro. Moving into a new act clears the wounded list.
5. In camp the campaign rests (stage `camp`) until the war map starts the chapter (March, after the deploy step), which begins its intro. Camp works even while the next chapter has no map; the war map then shows it as coming soon.

Units the plot needs elsewhere leave through `after.leave`. Recruits from talking come in through the battle itself; `after.join` is for units that join between battles.

## The prologue

| Scene | When |
| --- | --- |
| `prologue_intro` | Before the battle. |
| `prologue_b_start` | Battle start: the Stranger on moving, striking and weighing a fight (the forecast). |
| `prologue_b_terrain` | Turn 2, if the Stranger lives: forests and high ground. |
| `prologue_b_first_kill` | The Stranger's first kill: her sword hums. |
| `prologue_b_wounded` | The Stranger drops below half HP. |
| `prologue_b_captain` | Turn 3, if the Stranger lives: the hunter-captain's voice from the tree line. |
| `prologue_b_stranger_falls` | The Stranger falls. Also sets `stranger_fell`. |
| `prologue_outro` | After the win. Ends with her death. Has the choice. |
| `prologue_outro_fell` | Instead of the above in Classic when `stranger_fell` is set. Has the choice. |
| `prologue_binding` | After either: the sword binds to the MC, its first whisper, the MC decides to run. |

Flags: `stranger_fell` (true if she fell in battle), `prologue_promise` (true if the MC promised to carry the blade north, false if they said nothing). After the outro the Stranger leaves the party and the MC's weapon becomes `widows_hush_<style>` (the starting weapon goes to the convoy). Then the army makes camp before Chapter 1: the prologue's `campAfter` opens all four facilities for now (the design opens the merchant and the forge after Chapter 2; phase 7 moves them there) and offers the first campfire scene.

Chapters 1 to 3 have draft intros (`ch1_intro`, `ch2_intro`, `ch3_intro`) and no maps yet. Their backdrops are `forest`, `camp` and `town` (packed in phase 5).

The skirmish test map has one event: the MC can talk to the deserter, who plays `skirmish_recruit`, joins, and sets `skirmish_deserter_joined`.

## Camp scenes

Scenes that play in camp are standalone scenes (they may have choices). Reading one sets its flag (`read_<scene>` unless the talk entry names one), with any flags its choices set, in one write.

| Scene | Where |
| --- | --- |
| `camp_first_night` | Campfire talk at the first camp (after the prologue): the MC and the blade's voice. Draft. |
| `skirmish_ridge_lore` | Before the first attempt at the Ashfall Ridge skirmish: a cairn about the original blade. Sets `read_skirmish_ridge_lore`. Draft. |

Other flags the camp keeps: `unbound_blades` (a number: how many blades have reached their last tier, for endings).

## How to add a scene

1. Write `src/data/dialogue/<id>.json` with `"id": "<id>"` and its lines. Use speakers from `speakers.json`, or add one there.
2. Name it where it plays: in a chapter's `intro` or `outro`, or in a map event's `scene` effect (then mark it `"battle": true` and give it no choices).
3. Run `npm run test`. `tests/story.test.ts` checks that every scene named anywhere exists, every speaker and token resolves, every line fits, every label exists, choices have two or three answers, and battle scenes have none.

## How to add an event

1. Open (or create) `src/data/maps/<map id>.events.json`. A new file also needs a line in `src/data/index.ts` (`withEvents`).
2. Add `{ "id", "trigger", "conditions"?, "effects", "repeatable"? }` from the tables in `docs/CORE_API.md` (Scripted events). Refer to units by id, or give a group of units a `tags` property in Tiled and match the tag.
3. Run `npm run test`. `validateGameData` checks the references, and the Tiled import keeps checking them on every redraw (`docs/MAPS.md`).

For talk to recruit: a `talk` trigger from the recruiter to the target, with a `scene` effect and `{ "type": "setTeam", "unitId": "<target>", "team": "player" }`. The battle menu offers Talk when the recruiter can stand next to the target.

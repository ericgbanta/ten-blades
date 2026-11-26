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
5. Art that needs a transparent background is generated on flat `#00ff00` green and cut out by a pack script (not written yet). Character sheets are on grey because they are only references.
6. List every finished file in `src/art/assets.json`.

Gotchas carried over from DracoQuest: `codex exec` waits on stdin, so `run.sh` adds `< /dev/null`. `-i` takes several files, so `--` goes before the prompt. The image tool cannot make transparent backgrounds. Raw PNGs are about 2 MB each and are not committed; character sheets are kept as JPEGs in `tools/art/sheets/` because later generations need them as references.

## What exists

| Batch | Generations | Result |
| --- | --- | --- |
| Style samples A to D | 4 | A chosen; it is the anchor and the Stranger's sheet |
| Character sheets (bust, front, side) | 11 | Gravemaw's bearer, the Thousand Needles thief, the Hunter-Captain, Soldier, Ranger, Adept, Medic, Legionary, Hunter, Inquisitor, Archer. All usable first try. |

Not made yet: portrait expressions, battle poses, map tokens, MC layers, tilesets, backdrops, icons.

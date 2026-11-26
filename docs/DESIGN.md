# Ten Blades: Game Design Doc (Discovery)

Nov 25, 2026 · @Eric

## Snapshot

Ten Blades (working title) is a dark fantasy tactics RPG that runs in a phone browser. You play a customizable wanderer who inherits a legendary sword from a dying stranger, then gathers the other nine blade bearers before a tyrant claims all ten. The catch is that the swords want to be reunited, and they may be using everyone, you included.

| Area | Decision |
| --- | --- |
| Tone | Dark fantasy with real stakes |
| Legendary swords | 10, every wielder recruitable |
| Main character | Custom look plus a starting combat style |
| MC's blade | Inherited from a stranger who dies in the prologue |
| Story | Linear, with key choices that decide who lives, who joins, and the ending |
| Combat | Classic Fire Emblem grid, UI sized for a phone |
| Map length | 20 to 30 minutes, with a mid-battle suspend save |
| Counters | Sword schools triangle |
| Army | The 10 bearers plus generic recruits |
| Permadeath | Player picks Classic or Casual |
| Difficulty | Normal, Hard, Lunatic |
| Between battles | Camp hub, sword awakening, side skirmishes |
| Art | Chibi map tokens and illustrated portraits, made in Codex |
| Battle scenes | Full side-view scenes built from tweened key poses |
| Platform | Static web app on GitHub Pages, saves on the device |
| First build | Prologue plus 3 chapters |

## Story and world

This whole section is a first draft for you to push back on. Names in brackets are placeholders.

### Premise

Centuries ago a single cursed blade was shattered into ten swords and scattered across \[the continent\]. Each sword picks its own wielder and grants one power. Bearers live long, fight like small armies, and are feared wherever they go.

### The conflict: tyrant plus curse

Emperor \[name\] is hunting bearers and taking their swords. In public he says he is ending the age of swordsmen. In private he hears the blades speaking and believes that reuniting them will make him a god.

The late reveal is that the original blade is the real antagonist. It nudges every bearer, the MC included, toward bringing the ten back together. Gathering the swords is how you beat the emperor, and it is also how the world could end.

### Prologue

The MC lives in a border village. A wounded stranger stumbles in with imperial hunters on her heels. She carries one of the ten blades. She and the MC fight off the first wave together (the tutorial map), and then she dies. Her sword refuses to stay with her body and binds itself to the MC. The MC knows nothing about her, and finding out who she was runs through the whole game.

### Acts (rough)

1. Act 1, The Inheritance: flee the empire, learn the blade, recruit the first two or three bearers, and find out the stranger was hiding something.
2. Act 2, The Hunt: race the emperor to the remaining bearers. Some join freely, some have to be beaten first, and one may be lost depending on your choices.
3. Act 3, The Reunion: storm the capital. The curse shows itself, and the final choice decides whether the blades are reunited, destroyed, or kept apart at a price.

### Key choices

Spare or execute a defeated bearer. Pick who goes on a dangerous side mission. Decide whether to tell the party what the MC's sword whispers at night. These feed recruitment, deaths, and two or three endings.

## The ten blades

A draft roster so the schools and powers balance out: three Heavy, three Swift, three Arcane, plus the MC's blade, which takes the school of whatever style the player picks. Wielders are archetypes for now so you can name and design them.

| # | Blade | School | Power (dormant tier) | Wielder archetype | Joins (draft) |
| --- | --- | --- | --- | --- | --- |
| 1 | Widow's Hush | Matches MC's style | Echo: replays the last legendary power used within 3 tiles | The MC, inherited from the stranger | Prologue |
| 2 | Gravemaw | Heavy | Devour: heals for damage dealt, gains attack per kill this map | Hulking army deserter | Ch. 2, after a duel |
| 3 | Thousand Needles | Swift | Scatter: the blade splits and hits every enemy in a line | Young street thief | Ch. 3 |
| 4 | Stormcall | Arcane | Chain: lightning jumps between adjacent enemies | Exiled temple priestess | Act 1 finale |
| 5 | Ironroot | Heavy | Bulwark: roots in place, adjacent allies take half damage | Village guardian who never leaves home | Act 1 finale |
| 6 | Veilpiercer | Swift | Blink: teleports behind an enemy within 4 tiles and strikes | Imperial assassin hunting the MC | Act 2, if spared |
| 7 | Frostbind | Arcane | Still: freezes one enemy so it skips its next turn | Mountain hermit, oldest living bearer | Act 2 |
| 8 | Ashen Vow | Heavy | Pyre: leaves burning tiles, costs the wielder HP | Imperial general who can defect | Act 2, by choice |
| 9 | Bloodsong | Swift | Tempo: each hit raises nearby allies' speed, drains the wielder | Wandering bard and duelist | Act 2 side route |
| 10 | Crownless | Arcane | Dominion: takes control of an enemy for one turn | The emperor's own child and champion | Act 3, the hardest recruit |

## Main character

The player builds the MC at the start: name, look, and starting combat style. The inherited blade then reshapes itself to fit that style, so the stranger's sword ends up feeling like the player's own.

### Character creator (starting targets)

- Name, plus how dialogue refers to the MC (he, she, they)
- Body type: 2 options
- Skin tone: 6 options, done as palette swaps
- Hair: 8 styles, 10 colors
- Face: 6 eye shapes, each with neutral, angry, hurt, and smiling versions
- Scar or marking: 6 options, or none
- Outfit accent color: palette swap

### Combat style

| Style | School | Feel |
| --- | --- | --- |
| Vanguard | Heavy | High HP and defense, holds the line |
| Duelist | Swift | High speed and crit, hit and run |
| Spiritblade | Arcane | Short-range sword techniques, fragile |

Widow's Hush takes the school and silhouette of the chosen style. Its power, Echo, is the same for every MC.

### Art rules for customization

Each customizable part has to line up in three places: the portrait, the chibi map token, and the battle poses. Build every part as its own transparent layer on a shared template so the game can stack them. Handle colors with palette masks instead of separate images, which cuts the Codex workload a lot.

## Combat

Classic Fire Emblem rules on a phone-sized grid, with one legendary power per bearer layered on top.

### Core loop

- Player phase, then enemy phase. Each unit moves, then attacks, uses an item, or waits.
- Tap a unit to show its range, tap a tile to move, tap an enemy to preview the fight (damage, hit %, crit %, counterattack).
- Maps around 12x16 to 16x20 tiles with a camera you can pan and pinch-zoom. Target 20 to 30 minutes each.
- Suspend save after every action, so a phone call never costs a map.
- Mixed objectives: rout, defeat the boss, survive N turns, escape, protect a target.

### Sword schools triangle

Heavy beats Swift, Swift beats Arcane, Arcane beats Heavy. Advantage gives +15 hit and +1 damage per strike as a starting value to tune. Generic weapons slot into the same wheel, so recruits and bearers follow one rule.

| School | Legendary blades | Generic weapons |
| --- | --- | --- |
| Heavy | Gravemaw, Ironroot, Ashen Vow | Greatswords, axes, lances |
| Swift | Thousand Needles, Veilpiercer, Bloodsong | Katanas, daggers, bows |
| Arcane | Stormcall, Frostbind, Crownless | Tomes, talismans, spirit staves |

Healers sit outside the triangle.

### Sword powers

Each blade has one active power that runs on a Resolve gauge. The gauge fills when the bearer deals or takes hits. Firing a power plays a portrait cut-in before the battle scene. Awakening adds more (see Between battles).

### Permadeath and difficulty

Classic mode: fallen units are gone for good, and the MC falling is a game over. Bearers the plot still needs retreat badly wounded and sit out the rest of that act. Casual mode: fallen units come back after the map.

Difficulty is picked separately: Normal, Hard, or Lunatic. It changes enemy stats, AI aggression, and reinforcements.

### Enemy AI

Start with three readable behaviors: charge, hold until something enters range, and guard a tile. Bosses stay put unless a script moves them.

## Between battles

### Camp

The hub between chapters. It travels with the army, so the backdrop changes each act.

- Forge: sword awakening and upgrades for generic weapons
- Merchant: items, weapons, and class change seals
- Barracks: check units, swap gear, choose who deploys
- War map: pick the next story chapter or a side skirmish

### Sword awakening

Each blade has three tiers. Moving up costs Blade Shards, earned on story maps and skirmishes, plus a story condition such as reaching a chapter or finishing that bearer's personal mission.

1. Dormant: the base power.
2. Awakened: a second power, a stat boost, and a glowing blade accent on the portrait.
3. Unbound: an ultimate power. The blade's voice also gets louder in dialogue, and the number of Unbound blades shifts which endings are open. Power has a cost, which keeps the curse in the gameplay and not only the story.

### Side skirmishes

Optional short maps on the war map that pay out XP, gold, and Blade Shards. Some carry lore about the original blade. Cap them at a few per chapter so grinding can't flatten Lunatic.

## Art and animation pipeline (Codex)

Chibi tokens on the map, illustrated portraits in dialogue, and full side-view battle scenes built from four poses per character.

### Assets per character

| Asset | Count | Notes |
| --- | --- | --- |
| Portrait | 1 bust with 4 expressions | Neutral, angry, hurt, smiling; transparent background |
| Map token | 2-frame idle | Chibi, readable on a 48px tile at 2x and 3x |
| Battle poses | 4 | Idle, wind-up, strike, hit; side view, same scale and facing |
| Power cut-in | 1 | Dramatic close crop, can reuse the portrait |

For the MC, every row is a set of layered parts instead of finished images.

### How battle scenes work

Code animates between the poses: slide in, wind up, snap to the strike, shake the screen, flash the target, pop the damage number, return. Slash trails, sparks, and power effects are particles drawn in code, so Codex never has to make effect frames. Players need a speed-up and skip toggle, since a 30-minute map has a lot of fights.

### Keeping characters on-model

- Write one style prompt (line weight, palette, shading, proportions) and reuse it word for word.
- Make a character sheet for each bearer first, then generate every pose from that sheet as the reference.
- Lock a shared canvas size, ground line, and facing direction for battle poses.
- Keep a JSON manifest that maps each image to its character, pose, and file. The game loads art by id and shows a placeholder when something is missing, so code and art can move at different speeds.

The full game is roughly 30 character designs (10 bearers, about 8 generic classes, enemies, bosses) at around 8 images each, so about 250 images before MC layers, map tiles, and UI. The first build needs a small slice of that.

## Tech and platform

- Static web app on GitHub Pages, installable to the home screen as a PWA and playable offline once loaded.
- Portrait-first phone layout with landscape support. Touch first; mouse works on desktop.
- Suggested stack: TypeScript, Vite, and Phaser 3 for the map and battle scenes, with HTML overlays for menus and dialogue.
- All content as data: units, blades, classes, maps, and dialogue live in JSON, so new chapters don't touch engine code. Maps can be drawn in Tiled.
- Saves in IndexedDB: 3 slots plus a suspend slot, and an export/import save code for moving between devices.
- Test locally first, including Playwright runs at a phone viewport. Keep GitHub Actions to a lean deploy step.

## First playable: prologue plus 3 chapters

The goal is to prove combat, story, the MC creator, and one sword awakening, start to finish on a phone.

| Chapter | Story beat | Systems it introduces |
| --- | --- | --- |
| Prologue | The stranger dies and her blade binds to the MC | Character creator, moving, attacking, battle scenes |
| Ch. 1 | Escape the imperial hunters | Schools triangle, terrain, first generic recruits |
| Ch. 2 | Duel and recruit Gravemaw's bearer | Recruiting by talking, first camp visit, forge |
| Ch. 3 | Thousand Needles' thief joins mid-battle | Awakening to tier 2, first side skirmish, first story choice |

Art for this build: MC layers, the stranger, two bearers, 4 generic player classes, 4 enemy types, 1 boss, and 2 tilesets.

It's done when it plays through in mobile Safari and Chrome, suspend and resume work, and both permadeath modes and all three difficulties are selectable.

## Open questions

- [ ] Game title and the name of the world
- [ ] Names, personalities, and looks for the ten bearers (the roster above is a starting point)
- [ ] Who the stranger really was, and what she was hiding
- [ ] Short campfire scenes between bearers for backstory, even without a full support system?
- [ ] Generic class list, and whether classes promote
- [ ] Level-ups: Fire Emblem style random growths, or fixed?
- [ ] How many endings, and what each one hinges on
- [ ] Music and sound: where they come from
- [ ] Who builds the code: Claude Code, Codex, or both

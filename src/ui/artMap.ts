// Which art the UI shows for game things: an icon per stat, school and weapon kind, and a portrait per unit.
// Pure lookups over the manifest, so they are tested without a DOM (tests/ui-art.test.ts).

import { imageMeta } from '../art/manifest';
import { itemDef, weaponDef, type GameData, type School, type StatKey, type Unit, type WeaponDef } from '../core';

export type IconName =
  | StatKey
  | 'heavy'
  | 'swift'
  | 'arcane'
  | 'greatsword'
  | 'axe'
  | 'lance'
  | 'sabre'
  | 'dagger'
  | 'bow'
  | 'tome'
  | 'talisman'
  | 'staff'
  | 'shard'
  | 'coins'
  | 'tenblade'
  // Coloured item and gear icons (icons-items2): the three consumables are wired through items.json, the rest wait for use.
  | 'salve'
  | 'tonic'
  | 'wine'
  | 'bandage'
  | 'key'
  | 'torch'
  | 'whetstone'
  | 'pouch'
  | 'buckler'
  | 'bone_charm'
  | 'scroll'
  | 'horn_flask';

/** Icon per weapon kind (`kind` in src/data/weapons.json). Legendary blades show the ten-blade star. */
export const WEAPON_ICON: Record<string, IconName> = {
  greatsword: 'greatsword',
  axe: 'axe',
  lance: 'lance',
  katana: 'sabre',
  dagger: 'dagger',
  bow: 'bow',
  tome: 'tome',
  talisman: 'talisman',
  spiritstaff: 'staff',
  staff: 'staff',
  legendary: 'tenblade',
};

/** A weapon kind with no entry above falls back to its school's look. */
const SCHOOL_FALLBACK: Record<School, IconName> = { heavy: 'greatsword', swift: 'sabre', arcane: 'tome', none: 'staff' };

export function weaponIcon(w: Pick<WeaponDef, 'kind' | 'school'>): IconName {
  return WEAPON_ICON[w.kind] ?? SCHOOL_FALLBACK[w.school];
}

/** The icon of an inventory entry: a weapon's by kind, a consumable's from its `icon` in items.json (the pouch when the
 * data names none). */
export function entryIcon(id: string, data: GameData): IconName {
  const w = weaponDef(id, data);
  if (w) return weaponIcon(w);
  return (itemDef(id, data)?.icon as IconName | undefined) ?? 'pouch';
}

export function schoolIcon(s: School): IconName | null {
  return s === 'none' ? null : s;
}

/** Portrait (and battle pose) sheet id by unit id (named characters), then by class id (generic units). */
const PORTRAIT_BY_UNIT: Record<string, string> = {
  stranger: 'stranger',
  gravemaw: 'gravemaw',
  needles: 'needles',
};
const PORTRAIT_BY_CLASS: Record<string, string> = {
  wanderer: 'stranger',
  hunter_captain: 'captain',
  gravemaw_bearer: 'gravemaw',
  needles_bearer: 'needles',
  soldier: 'soldier',
  ranger: 'ranger',
  adept: 'adept',
  medic: 'medic',
  legionary: 'legionary',
  hunter: 'hunter',
  inquisitor: 'inquisitor',
  archer: 'archer',
};

/** The four battle poses every character sheet has (src/art/battle, `battle.<sheet>.<pose>`). */
export const BATTLE_POSES = ['idle', 'windup', 'strike', 'hit'] as const;
export type BattlePose = (typeof BATTLE_POSES)[number];

/** The main character's combat styles: a player lord of one of these classes is drawn from their composed look. */
const MC_STYLES = ['vanguard', 'duelist', 'spiritblade'];

/** How a unit is drawn in the battle scene: the composed main character, a pose sheet, or a placeholder. */
export type BattleArt = { kind: 'mc'; style: string } | { kind: 'sheet'; sheet: string } | { kind: 'placeholder' };

/**
 * The battle art for a unit: the main character (a player lord of a combat style class) is composed from their
 * look; others use their sheet by unit id, then by class, the same sheets as portraits, when every pose exists.
 */
export function battleArt(unit: Pick<Unit, 'id' | 'classId' | 'isLord' | 'team'>): BattleArt {
  if (unit.isLord && unit.team === 'player' && MC_STYLES.includes(unit.classId)) return { kind: 'mc', style: unit.classId };
  const sheet = PORTRAIT_BY_UNIT[unit.id] ?? PORTRAIT_BY_CLASS[unit.classId];
  if (sheet && BATTLE_POSES.every((p) => imageMeta(`battle.${sheet}.${p}`))) return { kind: 'sheet', sheet };
  return { kind: 'placeholder' };
}

/** A unit's portrait sheet (named characters by id, others by class), or null. */
export function portraitSheet(unit: Pick<Unit, 'id' | 'classId'>): string | null {
  return PORTRAIT_BY_UNIT[unit.id] ?? PORTRAIT_BY_CLASS[unit.classId] ?? null;
}

/** The `portrait.<id>.neutral` id for a unit, or null when there is none (the MC is composed instead). */
export function portraitId(unit: Pick<Unit, 'id' | 'classId'>): string | null {
  const sheet = PORTRAIT_BY_UNIT[unit.id] ?? PORTRAIT_BY_CLASS[unit.classId];
  if (!sheet) return null;
  const id = `portrait.${sheet}.neutral`;
  return imageMeta(id) ? id : null;
}

/**
 * The portrait for a dialogue speaker's sheet and expression: `portrait.<sheet>.<expr>`, else the sheet's
 * neutral one (generic units only have neutral), else null (draw a silhouette).
 */
export function speakerPortraitId(sheet: string, expr: string): string | null {
  for (const id of [`portrait.${sheet}.${expr}`, `portrait.${sheet}.neutral`]) if (imageMeta(id)) return id;
  return null;
}

/** The backdrop image for a scene's backdrop id, or null when there is no such art (a plain dark backdrop). */
export function backdropArtId(id: string | null): string | null {
  if (!id) return null;
  const art = `backdrop.${id}`;
  return imageMeta(art) ? art : null;
}

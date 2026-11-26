// Which art the UI shows for game things: an icon per stat, school and weapon kind, and a portrait per unit.
// Pure lookups over the manifest, so they are tested without a DOM (tests/ui-art.test.ts).

import { imageMeta } from '../art/manifest';
import type { School, StatKey, Unit, WeaponDef } from '../core';

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
  | 'tenblade';

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

export function schoolIcon(s: School): IconName | null {
  return s === 'none' ? null : s;
}

/** Portrait sheet id by unit id (named characters), then by class id (generic units). */
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

/** The `portrait.<id>.neutral` id for a unit, or null when there is none (the MC is composed instead). */
export function portraitId(unit: Pick<Unit, 'id' | 'classId'>): string | null {
  const sheet = PORTRAIT_BY_UNIT[unit.id] ?? PORTRAIT_BY_CLASS[unit.classId];
  if (!sheet) return null;
  const id = `portrait.${sheet}.neutral`;
  return imageMeta(id) ? id : null;
}

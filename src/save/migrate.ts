// Brings an older save up to SAVE_VERSION, one step at a time. Each step takes a
// save object at version N and returns it at version N + 1. To change the save
// shape: bump SAVE_VERSION, add the step for the old version here, and add a
// fixture of the old version under tests/fixtures (see docs/SAVES.md).

import { SAVE_VERSION, fail, ok, type Result } from './format';
import type { Obj } from './shape';

/** A save object at some version. Steps may assume the shape of their own version. */
export type RawSave = Obj & { version: number };

export type MigrationStep = (save: RawSave) => RawSave;

/**
 * Steps keyed by the version they upgrade from. Empty while SAVE_VERSION is 1.
 * A step must handle both kinds (`campaign` and `suspend`, whose `campaign`
 * field is a campaign save of the same version).
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

/**
 * Upgrade a parsed save to `target`. Returns the upgraded object, still unchecked:
 * run the validator on it next. Never changes the input.
 */
export function migrate(raw: unknown, steps: Readonly<Record<number, MigrationStep>> = MIGRATIONS, target: number = SAVE_VERSION): Result<RawSave> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('This is not a save: expected an object.');
  const v = (raw as Obj).version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('This save has no version number.');
  if (v > target) return fail(`This save is from a newer version of the game (save version ${v}). Update the game to load it.`);
  let save = structuredClone(raw) as RawSave;
  while (save.version < target) {
    const from = save.version;
    const step = steps[from];
    if (!step) return fail(`This save version (${from}) can no longer be loaded.`);
    save = step(save);
    if (save.version !== from + 1) return fail(`The upgrade from save version ${from} did not reach version ${from + 1}.`);
  }
  return ok(save);
}

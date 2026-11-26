// Loads every JSON file under src/data into one typed GameData object.
// The core never imports JSON itself; callers pass `gameData` (or a test fixture) in.

import type { Balance, ClassDef, GameData, MapData, TerrainDef, WeaponDef } from '../core/types';
import balance from './balance.json';
import classes from './classes.json';
import terrain from './terrain.json';
import weapons from './weapons.json';
import prologue from './maps/prologue.json';
import skirmishTest from './maps/skirmish_test.json';
import chaptersJson from './chapters.json';
import type { ChapterDef } from '../save/format';

// JSON imports widen string unions and tuples, so they are cast here.
// tests/data.test.ts checks the shapes and every cross reference at runtime.
export const gameData: GameData = {
  balance: balance as Balance,
  classes: classes as Record<string, ClassDef>,
  terrain: terrain as Record<string, TerrainDef>,
  weapons: weapons as unknown as Record<string, WeaponDef>,
  // skirmish_test is a large map for checking rendering and the camera; only the quick battle URL reaches it.
  maps: { prologue: prologue as unknown as MapData, skirmish_test: skirmishTest as unknown as MapData },
};

/** The story order of chapters. Phase 4 grows this into full chapter data. */
export const chapters: readonly ChapterDef[] = chaptersJson as ChapterDef[];

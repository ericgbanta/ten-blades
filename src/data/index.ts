// Loads every JSON file under src/data into one typed GameData object.
// The core never imports JSON itself; callers pass `gameData` (or a test fixture) in.

import type { Balance, ClassDef, GameData, MapData, MapEvent, TerrainDef, WeaponDef } from '../core/types';
import type { ChapterDef } from '../story/types';
import balance from './balance.json';
import classes from './classes.json';
import terrain from './terrain.json';
import weapons from './weapons.json';
import prologue from './maps/prologue.json';
import prologueEvents from './maps/prologue.events.json';
import skirmishTest from './maps/skirmish_test.json';
import skirmishTestEvents from './maps/skirmish_test.events.json';
import chaptersJson from './chapters.json';

/**
 * A map with its scripted events. Events live in a sidecar file (<id>.events.json) that the Tiled import never
 * writes, so redrawing a map in Tiled cannot lose them (docs/MAPS.md).
 */
function withEvents(map: unknown, events: unknown): MapData {
  return { ...(map as MapData), events: events as MapEvent[] };
}

// JSON imports widen string unions and tuples, so they are cast here.
// tests/data.test.ts checks the shapes and every cross reference at runtime.
export const gameData: GameData = {
  balance: balance as Balance,
  classes: classes as Record<string, ClassDef>,
  terrain: terrain as Record<string, TerrainDef>,
  weapons: weapons as unknown as Record<string, WeaponDef>,
  // skirmish_test is a large map for checking rendering and the camera; only the quick battle URL reaches it.
  maps: { prologue: withEvents(prologue, prologueEvents), skirmish_test: withEvents(skirmishTest, skirmishTestEvents) },
};

/** The campaign script, in story order (src/data/chapters.json). Each chapter names the next. */
export const chapters: readonly ChapterDef[] = chaptersJson as unknown as ChapterDef[];

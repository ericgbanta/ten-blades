// The story content: every dialogue scene in src/data/dialogue, the speakers and the world's names. Kept apart
// from src/data/index.ts because it gathers the scenes with Vite's import.meta.glob, which the Node tools
// (npm run sim, npm run maps) do not have. tests/story.test.ts checks all of it.

import type { SceneDef, SpeakerDef } from '../story/types';
import names from './names.json';
import speakersJson from './speakers.json';

const files = import.meta.glob('./dialogue/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** Every scene, by id (its file name). */
export const scenes: Readonly<Record<string, SceneDef>> = Object.fromEntries(
  Object.entries(files).map(([path, json]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), json as SceneDef]),
);

export const sceneIds: readonly string[] = Object.keys(scenes).sort();

export const speakers: Readonly<Record<string, SpeakerDef>> = speakersJson as Record<string, SpeakerDef>;

/** The placeholder names of the world (src/data/names.json), used by text tokens such as {empire}. */
export const worldNames: Readonly<Record<string, string>> = names;

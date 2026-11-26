// The new game setup used until the character creator and mode pickers exist
// (phases 3 and 4). URL overrides make test runs reproducible.

import type { BattleSetup, Difficulty, McStyle, Permadeath } from '../core';

/** The hardcoded new game: the one place to change it. */
export const NEW_GAME: BattleSetup = {
  difficulty: 'normal',
  permadeath: 'casual',
  mc: { name: 'Wanderer', style: 'vanguard' },
};

export const FIRST_MAP_ID = 'prologue';

export interface LaunchOptions {
  setup: BattleSetup;
  /** Fixed seed from the URL, or null to pick one per battle. */
  seed: number | null;
  /** True when the URL asks for the test hook (`test=1`). */
  test: boolean;
}

const STYLES: readonly McStyle[] = ['vanguard', 'duelist', 'spiritblade'];
const DIFFICULTIES: readonly Difficulty[] = ['normal', 'hard', 'lunatic'];
const PERMADEATH: readonly Permadeath[] = ['classic', 'casual'];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

/**
 * Read overrides from the query string and from a query after the hash route,
 * so both `?seed=3#/battle` and `#/battle?seed=3` work. Hash values win.
 */
export function parseLaunch(search: string, hash: string): LaunchOptions {
  const params = new URLSearchParams(search);
  const q = hash.indexOf('?');
  if (q >= 0) new URLSearchParams(hash.slice(q + 1)).forEach((v, k) => params.set(k, v));
  const seedText = params.get('seed');
  const seed = seedText !== null && /^\d+$/.test(seedText) ? Number(seedText) >>> 0 : null;
  return {
    setup: {
      difficulty: pick(params.get('difficulty'), DIFFICULTIES, NEW_GAME.difficulty),
      permadeath: pick(params.get('mode'), PERMADEATH, NEW_GAME.permadeath),
      mc: { name: NEW_GAME.mc.name, style: pick(params.get('style'), STYLES, NEW_GAME.mc.style) },
    },
    seed,
    test: params.get('test') === '1',
  };
}

/** The seed for a battle: the URL's, or one from the clock. */
export function battleSeed(launch: LaunchOptions, now: number): number {
  return launch.seed ?? now >>> 0;
}

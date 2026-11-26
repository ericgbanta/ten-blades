// Launch options read from the URL. Campaign battles take their setup from the
// save (src/save/campaign.ts); the quick battle (`quick=1`, for tests and
// development) uses QUICK_BATTLE with the URL overrides. A `seed` in the URL
// fixes the seed of every battle, campaign ones included.

import type { BattleSetup, Difficulty, McStyle, Permadeath } from '../core';

/** The quick battle's setup, before URL overrides. */
export const QUICK_BATTLE: BattleSetup = {
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
  /** True for a quick battle (`quick=1`): no slot, nothing saved. */
  quick: boolean;
  /** Map id for a quick battle (`map=<id>`), or null for the first map. Unknown ids fall back to the first map. */
  mapId: string | null;
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
      difficulty: pick(params.get('difficulty'), DIFFICULTIES, QUICK_BATTLE.difficulty),
      permadeath: pick(params.get('mode'), PERMADEATH, QUICK_BATTLE.permadeath),
      mc: { name: QUICK_BATTLE.mc.name, style: pick(params.get('style'), STYLES, QUICK_BATTLE.mc.style) },
    },
    seed,
    test: params.get('test') === '1',
    quick: params.get('quick') === '1',
    mapId: /^[a-z0-9_]+$/.test(params.get('map') ?? '') ? params.get('map') : null,
  };
}

/** The seed for a battle: the URL's, or one from the clock. */
export function battleSeed(launch: LaunchOptions, now: number): number {
  return launch.seed ?? now >>> 0;
}

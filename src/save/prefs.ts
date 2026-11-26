// Small UI preferences kept in localStorage. They are not part of any save, so
// a failure to read or write them (private mode, quota) is silently ignored.

import type { SceneMode, Speed } from '../battle/controller';

export interface Prefs {
  speed: Speed;
  /** Battle scenes: Full, Fast or Off. Null until the player picks one (then reduced motion decides). */
  sceneMode: SceneMode | null;
}

const KEY = 'ten-blades.prefs';
const DEFAULTS: Prefs = { speed: 'normal', sceneMode: null };
const SCENE_MODES: readonly SceneMode[] = ['full', 'fast', 'off'];

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    return {
      speed: p.speed === 'fast' ? 'fast' : 'normal',
      sceneMode: SCENE_MODES.find((m) => m === p.sceneMode) ?? null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; nothing to do.
  }
}

/**
 * The battle scene setting in effect: the player's choice, else Off under prefers-reduced-motion (the map's
 * short moves only) and Full otherwise.
 */
export function sceneModeOf(prefs: Prefs, reducedMotion: boolean): SceneMode {
  return prefs.sceneMode ?? (reducedMotion ? 'off' : 'full');
}

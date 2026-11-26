// Small UI preferences kept in localStorage. They are not part of any save, so
// a failure to read or write them (private mode, quota) is silently ignored.

import type { Speed } from '../battle/controller';

export interface Prefs {
  speed: Speed;
}

const KEY = 'ten-blades.prefs';
const DEFAULTS: Prefs = { speed: 'normal' };

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    return { speed: p.speed === 'fast' ? 'fast' : 'normal' };
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

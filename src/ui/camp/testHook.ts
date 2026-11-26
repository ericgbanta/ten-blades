// Test only (`?test=1`): `window.__camp` lets the e2e tests reach every camp screen without grinding: grant gold
// and shards, set story flags, read the campaign, and show facilities as locked.

import type { FlagValue } from '../../core';
import type { Facility } from '../../camp/types';
import type { CampaignSave } from '../../save/format';
import { parseLaunch } from '../../battle/setup';
import { commitCamp, currentCamp, writes } from '../saves';

export interface CampTestHook {
  campaign(): CampaignSave | null;
  grant(gold: number, shards: number): void;
  setFlag(flag: string, value: FlagValue): void;
  /** Show these facilities as locked (display only), to see the locked plates. */
  lock(facilities: Facility[]): void;
  /** Resolves once every queued save write has finished. */
  saved(): Promise<boolean>;
}

declare global {
  interface Window {
    __camp?: CampTestHook;
  }
}

let locked: Facility[] = [];

export const lockedForTest = (): readonly Facility[] => locked;

/** Install `window.__camp` when the URL asks for the test hook. Returns the uninstaller. */
export function installCampTestHook(): () => void {
  if (!parseLaunch(window.location.search, window.location.hash).test) return () => undefined;
  const change = (fn: (c: CampaignSave) => CampaignSave) => {
    const s = currentCamp();
    if (s) commitCamp(s.slot, fn(s.campaign));
  };
  window.__camp = {
    campaign: () => currentCamp()?.campaign ?? null,
    grant: (gold, shards) => change((c) => ({ ...c, gold: c.gold + gold, shards: c.shards + shards })),
    setFlag: (flag, value) => change((c) => ({ ...c, flags: { ...c.flags, [flag]: value } })),
    lock: (facilities) => {
      locked = [...facilities];
      change((c) => ({ ...c }));
    },
    saved: () => writes.idle().then(() => true),
  };
  return () => {
    delete window.__camp;
  };
}

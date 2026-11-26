// The camp screens' view of the campaign: the camp session (src/ui/saves.ts), re-rendered on every change, and
// `apply`, which runs one of the camp's pure rules and saves the result (or returns the reason it was refused).

import { useLayoutEffect, useReducer } from 'preact/hooks';
import type { CampaignSave, Result } from '../../save/format';
import { commitCamp, currentCamp, now, onCampChange, type CampSession } from '../saves';

export interface CampView extends CampSession {
  /** Run a rule on the campaign; on success the result is saved and shown. Returns null or the reason. */
  apply: (rule: (c: CampaignSave) => Result<CampaignSave>) => string | null;
  /** Save a campaign the caller already changed. */
  commit: (c: CampaignSave) => void;
}

export function useCamp(): CampView | null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Subscribed before the first paint, so a change right after the screen shows (a test hook, a fast tap) re-renders it.
  useLayoutEffect(() => onCampChange(() => bump(undefined)), []);
  const s = currentCamp();
  if (!s) return null;
  const commit = (c: CampaignSave) => commitCamp(s.slot, { ...c, updatedAt: now() });
  return {
    ...s,
    commit,
    apply: (rule) => {
      const r = rule(s.campaign);
      if (!r.ok) return r.error;
      commit(r.value);
      return null;
    },
  };
}

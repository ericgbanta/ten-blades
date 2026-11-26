// The app's save services: the storage (opened once), the write queue, and the
// campaign run the battle route should play. Lives at the UI boundary, so the
// clock is read here.

import { chapters, gameData } from '../data';
import type { CampaignSave, SaveContext, SlotId, SuspendSave } from '../save/format';
import { SaveQueue } from '../save/queue';
import { openSaveStorage, type SaveStorage } from '../save/storage';

export const saveContext: SaveContext = { data: gameData, chapters };

let opened: Promise<SaveStorage> | null = null;

export function storage(): Promise<SaveStorage> {
  opened ??= openSaveStorage(saveContext);
  return opened;
}

export const writes = new SaveQueue((error) => console.warn('A save could not be written.', error));

/** Storage with every queued write finished, for screens that read saves. */
export async function settledStorage(): Promise<SaveStorage> {
  const s = await storage();
  await writes.idle();
  return s;
}

export const now = (): number => Date.now();

/** The campaign map the battle route plays next. */
export interface CampaignRun {
  slot: SlotId;
  campaign: CampaignSave;
  /** Set when resuming a suspended battle. */
  resume: SuspendSave | null;
}

let run: CampaignRun | null = null;
let finished: { slot: SlotId; campaign: CampaignSave; chapterName: string } | null = null;

/** The run to play, cleared as it is taken so it is played at most once. */
export function takeRun(): CampaignRun | null {
  const r = run;
  run = null;
  return r;
}

export function startRun(next: CampaignRun): void {
  run = next;
  finished = null;
  window.location.hash = '#/battle';
}

/** Record a won chapter for the Chapter complete screen. */
export function finishRun(slot: SlotId, campaign: CampaignSave, chapterName: string): void {
  finished = { slot, campaign, chapterName };
}

export const finishedRun = () => finished;

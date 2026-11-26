// The app's save services: the storage (opened once), the write queue, and the
// campaign run the battle route should play. Lives at the UI boundary, so the
// clock is read here.

import { chapters, gameData } from '../data';
import { sceneIds } from '../data/story';
import type { CampaignSave, SaveContext, SlotId, SuspendSave } from '../save/format';
import { SaveQueue } from '../save/queue';
import { openSaveStorage, type SaveStorage } from '../save/storage';
import { flowStep, settle } from '../story/flow';

export const saveContext: SaveContext = { data: gameData, chapters, sceneIds };

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

/** Queue a write of a campaign to its slot. */
export function saveCampaign(slot: SlotId, campaign: CampaignSave): void {
  void storage().then((store) => writes.push(() => store.saveSlot(slot, campaign)));
}

/**
 * Play a campaign from where it stands: a suspended battle resumes on the battle route; otherwise the chapter
 * flow says whether the next thing is a scene (the story route) or the battle. A campaign the flow had to move
 * on (a stage that had not begun, a finished outro) is saved first.
 */
export function startRun(next: CampaignRun): void {
  finished = null;
  if (next.resume) {
    run = next;
    window.location.hash = '#/battle';
    return;
  }
  const campaign = settle(next.campaign, chapters, gameData, now());
  if (campaign !== next.campaign) saveCampaign(next.slot, campaign);
  run = { ...next, campaign };
  const step = flowStep(campaign, chapters, gameData);
  if (step.kind === 'scene') window.location.hash = '#/story';
  else if (step.kind === 'battle') window.location.hash = '#/battle';
  else {
    run = null;
    const done = campaign.progress.completed.at(-1);
    finishRun(next.slot, campaign, chapters.find((c) => c.id === done)?.name ?? 'Chapter');
    window.location.hash = '#/complete';
  }
}

/** Record a finished chapter for the Chapter complete screen. */
export function finishRun(slot: SlotId, campaign: CampaignSave, chapterName: string): void {
  finished = { slot, campaign, chapterName };
}

export const finishedRun = () => finished;

// Turns the battle controller's checkpoints into save writes for one attempt at
// a campaign map. Writes go through a SaveQueue, so they never hold up playback.
//
// While the battle runs, each checkpoint replaces the suspend save. When it ends:
// the final state is written to the suspend slot first (so a tab closed right now
// still resumes to the same ending), then on victory the campaign is written to
// its slot, and then the suspend save is cleared. On defeat the campaign is left
// as it was and the suspend save is cleared.

import type { BattleState } from '../core';
import { completeChapter, suspendSave } from './campaign';
import type { CampaignSave, ChapterDef, SlotId, SuspendController } from './format';
import type { SaveQueue } from './queue';
import type { SaveStorage } from './storage';

export interface BattleSaverOptions {
  store: SaveStorage;
  queue: SaveQueue;
  slot: SlotId;
  /** The campaign as it was when this map started. */
  campaign: CampaignSave;
  chapters: readonly ChapterDef[];
  now: () => number;
}

export class BattleSaver {
  private ended = false;
  /** The campaign after a victory, set the moment the battle is won. */
  completed: CampaignSave | null = null;

  constructor(private readonly o: BattleSaverOptions) {}

  checkpoint(state: BattleState, extra: SuspendController): void {
    const { store, queue, slot, campaign } = this.o;
    if (this.ended) return;
    const suspend = suspendSave(slot, campaign, state, extra, this.o.now());
    queue.push(() => store.saveSuspend(suspend), 'suspend');
    if (state.result === 'ongoing') return;
    this.ended = true;
    if (state.result === 'victory') {
      const next = completeChapter(campaign, state, this.o.chapters, this.o.now());
      this.completed = next;
      queue.push(async () => {
        await store.saveSlot(slot, next);
        await store.clearSuspend();
      });
    } else {
      queue.push(() => store.clearSuspend());
    }
  }
}

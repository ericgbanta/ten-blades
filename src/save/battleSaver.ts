// Turns the battle controller's checkpoints into save writes for one attempt at
// a campaign map. Writes go through a SaveQueue, so they never hold up playback.
//
// While the battle runs, each checkpoint replaces the suspend save. When it ends:
// the final state is written to the suspend slot first (so a tab closed right now
// still resumes to the same ending), then on victory the campaign is written to
// its slot (a story map moves on to its outro, a skirmish counts its win and pays
// out), and then the suspend save is cleared. On defeat the campaign is left as
// it was and the suspend save is cleared.

import type { BattleState } from '../core';
import type { EconomyDef, SkirmishDef } from '../camp/types';
import { completeChapter, completeSkirmish, suspendSave } from './campaign';
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
  /** Rewards and the merchant's numbers. Without it, a won story map pays nothing (tests). */
  economy?: EconomyDef;
  /** The side skirmish being played, or none for the chapter's story map. */
  skirmish?: { id: string; def: SkirmishDef } | null;
}

export class BattleSaver {
  private ended = false;
  /** The campaign after a victory, set the moment the battle is won. */
  completed: CampaignSave | null = null;

  constructor(private readonly o: BattleSaverOptions) {}

  checkpoint(state: BattleState, extra: SuspendController): void {
    const { store, queue, slot, campaign } = this.o;
    if (this.ended) return;
    const sk = this.o.skirmish ?? null;
    const suspend = suspendSave(slot, campaign, state, extra, this.o.now(), sk?.id ?? null);
    queue.push(() => store.saveSuspend(suspend), 'suspend');
    if (state.result === 'ongoing') return;
    this.ended = true;
    if (state.result === 'victory') {
      const next =
        sk && this.o.economy
          ? completeSkirmish(campaign, state, sk.id, sk.def, this.o.chapters, this.o.economy, this.o.now())
          : completeChapter(campaign, state, this.o.chapters, this.o.now(), this.o.economy);
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

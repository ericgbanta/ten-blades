// Load game: the three slots. Loading starts the slot's current chapter from the
// start of its map. A suspended battle is resumed with Continue on the title.

import { useState } from 'preact/hooks';
import { chapters, gameData } from '../../data';
import type { CampaignSave, SlotId } from '../../save/format';
import { canPlay, settle } from '../../story/flow';
import { now, startRun, writes } from '../saves';
import { Confirm, Screen, SlotCard, goTo, useSaves } from './Screen';
import { chapterName } from './copy';

type Asking = { kind: 'suspend'; slot: SlotId; save: CampaignSave } | { kind: 'done'; save: CampaignSave };

export function LoadGame() {
  const { saves } = useSaves();
  const [asking, setAsking] = useState<Asking | null>(null);

  const start = async (slot: SlotId, save: CampaignSave) => {
    if (!saves) return;
    await writes.idle();
    await saves.store.clearSuspend();
    startRun({ slot, campaign: save, resume: null });
  };

  const tap = (slot: SlotId, save: CampaignSave) => {
    if (!canPlay(settle(save, chapters, gameData, now()), chapters, gameData)) setAsking({ kind: 'done', save });
    else if (saves?.suspend) setAsking({ kind: 'suspend', slot, save });
    else void start(slot, save);
  };

  const anySave = saves?.slots.some((s) => s.save) ?? false;
  return (
    <Screen title="Load game" back={goTo('#/')} backLabel="Title">
      {!saves ? (
        <p class="muted">Reading saves...</p>
      ) : (
        <>
          <p class="menu-lead">{anySave ? 'Pick a campaign to play its next chapter.' : 'No saved campaigns yet. Start one with New game.'}</p>
          <div class="slot-list">
            {saves.slots.map((info) => (
              <SlotCard
                key={info.slot}
                info={info}
                suspended={saves.suspend?.slot === info.slot}
                disabled={!info.save}
                action={info.save ? `Play ${chapterName(info.save.progress.current)}` : undefined}
                onTap={info.save ? () => tap(info.slot, info.save!) : undefined}
              />
            ))}
          </div>
          {saves.suspend && <p class="menu-note">A battle is suspended. Use Continue on the title screen to pick it up.</p>}
        </>
      )}
      {asking?.kind === 'done' && (
        <Confirm
          text="To be continued"
          detail={`${asking.save.mc.name} has finished the story so far. More chapters are coming.`}
          yes="OK"
          onYes={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'suspend' && (
        <Confirm
          text="Start this chapter over?"
          detail={
            saves?.suspend?.slot === asking.slot
              ? 'This campaign has a suspended battle. Loading starts the map again and the suspended battle is lost.'
              : 'Another campaign has a suspended battle. Loading this one ends it.'
          }
          yes="Load"
          danger
          onYes={() => {
            const a = asking;
            setAsking(null);
            void start(a.slot, a.save);
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </Screen>
  );
}

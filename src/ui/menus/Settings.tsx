// Settings: animation speed, battle scenes, save codes (export and import), deleting a slot,
// and a notice when saves only last until the tab closes.

import { useState } from 'preact/hooks';
import type { SceneMode, Speed } from '../../battle/controller';
import { decodeSaveCode, encodeSaveCode } from '../../save/code';
import type { CampaignSave, SlotId } from '../../save/format';
import { loadPrefs, savePrefs, sceneModeOf } from '../../save/prefs';
import { saveContext, writes } from '../saves';
import { Choices, Confirm, Screen, SlotCard, goTo, useSaves, type SavesView } from './Screen';

export function Settings() {
  const { saves, reload } = useSaves();
  const [speed, setSpeed] = useState<Speed>(() => loadPrefs().speed);
  const [scenes, setScenes] = useState<SceneMode>(() => sceneModeOf(loadPrefs(), window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  return (
    <Screen title="Settings" back={goTo('#/')} backLabel="Title">
      {saves && !saves.store.persistent && (
        <p class="menu-notice" role="status">
          This browser is not letting the game keep saves (private browsing can do this). Saves last only until you close this tab. Export a save
          code to keep your progress.
        </p>
      )}
      <Choices
        label="Animation speed"
        compact
        value={speed}
        options={[
          { value: 'normal', name: 'Normal' },
          { value: 'fast', name: 'Fast' },
        ]}
        onChange={(s) => {
          setSpeed(s);
          savePrefs({ ...loadPrefs(), speed: s });
        }}
      />
      <Choices
        label="Battle scenes"
        compact
        value={scenes}
        options={[
          { value: 'full', name: 'Full' },
          { value: 'fast', name: 'Fast' },
          { value: 'off', name: 'Off' },
        ]}
        onChange={(m) => {
          setScenes(m);
          savePrefs({ ...loadPrefs(), sceneMode: m });
        }}
      />
      {saves ? (
        <>
          <ExportSection saves={saves} />
          <ImportSection saves={saves} reload={reload} />
          <DeleteSection saves={saves} reload={reload} />
        </>
      ) : (
        <p class="muted">Reading saves...</p>
      )}
    </Screen>
  );
}

function ExportSection({ saves }: { saves: SavesView }) {
  const [code, setCode] = useState<{ slot: SlotId; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const filled = saves.slots.filter((s) => s.save);
  const make = async (slot: SlotId, save: CampaignSave) => {
    setCopied(null);
    setCode({ slot, text: await encodeSaveCode(save) });
  };
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.text);
      setCopied('Copied. Paste it into Import on your other device.');
    } catch {
      setCopied('Could not copy by itself. Select the code and copy it.');
    }
  };
  return (
    <section class="menu-section" aria-labelledby="export-title">
      <h2 id="export-title">Export a save code</h2>
      {filled.length === 0 ? (
        <p class="muted">No campaigns to export yet.</p>
      ) : (
        <div class="menu-row wrap">
          {filled.map((s) => (
            <button
              key={s.slot}
              type="button"
              class={`btn small-menu${code?.slot === s.slot ? ' on' : ''}`}
              onClick={() => void make(s.slot, s.save!)}
            >
              Slot {s.slot}: {s.save!.mc.name}
            </button>
          ))}
        </div>
      )}
      {code && (
        <>
          <textarea class="code-box" readOnly aria-label="Save code" value={code.text} onFocus={(e) => e.currentTarget.select()} rows={4} />
          <button type="button" class="btn primary wide" onClick={() => void copy()}>
            Copy code
          </button>
          {copied && (
            <p class="menu-note" role="status">
              {copied}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ImportSection({ saves, reload }: { saves: SavesView; reload: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<CampaignSave | null>(null);
  const [overwrite, setOverwrite] = useState<SlotId | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  const check = async () => {
    setDone(null);
    setDecoded(null);
    const r = await decodeSaveCode(text, saveContext);
    if (r.ok) {
      setError(null);
      setDecoded(r.value);
    } else setError(r.error);
  };
  const paste = async () => {
    try {
      setText(await navigator.clipboard.readText());
      setError(null);
    } catch {
      setError('Could not read the clipboard. Paste the code into the box instead.');
    }
  };
  const write = async (slot: SlotId) => {
    if (!decoded) return;
    await writes.idle();
    await saves.store.saveSlot(slot, decoded);
    // A suspended battle of the old campaign in this slot no longer matches it.
    if (saves.suspend?.slot === slot) await saves.store.clearSuspend();
    setDone(`${decoded.mc.name}'s campaign is in slot ${slot}.`);
    setDecoded(null);
    setText('');
    reload();
  };
  const target = overwrite === null ? null : saves.slots.find((s) => s.slot === overwrite);
  return (
    <section class="menu-section" aria-labelledby="import-title">
      <h2 id="import-title">Import a save code</h2>
      <textarea
        class="code-box"
        aria-label="Paste a save code"
        placeholder="Paste a save code here"
        value={text}
        rows={3}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setError(null);
          setDecoded(null);
        }}
      />
      <div class="menu-row">
        {canPaste && (
          <button type="button" class="btn quiet" onClick={() => void paste()}>
            Paste
          </button>
        )}
        <button type="button" class="btn primary" onClick={() => void check()}>
          Import
        </button>
      </div>
      {error && (
        <p class="menu-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p class="menu-note" role="status">
          {done}
        </p>
      )}
      {decoded && (
        <div class="menu-pick">
          <p class="menu-lead">Choose a slot for {decoded.mc.name}'s campaign.</p>
          <div class="slot-list">
            {saves.slots.map((info) => (
              <SlotCard
                key={info.slot}
                info={info}
                suspended={saves.suspend?.slot === info.slot}
                action={info.save || info.error ? 'Overwrite' : 'Import here'}
                onTap={() => (info.save || info.error ? setOverwrite(info.slot) : void write(info.slot))}
              />
            ))}
          </div>
        </div>
      )}
      {target && overwrite !== null && (
        <Confirm
          text={`Overwrite slot ${overwrite}?`}
          detail={`${target.save ? `${target.save.mc.name}'s campaign` : 'The save'} in this slot will be replaced.`}
          yes="Overwrite"
          danger
          onYes={() => {
            const slot = overwrite;
            setOverwrite(null);
            void write(slot);
          }}
          onNo={() => setOverwrite(null)}
        />
      )}
    </section>
  );
}

function DeleteSection({ saves, reload }: { saves: SavesView; reload: () => void }) {
  const [asking, setAsking] = useState<SlotId | null>(null);
  const filled = saves.slots.filter((s) => s.save || s.error);
  const target = asking === null ? null : saves.slots.find((s) => s.slot === asking);
  const remove = async (slot: SlotId) => {
    await writes.idle();
    await saves.store.deleteSlot(slot);
    if (saves.suspend?.slot === slot) await saves.store.clearSuspend();
    reload();
  };
  return (
    <section class="menu-section" aria-labelledby="delete-title">
      <h2 id="delete-title">Delete a slot</h2>
      {filled.length === 0 ? (
        <p class="muted">All slots are empty.</p>
      ) : (
        <div class="menu-row wrap">
          {filled.map((s) => (
            <button key={s.slot} type="button" class="btn small-menu danger-outline" onClick={() => setAsking(s.slot)}>
              Delete slot {s.slot}
            </button>
          ))}
        </div>
      )}
      {target && asking !== null && (
        <Confirm
          text={`Delete slot ${asking}?`}
          detail={`${target.save ? `${target.save.mc.name}'s campaign` : 'This save'} will be gone for good${
            saves.suspend?.slot === asking ? ', along with its suspended battle' : ''
          }. Export a code first if you want to keep it.`}
          yes="Delete"
          danger
          onYes={() => {
            const slot = asking;
            setAsking(null);
            void remove(slot);
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </section>
  );
}

// Shared pieces of the menu screens: the page frame, slot cards, a confirm
// dialog, and a hook that reads the slots and the suspend save.

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SuspendSave } from '../../save/format';
import type { SaveStorage, SlotInfo } from '../../save/storage';
import { settledStorage } from '../saves';
import { formatTime, slotLine } from './copy';
import './menus.css';

export function Screen(props: { title: string; back?: () => void; backLabel?: string; wide?: boolean; children: ComponentChildren }) {
  return (
    <div class={`menu-screen${props.wide ? ' wide' : ''}`}>
      <header class="menu-head">
        {props.back ? (
          <button type="button" class="btn quiet menu-back" onClick={props.back}>
            {props.backLabel ?? 'Back'}
          </button>
        ) : (
          <span class="menu-back-spacer" />
        )}
        <h1 class="menu-title">
          <span class="ribbon">{props.title}</span>
        </h1>
        <span class="menu-back-spacer" />
      </header>
      <main class="menu-body">{props.children}</main>
    </div>
  );
}

export const goTo = (route: string) => () => {
  window.location.hash = route;
};

export interface SavesView {
  store: SaveStorage;
  slots: SlotInfo[];
  suspend: SuspendSave | null;
  /** Set when a suspend save exists but cannot be read. */
  suspendError: string | null;
}

/** Reads the slots and the suspend save, after any pending writes. `reload` reads again. */
export function useSaves(): { saves: SavesView | null; reload: () => void } {
  const [saves, setSaves] = useState<SavesView | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const store = await settledStorage();
      const [slots, suspend] = await Promise.all([store.listSlots(), store.loadSuspend()]);
      if (!live) return;
      setSaves({
        store,
        slots,
        suspend: suspend.ok ? suspend.value : null,
        suspendError: suspend.ok ? null : suspend.error,
      });
    })();
    return () => {
      live = false;
    };
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { saves, reload };
}

export function SlotCard(props: { info: SlotInfo; suspended: boolean; onTap?: () => void; disabled?: boolean; action?: string }) {
  const { info } = props;
  const save = info.save;
  const body = save ? (
    <>
      <span class="slot-name">{save.mc.name}</span>
      <span class="slot-line">{slotLine(save)}</span>
      <span class="slot-time">
        Last played {formatTime(save.updatedAt)}
        {props.suspended && <span class="slot-chip">Battle suspended</span>}
      </span>
    </>
  ) : info.error ? (
    <>
      <span class="slot-name">Damaged save</span>
      <span class="slot-line">{info.error}</span>
    </>
  ) : (
    <span class="slot-empty">Empty</span>
  );
  return (
    <button
      type="button"
      class={`slot-card framed${save ? '' : ' empty'}`}
      onClick={props.onTap}
      disabled={props.disabled}
      aria-label={`Slot ${info.slot}: ${save ? save.mc.name : info.error ? 'damaged' : 'empty'}${props.action ? `. ${props.action}` : ''}`}
    >
      <span class="slot-num">{info.slot}</span>
      <span class="slot-body">{body}</span>
    </button>
  );
}

export interface ConfirmProps {
  text: string;
  detail?: string;
  yes: string;
  no?: string;
  danger?: boolean;
  onYes: () => void;
  onNo?: () => void;
}

export function Confirm(props: ConfirmProps) {
  return (
    <div class="menu-scrim" role="dialog" aria-modal="true" aria-label={props.text}>
      <div class="menu-dialog framed">
        <p class="menu-dialog-text">{props.text}</p>
        {props.detail && <p class="menu-dialog-detail">{props.detail}</p>}
        <div class="menu-row">
          {props.onNo && (
            <button type="button" class="btn quiet" onClick={props.onNo}>
              {props.no ?? 'Cancel'}
            </button>
          )}
          <button type="button" class={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={props.onYes}>
            {props.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A group of large choice buttons, one selected (radio semantics). */
export function Choices<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; name: string; line?: string; tag?: string }[];
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <fieldset class={`choices${props.compact ? ' compact' : ''}`}>
      <legend>{props.label}</legend>
      <div class="choices-list" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === props.value}
            class={`choice${o.value === props.value ? ' on' : ''}`}
            onClick={() => props.onChange(o.value)}
          >
            <span class="choice-name">
              {o.name}
              {o.tag && <span class="choice-tag">{o.tag}</span>}
            </span>
            {o.line && <span class="choice-line">{o.line}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

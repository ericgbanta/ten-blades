// Save storage: 3 campaign slots plus 1 suspend slot behind a small promise API.
// The real backend is IndexedDB (idb.ts); an in-memory backend is used by unit
// tests and as the fallback when IndexedDB is unavailable (private browsing).
// Every load goes through migrate and the validator; every save is validated
// before it is written, so a bad object never reaches the disk.

import { SLOT_IDS, ok, type CampaignSave, type Result, type SaveContext, type SlotId, type SuspendSave } from './format';
import { readCampaign, readSuspend } from './load';
import { validateCampaign, validateSuspend } from './validate';

/** A plain key to JSON value store. Values go in and come out as plain JSON. */
export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SlotInfo {
  slot: SlotId;
  /** null when the slot is empty or unreadable. */
  save: CampaignSave | null;
  /** Set when something is stored there but it could not be read. */
  error: string | null;
}

export interface SaveStorage {
  /** False when saves only last until the tab closes (the in-memory fallback). */
  readonly persistent: boolean;
  listSlots(): Promise<SlotInfo[]>;
  /** ok(null) for an empty slot; an error for one that cannot be read. */
  loadSlot(slot: SlotId): Promise<Result<CampaignSave | null>>;
  saveSlot(slot: SlotId, save: CampaignSave): Promise<void>;
  deleteSlot(slot: SlotId): Promise<void>;
  loadSuspend(): Promise<Result<SuspendSave | null>>;
  saveSuspend(save: SuspendSave): Promise<void>;
  clearSuspend(): Promise<void>;
}

export const slotKey = (slot: SlotId): string => `slot${slot}`;
export const SUSPEND_KEY = 'suspend';

/** Values are copied through JSON in both directions, like a real store would. */
export class MemoryBackend implements KeyValueBackend {
  private readonly items = new Map<string, string>();
  async get(key: string): Promise<unknown> {
    const v = this.items.get(key);
    return v === undefined ? undefined : JSON.parse(v);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.items.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.items.delete(key);
  }
}

export function createSaveStorage(backend: KeyValueBackend, ctx: SaveContext, persistent: boolean): SaveStorage {
  const loadSlot = async (slot: SlotId): Promise<Result<CampaignSave | null>> => {
    const raw = await backend.get(slotKey(slot));
    if (raw === undefined || raw === null) return ok(null);
    return readCampaign(raw, ctx);
  };
  return {
    persistent,
    loadSlot,
    async listSlots() {
      const out: SlotInfo[] = [];
      for (const slot of SLOT_IDS) {
        const r = await loadSlot(slot);
        out.push(r.ok ? { slot, save: r.value, error: null } : { slot, save: null, error: r.error });
      }
      return out;
    },
    async saveSlot(slot, save) {
      const v = validateCampaign(JSON.parse(JSON.stringify(save)), ctx);
      if (!v.ok) throw new Error(`Refusing to write an invalid save: ${v.error}`);
      await backend.put(slotKey(slot), v.value);
    },
    async deleteSlot(slot) {
      await backend.delete(slotKey(slot));
    },
    async loadSuspend() {
      const raw = await backend.get(SUSPEND_KEY);
      if (raw === undefined || raw === null) return ok(null);
      return readSuspend(raw, ctx);
    },
    async saveSuspend(save) {
      const v = validateSuspend(JSON.parse(JSON.stringify(save)), ctx);
      if (!v.ok) throw new Error(`Refusing to write an invalid suspend save: ${v.error}`);
      await backend.put(SUSPEND_KEY, v.value);
    },
    async clearSuspend() {
      await backend.delete(SUSPEND_KEY);
    },
  };
}

export function memoryStorage(ctx: SaveContext): SaveStorage {
  return createSaveStorage(new MemoryBackend(), ctx, false);
}

/** IndexedDB when it opens, else the in-memory fallback (check `persistent`). */
export async function openSaveStorage(ctx: SaveContext): Promise<SaveStorage> {
  try {
    const { openIdbBackend } = await import('./idb');
    const backend = await openIdbBackend();
    return createSaveStorage(backend, ctx, true);
  } catch (error) {
    console.warn('IndexedDB is not available; saves will last only until this tab closes.', error);
    return memoryStorage(ctx);
  }
}

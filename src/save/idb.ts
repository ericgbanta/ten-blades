// The IndexedDB backend: one database, one object store, one record per slot.
// Values are stored as plain objects (structured clone of JSON).

import type { KeyValueBackend } from './storage';

const DB_NAME = 'ten-blades';
const STORE = 'saves';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 4000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is missing'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB took too long to open')), OPEN_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('IndexedDB would not open'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB is blocked by another tab'));
    };
  });
}

/** Opens the database once to prove it works; reopens later if the connection closes. */
export async function openIdbBackend(): Promise<KeyValueBackend> {
  let db: IDBDatabase | null = null;
  const connect = async (): Promise<IDBDatabase> => {
    if (db) return db;
    const opened = await openDb();
    // Let another tab (or a test wiping storage) upgrade or delete the database.
    opened.onversionchange = () => {
      opened.close();
      db = null;
    };
    opened.onclose = () => {
      db = null;
    };
    db = opened;
    return opened;
  };
  await connect();

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const conn = await connect();
    const tx = conn.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
    const [result] = await Promise.all([request(work(tx.objectStore(STORE))), done]);
    return result;
  };

  return {
    get: (key) => run<unknown>('readonly', (s) => s.get(key)),
    put: async (key, value) => {
      await run('readwrite', (s) => s.put(value, key));
    },
    delete: async (key) => {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}

// Registers the service worker (dist/sw.js, written by tools/pwa at build time) and reports when a new build is
// waiting. See docs/UI_NOTES.md, PWA and offline.
//
// It only runs in a production build. Under `?test=1` it stays off unless `sw=1` is also in the URL, so the e2e
// suite controls when a worker is present (Playwright also blocks workers except in the offline test).

export interface UpdateHandle {
  /** Ask the waiting worker to take over, then reload the page once it has. */
  apply(): void;
}

let waitingHandle: UpdateHandle | null = null;
const listeners = new Set<(u: UpdateHandle | null) => void>();

/** The waiting update, or null. */
export const pendingUpdate = (): UpdateHandle | null => waitingHandle;

/** Called with the waiting update whenever one appears. Returns an unsubscribe function. */
export function onUpdate(fn: (u: UpdateHandle | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(worker: ServiceWorker): void {
  waitingHandle = {
    apply() {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      worker.postMessage({ type: 'skip-waiting' });
    },
  };
  for (const fn of listeners) fn(waitingHandle);
}

/** Whether this page should register the worker: a production build, and not a test run unless it asks. */
export function wantsServiceWorker(search: string, prod: boolean, supported: boolean): boolean {
  if (!prod || !supported) return false;
  const q = new URLSearchParams(search);
  return !q.has('test') || q.get('sw') === '1';
}

export function registerServiceWorker(): void {
  if (!wantsServiceWorker(window.location.search, import.meta.env.PROD, 'serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // A worker for a newer build may already be waiting from an earlier visit.
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // With no controller this is the first install, not an update: nothing to announce.
            if (next.state === 'installed' && navigator.serviceWorker.controller) announce(next);
          });
        });
        // Look for a new build when the game comes back to the front (a home screen app can stay open for days).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        });
      })
      .catch((error: unknown) => console.warn('The offline cache could not be set up.', error));
  });
}

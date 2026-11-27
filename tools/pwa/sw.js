// The service worker template. tools/pwa/plugin.ts writes dist/sw.js from it at build time, with two constants
// put in front: VERSION (a hash of every file the build wrote) and PRECACHE (their paths, relative to the scope).
// See docs/UI_NOTES.md, PWA and offline.
//
// - install: fetch every file of this build into the cache `ten-blades-<VERSION>`. The new worker then waits.
// - activate: delete every other `ten-blades-*` cache, and take control of open pages.
// - fetch: a page load gets this build's index.html from the cache (any query or hash: routes live in the hash);
//   a file of this build comes from the cache; anything else goes to the network.
// - message `skip-waiting`: the page's "Reload" button asks a waiting worker to take over now. Otherwise it takes
//   over the next time the game starts with no page of it open.
//
// It never touches IndexedDB, so saves are not affected by an update.

// VERSION and PRECACHE are declared as globals for this file in eslint.config.js.

const PREFIX = 'ten-blades-';
const CACHE = PREFIX + VERSION;
const scope = new URL(self.registration.scope);
const shell = new URL('index.html', scope).href;
const files = new Set(PRECACHE.map((p) => new URL(p, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` skips the HTTP cache, so a file is never taken from an older build.
      await cache.addAll([...files].map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(fromCache(shell, req));
    return;
  }
  url.search = '';
  url.hash = '';
  if (files.has(url.href)) event.respondWith(fromCache(url.href, req));
});

/** The cached copy of `key`, else the network (and the network's error when offline). */
async function fromCache(key, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  return hit ?? fetch(req);
}

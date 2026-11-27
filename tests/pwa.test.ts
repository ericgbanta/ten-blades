import { describe, expect, it } from 'vitest';
import { cacheVersion, precacheList, workerSource } from '../tools/pwa/plugin';
import { wantsServiceWorker } from '../src/pwa/register';
import manifest from '../public/manifest.webmanifest?raw';

describe('service worker build', () => {
  it('caches every game file, index.html first, and leaves out the worker itself and non-game files', () => {
    const list = precacheList(['sw.js', 'assets/b.js', '.nojekyll', 'index.html', 'assets/a.webp', 'assets/b.js.map', 'icons/favicon-48.png', 'icons/icon-192.png', 'manifest.webmanifest']);
    expect(list).toEqual(['index.html', 'assets/a.webp', 'assets/b.js', 'icons/icon-192.png', 'manifest.webmanifest']);
  });

  it('gives the same version for the same files in any order, and a new one when any file changes', () => {
    const a = [
      { path: 'index.html', content: '<html>' },
      { path: 'assets/x.js', content: 'x' },
    ];
    const v = cacheVersion(a);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(cacheVersion([...a].reverse())).toBe(v);
    expect(cacheVersion([a[0]!, { path: 'assets/x.js', content: 'y' }])).not.toBe(v);
    expect(cacheVersion([a[0]!, { path: 'assets/z.js', content: 'x' }])).not.toBe(v);
  });

  it('puts the version and the list in front of the template', () => {
    const src = workerSource('// template', 'abc', ['index.html']);
    expect(src).toBe('const VERSION = "abc";\nconst PRECACHE = ["index.html"];\n\n// template');
  });
});

describe('service worker registration', () => {
  it('runs in a production build only, and not under test=1 unless sw=1', () => {
    expect(wantsServiceWorker('', true, true)).toBe(true);
    expect(wantsServiceWorker('', false, true)).toBe(false);
    expect(wantsServiceWorker('', true, false)).toBe(false);
    expect(wantsServiceWorker('?test=1', true, true)).toBe(false);
    expect(wantsServiceWorker('?test=1&sw=1', true, true)).toBe(true);
  });
});

describe('web manifest', () => {
  it('installs standalone under /ten-blades/ with the three icons', () => {
    const m = JSON.parse(manifest) as Record<string, unknown> & { icons: { src: string; sizes: string; purpose: string }[] };
    expect(m).toMatchObject({ start_url: '/ten-blades/', scope: '/ten-blades/', display: 'standalone', short_name: 'Ten Blades' });
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  });
});

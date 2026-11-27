// A small Vite plugin that writes the service worker (dist/sw.js) after a production build.
// It lists every file the build wrote, hashes them into a cache version, and puts both in front of the template
// in tools/pwa/sw.js. Nothing runs on the dev server. See docs/UI_NOTES.md, PWA and offline.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

export const SW_FILE = 'sw.js';

/** Files the worker does not cache: itself, and files that are not part of the game. */
const SKIP = [/^sw\.js$/, /^\.nojekyll$/, /\.map$/, /^icons\/favicon-/];

/** The paths (relative to the scope, with forward slashes) the worker caches, sorted. index.html comes first. */
export function precacheList(paths: readonly string[]): string[] {
  const keep = paths.filter((p) => !SKIP.some((r) => r.test(p))).sort();
  return keep.includes('index.html') ? ['index.html', ...keep.filter((p) => p !== 'index.html')] : keep;
}

/** A short hash of every cached file's path and content: the same build gives the same version. */
export function cacheVersion(files: readonly { path: string; content: Uint8Array | string }[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path);
    h.update('\0');
    h.update(createHash('sha256').update(f.content).digest());
  }
  return h.digest('hex').slice(0, 12);
}

/** The worker's source: the two constants, then the template. */
export function workerSource(template: string, version: string, precache: readonly string[]): string {
  return `const VERSION = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(precache)};\n\n${template}`;
}

function walk(dir: string, root: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

export function serviceWorker(templatePath: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'ten-blades-sw',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const precache = precacheList(walk(outDir, outDir, []));
      const version = cacheVersion(precache.map((p) => ({ path: p, content: readFileSync(join(outDir, p)) })));
      writeFileSync(join(outDir, SW_FILE), workerSource(readFileSync(templatePath, 'utf8'), version, precache));
      const bytes = precache.reduce((n, p) => n + statSync(join(outDir, p)).size, 0);
      console.log(`service worker: ${precache.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB, cache ${version}`);
    },
  };
}

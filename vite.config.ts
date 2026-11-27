import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { serviceWorker } from './tools/pwa/plugin.ts';

export default defineConfig({
  base: '/ten-blades/',
  // The service worker is written after a production build (tools/pwa); the dev server has none.
  plugins: [preact(), serviceWorker('tools/pwa/sw.js')],
  build: {
    chunkSizeWarningLimit: 2000,
    // Art stays as files, never inlined into the script: the main character's many small layers would
    // otherwise bloat the bundle that every screen loads.
    assetsInlineLimit: (file: string) => (file.includes('/src/art/') ? false : undefined),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

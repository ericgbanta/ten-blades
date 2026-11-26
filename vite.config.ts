import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/ten-blades/',
  plugins: [preact()],
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

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:4173/ten-blades/',
    browserName: 'chromium',
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    trace: 'off',
    // The service worker stays out of the way of every test but the offline one (e2e/offline.spec.ts), which allows it.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/ten-blades/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

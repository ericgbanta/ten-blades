import { expect, test } from '@playwright/test';
import { idle } from './helpers';

// The built game works offline after one visit. Workers are blocked in every other test (playwright.config.ts);
// here they are allowed, and `sw=1` lets the page register one under `test=1`.
test.use({ serviceWorkers: 'allow' });

test('after one visit the game loads offline: the title, and a battle with its art', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('./?test=1&sw=1#/');
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  // Wait until the worker has cached the whole build and controls the page.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state === 'activated' && navigator.serviceWorker.controller !== null;
  }, null, { timeout: 60_000 });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find((n) => n.startsWith('ten-blades-'))!);
    return { names, files: (await cache.keys()).length };
  });
  expect(cached.names).toHaveLength(1);
  expect(cached.files).toBeGreaterThan(500);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New game' })).toBeVisible();
  // The fonts and the backdrop come from the cache too.
  expect(await page.evaluate(() => document.fonts.check('700 16px Cinzel'))).toBe(true);

  // A quick battle: Phaser's chunk, the tiles and the tokens all load with no network.
  await page.goto('./?test=1&sw=1&quick=1&seed=7#/battle');
  await idle(page);
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => window.__tb!.tokenTexture('stranger'))).toBe('token.wanderer');
  await context.setOffline(false);
});

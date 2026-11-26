import { expect, test } from '@playwright/test';
import { newGame, trackErrors } from './helpers';

test('title to battle through the new game flow boots Phaser without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./?test=1');
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  for (const name of ['New game', 'Load game', 'Settings']) {
    const box = await page.getByRole('link', { name }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  // No suspended battle yet, so no Continue.
  await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
  await newGame(page, { name: 'Ash' });
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('the battle route without a run goes back to the title', async ({ page }) => {
  await page.goto('./#/battle');
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

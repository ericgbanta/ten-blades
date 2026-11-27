import { expect, test } from '@playwright/test';
import { beginNewGame, idle, playByTaps, skipScene } from './helpers';

// With prefers-reduced-motion: reduce, the game cuts motion: no CSS animations or transitions, dialogue lines
// appear whole, battle scenes start Off (fights stay on the map), and the map's camera cuts instead of easing.
test.use({ reducedMotion: 'reduce' });

test('reduced motion: a still title, whole dialogue lines, scenes Off and a camera that cuts', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?test=1&seed=7#/');
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  // Every animation and transition is cut.
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.animationName !== 'none' || (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) && cs.transitionProperty !== 'none');
    }).length,
  );
  expect(moving).toBe(0);

  // Settings: battle scenes default to Off.
  await page.getByRole('link', { name: 'Settings' }).tap();
  await expect(page.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Title' }).tap();

  // The intro's first line is shown whole at once, no typing.
  await beginNewGame(page, { name: 'Still' });
  const text = page.locator('.dlg-text');
  const whole = (await text.locator('.visually-hidden').textContent())!;
  expect(whole.length).toBeGreaterThan(10);
  await expect(text.locator('> span').first()).toHaveText(whole, { timeout: 200 });
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);
  await expect(page.getByTestId('scenes-toggle')).toHaveAccessibleName('Battle scenes: Off');

  // A move and a wait play on the map; the camera is at rest the moment the action has played.
  await playByTaps(page, { type: 'wait', unitId: 'mc', to: { x: 4, y: 9 } });
  expect(await page.evaluate(() => window.__tb!.settled())).toBe(true);
  expect(await page.evaluate(() => window.__tb!.fight())).toBeNull();
});

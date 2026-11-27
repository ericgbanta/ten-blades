import { expect, test, type Page } from '@playwright/test';
import { beginNewGame, idle, settle, skipScene, state, tapTile, trackErrors } from './helpers';

// Landscape on a phone (667 x 375, then 844 x 390): the new game flow, the creator, the battle map with the unit
// card and the orders, and the map's own touch gestures (one finger pans, two fingers pinch to zoom).
test.use({ viewport: { width: 667, height: 375 } });

/** Visible controls that are under 44 px or cut off by the screen edge (where nothing can scroll them in). */
async function badControls(page: Page, within = 'body'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const scrolls = (el: Element): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p === document.body || p === document.documentElement) return document.scrollingElement!.scrollHeight > innerHeight + 1;
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
      }
      return false;
    };
    for (const el of document.querySelector(sel)!.querySelectorAll('button, a, [role=radio], [role=tab]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('[aria-hidden=true]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24);
      if (r.width < 44 || r.height < 44) out.push(`${name}: ${Math.round(r.width)} x ${Math.round(r.height)}`);
      if ((r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) && !scrolls(el)) out.push(`${name}: off screen`);
    }
    if (document.scrollingElement!.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
    return out;
  }, within);
}

/** A two-finger pinch around a point, through the DevTools protocol (Playwright has no multi-touch API). */
async function pinch(page: Page, cx: number, cy: number, from: number, to: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  // Phaser reads input once a frame, so each step gets a frame of its own.
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + ((to - from) * i) / 8) });
  }
  await page.waitForTimeout(20);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('landscape: title, the new game flow and the creator, then the map with its card, orders, pan and pinch', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./?test=1&seed=7#/');
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  expect(await badControls(page)).toEqual([]);

  // The flow up to the creator, checking each step fits; Begin is reachable from the Style tab.
  await page.getByRole('link', { name: 'New game' }).tap();
  expect(await badControls(page)).toEqual([]);
  await page.goto('./?test=1&seed=7#/');
  await beginNewGame(page, { name: 'Wide', style: 'Spiritblade', look: [['Hair', 'Ponytail']] });
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  expect(await badControls(page, '.dlg')).toEqual([]);
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);
  expect(await badControls(page, '.battle')).toEqual([]);

  // The unit card and the orders sit in the right-hand column, with the map's free area left of it.
  const lord = (await state(page)).units.find((u) => u.isLord)!;
  await tapTile(page, lord.pos.x, lord.pos.y);
  await expect(page.getByText('Spiritblade · Lv 1')).toBeVisible();
  const dock = (await page.locator('.dock').boundingBox())!;
  expect(dock.x).toBeGreaterThan(667 / 2);
  expect(dock.y + dock.height).toBeLessThanOrEqual(375 + 1);
  await tapTile(page, lord.pos.x, lord.pos.y);
  await expect(page.getByRole('region', { name: /^Orders for/ })).toBeVisible();
  expect(await badControls(page, '.battle')).toEqual([]);
  await page.getByRole('button', { name: 'Cancel' }).tap();
  const selected = await page.evaluate(() => window.__tb!.getSelection());

  // One finger pans the map; two fingers pinch it bigger, then back.
  await settle(page);
  const before = (await page.evaluate(() => window.__tb!.tileToScreen(0, 0)))!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 150 }] });
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 150 + i * 10 }] });
  }
  await page.waitForTimeout(20);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await settle(page);
  const after = (await page.evaluate(() => window.__tb!.tileToScreen(0, 0)))!;
  expect(after.y).toBeGreaterThan(before.y);
  const size = (await page.evaluate(() => window.__tb!.tileSize()))!;
  await pinch(page, 180, 220, 30, 120);
  await settle(page);
  const zoomed = (await page.evaluate(() => window.__tb!.tileSize()))!;
  expect(zoomed).toBeGreaterThan(size * 1.5);
  await pinch(page, 180, 220, 120, 30);
  await settle(page);
  expect((await page.evaluate(() => window.__tb!.tileSize()))!).toBeLessThan(zoomed);
  // A pan or a pinch is never a tap: the selection is as it was.
  expect(await page.evaluate(() => window.__tb!.getSelection())).toEqual(selected);

  // A wider phone in landscape: the bars still fit.
  await page.setViewportSize({ width: 844, height: 390 });
  await settle(page);
  await expect(page.getByRole('button', { name: 'End turn' })).toBeInViewport();
  expect(await badControls(page, '.battle')).toEqual([]);
  expect(errors).toEqual([]);
});

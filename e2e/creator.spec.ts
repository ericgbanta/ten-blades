import { expect, test } from '@playwright/test';
import { idle, newGame, saved, state, trackErrors } from './helpers';

/** The campaign save in a slot, read straight from IndexedDB. */
function readSlot(slot: number): Promise<{ version: number; mc: { name: string; style: string; look: Record<string, string> } }> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('ten-blades');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('saves', 'readonly').objectStore('saves').get(`slot${slot}`);
      get.onsuccess = () => {
        open.result.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
  });
}

test('the creator: change the look, begin, and the save and the map token follow it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./?test=1&seed=7#/');
  await newGame(page, {
    slot: 2,
    name: 'Corvin',
    style: 'Duelist',
    look: [
      ['Look', 'Broad'],
      ['Look', 'Deep'],
      ['Hair', 'Ponytail'],
      ['Hair', 'Copper'],
      ['Face', 'Round'],
      ['Face', 'Tattoo'],
      ['Style', 'Teal'],
    ],
  });
  const look = { body: 'broad', skin: 'deep', hairStyle: 'ponytail', hairColor: 'copper', eyes: 'round', scar: 'tattoo', accent: 'teal' };
  await saved(page);
  const save = await page.evaluate(readSlot, 2);
  expect(save.version).toBe(4);
  expect(save.mc).toEqual({ name: 'Corvin', pronouns: 'they', style: 'duelist', look });

  // The map draws the composed token for the main character, and the other units keep theirs.
  await idle(page);
  const s = await state(page);
  expect(s.units.find((u) => u.id === 'mc')).toMatchObject({ classId: 'duelist', isLord: true });
  await expect.poll(() => page.evaluate(() => window.__tb!.tokenTexture('mc'))).toBe('token.mc');
  expect(await page.evaluate(() => window.__tb!.tokenTexture('stranger'))).toBe('token.wanderer');
  expect(errors).toEqual([]);
});

test('the creator: tabs, swatches and the preview work at phone size', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./?test=1#/');
  await page.getByRole('link', { name: 'New game' }).tap();
  await page.getByRole('button', { name: /^Slot 1:/ }).tap();
  await page.getByRole('button', { name: 'Next' }).tap();
  await page.getByRole('textbox', { name: 'Name' }).fill('Ash');
  await page.getByRole('button', { name: 'Next' }).tap();
  await expect(page.getByRole('heading', { name: 'Your look' })).toBeVisible();
  for (const tab of ['Look', 'Hair', 'Face', 'Style']) {
    await page.getByRole('tab', { name: tab }).tap();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    for (const r of await page.getByRole('radio').all()) {
      const box = (await r.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  // Tapping the portrait cycles the expression; Randomize changes the look.
  const portrait = page.getByRole('button', { name: /^Portrait, calm/ });
  await portrait.tap();
  await expect(page.getByRole('button', { name: /^Portrait, angry/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Look' }).tap();
  const picked = () =>
    page.getByRole('radio', { checked: true }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent).join('|'));
  const before = await picked();
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    await page.getByRole('button', { name: 'Randomize' }).tap();
    changed = (await picked()) !== before;
  }
  expect(changed).toBe(true);
  // The preview has drawn something.
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('.creator-portrait canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
  expect(drawn).toBeGreaterThan(20_000);
  expect(errors).toEqual([]);
});

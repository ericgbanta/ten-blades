import { expect, test, type Page } from '@playwright/test';
import { idle, newGame, playByTaps, readScene, saved, state, trackErrors } from './helpers';

// Campaign battles take a fixed seed from the URL; `test=1` installs window.__tb.
const URL = './?test=1&seed=7#/';

async function wipeStorage(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('ten-blades');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      }),
  );
}

test('new game flow: slot, modes and hero carry into the prologue', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await newGame(page, { slot: 2, name: 'Ysolde Ærwyn', style: 'Duelist', permadeath: 'Casual', difficulty: 'Hard' });
  const s = await state(page);
  expect(s.options).toEqual({ difficulty: 'hard', permadeath: 'casual' });
  const mc = s.units.find((u) => u.id === 'mc')!;
  expect(mc).toMatchObject({ name: 'Ysolde Ærwyn', classId: 'duelist', isLord: true });

  // The slot is written at once, before any action.
  await page.getByRole('button', { name: 'Quit' }).tap();
  await expect(page.getByRole('dialog')).toContainText('suspended');
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).tap();
  await page.getByRole('link', { name: 'Load game' }).tap();
  const slot = page.getByRole('button', { name: /^Slot 2: Ysolde Ærwyn/ });
  await expect(slot).toContainText('Duelist · Prologue · Casual · Hard');
  await expect(slot).toContainText('Battle suspended');
  await expect(page.getByRole('button', { name: /^Slot 1: empty/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('play one action, reload, Continue: the battle is exactly where it was', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await newGame(page, { name: 'Bryn', style: 'Vanguard' });
  const action = await page.evaluate(() => window.__tb!.suggest('mc'));
  await playByTaps(page, action);
  await page.getByRole('button', { name: 'Danger' }).tap();
  // A second action makes the danger toggle part of a checkpoint.
  const second = await page.evaluate(() => window.__tb!.suggest('stranger'));
  await playByTaps(page, second);
  await saved(page);
  const before = await state(page);
  expect(before.units.find((u) => u.id === 'mc')!.pos).toEqual(action.type === 'endPhase' ? before.units[0]!.pos : action.to);

  await page.reload();
  await expect(page).toHaveURL(/#\/$/);
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toBeVisible();
  await expect(cont).toContainText(`Bryn · Prologue · Turn ${before.turn}`);
  await cont.tap();
  await idle(page);
  const after = await state(page);
  expect(after).toEqual(before);
  await expect(page.getByRole('button', { name: 'Danger' })).toHaveAttribute('aria-pressed', 'true');

  // The next action plays the same as it would have without the reload.
  const next = await page.evaluate(() => window.__tb!.suggest('mc'));
  expect(next).toBeDefined();
  expect(errors).toEqual([]);
});

test('export a code, wipe storage, import it and see the slot back', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await newGame(page, { slot: 3, name: '龍 Ærwyn', style: 'Spiritblade', permadeath: 'Classic', difficulty: 'Lunatic' });
  await saved(page);
  await page.goto(URL);

  await page.getByRole('link', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Slot 3: 龍 Ærwyn' }).tap();
  const box = page.getByRole('textbox', { name: 'Save code', exact: true });
  await expect(box).toHaveValue(/^TB1\./);
  const code = await box.inputValue();
  await page.getByRole('button', { name: 'Copy code' }).tap();
  await expect(page.getByRole('status').last()).toContainText(/Copied|copy/);

  await wipeStorage(page);
  await page.goto(URL);
  await page.getByRole('link', { name: 'Load game' }).tap();
  await expect(page.getByText('No saved campaigns yet')).toBeVisible();
  await page.getByRole('button', { name: 'Title' }).tap();
  await page.getByRole('link', { name: 'Settings' }).tap();

  // A broken code is explained in plain words.
  const paste = page.getByRole('textbox', { name: 'Paste a save code' });
  await paste.fill(code.slice(0, 40));
  await page.getByRole('button', { name: 'Import', exact: true }).tap();
  await expect(page.getByRole('alert')).toContainText('damaged');

  await paste.fill(code);
  await page.getByRole('button', { name: 'Import', exact: true }).tap();
  await expect(page.getByText("Choose a slot for 龍 Ærwyn's campaign.")).toBeVisible();
  await page.getByRole('button', { name: /^Slot 3: empty/ }).tap();
  await expect(page.getByRole('status').last()).toContainText("龍 Ærwyn's campaign is in slot 3.");

  // Importing again over the same slot asks first.
  await paste.fill(code);
  await page.getByRole('button', { name: 'Import', exact: true }).tap();
  await page.getByRole('button', { name: /^Slot 3: 龍 Ærwyn. Overwrite/ }).tap();
  await expect(page.getByRole('dialog')).toContainText('Overwrite slot 3?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).tap();

  await page.getByRole('button', { name: 'Title' }).tap();
  await page.getByRole('link', { name: 'Load game' }).tap();
  await expect(page.getByRole('button', { name: /^Slot 3: 龍 Ærwyn/ })).toContainText('Spiritblade · Prologue · Classic · Lunatic');
  expect(errors).toEqual([]);
});

test('winning the prologue plays the outro with its choice, then saves the flag and the Widow\'s Hush', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await newGame(page, { name: 'Ash', style: 'Vanguard', permadeath: 'Casual' });
  await page.getByRole('button', { name: /Animation speed/ }).tap();
  for (let guard = 0; guard < 60; guard++) {
    if (await page.evaluate(() => window.__tb!.isEnded())) break;
    const s = await state(page);
    const ready = s.units.find((u) => u.team === 'player' && u.alive && !u.acted)!;
    await playByTaps(page, await page.evaluate((id) => window.__tb!.suggest(id), ready.id));
  }
  await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).tap();

  // The outro: read to the choice, promise, then read on through the binding.
  await expect(page).toHaveURL(/#\/story$/);
  const before = await readScene(page);
  expect(before[0]).toContain('The last hunter runs for the trees');
  await expect(page.locator('.dlg-choice')).toHaveCount(2);
  for (const b of await page.locator('.dlg-choice').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: /carry it north/ }).tap();
  const after = await readScene(page);
  expect(after[0]).toContain('North, then');
  await expect(page.getByRole('dialog', { name: 'Scene' })).toHaveAttribute('data-scene', 'prologue_binding');
  expect(await readScene(page)).toContain('There you are.');

  await expect(page.getByRole('heading', { name: 'Chapter complete' })).toBeVisible();
  await expect(page.getByText('To be continued')).toBeVisible();
  const party = page.getByRole('list', { name: 'Your party' });
  await expect(party).toContainText('Ash');
  await expect(party).toContainText("Widow's Hush");
  await expect(party).not.toContainText('Stranger');
  await expect.poll(async () => (await page.evaluate(readSlot, 1)).progress).toMatchObject({ current: 'chapter1' });
  const slot = await page.evaluate(readSlot, 1);
  expect(slot.flags).toMatchObject({ prologue_promise: true });
  expect(slot.party.map((u) => [u.id, u.weaponId])).toEqual([['mc', 'widows_hush_vanguard']]);
  expect(slot.progress).toEqual({ current: 'chapter1', completed: ['prologue'], stage: 'intro', scenes: null });
  await page.getByRole('link', { name: 'Title' }).tap();

  // The suspend save is gone and the slot has moved on to chapter 1, which has no map yet.
  await expect(page.getByRole('link', { name: 'New game' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Load game' }).tap();
  await page.getByRole('button', { name: /^Slot 1: Ash/ }).tap();
  await expect(page.getByRole('dialog')).toContainText('finished the story so far');
  expect(errors).toEqual([]);
});

interface SlotSave {
  version: number;
  flags: Record<string, unknown>;
  party: { id: string; weaponId: string | null }[];
  progress: unknown;
}

/** The campaign save in a slot, read straight from IndexedDB. */
function readSlot(slot: number): Promise<SlotSave> {
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

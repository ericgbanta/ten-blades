import { expect, test, type Page } from '@playwright/test';
import { beginNewGame, idle, readScene, saved, skipScene, state, tapTile, trackErrors } from './helpers';

// Campaign battles take a fixed seed from the URL; `test=1` installs window.__tb.
const URL = './?test=1&seed=7#/';

const sceneOnMap = (page: Page) => page.evaluate(() => window.__tb?.scene() ?? null);

test('the intro plays by taps into the battle, and the opening scene plays over the map and hands back control', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await beginNewGame(page, { name: 'Ash', pronouns: 'She' });
  const scene = page.getByRole('dialog', { name: 'Scene' });
  // Tap anywhere completes the line, tap again goes on; the Next button does the same.
  await expect(page.locator('.dlg-text .visually-hidden')).toContainText('Wrenfold sits at the far edge of the Ardent Empire');
  await page.touchscreen.tap(187, 300);
  await expect(page.getByRole('button', { name: 'Next line' })).toHaveClass(/ready/);
  const lines = await readScene(page);
  expect(lines.length).toBeGreaterThanOrEqual(12);
  expect(lines).toContain('Ash! There\'s a woman on the north road. She\'s bleeding through her cloak.');
  await expect(page).toHaveURL(/#\/battle$/);

  // The opening scene comes up over the map before the first turn.
  await idle(page, 'stop');
  expect(await sceneOnMap(page)).toBe('prologue_b_start');
  await expect(scene).toHaveClass(/over-map/);
  await expect(scene.locator('.dlg-name')).toHaveText('The Stranger');
  await page.getByRole('button', { name: 'Log' }).tap();
  await expect(page.getByRole('dialog', { name: 'Scene log' })).toContainText('Choose your ground first');
  await page.getByRole('button', { name: 'Close' }).tap();
  await readScene(page);
  await idle(page);
  expect(await sceneOnMap(page)).toBeNull();
  await tapTile(page, 4, 10);
  await expect(page.getByText(/Vanguard · Lv 1/)).toBeVisible();
  expect((await state(page)).firedEvents).toEqual(['start_lesson']);
  expect(errors).toEqual([]);
});

test('Skip asks first and skips the intro; a reload mid-intro resumes that scene from its start', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await beginNewGame(page, { name: 'Bryn' });
  await page.getByRole('button', { name: 'Next line' }).tap();
  await page.getByRole('button', { name: 'Next line' }).tap();
  await expect(page.locator('.dlg-text .visually-hidden')).toContainText('Nobody comes here on purpose');

  // Quit mid-scene: Continue on the title picks the story up at the scene's start.
  await page.reload();
  await expect(page).toHaveURL(/#\/$/);
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toContainText('Bryn · Prologue · Story');
  await cont.tap();
  await expect(page).toHaveURL(/#\/story$/);
  await expect(page.locator('.dlg-text .visually-hidden')).toContainText('Wrenfold sits at the far edge');

  await page.getByRole('button', { name: 'Skip' }).tap();
  const ask = page.getByRole('alertdialog', { name: 'Skip this scene?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep reading' }).tap();
  await expect(ask).toHaveCount(0);
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);
  expect((await state(page)).turn).toBe(1);
  expect(errors).toEqual([]);
});

test('a reload during a mid-battle scene: Continue plays the scene again, once, and the battle is where it was', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.goto(URL);
  await beginNewGame(page, { name: 'Cael' });
  await skipScene(page);
  await idle(page, 'stop');
  expect(await sceneOnMap(page)).toBe('prologue_b_start');
  await saved(page);
  const before = await state(page);

  await page.reload();
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toContainText('Cael · Prologue · Turn 1');
  await cont.tap();
  await idle(page, 'stop');
  expect(await sceneOnMap(page)).toBe('prologue_b_start');
  await readScene(page);
  await idle(page);
  expect(await sceneOnMap(page)).toBeNull();
  expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('the skirmish deserter joins when the main character talks to it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await page.goto('./?test=1&quick=1&seed=7&map=skirmish_test&scenes=1#/battle');
  await idle(page);
  let s = await state(page);
  expect(s.units.find((u) => u.id === 'deserter')).toMatchObject({ team: 'enemy', pos: { x: 8, y: 13 } });
  await tapTile(page, 5, 16);
  await tapTile(page, 7, 13);
  const menu = page.getByRole('region', { name: 'Orders for Wanderer' });
  await expect(menu.getByRole('button', { name: 'Talk' })).toBeVisible();
  await menu.getByRole('button', { name: 'Talk' }).tap();
  await expect(page.getByText('Tap someone to talk to.')).toBeVisible();
  await tapTile(page, 8, 13);
  await idle(page, 'stop');
  expect(await sceneOnMap(page)).toBe('skirmish_recruit');
  const lines = await readScene(page);
  expect(lines[0]).toContain("I've no quarrel with you");
  await idle(page);
  s = await state(page);
  expect(s.units.find((u) => u.id === 'deserter')).toMatchObject({ team: 'player', ai: null });
  expect(s.recruited).toEqual(['deserter']);
  expect(s.flags).toEqual({ skirmish_deserter_joined: true });
  expect(s.units.find((u) => u.id === 'mc')).toMatchObject({ pos: { x: 7, y: 13 }, acted: true });
  expect(errors).toEqual([]);
});

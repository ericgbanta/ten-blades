import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../src/core';
import { idle, playByTaps, state, tapTile, trackErrors } from './helpers';

// A quick battle (`quick=1`, nothing saved) with a fixed seed and setup so runs
// repeat exactly. `test=1` installs window.__tb.
const URL = './?test=1&quick=1&seed=7&style=vanguard&difficulty=normal#/battle';

async function start(page: Page): Promise<void> {
  await page.goto(URL);
  await idle(page);
}

test('select, move, forecast, attack, end turn and enemy phase', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await start(page);
  await expect(page.getByTestId('objective')).toContainText('Rout the enemy');
  // The 10 column prologue opens fitted to the 375 px width, so tiles are about 37 px (never under 36).
  expect(await page.evaluate(() => window.__tb!.tileSize())).toBeGreaterThanOrEqual(36);

  // Turn 1: the MC moves two tiles up and waits.
  await tapTile(page, 4, 10);
  await expect(page.getByText('Vanguard · Lv 1')).toBeVisible();
  await tapTile(page, 4, 8);
  const menu = page.getByRole('region', { name: 'Orders for Wanderer' });
  await expect(menu.getByRole('button')).toHaveText(['Wait', 'Cancel']);
  const waitBox = await menu.getByRole('button', { name: 'Wait' }).boundingBox();
  expect(waitBox!.height).toBeGreaterThanOrEqual(44);
  await menu.getByRole('button', { name: 'Wait' }).tap();
  await idle(page);
  let s = await state(page);
  expect(s.units.find((u) => u.id === 'mc')).toMatchObject({ pos: { x: 4, y: 8 }, acted: true });

  // End turn asks first because the Stranger can still act.
  await page.getByRole('button', { name: 'End turn' }).tap();
  await expect(page.getByRole('dialog')).toContainText('1 unit can still act');
  await page.getByRole('dialog').getByRole('button', { name: 'End turn' }).tap();
  await idle(page);
  s = await state(page);
  expect(s.turn).toBe(2);
  expect(s.phase).toBe('player');

  // Turn 2: find a unit that can strike and attack through the forecast.
  let attack: Action | null = null;
  for (const id of ['mc', 'stranger']) {
    const a = await page.evaluate((uid) => window.__tb!.suggest(uid), id);
    if (a.type === 'attack') {
      attack = a;
      break;
    }
  }
  expect(attack).not.toBeNull();
  const a = attack as Extract<Action, { type: 'attack' }>;
  const before = s.units.find((u) => u.id === a.targetId)!;
  const attacker = s.units.find((u) => u.id === a.unitId)!;
  await tapTile(page, attacker.pos.x, attacker.pos.y);
  await tapTile(page, a.to.x, a.to.y);
  await page.getByRole('button', { name: 'Attack' }).tap();
  await tapTile(page, before.pos.x, before.pos.y);
  const fc = page.getByRole('region', { name: 'Combat forecast' });
  await expect(fc).toBeVisible();
  await expect(fc).toContainText(attacker.name);
  await expect(fc).toContainText(before.name);
  await expect(fc).toContainText('Hit');
  await fc.getByRole('button', { name: 'Confirm' }).tap();
  await idle(page);
  s = await state(page);
  const after = s.units.find((u) => u.id === a.targetId)!;
  const moved = s.units.find((u) => u.id === a.unitId)!;
  expect(moved.pos).toEqual(a.to);
  expect(moved.acted || !moved.alive).toBe(true);
  expect(after.hp < before.hp || !after.alive || after.hp === before.hp).toBe(true);

  // End the turn and let the enemy phase play out.
  await page.getByRole('button', { name: 'End turn' }).tap();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'End turn' }).tap();
  await idle(page);
  s = await state(page);
  expect(s.turn === 3 || s.result !== 'ongoing').toBe(true);
  expect(errors).toEqual([]);
});

test('plays the prologue to the victory screen by taps', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await start(page);
  await page.getByRole('button', { name: /Animation speed/ }).tap();
  for (let guard = 0; guard < 60; guard++) {
    if (await page.evaluate(() => window.__tb!.isEnded())) break;
    const s = await state(page);
    const ready = s.units.find((u) => u.team === 'player' && u.alive && !u.acted);
    expect(ready).toBeDefined();
    const action = await page.evaluate((id) => window.__tb!.suggest(id), ready!.id);
    await playByTaps(page, action);
  }
  await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible();
  const end = page.getByRole('dialog');
  await expect(end).toContainText('Turns');
  await expect(end.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(end.getByRole('button', { name: 'Title' })).toBeVisible();

  // Play again starts a fresh battle on the same seed.
  await end.getByRole('button', { name: 'Play again' }).tap();
  // The old battle's hook can answer until the new battle has mounted, so wait for the fresh state.
  await expect.poll(() => page.evaluate(() => window.__tb?.getState().turn ?? null)).toBe(1);
  await idle(page);
  const fresh = await state(page);
  expect(fresh.turn).toBe(1);
  expect(fresh.units.filter((u) => u.team === 'enemy' && u.alive)).toHaveLength(6);
  expect(errors).toEqual([]);
});

test('the skirmish test map opens through the quick battle URL, framed on the player', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./?test=1&quick=1&seed=7&map=skirmish_test#/battle');
  await idle(page);
  const s = await state(page);
  expect(s.mapId).toBe('skirmish_test');
  expect([s.map.width, s.map.height]).toEqual([14, 18]);
  // 14 columns cannot fit a 375 px phone at 36 px, so it opens at 44 px tiles with the lord on screen.
  expect(await page.evaluate(() => window.__tb!.tileSize())).toBeCloseTo(44, 0);
  const lord = await page.evaluate(() => window.__tb!.tileToScreen(5, 16));
  expect(lord!.x).toBeGreaterThan(0);
  expect(lord!.x).toBeLessThan(375);
  expect(lord!.y).toBeGreaterThan(60);
  expect(lord!.y).toBeLessThan(667 - 60);
  expect(errors).toEqual([]);
});

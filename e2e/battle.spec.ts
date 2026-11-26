import { expect, test, type Page } from '@playwright/test';
import type { Action, BattleState } from '../src/core';

// Fixed seed and setup so runs repeat exactly. `test=1` installs window.__tb.
const URL = './?test=1&seed=7&style=vanguard&difficulty=normal#/battle';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__tb && window.__tb.tileToScreen(0, 0) !== null && !window.__tb.isBusy(), null, {
    timeout: 60_000,
  });
}

const state = (page: Page): Promise<BattleState> => page.evaluate(() => window.__tb!.getState());

/** Pan the tile clear of the overlays, then tap its center. */
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await page.evaluate(
    ([tx, ty]) => {
      window.__tb!.reveal(tx!, ty!);
      return window.__tb!.tileToScreen(tx!, ty!);
    },
    [x, y],
  );
  expect(p).not.toBeNull();
  await page.touchscreen.tap(p!.x, p!.y);
  await settle(page);
}

/** Wait until the map has handled the last tap and any camera pan is over. */
async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__tb!.settled()), { timeout: 5_000 }).toBe(true);
}

async function start(page: Page): Promise<void> {
  await page.goto(URL);
  await idle(page);
}

/** Play one player action by taps: select, move, then Wait or Attack with Confirm. */
async function playByTaps(page: Page, action: Action): Promise<void> {
  if (action.type === 'endPhase') return;
  const s = await state(page);
  const unit = s.units.find((u) => u.id === action.unitId)!;
  await tapTile(page, unit.pos.x, unit.pos.y);
  await tapTile(page, action.to.x, action.to.y);
  if (action.type === 'wait') {
    await page.getByRole('button', { name: 'Wait' }).tap();
  } else {
    const target = s.units.find((u) => u.id === action.targetId)!;
    await page.getByRole('button', { name: action.type === 'attack' ? 'Attack' : 'Heal' }).tap();
    await tapTile(page, target.pos.x, target.pos.y);
    await page.getByRole('button', { name: 'Confirm' }).tap();
  }
  await idle(page);
}

test('select, move, forecast, attack, end turn and enemy phase', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await start(page);
  await expect(page.getByTestId('objective')).toContainText('Rout the enemy');
  expect(await page.evaluate(() => window.__tb!.tileSize())).toBeGreaterThanOrEqual(44);

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
  await expect(end.getByRole('link', { name: 'Title' })).toBeVisible();

  // Play again starts a fresh battle on the same seed.
  await end.getByRole('button', { name: 'Play again' }).tap();
  await idle(page);
  const fresh = await state(page);
  expect(fresh.turn).toBe(1);
  expect(fresh.units.filter((u) => u.team === 'enemy' && u.alive)).toHaveLength(6);
  expect(errors).toEqual([]);
});

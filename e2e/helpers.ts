import { expect, type Page } from '@playwright/test';
import type { Action, BattleState } from '../src/core';

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Wait for the map to be up and no playback to be running. */
export async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__tb && window.__tb.tileToScreen(0, 0) !== null && !window.__tb.isBusy(), null, {
    timeout: 60_000,
  });
}

export const state = (page: Page): Promise<BattleState> => page.evaluate(() => window.__tb!.getState());

/** Wait until every queued save write has finished. */
export const saved = (page: Page): Promise<boolean> => page.evaluate(() => window.__tb!.saved());

/** Wait until the map has handled the last tap and any camera pan is over. */
export async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__tb!.settled()), { timeout: 5_000 }).toBe(true);
}

/** Pan the tile clear of the overlays, then tap its center. */
export async function tapTile(page: Page, x: number, y: number): Promise<void> {
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

/** Play one player action by taps: select, move, then Wait or Attack with Confirm. */
export async function playByTaps(page: Page, action: Action): Promise<void> {
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

export interface NewGameChoices {
  slot?: 1 | 2 | 3;
  name: string;
  style?: 'Vanguard' | 'Duelist' | 'Spiritblade';
  permadeath?: 'Classic' | 'Casual';
  difficulty?: 'Normal' | 'Hard' | 'Lunatic';
}

/** From the title screen, through the new game flow, into the prologue. */
export async function newGame(page: Page, c: NewGameChoices): Promise<void> {
  await page.getByRole('link', { name: 'New game' }).tap();
  await expect(page.getByRole('heading', { name: 'Choose a slot' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^Slot ${c.slot ?? 1}:`) }).tap();
  await expect(page.getByRole('heading', { name: 'Your path' })).toBeVisible();
  if (c.permadeath) await page.getByRole('radio', { name: new RegExp(`^${c.permadeath}`) }).tap();
  if (c.difficulty) await page.getByRole('radio', { name: new RegExp(`^${c.difficulty}`) }).tap();
  await page.getByRole('button', { name: 'Next' }).tap();
  await expect(page.getByRole('heading', { name: 'Your hero' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill(c.name);
  if (c.style) await page.getByRole('radio', { name: new RegExp(`^${c.style}`) }).tap();
  await page.getByRole('button', { name: 'Begin' }).tap();
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);
}

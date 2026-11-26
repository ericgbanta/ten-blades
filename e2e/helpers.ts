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

/** Skip the dialogue scene on screen through its Skip button and the confirm. */
export async function skipScene(page: Page): Promise<void> {
  const scene = page.getByRole('dialog', { name: 'Scene' });
  await scene.getByRole('button', { name: 'Skip' }).tap();
  await page.getByRole('alertdialog', { name: 'Skip this scene?' }).getByRole('button', { name: 'Skip' }).tap();
}

/** Tap through the scene on screen line by line until it ends (or another begins) or reaches a choice. Returns the lines seen. */
export async function readScene(page: Page): Promise<string[]> {
  const seen: string[] = [];
  const scene = page.getByRole('dialog', { name: 'Scene' });
  const id = await scene.getAttribute('data-scene');
  for (let i = 0; i < 80; i++) {
    if ((await scene.count()) === 0 || (await page.locator('.dlg-choice').count()) > 0) break;
    if ((await scene.getAttribute('data-scene', { timeout: 2_000 }).catch(() => null)) !== id) break;
    const text = (await page.locator('.dlg-text .visually-hidden').textContent({ timeout: 2_000 }).catch(() => null)) ?? '';
    if (text && seen.at(-1) !== text) seen.push(text);
    await page.getByRole('button', { name: 'Next line' }).tap({ timeout: 2_000 }).catch(() => undefined);
  }
  return seen;
}

/**
 * Wait for the map to be up and no playback to be running. A mid-battle scene that comes up meanwhile is skipped,
 * unless `scenes` is 'stop', which returns as soon as one is on screen.
 */
export async function idle(page: Page, scenes: 'skip' | 'stop' = 'skip'): Promise<void> {
  for (;;) {
    await page.waitForFunction(
      () => !!window.__tb && window.__tb.tileToScreen(0, 0) !== null && (!window.__tb.isBusy() || window.__tb.scene() !== null),
      null,
      { timeout: 60_000 },
    );
    const scene = await page.evaluate(() => window.__tb!.scene());
    if (scene === null) return;
    if (scenes === 'stop') return;
    await expect(page.getByRole('dialog', { name: 'Scene' })).toBeVisible();
    await skipScene(page);
    await expect.poll(() => page.evaluate(() => window.__tb!.scene())).not.toBe(scene);
  }
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
  if (action.type === 'endPhase' || action.type === 'equip' || action.type === 'item') return;
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
  /** Creator picks: [tab, radio name] pairs, tapped in order (for example ['Hair', 'Ponytail']). */
  look?: [string, string][];
  pronouns?: 'He' | 'She' | 'They';
}

/** From the title screen, through the new game flow, to Begin: the prologue's intro scene starts. */
export async function beginNewGame(page: Page, c: NewGameChoices): Promise<void> {
  await page.getByRole('link', { name: 'New game' }).tap();
  await expect(page.getByRole('heading', { name: 'Choose a slot' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^Slot ${c.slot ?? 1}:`) }).tap();
  await expect(page.getByRole('heading', { name: 'Your path' })).toBeVisible();
  if (c.permadeath) await page.getByRole('radio', { name: new RegExp(`^${c.permadeath}`) }).tap();
  if (c.difficulty) await page.getByRole('radio', { name: new RegExp(`^${c.difficulty}`) }).tap();
  await page.getByRole('button', { name: 'Next' }).tap();
  await expect(page.getByRole('heading', { name: 'Your hero' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill(c.name);
  if (c.pronouns) await page.getByRole('radio', { name: new RegExp(`^${c.pronouns}`) }).tap();
  await page.getByRole('button', { name: 'Next' }).tap();
  await expect(page.getByRole('heading', { name: 'Your look' })).toBeVisible();
  for (const [tab, option] of c.look ?? []) {
    await page.getByRole('tab', { name: tab }).tap();
    await page.getByRole('radio', { name: option, exact: true }).tap();
  }
  if (c.style) {
    await page.getByRole('tab', { name: 'Style' }).tap();
    await page.getByRole('radio', { name: new RegExp(`^${c.style}`) }).tap();
  }
  await page.getByRole('button', { name: 'Begin' }).tap();
  await expect(page).toHaveURL(/#\/story$/);
  await expect(page.getByRole('dialog', { name: 'Scene' })).toBeVisible();
}

/** From the title screen, through the new game flow and past the intro scene (skipped), into the prologue. */
export async function newGame(page: Page, c: NewGameChoices): Promise<void> {
  await beginNewGame(page, c);
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);
}

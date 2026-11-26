import { expect, test, type Page } from '@playwright/test';
import type { Action, BattleState } from '../src/core';
import { idle, playByTaps, state, tapTile, trackErrors } from './helpers';

// Battle scenes and powers. Quick battles with fixed seeds; `test=1` installs window.__tb.
const PROLOGUE = './?test=1&quick=1&seed=7&style=vanguard&difficulty=normal#/battle';
const SKIRMISH = './?test=1&quick=1&seed=7&style=vanguard&map=skirmish_test#/battle';

async function open(page: Page, url: string, mode: 'full' | 'fast' | 'off'): Promise<void> {
  await page.goto(url);
  await idle(page);
  await page.evaluate((m) => window.__tb!.setSceneMode(m), mode);
}

/** End turn 1 (everyone waits where they stand) and find turn 2's first attack, as in battle.spec.ts. */
async function turnTwoAttack(page: Page): Promise<Extract<Action, { type: 'attack' }>> {
  await page.getByRole('button', { name: 'End turn' }).tap();
  await page.getByRole('dialog').getByRole('button', { name: 'End turn' }).tap();
  await idle(page);
  for (const id of ['mc', 'stranger']) {
    const a = await page.evaluate((uid) => window.__tb!.suggest(uid), id);
    if (a.type === 'attack') return a;
  }
  throw new Error('no attack on turn 2');
}

/** The state without what only the camera or timing could touch (nothing: the whole state must match). */
const snapshot = (s: BattleState): string => JSON.stringify(s);

test('a fight plays a battle scene, and the game afterwards equals the map-only game', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await open(page, PROLOGUE, 'full');
  const attack = await turnTwoAttack(page);
  const s = await state(page);
  const unit = s.units.find((u) => u.id === attack.unitId)!;
  const target = s.units.find((u) => u.id === attack.targetId)!;
  await tapTile(page, unit.pos.x, unit.pos.y);
  await tapTile(page, attack.to.x, attack.to.y);
  await page.getByRole('button', { name: 'Attack' }).tap();
  await tapTile(page, target.pos.x, target.pos.y);
  await page.getByRole('button', { name: 'Confirm' }).tap();
  // The scene and its HUD come up with both fighters.
  await expect(page.getByTestId('fight')).toBeVisible();
  await expect(page.getByTestId(`fight-side-${attack.unitId}`)).toBeVisible();
  await expect(page.getByTestId(`fight-side-${attack.targetId}`)).toBeVisible();
  const fight = await page.evaluate(() => window.__tb!.fight());
  expect(fight).toMatchObject({ kind: 'combat' });
  expect(fight!.fighters).toEqual([attack.unitId, attack.targetId]);
  await idle(page);
  await expect(page.getByTestId('fight')).toHaveCount(0);
  const withScene = snapshot(await state(page));

  // The same seed and moves with scenes Off.
  const other = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await open(other, PROLOGUE, 'off');
  const attack2 = await turnTwoAttack(other);
  expect(attack2).toEqual(attack);
  await playByTaps(other, attack2);
  expect(snapshot(await state(other))).toBe(withScene);
  await other.close();
  expect(errors).toEqual([]);
});

test('a tap skips the scene to its end, and the game is the same', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, PROLOGUE, 'full');
  const attack = await turnTwoAttack(page);
  // Slow the scene right down, so only a skip can end it quickly.
  await page.evaluate(() => window.__tb!.slowScenes(20));
  const s = await state(page);
  const unit = s.units.find((u) => u.id === attack.unitId)!;
  const target = s.units.find((u) => u.id === attack.targetId)!;
  await tapTile(page, unit.pos.x, unit.pos.y);
  await tapTile(page, attack.to.x, attack.to.y);
  await page.getByRole('button', { name: 'Attack' }).tap();
  await tapTile(page, target.pos.x, target.pos.y);
  await page.getByRole('button', { name: 'Confirm' }).tap();
  await expect(page.getByTestId('fight')).toBeVisible();
  const t0 = Date.now();
  await page.getByTestId('fight').tap();
  await expect(page.getByTestId('fight')).toHaveCount(0, { timeout: 3_000 });
  expect(Date.now() - t0).toBeLessThan(3_000);
  await idle(page);
  const after = await state(page);
  expect(after.units.find((u) => u.id === attack.unitId)!.acted || !after.units.find((u) => u.id === attack.unitId)!.alive).toBe(true);
});

test('scenes Off from the top bar: fights stay on the map, and the choice is remembered', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(PROLOGUE);
  await idle(page);
  const toggle = page.getByTestId('scenes-toggle');
  await expect(toggle).toHaveAccessibleName('Battle scenes: Full');
  await toggle.tap();
  await expect(toggle).toHaveAccessibleName('Battle scenes: Fast');
  await toggle.tap();
  await expect(toggle).toHaveAccessibleName('Battle scenes: Off');
  let seen = false;
  const attack = await turnTwoAttack(page);
  const watcher = setInterval(() => {
    void page
      .evaluate(() => window.__tb?.fight() ?? null)
      .then((f) => {
        if (f) seen = true;
      })
      .catch(() => undefined);
  }, 50);
  await playByTaps(page, attack);
  clearInterval(watcher);
  expect(seen).toBe(false);
  await page.reload();
  // The battle route needs a run; a quick battle starts again from the URL, with the setting kept.
  await page.goto(PROLOGUE);
  await idle(page);
  await expect(page.getByTestId('scenes-toggle')).toHaveAccessibleName('Battle scenes: Off');
});

/** Place enemies next to the bearers on the skirmish map, so each power has targets on turn 1. */
async function stageSkirmish(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.__tb!.patch((s) => {
      const at: [string, number, number][] = [
        ['hunter_1', 3, 16],
        ['hunter_2', 8, 16],
        ['legionary_1', 9, 16],
        ['archer_2', 5, 14],
      ];
      for (const [id, x, y] of at) {
        const u = s.units.find((v) => v.id === id)!;
        u.pos = { x, y };
      }
      return s;
    }),
  );
}

async function selectPower(page: Page, unitId: string, to: { x: number; y: number }): Promise<void> {
  const s = await state(page);
  const u = s.units.find((x) => x.id === unitId)!;
  await tapTile(page, u.pos.x, u.pos.y);
  await tapTile(page, to.x, to.y);
  await page.getByRole('button', { name: /^Power:/ }).tap();
}

test('on the skirmish map each power can be picked, previewed and used: Devour, Scatter, then Echo of the last', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await open(page, SKIRMISH, 'fast');
  await stageSkirmish(page);

  // The gauge is shown, and Power is disabled with the reason until it is full.
  let s = await state(page);
  const g = s.units.find((u) => u.id === 'gravemaw')!;
  await tapTile(page, g.pos.x, g.pos.y);
  await expect(page.getByTestId('blade-row')).toContainText('Devour');
  await tapTile(page, g.pos.x, g.pos.y);
  await expect(page.getByRole('button', { name: /^Power: Devour, not ready/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).tap();

  // Devour on the hunter next to the bearer.
  await page.evaluate(() => {
    window.__tb!.setResolve('gravemaw');
    window.__tb!.setResolve('needles');
    window.__tb!.setResolve('mc');
  });
  await selectPower(page, 'gravemaw', { x: 4, y: 16 });
  await expect(page.getByText('Devour: tap a red target.')).toBeVisible();
  await tapTile(page, 3, 16);
  const fc = page.getByRole('region', { name: 'Devour forecast' });
  await expect(fc).toBeVisible();
  await expect(fc).toContainText('Heals the damage dealt');
  await fc.getByRole('button', { name: 'Confirm' }).tap();
  await expect(page.getByTestId('cut-in')).toContainText('Devour');
  await expect(page.getByTestId('fight')).toBeVisible();
  expect((await page.evaluate(() => window.__tb!.fight()))!.power).toBe('devour');
  await idle(page);
  s = await state(page);
  expect(s.units.find((u) => u.id === 'gravemaw')!.resolve).toBe(0);
  expect(s.powerLog.map((p) => [p.powerId, p.bearerId, p.witnesses])).toEqual([['devour', 'gravemaw', ['mc']]]);

  // Scatter to the right from the thief: a direction from the pad, the line's targets in the forecast.
  await selectPower(page, 'needles', { x: 7, y: 16 });
  const aim = page.getByRole('region', { name: 'Aim Scatter' });
  await expect(aim.getByRole('button', { name: 'Up' })).toBeDisabled();
  await aim.getByRole('button', { name: 'Right' }).tap();
  const sfc = page.getByRole('region', { name: 'Scatter forecast' });
  await expect(sfc.locator('.power-target')).toHaveCount(2);
  await expect(sfc).toContainText('No counters.');
  await sfc.getByRole('button', { name: 'Confirm' }).tap();
  await expect(page.getByTestId('cut-in')).toContainText('Scatter');
  await idle(page);
  s = await state(page);
  expect(s.units.find((u) => u.id === 'needles')!.resolve).toBe(0);

  // Echo: the main character stood within 3 tiles of both powers; the last one, Scatter, is what it re-casts,
  // from its own tile with its own stats: up the column at the archer.
  await selectPower(page, 'mc', { x: 5, y: 15 });
  const eaim = page.getByRole('region', { name: 'Aim Echo: Scatter' });
  await expect(eaim).toBeVisible();
  await eaim.getByRole('button', { name: 'Up' }).tap();
  const efc = page.getByRole('region', { name: 'Echo: Scatter forecast' });
  await expect(efc).toContainText('echoing Needles Thief');
  await expect(efc.locator('.power-target')).toHaveCount(1);
  await efc.getByRole('button', { name: 'Confirm' }).tap();
  await expect(page.getByTestId('cut-in')).toContainText('Echo: Scatter');
  await idle(page);
  s = await state(page);
  expect(s.units.find((u) => u.id === 'mc')!.resolve).toBe(0);
  expect(s.powerLog.at(-1)).toMatchObject({ powerId: 'scatter', bearerId: 'mc' });
  expect(errors).toEqual([]);
});

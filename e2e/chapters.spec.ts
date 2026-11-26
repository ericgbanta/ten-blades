import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import v5 from '../tests/fixtures/save-v5.json' with { type: 'json' };
import { idle, readScene, skipScene, state, tapTile, trackErrors } from './helpers';

// Chapters 1 to 3 at a phone viewport: from the prologue's camp into chapter 1, Garrow's recruit by talk in
// chapter 2, and Pell's mid-battle join, the story choice and the camp after chapter 3. Saves go straight into
// IndexedDB (slot 1) and Continue picks them up; `test=1` installs window.__tb and window.__camp.
const URL = './?test=1&seed=11#/';

/** Where screenshots go when SHOTS is set (SHOTS=<dir> npm run e2e); none otherwise. */
const SHOTS = process.env.SHOTS ?? '';

async function shot(page: Page, name: string, wait = 1500): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // By default long enough for a dialogue line to finish typing.
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test.use({ deviceScaleFactor: 2 });

type Save = typeof v5 & Record<string, unknown>;

const STATS = {
  soldier: { hp: 24, str: 7, mag: 0, skl: 5, spd: 4, lck: 3, def: 8, res: 0, mov: 5 },
  ranger: { hp: 20, str: 6, mag: 0, skl: 8, spd: 8, lck: 5, def: 3, res: 1, mov: 5 },
  adept: { hp: 18, str: 0, mag: 7, skl: 6, spd: 6, lck: 4, def: 2, res: 7, mov: 5 },
  medic: { hp: 18, str: 0, mag: 6, skl: 4, spd: 6, lck: 7, def: 1, res: 7, mov: 5 },
  gravemaw_bearer: { hp: 34, str: 12, mag: 0, skl: 7, spd: 5, lck: 4, def: 9, res: 1, mov: 5 },
};

function unit(id: string, name: string, classId: keyof typeof STATS, level: number, weaponId: string) {
  return { id, name, classId, level, xp: 10, stats: STATS[classId], weaponId, isLord: false, inventory: [weaponId] };
}

/** The v5 fixture (Ysolde, a Duelist) moved on to a chapter's battle with the company she would have by then. */
function battleSave(chapter: 'chapter2' | 'chapter3'): Save {
  const s = structuredClone(v5) as Save;
  const party = s.party as unknown[];
  party.push(
    unit('hask', 'Hask', 'soldier', 3, 'iron_lance'),
    unit('lise', 'Lise', 'ranger', 3, 'short_bow'),
    unit('tobin', 'Tobin', 'adept', 3, 'ember_tome'),
    unit('marra', 'Marra', 'medic', 3, 'mending_rod'),
  );
  const completed = ['prologue', 'chapter1'];
  if (chapter === 'chapter3') {
    party.push(unit('gravemaw', 'Garrow', 'gravemaw_bearer', 5, 'gravemaw'));
    completed.push('chapter2');
    (s.blades as Record<string, unknown>).gravemaw = { tier: 1 };
    s.flags = { ...s.flags, garrow_joined: true } as never;
  }
  s.progress = { current: chapter, completed, stage: 'battle', scenes: [] } as never;
  return s;
}

async function putSlot(page: Page, save: unknown): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ten-blades', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(value, 'slot1');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    save,
  );
}

/** Put a save in slot 1 and Continue it. */
async function continueSave(page: Page, save: unknown, expectText: string): Promise<void> {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  await putSlot(page, save);
  await page.reload();
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toContainText(expectText);
  await cont.tap();
}

/** Zoom the map right out (to the whole map) with the mouse wheel over its middle. */
async function zoomOut(page: Page): Promise<void> {
  await page.mouse.move(187, 330);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
}

/** Bring an enemy next to one of ours and play that attack with full battle scenes; capture the scene midway. */
async function fightShot(page: Page, attackerId: string, enemyId: string, name: string): Promise<void> {
  const s = await state(page);
  const a = s.units.find((u) => u.id === attackerId)!;
  await page.evaluate(
    ([eid, x, y]) => {
      window.__tb!.setSceneMode('full');
      window.__tb!.patch((st) => {
        st.units.find((u) => u.id === eid)!.pos = { x: x as number, y: y as number };
        return st;
      });
    },
    [enemyId, a.pos.x, a.pos.y - 1] as const,
  );
  expect(await page.evaluate(([uid, x, y, t]) => window.__tb!.act({ type: 'attack', unitId: uid as string, to: { x: x as number, y: y as number }, targetId: t as string }), [attackerId, a.pos.x, a.pos.y, enemyId] as const)).toBe(true);
  await expect(page.getByTestId('fight')).toBeVisible();
  await shot(page, name, 900);
  await idle(page);
}

test('from the prologue\'s camp into chapter 1: locked facilities, March, the intro, the escape map and the refugees', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await continueSave(page, structuredClone(v5), 'Camp');
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Forge, locked/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Merchant, locked/ })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Facilities' }).getByRole('button', { name: 'War map', exact: true }).tap();
  await page.getByRole('button', { name: 'March' }).tap();
  await expect(page.getByRole('heading', { name: 'Deploy' })).toBeVisible();
  await expect(page.getByText('1 of 1 deploying')).toBeVisible();
  await page.getByRole('button', { name: 'Begin' }).tap();

  // The intro, read a few lines in, then skipped.
  const scene = page.getByRole('dialog', { name: 'Scene' });
  await expect(scene).toHaveAttribute('data-scene', 'ch1_intro');
  // Tap on until Lise speaks (a tap first completes a line, the next one moves on).
  const line = page.locator('.dlg-text .visually-hidden');
  for (let i = 0; i < 20 && !((await line.textContent()) ?? '').startsWith('Hunters behind us'); i++) {
    await page.getByRole('button', { name: 'Next line' }).tap();
  }
  await expect(scene.locator('.dlg-name')).toHaveText('Lise');
  await shot(page, 'ch1-dialogue');
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);

  // The opening scene over the map, then the escape map.
  await idle(page, 'stop');
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch1_b_start');
  await shot(page, 'ch1-battle-dialogue');
  await idle(page);
  const s = await state(page);
  expect(s.mapId).toBe('chapter1');
  expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['mc', 'hask', 'lise']);
  await expect(page.getByTestId('objective')).toContainText('Reach the escape point');
  await shot(page, 'ch1-map-opening');
  await zoomOut(page);
  await shot(page, 'ch1-map-whole');

  // Walk the main character to the old fort: Tobin and Marra come over.
  await tapTile(page, 2, 16);
  await tapTile(page, 2, 12);
  await page.getByRole('button', { name: 'Wait' }).tap();
  await idle(page, 'stop');
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch1_b_refugees');
  await shot(page, 'ch1-refugees');
  await readScene(page);
  await idle(page);
  const after = await state(page);
  expect(after.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['mc', 'hask', 'lise', 'tobin', 'marra']);
  expect(after.recruited).toEqual(['tobin', 'marra']);

  // A fight on the forest backdrop.
  await fightShot(page, 'hask', 'hunter_1', 'ch1-battle-scene-forest');
  expect(errors).toEqual([]);
});

test('chapter 2: the main character talks Garrow round, and he joins with Gravemaw', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await continueSave(page, battleSave('chapter2'), 'Chapter 2');
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page, 'stop');
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch2_b_start');
  await shot(page, 'ch2-battle-dialogue');
  await idle(page);
  let s = await state(page);
  expect(s.mapId).toBe('chapter2');
  expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['mc', 'hask', 'lise', 'tobin', 'marra']);
  expect(s.units.find((u) => u.id === 'gravemaw')).toMatchObject({ team: 'enemy', name: 'Garrow' });
  await shot(page, 'ch2-map-opening');
  await zoomOut(page);
  await shot(page, 'ch2-map-whole');

  // Bring the main character up to the keep (test only), then walk beside Garrow and talk.
  await page.evaluate(() =>
    window.__tb!.patch((st) => {
      st.units.find((u) => u.id === 'mc')!.pos = { x: 6, y: 5 };
      return st;
    }),
  );
  await tapTile(page, 6, 5);
  await tapTile(page, 6, 3);
  const menu = page.getByRole('region', { name: /^Orders for/ });
  await menu.getByRole('button', { name: 'Talk' }).tap();
  await tapTile(page, 6, 2);
  await idle(page, 'stop');
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch2_b_garrow_talk');
  await shot(page, 'ch2-recruit-talk');
  const lines = await readScene(page);
  expect(lines[0]).toContain('Draw, or say your piece');
  await idle(page);
  s = await state(page);
  expect(s.units.find((u) => u.id === 'gravemaw')).toMatchObject({ team: 'player', ai: null });
  expect(s.recruited).toEqual(['gravemaw']);
  expect(s.flags.garrow_joined).toBe(true);

  // A fight on the ruin backdrop.
  await fightShot(page, 'hask', 'legionary_1', 'ch2-battle-scene-ruin');
  expect(errors).toEqual([]);
});

test('chapter 3: Pell drops in on turn 2; the win leads to the story choice and the camp after chapter 3', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await continueSave(page, battleSave('chapter3'), 'Chapter 3');
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page, 'stop');
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch3_b_start');
  await shot(page, 'ch3-battle-dialogue');
  await idle(page);
  await page.evaluate(() => window.__tb!.setSceneMode('off'));
  await shot(page, 'ch3-map-opening');
  await zoomOut(page);
  await shot(page, 'ch3-map-whole');
  expect((await state(page)).units.find((u) => u.id === 'needles')).toBeUndefined();

  // End turn 1: in turn 2's player phase the thief drops in from the rooftops.
  await page.getByRole('button', { name: 'End turn' }).tap();
  await page.getByRole('dialog').getByRole('button', { name: 'End turn' }).tap();
  for (let i = 0; i < 6; i++) {
    await idle(page, 'stop');
    const sc = await page.evaluate(() => window.__tb!.scene());
    if (sc === 'ch3_b_needles' || sc === null) break;
    await skipScene(page);
  }
  expect(await page.evaluate(() => window.__tb!.scene())).toBe('ch3_b_needles');
  await shot(page, 'ch3-thief-joins');
  await readScene(page);
  await idle(page);
  const s = await state(page);
  expect(s.turn).toBe(2);
  expect(s.units.find((u) => u.id === 'needles')).toMatchObject({ team: 'player', name: 'Pell', acted: false, alive: true });
  expect(s.flags.pell_joined).toBe(true);
  await shot(page, 'ch3-thief-on-map');

  // A fight on the town backdrop, then the Hunter-Captain falls.
  await fightShot(page, 'hask', 'hunter_1', 'ch3-battle-scene-town');
  await page.evaluate(() => window.__tb!.setSceneMode('off'));
  const s2 = await state(page);
  const pell = s2.units.find((u) => u.id === 'needles')!;
  await page.evaluate(
    ([x, y]) =>
      window.__tb!.patch((st) => {
        const c = st.units.find((u) => u.id === 'captain')!;
        c.pos = { x: x as number, y: (y as number) - 1 };
        c.hp = 1;
        c.stats.spd = 0;
        c.stats.lck = 0;
        return st;
      }),
    [pell.pos.x, pell.pos.y] as const,
  );
  expect(await page.evaluate(([x, y]) => window.__tb!.act({ type: 'attack', unitId: 'needles', to: { x: x as number, y: y as number }, targetId: 'captain' }), [pell.pos.x, pell.pos.y] as const)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).tap();

  // The outro's choice: tell them what the blade whispers.
  await expect(page).toHaveURL(/#\/story$/);
  await expect(page.getByRole('dialog', { name: 'Scene' })).toHaveAttribute('data-scene', 'ch3_outro');
  await readScene(page);
  await expect(page.locator('.dlg-choice')).toHaveCount(2);
  await shot(page, 'ch3-story-choice');
  await page.getByRole('button', { name: /Tell them everything/ }).tap();
  const told = await readScene(page);
  expect(told[0]).toContain('It talks to me');

  // Camp after chapter 3: chapter 4 is coming soon on the war map.
  await expect(page).toHaveURL(/#\/camp$/);
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
  const c = await page.evaluate(() => window.__camp!.campaign()!);
  expect(c.flags.told_whispers).toBe(true);
  expect(c.party.map((u) => u.id)).toContain('needles');
  expect(c.progress).toMatchObject({ current: 'chapter4', stage: 'camp' });
  await page.getByRole('navigation', { name: 'Facilities' }).getByRole('button', { name: 'War map', exact: true }).tap();
  await expect(page.getByText(/Coming soon/)).toBeVisible();
  await shot(page, 'ch3-war-map-after');
  expect(errors).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import v5 from '../tests/fixtures/save-v5.json' with { type: 'json' };
import { idle, settle, skipScene, state, tapTile, trackErrors } from './helpers';

// A camp save is written straight into IndexedDB (slot 1), then Continue on the title lands in camp.
const URL = './?test=1&seed=11#/';

/** Where screenshots go when SHOTS is set (npm run e2e with SHOTS=<dir>); none otherwise. */
const SHOTS = process.env.SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

// Screenshots at a phone's pixel density.
test.use({ deviceScaleFactor: 2 });

type Save = typeof v5 & Record<string, unknown>;

/** The v5 fixture: Ysolde, a Duelist with Widow's Hush, in camp before chapter 1, with gold and 3 shards. */
function campSave(patch: (s: Save) => void = () => undefined): Save {
  const s = structuredClone(v5) as Save;
  patch(s);
  return s;
}

async function putSlot(page: Page, save: unknown, slot = 1): Promise<void> {
  await page.evaluate(
    ([value, key]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ten-blades', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(value, key as string);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [save, `slot${slot}`] as const,
  );
}

async function enterCamp(page: Page, save: unknown): Promise<void> {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Ten Blades' })).toBeVisible();
  await putSlot(page, save);
  await page.reload();
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toContainText('Camp');
  await cont.tap();
  await expect(page).toHaveURL(/#\/camp$/);
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
}

const campaign = (page: Page) => page.evaluate(() => window.__camp!.campaign()!);

async function facility(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Facilities' }).getByRole('button', { name, exact: true }).tap();
}

async function backToCamp(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Camp', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
}

test('camp: every facility opens; buy, equip, deploy; awaken; the second power in a skirmish; the win pays and is saved', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  // The camp after Chapter 2: every facility is open and Chapter 3 is reached, so Widow's Hush can awaken.
  await enterCamp(
    page,
    campSave((s) => {
      s.progress = { current: 'chapter3', completed: ['prologue', 'chapter1', 'chapter2'], stage: 'camp', scenes: null } as never;
      s.skirmishWins = { chapter3: 1 } as never;
    }),
  );
  // Big tap targets on the hub.
  for (const b of await page.getByRole('navigation', { name: 'Facilities' }).getByRole('button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByLabel('1250 gold, 3 Blade Shards')).toBeVisible();
  await shot(page, '01-camp-hub');

  // Campfire talk: unread at first (the fixture marks it read, so clear the flag), then read.
  await page.evaluate(() => window.__camp!.setFlag('read_camp_first_night', false));
  await expect(page.getByRole('button', { name: /The first night\s*New/ })).toBeVisible();
  await shot(page, '02-camp-talk-list');
  await page.getByRole('button', { name: /The first night/ }).tap();
  await expect(page.getByRole('dialog', { name: 'Scene' })).toBeVisible();
  await skipScene(page);
  await expect(page).toHaveURL(/#\/camp$/);
  await expect(page.getByRole('button', { name: /The first night/ })).not.toContainText('New');
  expect((await campaign(page)).flags.read_camp_first_night).toBe(true);

  // Merchant: compare a weapon, buy an Iron Katana for Ysolde, and a salve for the convoy.
  await facility(page, 'Merchant');
  await expect(page.getByRole('heading', { name: 'Merchant' })).toBeVisible();
  await page.getByRole('button', { name: /^Iron Lance/ }).tap();
  await page.getByRole('button', { name: /^Iron Katana/ }).tap();
  await expect(page.getByLabel("Against Widow's Hush")).toBeVisible();
  await shot(page, '04-merchant-buy-compare');
  await page.getByRole('button', { name: 'Buy for 650' }).tap();
  await expect(page.getByRole('status').last()).toContainText('Bought Iron Katana');
  await page.getByRole('radio', { name: 'Convoy' }).tap();
  await page.getByRole('button', { name: /^Healing Salve/ }).tap();
  await page.getByRole('button', { name: 'Buy for 150' }).tap();
  let c = await campaign(page);
  expect(c.gold).toBe(1250 - 650 - 150);
  expect(c.party[0]!.inventory).toContain('iron_katana');
  expect(c.convoy).toContain('healing_salve');
  await page.getByRole('tab', { name: 'Sell' }).tap();
  await shot(page, '05-merchant-sell');
  await backToCamp(page);

  // Barracks: the roster, the sheet, equip the new katana and back to the blade.
  await facility(page, 'Barracks');
  await expect(page.getByRole('heading', { name: 'Barracks' })).toBeVisible();
  await shot(page, '06-barracks-roster');
  await page.getByRole('button', { name: /Ysolde Ærwyn, Duelist level 2/ }).tap();
  await page.getByRole('button', { name: 'Equip', exact: true }).last().tap();
  await expect(page.getByRole('status').last()).toContainText('takes up Iron Katana');
  expect((await campaign(page)).party[0]!.weaponId).toBe('iron_katana');
  await shot(page, '07-barracks-unit-sheet');
  // Back to the blade for the skirmish.
  await page.getByRole('button', { name: 'Equip', exact: true }).first().tap();
  expect((await campaign(page)).party[0]!.weaponId).toBe('widows_hush_duelist');
  await page.getByRole('button', { name: 'Roster' }).tap();
  await backToCamp(page);

  // Forge: Widow's Hush, ready to awaken with the 3 shards; a locked future tier.
  await facility(page, 'Forge');
  await expect(page.getByRole('heading', { name: 'Forge' })).toBeVisible();
  await expect(page.getByText('Reach Chapter 3')).toBeVisible();
  await expect(page.getByText(/Unbound · Reach Act 3 · locked/)).toBeVisible();
  await shot(page, '08-forge-before');
  await page.getByRole('button', { name: 'Awaken', exact: true }).tap();
  await page.getByRole('dialog').getByRole('button', { name: 'Awaken' }).tap();
  await expect(page.getByRole('status').last()).toContainText("Widow's Hush awakens. Hush is yours.");
  c = await campaign(page);
  expect(c.blades.widows_hush).toEqual({ tier: 2 });
  expect(c.shards).toBe(0);
  await expect(page.locator('.blade-card .medal.awakened')).toHaveCount(1);
  // Unbound waits for Act 3: it shows its condition, and no Awaken button until that holds.
  await expect(page.getByRole('region', { name: 'Next tier: Unbound' })).toContainText('Reach Act 3');
  await expect(page.getByRole('button', { name: 'Awaken', exact: true })).toHaveCount(0);
  await shot(page, '09-forge-after');
  await page.getByRole('tab', { name: 'Weapons' }).tap();
  await shot(page, '10-forge-weapons');
  await backToCamp(page);

  // War map: chapter 3 is ready to march on; the skirmish shows 2 of 3 left.
  await facility(page, 'War map');
  await expect(page.getByRole('button', { name: 'March' })).toBeVisible();
  await expect(page.getByText(/2 of 3 left this chapter/)).toBeVisible();
  await shot(page, '11-war-map');
  await page.getByRole('button', { name: 'Fight' }).tap();
  await expect(page.getByRole('heading', { name: 'Deploy' })).toBeVisible();
  await expect(page.getByText('1 of 4 deploying')).toBeVisible();
  await shot(page, '12-deploy');
  await page.getByRole('button', { name: 'To battle' }).tap();
  // The lore scene plays the first time.
  await expect(page.getByRole('dialog', { name: 'Scene' })).toHaveAttribute('data-scene', 'skirmish_ridge_lore');
  await skipScene(page);
  await expect(page).toHaveURL(/#\/battle$/);
  await idle(page);

  // In battle: the MC has both powers; Hush a deserter brought next to her and finish the map.
  const s0 = await state(page);
  expect(s0.mapId).toBe('skirmish_ridge');
  expect(s0.bladeTiers).toEqual({ widows_hush: 2 });
  const mc = s0.units.find((u) => u.id === 'mc')!;
  await page.evaluate((p) => {
    window.__tb!.setResolve('mc', 100);
    window.__tb!.patch((s) => {
      for (const u of s.units) {
        if (u.team !== 'enemy' || u.id === 'deserter_1') continue;
        u.alive = false;
        u.hp = 0;
      }
      const e = s.units.find((u) => u.id === 'deserter_1')!;
      e.pos = { x: p.x + 1, y: p.y };
      e.hp = 1;
      e.stats.spd = 0;
      e.stats.lck = 0;
      return s;
    });
  }, mc.pos);
  await tapTile(page, mc.pos.x, mc.pos.y);
  await tapTile(page, mc.pos.x, mc.pos.y);
  await expect(page.getByRole('button', { name: /^Power: Echo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Power: Hush' })).toBeVisible();
  await shot(page, '13-battle-two-powers');
  await page.getByRole('button', { name: 'Power: Hush' }).tap();
  // The dock shrinks to the aiming hint; let the camera settle before tapping the target.
  await settle(page);
  await page.waitForTimeout(200);
  await tapTile(page, mc.pos.x + 1, mc.pos.y);
  await expect(page.getByLabel('Hush forecast')).toContainText('Silences it until your next turn');
  await expect(page.getByLabel('Hush forecast')).toContainText('loses 2 HP');
  await shot(page, '14-battle-hush-forecast');
  await page.getByRole('button', { name: 'Confirm' }).tap();
  await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Spoils')).toContainText('Win by turn 6');
  await shot(page, '15-rewards-summary');
  await page.getByRole('button', { name: 'Back to camp' }).tap();
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
  c = await campaign(page);
  expect(c.skirmishWins).toEqual({ chapter3: 2 });
  expect(c.gold).toBeGreaterThanOrEqual(450 + 300);
  expect(c.shards).toBe(1);
  await facility(page, 'War map');
  await expect(page.getByText(/1 of 3 left this chapter/)).toBeVisible();
  await page.evaluate(() => window.__camp!.saved());

  // Reload: Continue lands in camp with everything intact.
  const before = await campaign(page);
  await page.goto(URL);
  await page.reload();
  const cont = page.getByRole('button', { name: /Continue/ });
  await expect(cont).toContainText('Camp');
  await cont.tap();
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
  const after = await campaign(page);
  expect({ ...after, updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 });
  expect(errors).toEqual([]);
});

test("camp: locked facilities say when they open; a full company deploys up to the map's limit; the fallen are remembered", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  const unit = (id: string, name: string, classId: string, level: number, weaponId: string) => ({
    id,
    name,
    classId,
    level,
    xp: 30,
    stats: { hp: 22, str: 7, mag: 0, skl: 6, spd: 5, lck: 3, def: 7, res: 1, mov: 5 },
    weaponId,
    isLord: false,
    inventory: [weaponId],
  });
  const save = campSave((s) => {
    s.party.push(
      unit('ana', 'Ana', 'soldier', 3, 'iron_lance') as never,
      unit('bo', 'Bo', 'ranger', 2, 'short_bow') as never,
      unit('cy', 'Cy', 'adept', 4, 'ember_tome') as never,
      unit('di', 'Di', 'medic', 1, 'mending_rod') as never,
    );
    (s as Record<string, unknown>).fallen = [unit('fen', 'Fen', 'soldier', 2, 'iron_lance')];
  });
  await enterCamp(page, save);
  // The camp after the prologue: the merchant and the forge open after Chapter 2.
  await expect(page.getByRole('button', { name: /Forge, locked/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Merchant, locked/ })).toBeDisabled();
  await expect(page.getByText('Opens after Chapter 2').first()).toBeVisible();
  await shot(page, '03-camp-locked');
  await facility(page, 'Barracks');
  await expect(page.getByRole('region', { name: 'The fallen' })).toContainText('Fen');
  await shot(page, '06b-barracks-roster-full');
  await backToCamp(page);
  await facility(page, 'War map');
  await page.getByRole('button', { name: 'Fight' }).tap();
  await expect(page.getByText('4 of 4 deploying')).toBeVisible();
  await expect(page.getByText('No room')).toBeVisible();
  await shot(page, '12b-deploy-full');
  // Bench Ana: Di takes her place.
  await page.getByRole('button', { name: 'Keep Ana in camp' }).tap();
  await expect(page.getByText('4 of 4 deploying')).toBeVisible();
  expect((await campaign(page)).benched).toEqual(['ana']);
  await expect(page.getByText('Stays in camp')).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  await backToCampFrom(page);
  await shot(page, '16-camp-430');
  await page.setViewportSize({ width: 667, height: 375 });
  await shot(page, '17-camp-landscape');
  expect(errors).toEqual([]);
});

async function backToCampFrom(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Map' }).tap();
  await page.getByRole('button', { name: 'Camp', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Camp' })).toBeVisible();
}

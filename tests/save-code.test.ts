import { describe, expect, it } from 'vitest';
import { chapters, gameData } from '../src/data';
import { decodeSaveCode, decodeSaveCodeText, encodeSaveCode } from '../src/save/code';
import { newCampaign } from '../src/save/campaign';
import type { CampaignSave, SaveContext } from '../src/save/format';
import { memoryStorage } from '../src/save/storage';
import { DEFAULT_LOOK } from '../src/art/mc/look';
import v1 from './fixtures/save-v1.json';
import v2 from './fixtures/save-v2.json';

const ctx: SaveContext = { data: gameData, chapters };

const named = (name: string): CampaignSave =>
  newCampaign({ settings: { difficulty: 'lunatic', permadeath: 'casual' }, mc: { name, pronouns: 'they', style: 'duelist' } }, chapters, 42);

describe('save codes', () => {
  for (const name of ['Ash', 'Ysolde Ærwyn', '龍之刃', 'Ṡeren 🗡', 'Ольга']) {
    it(`round trips "${name}" compressed and plain`, async () => {
      const save = named(name);
      for (const compress of [true, false]) {
        const code = await encodeSaveCode(save, { compress });
        expect(code.startsWith(compress ? 'TB1.z.' : 'TB1.j.')).toBe(true);
        expect(code).toMatch(/^[A-Za-z0-9+/=.]+$/);
        expect(await decodeSaveCode(code, ctx)).toEqual({ ok: true, value: save });
      }
    });
  }

  it('round trips the v2 fixture and survives spaces and line breaks from pasting', async () => {
    const code = await encodeSaveCode(v2 as CampaignSave);
    const pasted = `  ${code.slice(0, 20)}\n${code.slice(20, 50)} \r\n${code.slice(50)}\n`;
    expect(await decodeSaveCode(pasted, ctx)).toEqual({ ok: true, value: v2 });
  });

  it('imports a code made from a version 1 save, with the default look', async () => {
    const code = await encodeSaveCode(v1 as unknown as CampaignSave);
    const r = await decodeSaveCode(code, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(2);
    expect(r.value.mc.look).toEqual(DEFAULT_LOOK);
  });

  it('accepts bare base64 of the JSON', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(named('Ærwyn')));
    const bare = btoa(String.fromCharCode(...bytes));
    expect(await decodeSaveCode(bare, ctx)).toEqual({ ok: true, value: named('Ærwyn') });
  });

  it('export, wipe, import: the slot comes back', async () => {
    const store = memoryStorage(ctx);
    await store.saveSlot(2, named('Ольга'));
    const first = await store.loadSlot(2);
    const code = await encodeSaveCode(first.ok ? first.value! : named('x'));
    await store.deleteSlot(2);
    const r = await decodeSaveCode(code, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await store.saveSlot(2, r.value);
    expect(await store.loadSlot(2)).toEqual(first);
  });

  it('explains bad codes in plain words', async () => {
    const err = async (code: string) => {
      const r = await decodeSaveCode(code, ctx);
      return r.ok ? 'ok' : r.error;
    };
    expect(await err('')).toBe('The code is empty. Paste a save code first.');
    expect(await err('not a save code!!')).toBe('This is not a save code. Some characters are missing or do not belong.');
    expect(await err('TB1.q.AAAA')).toBe('This save code is from a different version of the game.');
    expect(await err('TB7.z.AAAA')).toBe('This save code is from a newer version of the game.');
    const good = await encodeSaveCode(named('Ash'));
    expect(await err(good.slice(0, good.length - 12))).toMatch(/damaged/);
    expect(await err(`TB1.j.${btoa('{"version":1')}`)).toMatch(/damaged/);
    expect(await err(`TB1.j.${btoa('{"version":1,"kind":"campaign"}')}`)).toMatch(/^This save could not be read/);
    expect(await err(`TB1.j.${btoa('{"version":1,"kind":"suspend"}')}`)).toBe('This code holds a suspended battle, not a campaign save.');
    expect(await err(`TB1.j.${btoa('{"version":4}')}`)).toMatch(/newer version of the game/);
  });

  it('rejects invalid UTF-8', async () => {
    const r = await decodeSaveCodeText(`TB1.j.${btoa('\xff\xfe{')}`);
    expect(r.ok).toBe(false);
  });
});

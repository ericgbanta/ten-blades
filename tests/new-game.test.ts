import { describe, expect, it } from 'vitest';
import { chapters, gameData } from '../src/data';
import { DEFAULT_LOOK, lookProblem } from '../src/art/mc/look';
import { newCampaign } from '../src/save/campaign';
import { validateCampaign } from '../src/save/validate';
import { DEFAULT_DRAFT, STEP_INFO, nextExpression, randomized, stepProblem, withLook, withMc } from '../src/ui/menus/newGameDraft';

describe('new game flow state', () => {
  it('runs slot, path, hero, then the creator, which begins the game', () => {
    expect(STEP_INFO.map((s) => s.id)).toEqual(['slot', 'mode', 'hero', 'look']);
    expect(STEP_INFO.map((s) => s.nextLabel)).toEqual([null, 'Next', 'Next', 'Begin']);
  });

  it('starts with the default look and no name', () => {
    expect(DEFAULT_DRAFT.mc).toEqual({ name: '', pronouns: 'they', style: 'vanguard', look: DEFAULT_LOOK });
    expect(DEFAULT_DRAFT.mc.look).not.toBe(DEFAULT_LOOK);
  });

  it('needs a name before the hero step moves on', () => {
    expect(stepProblem('hero', DEFAULT_DRAFT)).toMatch(/Give your hero a name/);
    expect(stepProblem('hero', withMc(DEFAULT_DRAFT, { name: '   ' }))).toMatch(/Give your hero a name/);
    expect(stepProblem('hero', withMc(DEFAULT_DRAFT, { name: 'x'.repeat(17) }))).toMatch(/up to 16/);
    expect(stepProblem('hero', withMc(DEFAULT_DRAFT, { name: 'Bryn' }))).toBeNull();
    expect(stepProblem('look', DEFAULT_DRAFT)).toBeNull();
  });

  it('changes one look field at a time and never the shared default', () => {
    const d = withLook(withMc(DEFAULT_DRAFT, { name: 'Bryn', style: 'duelist' }), { hairStyle: 'ponytail', skin: 'deep' });
    expect(d.mc).toMatchObject({ name: 'Bryn', style: 'duelist' });
    expect(d.mc.look).toEqual({ ...DEFAULT_LOOK, hairStyle: 'ponytail', skin: 'deep' });
    expect(DEFAULT_DRAFT.mc.look).toEqual(DEFAULT_LOOK);
  });

  it('randomizes only the look, the same way for the same seed', () => {
    const d = withMc(DEFAULT_DRAFT, { name: 'Bryn', pronouns: 'she', style: 'spiritblade' });
    const a = randomized(d, 99);
    expect(a.mc.look).toEqual(randomized(d, 99).mc.look);
    expect(lookProblem(a.mc.look)).toBeNull();
    expect(a.mc).toMatchObject({ name: 'Bryn', pronouns: 'she', style: 'spiritblade' });
    const looks = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(randomized(d, s).mc.look)));
    expect(looks.size).toBeGreaterThan(4);
  });

  it('cycles the preview expression', () => {
    expect(nextExpression('neutral')).toBe('angry');
    expect(nextExpression('angry')).toBe('hurt');
    expect(nextExpression('hurt')).toBe('smile');
    expect(nextExpression('smile')).toBe('neutral');
  });

  it('makes a valid campaign that keeps the look', () => {
    const d = withLook(withMc(DEFAULT_DRAFT, { name: 'Bryn' }), { body: 'broad', scar: 'tattoo', accent: 'violet' });
    const c = newCampaign({ settings: d.settings, mc: d.mc }, chapters, 5);
    const v = validateCampaign(c, { data: gameData, chapters });
    expect(v.ok).toBe(true);
    expect(c.mc.look).toEqual({ ...DEFAULT_LOOK, body: 'broad', scar: 'tattoo', accent: 'violet' });
  });
});

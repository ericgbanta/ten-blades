import { describe, expect, it } from 'vitest';
import { applyAction, createBattle, type BattleState } from '../src/core';
import { chapters, gameData } from '../src/data';
import { applyPermadeath, battleSetup, completeChapter, currentChapter, newCampaign, plotCriticalRetreats } from '../src/save/campaign';
import type { CampaignSave, ChapterDef, SaveContext } from '../src/save/format';
import { validateCampaign } from '../src/save/validate';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();

function start(permadeath: 'classic' | 'casual'): CampaignSave {
  return newCampaign({ settings: { difficulty: 'normal', permadeath }, mc: { name: '  Ash ', pronouns: 'he', style: 'vanguard' } }, chapters, 100);
}

/** A won battle where `q` fell: the lord kills the last enemy after q died. */
function wonWithLoss(permadeath: 'classic' | 'casual'): BattleState {
  let s = makeBattle(
    ['......'],
    [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('q', 'fighter', 'player', 5, 0), place('r', 'fighter', 'player', 4, 0), place('e', 'fighter', 'enemy', 2, 0)],
  );
  s = { ...s, options: { ...s.options, permadeath } };
  s = patchUnit(s, 'q', { alive: false, hp: 0 });
  s = patchUnit(s, 'e', { hp: 1 });
  s = patchUnit(s, 'p', { weaponId: 'sure_axe' });
  const r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, data);
  expect(r.state.result).toBe('victory');
  return r.state;
}

describe('chapter order', () => {
  it('has unique ids and every map exists', () => {
    expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    for (const c of chapters) expect(gameData.maps[c.mapId], c.id).toBeDefined();
  });
});

describe('new campaign', () => {
  it('starts at the first chapter with nothing carried, and trims the name', () => {
    const c = start('classic');
    expect(c).toMatchObject({ version: 1, kind: 'campaign', createdAt: 100, updatedAt: 100, party: [], fallen: [], gold: 0, shards: 0, flags: {} });
    expect(c.mc.name).toBe('Ash');
    expect(c.progress).toEqual({ current: 'prologue', completed: [] });
    expect(currentChapter(c, chapters)?.mapId).toBe('prologue');
    expect(battleSetup(c)).toEqual({ difficulty: 'normal', permadeath: 'classic', mc: { name: 'Ash', style: 'vanguard' }, party: [] });
  });
});

describe('permadeath', () => {
  it('casual brings the fallen back, in unit order', () => {
    const s = wonWithLoss('casual');
    const out = applyPermadeath(s, 'casual', start('casual'));
    expect(out.party.map((u) => u.id)).toEqual(['p', 'q', 'r']);
    expect(out.lost).toEqual([]);
  });

  it('classic loses the fallen for good', () => {
    const s = wonWithLoss('classic');
    const out = applyPermadeath(s, 'classic', start('classic'));
    expect(out.party.map((u) => u.id)).toEqual(['p', 'r']);
    expect(out.lost.map((u) => u.id)).toEqual(['q']);
  });

  it('the plot-critical retreat hook is a stub that keeps no one yet', () => {
    const s = wonWithLoss('classic');
    expect(plotCriticalRetreats(applyPermadeath(s, 'casual', start('classic')).party[1]!, start('classic'))).toBe(false);
  });
});

describe('completing a chapter', () => {
  const twoChapters: ChapterDef[] = [
    { id: 'prologue', name: 'Prologue', mapId: 'prologue' },
    { id: 'ch1', name: 'Chapter 1', mapId: 'prologue' },
  ];

  it('carries the party, records losses and moves to the next chapter', () => {
    const c = start('classic');
    const s = wonWithLoss('classic');
    const next = completeChapter(c, s, twoChapters, 500);
    expect(next.updatedAt).toBe(500);
    expect(next.createdAt).toBe(100);
    expect(next.party.map((u) => u.id)).toEqual(['p', 'r']);
    expect(next.fallen.map((u) => u.id)).toEqual(['q']);
    expect(next.progress).toEqual({ current: 'ch1', completed: ['prologue'] });
    expect(c.progress.completed).toEqual([]);
  });

  it('ends at "to be continued" after the last chapter, and the result is a valid save', () => {
    const c = start('casual');
    const battle = createBattle(gameData.maps.prologue!, battleSetup(c), 1, gameData);
    const won: BattleState = { ...battle, result: 'victory' };
    const next = completeChapter(c, won, chapters, 900);
    expect(next.progress).toEqual({ current: null, completed: ['prologue'] });
    expect(next.party.map((u) => u.id)).toEqual(['mc', 'stranger']);
    const ctx: SaveContext = { data: gameData, chapters };
    expect(validateCampaign(next, ctx).ok).toBe(true);
  });

  it('refuses a battle that was not won', () => {
    const c = start('classic');
    const battle = createBattle(gameData.maps.prologue!, battleSetup(c), 1, gameData);
    expect(() => completeChapter(c, battle, chapters, 1)).toThrow();
  });
});

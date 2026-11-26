import { DEFAULT_LOOK } from '../src/art/mc/look';
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
  it('has unique ids, every map exists, and each chapter names a real next one', () => {
    expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    for (const c of chapters) {
      if (c.mapId !== null) expect(gameData.maps[c.mapId], c.id).toBeDefined();
      if (c.next !== null) expect(chapters.some((n) => n.id === c.next), c.id).toBe(true);
    }
  });
});

describe('new campaign', () => {
  it('starts at the first chapter with nothing carried, and trims the name', () => {
    const c = start('classic');
    expect(c).toMatchObject({ version: 5, kind: 'campaign', createdAt: 100, updatedAt: 100, party: [], fallen: [], gold: 0, shards: 0, flags: {}, blades: {}, convoy: [], benched: [], wounded: {}, skirmishWins: {} });
    expect(c.mc.name).toBe('Ash');
    expect(c.mc.look).toEqual(DEFAULT_LOOK);
    expect(c.progress).toEqual({ current: 'prologue', completed: [], stage: 'intro', scenes: null });
    expect(currentChapter(c, chapters)?.mapId).toBe('prologue');
    expect(battleSetup(c)).toEqual({ difficulty: 'normal', permadeath: 'classic', mc: { name: 'Ash', style: 'vanguard' }, party: [], flags: {}, bladeTiers: {} });
  });

  it('keeps the look the creator made, as a copy', () => {
    const look = { ...DEFAULT_LOOK, body: 'broad', hairStyle: 'bob', scar: 'tattoo' };
    const c = newCampaign({ settings: { difficulty: 'normal', permadeath: 'casual' }, mc: { name: 'Ash', pronouns: 'he', style: 'duelist', look } }, chapters, 1);
    expect(c.mc.look).toEqual(look);
    expect(c.mc.look).not.toBe(look);
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
    { id: 'prologue', name: 'Prologue', title: 'P', mapId: 'prologue', intro: [], outro: [], after: [], next: 'ch1', act: 1 },
    { id: 'ch1', name: 'Chapter 1', title: 'One', mapId: 'prologue', intro: [], outro: [], after: [], next: null, act: 1 },
  ];

  it('carries the party, records losses, keeps the flags and moves on to the outro', () => {
    const c = { ...start('classic'), flags: { kept: 1, changed: 'old' } };
    const s = { ...wonWithLoss('classic'), flags: { changed: 'new', won: true } };
    const next = completeChapter(c, s, twoChapters, 500);
    expect(next.updatedAt).toBe(500);
    expect(next.createdAt).toBe(100);
    expect(next.party.map((u) => u.id)).toEqual(['p', 'r']);
    expect(next.fallen.map((u) => u.id)).toEqual(['q']);
    expect(next.flags).toEqual({ kept: 1, changed: 'new', won: true });
    expect(next.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
    expect(c.progress.completed).toEqual([]);
  });

  it('a won prologue is a valid save, waiting on its outro', () => {
    const c = start('casual');
    const battle = createBattle(gameData.maps.prologue!, battleSetup(c), 1, gameData);
    const won: BattleState = { ...battle, result: 'victory' };
    const next = completeChapter(c, won, chapters, 900);
    expect(next.progress).toEqual({ current: 'prologue', completed: [], stage: 'outro', scenes: null });
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

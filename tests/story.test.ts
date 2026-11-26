// The story layer: text tokens and pronouns, the scene runner, the chapter flow, and the shipped script.

import { describe, expect, it } from 'vitest';
import { applyAction, createBattle, planUnitAction, type AiState, type BattleState, type StoryContext } from '../src/core';
import { imageMeta } from '../src/art/manifest';
import { chapters, gameData } from '../src/data';
import { sceneIds, scenes, speakers, worldNames } from '../src/data/story';
import { battleSetup, completeChapter, newCampaign } from '../src/save/campaign';
import type { CampaignSave, SaveContext } from '../src/save/format';
import { validateCampaign } from '../src/save/validate';
import { canPlay, finishScene, flowStep, pickVariant, settle } from '../src/story/flow';
import { advance, choose, skipToChoice, startScene, type RunnerContext, type SceneState } from '../src/story/runner';
import { resolveText, unknownTokens, type TextContext } from '../src/story/text';
import type { Pronouns, SceneDef } from '../src/story/types';
import { validateStory } from '../src/story/validate';
import { validateGameData } from '../src/core';

const names = { empire: 'Ardent Empire', village: 'Wrenfold', emperor: 'Emperor Haldric' };
const ctx = (pronouns: Pronouns, mcName = 'Ash'): TextContext => ({ mcName, pronouns, names });

describe('text tokens', () => {
  it('fills in the name and the world names, capitalized on request', () => {
    expect(resolveText('{mc} left {village} for the {empire}.', ctx('she'))).toBe('Ash left Wrenfold for the Ardent Empire.');
    expect(resolveText('{Village} burns.', ctx('he'))).toBe('Wrenfold burns.');
  });

  it('gives every pronoun form for he, she and they, capitalized at a sentence start', () => {
    const line = '{they} {them} {their} {theirs} {themself} | {They} {Them} {Their} {Theirs} {Themself}';
    expect(resolveText(line, ctx('he'))).toBe('he him his his himself | He Him His His Himself');
    expect(resolveText(line, ctx('she'))).toBe('she her her hers herself | She Her Her Hers Herself');
    expect(resolveText(line, ctx('they'))).toBe('they them their theirs themself | They Them Their Theirs Themself');
  });

  it('agrees the verb: two forms split he and she from they, three forms give one each', () => {
    const line = '{They} {is|are} here. {They} {has|have} the sword and {runs|run}.';
    expect(resolveText(line, ctx('he'))).toBe('He is here. He has the sword and runs.');
    expect(resolveText(line, ctx('she'))).toBe('She is here. She has the sword and runs.');
    expect(resolveText(line, ctx('they'))).toBe('They are here. They have the sword and run.');
    expect(resolveText('{son|daughter|child}', ctx('she'))).toBe('daughter');
    expect(resolveText('{son|daughter|child}', ctx('they'))).toBe('child');
  });

  it('leaves unknown tokens as they are, and lists them', () => {
    expect(resolveText('{nope} and {a|b|c|d}', ctx('he'))).toBe('{nope} and {a|b|c|d}');
    expect(unknownTokens('{mc} {nope} {they} {a|b|c|d}', ctx('he'))).toEqual(['{nope}', '{a|b|c|d}']);
  });

  it('a name with braces or a token in it is not read again', () => {
    expect(resolveText('{mc} waits.', ctx('they', '{they}'))).toBe('{they} waits.');
  });
});

const sceneSpeakers = {
  mc: { name: '{mc}', portrait: 'mc' },
  narrator: { name: '', portrait: null, voice: 'narration' as const },
  blade: { name: '', portrait: null, voice: 'whisper' as const },
  s: { name: 'S', portrait: 'stranger' },
  c: { name: 'C', portrait: 'captain' },
};
const story: StoryContext = { flags: {}, permadeath: 'classic', difficulty: 'normal' };
const rctx = (flags = {}): RunnerContext => ({ story: { ...story, flags }, speakers: sceneSpeakers });

const TEST_SCENE: SceneDef = {
  id: 't',
  backdrop: 'village',
  lines: [
    { fx: 'fadeIn' },
    { speaker: 'narrator', text: 'Night.' },
    { speaker: 'mc', text: 'Hello.' },
    { speaker: 's', expr: 'hurt', text: 'Go.' },
    { speaker: 'c', side: 'left', text: 'Stop.' },
    { fx: 'shake' },
    { speaker: 'mc', expr: 'angry', text: 'No.' },
    { goto: 'skip_me', if: [{ type: 'flag', flag: 'skip' }] },
    { speaker: 'blade', text: 'Whisper.' },
    { label: 'skip_me' },
    { leave: 's' },
    { enter: 's', side: 'left', expr: 'smile' },
    { backdrop: 'forest' },
    {
      choice: [
        { text: 'Yes', set: { said: 'yes' }, goto: 'yes' },
        { text: 'No', set: { said: 'no' } },
      ],
    },
    { speaker: 's', text: 'Pity.' },
    { end: true },
    { label: 'yes' },
    { speaker: 's', text: 'Good.' },
  ],
};

const lines = (st: SceneState) => (st.at.kind === 'line' ? st.at.line.text : st.at.kind);

describe('scene runner', () => {
  it('stops on each line with the speaker in a slot, the others dimmed, and effects passed on the way', () => {
    const c = rctx();
    let st = startScene(TEST_SCENE, c);
    expect(lines(st)).toBe('Night.');
    expect(st.fx).toEqual(['fadeIn']);
    expect(st.speaking).toBeNull();
    expect(st.backdrop).toBe('village');
    st = advance(TEST_SCENE, st, c);
    expect(st).toMatchObject({ left: { speaker: 'mc', expr: 'neutral' }, right: null, speaking: 'left', fx: [] });
    st = advance(TEST_SCENE, st, c);
    expect(st).toMatchObject({ left: { speaker: 'mc' }, right: { speaker: 's', expr: 'hurt' }, speaking: 'right' });
    st = advance(TEST_SCENE, st, c);
    // The captain takes the left slot from the MC.
    expect(st).toMatchObject({ left: { speaker: 'c', expr: 'neutral' }, right: { speaker: 's', expr: 'hurt' }, speaking: 'left' });
    st = advance(TEST_SCENE, st, c);
    expect(st.fx).toEqual(['shake']);
    expect(st).toMatchObject({ left: { speaker: 'mc', expr: 'angry' }, speaking: 'left' });
    st = advance(TEST_SCENE, st, c);
    expect(lines(st)).toBe('Whisper.');
    expect(st.speaking).toBeNull();
    st = advance(TEST_SCENE, st, c);
    expect(st.at.kind).toBe('choice');
    expect(st).toMatchObject({ left: { speaker: 's', expr: 'smile' }, right: null, backdrop: 'forest' });
    expect(st.log.map((e) => e.text)).toEqual(['Night.', 'Hello.', 'Go.', 'Stop.', 'No.', 'Whisper.']);
  });

  it('a choice sets its flags, jumps to its label, and the scene ends', () => {
    const c = rctx();
    let st = skipToChoice(TEST_SCENE, startScene(TEST_SCENE, c), c);
    expect(st.at.kind).toBe('choice');
    const yes = choose(TEST_SCENE, st, 0, c);
    expect(lines(yes)).toBe('Good.');
    expect(yes.set).toEqual({ said: 'yes' });
    expect(yes.choices).toEqual([0]);
    expect(yes.log.at(-2)).toEqual({ speaker: 'mc', text: 'Yes', choice: true });
    expect(advance(TEST_SCENE, yes, c).at.kind).toBe('end');
    st = choose(TEST_SCENE, st, 1, c);
    expect(lines(st)).toBe('Pity.');
    expect(st.set).toEqual({ said: 'no' });
    expect(advance(TEST_SCENE, st, c).at.kind).toBe('end');
  });

  it('a conditional goto follows the story flags', () => {
    const c = rctx({ skip: true });
    let st = startScene(TEST_SCENE, c);
    for (let i = 0; i < 4; i++) st = advance(TEST_SCENE, st, c);
    expect(lines(st)).toBe('No.');
    expect(advance(TEST_SCENE, st, c).at.kind).toBe('choice');
  });

  it('skip stops at a choice, which the player still makes, and drops the effects on the way', () => {
    const c = rctx();
    const st = skipToChoice(TEST_SCENE, startScene(TEST_SCENE, c), c);
    expect(st.at.kind).toBe('choice');
    expect(st.fx).toEqual([]);
    expect(st.set).toEqual({});
    expect(skipToChoice(TEST_SCENE, st, c)).toEqual(st);
  });

  it('is plain data, the same every run', () => {
    const c = rctx();
    const a = startScene(TEST_SCENE, c);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(startScene(TEST_SCENE, c)).toEqual(a);
  });

  it('an unknown speaker takes a slot (shown as a silhouette)', () => {
    const scene: SceneDef = { id: 'u', lines: [{ speaker: 'stranger_x', text: 'Hm.' }] };
    expect(startScene(scene, rctx())).toMatchObject({ right: { speaker: 'stranger_x' }, speaking: 'right' });
  });
});

const CHARGE: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };

/** Play the prologue to a win with the charge AI on the player side (seed 7 wins on Normal). */
function winPrologue(c: CampaignSave, seed = 7): BattleState {
  let s = createBattle(gameData.maps.prologue!, battleSetup(c), seed, gameData);
  for (let n = 0; n < 500 && s.result === 'ongoing'; n++) {
    const ready = s.units.find((u) => u.team === 'player' && u.alive && !u.acted);
    const a = s.phase !== 'player' ? null : ready ? planUnitAction(s, ready.id, gameData, CHARGE) : { type: 'endPhase' as const };
    s = a ? applyAction(s, a, gameData).state : s;
    if (s.phase !== 'player' && s.result === 'ongoing') {
      for (let m = 0; m < 200 && s.phase !== 'player' && s.result === 'ongoing'; m++) {
        const ai = s.units.find((u) => u.alive && u.team === s.phase && !u.acted);
        s = applyAction(s, ai ? planUnitAction(s, ai.id, gameData) : { type: 'endPhase' }, gameData).state;
      }
    }
  }
  return s;
}

const saveCtx: SaveContext = { data: gameData, chapters, sceneIds };

describe('chapter flow', () => {
  const fresh = (style: 'vanguard' | 'duelist' | 'spiritblade' = 'duelist', permadeath: 'classic' | 'casual' = 'classic') =>
    newCampaign({ settings: { difficulty: 'normal', permadeath }, mc: { name: 'Ash', pronouns: 'she', style } }, chapters, 1);

  it('a new campaign plays the prologue intro, then the battle', () => {
    let c = settle(fresh(), chapters, gameData, 2);
    expect(c.progress).toEqual({ current: 'prologue', completed: [], stage: 'intro', scenes: ['prologue_intro'] });
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'scene', sceneId: 'prologue_intro', stage: 'intro' });
    expect(canPlay(c, chapters, gameData)).toBe(true);
    c = finishScene(c, 'prologue_intro', {}, chapters, gameData, 3);
    expect(c.progress).toEqual({ current: 'prologue', completed: [], stage: 'battle', scenes: [] });
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'battle', mapId: 'prologue' });
    expect(validateCampaign(c, saveCtx).ok).toBe(true);
  });

  it('quitting mid-scene keeps the scene at the head, so it replays from its start and nothing is applied twice', () => {
    const c = settle(fresh(), chapters, gameData, 2);
    // Nothing is written while a scene plays; the save still names it.
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'scene', sceneId: 'prologue_intro' });
    const after = finishScene(c, 'prologue_intro', { x: 1 }, chapters, gameData, 3);
    expect(() => finishScene(after, 'prologue_intro', { x: 2 }, chapters, gameData, 4)).toThrow(/not the one in progress/);
  });

  it('winning the prologue plays the outro, keeps the choice, drops the Stranger and gives the MC the Widow\'s Hush', () => {
    for (const style of ['vanguard', 'duelist', 'spiritblade'] as const) {
      let c = finishScene(settle(fresh(style), chapters, gameData, 2), 'prologue_intro', {}, chapters, gameData, 3);
      const won = winPrologue(c);
      expect(won.result).toBe('victory');
      expect(won.firedEvents).toContain('start_lesson');
      c = settle(completeChapter(c, won, chapters, 4), chapters, gameData, 4);
      const fell = won.units.find((u) => u.id === 'stranger')!.alive === false;
      expect(c.flags.stranger_fell ?? false).toBe(fell);
      expect(c.progress.stage).toBe('outro');
      expect(c.progress.scenes).toEqual(fell ? ['prologue_outro_fell', 'prologue_binding'] : ['prologue_outro', 'prologue_binding']);
      c = finishScene(c, c.progress.scenes![0]!, { prologue_promise: true }, chapters, gameData, 5);
      expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'scene', sceneId: 'prologue_binding' });
      c = finishScene(c, 'prologue_binding', {}, chapters, gameData, 6);
      // The prologue ends in camp (chapters.json campAfter), before chapter 1.
      expect(c.progress).toEqual({ current: 'chapter1', completed: ['prologue'], stage: 'camp', scenes: null });
      expect(c.flags.prologue_promise).toBe(true);
      expect(c.party.map((u) => u.id)).toEqual(['mc']);
      expect(c.party[0]!.weaponId).toBe(`widows_hush_${style}`);
      // The blade takes the starting weapon's slot; the old weapon goes to the convoy.
      expect(c.party[0]!.inventory).toEqual([`widows_hush_${style}`]);
      expect(c.convoy).toEqual([gameData.classes[style]!.startingWeapon]);
      // The inherited blade goes on record, Dormant.
      expect(c.blades).toEqual({ widows_hush: { tier: 1 } });
      expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'camp', chapter: { id: 'chapter1' } });
      expect(canPlay(c, chapters, gameData)).toBe(true);
      expect(validateCampaign(c, saveCtx).ok).toBe(true);
    }
  });

  it('picks the short outro when the Stranger fell in Classic, the full one in Casual', () => {
    const variants = chapters[0]!.outro;
    const fell = { flags: { stranger_fell: true }, difficulty: 'normal' as const };
    expect(pickVariant(variants, { ...fell, permadeath: 'classic' })[0]).toBe('prologue_outro_fell');
    expect(pickVariant(variants, { ...fell, permadeath: 'casual' })[0]).toBe('prologue_outro');
    expect(pickVariant(variants, { flags: {}, permadeath: 'classic', difficulty: 'normal' })[0]).toBe('prologue_outro');
  });

  it('a story with no chapter left is finished', () => {
    const c = { ...fresh(), progress: { current: null, completed: ['prologue'], stage: 'intro' as const, scenes: null } };
    expect(flowStep(c, chapters, gameData)).toEqual({ kind: 'finished' });
  });
});

describe('the shipped script', () => {
  it('passes the story checks: scenes, speakers, tokens, line lengths, choices, chapters and map scenes', () => {
    expect(validateStory({ scenes, speakers, chapters, names: worldNames }, gameData, (id) => !!imageMeta(id))).toEqual([]);
  });

  it('map events name only real scenes', () => {
    expect(validateGameData(gameData, { sceneIds })).toEqual([]);
  });

  it('names.json holds the world names and the names of the recruits', () => {
    expect(Object.keys(worldNames).sort()).toEqual([
      'adept_recruit',
      'continent',
      'emperor',
      'empire',
      'gravemaw_bearer',
      'medic_recruit',
      'needles_bearer',
      'ranger_recruit',
      'soldier_recruit',
      'town',
      'village',
    ]);
  });

  it('every scene a chapter or event names exists, and every speaker resolves', () => {
    const named = new Set<string>();
    for (const ch of chapters) for (const v of [...ch.intro, ...ch.outro]) for (const s of v.scenes) named.add(s);
    for (const m of Object.values(gameData.maps)) for (const ev of m.events ?? []) for (const fx of ev.effects) if (fx.type === 'scene') named.add(fx.sceneId);
    for (const s of named) expect(scenes[s], s).toBeDefined();
    for (const s of Object.values(scenes)) {
      for (const n of s.lines) if ('speaker' in n) expect(speakers[n.speaker], `${s.id}: ${n.speaker}`).toBeDefined();
    }
  });

  it('the prologue has a short intro, three to five mid-battle beats, one choice in each outro; chapters 1 to 3 are written', () => {
    const spoken = (id: string) => scenes[id]!.lines.filter((n) => 'text' in n).length;
    expect(spoken('prologue_intro')).toBeGreaterThanOrEqual(12);
    expect(spoken('prologue_intro')).toBeLessThanOrEqual(20);
    const beats = (gameData.maps.prologue!.events ?? []).filter((e) => e.effects.some((f) => f.type === 'scene'));
    expect(beats.length).toBeGreaterThanOrEqual(3);
    for (const id of ['prologue_outro', 'prologue_outro_fell']) expect(scenes[id]!.lines.filter((n) => 'choice' in n)).toHaveLength(1);
    for (const id of ['ch1_intro', 'ch2_intro', 'ch3_intro']) {
      expect(scenes[id]!.draft).toBeUndefined();
      expect(spoken(id)).toBeGreaterThanOrEqual(6);
      expect(spoken(id)).toBeLessThanOrEqual(16);
    }
    // The first story choice that sets a flag is in Chapter 3's outro.
    expect(scenes.ch3_outro!.lines.filter((n) => 'choice' in n)).toHaveLength(1);
  });

  it('every line reads cleanly for he, she and they', () => {
    for (const s of Object.values(scenes)) {
      for (const n of s.lines) {
        if (!('text' in n)) continue;
        for (const p of ['he', 'she', 'they'] as const) {
          const out = resolveText(n.text, { mcName: 'Ash', pronouns: p, names: worldNames });
          expect(out, `${s.id}: ${n.text}`).not.toMatch(/[{}]/);
        }
      }
    }
  });
});

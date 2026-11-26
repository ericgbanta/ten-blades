// Chapters 1 to 3: the shipped data resolves end to end, the names agree, the recruits join by the scripted
// events, the objectives can be won, and the chapter flow runs from the prologue's camp to the camp after
// Chapter 3. Fixed seeds throughout.

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createBattle,
  moveTiles,
  startBattle,
  talkTargets,
  validateAction,
  type BattleSetup,
  type BattleState,
  type GameData,
  type MapData,
  type PartyUnit,
  type UnitPlacement,
} from '../src/core';
import { imageMeta } from '../src/art/manifest';
import { campContent, chapters, gameData } from '../src/data';
import { scenes, speakers, worldNames } from '../src/data/story';
import { completeChapter, newCampaign } from '../src/save/campaign';
import type { CampaignSave } from '../src/save/format';
import { finishScene, flowStep, settle } from '../src/story/flow';
import type { SceneDef } from '../src/story/types';
import { leaveCamp } from '../src/camp/camp';
import { chapterParty } from './sim';

const STORY = ['chapter1', 'chapter2', 'chapter3'] as const;
const setup = (party?: PartyUnit[], difficulty: BattleSetup['difficulty'] = 'normal'): BattleSetup => ({
  difficulty,
  permadeath: 'classic',
  mc: { name: 'Ash', style: 'vanguard' },
  party,
});

/** Every unit a map can hold: placements, waves and event spawns. */
function mapUnits(m: MapData): UnitPlacement[] {
  const spawns = (m.events ?? []).flatMap((ev) => ev.effects.flatMap((fx) => (fx.type === 'spawn' ? fx.units : [])));
  return [...m.placements.filter((p): p is UnitPlacement => p.kind === 'unit'), ...m.reinforcements.flatMap((w) => w.units), ...spawns];
}

/** Every scene a chapter can play: intro and outro variants, its map's events, and its camp's talk. */
function chapterScenes(id: string): string[] {
  const ch = chapters.find((c) => c.id === id)!;
  const map = ch.mapId ? gameData.maps[ch.mapId] : undefined;
  return [
    ...[...ch.intro, ...ch.outro].flatMap((v) => v.scenes),
    ...(map?.events ?? []).flatMap((ev) => ev.effects.flatMap((fx) => (fx.type === 'scene' ? [fx.sceneId] : []))),
    ...(ch.campAfter?.talk ?? []).map((t) => t.scene),
  ];
}

/** Flags the map's events can set. */
const eventFlags = (m: MapData): string[] => (m.events ?? []).flatMap((ev) => ev.effects.flatMap((fx) => (fx.type === 'setFlag' ? [fx.flag] : [])));

describe('chapters 1 to 3: the data resolves', () => {
  it('each chapter has its map, events, backdrop art, deploy rule and plot-critical units', () => {
    for (const id of STORY) {
      const ch = chapters.find((c) => c.id === id)!;
      expect(ch.draft, id).toBeUndefined();
      const map = gameData.maps[ch.mapId!]!;
      expect(map, id).toBeDefined();
      expect((map.events ?? []).length, id).toBeGreaterThanOrEqual(3);
      expect(map.width * map.height, id).toBeGreaterThanOrEqual(12 * 16);
      expect(map.width * map.height, id).toBeLessThanOrEqual(16 * 20);
      expect(map.width, id).toBeLessThan(map.height);
      expect(imageMeta(`backdrop.${map.backdrop}`), `${id} backdrop ${map.backdrop}`).toBeTruthy();
      const slots = map.placements.filter((p) => p.kind === 'mc' || p.kind === 'party').length;
      if (ch.deploy?.max !== undefined) expect(ch.deploy.max, id).toBeLessThanOrEqual(slots);
      const ids = new Set([...mapUnits(map).map((u) => u.id), 'mc', 'hask', 'lise', 'tobin', 'marra', 'gravemaw', 'needles']);
      for (const u of ch.plotCritical ?? []) expect(ids.has(u), `${id} plotCritical ${u}`).toBe(true);
      // Every enemy fights: an AI or a boss.
      for (const u of mapUnits(map)) if (u.team !== 'player') expect(u.ai !== undefined || u.isBoss, `${id} ${u.id}`).toBe(true);
    }
  });

  it('every scene exists, with known speakers whose portraits exist, and backdrops with art', () => {
    for (const id of [...STORY, 'chapter4']) {
      for (const sceneId of chapterScenes(id)) {
        const scene: SceneDef | undefined = scenes[sceneId];
        expect(scene, sceneId).toBeDefined();
        expect(scene!.draft, sceneId).toBeUndefined();
        if (scene!.backdrop) expect(imageMeta(`backdrop.${scene!.backdrop}`), `${sceneId} backdrop`).toBeTruthy();
        for (const n of scene!.lines) {
          if (!('speaker' in n)) continue;
          const sp = speakers[n.speaker];
          expect(sp, `${sceneId}: ${n.speaker}`).toBeDefined();
          if (sp!.portrait && sp!.portrait !== 'mc') expect(imageMeta(`portrait.${sp!.portrait}.neutral`), `${n.speaker}'s portrait`).toBeTruthy();
          // Plain punctuation: no em or en dashes in the script.
          expect(n.text, sceneId).not.toMatch(/[–—]/);
        }
      }
    }
  });

  it('rewards name the map, units that are on it, real items, and flags its events set', () => {
    for (const id of STORY) {
      const map = gameData.maps[id]!;
      const r = campContent.economy.rewards[id];
      expect(r, id).toBeDefined();
      expect(r!.gold).toBeGreaterThan(0);
      expect(r!.shards).toBeGreaterThanOrEqual(1);
      const units = new Set(mapUnits(map).map((u) => u.id));
      for (const d of r!.drops ?? []) {
        expect(units.has(d.unitId), `${id} drop from ${d.unitId}`).toBe(true);
        expect(gameData.items[d.item] ?? gameData.weapons[d.item], d.item).toBeDefined();
      }
      for (const b of r!.bonus ?? []) if (b.kind === 'flag') expect(eventFlags(map), `${id} bonus ${b.id}`).toContain(b.flag);
    }
  });

  it('names: the recruits and bearers carry their names.json names on the maps and in the speakers', () => {
    const byUnit: Record<string, string> = {
      hask: 'soldier_recruit',
      lise: 'ranger_recruit',
      tobin: 'adept_recruit',
      marra: 'medic_recruit',
      gravemaw: 'gravemaw_bearer',
      needles: 'needles_bearer',
    };
    const seen = new Set<string>();
    for (const id of STORY) {
      for (const u of mapUnits(gameData.maps[id]!)) {
        const key = byUnit[u.id];
        if (!key) continue;
        expect(u.name, u.id).toBe(worldNames[key]);
        seen.add(u.id);
        if (speakers[u.id]) expect(speakers[u.id]!.name).toBe(`{${key}}`);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(byUnit).sort());
    // The placeholder names the bearers had before are gone.
    for (const id of STORY) for (const u of mapUnits(gameData.maps[id]!)) expect(u.name).not.toMatch(/Bearer|Needles Thief/);
  });
});

/** A started battle on a chapter map. */
function battle(id: string, party?: PartyUnit[], seed = 3): BattleState {
  return startBattle(createBattle(gameData.maps[id]!, setup(party), seed, gameData), gameData).state;
}

function act(s: BattleState, a: Parameters<typeof applyAction>[1], data: GameData = gameData): BattleState {
  const why = validateAction(s, a, data);
  if (why) throw new Error(why);
  return applyAction(s, a, data).state;
}

/** Move a unit somewhere directly (test only), keeping everything else. */
function place(s: BattleState, unitId: string, x: number, y: number): BattleState {
  const next = structuredClone(s);
  next.units.find((u) => u.id === unitId)!.pos = { x, y };
  return next;
}

describe('chapter 1: the escape', () => {
  it('starts with the main character, Hask and Lise; Tobin and Marra wait in the fort as allies', () => {
    const s = battle('chapter1', chapterParty(1, 'vanguard', gameData));
    expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['mc', 'hask', 'lise']);
    expect(s.units.filter((u) => u.team === 'ally').map((u) => u.id)).toEqual(['tobin', 'marra']);
    expect(s.objective).toEqual({ type: 'escape', tiles: [{ x: 5, y: 0 }, { x: 6, y: 0 }] });
    expect(s.firedEvents).toEqual(['start']);
  });

  it('entering the fort grounds brings Tobin and Marra over, and they can act at once', () => {
    let s = battle('chapter1', chapterParty(1, 'vanguard', gameData));
    const to = moveTiles(s, 'mc', gameData).find((p) => p.x <= 3 && p.y >= 9 && p.y <= 13)!;
    expect(to).toBeDefined();
    const r = applyAction(s, { type: 'wait', unitId: 'mc', to }, gameData);
    expect(r.events).toContainEqual({ type: 'sceneRequested', sceneId: 'ch1_b_refugees', eventId: 'refugees' });
    s = r.state;
    for (const id of ['tobin', 'marra']) expect(s.units.find((u) => u.id === id)).toMatchObject({ team: 'player', acted: false });
    expect(s.recruited).toEqual(['tobin', 'marra']);
    expect(s.flags.ch1_refugees_joined).toBe(true);
  });

  it('if nobody goes to the fort, they come over on turn 3 anyway', () => {
    let s = battle('chapter1', chapterParty(1, 'vanguard', gameData));
    for (let i = 0; i < 4; i++) s = act(s, { type: 'endPhase' });
    while (s.phase !== 'player' || s.turn < 3) s = act(s, { type: 'endPhase' });
    expect(s.firedEvents).toContain('refugees_late');
    expect(s.units.find((u) => u.id === 'tobin')!.team).toBe('player');
  });

  it('the main character ending a move on the north road wins', () => {
    let s = place(battle('chapter1', chapterParty(1, 'vanguard', gameData)), 'mc', 6, 2);
    s = act(s, { type: 'wait', unitId: 'mc', to: { x: 6, y: 0 } });
    expect(s.result).toBe('victory');
  });
});

describe('chapter 2: Gravemaw\'s bearer', () => {
  const party = () => chapterParty(2, 'vanguard', gameData);

  it('Garrow starts on the enemy side in the keep; the main character can talk to him from beside him and he joins', () => {
    let s = battle('chapter2', party());
    expect(s.units.find((u) => u.id === 'gravemaw')).toMatchObject({ team: 'enemy', name: 'Garrow', weaponId: 'gravemaw' });
    s = place(s, 'mc', 6, 4);
    expect(talkTargets(s, 'mc', { x: 6, y: 3 }, gameData)).toEqual(['gravemaw']);
    // Only the main character can talk him round.
    expect(talkTargets(place(s, 'hask', 7, 4), 'hask', { x: 7, y: 3 }, gameData)).toEqual([]);
    const r = applyAction(s, { type: 'talk', unitId: 'mc', to: { x: 6, y: 3 }, targetId: 'gravemaw' }, gameData);
    expect(r.events).toContainEqual({ type: 'sceneRequested', sceneId: 'ch2_b_garrow_talk', eventId: 'garrow_talk' });
    expect(r.state.units.find((u) => u.id === 'gravemaw')).toMatchObject({ team: 'player', ai: null });
    expect(r.state.recruited).toEqual(['gravemaw']);
    expect(r.state.flags.garrow_joined).toBe(true);
    expect(talkTargets(r.state, 'mc', { x: 6, y: 3 }, gameData)).toEqual([]);
  });

  it('beaten below half his HP, he yields and joins instead', () => {
    let s = battle('chapter2', party());
    s = structuredClone(s);
    const g = s.units.find((u) => u.id === 'gravemaw')!;
    g.hp = Math.floor(g.stats.hp / 2);
    // At exactly half he holds on; one strike that lands puts him under it.
    s = place(s, 'hask', 6, 3);
    let r = applyAction(s, { type: 'attack', unitId: 'hask', to: { x: 6, y: 3 }, targetId: 'gravemaw' }, gameData);
    for (let seed = 4; !r.events.some((e) => e.type === 'eventFired' && e.eventId === 'garrow_yields') && seed < 40; seed++) {
      r = applyAction({ ...s, rng: seed }, { type: 'attack', unitId: 'hask', to: { x: 6, y: 3 }, targetId: 'gravemaw' }, gameData);
    }
    expect(r.events).toContainEqual({ type: 'sceneRequested', sceneId: 'ch2_b_garrow_yields', eventId: 'garrow_yields' });
    expect(r.state.units.find((u) => u.id === 'gravemaw')!.team).toBe('player');
  });

  it('cut down as an enemy, he is gone: garrow_slain is set and the outro changes', () => {
    let s = structuredClone(battle('chapter2', party()));
    s.units.find((u) => u.id === 'gravemaw')!.hp = 1;
    // Tobin's fire: arcane beats heavy.
    s = place(s, 'tobin', 6, 4);
    let r = applyAction(s, { type: 'attack', unitId: 'tobin', to: { x: 6, y: 4 }, targetId: 'gravemaw' }, gameData);
    for (let seed = 4; !r.state.flags.garrow_slain && seed < 40; seed++) {
      r = applyAction({ ...s, rng: seed }, { type: 'attack', unitId: 'tobin', to: { x: 6, y: 4 }, targetId: 'gravemaw' }, gameData);
    }
    expect(r.state.flags.garrow_slain).toBe(true);
    expect(r.state.firedEvents).not.toContain('garrow_yields');
    expect(r.events).toContainEqual({ type: 'sceneRequested', sceneId: 'ch2_b_garrow_slain', eventId: 'garrow_slain' });
    const outro = chapters.find((c) => c.id === 'chapter2')!.outro;
    expect(outro[0]).toMatchObject({ when: [{ type: 'flag', flag: 'garrow_slain' }], scenes: ['ch2_outro_slain'] });
  });
});

describe('chapter 3: the thief', () => {
  const party = () => chapterParty(3, 'vanguard', gameData);

  it('Pell drops in at the start of turn 2, on the player side, and can act that turn', () => {
    let s = battle('chapter3', party());
    expect(s.units.find((u) => u.id === 'needles')).toBeUndefined();
    s = act(s, { type: 'endPhase' });
    while (s.phase !== 'player') s = act(s, { type: 'endPhase' });
    expect(s.turn).toBe(2);
    expect(s.firedEvents).toContain('needles_joins');
    expect(s.units.find((u) => u.id === 'needles')).toMatchObject({ team: 'player', name: 'Pell', weaponId: 'thousand_needles', acted: false, pos: { x: 12, y: 12 } });
    expect(s.flags.pell_joined).toBe(true);
  });

  it('a unit standing on her tile does not stop her: she lands on the nearest free tile', () => {
    let s = place(battle('chapter3', party()), 'hask', 12, 12);
    s = act(s, { type: 'endPhase' });
    while (s.phase !== 'player') s = act(s, { type: 'endPhase' });
    const pell = s.units.find((u) => u.id === 'needles')!;
    expect(pell.team).toBe('player');
    expect(Math.abs(pell.pos.x - 12) + Math.abs(pell.pos.y - 12)).toBe(1);
  });

  it('defeating the Hunter-Captain wins', () => {
    let s = structuredClone(battle('chapter3', party()));
    expect(s.objective).toEqual({ type: 'defeatBoss' });
    s.units.find((u) => u.id === 'captain')!.hp = 1;
    s = place(s, 'gravemaw', 7, 3);
    let r = applyAction(s, { type: 'attack', unitId: 'gravemaw', to: { x: 7, y: 3 }, targetId: 'captain' }, gameData);
    for (let seed = 4; r.state.result !== 'victory' && seed < 40; seed++) {
      r = applyAction({ ...s, rng: seed }, { type: 'attack', unitId: 'gravemaw', to: { x: 7, y: 3 }, targetId: 'captain' }, gameData);
    }
    expect(r.state.result).toBe('victory');
  });
});

describe('the chapter flow from the prologue\'s camp to the camp after Chapter 3', () => {
  /** Win the current chapter's battle at once (its enemies removed) and play its outro scenes with these flags. */
  function winChapter(c: CampaignSave, flags: Record<string, boolean>, choice: Record<string, boolean> = {}): CampaignSave {
    const step = flowStep(c, chapters, gameData);
    if (step.kind !== 'battle') throw new Error(`Expected a battle, got ${step.kind}`);
    let s = createBattle(gameData.maps[step.mapId]!, { ...setup(c.party), flags: { ...c.flags } }, 5, gameData);
    s = structuredClone(s);
    for (const u of s.units) if (u.team === 'enemy') u.alive = false;
    Object.assign(s.flags, flags);
    // The recruits the battle's events would have brought over.
    const joined = step.mapId === 'chapter1' ? ['tobin', 'marra'] : step.mapId === 'chapter2' && flags.garrow_joined ? ['gravemaw'] : [];
    for (const id of joined) {
      const u = s.units.find((x) => x.id === id)!;
      Object.assign(u, { alive: true, team: 'player', ai: null });
      s.recruited.push(id);
    }
    s.result = 'victory';
    let next = settle(completeChapter(c, s, chapters, 10, campContent.economy), chapters, gameData, 10);
    while (next.progress.stage === 'outro' && next.progress.scenes?.length) {
      next = finishScene(next, next.progress.scenes[0]!, choice, chapters, gameData, 11);
    }
    return next;
  }

  /** Play the intro scenes of the current chapter. */
  function playIntro(c: CampaignSave): CampaignSave {
    let next = settle(c, chapters, gameData, 12);
    while (next.progress.stage === 'intro' && next.progress.scenes?.length) next = finishScene(next, next.progress.scenes[0]!, {}, chapters, gameData, 12);
    return next;
  }

  const start = (): CampaignSave => {
    const c = newCampaign({ settings: { permadeath: 'classic', difficulty: 'normal' }, mc: { name: 'Ash', pronouns: 'they', style: 'duelist' } }, chapters, 1);
    const mc: PartyUnit = { ...chapterParty(1, 'duelist', gameData)[0]! };
    return { ...c, party: [mc], blades: { widows_hush: { tier: 1 } }, progress: { current: 'chapter1', completed: ['prologue'], stage: 'camp', scenes: null } };
  };

  it('chapter 1 to the chapter 2 intro (no camp between), then camp after chapter 2, then camp after chapter 3', () => {
    let c = playIntro(leaveCamp(start(), 2));
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'battle', mapId: 'chapter1' });
    c = winChapter(c, { ch1_refugees_joined: true });
    // The four from Wrenfold and Cold Ferry carry on; the story goes straight on to chapter 2.
    expect(c.party.map((u) => u.id)).toEqual(['mc', 'hask', 'lise', 'tobin', 'marra']);
    expect(c.progress).toMatchObject({ current: 'chapter2', stage: 'intro', scenes: ['ch2_intro'] });
    c = playIntro(c);
    c = winChapter(c, { garrow_joined: true });
    expect(c.party.map((u) => u.id)).toContain('gravemaw');
    expect(c.blades.gravemaw).toEqual({ tier: 1 });
    expect(c.progress).toMatchObject({ current: 'chapter3', stage: 'camp', completed: ['prologue', 'chapter1', 'chapter2'] });
    c = playIntro(leaveCamp(c, 13));
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'battle', mapId: 'chapter3' });
    c = winChapter(c, { pell_joined: true }, { told_whispers: true });
    expect(c.flags.told_whispers).toBe(true);
    expect(c.progress).toMatchObject({ current: 'chapter4', stage: 'camp' });
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'camp', chapter: { id: 'chapter4' } });
  });

  it('with Garrow slain, chapter 2 ends on the other outro and nobody joins', () => {
    let c = playIntro(leaveCamp(start(), 2));
    c = winChapter(c, { ch1_refugees_joined: true });
    c = playIntro(c);
    const step = settle(completeChapter(c, (() => {
      const s = structuredClone(createBattle(gameData.maps.chapter2!, { ...setup(c.party), flags: {} }, 5, gameData));
      for (const u of s.units) if (u.team === 'enemy') u.alive = false;
      s.flags.garrow_slain = true;
      s.result = 'victory';
      return s;
    })(), chapters, 10), chapters, gameData, 10);
    expect(step.progress.scenes).toEqual(['ch2_outro_slain']);
    expect(step.party.map((u) => u.id)).not.toContain('gravemaw');
  });
});

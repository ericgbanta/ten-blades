// Checks for the story content: scenes, speakers, chapters and the scenes map events ask for. Returns a list of
// problems (empty when all is well). tests/story.test.ts runs it on the shipped data.

import type { GameData, McStyle } from '../core';
import { unknownTokens, type TextContext } from './text';
import { EXPRESSIONS, SCENE_FX, type ChapterDef, type SceneDef, type SceneNode, type SpeakerDef } from './types';

export interface StoryData {
  scenes: Readonly<Record<string, SceneDef>>;
  speakers: Readonly<Record<string, SpeakerDef>>;
  chapters: readonly ChapterDef[];
  names: Readonly<Record<string, string>>;
}

const STYLES: readonly McStyle[] = ['vanguard', 'duelist', 'spiritblade'];

/** The longest a line may be once tokens are filled in with a 16 character name: three lines of the box at 375 px. */
export const MAX_LINE_CHARS = 112;

/** A worst-case text context: the longest allowed name. Pronouns do not change lengths by much. */
const LONG: TextContext = { mcName: 'Wwwwwwwwwwwwwwww', pronouns: 'they', names: {} };

export function validateStory(story: StoryData, data: GameData, artIds: (id: string) => boolean): string[] {
  const errs: string[] = [];
  const text: TextContext = { ...LONG, names: story.names };

  for (const [id, sp] of Object.entries(story.speakers)) {
    if (typeof sp.name !== 'string') errs.push(`speaker ${id}: no name`);
    else for (const t of unknownTokens(sp.name, text)) errs.push(`speaker ${id}: unknown token ${t}`);
    if (sp.voice !== undefined && sp.voice !== 'narration' && sp.voice !== 'whisper') errs.push(`speaker ${id}: bad voice`);
    if (sp.voice !== undefined && sp.portrait !== null) errs.push(`speaker ${id}: a voice has no portrait`);
    if (sp.portrait && sp.portrait !== 'mc' && !artIds(`portrait.${sp.portrait}.neutral`)) errs.push(`speaker ${id}: no art portrait.${sp.portrait}.neutral`);
  }
  if (!story.speakers.mc || story.speakers.mc.portrait !== 'mc') errs.push('speakers: the main character (mc) must use the composed portrait');

  for (const [id, scene] of Object.entries(story.scenes)) errs.push(...checkScene(id, scene, story, text));

  const ids = new Set(story.chapters.map((c) => c.id));
  if (ids.size !== story.chapters.length) errs.push('chapters: duplicate id');
  for (const ch of story.chapters) {
    const where = `chapter ${ch.id}`;
    if (ch.mapId !== null && !data.maps[ch.mapId]) errs.push(`${where}: unknown map ${ch.mapId}`);
    if (ch.next !== null && !ids.has(ch.next)) errs.push(`${where}: unknown next chapter ${ch.next}`);
    for (const v of [...ch.intro, ...ch.outro]) {
      for (const s of v.scenes) {
        if (!story.scenes[s]) errs.push(`${where}: unknown scene ${s}`);
        else if (story.scenes[s]!.battle) errs.push(`${where}: ${s} is a mid-battle scene`);
      }
    }
    for (const a of ch.after) {
      for (const j of a.join ?? []) {
        const cls = data.classes[j.classId];
        if (!cls) errs.push(`${where}: joining ${j.id} has unknown class ${j.classId}`);
        if (j.weaponId && !data.weapons[j.weaponId]) errs.push(`${where}: joining ${j.id} has unknown weapon ${j.weaponId}`);
      }
      for (const [style, w] of Object.entries(a.mcWeapon ?? {})) {
        const weapon = data.weapons[w];
        const cls = data.classes[style];
        if (!STYLES.includes(style as McStyle) || !cls) errs.push(`${where}: mcWeapon for unknown style ${style}`);
        else if (!weapon) errs.push(`${where}: unknown weapon ${w}`);
        else if (!cls.weaponKinds.includes(weapon.kind)) errs.push(`${where}: a ${style} cannot use ${w}`);
      }
    }
  }
  // The chapter chain has no loop.
  for (const start of story.chapters) {
    const seen = new Set<string>();
    for (let c: ChapterDef | undefined = start; c; c = story.chapters.find((x) => x.id === c!.next)) {
      if (seen.has(c.id)) {
        errs.push(`chapters: ${start.id} leads round in a loop`);
        break;
      }
      seen.add(c.id);
      if (c.next === null) break;
    }
  }

  // Scenes the maps ask for: they exist and are mid-battle scenes.
  for (const m of Object.values(data.maps)) {
    for (const ev of m.events ?? []) {
      for (const fx of ev.effects) {
        if (fx.type !== 'scene') continue;
        const s = story.scenes[fx.sceneId];
        if (!s) errs.push(`map ${m.id}: event ${ev.id}: unknown scene ${fx.sceneId}`);
        else if (!s.battle) errs.push(`map ${m.id}: event ${ev.id}: ${fx.sceneId} is not marked "battle": true`);
      }
    }
  }
  return errs;
}

function checkScene(id: string, scene: SceneDef, story: StoryData, text: TextContext): string[] {
  const errs: string[] = [];
  const where = `scene ${id}`;
  if (scene.id !== id) errs.push(`${where}: id field is ${scene.id}`);
  if (!Array.isArray(scene.lines) || scene.lines.length === 0) {
    errs.push(`${where}: no lines`);
    return errs;
  }
  const labels = new Set<string>();
  for (const n of scene.lines) if ('label' in n) labels.add(n.label);
  const checkText = (t: string, label: string) => {
    for (const tok of unknownTokens(t, text)) errs.push(`${where}: ${label}: unknown token ${tok}`);
    if (t.trim() === '') errs.push(`${where}: ${label}: empty text`);
  };
  let spoken = 0;
  scene.lines.forEach((n: SceneNode, i) => {
    const at = `node ${i}`;
    if ('text' in n && 'speaker' in n) {
      spoken++;
      if (!story.speakers[n.speaker]) errs.push(`${where}: ${at}: unknown speaker ${n.speaker}`);
      if (n.expr !== undefined && !EXPRESSIONS.includes(n.expr)) errs.push(`${where}: ${at}: bad expression ${String(n.expr)}`);
      if (n.side !== undefined && n.side !== 'left' && n.side !== 'right') errs.push(`${where}: ${at}: bad side`);
      checkText(n.text, at);
      // Fill names in with the longest MC name to check the line fits three lines of the box.
      const filled = n.text.replace(/\{[^{}]+\}/g, (tok) => (tok === '{mc}' ? text.mcName : tok.includes('|') ? 'xxxxx' : (text.names[tok.slice(1, -1).toLowerCase()] ?? 'xxxxxxxx')));
      if (filled.length > MAX_LINE_CHARS) errs.push(`${where}: ${at}: line too long (${filled.length} characters, at most ${MAX_LINE_CHARS})`);
    } else if ('choice' in n) {
      if (scene.battle) errs.push(`${where}: ${at}: a mid-battle scene cannot have a choice`);
      if (n.choice.length < 2 || n.choice.length > 3) errs.push(`${where}: ${at}: a choice needs 2 or 3 answers`);
      n.choice.forEach((o, j) => {
        checkText(o.text, `${at} answer ${j}`);
        if (o.goto && !labels.has(o.goto)) errs.push(`${where}: ${at}: unknown label ${o.goto}`);
        for (const [k, v] of Object.entries(o.set ?? {})) {
          if (!/^[a-z][a-z0-9_]*$/.test(k)) errs.push(`${where}: ${at}: bad flag name ${k}`);
          if (!['boolean', 'number', 'string'].includes(typeof v)) errs.push(`${where}: ${at}: bad flag value for ${k}`);
        }
      });
    } else if ('fx' in n) {
      if (!SCENE_FX.includes(n.fx)) errs.push(`${where}: ${at}: unknown effect ${String(n.fx)}`);
    } else if ('enter' in n) {
      if (!story.speakers[n.enter]) errs.push(`${where}: ${at}: unknown speaker ${n.enter}`);
      if (n.side !== 'left' && n.side !== 'right') errs.push(`${where}: ${at}: enter needs a side`);
      if (n.expr !== undefined && !EXPRESSIONS.includes(n.expr)) errs.push(`${where}: ${at}: bad expression`);
    } else if ('leave' in n) {
      if (n.leave !== 'left' && n.leave !== 'right' && !story.speakers[n.leave]) errs.push(`${where}: ${at}: unknown speaker ${n.leave}`);
    } else if ('goto' in n) {
      if (!labels.has(n.goto)) errs.push(`${where}: ${at}: unknown label ${n.goto}`);
    } else if (!('label' in n) && !('backdrop' in n) && !('end' in n)) {
      errs.push(`${where}: ${at}: not a line, choice, effect, enter, leave, backdrop, label, goto or end`);
    }
  });
  if (spoken === 0) errs.push(`${where}: no spoken lines`);
  return errs;
}

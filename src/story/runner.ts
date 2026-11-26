// The scene runner: a pure state machine over a scene's nodes. It stops on lines and choices; everything in
// between (effects, portraits entering and leaving, backdrops, labels, jumps) is applied on the way. The UI
// shows `state.at` and calls advance or choose. Flags chosen in the scene collect in `set` and are applied by
// the caller once the scene finishes, so stopping halfway through applies nothing.

import { storyConditionsHold, type Flags, type StoryContext } from '../core';
import type { Expression, LineNode, SceneDef, SceneFx, SceneNode, Side, SpeakerDef } from './types';

/** Who stands in a portrait slot. */
export interface Slot {
  speaker: string;
  expr: Expression;
}

export interface LogEntry {
  speaker: string;
  text: string;
  /** True for the answer the player picked at a choice. */
  choice?: boolean;
}

export type SceneStop =
  | { kind: 'line'; index: number; line: LineNode }
  | { kind: 'choice'; index: number; options: { text: string }[] }
  | { kind: 'end' };

export interface SceneState {
  sceneId: string;
  at: SceneStop;
  left: Slot | null;
  right: Slot | null;
  /** The side of the current speaker, or null for narration and the blade's voice. */
  speaking: Side | null;
  backdrop: string | null;
  /** True after a fade out, until a fade in. */
  dark: boolean;
  /** Effects passed on the way to this stop, for the UI to play as it arrives. */
  fx: SceneFx[];
  /** Lines shown so far, and the answers picked. */
  log: LogEntry[];
  /** Flags set by the answers picked so far. */
  set: Flags;
  /** Index of the answer picked at each choice, in order. */
  choices: number[];
}

/** A scene runs at most this many nodes between two stops; more means a goto loop in the data. */
const MAX_STEPS = 1000;

export interface RunnerContext {
  story: StoryContext;
  speakers: Readonly<Record<string, SpeakerDef>>;
}

const isLine = (n: SceneNode): n is LineNode => 'text' in n && 'speaker' in n;

function labelIndex(scene: SceneDef, label: string): number {
  const i = scene.lines.findIndex((n) => 'label' in n && n.label === label);
  if (i < 0) throw new Error(`Scene ${scene.id}: no label ${label}`);
  return i;
}

function slotOf(st: SceneState, speaker: string): Side | null {
  if (st.left?.speaker === speaker) return 'left';
  if (st.right?.speaker === speaker) return 'right';
  return null;
}

/** Speakers with a voice (narration, the blade) take no slot. Unknown speakers do, and show a silhouette. */
function hasPortrait(speaker: string, ctx: RunnerContext): boolean {
  return ctx.speakers[speaker]?.voice === undefined;
}

/** Run from node `pc` to the next stop, applying everything on the way. */
function runFrom(scene: SceneDef, st: SceneState, pc: number, ctx: RunnerContext): SceneState {
  const s: SceneState = { ...st, fx: [] };
  const flags = { ...ctx.story.flags, ...s.set };
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const n = scene.lines[pc];
    if (!n) return { ...s, at: { kind: 'end' }, speaking: null };
    if (isLine(n)) {
      if (n.backdrop) s.backdrop = n.backdrop;
      if (hasPortrait(n.speaker, ctx)) {
        const side = n.side ?? slotOf(s, n.speaker) ?? (n.speaker === 'mc' ? 'left' : 'right');
        const prev = side === 'left' ? s.left : s.right;
        const expr = n.expr ?? (prev?.speaker === n.speaker ? prev.expr : 'neutral');
        // A speaker moving sides leaves their old slot.
        const old = slotOf(s, n.speaker);
        if (old && old !== side) s[old] = null;
        s[side] = { speaker: n.speaker, expr };
        s.speaking = side;
      } else {
        s.speaking = null;
      }
      s.log = [...s.log, { speaker: n.speaker, text: n.text }];
      return { ...s, at: { kind: 'line', index: pc, line: n } };
    }
    if ('choice' in n) return { ...s, at: { kind: 'choice', index: pc, options: n.choice.map((o) => ({ text: o.text })) }, speaking: null };
    if ('fx' in n) {
      s.fx = [...s.fx, n.fx];
      if (n.fx === 'fadeOut') s.dark = true;
      if (n.fx === 'fadeIn') s.dark = false;
    } else if ('enter' in n) {
      const old = slotOf(s, n.enter);
      if (old) s[old] = null;
      s[n.side] = { speaker: n.enter, expr: n.expr ?? 'neutral' };
    } else if ('leave' in n) {
      if (n.leave === 'left' || n.leave === 'right') s[n.leave] = null;
      else {
        const side = slotOf(s, n.leave);
        if (side) s[side] = null;
      }
    } else if ('backdrop' in n) {
      s.backdrop = n.backdrop;
    } else if ('goto' in n) {
      if (!n.if || storyConditionsHold(n.if, { ...ctx.story, flags })) {
        pc = labelIndex(scene, n.goto);
        continue;
      }
    } else if ('end' in n) {
      return { ...s, at: { kind: 'end' }, speaking: null };
    }
    // Labels need nothing.
    pc++;
  }
  throw new Error(`Scene ${scene.id}: too many steps without a line; check the gotos`);
}

/** A fresh run of the scene, stopped on its first line or choice. */
export function startScene(scene: SceneDef, ctx: RunnerContext): SceneState {
  const empty: SceneState = {
    sceneId: scene.id,
    at: { kind: 'end' },
    left: null,
    right: null,
    speaking: null,
    backdrop: scene.backdrop ?? null,
    dark: false,
    fx: [],
    log: [],
    set: {},
    choices: [],
  };
  return runFrom(scene, empty, 0, ctx);
}

/** Go on from the current line. Does nothing at a choice or at the end. */
export function advance(scene: SceneDef, st: SceneState, ctx: RunnerContext): SceneState {
  if (st.at.kind !== 'line') return st;
  return runFrom(scene, st, st.at.index + 1, ctx);
}

/** Pick answer `option` at the current choice. */
export function choose(scene: SceneDef, st: SceneState, option: number, ctx: RunnerContext): SceneState {
  if (st.at.kind !== 'choice') return st;
  const node = scene.lines[st.at.index] as Extract<SceneNode, { choice: unknown }>;
  const picked = node.choice[option];
  if (!picked) throw new Error(`Scene ${scene.id}: no answer ${option}`);
  const next: SceneState = {
    ...st,
    set: { ...st.set, ...(picked.set ?? {}) },
    choices: [...st.choices, option],
    log: [...st.log, { speaker: 'mc', text: picked.text, choice: true }],
  };
  return runFrom(scene, next, picked.goto ? labelIndex(scene, picked.goto) : st.at.index + 1, ctx);
}

/**
 * Skip: go on past every line to the next choice (which the player still makes) or the end. Effects passed on
 * the way are dropped, but fades still leave the screen as they would have.
 */
export function skipToChoice(scene: SceneDef, st: SceneState, ctx: RunnerContext): SceneState {
  let s = st;
  for (let i = 0; i < MAX_STEPS && s.at.kind === 'line'; i++) s = advance(scene, s, ctx);
  return { ...s, fx: [] };
}

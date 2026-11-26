// Story content types: dialogue scenes, speakers, chapters. The JSON lives in src/data (see docs/STORY.md).

import type { Flags, McStyle, StoryCondition } from '../core';
import type { CampDef, DeployRule } from '../camp/types';

export type Pronouns = 'he' | 'she' | 'they';
export const PRONOUNS: readonly Pronouns[] = ['he', 'she', 'they'];

export type Expression = 'neutral' | 'angry' | 'hurt' | 'smile';
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'angry', 'hurt', 'smile'];

export type Side = 'left' | 'right';

/** Screen effects a scene can play between lines. */
export type SceneFx = 'shake' | 'flash' | 'fadeOut' | 'fadeIn';
export const SCENE_FX: readonly SceneFx[] = ['shake', 'flash', 'fadeOut', 'fadeIn'];

/** One speaker (src/data/speakers.json). */
export interface SpeakerDef {
  /** Name on the name plate. May use text tokens ("{mc}"). Empty for no plate. */
  name: string;
  /** Portrait sheet: art ids `portrait.<sheet>.<expression>`. "mc" uses the composed main character. Null for none. */
  portrait: string | null;
  /** `narration` has no portrait and no plate; `whisper` is the blade's voice: no portrait, its own text style. */
  voice?: 'narration' | 'whisper';
}

/** A spoken or narrated line. */
export interface LineNode {
  speaker: string;
  text: string;
  expr?: Expression;
  /** Which portrait slot the speaker takes. Defaults to the slot they hold, else left for the MC, right for others. */
  side?: Side;
  /** Change the backdrop as this line shows. */
  backdrop?: string;
}

export interface FxNode {
  fx: SceneFx;
}

/** A speaker steps into a slot without speaking. */
export interface EnterNode {
  enter: string;
  side: Side;
  expr?: Expression;
}

/** A slot empties: give the side, or the speaker's id. */
export interface LeaveNode {
  leave: string;
}

export interface BackdropNode {
  backdrop: string;
}

export interface ChoiceOption {
  text: string;
  /** Flags this answer sets. Applied when the scene finishes. */
  set?: Flags;
  /** Label to jump to; otherwise the scene goes on after the choice. */
  goto?: string;
}

export interface ChoiceNode {
  /** Two or three answers. */
  choice: ChoiceOption[];
}

export interface LabelNode {
  label: string;
}

/** Jump to a label, always or when every condition holds. */
export interface GotoNode {
  goto: string;
  if?: StoryCondition[];
}

export interface EndNode {
  end: true;
}

export type SceneNode = LineNode | FxNode | EnterNode | LeaveNode | BackdropNode | ChoiceNode | LabelNode | GotoNode | EndNode;

/** A scene: src/data/dialogue/<id>.json. */
export interface SceneDef {
  id: string;
  /** First draft, to be rewritten. */
  draft?: boolean;
  /** Backdrop id (art id `backdrop.<id>`) behind a standalone scene. Mid-battle scenes show the map. */
  backdrop?: string;
  /** Plays over a battle. Such scenes have no choices, so they never change the battle state. */
  battle?: boolean;
  lines: SceneNode[];
}

/** Scenes to play, used when every condition holds. A chapter lists variants; the first that matches plays. */
export interface SceneVariant {
  scenes: string[];
  when?: StoryCondition[];
}

/** A unit that joins the party between chapters. Stats are the class average at its level. */
export interface JoinSpec {
  id: string;
  name: string;
  classId: string;
  level: number;
  weaponId?: string;
}

/** Changes to the party once a chapter's outro has played. Every entry whose conditions hold applies, in order. */
export interface ChapterAfter {
  when?: StoryCondition[];
  /** Unit ids that leave the party. */
  leave?: string[];
  join?: JoinSpec[];
  /** The main character's weapon from now on, by combat style. */
  mcWeapon?: Partial<Record<McStyle, string>>;
}

/** One chapter of the campaign script (src/data/chapters.json). */
export interface ChapterDef {
  id: string;
  /** Short name for menus ("Prologue", "Chapter 1"). */
  name: string;
  /** The chapter's title. */
  title: string;
  /** The battle map, or null while the chapter has no map yet (the story stops there: "To be continued"). */
  mapId: string | null;
  intro: SceneVariant[];
  outro: SceneVariant[];
  after: ChapterAfter[];
  /** The chapter that follows, or null at the end of the story so far. */
  next: string | null;
  draft?: boolean;
  /** The act the chapter belongs to (1, 2 or 3). Wounded bearers sit out the rest of their act. */
  act: number;
  /** After this chapter the army makes camp before the next one (docs/CAMP.md). */
  campAfter?: CampDef;
  /** Side skirmishes on the war map while this is the next chapter, and how many may be won here. */
  skirmishes?: { ids: string[]; cap: number };
  /** Who may deploy on this chapter's map. */
  deploy?: DeployRule;
  /** Bearers the plot still needs here: in Classic they retreat badly wounded instead of dying. */
  plotCritical?: string[];
}

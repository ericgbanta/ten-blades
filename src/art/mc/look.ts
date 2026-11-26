// The main character's look: which options exist (src/data/looks.json), checking a look, the palette it picks,
// and which packed layers draw it. Pure: no DOM, so the save validator and the tests use it as is.

import looksJson from '../../data/looks.json';

export interface LookOption {
  id: string;
  name: string;
}

export interface ColorOption extends LookOption {
  /** Flat color and its cel shadow, as #rrggbb. */
  base: string;
  shadow: string;
}

export interface McLook {
  body: string;
  skin: string;
  hairStyle: string;
  hairColor: string;
  eyes: string;
  /** A scar or marking id, or 'none'. */
  scar: string;
  accent: string;
}

export type McExpression = 'neutral' | 'angry' | 'hurt' | 'smile';
export type McPose = 'idle' | 'windup' | 'strike' | 'hit';

/** Recolor constants shared with tools/art/mc_build.py (see recolor.ts). */
export interface RecolorConstants {
  uMin: number;
  uMax: number;
  highlightSlope: number;
  filmShade: number;
}

export interface LooksData {
  bodies: LookOption[];
  skins: ColorOption[];
  hairColors: ColorOption[];
  accents: ColorOption[];
  hairStyles: LookOption[];
  eyes: LookOption[];
  scars: LookOption[];
  expressions: McExpression[];
  poses: McPose[];
  default: McLook;
  recolor: RecolorConstants;
}

export const LOOKS: LooksData = looksJson as LooksData;

/** The fields of a look, in the order the creator and the saves list them. */
export const LOOK_KEYS = ['body', 'skin', 'hairStyle', 'hairColor', 'eyes', 'scar', 'accent'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

const GROUP: Record<LookKey, 'bodies' | 'skins' | 'hairStyles' | 'hairColors' | 'eyes' | 'scars' | 'accents'> = {
  body: 'bodies',
  skin: 'skins',
  hairStyle: 'hairStyles',
  hairColor: 'hairColors',
  eyes: 'eyes',
  scar: 'scars',
  accent: 'accents',
};

/** Plain words for each field, for error messages. */
const FIELD_TEXT: Record<LookKey, string> = {
  body: 'body type',
  skin: 'skin tone',
  hairStyle: 'hair style',
  hairColor: 'hair color',
  eyes: 'eye shape',
  scar: 'scar or marking',
  accent: 'accent color',
};

/** The options for one field of the look. */
export function lookOptions(key: LookKey): readonly LookOption[] {
  return LOOKS[GROUP[key]];
}

export const MC_EXPRESSIONS: readonly McExpression[] = LOOKS.expressions;
export const MC_POSES: readonly McPose[] = LOOKS.poses;

export const DEFAULT_LOOK: McLook = Object.freeze({ ...LOOKS.default }) as McLook;

/**
 * What is wrong with a look, or null when it is a valid look: an object with exactly the look's fields, each one
 * of the ids in looks.json. The problem reads like "skin: unknown skin tone "green"".
 */
export function lookProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'expected an object';
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(LOOK_KEYS as readonly string[]).includes(k)) return `${k}: unknown field`;
  }
  for (const k of LOOK_KEYS) {
    const v = o[k];
    if (v === undefined) return `${k}: missing`;
    if (typeof v !== 'string') return `${k}: expected text`;
    if (!lookOptions(k).some((opt) => opt.id === v)) return `${k}: unknown ${FIELD_TEXT[k]} "${v}"`;
  }
  return null;
}

export function isLook(raw: unknown): raw is McLook {
  return lookProblem(raw) === null;
}

/** A stable text key for a look (cache keys). */
export function lookKey(look: McLook): string {
  return LOOK_KEYS.map((k) => look[k]).join('|');
}

/**
 * A random look. `next` returns a float in [0, 1) (the UI passes the seeded RNG from src/core/rng.ts), so a seed
 * always gives the same look. A scar is picked about half the time.
 */
export function randomLook(next: () => number): McLook {
  const pick = (key: LookKey): string => {
    const opts = lookOptions(key);
    return opts[Math.min(opts.length - 1, Math.floor(next() * opts.length))]!.id;
  };
  const look = {} as McLook;
  for (const k of LOOK_KEYS) look[k] = pick(k);
  if (next() < 0.5) look.scar = 'none';
  return look;
}

/** #rrggbb to [r, g, b] in 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb color: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

export interface LookPalette {
  skin: ColorOption;
  hair: ColorOption;
  accent: ColorOption;
}

/** The palette entries a look picks. Throws on an invalid look (check it first). */
export function paletteOf(look: McLook): LookPalette {
  const find = (list: readonly ColorOption[], id: string, what: string): ColorOption => {
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error(`Unknown ${what} ${id}`);
    return e;
  };
  return {
    skin: find(LOOKS.skins, look.skin, 'skin tone'),
    hair: find(LOOKS.hairColors, look.hairColor, 'hair color'),
    accent: find(LOOKS.accents, look.accent, 'accent color'),
  };
}

// ---- layer ids (see tools/art/mc_build.py and docs/ART_GENERATION.md) ---------------------------------------------

/** Layers of a portrait, bottom first: the bust, the face, the scar, the hair. */
export function portraitLayerIds(look: McLook, expr: McExpression): string[] {
  const b = look.body;
  const ids = [`mc.${b}.bust`, `mc.${b}.face.${look.eyes}.${expr}`];
  if (look.scar !== 'none') ids.push(`mc.${b}.scar.${look.scar}`);
  ids.push(`mc.${b}.hair.${look.hairStyle}.portrait`);
  return ids;
}

/** Layers of a map token: the bald chibi of the style, then its hair. */
export function tokenLayerIds(look: McLook, style: string): string[] {
  return [`mc.${look.body}.token.${style}`, `mc.${look.body}.hair.${look.hairStyle}.token.${style}`];
}

/** Layers of a battle pose: the bald body, then the hair placed on that pose's head. */
export function poseLayerIds(look: McLook, style: string, pose: McPose): string[] {
  return [`mc.${look.body}.pose.${style}.${pose}`, `mc.${look.body}.hair.${look.hairStyle}.pose.${style}.${pose}`];
}

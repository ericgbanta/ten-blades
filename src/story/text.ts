// Text tokens in dialogue: the main character's name and pronouns, and the world's names (src/data/names.json).
// Pure. The scheme (docs/STORY.md):
//
//   {mc}                         the main character's name
//   {they} {them} {their} {theirs} {themself}
//                                the MC's pronouns; a capital first letter ({They}) capitalizes the result
//   {is|are}                     two forms: the first for he and she, the second for they (verb agreement)
//   {his|her|their}              three forms: he, she, they
//   {empire}, {village}, ...     a name from names.json; {Empire} capitalizes it
//
// An unknown token is left as it is, so a typo shows on screen; tests/story.test.ts checks every scene for them.

import type { Pronouns } from './types';

export interface TextContext {
  mcName: string;
  pronouns: Pronouns;
  /** names.json */
  names: Readonly<Record<string, string>>;
}

const PRONOUN_FORMS: Record<string, Record<Pronouns, string>> = {
  they: { he: 'he', she: 'she', they: 'they' },
  them: { he: 'him', she: 'her', they: 'them' },
  their: { he: 'his', she: 'her', they: 'their' },
  theirs: { he: 'his', she: 'hers', they: 'theirs' },
  themself: { he: 'himself', she: 'herself', they: 'themself' },
};

const TOKEN = /\{([^{}]+)\}/g;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const isCapital = (s: string): boolean => s.charAt(0) !== s.charAt(0).toLowerCase();

/** The text for one token's inside, or null when it is not a known token. */
function resolveToken(inner: string, ctx: TextContext): string | null {
  if (inner.includes('|')) {
    const forms = inner.split('|');
    if (forms.length === 2) return ctx.pronouns === 'they' ? forms[1]! : forms[0]!;
    if (forms.length === 3) return forms[ctx.pronouns === 'he' ? 0 : ctx.pronouns === 'she' ? 1 : 2]!;
    return null;
  }
  if (inner === 'mc') return ctx.mcName;
  const lower = inner.charAt(0).toLowerCase() + inner.slice(1);
  const cap = isCapital(inner);
  const pronoun = PRONOUN_FORMS[lower];
  if (pronoun) return cap ? capitalize(pronoun[ctx.pronouns]) : pronoun[ctx.pronouns];
  const name = ctx.names[inner] ?? ctx.names[lower];
  if (name !== undefined) return cap ? capitalize(name) : name;
  return null;
}

/** Replace every known token in `text`. */
export function resolveText(text: string, ctx: TextContext): string {
  return text.replace(TOKEN, (whole, inner: string) => resolveToken(inner, ctx) ?? whole);
}

/** Tokens in `text` that do not resolve, for data checks. */
export function unknownTokens(text: string, ctx: TextContext): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (resolveToken(m[1]!, ctx) === null) out.push(m[0]);
  return out;
}

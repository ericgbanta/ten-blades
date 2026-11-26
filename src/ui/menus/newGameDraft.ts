// The new game flow's state: what the player has chosen so far, which steps there are, and the small rules
// between them. No DOM, so tests/new-game.test.ts runs it under Vitest.

import { createRng, nextFloat } from '../../core/rng';
import { DEFAULT_LOOK, MC_EXPRESSIONS, randomLook, type McExpression, type McLook } from '../../art/mc/look';
import { MC_NAME_MAX, type CampaignSettings, type McProfile, type SlotId } from '../../save/format';
import { checkName } from '../../save/validate';
import { ShapeError } from '../../save/shape';

export interface NewGameDraft {
  slot: SlotId | null;
  settings: CampaignSettings;
  mc: McProfile;
}

export const DEFAULT_DRAFT: NewGameDraft = {
  slot: null,
  settings: { permadeath: 'classic', difficulty: 'normal' },
  mc: { name: '', pronouns: 'they', style: 'vanguard', look: { ...DEFAULT_LOOK } },
};

export type StepId = 'slot' | 'mode' | 'hero' | 'look';

export interface StepInfo {
  id: StepId;
  title: string;
  /** Label of the button that leaves this step. Null when the step moves on by itself. */
  nextLabel: string | null;
}

/** The steps in order: pick a slot, the modes, name the hero, then make their look and begin. */
export const STEP_INFO: readonly StepInfo[] = [
  { id: 'slot', title: 'Choose a slot', nextLabel: null },
  { id: 'mode', title: 'Your path', nextLabel: 'Next' },
  { id: 'hero', title: 'Your hero', nextLabel: 'Next' },
  { id: 'look', title: 'Your look', nextLabel: 'Begin' },
];

/** Why a step cannot move on yet, or null. */
export function stepProblem(step: StepId, d: NewGameDraft): string | null {
  if (step === 'hero') {
    try {
      checkName(d.mc.name, '');
    } catch (e) {
      if (e instanceof ShapeError) return `Give your hero a name (up to ${MC_NAME_MAX} characters).`;
      throw e;
    }
  }
  return null;
}

export function withMc(d: NewGameDraft, patch: Partial<McProfile>): NewGameDraft {
  return { ...d, mc: { ...d.mc, ...patch } };
}

export function withLook(d: NewGameDraft, patch: Partial<McLook>): NewGameDraft {
  return withMc(d, { look: { ...d.mc.look, ...patch } });
}

/** A new random look from a seed (the UI passes the clock); the name, pronouns and style stay. */
export function randomized(d: NewGameDraft, seed: number): NewGameDraft {
  let s = createRng(seed);
  const next = () => {
    const [v, n] = nextFloat(s);
    s = n;
    return v;
  };
  return withMc(d, { look: randomLook(next) });
}

/** The expression after `e`, for tapping the preview portrait. */
export function nextExpression(e: McExpression): McExpression {
  return MC_EXPRESSIONS[(MC_EXPRESSIONS.indexOf(e) + 1) % MC_EXPRESSIONS.length]!;
}

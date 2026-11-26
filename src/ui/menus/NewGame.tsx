// The new game flow: pick a slot, pick the modes, make the main character, begin.
// Steps are a list so phase 4 can add the look creator as its own step (or grow
// HeroStep) without touching the others.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { chapters } from '../../data';
import { newCampaign } from '../../save/campaign';
import {
  DIFFICULTIES,
  MC_NAME_MAX,
  MC_STYLES,
  PERMADEATH_MODES,
  PRONOUNS,
  type CampaignSettings,
  type McProfile,
  type SlotId,
} from '../../save/format';
import { checkName } from '../../save/validate';
import { ShapeError } from '../../save/shape';
import { now, startRun, writes } from '../saves';
import { Choices, Confirm, Screen, SlotCard, goTo, useSaves, type SavesView } from './Screen';
import { DIFFICULTY_TEXT, PERMADEATH_TEXT, PRONOUN_TEXT, STYLE_TEXT, styleSchool } from './copy';

export interface NewGameDraft {
  slot: SlotId | null;
  settings: CampaignSettings;
  mc: McProfile;
}

const DEFAULT_DRAFT: NewGameDraft = {
  slot: null,
  settings: { permadeath: 'classic', difficulty: 'normal' },
  mc: { name: '', pronouns: 'they', style: 'vanguard' },
};

interface StepProps {
  draft: NewGameDraft;
  saves: SavesView;
  update: (patch: Partial<NewGameDraft>) => void;
  next: () => void;
}

interface Step {
  id: string;
  title: string;
  /** Label of the button that leaves this step. Null when the step moves on by itself. */
  nextLabel: string | null;
  /** Why the step cannot move on yet, or null. */
  blocked?: (d: NewGameDraft) => string | null;
  View: (p: StepProps) => JSX.Element;
}

function nameProblem(d: NewGameDraft): string | null {
  try {
    checkName(d.mc.name, '');
    return null;
  } catch (e) {
    if (e instanceof ShapeError) return `Give your hero a name (up to ${MC_NAME_MAX} characters).`;
    throw e;
  }
}

export const NEW_GAME_STEPS: readonly Step[] = [
  { id: 'slot', title: 'Choose a slot', nextLabel: null, View: SlotStep },
  { id: 'mode', title: 'Your path', nextLabel: 'Next', View: ModeStep },
  { id: 'hero', title: 'Your hero', nextLabel: 'Begin', blocked: nameProblem, View: HeroStep },
];

export function NewGame() {
  const { saves } = useSaves();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<NewGameDraft>(DEFAULT_DRAFT);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const step = NEW_GAME_STEPS[index]!;
  const update = (patch: Partial<NewGameDraft>) => {
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const begin = async () => {
    if (!saves || draft.slot === null) return;
    const slot = draft.slot;
    const campaign = newCampaign({ settings: draft.settings, mc: draft.mc }, chapters, now());
    await writes.idle();
    await saves.store.saveSlot(slot, campaign);
    await saves.store.clearSuspend();
    startRun({ slot, campaign, resume: null });
  };

  const next = () => {
    const why = step.blocked?.(draft) ?? null;
    if (why) {
      setProblem(why);
      return;
    }
    if (index < NEW_GAME_STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (saves?.suspend) setConfirmSuspend(true);
    else void begin();
  };

  const back = index === 0 ? goTo('#/') : () => setIndex(index - 1);
  return (
    <Screen title={step.title} back={back} backLabel={index === 0 ? 'Title' : 'Back'}>
      <p class="menu-steps" aria-label={`Step ${index + 1} of ${NEW_GAME_STEPS.length}`}>
        {NEW_GAME_STEPS.map((s, i) => (
          <span key={s.id} class={`menu-step${i === index ? ' on' : ''}${i < index ? ' done' : ''}`} />
        ))}
      </p>
      {saves ? <step.View draft={draft} saves={saves} update={update} next={next} /> : <p class="muted">Reading saves...</p>}
      {problem && (
        <p class="menu-error" role="alert">
          {problem}
        </p>
      )}
      {step.nextLabel && (
        <div class="menu-foot">
          <button type="button" class="btn primary wide" onClick={next}>
            {step.nextLabel}
          </button>
        </div>
      )}
      {confirmSuspend && (
        <Confirm
          text="Starting a new game ends your suspended battle."
          detail="The battle you left will be gone. Your other slots are not touched."
          yes="Begin"
          danger
          onYes={() => {
            setConfirmSuspend(false);
            void begin();
          }}
          onNo={() => setConfirmSuspend(false)}
        />
      )}
    </Screen>
  );
}

function SlotStep({ saves, update, next }: StepProps) {
  const [asking, setAsking] = useState<SlotId | null>(null);
  const pick = (slot: SlotId) => {
    update({ slot });
    next();
  };
  const taken = asking === null ? null : saves.slots.find((s) => s.slot === asking);
  return (
    <>
      <p class="menu-lead">Your campaign is saved here after every chapter.</p>
      <div class="slot-list">
        {saves.slots.map((info) => (
          <SlotCard
            key={info.slot}
            info={info}
            suspended={saves.suspend?.slot === info.slot}
            action={info.save || info.error ? 'Overwrite' : 'Start here'}
            onTap={() => (info.save || info.error ? setAsking(info.slot) : pick(info.slot))}
          />
        ))}
      </div>
      {taken && asking !== null && (
        <Confirm
          text={`Overwrite slot ${asking}?`}
          detail={`${taken.save ? `${taken.save.mc.name}'s campaign` : 'The save'} in this slot will be erased when you begin.`}
          yes="Overwrite"
          danger
          onYes={() => {
            setAsking(null);
            pick(asking);
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </>
  );
}

function ModeStep({ draft, update }: StepProps) {
  const set = (patch: Partial<CampaignSettings>) => update({ settings: { ...draft.settings, ...patch } });
  return (
    <>
      <Choices
        label="Permadeath"
        value={draft.settings.permadeath}
        options={PERMADEATH_MODES.map((m) => ({ value: m, name: PERMADEATH_TEXT[m].name, line: PERMADEATH_TEXT[m].line }))}
        onChange={(permadeath) => set({ permadeath })}
      />
      <Choices
        label="Difficulty"
        value={draft.settings.difficulty}
        options={DIFFICULTIES.map((d) => ({ value: d, name: DIFFICULTY_TEXT[d].name, line: DIFFICULTY_TEXT[d].line }))}
        onChange={(difficulty) => set({ difficulty })}
      />
      <p class="menu-note">Both are fixed for this campaign.</p>
    </>
  );
}

/** Name, pronouns and combat style. Phase 4 adds the look (body, skin, hair, face, marking, accent). */
function HeroStep({ draft, update }: StepProps) {
  const set = (patch: Partial<McProfile>) => update({ mc: { ...draft.mc, ...patch } });
  return (
    <>
      <label class="field">
        <span class="field-label">Name</span>
        <input
          class="field-input"
          type="text"
          value={draft.mc.name}
          maxLength={MC_NAME_MAX * 2}
          autocomplete="off"
          autocapitalize="words"
          spellcheck={false}
          placeholder="Your name"
          onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <Choices
        label="How the story speaks of you"
        compact
        value={draft.mc.pronouns}
        options={PRONOUNS.map((p) => ({ value: p, name: PRONOUN_TEXT[p] }))}
        onChange={(pronouns) => set({ pronouns })}
      />
      <Choices
        label="Combat style"
        value={draft.mc.style}
        options={MC_STYLES.map((s) => ({ value: s, name: STYLE_TEXT[s].name, tag: styleSchool(s), line: STYLE_TEXT[s].feel }))}
        onChange={(style) => set({ style })}
      />
    </>
  );
}

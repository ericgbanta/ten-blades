// The new game flow: pick a slot, pick the modes, name the main character, then
// make their look and combat style in the creator, and begin. The state and the
// step rules are in newGameDraft.ts; the creator is Creator.tsx.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { chapters } from '../../data';
import { newCampaign } from '../../save/campaign';
import { DIFFICULTIES, MC_NAME_MAX, PERMADEATH_MODES, PRONOUNS, type CampaignSettings, type McProfile, type SlotId } from '../../save/format';
import { now, startRun, writes } from '../saves';
import { Choices, Confirm, Screen, SlotCard, goTo, useSaves, type SavesView } from './Screen';
import { DIFFICULTY_TEXT, PERMADEATH_TEXT, PRONOUN_TEXT } from './copy';
import { Creator } from './Creator';
import { DEFAULT_DRAFT, STEP_INFO, stepProblem, withMc, type NewGameDraft, type StepId } from './newGameDraft';

export type { NewGameDraft };

interface StepProps {
  draft: NewGameDraft;
  saves: SavesView;
  update: (patch: Partial<NewGameDraft>) => void;
  set: (next: (d: NewGameDraft) => NewGameDraft) => void;
  next: () => void;
}

const VIEWS: Record<StepId, (p: StepProps) => JSX.Element> = {
  slot: SlotStep,
  mode: ModeStep,
  hero: HeroStep,
  look: ({ draft, set }) => <Creator draft={draft} set={set} />,
};

export function NewGame() {
  const { saves } = useSaves();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<NewGameDraft>(DEFAULT_DRAFT);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const step = STEP_INFO[index]!;
  const View = VIEWS[step.id];
  const set = (f: (d: NewGameDraft) => NewGameDraft) => {
    setProblem(null);
    setDraft(f);
  };
  const update = (patch: Partial<NewGameDraft>) => set((d) => ({ ...d, ...patch }));

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
    const why = stepProblem(step.id, draft);
    if (why) {
      setProblem(why);
      return;
    }
    if (index < STEP_INFO.length - 1) {
      setIndex(index + 1);
      return;
    }
    if (saves?.suspend) setConfirmSuspend(true);
    else void begin();
  };

  const back = index === 0 ? goTo('#/') : () => setIndex(index - 1);
  return (
    <Screen title={step.title} back={back} backLabel={index === 0 ? 'Title' : 'Back'} wide={step.id === 'look'}>
      <p class="menu-steps" aria-label={`Step ${index + 1} of ${STEP_INFO.length}`}>
        {STEP_INFO.map((s, i) => (
          <span key={s.id} class={`menu-step${i === index ? ' on' : ''}${i < index ? ' done' : ''}`} />
        ))}
      </p>
      {saves ? <View draft={draft} saves={saves} update={update} set={set} next={next} /> : <p class="muted">Reading saves...</p>}
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

/** Name and pronouns. The look and the combat style come next, in the creator. */
function HeroStep({ draft, set }: StepProps) {
  const setMc = (patch: Partial<McProfile>) => set((d) => withMc(d, patch));
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
          onInput={(e) => setMc({ name: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <Choices
        label="How the story speaks of you"
        compact
        value={draft.mc.pronouns}
        options={PRONOUNS.map((p) => ({ value: p, name: PRONOUN_TEXT[p] }))}
        onChange={(pronouns) => setMc({ pronouns })}
      />
      <p class="menu-note">Next you choose how your hero looks and fights.</p>
    </>
  );
}

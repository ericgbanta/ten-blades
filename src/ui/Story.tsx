// The story route: plays the campaign's intro or outro scenes one after another, saving after each, then hands
// on to the battle, the next scene or the Chapter complete screen (src/story/flow.ts decides which).

import { useEffect, useMemo, useState } from 'preact/hooks';
import { chapters, gameData } from '../data';
import { scenes, speakers, worldNames } from '../data/story';
import { finishScene, flowStep, storyContextOf } from '../story/flow';
import { Dialogue, type SceneResult } from './dialogue/Dialogue';
import { finishRun, now, saveCampaign, startRun, takeRun, type CampaignRun } from './saves';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Story() {
  const run = useMemo(() => takeRun(), []);
  useEffect(() => {
    if (!run) window.location.replace('#/');
  }, [run]);
  return run ? <StoryRun run={run} /> : null;
}

function StoryRun({ run }: { run: CampaignRun }) {
  const [campaign, setCampaign] = useState(run.campaign);
  const step = flowStep(campaign, chapters, gameData);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    // Nothing to play here (a stale run): hand back to the flow.
    if (step.kind !== 'scene') startRun({ slot: run.slot, campaign, resume: null });
  }, [step.kind]);

  if (step.kind !== 'scene') return null;
  const scene = scenes[step.sceneId];
  const remaining = campaign.progress.scenes?.length ?? 0;

  const onDone = (r: SceneResult) => {
    const next = finishScene(campaign, step.sceneId, r.set, chapters, gameData, now());
    saveCampaign(run.slot, next);
    const after = flowStep(next, chapters, gameData);
    if (after.kind === 'scene') setCampaign(next);
    else if (after.kind === 'battle' || after.kind === 'camp') startRun({ slot: run.slot, campaign: next, resume: null });
    else {
      finishRun(run.slot, next, step.chapter.name);
      window.location.hash = '#/complete';
    }
  };

  if (!scene) {
    // A missing scene must not trap the player: count it as played.
    console.warn(`Missing scene ${step.sceneId}`);
    queueMicrotask(() => onDone({ set: {}, choices: [] }));
    return null;
  }
  return (
    <Dialogue
      key={`${step.sceneId}#${remaining}`}
      scene={scene}
      text={{ mcName: campaign.mc.name, pronouns: campaign.mc.pronouns, names: worldNames }}
      story={storyContextOf(campaign)}
      speakers={speakers}
      look={campaign.mc.look}
      reducedMotion={reduced}
      onDone={onDone}
    />
  );
}

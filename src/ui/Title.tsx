import { chapters, gameData } from '../data';
import { canPlay } from '../story/flow';
import { startRun } from './saves';
import { useSaves } from './menus/Screen';
import { chapterName, STAGE_TEXT } from './menus/copy';
import { Divider } from './kit';
import './menus/menus.css';

export function Title() {
  const { saves } = useSaves();
  const suspend = saves?.suspend ?? null;
  // Without a suspended battle, Continue picks up the campaign played last, if it has a scene or battle to play.
  const latest = suspend
    ? null
    : (saves?.slots
        .filter((s) => s.save && canPlay(s.save, chapters, gameData))
        .sort((a, b) => b.save!.updatedAt - a.save!.updatedAt)[0] ?? null);
  return (
    <main class="title home">
      <div class="title-logo">
        <div class="title-emblem" aria-hidden="true" />
        <h1>Ten Blades</h1>
        <Divider class="title-divider" />
        <p class="tagline">Ten blades. One empire to break.</p>
      </div>
      {/* Shown once the saves are read, so Continue does not push the menu down. */}
      <nav class="title-menu" aria-label="Main menu" style={saves ? undefined : { visibility: 'hidden' }}>
        {latest?.save && (
          <button type="button" class="btn primary" onClick={() => startRun({ slot: latest.slot, campaign: latest.save!, resume: null })}>
            Continue
            <span class="btn-sub">
              {latest.save.mc.name} · {chapterName(latest.save.progress.current)} · {STAGE_TEXT[latest.save.progress.stage]}
            </span>
          </button>
        )}
        {suspend && (
          <button
            type="button"
            class="btn primary"
            onClick={() => startRun({ slot: suspend.slot, campaign: suspend.campaign, resume: suspend })}
          >
            Continue
            <span class="btn-sub">
              {suspend.campaign.mc.name} · {chapterName(suspend.campaign.progress.current)} · Turn {suspend.battle.turn}
            </span>
          </button>
        )}
        <a class={`btn${suspend || latest ? '' : ' primary'}`} href="#/new">
          New game
        </a>
        <a class="btn" href="#/load">
          Load game
        </a>
        <a class="btn quiet" href="#/settings">
          Settings
        </a>
      </nav>
      {saves?.suspendError && <p class="title-note">{saves.suspendError}</p>}
    </main>
  );
}

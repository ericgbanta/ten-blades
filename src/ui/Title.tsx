import { startRun } from './saves';
import { useSaves } from './menus/Screen';
import { chapterName } from './menus/copy';
import './menus/menus.css';

export function Title() {
  const { saves } = useSaves();
  const suspend = saves?.suspend ?? null;
  return (
    <main class="title">
      <h1>Ten Blades</h1>
      <p class="tagline">Ten blades. One empire to break.</p>
      {/* Shown once the saves are read, so Continue does not push the menu down. */}
      <nav class="title-menu" aria-label="Main menu" style={saves ? undefined : { visibility: 'hidden' }}>
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
        <a class={`btn${suspend ? '' : ' primary'}`} href="#/new">
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

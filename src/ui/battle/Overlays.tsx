// Full-screen or centered overlays: phase banner, level-up popup, confirm
// dialog and the end of battle screen.

import type { BattleState, BattleSummary, Team } from '../../core';
import { STAT_KEYS } from '../../core';
import type { LevelUpPopup } from '../../battle/controller';
import { PHASE_LABEL, STAT_LABEL } from './text';

export function PhaseBanner({ phase, turn }: { phase: Team; turn: number }) {
  return (
    <div class={`phase-banner phase-${phase}`} role="status">
      <span class="phase-turn">Turn {turn}</span>
      <span class="phase-name">{PHASE_LABEL[phase]}</span>
    </div>
  );
}

export function LevelUp({ popup, onClose }: { popup: LevelUpPopup; onClose: () => void }) {
  const gains = STAT_KEYS.filter((k) => popup.gains[k] > 0);
  return (
    <button type="button" class="levelup" onClick={onClose} aria-label="Level up, tap to close">
      <span class="levelup-title">Level up</span>
      <span class="levelup-who">
        {popup.name} reached level {popup.level}
      </span>
      <span class="levelup-gains">
        {gains.length === 0 ? (
          <span class="muted">No stats rose this time.</span>
        ) : (
          gains.map((k) => (
            <span key={k} class="gain">
              {STAT_LABEL[k]} +{popup.gains[k]}
            </span>
          ))
        )}
      </span>
    </button>
  );
}

export function ConfirmDialog(props: { text: string; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  return (
    <div class="scrim" role="dialog" aria-modal="true" aria-label={props.text}>
      <div class="dialog">
        <p>{props.text}</p>
        <div class="btn-row">
          <button type="button" class="btn quiet" onClick={props.onNo}>
            {props.no}
          </button>
          <button type="button" class="btn primary" onClick={props.onYes}>
            {props.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface EndButton {
  label: string;
  onTap: () => void;
  primary?: boolean;
}

export function EndScreen(props: { summary: BattleSummary; state: BattleState; note?: string; buttons: EndButton[] }) {
  const { summary, state } = props;
  const won = summary.result === 'victory';
  const fallen = summary.fallenPlayerUnitIds.map((id) => state.units.find((u) => u.id === id)?.name ?? id);
  return (
    <div class={`end-screen ${won ? 'won' : 'lost'}`} role="dialog" aria-modal="true" aria-labelledby="end-title">
      <h2 id="end-title">{won ? 'Victory' : 'Defeat'}</h2>
      <p class="end-sub">{props.note ?? (won ? 'The field is yours.' : 'The battle is lost.')}</p>
      <dl class="end-stats">
        <div>
          <dt>Turns</dt>
          <dd>{summary.turns}</dd>
        </div>
        <div>
          <dt>Fallen</dt>
          <dd>{fallen.length === 0 ? 'None' : fallen.join(', ')}</dd>
        </div>
      </dl>
      <div class="btn-col">
        {props.buttons.map((b) => (
          <button key={b.label} type="button" class={`btn${b.primary ? ' primary' : ''}`} onClick={b.onTap}>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

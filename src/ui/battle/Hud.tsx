// The top bar (turn, phase, objective, speed, quit) and the bottom bar
// (terrain line, danger zone toggle, End turn).

import { livingUnits, terrainAt, type GameData } from '../../core';
import type { BattleView, Speed } from '../../battle/controller';
import { PHASE_LABEL, objectiveText, signed } from './text';

export function TopBar(props: { view: BattleView; onSpeed: (s: Speed) => void; onQuit: () => void }) {
  const { state, speed } = props.view;
  const left = livingUnits(state, 'enemy').length;
  return (
    <div class="hud-row">
      <button type="button" class="btn small quiet" onClick={props.onQuit}>
        Quit
      </button>
      <div class="hud-status">
        <p class="hud-turn">
          Turn {state.turn} <span class={`chip phase-${state.phase}`}>{PHASE_LABEL[state.phase]}</span>
        </p>
        <p class="hud-objective" data-testid="objective">
          {objectiveText(state.objective, state)} · {left} {left === 1 ? 'enemy' : 'enemies'} left
        </p>
      </div>
      <button
        type="button"
        class="btn small quiet"
        aria-label={`Animation speed: ${speed}`}
        onClick={() => props.onSpeed(speed === 'normal' ? 'fast' : 'normal')}
      >
        {speed === 'normal' ? 'Speed 1x' : 'Speed 2x'}
      </button>
    </div>
  );
}

export function BottomBar(props: { view: BattleView; data: GameData; onDanger: () => void; onEndTurn: () => void }) {
  const { view, data } = props;
  const { state, tile, busy, showDanger } = view;
  let info: string;
  if (busy) info = state.phase === 'player' ? 'Tap the map to skip' : 'Enemy moves. Tap to skip';
  else if (tile) {
    const t = terrainAt(state, tile, data);
    const bits = [t.name];
    if (t.def) bits.push(`Def ${signed(t.def)}`);
    if (t.res) bits.push(`Res ${signed(t.res)}`);
    if (t.avoid) bits.push(`Avoid ${signed(t.avoid)}`);
    if (t.healPercent) bits.push(`Heals ${t.healPercent}%`);
    if (bits.length === 1) bits.push('No bonus');
    info = bits.join(' · ');
  } else info = 'Tap a unit to begin';
  const canEnd = !busy && state.phase === 'player' && state.result === 'ongoing';
  return (
    <div class="hud-row bottom">
      <p class="tile-info" data-testid="tile-info">
        {info}
      </p>
      <button type="button" class={`btn small ${showDanger ? 'on' : 'quiet'}`} aria-pressed={showDanger} onClick={props.onDanger}>
        Danger
      </button>
      <button type="button" class="btn small primary" disabled={!canEnd} onClick={props.onEndTurn}>
        End turn
      </button>
    </div>
  );
}

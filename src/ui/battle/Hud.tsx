// The top bar (turn, phase, objective, speed, quit) and the bottom bar
// (terrain line, danger zone toggle, End turn).

import type { JSX } from 'preact';
import { livingUnits, terrainAt, type GameData, type Objective } from '../../core';
import type { BattleView, SceneMode, Speed } from '../../battle/controller';
import { Icon, type IconName } from '../kit';
import { PHASE_LABEL, objectiveText, signed } from './text';

const OBJECTIVE_ICON: Record<Objective['type'], IconName> = {
  rout: 'tenblade',
  defeatBoss: 'tenblade',
  survive: 'def',
  protect: 'def',
  escape: 'mov',
};

const NEXT_SCENE: Record<SceneMode, SceneMode> = { full: 'fast', fast: 'off', off: 'full' };
const SCENE_LABEL: Record<SceneMode, string> = { full: 'Full', fast: 'Fast', off: 'Off' };

export function TopBar(props: { view: BattleView; onSpeed: (s: Speed) => void; onScenes: (m: SceneMode) => void; onQuit: () => void }) {
  const { state, speed, sceneMode } = props.view;
  const left = livingUnits(state, 'enemy').length;
  return (
    <div class="hud-row top">
      <button type="button" class="btn small quiet" onClick={props.onQuit}>
        Quit
      </button>
      <div class="hud-status">
        <p class="hud-turn">
          <span class="hud-turn-n">
            Turn <span class="num">{state.turn}</span>
          </span>
          <span class={`phase-tag phase-${state.phase}`}>{PHASE_LABEL[state.phase]}</span>
        </p>
        <p class="hud-objective" data-testid="objective">
          <Icon name={OBJECTIVE_ICON[state.objective.type]} size={16} />
          <span class="hud-objective-text">
            {objectiveText(state.objective, state)} · {left} {left === 1 ? 'enemy' : 'enemies'} left
          </span>
        </p>
      </div>
      <button
        type="button"
        class="btn small quiet speed"
        aria-label={`Animation speed: ${speed}`}
        onClick={() => props.onSpeed(speed === 'normal' ? 'fast' : 'normal')}
      >
        <span class="speed-k">Speed</span>
        <span class="speed-v num">{speed === 'normal' ? '1x' : '2x'}</span>
      </button>
      <button
        type="button"
        class="btn small quiet speed scenes"
        aria-label={`Battle scenes: ${SCENE_LABEL[sceneMode]}`}
        data-testid="scenes-toggle"
        onClick={() => props.onScenes(NEXT_SCENE[sceneMode])}
      >
        <span class="speed-k">Scenes</span>
        <span class="speed-v">{SCENE_LABEL[sceneMode]}</span>
      </button>
    </div>
  );
}

function TileInfo({ view, data }: { view: BattleView; data: GameData }): JSX.Element {
  const { state, tile, busy } = view;
  if (busy) return <>{state.phase === 'player' ? 'Tap the map to skip' : 'Enemy moves. Tap to skip'}</>;
  if (!tile) return <>Tap a unit to begin</>;
  const t = terrainAt(state, tile, data);
  const bits: { icon: IconName; text: string }[] = [];
  if (t.def) bits.push({ icon: 'def', text: `Def ${signed(t.def)}` });
  if (t.res) bits.push({ icon: 'res', text: `Res ${signed(t.res)}` });
  if (t.avoid) bits.push({ icon: 'spd', text: `Avoid ${signed(t.avoid)}` });
  if (t.healPercent) bits.push({ icon: 'hp', text: `Heals ${t.healPercent}%` });
  return (
    <>
      <span class="tile-name">{t.name}</span>
      {bits.length === 0 ? (
        <span class="tile-bit"> · No bonus</span>
      ) : (
        bits.map((b) => (
          <span key={b.text} class="tile-bit num">
            {' · '}
            <Icon name={b.icon} size={14} />
            {b.text}
          </span>
        ))
      )}
    </>
  );
}

export function BottomBar(props: { view: BattleView; data: GameData; onDanger: () => void; onEndTurn: () => void }) {
  const { view, data } = props;
  const { state, busy, showDanger } = view;
  const canEnd = !busy && state.phase === 'player' && state.result === 'ongoing';
  return (
    <div class="hud-row bottom">
      <p class="tile-info" data-testid="tile-info">
        <TileInfo view={view} data={data} />
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

import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { createBattle } from '../core';
import { gameData } from '../data';
import { BattleController, type BattleView, type Speed } from '../battle/controller';
import { FIRST_MAP_ID, battleSeed, parseLaunch, type LaunchOptions } from '../battle/setup';
import type { Insets } from '../game/camera';
import type { GameHandle } from '../game/start';
import { ActionMenu, ForecastPanel, HealPanel, TargetHint } from './battle/ActionPanels';
import { BottomBar, TopBar } from './battle/Hud';
import { ConfirmDialog, EndScreen, LevelUp, PhaseBanner } from './battle/Overlays';
import { UnitCard } from './battle/UnitCard';
import { coveredInsets } from './battle/insets';
import { installTestHook } from './battle/testHook';
import './battle/battle.css';

/** Kept across Play again within one visit. */
let lastSpeed: Speed = 'normal';

/** The battle route. "Play again" remounts a fresh run with a new seed (or the URL's). */
export function Battle() {
  const launch = useMemo(() => parseLaunch(window.location.search, window.location.hash), []);
  const [run, setRun] = useState(0);
  return <BattleRun key={run} launch={launch} onAgain={() => setRun((r) => r + 1)} />;
}

function useView(c: BattleController): BattleView {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => c.subscribe(() => bump(undefined)), [c]);
  return c.view;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function BattleRun({ launch, onAgain }: { launch: LaunchOptions; onAgain: () => void }) {
  const controller = useMemo(() => {
    const map = gameData.maps[FIRST_MAP_ID];
    if (!map) throw new Error(`Missing map ${FIRST_MAP_ID}`);
    const state = createBattle(map, launch.setup, battleSeed(launch, Date.now()), gameData);
    return new BattleController(state, gameData, { reducedMotion: prefersReducedMotion(), speed: lastSpeed });
  }, [launch]);
  const view = useView(controller);
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const game = useRef<GameHandle | null>(null);
  const insets = useRef<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [quitting, setQuitting] = useState(false);

  // Mount Phaser (loaded lazily so the title stays light) and the test hook.
  useEffect(() => {
    let cancelled = false;
    const removeHook = launch.test ? installTestHook(controller, gameData, () => game.current) : null;
    void import('../game/start').then(({ startGame }) => {
      if (cancelled || !host.current) return;
      game.current = startGame(host.current, controller.view.state, gameData, controller);
      game.current.setInsets(insets.current);
    });
    return () => {
      cancelled = true;
      removeHook?.();
      game.current?.destroy();
      game.current = null;
    };
  }, [controller, launch]);

  // Tell the map which parts of the screen the overlays cover.
  useEffect(() => {
    const measure = () => {
      const r = root.current;
      if (!r) return;
      const base = r.getBoundingClientRect();
      const boxes = [top.current, dock.current]
        .filter((el): el is HTMLDivElement => el !== null)
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left - base.left, top: b.top - base.top, right: b.right - base.left, bottom: b.bottom - base.top };
        });
      const next = coveredInsets(base.width, base.height, boxes);
      r.style.setProperty('--hud-top', `${top.current?.offsetHeight ?? 0}px`);
      const prev = insets.current;
      if (next.top === prev.top && next.right === prev.right && next.bottom === prev.bottom && next.left === prev.left) return;
      insets.current = next;
      game.current?.setInsets(next);
    };
    const observer = new ResizeObserver(measure);
    for (const el of [root.current, top.current, dock.current]) if (el) observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const setSpeed = (s: Speed) => {
    lastSpeed = s;
    controller.setSpeed(s);
  };

  const { state, banner, levelUp, confirmEnd, ended } = view;
  return (
    <div class="battle" ref={root}>
      <div class="battle-host" ref={host} />
      <div class="hud-top" ref={top}>
        <TopBar view={view} onSpeed={setSpeed} onQuit={() => setQuitting(true)} />
      </div>
      <div class="dock" ref={dock}>
        {levelUp ? <LevelUp popup={levelUp} onClose={() => controller.dismissPopup()} /> : <DockPanel view={view} controller={controller} />}
        <BottomBar view={view} data={gameData} onDanger={() => controller.toggleDanger()} onEndTurn={() => controller.requestEndTurn()} />
      </div>
      {banner && <PhaseBanner phase={banner.phase} turn={banner.turn} />}
      {confirmEnd !== null && (
        <ConfirmDialog
          text={`${confirmEnd} ${confirmEnd === 1 ? 'unit' : 'units'} can still act. End your turn?`}
          yes="End turn"
          no="Keep playing"
          onYes={() => controller.confirmEndTurn()}
          onNo={() => controller.cancelEndTurn()}
        />
      )}
      {quitting && (
        <ConfirmDialog
          text="Leave this battle? It will not be saved."
          yes="Leave"
          no="Stay"
          onYes={() => {
            window.location.hash = '#/';
          }}
          onNo={() => setQuitting(false)}
        />
      )}
      {ended && <EndScreen summary={ended} state={state} onAgain={onAgain} />}
    </div>
  );
}

function DockPanel({ view, controller }: { view: BattleView; controller: BattleController }) {
  if (view.busy) return null;
  const { state, selection: sel } = view;
  const unit = (id: string) => state.units.find((u) => u.id === id)!;
  const run = (cmd: Parameters<BattleController['command']>[0]) => controller.command(cmd);
  if (view.forecast) return <ForecastPanel fc={view.forecast} state={state} run={run} />;
  if (view.heal && sel.kind === 'confirm') {
    return <HealPanel healer={unit(sel.unitId)} target={unit(view.heal.targetId)} amount={view.heal.amount} run={run} />;
  }
  if (sel.kind === 'menu') return <ActionMenu unit={unit(sel.unitId)} options={view.menu} run={run} />;
  if (sel.kind === 'target') return <TargetHint mode={sel.mode} run={run} />;
  if (sel.kind === 'unit' || sel.kind === 'inspect') return <UnitCard unit={unit(sel.unitId)} data={gameData} />;
  return null;
}

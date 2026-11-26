import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { createBattle, type BattleSetup, type BattleState, type BattleSummary } from '../core';
import { chapters, gameData } from '../data';
import { BattleController, type BattleView, type CheckpointExtra, type Speed } from '../battle/controller';
import { BattleSaver } from '../save/battleSaver';
import { battleSetup, currentChapter } from '../save/campaign';
import { loadPrefs, savePrefs } from '../save/prefs';
import type { SaveStorage } from '../save/storage';
import { finishRun, takeRun, now, storage, writes, type CampaignRun } from './saves';
import { FIRST_MAP_ID, battleSeed, parseLaunch, type LaunchOptions } from '../battle/setup';
import type { Insets } from '../game/camera';
import type { GameHandle } from '../game/start';
import { ActionMenu, ForecastPanel, HealPanel, TargetHint } from './battle/ActionPanels';
import { BottomBar, TopBar } from './battle/Hud';
import { ConfirmDialog, EndScreen, LevelUp, PhaseBanner, type EndButton } from './battle/Overlays';
import { UnitCard } from './battle/UnitCard';
import { coveredInsets } from './battle/insets';
import { installTestHook } from './battle/testHook';
import './battle/battle.css';

/**
 * The battle route. A campaign run (set by the title, new game or load screens)
 * plays its chapter's map and saves as it goes. With `quick=1` in the URL it
 * plays an unsaved quick battle from the URL overrides. Anything else goes back
 * to the title (a page reload loses the run; Continue picks it up).
 */
export function Battle() {
  const launch = useMemo(() => parseLaunch(window.location.search, window.location.hash), []);
  // Taken once: going back to this route later must not replay a stale run.
  const run = useMemo(() => takeRun(), []);
  useEffect(() => {
    if (!run && !launch.quick) window.location.replace('#/');
  }, [run, launch]);
  if (run) return <CampaignBattle run={run} launch={launch} />;
  if (launch.quick) return <QuickBattle launch={launch} />;
  return null;
}

function newBattle(setup: BattleSetup, mapId: string, launch: LaunchOptions): BattleState {
  const map = gameData.maps[mapId];
  if (!map) throw new Error(`Missing map ${mapId}`);
  return createBattle(map, setup, battleSeed(launch, now()), gameData);
}

function QuickBattle({ launch }: { launch: LaunchOptions }) {
  const [attempt, setAttempt] = useState(0);
  const initial = useMemo(() => newBattle(launch.setup, FIRST_MAP_ID, launch), [launch, attempt]);
  return (
    <BattleRun
      key={attempt}
      initial={initial}
      launch={launch}
      quitText="Leave this battle? Quick battles are not saved."
      endButtons={() => [
        { label: 'Play again', primary: true, onTap: () => setAttempt((a) => a + 1) },
        { label: 'Title', onTap: goTitle },
      ]}
    />
  );
}

const goTitle = () => {
  window.location.hash = '#/';
};

function CampaignBattle({ run, launch }: { run: CampaignRun; launch: LaunchOptions }) {
  const [store, setStore] = useState<SaveStorage | null>(null);
  useEffect(() => {
    void storage().then(setStore);
  }, []);
  return store ? <CampaignAttempts run={run} launch={launch} store={store} /> : null;
}

/** One campaign map. Retry starts a fresh attempt from the campaign save with a new seed. */
function CampaignAttempts({ run, launch, store }: { run: CampaignRun; launch: LaunchOptions; store: SaveStorage }) {
  const [attempt, setAttempt] = useState(0);
  const chapter = currentChapter(run.campaign, chapters);
  const mapId = run.resume?.mapId ?? chapter?.mapId ?? FIRST_MAP_ID;
  const { initial, saver } = useMemo(() => {
    const resume = attempt === 0 ? run.resume : null;
    const state = resume ? resume.battle : newBattle(battleSetup(run.campaign), mapId, launch);
    return {
      initial: state,
      saver: new BattleSaver({ store, queue: writes, slot: run.slot, campaign: run.campaign, chapters, now }),
    };
  }, [run, attempt, mapId, launch, store]);
  const mc = run.campaign.mc.name;
  return (
    <BattleRun
      key={attempt}
      initial={initial}
      launch={launch}
      showDanger={attempt === 0 ? (run.resume?.controller.showDanger ?? false) : false}
      onCheckpoint={(state, extra) => saver.checkpoint(state, extra)}
      quitText="Leave this battle? It stays suspended: pick it up with Continue on the title screen."
      endNote={(summary, state) => {
        if (summary.result === 'victory') return undefined;
        const lord = state.units.find((u) => u.isLord && u.team === 'player');
        return lord && !lord.alive ? `${mc} has fallen. The tale ends here.` : undefined;
      }}
      endButtons={(summary) =>
        summary.result === 'victory'
          ? [
              {
                label: 'Continue',
                primary: true,
                onTap: () => {
                  finishRun(run.slot, saver.completed ?? run.campaign, chapter?.name ?? 'Chapter');
                  window.location.hash = '#/complete';
                },
              },
            ]
          : [
              { label: 'Retry', primary: true, onTap: () => setAttempt((a) => a + 1) },
              { label: 'Title', onTap: goTitle },
            ]
      }
    />
  );
}

function useView(c: BattleController): BattleView {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => c.subscribe(() => bump(undefined)), [c]);
  return c.view;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface BattleRunProps {
  initial: BattleState;
  launch: LaunchOptions;
  showDanger?: boolean;
  onCheckpoint?: (state: BattleState, extra: CheckpointExtra) => void;
  quitText: string;
  endNote?: (summary: BattleSummary, state: BattleState) => string | undefined;
  endButtons: (summary: BattleSummary) => EndButton[];
}

function BattleRun({ initial, launch, showDanger, onCheckpoint, quitText, endNote, endButtons }: BattleRunProps) {
  const controller = useMemo(
    () =>
      new BattleController(initial, gameData, {
        reducedMotion: prefersReducedMotion(),
        speed: loadPrefs().speed,
        showDanger,
        onCheckpoint,
      }),
    // A run is one controller for its whole life; the other props are read once.
    [initial],
  );
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
    const removeHook = launch.test ? installTestHook(controller, gameData, () => game.current, () => writes.idle()) : null;
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
    savePrefs({ ...loadPrefs(), speed: s });
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
          text={quitText}
          yes="Leave"
          no="Stay"
          onYes={() => {
            window.location.hash = '#/';
          }}
          onNo={() => setQuitting(false)}
        />
      )}
      {ended && <EndScreen summary={ended} state={state} note={endNote?.(ended, state)} buttons={endButtons(ended)} />}
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

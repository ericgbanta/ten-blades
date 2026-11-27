import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { createBattle, type BattleSetup, type BattleState, type BattleSummary } from '../core';
import { composeMcToken, copyMc } from '../art/mc/compose';
import { DEFAULT_LOOK, type McLook } from '../art/mc/look';
import { campContent, chapters, gameData } from '../data';
import { scenes as sceneData, speakers, worldNames } from '../data/story';
import type { TextContext } from '../story/text';
import { Dialogue } from './dialogue/Dialogue';
import { BattleController, type BattleView, type CheckpointExtra, type SceneMode, type Speed } from '../battle/controller';
import { BattleSaver } from '../save/battleSaver';
import { battleSetup } from '../save/campaign';
import { loadPrefs, savePrefs, sceneModeOf } from '../save/prefs';
import type { SaveStorage } from '../save/storage';
import { campCtx, commitCamp, startRun, takeRun, now, storage, writes, type CampaignRun } from './saves';
import { deployInfo } from '../camp/barracks';
import { battleRewards, type Rewards } from '../camp/rewards';
import { battleSeed, parseLaunch, type LaunchOptions } from '../battle/setup';
import { flowStep } from '../story/flow';
import type { Insets } from '../game/camera';
import type { GameHandle } from '../game/start';
import { powerDirections, powerPlan, unitBladeTier } from '../core';
import { ActionMenu, ForecastPanel, HealPanel, ItemsPanel, PowerPanel, TargetHint } from './battle/ActionPanels';
import { CutIn, FightHud } from './battle/FightHud';
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

/** The quick battle's default map: the first chapter that has one (src/data/chapters.json). */
const FIRST_MAP = chapters.find((c) => c.mapId !== null && gameData.maps[c.mapId])?.mapId ?? Object.keys(gameData.maps)[0]!;

function newBattle(setup: BattleSetup, mapId: string, launch: LaunchOptions): BattleState {
  const map = gameData.maps[mapId];
  if (!map) throw new Error(`Missing map ${mapId}`);
  return createBattle(map, setup, battleSeed(launch, now()), gameData);
}

function QuickBattle({ launch }: { launch: LaunchOptions }) {
  const [attempt, setAttempt] = useState(0);
  const mapId = launch.mapId && gameData.maps[launch.mapId] ? launch.mapId : FIRST_MAP;
  const initial = useMemo(() => newBattle(launch.setup, mapId, launch), [launch, mapId, attempt]);
  return (
    <BattleRun
      key={attempt}
      initial={initial}
      launch={launch}
      look={DEFAULT_LOOK}
      text={{ mcName: launch.setup.mc.name, pronouns: 'they', names: worldNames }}
      scenes={launch.scenes}
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
  // The map comes from the chapter data through the chapter flow (or from the suspended battle on a resume).
  const step = flowStep(run.campaign, chapters, gameData);
  const skirmishId = run.skirmish ?? null;
  const skirmish = skirmishId ? (campContent.skirmishes[skirmishId] ?? null) : null;
  const mapId = run.resume?.mapId ?? skirmish?.mapId ?? (step.kind === 'battle' ? step.mapId : FIRST_MAP);
  const { initial, saver } = useMemo(() => {
    const resume = attempt === 0 ? run.resume : null;
    // The deployment chosen in camp (src/camp/barracks.ts): who goes, in what order, and a skirmish's scaling.
    const info = deployInfo(run.campaign, campCtx, skirmishId);
    const plan = info ? { party: info.deployed, enemyLevelShift: info.enemyLevelShift } : undefined;
    const state = resume ? resume.battle : newBattle(battleSetup(run.campaign, plan), mapId, launch);
    return {
      initial: state,
      saver: new BattleSaver({
        store,
        queue: writes,
        slot: run.slot,
        campaign: run.campaign,
        chapters,
        now,
        economy: campContent.economy,
        skirmish: skirmishId && skirmish ? { id: skirmishId, def: skirmish } : null,
      }),
    };
  }, [run, attempt, mapId, launch, store]);
  const mc = run.campaign.mc.name;
  const toCamp = () => {
    commitCamp(run.slot, saver.completed ?? run.campaign);
    window.location.hash = '#/camp';
  };
  const rewardDef = skirmish ? skirmish.rewards : campContent.economy.rewards[mapId];
  return (
    <BattleRun
      key={attempt}
      initial={initial}
      launch={launch}
      look={run.campaign.mc.look}
      text={{ mcName: run.campaign.mc.name, pronouns: run.campaign.mc.pronouns, names: worldNames }}
      scenes
      pendingScenes={attempt === 0 ? (run.resume?.controller.scenes ?? []) : []}
      showDanger={attempt === 0 ? (run.resume?.controller.showDanger ?? false) : false}
      onCheckpoint={(state, extra) => saver.checkpoint(state, extra)}
      quitText="Leave this battle? It stays suspended: pick it up with Continue on the title screen."
      endNote={(summary, state) => {
        if (summary.result === 'victory') return undefined;
        const lord = state.units.find((u) => u.isLord && u.team === 'player');
        return lord && !lord.alive ? `${mc} has fallen. The tale ends here.` : undefined;
      }}
      rewards={(state) => battleRewards(state, rewardDef)}
      endButtons={(summary) =>
        summary.result === 'victory'
          ? [
              skirmish
                ? { label: 'Back to camp', primary: true, onTap: toCamp }
                : {
                    label: 'Continue',
                    primary: true,
                    // On to the outro (src/story/flow.ts); the won campaign is already being saved.
                    onTap: () => startRun({ slot: run.slot, campaign: saver.completed ?? run.campaign, resume: null }),
                  },
            ]
          : [
              { label: 'Retry', primary: true, onTap: () => setAttempt((a) => a + 1) },
              skirmish ? { label: 'Back to camp', onTap: toCamp } : { label: 'Title', onTap: goTitle },
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
  /** The main character's look, for their map token and unit card. */
  look: McLook;
  /** Names and pronouns for mid-battle scenes. */
  text: TextContext;
  /** Show mid-battle scenes. */
  scenes: boolean;
  /** Scenes a resumed battle still owes. */
  pendingScenes?: string[];
  showDanger?: boolean;
  onCheckpoint?: (state: BattleState, extra: CheckpointExtra) => void;
  quitText: string;
  endNote?: (summary: BattleSummary, state: BattleState) => string | undefined;
  endButtons: (summary: BattleSummary) => EndButton[];
  /** What a won battle pays, for the end screen. */
  rewards?: (state: BattleState) => Rewards;
}

function BattleRun({ initial, launch, look, text, scenes, pendingScenes, showDanger, onCheckpoint, quitText, endNote, endButtons, rewards }: BattleRunProps) {
  const reduced = useMemo(prefersReducedMotion, []);
  const controller = useMemo(
    () =>
      new BattleController(initial, gameData, {
        reducedMotion: reduced,
        speed: loadPrefs().speed,
        sceneMode: sceneModeOf(loadPrefs(), reduced),
        showDanger,
        onCheckpoint,
        scenes,
        pendingScenes,
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

  // Mount Phaser (loaded lazily so the title stays light) and the test hook. The main character's token is
  // composed from their look first; if that fails the map shows the placeholder.
  useEffect(() => {
    let cancelled = false;
    const removeHook = launch.test ? installTestHook(controller, gameData, () => game.current, () => writes.idle()) : null;
    const lord = controller.view.state.units.find((u) => u.isLord && u.team === 'player');
    const token = lord ? composeMcToken(look, lord.classId).then(copyMc, () => null) : Promise.resolve(null);
    void Promise.all([import('../game/start'), token]).then(([{ startGame }, mcToken]) => {
      if (cancelled || !host.current) return;
      game.current = startGame(host.current, controller.view.state, gameData, controller, { mcToken, look });
      controller.attachFightStage(game.current.fightStage);
      game.current.setInsets(insets.current);
    });
    return () => {
      cancelled = true;
      controller.attachFightStage(null);
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
  const setScenes = (m: SceneMode) => {
    savePrefs({ ...loadPrefs(), sceneMode: m });
    controller.setSceneMode(m);
  };

  const { state, banner, levelUp, confirmEnd, ended } = view;
  return (
    <div class={`battle${view.fight ? ' fighting' : ''}`} ref={root}>
      <div class="battle-host" ref={host} />
      <div class="hud-top" ref={top}>
        <TopBar view={view} onSpeed={setSpeed} onScenes={setScenes} onQuit={() => setQuitting(true)} />
      </div>
      <div class="dock" ref={dock}>
        {levelUp ? (
          <LevelUp popup={levelUp} stats={state.units.find((u) => u.id === levelUp.unitId)?.stats} onClose={() => controller.dismissPopup()} />
        ) : <DockPanel view={view} controller={controller} look={look} />}
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
      {view.fight && <FightHud view={view.fight} state={state} data={gameData} look={look} onSkip={() => controller.skip()} />}
      {view.cutIn && <CutIn cut={view.cutIn} state={state} look={look} reduced={reduced} onSkip={() => controller.skip()} />}
      {ended && <EndScreen summary={ended} state={state} note={endNote?.(ended, state)} buttons={endButtons(ended)} rewards={rewards?.(state)} />}
      {view.scene && <BattleScene key={view.scene} sceneId={view.scene} controller={controller} state={state} look={look} text={text} reduced={reduced} />}
    </div>
  );
}

/** A mid-battle scene over the dimmed map. A scene id with no data is passed over. */
function BattleScene(props: { sceneId: string; controller: BattleController; state: BattleState; look: McLook; text: TextContext; reduced: boolean }) {
  const scene = sceneData[props.sceneId];
  useEffect(() => {
    if (!scene) {
      console.warn(`Missing scene ${props.sceneId}`);
      props.controller.sceneDone();
    }
  }, [scene]);
  if (!scene) return null;
  const { state } = props;
  return (
    <Dialogue
      scene={scene}
      overlay
      text={props.text}
      story={{ flags: state.flags, permadeath: state.options.permadeath, difficulty: state.options.difficulty }}
      speakers={speakers}
      look={props.look}
      reducedMotion={props.reduced}
      onDone={() => props.controller.sceneDone()}
    />
  );
}


function DockPanel({ view, controller, look }: { view: BattleView; controller: BattleController; look: McLook }) {
  if (view.busy) return null;
  const { state, selection: sel } = view;
  const unit = (id: string) => state.units.find((u) => u.id === id)!;
  const run = (cmd: Parameters<BattleController['command']>[0]) => controller.command(cmd);
  if (view.forecast) return <ForecastPanel fc={view.forecast} state={state} run={run} data={gameData} look={look} />;
  if (view.power) return <PowerPanel fc={view.power} state={state} run={run} data={gameData} look={look} />;
  if (view.heal && sel.kind === 'confirm') {
    return <HealPanel healer={unit(sel.unitId)} target={unit(view.heal.targetId)} amount={view.heal.amount} run={run} look={look} />;
  }
  if (sel.kind === 'menu') return <ActionMenu unit={unit(sel.unitId)} options={view.menu} run={run} data={gameData} powers={view.powerOptions} />;
  if (sel.kind === 'items') return <ItemsPanel unit={unit(sel.unitId)} items={view.items} run={run} data={gameData} />;
  if (sel.kind === 'target') {
    if (sel.mode !== 'power') return <TargetHint mode={sel.mode} run={run} />;
    const plan = powerPlan(state, sel.unitId, gameData, sel.powerId);
    const dirs = plan?.aim === 'line' ? powerDirections(state, sel.unitId, sel.to, gameData, sel.powerId) : null;
    return <TargetHint mode="power" run={run} dirs={dirs} powerName={plan?.name} />;
  }
  if (sel.kind === 'unit' || sel.kind === 'inspect') {
    const u = unit(sel.unitId);
    return <UnitCard unit={u} data={gameData} look={look} tier={unitBladeTier(state, u, gameData)} />;
  }
  return null;
}

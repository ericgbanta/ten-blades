// The battle controller: owns the BattleState, the player's selection, and the
// event playback queue. Preact reads `view` and calls the input methods; the
// Phaser scene is a Stage that draws and animates. Plain TS, no DOM.

import {
  applyAction,
  battleSummary,
  getUnit,
  healAmount,
  inBounds,
  pathTo,
  planAiAction,
  samePos,
  startBattle,
  threatTiles,
  type Action,
  type BattleEvent,
  type BattleState,
  type BattleSummary,
  type Forecast,
  type GameData,
  type Pos,
  type Stats,
  type Team,
} from '../core';
import {
  NO_SELECTION,
  forecastFor,
  menuOptions,
  overlayFor,
  previewOf,
  readyUnitIds,
  runCommand,
  tapTileAction,
  type Command,
  type MenuOption,
  type Selection,
} from './selection';
import type { Stage, Timing } from './stage';

export type Speed = 'normal' | 'fast';

const SPEED_SCALE: Record<Speed, number> = { normal: 1, fast: 0.45 };
/** Base lengths in ms for the overlays the controller shows itself. */
const BANNER_MS = 1100;
const LEVEL_UP_MS = 2400;
/** Safety net: no phase should take this many AI actions. */
const MAX_AUTO_ACTIONS = 2000;

export interface LevelUpPopup {
  unitId: string;
  name: string;
  level: number;
  gains: Stats;
}

/** Everything the overlays render. A fresh object after every change. */
export interface BattleView {
  state: BattleState;
  selection: Selection;
  /** Last tapped tile, for the terrain line. */
  tile: Pos | null;
  /** True while events play; map taps then skip instead of selecting. */
  busy: boolean;
  menu: MenuOption[];
  forecast: Forecast | null;
  heal: { targetId: string; amount: number } | null;
  banner: { phase: Team; turn: number } | null;
  levelUp: LevelUpPopup | null;
  /** Set while the end turn confirm is open: how many units can still act. */
  confirmEnd: number | null;
  showDanger: boolean;
  speed: Speed;
  /** Set once the battle is over and its last event has played. */
  ended: BattleSummary | null;
  /** The mid-battle dialogue scene to show over the map, or null. Call `sceneDone` when it has played. */
  scene: string | null;
}

export interface ControllerOptions {
  /** Wait `ms`, resolving early when `cancel` is called. Defaults to setTimeout. */
  sleep?: (ms: number, onCancel: (cancel: () => void) => void) => Promise<void>;
  reducedMotion?: boolean;
  speed?: Speed;
  /** Start with the danger zone shown (a resumed battle keeps it). */
  showDanger?: boolean;
  /**
   * Called with every state the battle should be resumable from: at start, right
   * after each player action is applied (before its animations play, so closing
   * the tab mid-animation cannot undo the outcome), and when playback comes to
   * rest. Also called with the final state once the battle ends. The state may
   * be in an AI phase; `start()` on that state plays the AI on to the next rest.
   */
  onCheckpoint?: (state: BattleState, extra: CheckpointExtra) => void;
  /** Show mid-battle scenes (`sceneRequested` events). Off: they are passed over. */
  scenes?: boolean;
  /** Scenes a resumed battle still owes from its last player action, played first. */
  pendingScenes?: string[];
}

/** Controller state that a resume keeps. */
export interface CheckpointExtra {
  showDanger: boolean;
  /** Scenes from the last player action (or the battle start) that have not finished playing. */
  scenes: string[];
}

const defaultSleep = (ms: number, onCancel: (cancel: () => void) => void): Promise<void> =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    onCancel(() => {
      clearTimeout(id);
      resolve();
    });
  });

export class BattleController {
  private state: BattleState;
  private selection: Selection = NO_SELECTION;
  private tile: Pos | null = null;
  private busy = false;
  private skipping = false;
  private banner: BattleView['banner'] = null;
  private levelUp: LevelUpPopup | null = null;
  private confirmEnd = false;
  private showDanger = false;
  private speed: Speed;
  private ended: BattleSummary | null = null;
  private stage: Stage | null = null;
  private previewed: { unitId: string; to: Pos } | null = null;
  private cancelWait: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private idle: Promise<void> = Promise.resolve();
  private cached: BattleView | null = null;
  private readonly sleep: NonNullable<ControllerOptions['sleep']>;
  private readonly reduced: boolean;
  private readonly onCheckpoint: ControllerOptions['onCheckpoint'];
  private lastCheckpoint: BattleState | null = null;
  private lastPending = '';
  private readonly scenesOn: boolean;
  /** Scenes of the last checkpointed action still to play. */
  private pending: string[];
  private scene: string | null = null;
  private sceneResolve: (() => void) | null = null;

  constructor(
    initial: BattleState,
    private readonly data: GameData,
    options: ControllerOptions = {},
  ) {
    this.state = initial;
    this.sleep = options.sleep ?? defaultSleep;
    this.reduced = options.reducedMotion ?? false;
    this.speed = options.speed ?? 'normal';
    this.showDanger = options.showDanger ?? false;
    this.onCheckpoint = options.onCheckpoint;
    this.scenesOn = options.scenes ?? false;
    this.pending = this.scenesOn ? [...(options.pendingScenes ?? [])] : [];
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  get view(): BattleView {
    if (this.cached) return this.cached;
    const sel = this.selection;
    const s = this.state;
    this.cached = {
      state: s,
      selection: sel,
      tile: this.tile,
      busy: this.busy,
      menu: this.busy ? [] : menuOptions(s, sel, this.data),
      forecast: this.busy ? null : forecastFor(s, sel, this.data),
      heal:
        !this.busy && sel.kind === 'confirm' && sel.mode === 'heal'
          ? { targetId: sel.targetId, amount: healAmount(s, sel.unitId, sel.targetId, this.data) }
          : null,
      banner: this.banner,
      levelUp: this.levelUp,
      confirmEnd: this.confirmEnd ? readyUnitIds(s).length : null,
      showDanger: this.showDanger,
      speed: this.speed,
      ended: this.ended,
      scene: this.scene,
    };
    return this.cached;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves once the current playback (if any) has finished. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  /** Connect the renderer. It is synced to the current state right away. */
  attachStage(stage: Stage): void {
    this.stage = stage;
    this.previewed = null;
    stage.sync(this.state);
    this.refreshOverlay();
  }

  /**
   * Show the opening banner, then, for a resumed state that is not waiting on
   * the player (an AI phase, or no player unit left to act), play on to the next
   * rest. Call once the stage is attached.
   */
  start(): Promise<void> {
    return this.runBusy(async () => {
      if (!this.state.started) {
        // The battle start events (an opening scene, say) play before the first banner.
        const r = startBattle(this.state, this.data);
        this.state = r.state;
        this.pending = this.scenesIn(r.events);
        this.checkpoint();
        if (r.events.length > 0) {
          await this.playEvents(r.events);
          this.stage?.sync(this.state);
        }
        this.changed();
      } else if (this.pending.length > 0) {
        // A resume owes the scenes its last action had not finished.
        for (const id of [...this.pending]) await this.playScene(id);
      }
      if (this.state.result === 'ongoing') await this.showBanner(this.state.phase, this.state.turn);
      await this.runAutomatic();
    });
  }

  /** The mid-battle scene on screen has played to its end (or was skipped). */
  sceneDone(): void {
    this.sceneResolve?.();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  tapTile(pos: Pos): void {
    if (this.busy) {
      this.skip();
      return;
    }
    if (this.ended || this.confirmEnd) return;
    if (!inBounds(this.state, pos)) {
      // Off the map: just deselect.
      this.tile = null;
      this.select(NO_SELECTION);
      return;
    }
    this.tile = pos;
    const t = tapTileAction(this.state, this.selection, pos, this.data);
    if (t.action) this.perform(t.action);
    else this.select(t.selection);
  }

  command(cmd: Command): void {
    if (this.busy || this.ended) return;
    const t = runCommand(this.state, this.selection, cmd, this.data);
    if (t.action) this.perform(t.action);
    else this.select(t.selection);
  }

  /** The End turn button: ends at once, or asks first if units can still act. */
  requestEndTurn(): void {
    if (this.busy || this.ended || this.state.phase !== 'player') return;
    if (readyUnitIds(this.state).length > 0) {
      this.confirmEnd = true;
      this.changed();
      return;
    }
    this.confirmEndTurn();
  }

  confirmEndTurn(): void {
    if (this.busy || this.ended || this.state.phase !== 'player') return;
    this.confirmEnd = false;
    this.perform({ type: 'endPhase' });
  }

  cancelEndTurn(): void {
    this.confirmEnd = false;
    this.changed();
  }

  toggleDanger(): void {
    this.showDanger = !this.showDanger;
    this.refreshOverlay();
    this.changed();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.changed();
  }

  /** Skip the rest of the current playback. */
  skip(): void {
    if (!this.busy) return;
    this.skipping = true;
    this.cancelWait?.();
  }

  /** Close the level-up popup without skipping anything else. */
  dismissPopup(): void {
    if (this.levelUp) this.cancelWait?.();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private changed(): void {
    this.cached = null;
    for (const fn of this.listeners) fn();
  }

  private select(sel: Selection): void {
    this.selection = sel;
    this.refreshOverlay();
    this.refreshPreview();
    this.changed();
  }

  private dangerTiles(): Pos[] {
    return this.showDanger && this.state.result === 'ongoing' ? threatTiles(this.state, this.data) : [];
  }

  private refreshOverlay(): void {
    this.stage?.setOverlay(overlayFor(this.state, this.selection, this.data, this.dangerTiles()));
  }

  private refreshPreview(): void {
    const next = previewOf(this.state, this.selection);
    const prev = this.previewed;
    if (next && prev && next.unitId === prev.unitId && samePos(next.to, prev.to)) return;
    if (prev && (!next || next.unitId !== prev.unitId)) this.stage?.preview(prev.unitId, null, this.timing());
    if (next) this.stage?.preview(next.unitId, pathTo(this.state, next.unitId, next.to, this.data), this.timing());
    this.previewed = next;
  }

  private timing(): Timing {
    const scale = SPEED_SCALE[this.speed] * (this.reduced ? 0.4 : 1);
    return {
      ms: (base) => (this.skipping ? 0 : Math.round(base * scale)),
      reduced: this.reduced,
    };
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return this.sleep(ms, (cancel) => {
      this.cancelWait = cancel;
    }).finally(() => {
      this.cancelWait = null;
    });
  }

  private runBusy(work: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.skipping = false;
    this.changed();
    this.idle = work().finally(() => {
      this.busy = false;
      this.skipping = false;
      this.refreshOverlay();
      this.changed();
    });
    return this.idle;
  }

  /** Apply a player action, then keep going through auto end and the AI phases. */
  private perform(first: Action): void {
    this.selection = NO_SELECTION;
    this.confirmEnd = false;
    // The token may stand on a previewed tile; the move event takes it from there.
    this.previewed = null;
    this.stage?.setOverlay(overlayFor(this.state, NO_SELECTION, this.data, []));
    void this.runBusy(async () => {
      await this.applyAndPlay(first);
      await this.runAutomatic();
    });
  }

  private async applyAndPlay(action: Action, checkpoint = true): Promise<void> {
    const r = applyAction(this.state, action, this.data);
    this.state = r.state;
    // The outcome is decided now: save it before the animations play.
    if (checkpoint) {
      this.pending = this.scenesIn(r.events);
      this.checkpoint();
    }
    await this.playEvents(r.events);
    this.stage?.sync(this.state);
    this.changed();
  }

  /** Auto end and the AI phases, until the player has a choice or the battle ends. Then checkpoint. */
  private async runAutomatic(): Promise<void> {
    let action = this.nextAutomaticAction();
    for (let n = 0; action && n < MAX_AUTO_ACTIONS; n++) {
      await this.applyAndPlay(action, false);
      action = this.nextAutomaticAction();
    }
    this.checkpoint();
    if (this.state.result !== 'ongoing') this.ended = battleSummary(this.state);
  }

  private checkpoint(): void {
    const pending = this.pending.join('|');
    if (this.state === this.lastCheckpoint && pending === this.lastPending) return;
    this.lastCheckpoint = this.state;
    this.lastPending = pending;
    this.onCheckpoint?.(this.state, { showDanger: this.showDanger, scenes: [...this.pending] });
  }

  private scenesIn(events: BattleEvent[]): string[] {
    if (!this.scenesOn) return [];
    return events.flatMap((e) => (e.type === 'sceneRequested' ? [e.sceneId] : []));
  }

  /** Show a scene and wait for the UI to finish it. A scene the last checkpoint owed is then crossed off. */
  private async playScene(sceneId: string): Promise<void> {
    if (!this.scenesOn) return;
    this.scene = sceneId;
    this.changed();
    await new Promise<void>((resolve) => {
      this.sceneResolve = resolve;
    });
    this.sceneResolve = null;
    this.scene = null;
    this.changed();
    if (this.pending[0] === sceneId) {
      this.pending = this.pending.slice(1);
      this.checkpoint();
    }
  }

  /** AI moves during enemy and ally phases; End turn once every player unit has acted. */
  private nextAutomaticAction(): Action | null {
    const s = this.state;
    if (s.result !== 'ongoing') return null;
    if (s.phase !== 'player') return planAiAction(s, this.data);
    return readyUnitIds(s).length === 0 ? { type: 'endPhase' } : null;
  }

  private async playEvents(events: BattleEvent[]): Promise<void> {
    for (const ev of events) {
      if (ev.type === 'phaseChanged') {
        await this.showBanner(ev.phase, ev.turn);
      } else if (ev.type === 'sceneRequested') {
        // The map shows the state after the action, so the scene plays over the field as it now stands.
        this.stage?.sync(this.state);
        await this.playScene(ev.sceneId);
      } else if (ev.type === 'levelUp') {
        await this.showLevelUp(ev.unitId, ev.level, ev.gains);
      } else {
        await this.stage?.play(ev, this.state, this.timing());
      }
    }
  }

  private async showBanner(phase: Team, turn: number): Promise<void> {
    this.banner = { phase, turn };
    this.changed();
    await this.wait(this.timing().ms(BANNER_MS));
    this.banner = null;
    this.changed();
  }

  private async showLevelUp(unitId: string, level: number, gains: Stats): Promise<void> {
    // Shown even while skipping: the stat gains are worth a look.
    this.levelUp = { unitId, name: getUnit(this.state, unitId).name, level, gains };
    this.changed();
    // A tap dismisses only the popup, so use the speed scale but not the skip flag.
    await this.wait(Math.round(LEVEL_UP_MS * SPEED_SCALE[this.speed]));
    this.levelUp = null;
    this.changed();
  }
}

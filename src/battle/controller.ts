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
  validateAction,
  type Action,
  type BattleEvent,
  type BattleState,
  type BattleSummary,
  type Forecast,
  type GameData,
  type Pos,
  type Stats,
  type Team,
  unitBladeTier,
  weaponDef,
} from '../core';
import { buildFightScript, isSceneStart, sceneGroupEnd, type FightScript, type FighterFacts } from './fightTimeline';
import {
  NO_SELECTION,
  forecastFor,
  menuOptions,
  powerForecastFor,
  powerOption,
  powerOptions,
  itemOptions,
  type ItemOption,
  type PowerOption,
  overlayFor,
  previewOf,
  readyUnitIds,
  runCommand,
  tapTileAction,
  type Command,
  type MenuOption,
  type Selection,
} from './selection';
import type { FightStage, Stage, Timing } from './stage';

export type Speed = 'normal' | 'fast';

/** Battle scenes: Full, Fast (about twice as quick) or Off (map only). */
export type SceneMode = 'full' | 'fast' | 'off';

const SCENE_SCALE: Record<SceneMode, number> = { full: 1, fast: 0.5, off: 0 };
/** The power cut-in before its scene, in ms at Full speed. */
export const CUT_IN_MS = 760;

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

/** The battle scene on screen, for the HUD under it. */
export interface FightView {
  script: FightScript;
  /** Each shown fighter's HP as the scene stands, and how long its bar takes to get there. */
  hp: Record<string, { hp: number; ms: number }>;
  /** The numbers each side fights with: from the forecast (a power's for its bearer), or null (no counter). */
  numbers: Record<string, { damage: number; hit: number; crit: number; strikes: number } | null>;
}

/** The portrait cut-in that announces a power. */
export interface CutInView {
  unitId: string;
  name: string;
  school: string;
  /** The unit whose power an Echo re-casts, or null. */
  echoOf: string | null;
  ms: number;
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
  sceneMode: SceneMode;
  /** The battle scene playing, or null. */
  fight: FightView | null;
  cutIn: CutInView | null;
  /** The first Power option while the menu is open (null when the unit has no power). */
  powerOption: PowerOption | null;
  /** Every Power option while the menu is open: two for an Awakened blade. */
  powerOptions: PowerOption[];
  /** The Items panel's entries while it is open. */
  items: ItemOption[];
  /** The power forecast while a power waits for Confirm. */
  power: ReturnType<typeof powerForecastFor>;
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
  /** Battle scenes: Full by default. Without a fight stage attached, fights play on the map. */
  sceneMode?: SceneMode;
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
  private sceneMode: SceneMode;
  private fightStage: FightStage | null = null;
  private fight: FightView | null = null;
  private cutIn: CutInView | null = null;
  private testSlow = 1;

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
    this.sceneMode = options.sceneMode ?? 'full';
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
      sceneMode: this.sceneMode,
      fight: this.fight,
      cutIn: this.cutIn,
      powerOption: this.busy ? null : powerOption(s, sel, this.data),
      powerOptions: this.busy ? [] : powerOptions(s, sel, this.data),
      items: this.busy ? [] : itemOptions(s, sel, this.data),
      power: this.busy ? null : powerForecastFor(s, sel, this.data),
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

  /** Connect the battle scene player. Until then (or with scenes Off) fights play on the map. */
  attachFightStage(stage: FightStage | null): void {
    this.fightStage = stage;
  }

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
    if (t.action?.type === 'equip') this.equipNow(t.action, t.selection);
    else if (t.action) this.perform(t.action);
    else this.select(t.selection);
  }

  /**
   * Equip is free: apply it at once, with nothing to play, and keep the menu open on the previewed tile. The token
   * stays where it is previewed (equipping does not move it), so the stage is not synced.
   */
  private equipNow(action: Action, next: Selection): void {
    const r = applyAction(this.state, action, this.data);
    this.state = r.state;
    this.pending = [];
    this.checkpoint();
    this.stage?.refresh?.(this.state);
    this.selection = next;
    this.refreshOverlay();
    this.changed();
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

  /**
   * Test hook only (`?test=1`): replace the state between actions, for example to fill a gauge. Not used by
   * play; the battle must be at rest.
   */
  patchStateForTest(patch: (s: BattleState) => BattleState): void {
    if (this.busy) return;
    this.state = patch(structuredClone(this.state));
    this.stage?.sync(this.state);
    this.refreshOverlay();
    this.changed();
  }

  /** Test hook only: play an action as if the player had chosen it (it is validated first). */
  actForTest(action: Action): boolean {
    if (this.busy || this.ended) return false;
    const t = commitForTest(this.state, action, this.data);
    if (!t) return false;
    this.perform(t);
    return true;
  }

  /** Test hook only: stretch battle scene time by `factor` (frame captures). */
  slowScenesForTest(factor: number): void {
    this.testSlow = factor;
  }

  setSceneMode(mode: SceneMode): void {
    this.sceneMode = mode;
    this.changed();
  }

  /** Skip the rest of the current playback (a battle scene jumps to its end). */
  skip(): void {
    if (!this.busy) return;
    this.skipping = true;
    this.cancelWait?.();
    if (this.fight) this.fightStage?.skip();
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
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (isSceneStart(ev) && (ev.type === 'powerUsed' || this.scenesPlay())) {
        const end = sceneGroupEnd(events, i);
        if (await this.playFight(events.slice(i, end))) {
          i = end - 1;
          continue;
        }
      }
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

  /** True when battle scenes play now: a scene player is attached, the setting is on, and nothing is skipping. */
  private scenesPlay(): boolean {
    return this.fightStage !== null && this.sceneMode !== 'off' && !this.skipping;
  }

  private facts = (unitId: string): FighterFacts | null => {
    const u = this.state.units.find((x) => x.id === unitId);
    if (!u) return null;
    const w = u.weaponId ? weaponDef(u.weaponId, this.data) : null;
    return { team: u.team, weapon: w, maxHp: u.stats.hp, hp: u.hp, awakened: unitBladeTier(this.state, u, this.data) >= 2 };
  };

  /**
   * Stage one fight, heal or power: the power's cut-in, then the side-view scene, then the map snaps to the
   * outcome. The state is already applied; nothing here changes it. Returns false when the group is left to the
   * map (scenes off, nothing to stage): a power still gets its cut-in, and its events then play on the map.
   */
  private async playFight(group: BattleEvent[]): Promise<boolean> {
    const first = group[0]!;
    const script = buildFightScript(group, this.facts);
    if (first.type === 'powerUsed') await this.showCutIn(first.summary.bearerId, first.summary.powerId, first.summary.bladePowerId, first.summary.echoOf);
    if (!script || !this.scenesPlay()) return false;
    const stage = this.fightStage!;
    try {
      await stage.prepare(script, this.state);
      if (this.skipping) throw new Error('skipped');
      this.fight = { script, hp: Object.fromEntries(script.fighters.map((f) => [f.unitId, { hp: f.hpBefore, ms: 0 }])), numbers: fightNumbers(group) };
      this.changed();
      const scale = SCENE_SCALE[this.sceneMode] * SPEED_SCALE[this.speed] * this.testSlow;
      await stage.play(script, this.state, {
        scale,
        calm: this.reduced,
        onHp: (unitId, hp, ms) => {
          if (!this.fight) return;
          this.fight = { ...this.fight, hp: { ...this.fight.hp, [unitId]: { hp, ms } } };
          this.changed();
        },
      });
    } catch (e) {
      // A scene that fails to load or play must never stop the battle: the map shows the outcome.
      if (!(e instanceof Error && e.message === 'skipped')) console.warn('Battle scene failed', e);
    }
    this.fight = null;
    this.changed();
    if (this.stage?.settle) this.stage.settle(group, this.state);
    else for (const ev of group) await this.stage?.play(ev, this.state, { ms: () => 0, reduced: this.reduced });
    return true;
  }

  private async showCutIn(unitId: string, powerId: string, bladePowerId: string, echoOf: string | null): Promise<void> {
    if (this.skipping) return;
    const def = this.data.powers[bladePowerId];
    const u = this.state.units.find((x) => x.id === unitId);
    const w = u?.weaponId ? (weaponDef(u.weaponId, this.data) ?? undefined) : undefined;
    const echoed = echoOf ? this.data.powers[powerId] : undefined;
    const name = echoed && def ? `${def.name}: ${echoed.name}` : (def?.name ?? powerId);
    const scale = (this.sceneMode === 'off' ? SCENE_SCALE.fast : SCENE_SCALE[this.sceneMode]) * SPEED_SCALE[this.speed];
    const ms = Math.round(CUT_IN_MS * scale * (this.reduced ? 0.6 : 1) * this.testSlow);
    this.cutIn = { unitId, name, school: w?.school ?? 'none', echoOf, ms };
    this.changed();
    await this.wait(ms);
    this.cutIn = null;
    this.changed();
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

function commitForTest(state: BattleState, action: Action, data: GameData): Action | null {
  return validateAction(state, action, data) === null ? action : null;
}

/** The HUD numbers for each side of a fight: the forecast's (a power's include its bonus), or null for no counter. */
function fightNumbers(group: BattleEvent[]): FightView['numbers'] {
  const out: FightView['numbers'] = {};
  const started = group.find((e): e is Extract<BattleEvent, { type: 'combatStarted' }> => e.type === 'combatStarted');
  if (started) {
    const f = started.forecast;
    const pick = (c: typeof f.attacker) => ({ damage: c.damage, hit: c.hit, crit: c.crit, strikes: c.strikes });
    out[started.attackerId] = pick(f.attacker);
    out[started.defenderId] = f.counter ? pick(f.counter) : null;
    return out;
  }
  const used = group.find((e): e is Extract<BattleEvent, { type: 'powerUsed' }> => e.type === 'powerUsed');
  if (used) {
    const o = used.summary.odds[0];
    if (o) out[used.summary.bearerId] = { damage: o.damage, hit: o.hit, crit: o.crit, strikes: 1 };
    for (const id of used.summary.targetIds) out[id] = null;
  }
  return out;
}

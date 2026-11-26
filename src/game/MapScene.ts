// The battle map scene: terrain, highlights, unit tokens, the camera and touch
// input, and the in-map animations for core events. It implements Stage, so the
// controller tells it what to draw; it holds no rules.

import Phaser from 'phaser';
import { isBearer, unitBladeTier, weaponDef, type BattleEvent, type BattleState, type GameData, type Pos, type Unit } from '../core';
import { imageMeta, imageUrl } from '../art/manifest';
import propDefs from '../data/props.json';
import type { Overlay } from '../battle/selection';
import type { Stage, Timing } from '../battle/stage';
import { clampPose, centerOn, defaultTileCss, revealRect, zoomAround, NO_INSETS, type CameraPose, type Insets, type View } from './camera';
import { GestureTracker } from './gestures';
import { HIGHLIGHT, TEXT, TILE } from './palette';
import { buildGround, GROUND_PX } from './ground';
import { groundKeys, type GroundInput } from './groundPlan';
import { UnitToken } from './token';
import { tweenDone } from './tween';

/** What the scene needs from the controller. */
export interface SceneInput {
  tapTile(pos: Pos): void;
  attachStage(stage: Stage): void;
  start(): Promise<void>;
}

/** Smallest default tile: a 10 to 12 column map fits the width of a 375 px phone at this size or larger. */
const MIN_TILE_CSS = 36;
/** Default tile when even the width does not fit at MIN_TILE_CSS; the camera then opens on the player's units. */
const FALLBACK_TILE_CSS = 44;
const MAX_TILE_CSS = 64;
const ZOOM_MAX_CSS = 112;
const TAP_SLOP_CSS = 10;
const REVEAL_MARGIN_CSS = 12;
/** Tiles of free space above the map, for the heads of units on its top row. */
const HEADROOM = 0.3;

/** Texture key of the main character's token, composed at runtime from their look (see src/art/mc). */
export const MC_TOKEN_KEY = 'token.mc';

/** A tall prop on a tile where a unit stands fades to this, so the unit stays readable. */
const PROP_UNDER_UNIT_ALPHA = 0.35;
/** The point under a prop's contact shadow sits this far down its tile. */
const PROP_GROUND = 0.84;

interface PropDef {
  name: string;
  size: 'small' | 'tall';
  terrains: string[];
}
const PROPS = propDefs as Record<string, PropDef>;

const tileCenter = (p: Pos): { x: number; y: number } => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });

export class MapScene extends Phaser.Scene implements Stage {
  private tokens = new Map<string, UnitToken>();
  private walkIds = new Map<string, number>();
  private highlights!: Phaser.GameObjects.Graphics;
  private targetMarks!: Phaser.GameObjects.Graphics;
  private gestures: GestureTracker;
  private cssInsets: Insets = NO_INSETS;
  private cameraTouched = false;
  /** The selected tile, kept in view when the layout changes. */
  private cursor: Pos | null = null;
  private lastState: BattleState;
  private pendingOverlay: Overlay | null = null;
  /** Set by the first tap, pan or zoom; until then a layout change refits the default view. */
  private interacted = false;
  /** Tall props, faded while a unit stands on their tile. */
  private tallProps: { image: Phaser.GameObjects.Image; x: number; y: number }[] = [];

  constructor(
    initial: BattleState,
    private readonly gameData: GameData,
    private readonly input0: SceneInput,
    private readonly dpr: number,
    /** The composed token of the main character, or null to use the class token or placeholder. */
    private readonly mcToken: HTMLCanvasElement | null = null,
  ) {
    super('map');
    this.lastState = initial;
    this.gestures = new GestureTracker(TAP_SLOP_CSS * dpr);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  preload(): void {
    const s = this.lastState;
    const classIds = new Set(s.units.map((u) => u.classId));
    for (const w of s.reinforcements) for (const u of w.units) classIds.add(u.classId);
    const ids = groundKeys(this.groundInput())
      .concat([...classIds].map((c) => `token.${c}`))
      .concat([...new Set(this.mapProps().map((p) => `prop.${p.id}`))]);
    for (const id of ids) {
      const url = imageUrl(id);
      if (url) this.load.image(id, url);
    }
  }

  create(): void {
    const s = this.lastState;
    if (this.mcToken && !this.textures.exists(MC_TOKEN_KEY)) this.textures.addCanvas(MC_TOKEN_KEY, this.mcToken);
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    this.drawMap(s);
    this.highlights = this.add.graphics().setDepth(5);
    this.targetMarks = this.add.graphics().setDepth(6);
    this.tweens.add({ targets: this.targetMarks, alpha: 0.45, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.input.addPointer(2);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.gestures.down(p.id, p.x, p.y));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onGesture(this.gestures.move(p.id, p.x, p.y)));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onGesture(this.gestures.up(p.id, p.x, p.y)));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onGesture(this.gestures.up(p.id, p.x, p.y, true)));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.cameraTouched = true;
      this.setPose(zoomAround(this.pose(), this.pose().zoom * (dy > 0 ? 0.9 : 1.1), p.x, p.y));
    });
    this.scale.on('resize', () => this.relayout());
    this.fitCamera();
    this.input0.attachStage(this);
    if (this.pendingOverlay) this.setOverlay(this.pendingOverlay);
    void this.input0.start();
  }

  private groundInput(): GroundInput {
    const s = this.lastState;
    return { mapId: s.mapId, width: s.map.width, height: s.map.height, terrain: s.map.terrain };
  }

  private mapProps(): { id: string; x: number; y: number }[] {
    return this.gameData.maps[this.lastState.mapId]?.props ?? [];
  }

  private drawMap(s: BattleState): void {
    buildGround(this, this.groundInput());
    const grid = this.add.graphics().setDepth(1);
    grid.lineStyle(2, 0x000000, 0.3);
    for (let x = 0; x <= s.map.width; x++) grid.lineBetween(x * TILE, 0, x * TILE, s.map.height * TILE);
    for (let y = 0; y <= s.map.height; y++) grid.lineBetween(0, y * TILE, s.map.width * TILE, y * TILE);
    this.drawProps();
  }

  /** Props stand on the lower middle of their tile, depth sorted with the units: a unit on the row behind (above)
   * is drawn first, so a tall prop covers its feet but never its HP bar, which lives on the overlay layer. */
  private drawProps(): void {
    let missing: Phaser.GameObjects.Graphics | null = null;
    for (const p of this.mapProps()) {
      const key = `prop.${p.id}`;
      const depth = 10 + p.y * 0.01 - 0.005;
      const gx = (p.x + 0.5) * TILE;
      const gy = (p.y + PROP_GROUND) * TILE;
      const meta = imageMeta(key);
      if (!this.textures.exists(key) || !meta) {
        missing ??= this.add.graphics().setDepth(2);
        missing.fillStyle(0x2a2620, 0.9);
        missing.fillEllipse(gx, gy - TILE * 0.12, TILE * 0.36, TILE * 0.24);
        continue;
      }
      const img = this.add
        .image(gx, gy, key)
        .setOrigin((meta.anchorX ?? meta.width / 2) / meta.width, (meta.groundY ?? meta.height) / meta.height)
        .setScale(TILE / GROUND_PX)
        .setDepth(depth);
      if (PROPS[p.id]?.size === 'tall') this.tallProps.push({ image: img, x: p.x, y: p.y });
    }
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  private view(): View {
    const d = this.dpr;
    const i = this.cssInsets;
    return { width: this.scale.width, height: this.scale.height, insets: { top: i.top * d, right: i.right * d, bottom: i.bottom * d, left: i.left * d } };
  }

  /** The view for clamping: a strip above the map stays scrollable, so a unit on the top row (whose head reaches
   * above its tile) is not cut off by the edge of the canvas. */
  private clampView(zoom: number): View {
    const v = this.view();
    return { ...v, insets: { ...v.insets, top: v.insets.top + TILE * HEADROOM * zoom } };
  }

  private mapSize(): { w: number; h: number } {
    return { w: this.lastState.map.width * TILE, h: this.lastState.map.height * TILE };
  }

  private pose(): CameraPose {
    const cam = this.cameras.main;
    return { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY };
  }

  private zoomLimits(): { min: number; max: number } {
    const v = this.view();
    const freeW = (v.width - v.insets.left - v.insets.right) / this.dpr;
    const freeH = (v.height - v.insets.top - v.insets.bottom) / this.dpr;
    const fit = Math.min(freeW / this.lastState.map.width, freeH / this.lastState.map.height);
    const toZoom = (css: number) => (css * this.dpr) / TILE;
    return { min: toZoom(Math.max(16, Math.min(FALLBACK_TILE_CSS, fit))), max: toZoom(ZOOM_MAX_CSS) };
  }

  private setPose(p: CameraPose): void {
    const { min, max } = this.zoomLimits();
    const zoom = Math.min(max, Math.max(min, p.zoom));
    const scaled = zoom === p.zoom ? p : zoomAround(p, zoom, this.scale.width / 2, this.scale.height / 2);
    const { w, h } = this.mapSize();
    const c = clampPose(scaled, w, h, this.clampView(scaled.zoom));
    const cam = this.cameras.main;
    cam.setZoom(c.zoom);
    cam.setScroll(c.scrollX, c.scrollY);
  }

  /** Default view: the zoom from defaultTileCss, centered on the player's units, the lord in view. The clamp keeps
   * the map inside the area the bars leave free, so no row is hidden under them. */
  private fitCamera(): void {
    const v = this.view();
    const s = this.lastState;
    const css = defaultTileCss(
      s.map.width,
      s.map.height,
      (v.width - v.insets.left - v.insets.right) / this.dpr,
      (v.height - v.insets.top - v.insets.bottom) / this.dpr,
      MIN_TILE_CSS,
      MAX_TILE_CSS,
      FALLBACK_TILE_CSS,
    );
    const zoom = (css * this.dpr) / TILE;
    const { w, h } = this.mapSize();
    const team = s.units.filter((u) => u.alive && u.team === 'player');
    let pose: CameraPose;
    if (team.length > 0) {
      const xs = team.map((u) => u.pos.x);
      const ys = team.map((u) => u.pos.y);
      const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE;
      const cy = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * TILE;
      pose = centerOn(zoom, cx, cy, v);
    } else pose = centerOn(zoom, w / 2, h / 2, v);
    // On an axis where the whole map fits, center the map instead.
    const mid = centerOn(zoom, w / 2, h / 2, v);
    if (w * zoom <= v.width - v.insets.left - v.insets.right) pose = { ...pose, scrollX: mid.scrollX };
    if ((h + TILE * HEADROOM) * zoom <= v.height - v.insets.top - v.insets.bottom) pose = { ...pose, scrollY: mid.scrollY - (TILE * HEADROOM) / 2 };
    const lord = s.units.find((u) => u.isLord && u.alive);
    if (lord) pose = revealRect(pose, lord.pos.x * TILE, lord.pos.y * TILE, TILE, TILE, v, REVEAL_MARGIN_CSS * this.dpr);
    this.setPose(pose);
  }

  /** The screen changed size: refit until the player has touched the map, else keep the view. */
  private relayout(): void {
    if (this.interacted || this.cameraTouched) this.keepInView();
    else this.fitCamera();
  }

  /** Clamp to the new layout and keep the highlighted tile clear of the overlays. */
  private keepInView(): void {
    this.tweens.killTweensOf(this.cameras.main);
    this.setPose(this.pose());
    if (this.cursor) void this.reveal([this.cursor], 0);
  }

  /** CSS pixels covered by the overlays. Panels open and close often, so this never refits. */
  setInsets(insets: Insets): void {
    this.cssInsets = insets;
    if (!this.sys.isActive()) return;
    // The bars are measured after the scene starts: until the player touches the map, frame it again.
    if (this.interacted || this.cameraTouched) this.keepInView();
    else this.fitCamera();
  }

  /** Pan so the tiles are in the uncovered view. */
  private reveal(tiles: Pos[], ms: number): Promise<void> {
    if (tiles.length === 0) return Promise.resolve();
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x0 = Math.min(...xs) * TILE;
    const y0 = Math.min(...ys) * TILE;
    const target = revealRect(this.pose(), x0, y0, (Math.max(...xs) + 1) * TILE - x0, (Math.max(...ys) + 1) * TILE - y0, this.view(), REVEAL_MARGIN_CSS * this.dpr);
    const { w, h } = this.mapSize();
    const c = clampPose(target, w, h, this.clampView(target.zoom));
    const cam = this.cameras.main;
    if (Math.abs(c.scrollX - cam.scrollX) < 1 && Math.abs(c.scrollY - cam.scrollY) < 1) return Promise.resolve();
    if (ms <= 0) {
      cam.setScroll(c.scrollX, c.scrollY);
      return Promise.resolve();
    }
    return tweenDone(this, { targets: cam, scrollX: c.scrollX, scrollY: c.scrollY, ease: 'Sine.easeInOut' }, ms);
  }

  /** Instantly bring a tile into view (test hook). */
  revealTile(pos: Pos): void {
    if (!this.sys.isActive()) return;
    this.tweens.killTweensOf(this.cameras.main);
    void this.reveal([pos], 0);
  }

  /** True when no camera pan is running. */
  cameraIdle(): boolean {
    return !this.sys.isActive() || !this.tweens.isTweening(this.cameras.main);
  }

  /** CSS client coordinates of a tile's center. */
  tileToClient(pos: Pos): { x: number; y: number } | null {
    if (!this.sys.isActive()) return null;
    const rect = this.game.canvas.getBoundingClientRect();
    const cam = this.cameras.main;
    const c = tileCenter(pos);
    return { x: rect.left + ((c.x - cam.scrollX) * cam.zoom) / this.dpr, y: rect.top + ((c.y - cam.scrollY) * cam.zoom) / this.dpr };
  }

  /** Default-zoom tile size in CSS pixels right now. */
  tileCss(): number {
    return (TILE * this.cameras.main.zoom) / this.dpr;
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private onGesture(g: ReturnType<GestureTracker['move']>): void {
    if (!g) return;
    this.interacted = true;
    const p = this.pose();
    if (g.kind === 'pan') {
      this.cameraTouched = true;
      this.tweens.killTweensOf(this.cameras.main);
      this.setPose({ zoom: p.zoom, scrollX: p.scrollX - g.dx / p.zoom, scrollY: p.scrollY - g.dy / p.zoom });
    } else if (g.kind === 'pinch') {
      this.cameraTouched = true;
      this.tweens.killTweensOf(this.cameras.main);
      const z = zoomAround(p, p.zoom * g.scale, g.cx, g.cy);
      this.setPose({ zoom: z.zoom, scrollX: z.scrollX - g.dx / z.zoom, scrollY: z.scrollY - g.dy / z.zoom });
    } else {
      const wx = g.x / p.zoom + p.scrollX;
      const wy = g.y / p.zoom + p.scrollY;
      this.input0.tapTile({ x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) });
    }
  }

  // -------------------------------------------------------------------------
  // Stage
  // -------------------------------------------------------------------------

  private textResolution(): number {
    return Math.min(4, Math.ceil(this.dpr * 2));
  }

  private tokenFor(u: Unit): UnitToken {
    let t = this.tokens.get(u.id);
    if (!t) {
      const cls = this.gameData.classes[u.classId];
      const weapon = u.weaponId ? (weaponDef(u.weaponId, this.gameData) ?? undefined) : undefined;
      const key = u.isLord && u.team === 'player' && this.textures.exists(MC_TOKEN_KEY) ? MC_TOKEN_KEY : `token.${u.classId}`;
      t = new UnitToken(
        this,
        {
          team: u.team,
          initial: (cls?.name ?? u.name).charAt(0).toUpperCase(),
          school: weapon?.school ?? cls?.school ?? 'none',
          isLord: u.isLord,
          isBoss: u.isBoss,
          texture: this.textures.exists(key) ? key : null,
          awakened: unitBladeTier(this.lastState, u, this.gameData) >= 2,
        },
        u.stats.hp,
        u.hp,
        this.textResolution(),
      );
      t.setDepth(10);
      const c = tileCenter(u.pos);
      t.setPosition(c.x, c.y);
      this.tokens.set(u.id, t);
    }
    return t;
  }

  /** The texture a unit's token shows (null for a placeholder or no token yet). For the test hook. */
  tokenTexture(unitId: string): string | null {
    return this.tokens.get(unitId)?.textureKey ?? null;
  }

  update(): void {
    for (const t of this.tokens.values()) t.syncOverlay();
    if (this.tallProps.length > 0) {
      const taken = new Set<string>();
      for (const t of this.tokens.values()) if (t.visible) taken.add(`${Math.floor(t.x / TILE)},${Math.floor(t.y / TILE)}`);
      for (const p of this.tallProps) p.image.setAlpha(taken.has(`${p.x},${p.y}`) ? PROP_UNDER_UNIT_ALPHA : 1);
    }
  }

  sync(state: BattleState): void {
    this.lastState = state;
    for (const u of state.units) {
      const t = this.tokenFor(u);
      this.tweens.killTweensOf(t);
      this.walkIds.delete(u.id);
      const c = tileCenter(u.pos);
      t.setPosition(c.x, c.y).setScale(1).setAlpha(1).setVisible(u.alive);
      t.setDepth(10 + u.pos.y * 0.01);
      t.setActed(u.acted);
      t.setTeam(u.team);
      t.setMaxHp(u.stats.hp);
      void t.tweenHp(u.hp, 0);
      this.syncResolve(t, u);
    }
  }

  private syncResolve(t: UnitToken, u: Unit): void {
    t.setResolve(isBearer(u, this.gameData) ? u.resolve / this.gameData.balance.resolve.max : null);
  }

  /** Snap tokens to what a battle scene showed: HP, falls, gauges. No animation, and the camera stays put. */
  settle(events: readonly BattleEvent[], state: BattleState): void {
    this.lastState = state;
    for (const ev of events) {
      if (ev.type === 'strike') void this.tokens.get(ev.defenderId)?.tweenHp(ev.hpAfter, 0);
      else if (ev.type === 'unitHealed') void this.tokens.get(ev.unitId)?.tweenHp(ev.hpAfter, 0);
      else if (ev.type === 'unitDefeated') this.tokens.get(ev.unitId)?.setVisible(false);
      else if (ev.type === 'resolveChanged') {
        const u = state.units.find((x) => x.id === ev.unitId);
        const t = this.tokens.get(ev.unitId);
        if (u && t) t.setResolve(ev.resolveAfter / this.gameData.balance.resolve.max);
      }
    }
  }

  setOverlay(o: Overlay): void {
    if (!this.highlights) {
      this.pendingOverlay = o;
      return;
    }
    const g = this.highlights;
    g.clear();
    const fill = (tiles: Pos[], c: { fill: number; alpha: number; line: number }) => {
      for (const p of tiles) {
        g.fillStyle(c.fill, c.alpha);
        g.fillRect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2);
        g.lineStyle(2, c.line, 0.55);
        g.strokeRect(p.x * TILE + 3, p.y * TILE + 3, TILE - 6, TILE - 6);
      }
    };
    fill(o.danger, HIGHLIGHT.danger);
    fill(o.attack, HIGHLIGHT.attack);
    fill(o.heal, HIGHLIGHT.heal);
    fill(o.move, HIGHLIGHT.move);
    if (o.cursor) {
      g.lineStyle(4, HIGHLIGHT.cursor, 1);
      g.strokeRoundedRect(o.cursor.x * TILE + 3, o.cursor.y * TILE + 3, TILE - 6, TILE - 6, 8);
    }
    const m = this.targetMarks;
    m.clear();
    for (const p of o.targets) {
      m.fillStyle(HIGHLIGHT.target.fill, HIGHLIGHT.target.alpha);
      m.fillRect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2);
      m.lineStyle(4, HIGHLIGHT.target.line, 1);
      m.strokeRect(p.x * TILE + 3, p.y * TILE + 3, TILE - 6, TILE - 6);
    }
    this.cursor = o.cursor;
    if (o.cursor) void this.reveal([o.cursor], 160);
  }

  preview(unitId: string, path: Pos[] | null, timing: Timing): void {
    const t = this.tokens.get(unitId);
    const u = this.lastState.units.find((x) => x.id === unitId);
    if (!t || !u) return;
    if (!path) {
      this.walkIds.set(unitId, (this.walkIds.get(unitId) ?? 0) + 1);
      this.tweens.killTweensOf(t);
      const c = tileCenter(u.pos);
      t.setPosition(c.x, c.y);
      return;
    }
    void this.walk(t, unitId, path, timing.ms(55));
  }

  /** Walk a token along a path. A newer walk or preview for the same unit stops this one. */
  private async walk(t: UnitToken, unitId: string, path: Pos[], stepMs: number): Promise<void> {
    const id = (this.walkIds.get(unitId) ?? 0) + 1;
    this.walkIds.set(unitId, id);
    this.tweens.killTweensOf(t);
    const start = path[0];
    if (start) t.setPosition(tileCenter(start).x, tileCenter(start).y);
    for (const step of path.slice(1)) {
      if (this.walkIds.get(unitId) !== id) return;
      const c = tileCenter(step);
      await this.tween(t, { x: c.x, y: c.y }, stepMs, 'Linear');
      t.setDepth(10 + step.y * 0.01);
    }
    const end = path[path.length - 1];
    if (end && this.walkIds.get(unitId) === id) t.setDepth(10 + end.y * 0.01);
  }

  private tween(target: object, props: Record<string, number>, ms: number, ease = 'Sine.easeOut', yoyo = false): Promise<void> {
    if (ms <= 0) {
      if (!yoyo) Object.assign(target, props);
      return Promise.resolve();
    }
    return tweenDone(this, { targets: target, ...props, ease, yoyo }, ms);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private floatText(at: { x: number; y: number }, text: string, color: string, size: number, ms: number): void {
    if (ms <= 0) return;
    const label = this.add
      .text(at.x, at.y - TILE * 0.35, text, {
        fontFamily: 'Georgia, serif',
        fontSize: `${size}px`,
        fontStyle: 'bold',
        color,
        stroke: TEXT.stroke,
        strokeThickness: 5,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({ targets: label, y: label.y - TILE * 0.55, duration: ms, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, delay: ms * 0.6, duration: ms * 0.4, onComplete: () => label.destroy() });
  }

  private unitPos(id: string): Pos | null {
    return this.lastState.units.find((u) => u.id === id)?.pos ?? null;
  }

  async play(ev: BattleEvent, state: BattleState, t: Timing): Promise<void> {
    switch (ev.type) {
      case 'unitMoved': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        const end = tileCenter(ev.to);
        if (Math.abs(tok.x - end.x) < 1 && Math.abs(tok.y - end.y) < 1) return; // already previewed there
        await this.reveal([ev.from], t.ms(220));
        await this.walk(tok, ev.unitId, ev.path, t.ms(t.reduced ? 40 : 110));
        return;
      }
      case 'combatStarted': {
        const a = this.unitPos(ev.attackerId);
        const d = this.unitPos(ev.defenderId);
        // Use the post-action state: the attacker may have just moved.
        const aNow = state.units.find((u) => u.id === ev.attackerId)?.pos ?? a;
        await this.reveal([aNow, d].filter((p): p is Pos => p !== null), t.ms(220));
        await this.sleep(t.ms(120));
        return;
      }
      case 'strike':
        await this.strike(ev, t);
        return;
      case 'combatEnded':
        await this.sleep(t.ms(200));
        return;
      case 'unitDefeated': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        await this.tween(tok, { alpha: 0, scale: 0.6 }, t.ms(450), 'Quad.easeIn');
        tok.setVisible(false);
        return;
      }
      case 'xpGained': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok || ev.amount <= 0) return;
        this.floatText(tok, `+${ev.amount} XP`, TEXT.xp, 20, t.ms(800));
        await this.sleep(t.ms(500));
        return;
      }
      case 'unitHealed': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        await this.reveal([state.units.find((u) => u.id === ev.unitId)!.pos], t.ms(200));
        this.floatText(tok, `+${ev.amount}`, TEXT.heal, 28, t.ms(800));
        await tok.tweenHp(ev.hpAfter, t.ms(350));
        await this.sleep(t.ms(200));
        return;
      }
      case 'unitActed':
        this.tokens.get(ev.unitId)?.setActed(true);
        return;
      case 'reinforcementsArrived': {
        const fresh = state.units.filter((u) => ev.unitIds.includes(u.id));
        await this.reveal(fresh.slice(0, 1).map((u) => u.pos), t.ms(300));
        const toks = fresh.map((u) => {
          const tok = this.tokenFor(u);
          tok.setActed(u.acted);
          tok.setAlpha(t.ms(1) > 0 ? 0 : 1);
          return tok;
        });
        await Promise.all(toks.map((tok) => this.tween(tok, { alpha: 1 }, t.ms(500))));
        return;
      }
      case 'battleEnded':
        await this.sleep(t.ms(400));
        return;
      case 'unitLeft': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        await this.tween(tok, { alpha: 0 }, t.ms(450));
        tok.setVisible(false);
        return;
      }
      case 'unitTeamChanged': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        tok.setTeam(ev.to);
        tok.setActed(state.units.find((u) => u.id === ev.unitId)?.acted ?? false);
        tok.hitFlash(t.ms(300));
        await this.sleep(t.ms(300));
        return;
      }
      case 'powerUsed': {
        // The cut-in has announced it; on the map, the name rises over the bearer.
        const tok = this.tokens.get(ev.summary.bearerId);
        if (!tok) return;
        await this.reveal([ev.summary.from, ...ev.summary.tiles.slice(0, 1)], t.ms(220));
        const name = this.gameData.powers[ev.summary.powerId]?.name ?? ev.summary.powerId;
        this.floatText(tok, name, TEXT.crit, 24, t.ms(900));
        await this.sleep(t.ms(260));
        return;
      }
      case 'resolveChanged': {
        const tok = this.tokens.get(ev.unitId);
        tok?.setResolve(ev.resolveAfter / this.gameData.balance.resolve.max);
        return;
      }
      case 'devourStack': {
        const tok = this.tokens.get(ev.unitId);
        if (tok) this.floatText(tok, `Atk +${ev.attackBonus}`, TEXT.heal, 20, t.ms(800));
        await this.sleep(t.ms(300));
        return;
      }
      case 'unitDamaged': {
        const tok = this.tokens.get(ev.unitId);
        if (!tok) return;
        this.floatText(tok, `${ev.amount}`, TEXT.damage, 30, t.ms(800));
        await tok.tweenHp(ev.hpAfter, t.ms(350));
        return;
      }
      default:
        return;
    }
  }

  private async strike(ev: Extract<BattleEvent, { type: 'strike' }>, t: Timing): Promise<void> {
    const a = this.tokens.get(ev.attackerId);
    const d = this.tokens.get(ev.defenderId);
    if (!a || !d) return;
    const home = { x: a.x, y: a.y };
    const len = Math.hypot(d.x - a.x, d.y - a.y) || 1;
    const reach = t.reduced ? 0 : TILE * 0.32;
    a.setDepth(20);
    await this.tween(a, { x: home.x + ((d.x - a.x) / len) * reach, y: home.y + ((d.y - a.y) / len) * reach }, t.ms(130), 'Quad.easeOut');
    if (!ev.hit) {
      this.floatText(d, 'Miss', TEXT.miss, 24, t.ms(800));
    } else {
      d.hitFlash(t.ms(220));
      if (ev.crit) {
        this.floatText(d, `Crit ${ev.damage}`, TEXT.crit, 34, t.ms(900));
        if (!t.reduced && t.ms(1) > 0) this.cameras.main.shake(t.ms(260), 0.012);
      } else {
        this.floatText(d, `${ev.damage}`, TEXT.damage, 30, t.ms(800));
      }
    }
    const hp = ev.hit ? d.tweenHp(ev.hpAfter, t.ms(320)) : Promise.resolve();
    await this.tween(a, { x: home.x, y: home.y }, t.ms(150), 'Quad.easeIn');
    a.setDepth(10 + (this.unitPos(ev.attackerId)?.y ?? 0) * 0.01);
    await hp;
    await this.sleep(t.ms(220));
  }
}

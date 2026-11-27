// The side-view battle scene. A Phaser scene over the map scene in the same game: it draws the backdrop, the two
// fighters (four poses each, swapped on a shared feet anchor) and the effects, and plays a FightScript from
// src/battle/fightTimeline.ts step by step. It holds no rules and never touches the battle state. Effects are
// drawn in code: slash arcs, thrusts, chops, arrows, light bolts, censer smoke, needles, sparks and glows.

import Phaser from 'phaser';
import type { BattleState, GameData, School, Unit } from '../core';
import { imageMeta, imageUrl } from '../art/manifest';
import { composeMcPortrait, composeMcPose, copyMc } from '../art/mc/compose';
import { lookKey, type McLook } from '../art/mc/look';
import { battleArt, BATTLE_POSES, portraitId, type BattlePose } from '../ui/artMap';
import type { Fighter, FightScript, FxKind, SceneStep } from '../battle/fightTimeline';
import type { FightPlayOptions, FightStage } from '../battle/stage';
import { backdropPlacement, fightLayout, type FightLayout } from './fightLayout';
import { TEAM_COLORS } from './palette';

/** Effect colors per school (the UI tokens --c-heavy, --c-swift, --c-arcane), and for healers. */
const SCHOOL_FX: Record<School, number> = { heavy: 0xec9450, swift: 0x52c8bc, arcane: 0xb49cff, none: 0xf4e2a8 };
const HEAL_FX = 0x9cf0a8;
const DRAIN_FX = 0xd8303a;
const GHOST_TINT = 0xa8d0ff;
const AWAKENED_FX = 0xcfe8ff;
const POSE_CANVAS = { w: 512, h: 384, anchorX: 192, groundY: 360, figure: 240 };
const FALLBACK_BACKDROP = 'village';
const FONT = 'Cinzel, Georgia, serif';

interface Actor {
  f: Fighter;
  unit: Unit;
  c: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  /** 1 faces right (the left side), -1 faces left. */
  facing: 1 | -1;
  homeX: number;
  homeY: number;
  scale: number;
  art: ReturnType<typeof battleArt>;
  down: boolean;
}

export class FightScene extends Phaser.Scene implements FightStage {
  private layout!: FightLayout;
  private actors = new Map<string, Actor>();
  private objects: Phaser.GameObjects.GameObject[] = [];
  private finish: (() => void) | null = null;
  private opts: FightPlayOptions | null = null;
  private ready = false;
  private whenReady: (() => void)[] = [];
  /** Portrait URLs already decoded for the HUD. */
  private warmed = new Set<string>();

  constructor(
    private readonly dpr: number,
    private readonly gameData: GameData,
    private readonly look: McLook,
  ) {
    super({ key: 'fight', active: true });
  }

  create(): void {
    this.cameras.main.setRoundPixels(false);
    this.makeFxTextures();
    this.warmUp();
    this.ready = true;
    for (const fn of this.whenReady.splice(0)) fn();
  }

  private untilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.whenReady.push(resolve));
  }

  /**
   * Draw one of each effect off screen for a frame, so the first impact of the first scene does not pay for the
   * font, the particle emitter and the curves (measured as a 80 to 100 ms frame before this).
   */
  private warmUp(): void {
    const off = -10000;
    const objs: Phaser.GameObjects.GameObject[] = [
      this.add.text(off, off, '0123456789!+Miss CRITICAL falls', { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 6 }),
      this.add.particles(off, off, 'fx.spark', { lifespan: 50, speed: 10, emitting: false }),
      this.add.particles(off, off, 'fx.dot', { lifespan: 50, speed: 10, emitting: false, blendMode: 'ADD' }),
      this.add.graphics().lineStyle(4, 0xffffff, 1).beginPath().arc(off, off, 20, 0, 2).strokePath(),
      this.add.circle(off, off, 10, 0xffffff, 0.5).setStrokeStyle(2, 0xffffff),
    ];
    for (const o of objs) if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) o.explode(4);
    this.time.delayedCall(120, () => objs.forEach((o) => o.destroy()));
  }

  /** Small textures for particles, made once. */
  private makeFxTextures(): void {
    if (!this.textures.exists('fx.dot')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      for (let r = 16; r > 0; r -= 2) {
        g.fillStyle(0xffffff, (1 - r / 16) * 0.35 + 0.1);
        g.fillCircle(16, 16, r);
      }
      g.generateTexture('fx.dot', 32, 32);
      g.clear();
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 2, 24, 3);
      g.fillStyle(0xffffff, 0.5);
      g.fillRect(0, 0, 24, 7);
      g.generateTexture('fx.spark', 24, 7);
      g.destroy();
    }
  }

  // -------------------------------------------------------------------------
  // Art
  // -------------------------------------------------------------------------

  private poseKey(a: ReturnType<typeof battleArt>, team: string, pose: BattlePose): string {
    if (a.kind === 'sheet') return `battle.${a.sheet}.${pose}`;
    if (a.kind === 'mc') return `fight.mc.${lookKey(this.look)}.${a.style}.${pose}`;
    return `fight.placeholder.${team}`;
  }

  async prepare(script: FightScript, state: BattleState): Promise<void> {
    await this.untilReady();
    const loads: Promise<void>[] = [];
    let queued = false;
    for (const f of script.fighters) {
      const unit = state.units.find((u) => u.id === f.unitId);
      if (!unit) continue;
      const art = battleArt(unit);
      // The HUD's medallions: decode the portrait (or compose the main character's) now, not on the first frame.
      loads.push(this.warmPortrait(unit, art.kind === 'mc'));
      if (art.kind === 'placeholder') {
        this.placeholderTexture(unit.team);
        continue;
      }
      for (const pose of BATTLE_POSES) {
        const key = this.poseKey(art, unit.team, pose);
        if (this.textures.exists(key)) continue;
        if (art.kind === 'sheet') {
          const url = imageUrl(key);
          if (url) {
            this.load.image(key, url);
            queued = true;
          }
        } else {
          loads.push(
            composeMcPose(this.look, art.style, pose).then(
              (canvas) => {
                if (this.textures.exists(key)) return;
                this.textures.addCanvas(key, copyMc(canvas));
              },
              () => undefined,
            ),
          );
        }
      }
    }
    const bd = this.backdropKey(state);
    if (bd && !this.textures.exists(bd)) {
      const url = imageUrl(bd);
      if (url) {
        this.load.image(bd, url);
        queued = true;
      }
    }
    if (queued) {
      loads.push(
        new Promise<void>((resolve) => {
          this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
          this.load.start();
        }),
      );
    }
    await Promise.all(loads);
  }

  private warmPortrait(unit: Unit, mc: boolean): Promise<void> {
    if (mc) return composeMcPortrait(this.look, 'neutral').then(
      () => undefined,
      () => undefined,
    );
    const id = portraitId(unit);
    const url = id ? imageUrl(id) : undefined;
    if (!url || this.warmed.has(url)) return Promise.resolve();
    this.warmed.add(url);
    const img = new Image();
    img.src = url;
    return img.decode().catch(() => undefined);
  }

  private backdropKey(state: BattleState): string | null {
    const id = this.gameData.maps[state.mapId]?.backdrop ?? FALLBACK_BACKDROP;
    for (const key of [`backdrop.${id}`, `backdrop.${FALLBACK_BACKDROP}`]) if (imageMeta(key)) return key;
    return null;
  }

  /** A hooded figure in team color on the pose canvas, feet on the shared anchor: units with no pose art. */
  private placeholderTexture(team: Unit['team']): void {
    const key = `fight.placeholder.${team}`;
    if (this.textures.exists(key)) return;
    const { w, h, anchorX: ax, groundY: gy } = POSE_CANVAS;
    const tex = this.textures.createCanvas(key, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    const col = TEAM_COLORS[team];
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = hex(col.fill);
    ctx.strokeStyle = '#0c0a0f';
    ctx.lineWidth = 6;
    ctx.beginPath();
    // Cloak and body.
    ctx.moveTo(ax - 52, gy);
    ctx.lineTo(ax - 38, gy - 150);
    ctx.quadraticCurveTo(ax, gy - 185, ax + 38, gy - 150);
    ctx.lineTo(ax + 52, gy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Hooded head.
    ctx.beginPath();
    ctx.arc(ax + 4, gy - 200, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0c0a0f';
    ctx.beginPath();
    ctx.arc(ax + 14, gy - 196, 17, -0.9, 1.6);
    ctx.fill();
    // A blade held forward.
    ctx.strokeStyle = hex(col.rim);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(ax + 30, gy - 105);
    ctx.lineTo(ax + 120, gy - 150);
    ctx.stroke();
    tex.refresh();
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------

  skip(): void {
    this.finish?.();
  }

  play(script: FightScript, state: BattleState, opts: FightPlayOptions): Promise<void> {
    this.finish?.();
    this.opts = opts;
    const css = { w: this.scale.width / this.dpr, h: this.scale.height / this.dpr };
    this.layout = fightLayout(css.w, css.h);
    this.cameras.main.setScroll(0, 0);
    this.build(script, state);
    return new Promise<void>((resolve) => {
      let done = false;
      // The map is covered (by the band, and by the HUD and a dark veil in portrait): stop drawing it meanwhile.
      this.scene.setVisible(false, 'map');
      const end = () => {
        if (done) return;
        done = true;
        this.finish = null;
        this.scene.setVisible(true, 'map');
        this.time.removeAllEvents();
        this.tweens.killAll();
        this.cameras.main.resetFX();
        this.clear();
        resolve();
      };
      this.finish = end;
      for (const step of script.steps) this.time.delayedCall(step.at * opts.scale, () => this.run(step));
      this.time.delayedCall(script.total * opts.scale + 30, end);
    });
  }

  /** CSS px to device px. */
  private px(v: number): number {
    return v * this.dpr;
  }

  private ms(base: number): number {
    return Math.max(1, Math.round(base * (this.opts?.scale ?? 1)));
  }

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private clear(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.actors.clear();
  }

  private build(script: FightScript, state: BattleState): void {
    this.clear();
    const L = this.layout;
    const band = { x: this.px(L.band.x), y: this.px(L.band.y), w: this.px(L.band.w), h: this.px(L.band.h) };
    const groundY = this.px(L.groundY);
    // Under the band in portrait: a dark field for the HUD (the map is hidden while the scene plays).
    if (!L.landscape) {
      this.keep(this.add.rectangle(0, band.h, this.scale.width, this.scale.height - band.h, 0x0c0a0f, 1).setOrigin(0, 0).setDepth(-2));
    }
    const bdKey = this.backdropKey(state);
    if (bdKey && this.textures.exists(bdKey)) {
      const src = this.textures.get(bdKey).getSourceImage() as { width: number; height: number };
      const p = backdropPlacement(band, groundY, src.width, src.height);
      const img = this.keep(this.add.image(p.x, p.y, bdKey).setOrigin(0, 0).setScale(p.scale).setDepth(0));
      // Crop to the band (in texture px).
      img.setCrop((band.x - p.x) / p.scale, (band.y - p.y) / p.scale, band.w / p.scale, band.h / p.scale);
    } else {
      const g = this.keep(this.add.graphics().setDepth(0));
      g.fillGradientStyle(0x2a2430, 0x2a2430, 0x15111a, 0x15111a, 1);
      g.fillRect(band.x, band.y, band.w, band.h);
      g.fillStyle(0x3a3128, 1);
      g.fillRect(band.x, groundY - this.px(8), band.w, band.y + band.h - groundY + this.px(8));
    }
    // A soft vignette and a line under the band.
    const v = this.keep(this.add.graphics().setDepth(1));
    v.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.45, 0.45, 0, 0);
    v.fillRect(band.x, band.y, band.w, band.h * 0.22);
    if (!L.landscape) {
      v.fillStyle(0x9c7f4a, 1);
      v.fillRect(band.x, band.y + band.h - this.px(2), band.w, this.px(2));
    }

    const figure = this.px(L.figure);
    const crowd = (side: 'left' | 'right') => script.fighters.filter((f) => f.side === side).length;
    for (const f of script.fighters) {
      const unit = state.units.find((u) => u.id === f.unitId);
      if (!unit) continue;
      const facing: 1 | -1 = f.side === 'left' ? 1 : -1;
      // Scatter's targets stand in a row across their half, a little smaller; their bearer steps back to the edge.
      const many = crowd(f.side);
      const other = crowd(f.side === 'left' ? 'right' : 'left');
      const slotScale = many > 1 ? 0.8 : 1;
      const scale = (figure / POSE_CANVAS.figure) * slotScale;
      // Distances from the side's own edge, as a fraction of the band.
      const span = L.landscape ? [0.44, 0.3, 0.16] : [0.48, 0.32, 0.16];
      const edge = L.landscape ? 0.26 : 0.2;
      let frac: number;
      if (many > 1) frac = span[f.slot] ?? 0.16;
      else if (other > 1) frac = edge;
      else frac = (f.side === 'left' ? L.leftX : L.band.w - L.rightX) / L.band.w;
      const homeX = this.px(L.band.w * (f.side === 'left' ? frac : 1 - frac) + L.band.x);
      const homeY = groundY - this.px(many > 1 ? f.slot * 4 : 0);
      const c = this.keep(this.add.container(homeX, homeY).setDepth(4 - f.slot * 0.1));
      const shadow = this.add.ellipse(0, 0, figure * 0.5 * slotScale, figure * 0.09 * slotScale, 0x000000, 0.5);
      const art = battleArt(unit);
      const img = this.add.image(0, 0, this.poseKey(art, unit.team, 'idle'));
      c.add([shadow, img]);
      const actor: Actor = { f, unit, c, img, shadow, facing, homeX, homeY, scale, art, down: false };
      this.setPose(actor, 'idle');
      this.actors.set(f.unitId, actor);
    }
  }

  /** Swap a fighter's pose. Every pose shares the feet anchor, so the swap never jumps. */
  private setPose(a: Actor, pose: BattlePose): void {
    const key = this.poseKey(a.art, a.unit.team, pose);
    const has = this.textures.exists(key);
    a.img.setTexture(has ? key : `fight.placeholder.${a.unit.team}`);
    if (!has) this.placeholderTexture(a.unit.team);
    const meta = a.art.kind === 'sheet' ? imageMeta(key) : undefined;
    const w = meta?.width ?? POSE_CANVAS.w;
    const h = meta?.height ?? POSE_CANVAS.h;
    const ax = (meta?.anchorX ?? POSE_CANVAS.anchorX) / w;
    const gy = (meta?.groundY ?? POSE_CANVAS.groundY) / h;
    // Mirrored fighters are scaled by -1 around the feet anchor, so their feet stay on the same point (flipX is
    // ignored for canvas textures, such as the composed main character, under WebGL).
    a.img.setOrigin(ax, gy).setScale(a.facing * a.scale, a.scale);
    // Placeholders have one picture: lean it per pose instead.
    const lean: Record<BattlePose, number> = { idle: 0, windup: -8, strike: 12, hit: -14 };
    a.img.setAngle(a.art.kind === 'placeholder' || !has ? lean[pose] * a.facing : 0);
  }

  /** A point on a fighter: its chest (0.55 of the figure up) or head top, in device px. */
  private point(a: Actor, up = 0.55): { x: number; y: number } {
    return { x: a.c.x + a.facing * this.px(6), y: a.c.y - a.scale * POSE_CANVAS.figure * up };
  }

  /** The front of the weapon hand, roughly: where shots leave from. */
  private hand(a: Actor): { x: number; y: number } {
    return { x: a.c.x + a.facing * 70 * a.scale, y: a.c.y - 130 * a.scale };
  }

  private run(step: SceneStep): void {
    switch (step.kind) {
      case 'intro':
        return this.intro(step.dur);
      case 'windup': {
        const a = this.actors.get(step.actor);
        if (!a) return;
        this.setPose(a, 'windup');
        this.raise(a);
        if (!this.calm()) this.tweens.add({ targets: a.c, x: a.homeX - a.facing * this.px(10), duration: this.ms(step.dur * 0.6), ease: 'Sine.easeOut' });
        return;
      }
      case 'strike':
        return this.strike(step);
      case 'projectile':
        return this.projectile(step);
      case 'impact':
        return this.impact(step);
      case 'miss':
        return this.miss(step);
      case 'recover':
        return this.recover(step);
      case 'defeat':
        return this.defeat(step);
      case 'heal':
        return this.heal(step);
      case 'outro':
        return this.outro(step.dur);
    }
  }

  private calm(): boolean {
    return this.opts?.calm ?? false;
  }

  private raise(a: Actor): void {
    for (const o of this.actors.values()) o.c.setDepth(4 - o.f.slot * 0.1);
    a.c.setDepth(5);
  }

  private intro(dur: number): void {
    const objs = this.objects.filter((o) => !(o instanceof Phaser.GameObjects.Container));
    for (const o of objs) {
      const t = o as unknown as { alpha: number; setAlpha(v: number): void };
      const target = t.alpha;
      t.setAlpha(0);
      this.tweens.add({ targets: o, alpha: target, duration: this.ms(dur * 0.4), ease: 'Sine.easeOut' });
    }
    const w = this.px(this.layout.band.w);
    for (const a of this.actors.values()) {
      a.c.setAlpha(0);
      if (!this.calm()) a.c.x = a.homeX - a.facing * w * 0.42;
      this.tweens.add({ targets: a.c, x: a.homeX, alpha: 1, duration: this.ms(dur), ease: 'Cubic.easeOut', delay: this.ms(a.f.slot * 40) });
    }
  }

  private outro(dur: number): void {
    for (const o of this.objects) this.tweens.add({ targets: o, alpha: 0, duration: this.ms(dur), ease: 'Sine.easeIn' });
  }

  private strike(step: Extract<SceneStep, { kind: 'strike' }>): void {
    const a = this.actors.get(step.actor);
    const t = this.actors.get(step.target);
    if (!a || !t) return;
    this.setPose(a, 'strike');
    this.raise(a);
    let toX = a.homeX + a.facing * this.px(6);
    if (step.motion === 'melee' && !this.calm()) {
      // Cross most of the gap, stopping short of the foe.
      const gap = Math.abs(t.c.x - a.homeX);
      toX = a.homeX + a.facing * Math.max(0, gap - this.px(this.layout.figure) * 0.55);
    } else if (!this.calm()) {
      toX = a.homeX - a.facing * this.px(6); // a little recoil
    }
    this.tweens.add({ targets: a.c, x: toX, duration: this.ms(step.dur), ease: step.motion === 'melee' ? 'Expo.easeOut' : 'Quad.easeOut' });
    if (step.ghost) this.ghost(a, toX);
    if (step.fx === 'mend') this.glowRing(this.hand(a), HEAL_FX, 0.6);
    // An Awakened blade leaves a cold glow along its swing.
    if (a.f.awakened && step.fx !== 'mend') {
      this.time.delayedCall(this.ms(Math.round(step.dur * 0.6)), () => this.glowRing(this.hand(a), AWAKENED_FX, 1.1));
    }
  }

  /** Echo's afterimage: a pale copy of the bearer follows the strike a beat later and fades. */
  private ghost(a: Actor, toX: number): void {
    // Two pale copies trail the bearer, a beat apart, and carry the strike on past it before they fade.
    for (const [i, lag] of [
      [0, 70],
      [1, 150],
    ] as const) {
      const g = this.keep(this.add.image(a.homeX, a.c.y, a.img.texture.key));
      g.setOrigin(a.img.originX, a.img.originY).setScale(a.facing * a.scale * (1.02 + i * 0.03), a.scale * (1.02 + i * 0.03)).setAngle(a.img.angle);
      g.setTintFill(GHOST_TINT).setAlpha(0.4 - i * 0.12).setDepth(a.c.depth - 0.05).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: g,
        x: toX + a.facing * this.px(44 + i * 26),
        duration: this.ms(200),
        delay: this.ms(lag),
        ease: 'Expo.easeOut',
      });
      this.tweens.add({ targets: g, alpha: 0, duration: this.ms(380), delay: this.ms(lag + 200), ease: 'Sine.easeIn' });
    }
    this.glowRing(this.point(a, 0.6), GHOST_TINT, 1.6);
  }

  private projectile(step: Extract<SceneStep, { kind: 'projectile' }>): void {
    const a = this.actors.get(step.actor);
    const t = this.actors.get(step.target);
    if (!a || !t) return;
    const from = this.hand(a);
    const to = this.point(t, 0.55);
    const color = SCHOOL_FX[a.f.school];
    const dur = this.ms(step.dur);
    const s = this.px(1);
    if (step.fx === 'arrow') {
      const g = this.keep(this.add.graphics().setDepth(7));
      g.lineStyle(3 * s, 0xe8dcc0, 1).lineBetween(-22 * s, 0, 10 * s, 0);
      g.fillStyle(0xd8d8d8, 1).fillTriangle(10 * s, -5 * s, 10 * s, 5 * s, 20 * s, 0);
      g.lineStyle(2 * s, color, 1).lineBetween(-22 * s, -4 * s, -14 * s, 0).lineBetween(-22 * s, 4 * s, -14 * s, 0);
      g.setPosition(from.x, from.y).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
      this.tweens.add({ targets: g, x: to.x, y: to.y, duration: dur, ease: 'Linear', onComplete: () => g.setVisible(false) });
      this.trail(g, color, dur);
    } else if (step.fx === 'bolt') {
      const orb = this.keep(this.add.container(from.x, from.y).setDepth(7));
      orb.add([this.add.circle(0, 0, 14 * s, color, 0.35), this.add.circle(0, 0, 8 * s, color, 0.9), this.add.circle(0, 0, 4 * s, 0xffffff, 1)]);
      this.tweens.add({ targets: orb, x: to.x, y: to.y, duration: dur, ease: 'Quad.easeIn', onComplete: () => orb.setVisible(false) });
      this.trail(orb, color, dur);
    } else if (step.fx === 'smoke') {
      for (let i = 0; i < 5; i++) {
        const p = this.keep(this.add.circle(from.x, from.y, (8 + i * 2) * s, i % 2 ? 0x8a7a9a : color, 0.55).setDepth(7));
        this.tweens.add({
          targets: p,
          x: to.x + (i - 2) * 6 * s,
          y: to.y + (i % 3 - 1) * 10 * s,
          scale: 2.2,
          alpha: 0,
          duration: dur * 1.3,
          delay: (i * dur) / 8,
          ease: 'Sine.easeOut',
        });
      }
    } else if (step.fx === 'needles') {
      for (let i = 0; i < 7; i++) {
        const off = (i - 3) * 7 * s;
        const g = this.keep(this.add.graphics().setDepth(7));
        g.lineStyle(2 * s, i % 2 ? 0xffffff : color, 1).lineBetween(-26 * s, 0, 6 * s, 0);
        g.setPosition(from.x, from.y + off).setRotation(Math.atan2(to.y - from.y - off, to.x - from.x));
        this.tweens.add({ targets: g, x: to.x, y: to.y + off * 0.3, duration: dur, delay: i * 16, ease: 'Quad.easeIn', onComplete: () => g.setVisible(false) });
      }
    }
  }

  /** Sparks trailing a moving shot. */
  private trail(target: { x: number; y: number }, color: number, dur: number): void {
    const em = this.keep(
      this.add.particles(0, 0, 'fx.dot', {
        follow: target as Phaser.Types.Math.Vector2Like,
        lifespan: 220,
        speed: { min: 5, max: 30 },
        scale: { start: 0.5 * this.dpr, end: 0 },
        alpha: { start: 0.8, end: 0 },
        tint: color,
        frequency: 18,
        blendMode: 'ADD',
      }),
    );
    em.setDepth(6);
    this.time.delayedCall(dur, () => em.stop());
  }

  private impact(step: Extract<SceneStep, { kind: 'impact' }>): void {
    const a = this.actors.get(step.actor);
    const t = this.actors.get(step.target);
    if (!a || !t) return;
    this.setPose(t, 'hit');
    const at = this.point(t, 0.55);
    const color = SCHOOL_FX[a.f.school];
    this.slashFx(step.fx, at, a.facing, color, step.crit);
    this.sparks(at, color, step.crit ? 26 : 14, a.facing);
    if (!this.calm()) {
      this.flash(t);
      this.tweens.add({ targets: t.c, x: t.homeX + a.facing * this.px(step.crit ? 26 : 16), duration: this.ms(120), ease: 'Quad.easeOut' });
      this.cameras.main.shake(this.ms(step.crit ? 240 : 90), step.crit ? 0.014 : 0.004);
    }
    this.number(t, `${step.damage}`, step.crit ? 'crit' : 'damage');
    // A lethal blow: the fighter keeps its hit pose until it falls.
    if (step.hpAfter <= 0) t.down = true;
    this.opts?.onHp(step.target, step.hpAfter, this.ms(360));
  }

  private miss(step: Extract<SceneStep, { kind: 'miss' }>): void {
    const a = this.actors.get(step.actor);
    const t = this.actors.get(step.target);
    if (!a || !t) return;
    this.setPose(t, 'idle');
    if (!this.calm()) {
      // A dodge hop: back and up, then settle.
      this.tweens.add({ targets: t.c, x: t.homeX + a.facing * this.px(30), duration: this.ms(160), ease: 'Quad.easeOut' });
      this.tweens.add({ targets: t.c, y: t.homeY - this.px(16), duration: this.ms(110), yoyo: true, ease: 'Quad.easeOut' });
    }
    const at = this.point(t, 0.55);
    this.slashFx(this.actors.get(step.actor)!.f.fx, { x: at.x - a.facing * this.px(34), y: at.y }, a.facing, 0xbcb4c4, false, 0.5);
    this.number(t, 'Miss', 'miss');
  }

  private recover(step: Extract<SceneStep, { kind: 'recover' }>): void {
    // Everyone still standing goes back to idle at home (Scatter struck several).
    for (const a of this.actors.values()) {
      if (a.down) continue;
      this.setPose(a, 'idle');
      this.tweens.add({ targets: a.c, x: a.homeX, y: a.homeY, duration: this.ms(step.dur), ease: 'Sine.easeInOut' });
    }
  }

  private defeat(step: Extract<SceneStep, { kind: 'defeat' }>): void {
    const a = this.actors.get(step.unitId);
    if (!a) return;
    a.down = true;
    this.tweens.killTweensOf(a.c);
    this.setPose(a, 'hit');
    a.img.clearTint().setTint(0x77737c);
    this.tweens.add({ targets: a.c, y: a.homeY + this.px(18), alpha: 0, duration: this.ms(step.dur), ease: 'Quad.easeIn', delay: this.ms(step.dur * 0.25) });
    const s = this.px(1);
    const L = this.layout;
    const line = this.keep(
      this.add
        .text(this.px(L.band.w / 2), this.px(L.band.y + 18) + (L.landscape ? 0 : this.px(30)), `${a.unit.name} falls`, {
          fontFamily: FONT,
          fontSize: `${15 * s}px`,
          fontStyle: 'bold',
          color: '#ece3d0',
          stroke: '#0c0a0f',
          strokeThickness: 4 * s,
        })
        .setOrigin(0.5, 0)
        .setDepth(9)
        .setAlpha(0),
    );
    this.tweens.add({ targets: line, alpha: 1, duration: this.ms(180), yoyo: true, hold: this.ms(step.dur * 0.6) });
  }

  private heal(step: Extract<SceneStep, { kind: 'heal' }>): void {
    const t = this.actors.get(step.target);
    if (!t) return;
    const s = this.px(1);
    if (step.drain && step.from) {
      // Devour: a red trail from the victim back into the bearer, then the heal.
      const src = this.actors.get(step.from);
      const from = src ? this.point(src, 0.55) : this.point(t, 0.55);
      const to = this.point(t, 0.5);
      for (let i = 0; i < 14; i++) {
        const d = this.keep(this.add.image(from.x, from.y, 'fx.dot').setTint(DRAIN_FX).setScale(0.7 * this.dpr).setDepth(7).setBlendMode(Phaser.BlendModes.ADD));
        const midY = Math.min(from.y, to.y) - (40 + (i % 4) * 14) * s;
        const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(from.x, from.y), new Phaser.Math.Vector2((from.x + to.x) / 2, midY), new Phaser.Math.Vector2(to.x, to.y));
        const prog = { v: 0 };
        this.tweens.add({
          targets: prog,
          v: 1,
          duration: this.ms(step.dur * 0.6),
          delay: this.ms(i * 18),
          ease: 'Sine.easeIn',
          onUpdate: () => {
            const p = curve.getPoint(prog.v);
            d.setPosition(p.x, p.y);
          },
          onComplete: () => d.setVisible(false),
        });
      }
      this.time.delayedCall(this.ms(step.dur * 0.55), () => {
        this.glowRing(to, DRAIN_FX, 1);
        this.number(t, `+${step.amount}`, 'heal');
        this.opts?.onHp(step.target, step.hpAfter, this.ms(400));
      });
      return;
    }
    // A staff: warm light rises around the target.
    const at = this.point(t, 0.4);
    this.glowRing({ x: at.x, y: t.c.y - this.px(4) }, HEAL_FX, 1.2);
    const em = this.keep(
      this.add.particles(at.x, t.c.y, 'fx.dot', {
        x: { min: -this.px(40), max: this.px(40) },
        lifespan: this.ms(step.dur * 0.8),
        speedY: { min: -this.px(90), max: -this.px(40) },
        scale: { start: 0.6 * this.dpr, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [HEAL_FX, 0xf4e2a8],
        quantity: 2,
        frequency: 22,
        blendMode: 'ADD',
      }),
    );
    em.setDepth(7);
    this.time.delayedCall(this.ms(step.dur * 0.6), () => em.stop());
    this.time.delayedCall(this.ms(step.dur * 0.3), () => {
      this.number(t, `+${step.amount}`, 'heal');
      this.opts?.onHp(step.target, step.hpAfter, this.ms(420));
    });
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  /** The cut of a strike at the target: an arc for blades, a line for thrusts, a downward arc for chops, a burst
   * for shots and spells. */
  private slashFx(fx: FxKind, at: { x: number; y: number }, facing: 1 | -1, color: number, crit: boolean, alpha = 1): void {
    const s = this.px(1) * (crit ? 1.3 : 1);
    const g = this.keep(this.add.graphics().setDepth(8).setPosition(at.x, at.y).setAlpha(alpha));
    if (fx === 'slash' || fx === 'chop') {
      const r = 58 * s;
      const start = fx === 'chop' ? -2.2 : -1.0;
      const end = fx === 'chop' ? -0.2 : 1.2;
      g.lineStyle(14 * s, color, 0.55).beginPath().arc(-facing * 10 * s, 0, r, start, end).strokePath();
      g.lineStyle(6 * s, 0xffffff, 0.95).beginPath().arc(-facing * 10 * s, 0, r, start + 0.15, end - 0.1).strokePath();
      if (facing === -1) g.setScale(-1, 1);
    } else if (fx === 'thrust') {
      g.fillStyle(color, 0.6).fillTriangle(-70 * s, -7 * s, -70 * s, 7 * s, 40 * s, 0);
      g.fillStyle(0xffffff, 0.95).fillTriangle(-50 * s, -3 * s, -50 * s, 3 * s, 34 * s, 0);
      if (facing === -1) g.setScale(-1, 1);
    } else {
      g.lineStyle(5 * s, color, 0.9).strokeCircle(0, 0, 18 * s);
      g.fillStyle(0xffffff, 0.8).fillCircle(0, 0, 10 * s);
    }
    this.tweens.add({ targets: g, alpha: 0, scaleX: (facing === -1 && (fx === 'slash' || fx === 'chop' || fx === 'thrust') ? -1 : 1) * 1.25, scaleY: 1.25, duration: this.ms(240), ease: 'Quad.easeOut' });
  }

  private sparks(at: { x: number; y: number }, color: number, n: number, facing: 1 | -1): void {
    const em = this.keep(
      this.add.particles(at.x, at.y, 'fx.spark', {
        lifespan: { min: 180, max: 380 },
        speed: { min: this.px(120), max: this.px(320) },
        angle: facing === 1 ? { min: -60, max: 60 } : { min: 120, max: 240 },
        rotate: { onEmit: (p?: Phaser.GameObjects.Particles.Particle) => (p ? Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) : 0) },
        scale: { start: 0.8 * this.dpr, end: 0.1 },
        alpha: { start: 1, end: 0 },
        tint: [color, 0xffffff, 0xffe8b0],
        gravityY: this.px(400),
        emitting: false,
        blendMode: 'ADD',
      }),
    );
    em.setDepth(8);
    em.explode(n);
  }

  private glowRing(at: { x: number; y: number }, color: number, size: number): void {
    const r = this.keep(this.add.circle(at.x, at.y, this.px(18) * size, color, 0.0).setStrokeStyle(this.px(4), color, 0.9).setDepth(7));
    this.tweens.add({ targets: r, scale: 2.4, alpha: 0, duration: this.ms(420), ease: 'Quad.easeOut' });
  }

  /** A white flash over the struck fighter. */
  private flash(a: Actor): void {
    if (this.game.renderer.type === Phaser.WEBGL) {
      a.img.setTintFill(0xffffff);
      this.time.delayedCall(this.ms(70), () => a.img.clearTint());
    } else {
      this.tweens.add({ targets: a.img, alpha: 0.35, duration: this.ms(50), yoyo: true });
    }
  }

  /** A damage, crit, miss or heal number popping over a fighter. */
  private number(a: Actor, text: string, kind: 'damage' | 'crit' | 'miss' | 'heal'): void {
    const s = this.px(1);
    const size = kind === 'crit' ? 46 : kind === 'miss' ? 26 : 36;
    const color = kind === 'crit' ? '#ffd24a' : kind === 'miss' ? '#cfc8d6' : kind === 'heal' ? '#9cf0a8' : '#ffffff';
    const top = a.c.y - a.scale * POSE_CANVAS.figure * 1.02;
    const x = Math.max(this.px(30), Math.min(this.scale.width - this.px(30), a.c.x));
    const label = this.keep(
      this.add
        .text(x, top, kind === 'crit' ? `${text}!` : text, {
          fontFamily: FONT,
          fontSize: `${size * s}px`,
          fontStyle: 'bold',
          color,
          stroke: '#0c0a0f',
          strokeThickness: (kind === 'crit' ? 8 : 6) * s,
        })
        .setOrigin(0.5, 1)
        .setDepth(10)
        .setScale(0.3),
    );
    if (kind === 'crit') {
      const tag = this.keep(
        this.add
          .text(x, top - size * s * 1.2, 'CRITICAL', { fontFamily: FONT, fontSize: `${14 * s}px`, fontStyle: 'bold', color: '#ffd24a', stroke: '#0c0a0f', strokeThickness: 4 * s })
          .setOrigin(0.5, 1)
          .setDepth(10)
          .setAlpha(0),
      );
      this.tweens.add({ targets: tag, alpha: 1, duration: this.ms(120) });
      this.tweens.add({ targets: tag, alpha: 0, y: tag.y - this.px(16), delay: this.ms(520), duration: this.ms(220) });
    }
    this.tweens.add({ targets: label, scale: 1.15, duration: this.ms(110), ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, scale: 1, delay: this.ms(110), duration: this.ms(90) });
    this.tweens.add({ targets: label, y: top - this.px(22), alpha: 0, delay: this.ms(560), duration: this.ms(260), ease: 'Quad.easeIn' });
  }
}

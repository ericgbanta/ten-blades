// A unit on the map. Every unit stands on a flat team-colored base (player blue, enemy crimson, ally green,
// grey once it has acted). On it is `token.<classId>` art when the manifest has it, drawn about a tile tall with
// a thin light outline, or a placeholder drawn in code (team-colored disc for player and allies, shield for
// enemies, class initial, school pip). The HP bar and the lord or boss marker sit on an overlay layer above all tokens.

import Phaser from 'phaser';
import type { School, Team } from '../core';
import { tweenDone } from './tween';
import { ACTED_COLORS, SCHOOL_COLORS, TEAM_COLORS, TEXT, TILE } from './palette';

const R = TILE * 0.31;
/** Placeholder discs sit this far above the tile center, so they stand on the base like a figure would. */
const PLACEHOLDER_Y = TILE * 0.1;
const BAR_W = TILE * 0.78;
const BAR_H = 6;
const BAR_Y = TILE * 0.4;
const RESOLVE_H = 3;
/** Feet line of a unit, in world units below the tile center, and the size of the team base around it. */
const BASE_Y = TILE * 0.2;
const BASE_RX = TILE * 0.4;
const BASE_RY = TILE * 0.14;
/** A token image is drawn this many world units square; its figure (176 of 192 px) then stands about a tile tall. */
const ART_SIZE = TILE * 1.06;
/** The packed canvas leaves this many px under the feet (see tools/art/pack.py). */
const ART_FOOT_MARGIN = 8 / 192;
/** Width in texture px of the light outline baked around each sprite. */
const OUTLINE_PX = 4;
const OUTLINE_COLOR = '#efe6d0';

/** Texture keys of the baked variants of a token image. */
const outlineKey = (key: string): string => `${key}#outline`;
const flashKey = (key: string): string => `${key}#flash`;

/**
 * Bake two variants of a token texture with the 2D canvas API (so it works under WebGL and the canvas renderer):
 * the sprite with a thin light outline that lifts it off dark terrain, and a white silhouette for the hit flash.
 */
function bakeVariants(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(outlineKey(key))) return;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width;
  const h = src.height;
  const silhouette = (color: string): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    return c;
  };
  const outline = scene.textures.createCanvas(outlineKey(key), w, h);
  if (outline) {
    const ctx = outline.getContext();
    const sil = silhouette(OUTLINE_COLOR);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      ctx.drawImage(sil, Math.cos(a) * OUTLINE_PX, Math.sin(a) * OUTLINE_PX);
    }
    ctx.drawImage(src, 0, 0);
    outline.refresh();
  }
  const flash = scene.textures.createCanvas(flashKey(key), w, h);
  if (flash) {
    flash.getContext().drawImage(silhouette('#ffffff'), 0, 0);
    flash.refresh();
  }
}

export interface TokenLook {
  team: Team;
  initial: string;
  school: School;
  isLord: boolean;
  isBoss: boolean;
  /** Texture key of real art, or null to draw the placeholder. */
  texture: string | null;
}

export class UnitToken extends Phaser.GameObjects.Container {
  /** The team base (and, for placeholders, the disc or shield). */
  private face: Phaser.GameObjects.Graphics;
  private art: Phaser.GameObjects.Image | null = null;
  private flashArt: Phaser.GameObjects.Image | null = null;
  private glyph: Phaser.GameObjects.Text | null = null;
  private flash: Phaser.GameObjects.Graphics;
  /** HP bar and lord or boss marker. They live in their own container above every token, so a unit standing
   * below never covers them with its head; the scene calls `syncOverlay` each frame to keep it in place. */
  private top: Phaser.GameObjects.Container;
  private bar: Phaser.GameObjects.Graphics;
  private acted = false;
  /** Resolve as a fraction of the gauge, or null for a unit with no gauge (not a bearer). */
  private resolve: number | null = null;
  /** HP shown by the bar, tweened toward the real value. */
  shownHp: number;

  /** Texture key of the art this token shows, or null for the placeholder. */
  get textureKey(): string | null {
    return this.look.texture;
  }

  constructor(
    scene: Phaser.Scene,
    private readonly look: TokenLook,
    private maxHp: number,
    hp: number,
    textResolution: number,
  ) {
    super(scene, 0, 0);
    this.shownHp = hp;
    this.face = scene.add.graphics();
    this.flash = scene.add.graphics();
    this.bar = scene.add.graphics();
    this.add(this.face);
    if (look.texture) {
      bakeVariants(scene, look.texture);
      const y = BASE_Y + 1 + ART_SIZE * ART_FOOT_MARGIN;
      this.art = scene.add.image(0, y, outlineKey(look.texture)).setOrigin(0.5, 1).setDisplaySize(ART_SIZE, ART_SIZE);
      this.flashArt = scene.add.image(0, y, flashKey(look.texture)).setOrigin(0.5, 1).setDisplaySize(ART_SIZE, ART_SIZE).setAlpha(0);
      this.add([this.art, this.flashArt]);
    } else {
      this.glyph = scene.add
        .text(0, -PLACEHOLDER_Y - 3, look.initial, {
          fontFamily: 'Georgia, serif',
          fontSize: `${Math.round(TILE * 0.34)}px`,
          fontStyle: 'bold',
          color: '#f4ecdc',
          stroke: TEXT.stroke,
          strokeThickness: 3,
          resolution: textResolution,
        })
        .setOrigin(0.5);
      this.add([this.glyph, this.flash]);
    }
    this.top = scene.add.container(0, 0, [this.bar]).setDepth(25);
    this.drawBody();
    this.drawMarks();
    this.drawBar();
    scene.add.existing(this);
  }

  /** Keep the HP bar and markers on the token: same position, scale, alpha and visibility. */
  syncOverlay(): void {
    this.top.setPosition(this.x, this.y).setScale(this.scaleX, this.scaleY).setAlpha(this.alpha).setVisible(this.visible);
  }

  override destroy(fromScene?: boolean): void {
    this.top.destroy(fromScene);
    super.destroy(fromScene);
  }

  private shapePath(g: Phaser.GameObjects.Graphics, r: number): void {
    if (this.look.team === 'enemy') {
      g.fillPoints(
        [
          { x: -r, y: -r * 0.9 },
          { x: r, y: -r * 0.9 },
          { x: r, y: r * 0.15 },
          { x: 0, y: r * 1.02 },
          { x: -r, y: r * 0.15 },
        ],
        true,
      );
    } else {
      g.fillCircle(0, 0, r);
    }
  }

  /** The flat team-colored base at the feet: dark edge, light rim, team fill. Grey once the unit has acted. */
  private drawBase(g: Phaser.GameObjects.Graphics): void {
    const c = this.acted ? ACTED_COLORS : TEAM_COLORS[this.look.team];
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(0, BASE_Y + 3, BASE_RX * 2 + 8, BASE_RY * 2 + 6);
    g.fillStyle(0x0c0a0f, 1);
    g.fillEllipse(0, BASE_Y, BASE_RX * 2 + 5, BASE_RY * 2 + 5);
    g.fillStyle(c.rim, 1);
    g.fillEllipse(0, BASE_Y, BASE_RX * 2 + 1, BASE_RY * 2 + 1);
    g.fillStyle(c.fill, 1);
    g.fillEllipse(0, BASE_Y, BASE_RX * 2 - 4, BASE_RY * 2 - 4);
  }

  private drawBody(): void {
    const g = this.face;
    g.clear();
    this.drawBase(g);
    if (this.art) {
      this.art.setTint(this.acted ? 0x8a8892 : 0xffffff);
      return;
    }
    // Placeholder for a class with no art: a team-colored disc (shield for enemies) standing on the base.
    const c = this.acted ? ACTED_COLORS : TEAM_COLORS[this.look.team];
    g.save();
    g.translateCanvas(0, -PLACEHOLDER_Y);
    g.fillStyle(0x0c0a0f, 1);
    this.shapePath(g, R + 3);
    g.fillStyle(c.rim, 1);
    this.shapePath(g, R + 1);
    g.fillStyle(c.fill, 1);
    this.shapePath(g, R - 2);
    // School pip at the lower right.
    g.fillStyle(0x0c0a0f, 1);
    g.fillCircle(R * 0.78, R * 0.55, 7);
    g.fillStyle(this.acted ? ACTED_COLORS.rim : SCHOOL_COLORS[this.look.school], 1);
    g.fillCircle(R * 0.78, R * 0.55, 5);
    g.restore();
    this.glyph?.setColor(this.acted ? '#c8c4d0' : '#f4ecdc');
  }

  /** Lord star at the top left of the tile and boss crown at the top right, on the overlay layer. */
  private drawMarks(): void {
    if (!this.look.isLord && !this.look.isBoss) return;
    const g = this.scene.add.graphics();
    this.top.add(g);
    if (this.look.isLord) this.drawStar(g, -TILE * 0.37, -TILE * 0.3, 0xf2c75c);
    if (this.look.isBoss) this.drawCrown(g, TILE * 0.35, -TILE * 0.3);
  }

  private drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 10 : 4.5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    g.fillStyle(0x0c0a0f, 1);
    g.fillCircle(x, y, 11.5);
    g.fillStyle(color, 1);
    g.fillPoints(pts, true);
  }

  private drawCrown(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0x0c0a0f, 1);
    g.fillRect(x - 13, y - 9, 26, 15);
    g.fillStyle(0xf2c75c, 1);
    g.fillPoints(
      [
        { x: x - 11, y: y + 4 },
        { x: x - 11, y: y - 7 },
        { x: x - 5, y: y - 1 },
        { x: x, y: y - 8 },
        { x: x + 5, y: y - 1 },
        { x: x + 11, y: y - 7 },
        { x: x + 11, y: y + 4 },
      ],
      true,
    );
  }

  private drawBar(): void {
    const g = this.bar;
    g.clear();
    const ratio = this.maxHp > 0 ? Math.max(0, Math.min(1, this.shownHp / this.maxHp)) : 0;
    g.fillStyle(0x0c0a0f, 0.9);
    g.fillRect(-BAR_W / 2 - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);
    g.fillStyle(0x3a1418, 1);
    g.fillRect(-BAR_W / 2, BAR_Y, BAR_W, BAR_H);
    const color = ratio > 0.5 ? 0x6ad08a : ratio > 0.25 ? 0xe8c04a : 0xe0503a;
    g.fillStyle(color, 1);
    g.fillRect(-BAR_W / 2, BAR_Y, BAR_W * ratio, BAR_H);
    if (this.resolve !== null) {
      // The Resolve strip under the HP bar: gold, and bright with a rim when the gauge is full.
      const y = BAR_Y + BAR_H + 2;
      const full = this.resolve >= 1;
      g.fillStyle(0x0c0a0f, 0.9);
      g.fillRect(-BAR_W / 2 - 2, y, BAR_W + 4, RESOLVE_H + 2);
      g.fillStyle(0x2a2216, 1);
      g.fillRect(-BAR_W / 2, y, BAR_W, RESOLVE_H);
      g.fillStyle(full ? 0xffd86a : 0xb8913e, 1);
      g.fillRect(-BAR_W / 2, y, BAR_W * Math.min(1, this.resolve), RESOLVE_H);
      if (full) {
        g.lineStyle(1.5, 0xfff2c0, 0.9);
        g.strokeRect(-BAR_W / 2 - 1, y - 0.5, BAR_W + 2, RESOLVE_H + 1);
      }
    }
  }

  /** Show the Resolve gauge (a fraction from 0 to 1), or hide it with null. */
  setResolve(fraction: number | null): void {
    if (fraction === this.resolve) return;
    this.resolve = fraction;
    this.drawBar();
  }

  setActed(acted: boolean): void {
    if (acted === this.acted) return;
    this.acted = acted;
    this.drawBody();
  }

  /** A unit that changed sides (recruited by talking, say) stands on its new team's base. */
  setTeam(team: Team): void {
    if (team === this.look.team) return;
    this.look.team = team;
    this.drawBody();
  }

  setMaxHp(maxHp: number): void {
    if (maxHp === this.maxHp) return;
    this.maxHp = maxHp;
    this.drawBar();
  }

  /** Move the HP bar to `hp`, over `ms` (0 snaps). */
  tweenHp(hp: number, ms: number): Promise<void> {
    if (ms <= 0) {
      this.shownHp = hp;
      this.drawBar();
      return Promise.resolve();
    }
    return tweenDone(this.scene, { targets: this, shownHp: hp, ease: 'Quad.easeOut', onUpdate: () => this.drawBar() }, ms);
  }

  /** A white flash over the body when hit. */
  hitFlash(ms: number): void {
    if (ms <= 0) return;
    if (this.flashArt) {
      this.flashArt.setAlpha(0.85);
      this.scene.tweens.add({ targets: this.flashArt, alpha: 0, duration: ms });
      return;
    }
    const g = this.flash;
    g.clear();
    g.save();
    g.translateCanvas(0, -PLACEHOLDER_Y);
    g.fillStyle(0xffffff, 1);
    this.shapePath(g, R + 1);
    g.restore();
    g.setAlpha(0.85);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: ms });
  }
}

// A unit on the map: a placeholder token drawn in code (team-colored disc for
// player and allies, shield for enemies, class initial, school pip, HP bar,
// lord or boss marker), or `token.<classId>` art when the manifest has it.

import Phaser from 'phaser';
import type { School, Team } from '../core';
import { tweenDone } from './tween';
import { ACTED_COLORS, SCHOOL_COLORS, TEAM_COLORS, TEXT, TILE } from './palette';

const R = TILE * 0.36;
const BAR_W = TILE * 0.72;
const BAR_H = 6;
const BAR_Y = TILE * 0.36;

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
  private face: Phaser.GameObjects.Graphics;
  private art: Phaser.GameObjects.Image | null = null;
  private glyph: Phaser.GameObjects.Text | null = null;
  private bar: Phaser.GameObjects.Graphics;
  private flash: Phaser.GameObjects.Graphics;
  private acted = false;
  /** HP shown by the bar, tweened toward the real value. */
  shownHp: number;

  constructor(
    scene: Phaser.Scene,
    private readonly look: TokenLook,
    private maxHp: number,
    hp: number,
    textResolution: number,
  ) {
    super(scene, 0, 0);
    this.shownHp = hp;
    const shadow = scene.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillEllipse(0, R * 0.95, R * 1.7, R * 0.5);
    this.face = scene.add.graphics();
    this.flash = scene.add.graphics();
    this.bar = scene.add.graphics();
    this.add([shadow, this.face]);
    if (look.texture) {
      this.art = scene.add.image(0, -2, look.texture).setDisplaySize(TILE * 0.9, TILE * 0.9);
      this.add(this.art);
    } else {
      this.glyph = scene.add
        .text(0, -3, look.initial, {
          fontFamily: 'Georgia, serif',
          fontSize: `${Math.round(TILE * 0.34)}px`,
          fontStyle: 'bold',
          color: '#f4ecdc',
          stroke: TEXT.stroke,
          strokeThickness: 3,
          resolution: textResolution,
        })
        .setOrigin(0.5);
      this.add(this.glyph);
    }
    this.add([this.flash, this.bar]);
    this.drawBody();
    this.drawBar();
    scene.add.existing(this);
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

  private drawBody(): void {
    const g = this.face;
    g.clear();
    if (this.art) {
      this.art.setTint(this.acted ? 0x7a7880 : 0xffffff);
      return;
    }
    const c = this.acted ? ACTED_COLORS : TEAM_COLORS[this.look.team];
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
    if (this.look.isLord) this.drawStar(g, -R * 0.78, -R * 0.82, 0xf2c75c);
    if (this.look.isBoss) this.drawCrown(g, 0, -R * 1.18);
    this.glyph?.setColor(this.acted ? '#c8c4d0' : '#f4ecdc');
  }

  private drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 9 : 4;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    }
    g.fillStyle(0x0c0a0f, 1);
    g.fillCircle(x, y, 10);
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
  }

  setActed(acted: boolean): void {
    if (acted === this.acted) return;
    this.acted = acted;
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
    const g = this.flash;
    g.clear();
    g.fillStyle(0xffffff, 1);
    this.shapePath(g, R + 1);
    g.setAlpha(0.85);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: ms });
  }
}

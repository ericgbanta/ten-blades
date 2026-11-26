// Boots Phaser with the map scene. The canvas is sized in device pixels and
// shown at CSS size, so tokens and numbers stay sharp on high density screens.

import Phaser from 'phaser';
import type { BattleState, GameData, Pos } from '../core';
import type { Insets } from './camera';
import { MapScene, type SceneInput } from './MapScene';

export interface GameHandle {
  /** CSS pixels the overlays cover on each side. */
  setInsets(insets: Insets): void;
  /** CSS client coordinates of a tile's center, or null until the scene runs. */
  tileToClient(pos: Pos): { x: number; y: number } | null;
  /** Pan instantly so the tile is in the uncovered view. */
  revealTile(pos: Pos): void;
  /** True when no camera pan is running. */
  cameraIdle(): boolean;
  /** Current tile size in CSS pixels. */
  tileCss(): number;
  destroy(): void;
}

export function startGame(parent: HTMLElement, state: BattleState, data: GameData, input: SceneInput): GameHandle {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const size = () => ({ w: Math.max(1, parent.clientWidth), h: Math.max(1, parent.clientHeight) });
  const { w, h } = size();
  const scene = new MapScene(state, data, input, dpr);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0c0a0f',
    scale: { mode: Phaser.Scale.NONE, width: w * dpr, height: h * dpr, zoom: 1 / dpr },
    input: { activePointers: 3 },
    banner: false,
    scene,
  });
  const observer = new ResizeObserver(() => {
    const s = size();
    game.scale.resize(s.w * dpr, s.h * dpr);
  });
  observer.observe(parent);
  return {
    setInsets: (i) => scene.setInsets(i),
    tileToClient: (p) => scene.tileToClient(p),
    revealTile: (p) => scene.revealTile(p),
    tileCss: () => scene.tileCss(),
    cameraIdle: () => scene.cameraIdle(),
    destroy: () => {
      observer.disconnect();
      game.destroy(true);
    },
  };
}

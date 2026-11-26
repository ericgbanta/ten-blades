// What the controller needs from the map renderer. The Phaser scene implements
// it; tests use a fake. Nothing here holds rules: the stage draws what it is told.

import type { BattleEvent, BattleState, Pos } from '../core';
import type { FightScript } from './fightTimeline';
import type { Overlay } from './selection';

/** Animation timing for one playback. */
export interface Timing {
  /** Length in ms of an animation that normally takes `base` ms (0 while skipping). */
  ms(base: number): number;
  /** True under prefers-reduced-motion: no shake or lunge, shorter moves. */
  reduced: boolean;
}

export interface Stage {
  /** Snap every token to the state (position, HP, acted, alive). */
  sync(state: BattleState): void;
  /** Draw the highlight layer. */
  setOverlay(overlay: Overlay): void;
  /** Show `unitId` standing on the end of `path` before the move is confirmed, or back home with null. */
  preview(unitId: string, path: Pos[] | null, timing: Timing): void;
  /** Animate one event. `state` is the state after the action that produced it. */
  play(event: BattleEvent, state: BattleState, timing: Timing): Promise<void>;
  /**
   * Snap tokens for events a battle scene already showed (HP, falls, gauges) with no animation and no camera
   * move, so the map is exactly as it was plus the outcome. Without it the controller plays them instantly.
   */
  settle?(events: readonly BattleEvent[], state: BattleState): void;
}


export interface FightPlayOptions {
  /** Multiplies every step's time (1 at Full speed and normal animation speed). */
  scale: number;
  /** Reduced motion: no shake, flash, lunge or knockback. */
  calm: boolean;
  /** A fighter's HP changes now (the HUD drains its bar over `ms`). */
  onHp(unitId: string, hp: number, ms: number): void;
}

/** The side-view battle scene. It draws the script it is given and holds no rules. */
export interface FightStage {
  /** Load or compose the art the script needs (cached across fights). Resolves when ready or failed. */
  prepare(script: FightScript, state: BattleState): Promise<void>;
  /** Play the script; resolves at its end, or at once after `skip`. */
  play(script: FightScript, state: BattleState, options: FightPlayOptions): Promise<void>;
  /** Jump to the end of the scene that is playing. */
  skip(): void;
}

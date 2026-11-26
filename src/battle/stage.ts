// What the controller needs from the map renderer. The Phaser scene implements
// it; tests use a fake. Nothing here holds rules: the stage draws what it is told.

import type { BattleEvent, BattleState, Pos } from '../core';
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
}

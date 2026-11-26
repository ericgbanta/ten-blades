// A small window hook for Playwright, installed only with `test=1` in the URL.
// It reads state and maps tiles to screen points; all play still goes through taps.

import { planUnitAction, type Action, type AiState, type BattleState, type GameData, type Pos } from '../../core';
import type { BattleController } from '../../battle/controller';
import type { Selection } from '../../battle/selection';
import type { GameHandle } from '../../game/start';

export interface TestHook {
  getState(): BattleState;
  getSelection(): Selection;
  isBusy(): boolean;
  isEnded(): boolean;
  /** CSS client point at a tile's center, or null before the map is up. */
  tileToScreen(x: number, y: number): { x: number; y: number } | null;
  /** Pan so the tile is clear of the overlays. */
  reveal(x: number, y: number): void;
  tileSize(): number | null;
  /** True once the map has handled input and no camera pan is running. */
  settled(): Promise<boolean>;
  /** The charge AI's choice for a player unit, so a test can script a strategy and play it by taps. */
  suggest(unitId: string): Action;
  /** Resolves once every queued save write has finished. */
  saved(): Promise<boolean>;
  /** The texture key a unit's map token shows (`token.mc` for the composed main character), or null. */
  tokenTexture(unitId: string): string | null;
  /** The id of the mid-battle scene on screen, or null. */
  scene(): string | null;
  /** The battle scene on screen: its kind, power and fighters, or null. */
  fight(): { kind: string; power: string | null; fighters: string[]; total: number; steps: { kind: string; at: number; dur: number }[] } | null;
  /** The power cut-in on screen (its name), or null. */
  cutIn(): string | null;
  /** Fill (or set) a unit's Resolve gauge. Test only. */
  setResolve(unitId: string, value?: number): void;
  /** Change the state between actions (place units, set stats). Test only. */
  patch(fn: (s: BattleState) => BattleState): void;
  /** Play an action directly (validated). Test only. Returns false if it was refused. */
  act(action: Action): boolean;
  /** Stretch battle scene time by a factor, for frame captures. Test only. */
  slowScenes(factor: number): void;
  /** Set the battle scene mode. */
  setSceneMode(mode: 'full' | 'fast' | 'off'): void;
}

declare global {
  interface Window {
    __tb?: TestHook;
  }
}

const CHARGE: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };

export function installTestHook(
  c: BattleController,
  data: GameData,
  game: () => GameHandle | null,
  flush: () => Promise<void>,
): () => void {
  const at = (x: number, y: number): Pos => ({ x, y });
  window.__tb = {
    getState: () => c.view.state,
    getSelection: () => c.view.selection,
    isBusy: () => c.view.busy,
    isEnded: () => c.view.ended !== null,
    tileToScreen: (x, y) => game()?.tileToClient(at(x, y)) ?? null,
    reveal: (x, y) => game()?.revealTile(at(x, y)),
    tileSize: () => game()?.tileCss() ?? null,
    // Phaser handles input on its next frame, so wait two frames before asking.
    settled: () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(game()?.cameraIdle() ?? false)))),
    suggest: (unitId) => planUnitAction(c.view.state, unitId, data, CHARGE),
    saved: () => flush().then(() => true),
    tokenTexture: (unitId) => game()?.tokenTexture(unitId) ?? null,
    scene: () => c.view.scene,
    fight: () => {
      const f = c.view.fight;
      if (!f) return null;
      return {
        kind: f.script.kind,
        power: f.script.power?.powerId ?? null,
        fighters: f.script.fighters.map((x) => x.unitId),
        total: f.script.total,
        steps: f.script.steps.map((x) => ({ kind: x.kind, at: x.at, dur: x.dur })),
      };
    },
    cutIn: () => c.view.cutIn?.name ?? null,
    patch: (fn) => c.patchStateForTest(fn),
    act: (action) => c.actForTest(action),
    slowScenes: (f) => c.slowScenesForTest(f),
    setSceneMode: (m) => c.setSceneMode(m),
    setResolve: (unitId, value) =>
      c.patchStateForTest((s) => {
        const u = s.units.find((x) => x.id === unitId);
        if (u) u.resolve = value ?? data.balance.resolve.max;
        return s;
      }),
  };
  return () => {
    delete window.__tb;
  };
}

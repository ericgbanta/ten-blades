// Where the battle scene goes on screen, in CSS pixels. Pure, shared by the Phaser scene (src/game/FightScene.ts)
// and the Preact HUD under it, so both agree.
//
// Portrait: the scene is a band across the top of the screen (about half its height) and the HUD sits under it.
// Landscape: the scene fills the screen and the HUD lies over its bottom edge.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FightLayout {
  landscape: boolean;
  /** The scene's band. */
  band: Rect;
  /** The ground line the fighters' feet stand on (y, CSS px from the top of the screen). */
  groundY: number;
  /** On-screen height of a 240 px idle figure. */
  figure: number;
  /** Feet x of the front fighter on each side. */
  leftX: number;
  rightX: number;
  /** Where the HUD goes. */
  hud: Rect;
}

/** HUD height in portrait (under the band) and in landscape (over the bottom of the scene). */
export const HUD_PORTRAIT = 176;
export const HUD_LANDSCAPE = 112;
/** Where the backdrop's ground band sits in its own height: this row is put on the ground line. */
export const BACKDROP_GROUND = 0.86;

export function fightLayout(w: number, h: number, safeTop = 0, safeBottom = 0): FightLayout {
  const landscape = w > h * 1.15;
  if (landscape) {
    const hud: Rect = { x: 0, y: h - HUD_LANDSCAPE - safeBottom, w, h: HUD_LANDSCAPE + safeBottom };
    const groundY = Math.round(hud.y - 6);
    const figure = Math.round(Math.min(groundY * 0.7, h * 0.5));
    return { landscape, band: { x: 0, y: 0, w, h }, groundY, figure, leftX: Math.round(w * 0.34), rightX: Math.round(w * 0.66), hud };
  }
  const bandH = Math.round(Math.min(Math.max(h * 0.52, 290), 460) + safeTop);
  const band: Rect = { x: 0, y: 0, w, h: bandH };
  const groundY = Math.round(bandH - (bandH - safeTop) * 0.12);
  const figure = Math.round((bandH - safeTop) * 0.56);
  return {
    landscape,
    band,
    groundY,
    figure,
    leftX: Math.round(w * 0.28),
    rightX: Math.round(w * 0.72),
    hud: { x: 0, y: bandH, w, h: HUD_PORTRAIT },
  };
}

/** The backdrop's placement: scaled to cover the band, with its ground row on the ground line where it can be. */
export function backdropPlacement(band: Rect, groundY: number, imgW: number, imgH: number): { x: number; y: number; scale: number } {
  const scale = Math.max(band.w / imgW, band.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = band.x + (band.w - w) / 2;
  const want = groundY - BACKDROP_GROUND * h;
  const y = Math.min(band.y, Math.max(band.y + band.h - h, want));
  return { x, y, scale };
}

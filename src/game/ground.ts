// Paints the ground of a map (tiles, road, wall and shore pieces, or coded placeholders) once into cached canvas
// textures, so the map is a handful of images however big it is. Props are separate images, depth sorted with the
// units by row (see MapScene).

import Phaser from 'phaser';
import { planGround, type CellPlan, type GroundInput } from './groundPlan';
import { TILE } from './palette';
import { drawTerrain } from './terrainArt';

/** Texture pixels per tile: the packed tile size, so the art is drawn 1:1. */
export const GROUND_PX = 96;
/** Tiles per side of one cached texture; 20 tiles is 1920 px, inside every phone GPU's 4096 px limit. */
const CHUNK = 20;

type Source = HTMLImageElement | HTMLCanvasElement;

function paintCell(ctx: CanvasRenderingContext2D, scene: Phaser.Scene, plan: CellPlan, px: number, py: number): void {
  if (plan.placeholder) {
    drawTerrain(ctx, plan.terrain, px, py, GROUND_PX);
    return;
  }
  const h = GROUND_PX / 2;
  for (const op of plan.ops) {
    const src = scene.textures.get(op.key).getSourceImage() as Source;
    if (op.rot === 0) {
      ctx.drawImage(src, px, py, GROUND_PX, GROUND_PX);
      continue;
    }
    ctx.save();
    ctx.translate(px + h, py + h);
    ctx.rotate((op.rot * Math.PI) / 2);
    ctx.drawImage(src, -h, -h, GROUND_PX, GROUND_PX);
    ctx.restore();
  }
}

/** Build the ground images for a map. Every image id the plan uses must already be loaded (or absent from the manifest). */
export function buildGround(scene: Phaser.Scene, g: GroundInput): Phaser.GameObjects.Image[] {
  const plans = planGround(g, (k) => scene.textures.exists(k));
  const images: Phaser.GameObjects.Image[] = [];
  for (let cy = 0; cy * CHUNK < g.height; cy++) {
    for (let cx = 0; cx * CHUNK < g.width; cx++) {
      const w = Math.min(CHUNK, g.width - cx * CHUNK);
      const h = Math.min(CHUNK, g.height - cy * CHUNK);
      const key = `ground#${g.mapId}#${cx}_${cy}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, w * GROUND_PX, h * GROUND_PX);
      if (!tex) continue;
      const ctx = tex.getContext();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const gx = cx * CHUNK + x;
          const gy = cy * CHUNK + y;
          paintCell(ctx, scene, plans[gy * g.width + gx]!, x * GROUND_PX, y * GROUND_PX);
        }
      }
      tex.refresh();
      images.push(
        scene.add
          .image(cx * CHUNK * TILE, cy * CHUNK * TILE, key)
          .setOrigin(0)
          .setScale(TILE / GROUND_PX)
          .setDepth(0),
      );
    }
  }
  return images;
}

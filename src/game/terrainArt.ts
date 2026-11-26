// Placeholder terrain tiles drawn in code: a flat color plus a simple mark per
// terrain so each type reads at a glance. Replaced per terrain by `tile.<id>` art.

import type Phaser from 'phaser';
import { TERRAIN_COLORS, TILE, UNKNOWN_TERRAIN } from './palette';

type G = Phaser.GameObjects.Graphics;

function trees(g: G, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  for (const [cx, cy, s] of [
    [0.3, 0.42, 0.2],
    [0.68, 0.36, 0.18],
    [0.5, 0.72, 0.21],
  ] as const) {
    const px = x + cx * TILE;
    const py = y + cy * TILE;
    const r = s * TILE;
    g.fillTriangle(px, py - r, px - r * 0.8, py + r * 0.7, px + r * 0.8, py + r * 0.7);
  }
}

function hills(g: G, x: number, y: number, color: number): void {
  g.lineStyle(3, color, 1);
  for (const [cx, cy, r] of [
    [0.34, 0.62, 0.2],
    [0.66, 0.48, 0.17],
  ] as const) {
    g.beginPath();
    g.arc(x + cx * TILE, y + cy * TILE, r * TILE, Math.PI, 0);
    g.strokePath();
  }
}

function waves(g: G, x: number, y: number, color: number): void {
  g.lineStyle(2, color, 1);
  for (const row of [0.32, 0.58, 0.82]) {
    const py = y + row * TILE;
    g.beginPath();
    g.moveTo(x + 0.14 * TILE, py);
    for (let i = 1; i <= 6; i++) g.lineTo(x + (0.14 + i * 0.12) * TILE, py + (i % 2 === 0 ? 0 : -0.05 * TILE));
    g.strokePath();
  }
}

function bricks(g: G, x: number, y: number, color: number): void {
  g.lineStyle(2, color, 1);
  for (let r = 1; r < 4; r++) g.lineBetween(x, y + (r * TILE) / 4, x + TILE, y + (r * TILE) / 4);
  for (let r = 0; r < 4; r++) {
    const off = r % 2 === 0 ? 0.25 : 0.5;
    for (let c = off; c < 1; c += 0.5) g.lineBetween(x + c * TILE, y + (r * TILE) / 4, x + c * TILE, y + ((r + 1) * TILE) / 4);
  }
}

function house(g: G, x: number, y: number, roof: number): void {
  g.fillStyle(0xc9b48a, 1);
  g.fillRect(x + 0.26 * TILE, y + 0.48 * TILE, 0.48 * TILE, 0.32 * TILE);
  g.fillStyle(roof, 1);
  g.fillTriangle(x + 0.18 * TILE, y + 0.5 * TILE, x + 0.5 * TILE, y + 0.2 * TILE, x + 0.82 * TILE, y + 0.5 * TILE);
  g.fillStyle(0x3a2a1e, 1);
  g.fillRect(x + 0.45 * TILE, y + 0.62 * TILE, 0.12 * TILE, 0.18 * TILE);
}

function fort(g: G, x: number, y: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillRect(x + 0.2 * TILE, y + 0.38 * TILE, 0.6 * TILE, 0.44 * TILE);
  for (let i = 0; i < 3; i++) g.fillRect(x + (0.2 + i * 0.24) * TILE, y + 0.26 * TILE, 0.12 * TILE, 0.14 * TILE);
  g.fillStyle(0xb8323a, 1);
  g.fillTriangle(x + 0.5 * TILE, y + 0.06 * TILE, x + 0.5 * TILE, y + 0.2 * TILE, x + 0.66 * TILE, y + 0.13 * TILE);
  g.lineStyle(2, 0x1a1714, 1);
  g.lineBetween(x + 0.5 * TILE, y + 0.06 * TILE, x + 0.5 * TILE, y + 0.28 * TILE);
}

/** Draw one placeholder tile with its top left at (x, y) in world units. */
export function drawTerrain(g: G, terrainId: string, x: number, y: number): void {
  const c = TERRAIN_COLORS[terrainId] ?? UNKNOWN_TERRAIN;
  g.fillStyle(c.base, 1);
  g.fillRect(x, y, TILE, TILE);
  switch (terrainId) {
    case 'forest':
      trees(g, x, y, c.detail);
      break;
    case 'hill':
      hills(g, x, y, c.detail);
      break;
    case 'water':
      waves(g, x, y, c.detail);
      break;
    case 'wall':
      bricks(g, x, y, c.detail);
      break;
    case 'village':
      house(g, x, y, c.detail);
      break;
    case 'fort':
      fort(g, x, y, c.detail);
      break;
    default:
      // Plain and road get a few specks so large open areas do not look empty.
      g.fillStyle(c.detail, 1);
      g.fillRect(x + 0.2 * TILE, y + 0.3 * TILE, 3, 3);
      g.fillRect(x + 0.7 * TILE, y + 0.6 * TILE, 3, 3);
      g.fillRect(x + 0.45 * TILE, y + 0.8 * TILE, 3, 3);
  }
}

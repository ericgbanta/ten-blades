// Placeholder terrain tiles drawn in code with the 2D canvas API: a flat color plus a simple mark per terrain so
// each type reads at a glance. Used for any cell whose art is missing from the manifest (see groundPlan.ts).

import { TERRAIN_COLORS, UNKNOWN_TERRAIN } from './palette';

type Ctx = CanvasRenderingContext2D;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function tri(g: Ctx, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.lineTo(cx, cy);
  g.closePath();
  g.fill();
}

function line(g: Ctx, ax: number, ay: number, bx: number, by: number): void {
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
}

/** Draw one placeholder tile with its top left at (x, y) and side `s` in canvas pixels. */
export function drawTerrain(g: Ctx, terrainId: string, x: number, y: number, s: number): void {
  const c = TERRAIN_COLORS[terrainId] ?? UNKNOWN_TERRAIN;
  const u = s / 64; // the marks were designed on a 64 unit tile
  g.save();
  g.fillStyle = hex(c.base);
  g.fillRect(x, y, s, s);
  g.fillStyle = hex(c.detail);
  g.strokeStyle = hex(c.detail);
  g.lineWidth = 2 * u;
  switch (terrainId) {
    case 'forest':
      for (const [cx, cy, r] of [
        [0.3, 0.42, 0.2],
        [0.68, 0.36, 0.18],
        [0.5, 0.72, 0.21],
      ] as const) {
        const px = x + cx * s;
        const py = y + cy * s;
        tri(g, px, py - r * s, px - r * s * 0.8, py + r * s * 0.7, px + r * s * 0.8, py + r * s * 0.7);
      }
      break;
    case 'hill':
      g.lineWidth = 3 * u;
      for (const [cx, cy, r] of [
        [0.34, 0.62, 0.2],
        [0.66, 0.48, 0.17],
      ] as const) {
        g.beginPath();
        g.arc(x + cx * s, y + cy * s, r * s, Math.PI, 0);
        g.stroke();
      }
      break;
    case 'water':
    case 'ford':
    case 'bridge':
      for (const row of [0.32, 0.58, 0.82]) {
        const py = y + row * s;
        g.beginPath();
        g.moveTo(x + 0.14 * s, py);
        for (let i = 1; i <= 6; i++) g.lineTo(x + (0.14 + i * 0.12) * s, py + (i % 2 === 0 ? 0 : -0.05 * s));
        g.stroke();
      }
      if (terrainId === 'bridge') {
        g.fillStyle = '#6b5236';
        g.fillRect(x, y + 0.3 * s, s, 0.4 * s);
        g.strokeStyle = '#2a1e14';
        for (let i = 1; i < 6; i++) line(g, x + (i * s) / 6, y + 0.3 * s, x + (i * s) / 6, y + 0.7 * s);
      } else if (terrainId === 'ford') {
        g.fillStyle = '#8a857c';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc(x + (0.17 + i * 0.22) * s, y + 0.5 * s, 0.08 * s, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    case 'wall':
      for (let r = 1; r < 4; r++) line(g, x, y + (r * s) / 4, x + s, y + (r * s) / 4);
      for (let r = 0; r < 4; r++) {
        const off = r % 2 === 0 ? 0.25 : 0.5;
        for (let cc = off; cc < 1; cc += 0.5) line(g, x + cc * s, y + (r * s) / 4, x + cc * s, y + ((r + 1) * s) / 4);
      }
      break;
    case 'village':
      g.fillStyle = '#c9b48a';
      g.fillRect(x + 0.26 * s, y + 0.48 * s, 0.48 * s, 0.32 * s);
      g.fillStyle = hex(c.detail);
      tri(g, x + 0.18 * s, y + 0.5 * s, x + 0.5 * s, y + 0.2 * s, x + 0.82 * s, y + 0.5 * s);
      g.fillStyle = '#3a2a1e';
      g.fillRect(x + 0.45 * s, y + 0.62 * s, 0.12 * s, 0.18 * s);
      break;
    case 'fort':
      g.fillRect(x + 0.2 * s, y + 0.38 * s, 0.6 * s, 0.44 * s);
      for (let i = 0; i < 3; i++) g.fillRect(x + (0.2 + i * 0.24) * s, y + 0.26 * s, 0.12 * s, 0.14 * s);
      g.fillStyle = '#b8323a';
      tri(g, x + 0.5 * s, y + 0.06 * s, x + 0.5 * s, y + 0.2 * s, x + 0.66 * s, y + 0.13 * s);
      g.strokeStyle = '#1a1714';
      line(g, x + 0.5 * s, y + 0.06 * s, x + 0.5 * s, y + 0.28 * s);
      break;
    default:
      // Plain and road get a few specks so large open areas do not look empty.
      for (const [px, py] of [
        [0.2, 0.3],
        [0.7, 0.6],
        [0.45, 0.8],
      ] as const) {
        g.fillRect(x + px * s, y + py * s, 3 * u, 3 * u);
      }
  }
  g.restore();
}

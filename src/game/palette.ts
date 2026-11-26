// Placeholder colors for the map, until painted art arrives through the manifest.

import type { School, Team } from '../core';

/** World units per tile. The camera zoom turns this into screen pixels. */
export const TILE = 64;

export interface TerrainColors {
  base: number;
  detail: number;
}

export const TERRAIN_COLORS: Record<string, TerrainColors> = {
  plain: { base: 0x4a5638, detail: 0x56633f },
  road: { base: 0x6b5e48, detail: 0x7a6c53 },
  forest: { base: 0x2b4429, detail: 0x18291a },
  hill: { base: 0x6a5a3e, detail: 0x4e412b },
  water: { base: 0x22405e, detail: 0x3d6488 },
  wall: { base: 0x3a3740, detail: 0x26232b },
  village: { base: 0x4a5638, detail: 0x8e3b2c },
  fort: { base: 0x58524a, detail: 0x37332e },
  bridge: { base: 0x22405e, detail: 0x3d6488 },
  ford: { base: 0x2e5470, detail: 0x4d7898 },
  cobble: { base: 0x5e554c, detail: 0x4a423a },
  flagstone: { base: 0x6a625a, detail: 0x514a43 },
  building: { base: 0x34313a, detail: 0x24222a },
  stall: { base: 0x5e554c, detail: 0x8e3b2c },
  rubble: { base: 0x6a625a, detail: 0x3e3933 },
  canal: { base: 0x1c2c3c, detail: 0x34506a },
  gate: { base: 0x58524a, detail: 0x37332e },
  crates: { base: 0x5e554c, detail: 0x6b5236 },
};

export const UNKNOWN_TERRAIN: TerrainColors = { base: 0x553a55, detail: 0x3d283d };

export const TEAM_COLORS: Record<Team, { fill: number; rim: number }> = {
  player: { fill: 0x2f5fb8, rim: 0x9cc0ff },
  enemy: { fill: 0xa8302f, rim: 0xffa89a },
  ally: { fill: 0x2f8a4a, rim: 0xa8f0b8 },
};

export const ACTED_COLORS = { fill: 0x55525c, rim: 0x8d8996 };

export const SCHOOL_COLORS: Record<School, number> = {
  heavy: 0xe08a3a,
  swift: 0x6ad08a,
  arcane: 0xb48cff,
  none: 0xe8e0d0,
};

export const HIGHLIGHT = {
  move: { fill: 0x3a7bd5, alpha: 0.42, line: 0x9cc4ff },
  attack: { fill: 0xd0383a, alpha: 0.36, line: 0xff9a9a },
  heal: { fill: 0x3aa05a, alpha: 0.36, line: 0xa8f0b8 },
  danger: { fill: 0x9a2fa0, alpha: 0.3, line: 0xe08ae8 },
  target: { fill: 0xff4040, alpha: 0.5, line: 0xffe0e0 },
  cursor: 0xf2c75c,
};

export const TEXT = {
  damage: '#ffffff',
  crit: '#ffd84a',
  miss: '#c8c4d0',
  heal: '#8cf0a0',
  xp: '#9cc8ff',
  stroke: '#0c0a0f',
};

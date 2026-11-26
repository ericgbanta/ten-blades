// Conversion between Tiled maps (.tmj, JSON) and the game's map format (src/data/maps/<id>.json).
// Pure functions, so tests/maps-tiled.test.ts can run them; tools/maps/import.ts and export.ts do the file work.
// The format is described in docs/MAPS.md.

import type { MapData, MapProp, McSlot, Placement, ReinforcementWave, UnitPlacement, Objective, Difficulty } from '../../src/core/types';

/** The tile character each terrain id gets in a map's `tiles` rows. A new terrain needs a character here. */
export const TERRAIN_CHARS: Record<string, string> = {
  plain: '.',
  road: '=',
  forest: 'F',
  hill: 'H',
  water: '~',
  wall: '#',
  village: 'V',
  fort: 'T',
  bridge: 'B',
  ford: 'f',
  cobble: 'o',
  flagstone: '_',
  building: 'X',
  stall: 'S',
  rubble: 'r',
  canal: 'c',
  gate: 'G',
  crates: 'C',
};

/** Size of a tile in the Tiled files (the packed tile size, so the tileset image is drawn 1:1). */
export const TILED_TILE = 96;
const FLIP_BITS = 0x1fffffff;

export interface TiledProperty {
  name: string;
  type: 'string' | 'int' | 'bool' | 'float';
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  /** Tiled 1.9 wrote an object's class here instead of `type`. */
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  gid?: number;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  width?: number;
  height?: number;
  data?: number[];
  draworder?: string;
  objects?: TiledObject[];
  properties?: TiledProperty[];
}

export interface TiledMap {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  infinite: false;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  properties: TiledProperty[];
  tilesets: { firstgid: number; source: string }[];
  layers: TiledLayer[];
}

export interface TiledTileset {
  tiles: { id: number; type?: string; class?: string; properties?: TiledProperty[] }[];
}

const prop = (name: string, value: string | number | boolean): TiledProperty => ({
  name,
  type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'string',
  value,
});

function propsOf(list: TiledProperty[] | undefined): Map<string, string | number | boolean> {
  return new Map((list ?? []).map((p) => [p.name, p.value]));
}

/** The terrain id of each tile of a tileset: its `terrain` property, else its type (class). */
export function tilesetTerrains(ts: TiledTileset): Map<number, string> {
  const out = new Map<number, string>();
  for (const t of ts.tiles) {
    const named = propsOf(t.properties).get('terrain');
    const terrain = typeof named === 'string' ? named : (t.type ?? t.class);
    if (terrain) out.set(t.id, terrain);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Game map to Tiled
// ---------------------------------------------------------------------------

function unitObject(p: Placement, id: number): TiledObject {
  const base = { id, x: (p.pos.x + 0.5) * TILED_TILE, y: (p.pos.y + 0.5) * TILED_TILE, width: 0, height: 0, rotation: 0, visible: true, point: true };
  if (p.kind === 'mc' && p.weapons) {
    const props = Object.entries(p.weapons).map(([style, w]) => prop(`weapon.${style}`, w));
    return { ...base, name: p.kind, type: p.kind, properties: props };
  }
  if (p.kind !== 'unit') return { ...base, name: p.kind, type: p.kind };
  const props: TiledProperty[] = [prop('id', p.id), prop('classId', p.classId), prop('team', p.team), prop('level', p.level)];
  if (p.weaponId !== undefined) props.push(prop('weaponId', p.weaponId));
  if (p.ai) {
    props.push(prop('ai', p.ai.behavior));
    if (p.ai.radius !== undefined) props.push(prop('radius', p.ai.radius));
    if (p.ai.tile) props.push(prop('guardTile', `${p.ai.tile.x},${p.ai.tile.y}`));
  }
  if (p.isBoss !== undefined) props.push(prop('isBoss', p.isBoss));
  if (p.isLord !== undefined) props.push(prop('isLord', p.isLord));
  if (p.tags !== undefined) props.push(prop('tags', p.tags.join(',')));
  if (p.items !== undefined) props.push(prop('items', p.items.join(',')));
  return { ...base, name: p.name, type: 'unit', properties: props };
}

/** Turn a game map into a Tiled map that uses the terrain tileset at `tilesetSource` (relative to the .tmj). */
export function mapToTmj(map: MapData, terrainIds: readonly string[], tilesetSource: string): TiledMap {
  const gidOf = new Map(terrainIds.map((t, i) => [t, i + 1]));
  const data: number[] = [];
  for (const row of map.tiles) {
    for (const ch of row) {
      const terrain = map.legend[ch];
      const gid = terrain ? gidOf.get(terrain) : undefined;
      if (gid === undefined) throw new Error(`${map.id}: no tileset tile for '${ch}' (${terrain ?? 'not in the legend'})`);
      data.push(gid);
    }
  }
  let nextId = 1;
  const layers: TiledLayer[] = [
    { id: 1, name: 'terrain', type: 'tilelayer', x: 0, y: 0, width: map.width, height: map.height, opacity: 1, visible: true, data },
    { id: 2, name: 'units', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects: map.placements.map((p) => unitObject(p, nextId++)) },
  ];
  map.reinforcements.forEach((w, i) => {
    layers.push({
      id: layers.length + 1,
      name: `wave ${i + 1}`,
      type: 'objectgroup',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      draworder: 'topdown',
      properties: [prop('turn', w.turn), prop('difficulties', w.difficulties.join(','))],
      objects: w.units.map((u) => unitObject(u, nextId++)),
    });
  });
  layers.push({
    id: layers.length + 1,
    name: 'props',
    type: 'objectgroup',
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: 'topdown',
    objects: (map.props ?? []).map((p) => ({
      id: nextId++,
      name: p.id,
      type: p.id,
      x: (p.x + 0.5) * TILED_TILE,
      y: (p.y + 0.5) * TILED_TILE,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      point: true,
    })),
  });
  const o = map.objective;
  const properties: TiledProperty[] = [prop('id', map.id), prop('name', map.name), prop('objective', o.type)];
  if (o.type === 'survive' || o.type === 'protect') properties.push(prop('objectiveTurns', o.turns));
  if (o.type === 'protect') properties.push(prop('objectiveUnit', o.unitId));
  if (o.type === 'escape') properties.push(prop('objectiveTiles', o.tiles.map((t) => `${t.x},${t.y}`).join(';')));
  if (map.backdrop !== undefined) properties.push(prop('backdrop', map.backdrop));
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: map.width,
    height: map.height,
    tilewidth: TILED_TILE,
    tileheight: TILED_TILE,
    nextlayerid: layers.length + 1,
    nextobjectid: nextId,
    properties,
    tilesets: [{ firstgid: 1, source: tilesetSource }],
    layers,
  };
}

// ---------------------------------------------------------------------------
// Tiled to game map
// ---------------------------------------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined);

function parsePos(text: string, where: string): { x: number; y: number } {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(text);
  if (!m) throw new Error(`${where}: expected "x,y", got "${text}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** The tile an object sits on. A tile object is anchored at its bottom left, a point or shape at its top left. */
function objectTile(o: TiledObject, tw: number, th: number): { x: number; y: number } {
  const x = o.x + (o.gid ? tw / 2 : o.point ? 0 : o.width / 2);
  const y = o.y + (o.gid ? -th / 2 : o.point ? 0 : o.height / 2);
  return { x: Math.floor(x / tw), y: Math.floor(y / th) };
}

function placementOf(o: TiledObject, tw: number, th: number, where: string): Placement {
  const pos = objectTile(o, tw, th);
  const kind = o.type || o.class || 'unit';
  if (kind === 'mc') {
    // weapon.<style> properties: the weapon a new main character of that style holds on this map.
    const weapons: Record<string, string> = {};
    for (const [k, v] of propsOf(o.properties)) {
      const m = /^weapon\.(\w+)$/.exec(k);
      if (m && typeof v === 'string') weapons[m[1]!] = v;
    }
    return Object.keys(weapons).length > 0 ? { kind, pos, weapons: weapons as McSlot['weapons'] } : { kind, pos };
  }
  if (kind === 'party') return { kind, pos };
  if (kind !== 'unit') throw new Error(`${where}: object ${o.id} has type "${kind}"; use unit, mc or party`);
  const p = propsOf(o.properties);
  const id = str(p.get('id'));
  const classId = str(p.get('classId'));
  const team = str(p.get('team'));
  const level = num(p.get('level'));
  if (!id || !classId || !team || level === undefined) throw new Error(`${where}: unit object ${o.id} (${o.name}) needs id, classId, team and level`);
  const u: UnitPlacement = { kind: 'unit', id, name: o.name || id, classId, team: team as UnitPlacement['team'], level, pos };
  const weaponId = str(p.get('weaponId'));
  if (weaponId) u.weaponId = weaponId;
  const ai = str(p.get('ai'));
  if (ai) {
    u.ai = { behavior: ai as NonNullable<UnitPlacement['ai']>['behavior'] };
    const radius = num(p.get('radius'));
    if (radius !== undefined) u.ai.radius = radius;
    const guard = str(p.get('guardTile'));
    if (guard) u.ai.tile = parsePos(guard, `${where}: ${id} guardTile`);
  }
  const isBoss = bool(p.get('isBoss'));
  if (isBoss !== undefined) u.isBoss = isBoss;
  const isLord = bool(p.get('isLord'));
  if (isLord !== undefined) u.isLord = isLord;
  const tags = str(p.get('tags'));
  if (tags !== undefined) u.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const items = str(p.get('items'));
  if (items !== undefined) u.items = items.split(',').map((t) => t.trim()).filter(Boolean);
  // Keep the key order of hand-written maps: kind, id, name, classId, team, level, weaponId, pos, ai, isBoss, isLord, tags, items.
  const { kind: k, id: i, name, classId: c, team: tm, level: lv, weaponId: wp, pos: ps, ai: a, isBoss: b, isLord: l, tags: tg, items: it } = u;
  return JSON.parse(JSON.stringify({ kind: k, id: i, name, classId: c, team: tm, level: lv, weaponId: wp, pos: ps, ai: a, isBoss: b, isLord: l, tags: tg, items: it })) as UnitPlacement;
}

function objectiveOf(p: Map<string, string | number | boolean>, where: string): Objective {
  const type = str(p.get('objective')) ?? 'rout';
  const turns = num(p.get('objectiveTurns'));
  switch (type) {
    case 'rout':
    case 'defeatBoss':
      return { type };
    case 'survive':
      if (turns === undefined) throw new Error(`${where}: survive needs objectiveTurns`);
      return { type, turns };
    case 'protect': {
      const unitId = str(p.get('objectiveUnit'));
      if (turns === undefined || !unitId) throw new Error(`${where}: protect needs objectiveTurns and objectiveUnit`);
      return { type, unitId, turns };
    }
    case 'escape': {
      const tiles = (str(p.get('objectiveTiles')) ?? '').split(';').filter((s) => s.trim()).map((s) => parsePos(s, `${where}: objectiveTiles`));
      return { type, tiles };
    }
    default:
      throw new Error(`${where}: unknown objective ${type}`);
  }
}

/** Turn a Tiled map into a game map. `terrains` maps tileset tile ids to terrain ids (see tilesetTerrains). */
export function tmjToMap(tmj: TiledMap, terrains: Map<number, string>, fallbackId: string): MapData {
  const where = `map ${fallbackId}`;
  if (tmj.orientation !== 'orthogonal') throw new Error(`${where}: only orthogonal maps are supported`);
  if (tmj.infinite) throw new Error(`${where}: infinite maps are not supported`);
  const firstgid = tmj.tilesets[0]?.firstgid ?? 1;
  const tileLayers = tmj.layers.filter((l) => l.type === 'tilelayer');
  if (tileLayers.length !== 1) throw new Error(`${where}: needs exactly one tile layer (the terrain), found ${tileLayers.length}`);
  const raw = tileLayers[0]!.data as unknown;
  if (!Array.isArray(raw)) throw new Error(`${where}: save the terrain layer as CSV (the import does not read Base64)`);
  const data = raw as number[];
  if (data.length !== tmj.width * tmj.height) throw new Error(`${where}: the terrain layer has ${data.length} tiles, expected ${tmj.width * tmj.height}`);
  const used = new Set<string>();
  const rows: string[] = [];
  for (let y = 0; y < tmj.height; y++) {
    let row = '';
    for (let x = 0; x < tmj.width; x++) {
      const gid = data[y * tmj.width + x]! & FLIP_BITS;
      if (gid === 0) throw new Error(`${where}: empty tile at ${x},${y}`);
      const terrain = terrains.get(gid - firstgid);
      if (!terrain) throw new Error(`${where}: tile ${gid - firstgid} at ${x},${y} has no terrain`);
      const ch = TERRAIN_CHARS[terrain];
      if (!ch) throw new Error(`${where}: terrain ${terrain} has no tile character (add it to TERRAIN_CHARS)`);
      used.add(terrain);
      row += ch;
    }
    rows.push(row);
  }
  const legend: Record<string, string> = {};
  for (const [t, ch] of Object.entries(TERRAIN_CHARS)) if (used.has(t)) legend[ch] = t;

  const tw = tmj.tilewidth;
  const th = tmj.tileheight;
  const layer = (name: string) => tmj.layers.find((l) => l.type === 'objectgroup' && l.name === name);
  const placements = (layer('units')?.objects ?? []).map((o) => placementOf(o, tw, th, where));
  const reinforcements: ReinforcementWave[] = tmj.layers
    .filter((l) => l.type === 'objectgroup' && /^wave\b/.test(l.name))
    .map((l) => {
      const p = propsOf(l.properties);
      const turn = num(p.get('turn'));
      if (turn === undefined) throw new Error(`${where}: layer "${l.name}" needs a turn property`);
      const difficulties = (str(p.get('difficulties')) ?? 'normal,hard,lunatic').split(',').map((d) => d.trim()).filter(Boolean) as Difficulty[];
      const units = (l.objects ?? []).map((o) => placementOf(o, tw, th, `${where}: ${l.name}`));
      if (units.some((u) => u.kind !== 'unit')) throw new Error(`${where}: layer "${l.name}" may only hold units`);
      return { turn, difficulties, units: units as UnitPlacement[] };
    });
  const props: MapProp[] = (layer('props')?.objects ?? []).map((o) => ({ id: o.type || o.class || o.name, ...objectTile(o, tw, th) }));
  const mp = propsOf(tmj.properties);
  const map: MapData = {
    id: str(mp.get('id')) ?? fallbackId,
    name: str(mp.get('name')) ?? fallbackId,
    width: tmj.width,
    height: tmj.height,
    tiles: rows,
    legend,
    placements,
    objective: objectiveOf(mp, where),
    reinforcements,
  };
  const backdrop = str(mp.get('backdrop'));
  if (backdrop) map.backdrop = backdrop;
  if (props.length > 0) map.props = props;
  return map;
}

// ---------------------------------------------------------------------------
// Checks and output
// ---------------------------------------------------------------------------

export interface PropDef {
  name: string;
  size: 'small' | 'tall';
  terrains: string[];
}

/**
 * Prop rules the core does not know about: the prop exists, sits on a terrain it suits, and no tall prop stands
 * where a unit starts (it would cover the unit; it still fades if a unit walks onto it later).
 */
export function checkProps(map: MapData, defs: Record<string, PropDef>): string[] {
  const errs: string[] = [];
  const starts = new Set<string>();
  for (const p of map.placements) starts.add(`${p.pos.x},${p.pos.y}`);
  for (const w of map.reinforcements) for (const u of w.units) starts.add(`${u.pos.x},${u.pos.y}`);
  for (const p of map.props ?? []) {
    const def = defs[p.id];
    if (!def) {
      errs.push(`map ${map.id}: unknown prop ${p.id}`);
      continue;
    }
    const ch = map.tiles[p.y]?.[p.x];
    const terrain = ch === undefined ? undefined : map.legend[ch];
    if (!terrain || !def.terrains.includes(terrain)) errs.push(`map ${map.id}: prop ${p.id} at ${p.x},${p.y} is on ${terrain ?? 'nothing'}; it suits ${def.terrains.join(', ')}`);
    if (def.size === 'tall' && starts.has(`${p.x},${p.y}`)) errs.push(`map ${map.id}: tall prop ${p.id} at ${p.x},${p.y} is on a unit's start tile`);
  }
  return errs;
}

const line = (v: unknown): string => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/,\{/g, ', {');

/** The map as JSON in the house layout: one row of tiles, one placement and one prop per line. */
export function formatMap(map: MapData): string {
  const out: string[] = ['{'];
  const fields: string[] = [];
  fields.push(`  "id": ${JSON.stringify(map.id)}`);
  fields.push(`  "name": ${JSON.stringify(map.name)}`);
  fields.push(`  "width": ${map.width}`);
  fields.push(`  "height": ${map.height}`);
  fields.push(`  "tiles": [\n${map.tiles.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`);
  fields.push(`  "legend": ${line(map.legend)}`);
  fields.push(`  "placements": [\n${map.placements.map((p) => `    ${line(p)}`).join(',\n')}\n  ]`);
  fields.push(`  "objective": ${line(map.objective)}`);
  if (map.backdrop !== undefined) fields.push(`  "backdrop": ${JSON.stringify(map.backdrop)}`);
  const waves = map.reinforcements.map(
    (w) => `    {\n      "turn": ${w.turn},\n      "difficulties": ${line(w.difficulties)},\n      "units": [\n${w.units.map((u) => `        ${line(u)}`).join(',\n')}\n      ]\n    }`,
  );
  fields.push(waves.length ? `  "reinforcements": [\n${waves.join(',\n')}\n  ]` : `  "reinforcements": []`);
  if (map.props) fields.push(`  "props": [\n${map.props.map((p) => `    ${line(p)}`).join(',\n')}\n  ]`);
  out.push(fields.join(',\n'));
  out.push('}');
  return out.join('\n') + '\n';
}

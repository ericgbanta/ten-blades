import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateGameData } from '../src/core';
import type { MapData } from '../src/core';
import { gameData } from '../src/data';

/** A map as Tiled holds it: events live in their own file, not in Tiled. */
const tiledPart = (m: MapData): MapData => {
  const copy = { ...m };
  delete copy.events;
  return copy;
};
import propDefs from '../src/data/props.json';
import terrain from '../src/data/terrain.json';
import { checkProps, formatMap, mapToTmj, tilesetTerrains, tmjToMap, type PropDef, type TiledMap, type TiledTileset } from '../tools/maps/tiled';

const root = join(__dirname, '..');
const tileset = JSON.parse(readFileSync(join(root, 'tools', 'maps', 'tiles.tsj'), 'utf8')) as TiledTileset;
const sources = readdirSync(join(root, 'tools', 'maps', 'src')).filter((f) => f.endsWith('.tmj'));

describe('Tiled import', () => {
  it('has a tileset tile for every terrain, in terrain.json order', () => {
    expect([...tilesetTerrains(tileset).entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])).toEqual(Object.keys(terrain));
  });

  it.each(sources)('importing %s gives the shipped map, byte for byte', (file) => {
    const tmj = JSON.parse(readFileSync(join(root, 'tools', 'maps', 'src', file), 'utf8')) as TiledMap;
    const map = tmjToMap(tmj, tilesetTerrains(tileset), file.replace('.tmj', ''));
    const shipped = readFileSync(join(root, 'src', 'data', 'maps', `${map.id}.json`), 'utf8');
    expect(map).toEqual(JSON.parse(shipped));
    expect(formatMap(map)).toBe(shipped);
  });

  it('round-trips every map through Tiled, waves and props included', () => {
    for (const m of Object.values(gameData.maps).map(tiledPart)) {
      const back = tmjToMap(mapToTmj(m, Object.keys(terrain), '../tiles.tsj'), tilesetTerrains(tileset), m.id);
      expect(back).toEqual(m);
    }
  });

  it('reads an escape objective, a guard tile and a tile object placed by its bottom left corner', () => {
    const m = { ...tiledPart(gameData.maps.prologue!), objective: { type: 'escape' as const, tiles: [{ x: 0, y: 0 }, { x: 9, y: 11 }] } };
    m.placements = m.placements.map((p) => (p.kind === 'unit' && p.id === 'legionary_3' ? { ...p, ai: { behavior: 'guard' as const, radius: 2, tile: { x: 4, y: 1 } } } : p));
    const tmj = mapToTmj(m, Object.keys(terrain), '../tiles.tsj');
    const props = tmj.layers.find((l) => l.name === 'props')!;
    const first = props.objects![0]!;
    props.objects![0] = { ...first, point: false, gid: 5, x: first.x - 48, y: first.y + 48, width: 96, height: 96 };
    expect(tmjToMap(tmj, tilesetTerrains(tileset), 'prologue')).toEqual(m);
  });

  it('rejects a map without exactly one terrain layer, and an unknown terrain', () => {
    const tmj = mapToTmj(gameData.maps.prologue!, Object.keys(terrain), '../tiles.tsj');
    expect(() => tmjToMap({ ...tmj, layers: tmj.layers.filter((l) => l.type !== 'tilelayer') }, tilesetTerrains(tileset), 'x')).toThrow(/one tile layer/);
    expect(() => tmjToMap(tmj, new Map([[0, 'lava']]), 'x')).toThrow();
  });
});

describe('map props', () => {
  it.each(Object.keys(gameData.maps))('props on %s exist, suit their tile and keep off unit start tiles', (id) => {
    expect(checkProps(gameData.maps[id]!, propDefs as Record<string, PropDef>)).toEqual([]);
  });

  it('the core flags a prop off the map or two props on one tile', () => {
    const m = { ...gameData.maps.prologue!, props: [{ id: 'well', x: 10, y: 0 }, { id: 'fence', x: 1, y: 1 }, { id: 'rubble', x: 1, y: 1 }] };
    const errs = validateGameData({ ...gameData, maps: { prologue: m } });
    expect(errs.some((e) => e.includes('prop well off the map'))).toBe(true);
    expect(errs.some((e) => e.includes('two props on 1,1'))).toBe(true);
  });

  it('flags a prop on the wrong terrain or a tall prop on a start tile', () => {
    const m = { ...gameData.maps.prologue!, props: [{ id: 'well', x: 0, y: 3 }, { id: 'cart', x: 4, y: 10 }, { id: 'nothing', x: 1, y: 1 }] };
    const errs = checkProps(m, propDefs as Record<string, PropDef>);
    expect(errs).toHaveLength(3);
  });
});

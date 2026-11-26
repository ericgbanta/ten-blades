// npm run maps [ids...]: convert Tiled maps in tools/maps/src/<id>.tmj into src/data/maps/<id>.json.
// Each map is checked with the core's validateGameData and the prop rules before anything is written.
// See docs/MAPS.md.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGameData } from '../../src/core/validate';
import { gameData } from '../../src/data';
import propDefs from '../../src/data/props.json';
import { checkProps, formatMap, tilesetTerrains, tmjToMap, type PropDef, type TiledMap, type TiledTileset } from './tiled';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const outDir = resolve(here, '..', '..', 'src', 'data', 'maps');

function main(): void {
  const wanted = process.argv.slice(2);
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.tmj') && (wanted.length === 0 || wanted.includes(basename(f, '.tmj'))));
  if (files.length === 0) {
    console.error(`No .tmj maps found in ${srcDir}${wanted.length ? ` for ${wanted.join(', ')}` : ''}.`);
    process.exit(1);
  }
  let failed = false;
  for (const f of files) {
    const path = join(srcDir, f);
    const tmj = JSON.parse(readFileSync(path, 'utf8')) as TiledMap;
    const source = tmj.tilesets[0]?.source;
    if (!source) throw new Error(`${f}: needs the terrain tileset (tools/maps/tiles.tsj) as an external tileset`);
    const tileset = JSON.parse(readFileSync(resolve(dirname(path), source), 'utf8')) as TiledTileset;
    const map = tmjToMap(tmj, tilesetTerrains(tileset), basename(f, '.tmj'));
    // The map's events live in src/data/maps/<id>.events.json, which this never writes. Check the new map with
    // them, so redrawing a map cannot strand an event on a unit or tile that is gone.
    const events = gameData.maps[map.id]?.events;
    const errs = [
      ...validateGameData({ ...gameData, maps: { ...gameData.maps, [map.id]: events ? { ...map, events } : map } }).filter((e) =>
        e.startsWith(`map ${map.id}:`),
      ),
      ...checkProps(map, propDefs as Record<string, PropDef>),
    ];
    if (errs.length > 0) {
      failed = true;
      console.error(`${f}: not written\n  ${errs.join('\n  ')}`);
      continue;
    }
    const out = join(outDir, `${map.id}.json`);
    writeFileSync(out, formatMap(map));
    console.log(`${f} -> src/data/maps/${map.id}.json (${map.width}x${map.height}, ${map.placements.length} placements, ${map.props?.length ?? 0} props)`);
  }
  if (failed) process.exit(1);
}

main();

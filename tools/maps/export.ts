// npx tsx tools/maps/export.ts <id>: write tools/maps/src/<id>.tmj from src/data/maps/<id>.json, so a map made
// before the Tiled workflow can be opened and painted in Tiled. Importing the result gives the same map back.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapData } from '../../src/core/types';
import terrain from '../../src/data/terrain.json';
import { mapToTmj } from './tiled';

const here = dirname(fileURLToPath(import.meta.url));

for (const id of process.argv.slice(2)) {
  const map = JSON.parse(readFileSync(resolve(here, '..', '..', 'src', 'data', 'maps', `${id}.json`), 'utf8')) as MapData;
  mkdirSync(join(here, 'src'), { recursive: true });
  // The tileset's tiles follow terrain.json's order (see write_tiled_tileset in tools/art/pack.py).
  const tmj = mapToTmj(map, Object.keys(terrain), '../tiles.tsj');
  writeFileSync(join(here, 'src', `${id}.tmj`), JSON.stringify(tmj, null, 1) + '\n');
  console.log(`src/data/maps/${id}.json -> tools/maps/src/${id}.tmj`);
}

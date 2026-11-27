// What to draw on each map cell, as an ordered list of images: a base tile, then overlay pieces that join roads,
// walls and shores up with their neighbours. Pure (no Phaser, no DOM), so it is unit tested; the map scene paints
// the plan into a cached texture (see ground.ts). Pieces are drawn for one direction and turned by the painter:
// road arms run east, road lips and shore banks face north, inner shore corners face north west, crossings run
// east to west.

/** Clockwise quarter turns. */
export type Rot = 0 | 1 | 2 | 3;

export interface DrawOp {
  /** Manifest image id. */
  key: string;
  rot: Rot;
}

export interface CellPlan {
  terrain: string;
  /** Images in drawing order, the first one the base. Empty when `placeholder` is true. */
  ops: DrawOp[];
  /** No art for this terrain: paint the coded placeholder instead. */
  placeholder: boolean;
}

export interface GroundInput {
  mapId: string;
  width: number;
  height: number;
  /** Row-major terrain ids. */
  terrain: readonly string[];
}

/** How often each variant of a terrain shows. Variant 1 is `tile.<id>`, variant n is `tile.<id>.<n>`. */
export interface VariantRule {
  weights: number[];
  /** A quiet base variant that may repeat freely; the others are kept from touching their own kind. */
  quiet?: number;
}

export const VARIANT_RULES: Record<string, VariantRule> = {
  plain: { weights: [16, 2, 3], quiet: 1 },
  water: { weights: [8, 1], quiet: 1 },
  forest: { weights: [1, 1, 1] },
  hill: { weights: [2, 1] },
  village: { weights: [1, 1, 1] },
  cobble: { weights: [7, 1, 1], quiet: 1 },
  flagstone: { weights: [3, 3, 1] },
  rubble: { weights: [1, 1] },
  // Houses are picked by pickRoof: the weights only say which variants exist (1 chimney, 2 ridge left to right,
  // 3 ridge top to bottom with a dormer, 4 flat tower roof).
  building: { weights: [1, 4, 3, 0] },
};

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

interface Dir {
  bit: number;
  dx: number;
  dy: number;
  /** Turns for a piece drawn facing east (road arms). */
  fromEast: Rot;
  /** Turns for a piece drawn facing north (lips, banks). */
  fromNorth: Rot;
}

const DIRS: readonly Dir[] = [
  { bit: N, dx: 0, dy: -1, fromEast: 3, fromNorth: 0 },
  { bit: E, dx: 1, dy: 0, fromEast: 0, fromNorth: 1 },
  { bit: S, dx: 0, dy: 1, fromEast: 1, fromNorth: 2 },
  { bit: W, dx: -1, dy: 0, fromEast: 2, fromNorth: 3 },
];

/** Diagonals, each with the two sides that meet there and the turns of the north west corner piece. */
const DIAGONALS: readonly { dx: number; dy: number; sides: [number, number]; rot: Rot }[] = [
  { dx: -1, dy: -1, sides: [N, W], rot: 0 },
  { dx: 1, dy: -1, sides: [N, E], rot: 1 },
  { dx: 1, dy: 1, sides: [S, E], rot: 2 },
  { dx: -1, dy: 1, sides: [S, W], rot: 3 },
];

const opposite = (bit: number): number => (bit === N ? S : bit === S ? N : bit === E ? W : E);

/** A small stable hash of a string, in [0, 1). Not the game RNG: the picture must not depend on the battle seed. */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export const variantKey = (terrain: string, n: number): string => (n === 1 ? `tile.${terrain}` : `tile.${terrain}.${n}`);

const isWaterish = (t: string | null): boolean => t === 'water' || t === 'bridge' || t === 'ford';
const isCrossing = (t: string | null): boolean => t === 'bridge' || t === 'ford';

/**
 * Pick a variant for every cell. Each cell draws from its rule's weights with a hash of the map id and its
 * coordinates, so the same map always looks the same. An accent variant (anything but the quiet one) is not put
 * next to the same accent on its left or above, and no variant fills a 2 by 2 block, when another choice exists.
 * Returns the variant number per cell (1 where the terrain has no rule or no variant art).
 */
export function pickVariants(g: GroundInput, has: (key: string) => boolean): number[] {
  const out = new Array<number>(g.width * g.height).fill(1);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x;
      const t = g.terrain[i]!;
      const rule = VARIANT_RULES[t];
      if (!rule) continue;
      if (t === 'building') {
        out[i] = pickRoof(g, x, y, out, has);
        continue;
      }
      const avail = rule.weights.map((w, k) => (has(variantKey(t, k + 1)) ? w : 0));
      const total = avail.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      let r = hash01(`${g.mapId}:${x}:${y}`) * total;
      let first = 0;
      while (first < avail.length - 1 && r >= avail[first]!) r -= avail[first++]!;
      // Candidates: the hashed pick, then the others from the most common down.
      const order = [first, ...avail.map((_, k) => k).filter((k) => k !== first && avail[k]! > 0).sort((a, b) => avail[b]! - avail[a]!)];
      const same = (dx: number, dy: number, v: number): boolean => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0) return false;
        const j = ny * g.width + nx;
        return g.terrain[j] === t && out[j] === v;
      };
      const ok = (v: number): boolean => {
        if (v === rule.quiet) return true;
        if (same(-1, 0, v) || same(0, -1, v)) return false;
        return !(same(-1, -1, v) && same(-1, 0, v) && same(0, -1, v));
      };
      const pick = order.find((k) => ok(k + 1)) ?? first;
      out[i] = pick + 1;
    }
  }
  return out;
}

/**
 * The roof of a house tile. Roofs keep one ridge direction along a run: a tile takes its west neighbour's ridge, else
 * its north neighbour's, else a hashed pick, so a block of houses reads as one roof and not a patchwork. Ridge left
 * to right (variant 2, or the rare chimney roof, variant 1) and top to bottom (variant 3, with a dormer) are picked
 * about 4 to 3; a chimney is never next to another chimney, and in a block a dormer roof is never beside or below another. A house tile with no
 * house neighbour, or one that flanks a gate, gets the flat tower roof (variant 4) when it exists.
 */
export function pickRoof(g: GroundInput, x: number, y: number, out: readonly number[], has: (key: string) => boolean): number {
  const at = (dx: number, dy: number): string | null => terrainAt(g, x + dx, y + dy);
  const roofAt = (dx: number, dy: number): number => (at(dx, dy) === 'building' && dx <= 0 && dy <= 0 ? out[(y + dy) * g.width + x + dx]! : 0);
  const house = (dx: number, dy: number): boolean => at(dx, dy) === 'building';
  const ok = (n: number): boolean => has(variantKey('building', n));
  if (!ok(2) || !ok(3)) return 1;
  const alone = !house(-1, 0) && !house(1, 0) && !house(0, -1) && !house(0, 1);
  const gateFlank = (at(-1, 0) === 'gate' || at(1, 0) === 'gate') && !house(0, -1) && !house(0, 1);
  if (ok(4) && (alone || gateFlank)) return 4;
  const left = roofAt(-1, 0);
  const above = roofAt(0, -1);
  const lr = (n: number): boolean => n === 1 || n === 2;
  let ridge: 'lr' | 'tb';
  if ((house(-1, 0) || house(1, 0)) && !house(0, -1) && !house(0, 1)) ridge = 'lr';
  else if ((house(0, -1) || house(0, 1)) && !house(-1, 0) && !house(1, 0)) ridge = 'tb';
  else if (left > 0 && left !== 4) ridge = lr(left) ? 'lr' : 'tb';
  else if (above > 0 && above !== 4) ridge = lr(above) ? 'lr' : 'tb';
  else ridge = hash01(`${g.mapId}:${x}:${y}:ridge`) < 4 / 7 ? 'lr' : 'tb';
  if (ridge === 'tb') {
    // A dormer is not repeated beside or below another in a block (a plain run keeps its ridge top to bottom).
    const run = !house(-1, 0) && !house(1, 0);
    return !run && (left === 3 || above === 3) ? 2 : 3;
  }
  return hash01(`${g.mapId}:${x}:${y}:chimney`) < 0.12 && left !== 1 && above !== 1 && ok(1) ? 1 : 2;
}

/** Whether a bridge or ford runs east to west (true) or north to south: across the water, between the land sides. */
export function crossingRunsEastWest(g: GroundInput, x: number, y: number): boolean {
  const at = (dx: number, dy: number): string | null => terrainAt(g, x + dx, y + dy);
  const land = (t: string | null) => (t !== null && !isWaterish(t) ? 1 : 0);
  const water = (t: string | null) => (t !== null && isWaterish(t) && !isCrossing(t) ? 1 : 0);
  const along = (t: string | null) => (t !== null && isCrossing(t) ? 1 : 0);
  const ew = land(at(-1, 0)) + land(at(1, 0)) + water(at(0, -1)) + water(at(0, 1)) + along(at(-1, 0)) + along(at(1, 0));
  const ns = land(at(0, -1)) + land(at(0, 1)) + water(at(-1, 0)) + water(at(1, 0)) + along(at(0, -1)) + along(at(0, 1));
  return ew >= ns;
}

function terrainAt(g: GroundInput, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return null;
  return g.terrain[y * g.width + x] ?? null;
}

/**
 * The directions a road or wall cell joins toward, as N/E/S/W bits. Roads join roads and the ends of bridges and
 * fords that run their way; walls join walls, forts, villages (a garden wall meets the cottage), gates and houses. At the map edge a cell joins outward when it continues
 * from the opposite side, or when it has nothing else to join.
 */
export function links(g: GroundInput, x: number, y: number): number {
  const t = terrainAt(g, x, y);
  let mask = 0;
  const offMap: number[] = [];
  for (const d of DIRS) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    const n = terrainAt(g, nx, ny);
    if (n === null) {
      offMap.push(d.bit);
      continue;
    }
    if (t === 'road') {
      if (n === 'road') mask |= d.bit;
      else if (isCrossing(n) && crossingRunsEastWest(g, nx, ny) === (d.bit === E || d.bit === W)) mask |= d.bit;
    } else if (t === 'wall') {
      if (n === 'wall' || n === 'fort' || n === 'village' || n === 'gate' || n === 'building') mask |= d.bit;
    }
  }
  const inner = mask;
  for (const bit of offMap) if (inner === 0 || inner & opposite(bit)) mask |= bit;
  return mask;
}

/** Plan every cell of the map. `has` says whether an image id is in the manifest. */
export function planGround(g: GroundInput, has: (key: string) => boolean): CellPlan[] {
  const variants = pickVariants(g, has);
  const plans: CellPlan[] = [];
  const hasAll = (...keys: string[]) => keys.every(has);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const i = y * g.width + x;
      const t = g.terrain[i]!;
      const single = (): CellPlan => (has(`tile.${t}`) ? { terrain: t, ops: [{ key: `tile.${t}`, rot: 0 }], placeholder: false } : { terrain: t, ops: [], placeholder: true });
      let plan: CellPlan | null = null;
      if (t === 'bridge' && canalBridge(g, x, y) && hasAll('tile.canal', 'piece.bridge.deck')) {
        // A town bridge: the canal tile (its stone lips run east to west) with the planks across it, north to south.
        plan = { terrain: t, ops: [{ key: 'tile.canal', rot: 0 }, { key: 'piece.bridge.deck', rot: 1 }], placeholder: false };
      } else if (t === 'road' && hasAll('tile.plain', 'piece.road.arm', 'piece.road.hub', 'piece.road.lip', 'piece.road.straight')) {
        plan = { terrain: t, ops: [{ key: 'tile.plain', rot: 0 }, ...roadOps(links(g, x, y))], placeholder: false };
      } else if (t === 'wall' && hasAll('tile.plain', 'piece.wall.east', 'piece.wall.west', 'piece.wall.north', 'piece.wall.south', 'piece.wall.post')) {
        plan = { terrain: t, ops: [{ key: 'tile.plain', rot: 0 }, ...wallOps(links(g, x, y))], placeholder: false };
      } else if (isWaterish(t) && hasAll('tile.water', 'piece.shore.bank', 'piece.shore.land', 'piece.shore.inner')) {
        const deck = t === 'water' ? null : `piece.${t}.deck`;
        if (deck === null || has(deck)) {
          const base = t === 'water' ? variantKey('water', variants[i]!) : 'tile.water';
          const ops: DrawOp[] = [{ key: base, rot: 0 }];
          const deckOp: DrawOp | null = deck ? { key: deck, rot: crossingRunsEastWest(g, x, y) ? 0 : 1 } : null;
          // Bridge planks rest on the banks and ford stones lead from bank to bank, so both go over the shore.
          ops.push(...shoreOps(g, x, y));
          if (deckOp) ops.push(deckOp);
          plan = { terrain: t, ops, placeholder: false };
        }
      } else if (VARIANT_RULES[t] && has(variantKey(t, variants[i]!))) {
        plan = { terrain: t, ops: [{ key: variantKey(t, variants[i]!), rot: 0 }], placeholder: false };
      }
      plans.push(plan ?? single());
    }
  }
  return plans;
}

/** A bridge over a canal: canal on its east or west side. Canals only run east to west (the tile's lips do). */
export function canalBridge(g: GroundInput, x: number, y: number): boolean {
  return terrainAt(g, x - 1, y) === 'canal' || terrainAt(g, x + 1, y) === 'canal';
}

/** Road pieces for a link mask: the whole straight for a straight run, else arms, the hub and lips on closed sides. */
export function roadOps(mask: number): DrawOp[] {
  if (mask === (E | W)) return [{ key: 'piece.road.straight', rot: 0 }];
  if (mask === (N | S)) return [{ key: 'piece.road.straight', rot: 1 }];
  const ops: DrawOp[] = [];
  for (const d of DIRS) if (mask & d.bit) ops.push({ key: 'piece.road.arm', rot: d.fromEast });
  ops.push({ key: 'piece.road.hub', rot: 0 });
  for (const d of DIRS) if (!(mask & d.bit)) ops.push({ key: 'piece.road.lip', rot: d.fromNorth });
  return ops;
}

/** Wall pieces for a link mask: halves of the straight wall east and west, arms north and south, a post unless straight. */
export function wallOps(mask: number): DrawOp[] {
  if (mask === (E | W) || mask === 0) {
    return [
      { key: 'piece.wall.west', rot: 0 },
      { key: 'piece.wall.east', rot: 0 },
    ];
  }
  const ops: DrawOp[] = [];
  if (mask & N) ops.push({ key: 'piece.wall.north', rot: 0 });
  if (mask & W) ops.push({ key: 'piece.wall.west', rot: 0 });
  if (mask & E) ops.push({ key: 'piece.wall.east', rot: 0 });
  if (mask & S) ops.push({ key: 'piece.wall.south', rot: 0 });
  ops.push({ key: 'piece.wall.post', rot: 0 });
  return ops;
}

/**
 * Shore pieces for a water, bridge or ford cell: a bank on every side that borders land, a small corner bank where
 * only the diagonal is land, then the land of every bank again so no lip shows inside land where two banks meet.
 * Off the map counts as water, so rivers run on past the edge.
 */
export function shoreOps(g: GroundInput, x: number, y: number): DrawOp[] {
  const land = (dx: number, dy: number): boolean => {
    const t = terrainAt(g, x + dx, y + dy);
    return t !== null && !isWaterish(t);
  };
  const sides = DIRS.filter((d) => land(d.dx, d.dy));
  const sideBits = sides.reduce((m, d) => m | d.bit, 0);
  const ops: DrawOp[] = sides.map((d) => ({ key: 'piece.shore.bank', rot: d.fromNorth }));
  for (const c of DIAGONALS) {
    if (land(c.dx, c.dy) && !(sideBits & c.sides[0]) && !(sideBits & c.sides[1])) ops.push({ key: 'piece.shore.inner', rot: c.rot });
  }
  for (const d of sides) ops.push({ key: 'piece.shore.land', rot: d.fromNorth });
  return ops;
}

/** Every image id a plan can ask for, so the scene can preload them. */
export function groundKeys(g: GroundInput): string[] {
  const keys = new Set<string>(['tile.plain', 'tile.water']);
  for (const t of new Set(g.terrain)) {
    keys.add(`tile.${t}`);
    const rule = VARIANT_RULES[t];
    if (rule) rule.weights.forEach((_, k) => keys.add(variantKey(t, k + 1)));
    if (t === 'road') ['arm', 'hub', 'lip', 'straight'].forEach((p) => keys.add(`piece.road.${p}`));
    if (t === 'wall') ['east', 'west', 'north', 'south', 'post'].forEach((p) => keys.add(`piece.wall.${p}`));
    if (isWaterish(t)) ['bank', 'land', 'inner'].forEach((p) => keys.add(`piece.shore.${p}`));
    if (isCrossing(t)) keys.add(`piece.${t}.deck`);
    if (t === 'bridge' && g.terrain.includes('canal')) keys.add('tile.canal');
  }
  return [...keys];
}

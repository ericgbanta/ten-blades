import { describe, expect, it } from 'vitest';
import { createBattle, forecast, reachableTiles, type MapData } from '../src/core';
import { gameData } from '../src/data';

// A river with a bridge and a ford, read from the real terrain.json.
const map: MapData = {
  id: 'crossing_test',
  name: 'Crossing test',
  width: 5,
  height: 3,
  tiles: ['..~..', '..B..', '..f..'],
  legend: { '.': 'plain', '~': 'water', B: 'bridge', f: 'ford' },
  placements: [
    { kind: 'mc', pos: { x: 1, y: 1 } },
    { kind: 'unit', id: 'foe', name: 'Foe', classId: 'hunter', team: 'enemy', level: 1, pos: { x: 3, y: 1 }, ai: { behavior: 'hold' } },
  ],
  objective: { type: 'rout' },
  reinforcements: [],
};

const battle = () => createBattle(map, { difficulty: 'normal', permadeath: 'casual', mc: { name: 'Ash', style: 'vanguard' } }, 1, gameData);

describe('bridge and ford terrain', () => {
  it('are in terrain.json with the costs the design gives them', () => {
    expect(gameData.terrain.bridge).toMatchObject({ moveCost: { foot: 1 }, avoid: 0, def: 0 });
    expect(gameData.terrain.ford).toMatchObject({ moveCost: { foot: 2 }, avoid: -10, def: 0 });
  });

  it('cost 1 to cross on the bridge and 2 to wade the ford, and water stays impassable', () => {
    const tiles = reachableTiles(battle(), 'mc', gameData);
    const cost = (x: number, y: number) => tiles.find((t) => t.pos.x === x && t.pos.y === y)?.cost;
    expect(cost(2, 1)).toBe(1);
    expect(cost(2, 2)).toBe(3); // one step to (1,2), then the ford
    expect(cost(2, 0)).toBeUndefined();
  });

  it('a unit standing in the ford is easier to hit', () => {
    const s = battle();
    const onPlain = forecast(s, 'foe', 'mc', { x: 2, y: 1 }, gameData).attacker.hit;
    const ford = { ...s, units: s.units.map((u) => (u.id === 'mc' ? { ...u, pos: { x: 2, y: 2 } } : u)) };
    const inFord = forecast(ford, 'foe', 'mc', { x: 3, y: 2 }, gameData).attacker.hit;
    const bridge = { ...s, units: s.units.map((u) => (u.id === 'mc' ? { ...u, pos: { x: 2, y: 1 } } : u)) };
    const onBridge = forecast(bridge, 'foe', 'mc', { x: 3, y: 1 }, gameData).attacker.hit;
    expect(onBridge).toBe(onPlain);
    expect(inFord).toBe(Math.min(100, onPlain + 10));
  });
});

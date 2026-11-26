// Scripted map events: every trigger and effect, the talk action, flags through a battle, and suspend and
// resume with events fired before and after the suspend point. Fixed seeds throughout.

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  battleSummary,
  createBattle,
  moveTiles,
  partyAfterBattle,
  planAiAction,
  runAiPhase,
  startBattle,
  talkTargets,
  validateAction,
  validateGameData,
  type Action,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type GameData,
  type MapEvent,
  type Objective,
  type Placement,
  type ReinforcementWave,
} from '../src/core';
import { fixtureData, makeMap, patchUnit, place, pos, SETUP } from './fixtures';

interface Scripted {
  data: GameData;
  state: BattleState;
}

/** A fixture battle on a map with these events, its map registered in the data so the core can find them. */
function scripted(
  tiles: string[],
  placements: Placement[],
  events: MapEvent[],
  o: { objective?: Objective; reinforcements?: ReinforcementWave[]; setup?: BattleSetup; seed?: number } = {},
): Scripted {
  const data = fixtureData();
  const map = { ...makeMap(tiles, placements, o.objective, o.reinforcements), events };
  data.maps[map.id] = map;
  return { data, state: createBattle(map, o.setup ?? SETUP, o.seed ?? 1, data) };
}

const scenes = (events: BattleEvent[]): string[] => events.flatMap((e) => (e.type === 'sceneRequested' ? [e.sceneId] : []));
const scene = (id: string, sceneId = id): MapEvent['effects'][number] => ({ type: 'scene', sceneId });
const wait = (unitId: string, x: number, y: number): Action => ({ type: 'wait', unitId, to: pos(x, y) });
const END: Action = { type: 'endPhase' };

describe('battle start', () => {
  it('fires battleStart, a flag set at start and turn 1 player phase, once, in map order', () => {
    const { state, data } = scripted(
      ['.....'],
      [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 4, 0)],
      [
        { id: 'turn1', trigger: { type: 'phaseStart', turn: 1 }, effects: [scene('turn1')] },
        { id: 'start', trigger: { type: 'battleStart' }, effects: [scene('start')] },
        { id: 'flagged', trigger: { type: 'flag', flag: 'met', value: 'yes' }, effects: [scene('flagged')] },
        { id: 'unflagged', trigger: { type: 'flag', flag: 'gone' }, effects: [scene('unflagged')] },
      ],
      { setup: { ...SETUP, flags: { met: 'yes' } } },
    );
    expect(state.started).toBe(false);
    expect(state.flags).toEqual({ met: 'yes' });
    const r = startBattle(state, data);
    expect(scenes(r.events)).toEqual(['turn1', 'start', 'flagged']);
    expect(r.state.started).toBe(true);
    expect(r.state.firedEvents).toEqual(['turn1', 'start', 'flagged']);
    expect(startBattle(r.state, data).events).toEqual([]);
    expect(state.started).toBe(false);
  });

  it('the first action of a battle nobody started starts it, with the start events first', () => {
    const { state, data } = scripted(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 3, 0)], [
      { id: 'start', trigger: { type: 'battleStart' }, effects: [scene('start')] },
    ]);
    const r = applyAction(state, wait('p', 0, 0), data);
    expect(r.events[0]).toEqual({ type: 'eventFired', eventId: 'start' });
    expect(scenes(r.events)).toEqual(['start']);
    expect(r.state.started).toBe(true);
  });
});

describe('triggers', () => {
  const units = (): Placement[] => [
    place('p', 'fighter', 'player', 0, 0, { isLord: true }),
    place('q', 'rogue', 'player', 0, 2),
    place('e', 'fighter', 'enemy', 6, 0, { ai: { behavior: 'guard' }, tags: ['guard'] }),
    place('f', 'fighter', 'enemy', 6, 2, { ai: { behavior: 'guard' }, tags: ['guard'] }),
  ];
  const tiles = ['.......', '.......', '.......'];

  it('phaseStart fires at the start of that phase of that turn', () => {
    const { state, data } = scripted(tiles, units(), [
      { id: 'enemy2', trigger: { type: 'phaseStart', turn: 2, phase: 'enemy' }, effects: [scene('enemy2')] },
      { id: 'player2', trigger: { type: 'phaseStart', turn: 2 }, effects: [scene('player2')] },
    ]);
    let s = applyAction(state, END, data).state;
    s = runAiPhase(s, data).state;
    expect(s.turn).toBe(2);
    expect(s.firedEvents).toEqual(['player2']);
    const r = applyAction(s, END, data);
    expect(scenes(r.events)).toEqual(['enemy2']);
    // The scene comes after the phase change it belongs to.
    const i = r.events.findIndex((e) => e.type === 'phaseChanged');
    expect(r.events.findIndex((e) => e.type === 'sceneRequested')).toBeGreaterThan(i);
  });

  it('enter fires when a matching unit ends a move in the region, not for others or a stay in place', () => {
    const { state, data } = scripted(tiles, units(), [
      { id: 'q_area', trigger: { type: 'enter', unitId: 'q', area: { x: 2, y: 1, w: 2, h: 2 } }, effects: [scene('q_area')] },
      { id: 'any_tile', trigger: { type: 'enter', tiles: [pos(1, 0)] }, effects: [scene('any_tile')], repeatable: true },
    ]);
    let r = applyAction(state, wait('p', 2, 1), data);
    expect(scenes(r.events)).toEqual([]);
    r = applyAction(r.state, wait('q', 3, 2), data);
    expect(scenes(r.events)).toEqual(['q_area']);
    // Any player unit; repeatable fires again on the next visit.
    let s = runAiPhase(applyAction(r.state, END, data).state, data).state;
    r = applyAction(s, wait('p', 1, 0), data);
    expect(scenes(r.events)).toEqual(['any_tile']);
    r = applyAction(r.state, wait('q', 3, 2), data);
    expect(scenes(r.events)).toEqual([]);
    s = runAiPhase(applyAction(r.state, END, data).state, data).state;
    r = applyAction(s, wait('p', 2, 0), data);
    r = applyAction(r.state, wait('q', 1, 0), data);
    expect(scenes(r.events)).toEqual(['any_tile']);
    expect(r.state.firedEvents).toEqual(['q_area', 'any_tile']);
  });

  it('defeated matches by id, tag, team and by whose blow; allDefeated waits for every tagged enemy', () => {
    const { state, data } = scripted(['.......'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true, weaponId: 'sure_axe' }),
      place('e', 'fighter', 'enemy', 2, 0, { ai: { behavior: 'guard' }, tags: ['guard'] }),
      place('f', 'fighter', 'enemy', 6, 0, { ai: { behavior: 'guard' }, tags: ['guard'] }),
    ], [
      { id: 'by_p', trigger: { type: 'defeated', byId: 'p' }, effects: [scene('by_p')] },
      { id: 'by_q', trigger: { type: 'defeated', byId: 'q' }, effects: [scene('by_q')] },
      { id: 'tag', trigger: { type: 'defeated', tag: 'guard' }, effects: [scene('tag')], repeatable: true },
      { id: 'f_down', trigger: { type: 'defeated', unitId: 'f', team: 'enemy' }, effects: [scene('f_down')] },
      { id: 'all', trigger: { type: 'allDefeated', tag: 'guard' }, effects: [scene('all')] },
    ], { objective: { type: 'survive', turns: 9 } });
    let s = patchUnit(state, 'e', { hp: 1 });
    s = patchUnit(s, 'f', { hp: 1 });
    let r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(1, 0), targetId: 'e' }, data);
    expect(scenes(r.events)).toEqual(['by_p', 'tag']);
    s = runAiPhase(applyAction(r.state, END, data).state, data).state;
    r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(5, 0), targetId: 'f' }, data);
    expect(scenes(r.events)).toEqual(['tag', 'f_down', 'all']);
  });

  it('hpBelow fires once when a living unit drops under the percent', () => {
    const { state, data } = scripted(['....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('e', 'brute', 'enemy', 1, 0, { weaponId: 'sure_axe' }),
    ], [{ id: 'low', trigger: { type: 'hpBelow', unitId: 'p', percent: 50 }, effects: [scene('low')] }], {
      objective: { type: 'survive', turns: 9 },
    });
    let s = patchUnit(state, 'p', { hp: 11, stats: { hp: 20 } });
    let r = applyAction(s, wait('p', 0, 0), data);
    expect(scenes(r.events)).toEqual([]);
    s = patchUnit(r.state, 'p', { hp: 9 });
    r = applyAction(s, END, data);
    expect(scenes(r.events)).toEqual(['low']);
    const again = applyAction(patchUnit(r.state, 'p', { hp: 5 }), wait('e', 1, 0), data);
    expect(scenes(again.events)).toEqual([]);
  });

  it('conditions hold an event back until they are true, and it stays ready', () => {
    const { state, data } = scripted(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 3, 0, { ai: { behavior: 'guard' } })], [
      {
        id: 'gated',
        trigger: { type: 'enter', tiles: [pos(1, 0)] },
        conditions: [{ type: 'flag', flag: 'open' }, { type: 'alive', unitId: 'e' }, { type: 'permadeath', mode: 'classic' }, { type: 'difficulty', difficulties: ['normal'] }],
        effects: [scene('gated')],
      },
    ]);
    let r = applyAction(state, wait('p', 1, 0), data);
    expect(scenes(r.events)).toEqual([]);
    expect(r.state.firedEvents).toEqual([]);
    const s = runAiPhase(applyAction({ ...r.state, flags: { open: true } }, END, data).state, data).state;
    r = applyAction(s, wait('p', 0, 0), data);
    r = applyAction(runAiPhase(applyAction(r.state, END, data).state, data).state, wait('p', 1, 0), data);
    expect(scenes(r.events)).toEqual(['gated']);
  });

  it('a fallen condition counts a death, not a unit that left', () => {
    const { state, data } = scripted(['....'], [
      place('p', 'fighter', 'player', 2, 0, { isLord: true }),
      place('g', 'rogue', 'player', 1, 0),
      place('e', 'fighter', 'enemy', 3, 0, { ai: { behavior: 'guard' } }),
    ], [
      { id: 'go', trigger: { type: 'enter', unitId: 'g', tiles: [pos(0, 0)] }, effects: [{ type: 'remove', unitId: 'g' }] },
      { id: 'mourn', trigger: { type: 'enter', unitId: 'p', tiles: [pos(1, 0)] }, conditions: [{ type: 'fallen', unitId: 'g' }], effects: [scene('mourn')] },
    ]);
    let r = applyAction(state, wait('g', 0, 0), data);
    expect(r.state.firedEvents).toEqual(['go']);
    expect(r.state.units.find((u) => u.id === 'g')).toMatchObject({ alive: false, left: true });
    r = applyAction(r.state, wait('p', 1, 0), data);
    expect(scenes(r.events)).toEqual([]);
  });
});

describe('effects', () => {
  const tiles = ['......', '......'];
  const units = (): Placement[] => [
    place('p', 'fighter', 'player', 0, 0, { isLord: true }),
    place('q', 'rogue', 'player', 0, 1),
    place('e', 'fighter', 'enemy', 5, 0, { ai: { behavior: 'hold' } }),
    place('n', 'rogue', 'enemy', 3, 1, { ai: { behavior: 'hold' } }),
  ];
  const fire = (effects: MapEvent['effects'], o: { objective?: Objective } = {}) => {
    const { state, data } = scripted(tiles, units(), [{ id: 'go', trigger: { type: 'battleStart' }, effects }], { objective: o.objective ?? { type: 'survive', turns: 9 } });
    return { ...startBattle(state, data), data };
  };

  it('spawn places units like a wave, skipping a taken tile', () => {
    const r = fire([
      {
        type: 'spawn',
        units: [place('x', 'fighter', 'enemy', 4, 1), place('y', 'fighter', 'enemy', 3, 1), place('z', 'rogue', 'player', 1, 1)],
      },
    ]);
    expect(r.events).toContainEqual({ type: 'reinforcementsArrived', unitIds: ['x', 'z'] });
    expect(r.state.units.map((u) => u.id)).toEqual(['p', 'q', 'e', 'n', 'x', 'z']);
    // Spawned in the player phase: the player unit waits for the next one, the enemy acts in its phase.
    expect(r.state.units.find((u) => u.id === 'z')!.acted).toBe(true);
    expect(r.state.units.find((u) => u.id === 'x')!.acted).toBe(false);
  });

  it('spawn with nearest moves a unit off a taken tile to the nearest free tile it can stand on', () => {
    const r = fire([{ type: 'spawn', nearest: true, units: [place('y', 'fighter', 'enemy', 3, 1), place('z', 'rogue', 'player', 0, 0)] }]);
    expect(r.events).toContainEqual({ type: 'reinforcementsArrived', unitIds: ['y', 'z'] });
    // (3, 1) is n's: of the tiles one step away, (3, 0) comes first in reading order. (0, 0) is p's and (0, 1) q's.
    expect(r.state.units.find((u) => u.id === 'y')!.pos).toEqual(pos(3, 0));
    expect(r.state.units.find((u) => u.id === 'z')!.pos).toEqual(pos(1, 0));
    // Walls and water are skipped: the nearest tile a foot unit can stand on.
    const walled = scripted(
      ['.#~', '#..'],
      [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 2, 1, { ai: { behavior: 'hold' } })],
      [{ id: 'go', trigger: { type: 'battleStart' }, effects: [{ type: 'spawn', nearest: true, units: [place('w', 'rogue', 'player', 0, 0)] }] }],
      { objective: { type: 'survive', turns: 9 } },
    );
    expect(startBattle(walled.state, walled.data).state.units.find((u) => u.id === 'w')!.pos).toEqual(pos(1, 1));
  });

  it('remove takes a unit off the map without a death', () => {
    const r = fire([{ type: 'remove', unitId: 'q' }]);
    expect(r.events).toContainEqual({ type: 'unitLeft', unitId: 'q' });
    const q = r.state.units.find((u) => u.id === 'q')!;
    expect(q).toMatchObject({ alive: false, left: true });
    expect(q.hp).toBeGreaterThan(0);
    expect(battleSummary(r.state).fallenPlayerUnitIds).toEqual([]);
    const party = partyAfterBattle(r.state);
    expect(party.left.map((u) => u.id)).toEqual(['q']);
    expect(party.fallen).toEqual([]);
  });

  it('setTeam recruits an enemy with its current HP; it joins the party after the battle', () => {
    const { state, data } = scripted(tiles, units(), [{ id: 'go', trigger: { type: 'battleStart' }, effects: [{ type: 'setTeam', unitId: 'n', team: 'player' }] }], {
      objective: { type: 'survive', turns: 9 },
    });
    const r = startBattle(patchUnit(state, 'n', { hp: 7 }), data);
    const n = r.state.units.find((u) => u.id === 'n')!;
    expect(n).toMatchObject({ team: 'player', hp: 7, ai: null, acted: true });
    expect(r.events).toContainEqual({ type: 'unitTeamChanged', unitId: 'n', from: 'enemy', to: 'player' });
    expect(r.state.recruited).toEqual(['n']);
    expect(partyAfterBattle(r.state).survivors.map((u) => u.id)).toEqual(['p', 'q', 'n']);
    expect(battleSummary(r.state).recruited).toEqual(['n']);
  });

  it('setTeam to the enemy gives an AI; setAi changes it', () => {
    const r = fire([
      { type: 'setTeam', unitId: 'q', team: 'enemy', ai: { behavior: 'guard', radius: 1 } },
      { type: 'setAi', unitId: 'e', ai: { behavior: 'charge' } },
    ]);
    expect(r.state.units.find((u) => u.id === 'q')!.ai).toEqual({ behavior: 'guard', guardTile: pos(0, 1), guardRadius: 1, active: false });
    expect(r.state.units.find((u) => u.id === 'e')!.ai!.behavior).toBe('charge');
    expect(r.events).toContainEqual({ type: 'aiChanged', unitId: 'e' });
  });

  it('setFlag, objective and giveWeapon change the state and say so', () => {
    const r = fire([
      { type: 'setFlag', flag: 'seen', value: 3 },
      { type: 'objective', objective: { type: 'defeatBoss' } },
      { type: 'giveWeapon', unitId: 'p', weaponId: 'crit_axe' },
    ]);
    expect(r.state.flags).toEqual({ seen: 3 });
    expect(r.state.objective).toEqual({ type: 'defeatBoss' });
    expect(r.state.units[0]!.weaponId).toBe('crit_axe');
    expect(r.events.map((e) => e.type)).toEqual(['eventFired', 'flagSet', 'objectiveChanged', 'weaponChanged']);
  });

  it('heal and damage; damage leaves 1 HP unless lethal, and a lethal blow fires defeated triggers', () => {
    const { state, data } = scripted(tiles, units(), [
      {
        id: 'go',
        trigger: { type: 'battleStart' },
        effects: [
          { type: 'damage', unitId: 'q', amount: 99 },
          { type: 'heal', unitId: 'q', amount: 3 },
          { type: 'damage', unitId: 'n', amount: 99, lethal: true },
        ],
      },
      { id: 'n_down', trigger: { type: 'defeated', unitId: 'n' }, effects: [scene('n_down')] },
    ], { objective: { type: 'survive', turns: 9 } });
    const r = startBattle(state, data);
    expect(r.state.units.find((u) => u.id === 'q')!.hp).toBe(4);
    expect(r.state.units.find((u) => u.id === 'n')!.alive).toBe(false);
    expect(r.events).toContainEqual({ type: 'unitDefeated', unitId: 'n', byId: null });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'unitHealed', cause: 'event', amount: 3 }));
    expect(scenes(r.events)).toEqual(['n_down']);
  });

  it('endBattle ends it at once and later effects do not run', () => {
    const r = fire([{ type: 'endBattle', result: 'victory' }, { type: 'setFlag', flag: 'late', value: true }]);
    expect(r.state.result).toBe('victory');
    expect(r.state.flags).toEqual({});
    expect(r.events.at(-1)).toMatchObject({ type: 'battleEnded', result: 'victory' });
  });

  it('lock stops a unit acting this turn; unlock lets it act again', () => {
    const r = fire([{ type: 'lock', unitId: 'q' }]);
    expect(validateAction(r.state, wait('q', 0, 1), r.data)).toMatch(/already acted/);
    const { state, data } = scripted(tiles, units(), [
      { id: 'lock', trigger: { type: 'battleStart' }, effects: [{ type: 'lock', unitId: 'q' }] },
      { id: 'unlock', trigger: { type: 'enter', unitId: 'p', tiles: [pos(1, 0)] }, effects: [{ type: 'unlock', unitId: 'q' }] },
    ], { objective: { type: 'survive', turns: 9 } });
    const s = applyAction(state, wait('p', 1, 0), data).state;
    expect(s.units.find((u) => u.id === 'q')!.acted).toBe(false);
    expect(validateAction(s, wait('q', 0, 1), data)).toBeNull();
  });

  it('an enemy locked in the player phase skips the enemy phase', () => {
    const { state, data } = scripted(['...'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 2, 0)], [
      { id: 'lock', trigger: { type: 'battleStart' }, effects: [{ type: 'lock', unitId: 'e' }] },
    ], { objective: { type: 'survive', turns: 9 } });
    const s = applyAction(startBattle(state, data).state, END, data).state;
    expect(planAiAction(s, data)).toEqual({ type: 'endPhase' });
  });
});

describe('talk', () => {
  const setup = () =>
    scripted(['......', '......'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('q', 'rogue', 'player', 0, 1),
      place('d', 'rogue', 'enemy', 3, 0, { ai: { behavior: 'guard' } }),
      place('e', 'fighter', 'enemy', 5, 1, { ai: { behavior: 'hold' } }),
    ], [
      {
        id: 'recruit',
        trigger: { type: 'talk', unitId: 'p', targetId: 'd' },
        effects: [scene('recruit'), { type: 'setTeam', unitId: 'd', team: 'player' }, { type: 'setFlag', flag: 'recruited_d', value: true }],
      },
    ]);

  it('targets need a ready talk event for the pair and to stand next to the target', () => {
    const { state, data } = setup();
    expect(talkTargets(state, 'p', pos(2, 0), data)).toEqual(['d']);
    expect(talkTargets(state, 'p', pos(1, 0), data)).toEqual([]);
    expect(talkTargets(state, 'q', pos(3, 1), data)).toEqual([]);
    expect(validateAction(state, { type: 'talk', unitId: 'p', to: pos(1, 0), targetId: 'd' }, data)).toMatch(/not next to/);
    expect(validateAction(state, { type: 'talk', unitId: 'q', to: pos(3, 1), targetId: 'd' }, data)).toMatch(/nothing to say/);
    expect(validateAction(state, { type: 'talk', unitId: 'p', to: pos(2, 0), targetId: 'p' }, data)).toMatch(/itself/);
    expect(validateAction(state, { type: 'talk', unitId: 'p', to: pos(2, 0), targetId: 'd' }, data)).toBeNull();
    expect(validateAction(state, { type: 'talk', unitId: 'p', to: pos(2, 0) } as unknown as Action, data)).toMatch(/needs a targetId/);
  });

  it('talking moves, uses the action, fires the event and recruits the target; it cannot repeat', () => {
    const { state, data } = setup();
    const r = applyAction(state, { type: 'talk', unitId: 'p', to: pos(2, 0), targetId: 'd' }, data);
    expect(r.events.map((e) => e.type)).toEqual(['unitMoved', 'unitActed', 'talked', 'eventFired', 'sceneRequested', 'unitTeamChanged', 'flagSet']);
    expect(r.state.units.find((u) => u.id === 'p')).toMatchObject({ pos: pos(2, 0), acted: true });
    expect(r.state.units.find((u) => u.id === 'd')).toMatchObject({ team: 'player', ai: null });
    expect(r.state.flags).toEqual({ recruited_d: true });
    expect(battleSummary(r.state).flags).toEqual({ recruited_d: true });
    expect(talkTargets(r.state, 'p', pos(2, 0), data)).toEqual([]);
  });

  it('the AI never talks and ignores scenes', () => {
    const { state, data } = setup();
    const s = applyAction(state, END, data).state;
    for (let a = planAiAction(s, data), t = s, n = 0; a && n < 10; n++) {
      expect(a.type).not.toBe('talk');
      t = applyAction(t, a, data).state;
      a = planAiAction(t, data);
    }
  });
});

describe('validateGameData on events', () => {
  it('reports bad references, shapes and rules', () => {
    const data = fixtureData();
    const map = {
      ...makeMap(['....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 3, 0, { tags: ['boss_guard'] }), { kind: 'mc' as const, pos: pos(1, 0) }]),
      events: [
        { id: 'a', trigger: { type: 'talk', unitId: 'p', targetId: 'ghost' }, effects: [{ type: 'scene', sceneId: 'nope' }] },
        { id: 'a', trigger: { type: 'battleStart' }, effects: [{ type: 'remove', unitId: 'e' }], repeatable: true },
        { id: 'b', trigger: { type: 'enter' }, effects: [] },
        { id: 'c', trigger: { type: 'allDefeated', tag: 'nobody' }, effects: [{ type: 'giveWeapon', unitId: 'p', weaponId: 'laser' }] },
        { id: 'd', trigger: { type: 'hpBelow', unitId: 'p', percent: 0 }, effects: [{ type: 'damage', unitId: 'p', amount: 0 }] },
        { id: 'e', trigger: { type: 'phaseStart', turn: 0 }, conditions: [{ type: 'alive', unitId: 'ghost' }], effects: [{ type: 'setFlag', flag: 'Bad Name', value: true }] },
        { id: 'f', trigger: { type: 'enter', area: { x: 3, y: 0, w: 2, h: 1 } }, effects: [{ type: 'spawn', units: [place('e', 'fighter', 'enemy', 2, 0)] }] },
        { id: 'g', trigger: { type: 'defeated', tag: 'boss_guard' }, effects: [{ type: 'scene', sceneId: 'ok' }] },
      ] as MapEvent[],
    };
    data.maps.test = map;
    const errs = validateGameData(data, { sceneIds: ['ok'] });
    const has = (re: RegExp) => expect(errs.some((e) => re.test(e)), `${re}\n${errs.join('\n')}`).toBe(true);
    has(/event a: unknown unit ghost/);
    has(/event a: unknown scene nope/);
    has(/event a: duplicate event id/);
    has(/event a: only enter, defeated and talk events can repeat/);
    has(/event b: enter needs tiles or an area/);
    has(/event b: no effects/);
    has(/event c: no unit has tag nobody/);
    has(/event c: unknown weapon laser/);
    has(/event d: percent must be 1 to 100/);
    has(/event d: amount must be/);
    has(/event e: bad turn/);
    has(/event e: unknown unit ghost/);
    has(/event e: bad flag name/);
    has(/event f: area off the map/);
    has(/duplicate unit id e/);
    expect(errs.some((e) => e.includes('event g'))).toBe(false);
  });
});

describe('suspend and resume with events', () => {
  // A scripted player: every ready unit waits a step toward the enemy, then ends the turn.
  const tiles = ['........', '........', '........'];
  const units = (): Placement[] => [
    place('p', 'fighter', 'player', 0, 0, { isLord: true }),
    place('q', 'rogue', 'player', 0, 2),
    place('e', 'fighter', 'enemy', 7, 0, { tags: ['wave'] }),
    place('f', 'archer', 'enemy', 7, 2, { tags: ['wave'] }),
  ];
  const events: MapEvent[] = [
    { id: 'start', trigger: { type: 'battleStart' }, effects: [scene('start'), { type: 'setFlag', flag: 'begun', value: true }] },
    { id: 'turn2', trigger: { type: 'phaseStart', turn: 2, phase: 'enemy' }, effects: [scene('turn2'), { type: 'spawn', units: [place('r', 'fighter', 'enemy', 7, 1)] }] },
    { id: 'hurt', trigger: { type: 'hpBelow', unitId: 'p', percent: 90 }, effects: [scene('hurt'), { type: 'heal', unitId: 'p', amount: 2 }] },
    { id: 'step', trigger: { type: 'enter', team: 'player', area: { x: 2, y: 0, w: 2, h: 3 } }, effects: [{ type: 'damage', unitId: 'e', amount: 1 }], repeatable: true },
  ];
  const plan = (s: BattleState, data: GameData): Action => {
    const ready = s.units.find((u) => u.team === 'player' && u.alive && !u.acted);
    if (!ready) return END;
    const step = { x: ready.pos.x + 1, y: ready.pos.y };
    const to = moveTiles(s, ready.id, data).some((t) => t.x === step.x && t.y === step.y) ? step : ready.pos;
    return { type: 'wait', unitId: ready.id, to };
  };
  const play = (start: BattleState, data: GameData, n: number) => {
    let s = start;
    const log: BattleEvent[] = [];
    for (let i = 0; i < n && s.result === 'ongoing'; i++) {
      const a = s.phase === 'player' ? plan(s, data) : planAiAction(s, data)!;
      const r = applyAction(s, a, data);
      log.push(...r.events);
      s = r.state;
    }
    return { s, log };
  };

  it('a run cut at any point and resumed from JSON matches the uninterrupted run, events included', () => {
    const { state, data } = scripted(tiles, units(), events, { seed: 11 });
    const begun = startBattle(state, data);
    const whole = play(begun.state, data, 40);
    expect(whole.log.some((e) => e.type === 'sceneRequested' && e.sceneId === 'turn2')).toBe(true);
    expect(whole.s.firedEvents).toEqual(expect.arrayContaining(['start', 'turn2', 'step']));
    for (const cut of [0, 1, 3, 5, 8, 13]) {
      const first = play(begun.state, data, cut);
      const resumed = JSON.parse(JSON.stringify(first.s)) as BattleState;
      const rest = play(resumed, data, 40 - cut);
      expect(rest.s).toEqual(whole.s);
      expect([...first.log, ...rest.log]).toEqual(whole.log);
    }
  });
});

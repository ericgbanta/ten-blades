import { describe, expect, it } from 'vitest';
import {
  ActionError,
  applyAction,
  battleSummary,
  createBattle,
  planAiAction,
  planUnitAction,
  runAiPhase,
  validateAction,
  type Action,
  type AiState,
  type BattleEvent,
  type BattleState,
  type GameData,
} from '../src/core';
import { gameData } from '../src/data';
import { deepFreeze, fixtureData, makeBattle, makeMap, patchUnit, place, pos, SETUP } from './fixtures';

const data = fixtureData();
const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;
const types = (ev: BattleEvent[]) => ev.map((e) => e.type);
const end: Action = { type: 'endPhase' };

describe('createBattle', () => {
  it('builds the map, units and starting phase', () => {
    const s = makeBattle(['.F', 'T#'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'rogue', 'enemy', 1, 0)]);
    expect(s.map).toEqual({ width: 2, height: 2, terrain: ['plain', 'forest', 'fort', 'wall'] });
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('player');
    expect(s.result).toBe('ongoing');
    expect(unit(s, 'p')).toMatchObject({ hp: 20, level: 1, weaponId: 'axe', ai: null, acted: false, alive: true, isLord: true });
    expect(unit(s, 'e').ai).toEqual({ behavior: 'charge', guardTile: null, guardRadius: 0, active: false });
  });

  it('fills the MC slot from the setup and party slots from the party', () => {
    const d = fixtureData();
    d.classes.vanguard = d.classes.fighter!;
    const map = makeMap(['....'], [
      { kind: 'mc', pos: pos(0, 0) },
      { kind: 'party', pos: pos(1, 0) },
      { kind: 'party', pos: pos(2, 0) },
      place('e', 'rogue', 'enemy', 3, 0),
    ]);
    const fresh = createBattle(map, SETUP, 1, d);
    expect(unit(fresh, 'mc')).toMatchObject({ name: 'Hero', classId: 'vanguard', isLord: true, weaponId: 'axe' });
    expect(fresh.units).toHaveLength(2);

    const member = { id: 'ally1', name: 'Kit', classId: 'rogue', level: 3, xp: 40, stats: d.classes.rogue!.baseStats, weaponId: 'dagger', isLord: false, inventory: ['dagger'] };
    const lord = { ...member, id: 'hero', name: 'Hero', classId: 'fighter', isLord: true, weaponId: 'axe', inventory: ['axe'] };
    const s = createBattle(map, { ...SETUP, party: [member, lord] }, 1, d);
    expect(s.units.map((u) => [u.id, u.pos.x])).toEqual([
      ['hero', 0],
      ['ally1', 1],
      ['e', 3],
    ]);
    expect(unit(s, 'ally1')).toMatchObject({ level: 3, xp: 40, hp: 18 });
  });

  it('scales enemies by difficulty, not players', () => {
    const placements = [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('e', 'fighter', 'enemy', 3, 0),
      place('h', 'fighter', 'enemy', 3, 1, { ai: { behavior: 'hold' } }),
    ];
    const tiles = ['....', '....'];
    const normal = makeBattle(tiles, placements);
    const hard = makeBattle(tiles, placements, { setup: { ...SETUP, difficulty: 'hard' } });
    const lunatic = makeBattle(tiles, placements, { setup: { ...SETUP, difficulty: 'lunatic' } });
    expect(unit(normal, 'e').stats).toEqual(data.classes.fighter!.baseStats);
    // Hard: level 2 (base + 1 rounded growth), x1.5, str +1.
    expect(unit(hard, 'e')).toMatchObject({ level: 2, hp: 32 });
    expect(unit(hard, 'e').stats).toMatchObject({ hp: 32, str: 12, mov: 4 });
    // Lunatic: level 3 (+1 per stat), x2, hp +5.
    expect(unit(lunatic, 'e').stats).toMatchObject({ hp: 47, str: 14, mov: 4 });
    expect(unit(hard, 'p').stats).toEqual(unit(normal, 'p').stats);
    expect(unit(lunatic, 'p').stats).toEqual(unit(normal, 'p').stats);
    // Lunatic AI is aggressive: hold becomes charge.
    expect(unit(hard, 'h').ai!.behavior).toBe('hold');
    expect(unit(lunatic, 'h').ai!.behavior).toBe('charge');
  });
});

describe('action validation', () => {
  const s = makeBattle(['......'], [
    place('p', 'fighter', 'player', 0, 0, { isLord: true }),
    place('q', 'fighter', 'player', 1, 0),
    place('e', 'fighter', 'enemy', 5, 0),
  ]);
  const bad: [string, Action][] = [
    ['onto an ally', { type: 'wait', unitId: 'p', to: pos(1, 0) }],
    ['too far', { type: 'wait', unitId: 'q', to: pos(5, 0) }],
    ['off the map', { type: 'wait', unitId: 'p', to: pos(-1, 0) }],
    ['enemy in player phase', { type: 'wait', unitId: 'e', to: pos(5, 0) }],
    ['attack an ally', { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'q' }],
    ['out of range', { type: 'attack', unitId: 'q', to: pos(2, 0), targetId: 'e' }],
    ['heal without a staff', { type: 'heal', unitId: 'p', to: pos(0, 0), targetId: 'q' }],
    ['unknown unit', { type: 'wait', unitId: 'zz', to: pos(0, 0) }],
  ];
  for (const [name, a] of bad) {
    it(`rejects ${name}`, () => {
      expect(validateAction(s, a, data)).not.toBeNull();
      expect(() => applyAction(s, a, data)).toThrow(ActionError);
    });
  }

  it('rejects acting twice and acting after the battle ends', () => {
    const s2 = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data).state;
    expect(() => applyAction(s2, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data)).toThrow(/already acted/);
    const over = { ...s2, result: 'victory' as const };
    expect(() => applyAction(over, end, data)).toThrow(/over/);
  });
});

describe('moving and waiting', () => {
  it('emits the path and marks the unit done', () => {
    const s = makeBattle(['.....'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 4, 0)]);
    const r = applyAction(s, { type: 'wait', unitId: 'p', to: pos(2, 0) }, data);
    expect(r.events).toEqual([
      { type: 'unitMoved', unitId: 'p', from: pos(0, 0), to: pos(2, 0), path: [pos(0, 0), pos(1, 0), pos(2, 0)] },
      { type: 'unitActed', unitId: 'p' },
    ]);
    expect(unit(r.state, 'p')).toMatchObject({ pos: pos(2, 0), acted: true });
    expect(unit(s, 'p')).toMatchObject({ pos: pos(0, 0), acted: false });
  });
});

describe('phases', () => {
  it('cycles player, enemy, player and resets acted flags', () => {
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })]);
    s = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 0) }, data).state;
    let r = applyAction(s, end, data);
    expect(r.events).toEqual([{ type: 'phaseChanged', phase: 'enemy', turn: 1 }]);
    expect(unit(r.state, 'p').acted).toBe(false);
    r = runAiPhase(r.state, data);
    expect(types(r.events)).toEqual(['unitActed', 'turnStarted', 'phaseChanged']);
    expect(r.state).toMatchObject({ turn: 2, phase: 'player' });
    expect(unit(r.state, 'e').acted).toBe(false);
  });

  it('runs an ally phase when allies live', () => {
    let s = makeBattle(['..........'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('a', 'fighter', 'ally', 1, 0, { ai: { behavior: 'hold' } }),
      place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } }),
    ]);
    s = applyAction(s, end, data).state;
    const r = runAiPhase(s, data);
    const phases = r.events.filter((e) => e.type === 'phaseChanged').map((e) => (e.type === 'phaseChanged' ? e.phase : ''));
    expect(phases).toEqual(['ally', 'player']);
  });

  it('forts heal 20% at the start of the owner phase', () => {
    let s = makeBattle(['T........T'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })]);
    s = patchUnit(s, 'p', { hp: 10 });
    s = patchUnit(s, 'e', { hp: 19 });
    let r = applyAction(s, end, data);
    expect(r.events).toContainEqual({ type: 'unitHealed', unitId: 'e', sourceId: null, cause: 'terrain', amount: 1, hpAfter: 20 });
    r = runAiPhase(r.state, data);
    expect(r.events).toContainEqual({ type: 'unitHealed', unitId: 'p', sourceId: null, cause: 'terrain', amount: 4, hpAfter: 14 });
  });

  it('reinforcements arrive on their turn and difficulty, and skip blocked tiles', () => {
    const wave = {
      turn: 2,
      difficulties: ['normal' as const],
      units: [place('r1', 'fighter', 'enemy', 9, 0), place('r2', 'fighter', 'enemy', 8, 0)],
    };
    const later = { turn: 2, difficulties: ['hard' as const], units: [place('r3', 'fighter', 'enemy', 7, 0)] };
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 8, 0, { ai: { behavior: 'hold' } })], {
      reinforcements: [wave, later],
    });
    expect(s.reinforcements).toHaveLength(1);
    s = runAiPhase(applyAction(s, end, data).state, data).state;
    expect(s.units).toHaveLength(2);
    const r = applyAction(s, end, data);
    expect(r.events).toContainEqual({ type: 'reinforcementsArrived', unitIds: ['r1'] });
    expect(unit(r.state, 'r1').acted).toBe(true); // they move next turn
    expect(r.state.reinforcements).toHaveLength(0);
    expect(planAiAction(r.state, data)).toMatchObject({ unitId: 'e' });
  });
});

describe('objectives', () => {
  const sure = { weaponId: 'sure_axe' };

  it('rout: the last enemy falling wins', () => {
    let s = makeBattle(['...'], [place('p', 'fighter', 'player', 0, 0, { isLord: true, ...sure }), place('e', 'rogue', 'enemy', 1, 0)]);
    s = patchUnit(s, 'e', { hp: 1 });
    const r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, data);
    expect(r.state.result).toBe('victory');
    expect(r.events[r.events.length - 1]).toEqual({ type: 'battleEnded', result: 'victory', fallenPlayerUnitIds: [] });
  });

  it('defeatBoss: the boss falling wins with others alive', () => {
    let s = makeBattle(['.....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true, ...sure }),
      place('b', 'rogue', 'enemy', 1, 0, { isBoss: true }),
      place('e', 'rogue', 'enemy', 4, 0),
    ], { objective: { type: 'defeatBoss' } });
    s = patchUnit(s, 'b', { hp: 1 });
    expect(applyAction(s, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'b' }, data).state.result).toBe('victory');
  });

  it('defeatBoss: other kills do not win', () => {
    let s = makeBattle(['.....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true, ...sure }),
      place('e', 'rogue', 'enemy', 1, 0),
      place('b', 'rogue', 'enemy', 4, 0, { isBoss: true }),
    ], { objective: { type: 'defeatBoss' } });
    s = patchUnit(s, 'e', { hp: 1 });
    expect(applyAction(s, { type: 'attack', unitId: 'p', to: pos(0, 0), targetId: 'e' }, data).state.result).toBe('ongoing');
  });

  it('survive: wins when turn N ends', () => {
    let s = makeBattle(['..........'], [place('p', 'fighter', 'player', 0, 0, { isLord: true }), place('e', 'fighter', 'enemy', 9, 0, { ai: { behavior: 'hold' } })], {
      objective: { type: 'survive', turns: 2 },
    });
    for (let turn = 1; turn <= 2; turn++) {
      expect(s.result).toBe('ongoing');
      s = runAiPhase(applyAction(s, end, data).state, data).state;
    }
    expect(s.result).toBe('victory');
    expect(s.turn).toBe(2);
  });

  it('escape: a lord ending its action on the tile wins, others do not', () => {
    const s = makeBattle(['.....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('q', 'fighter', 'player', 1, 0),
      place('e', 'fighter', 'enemy', 4, 0, { ai: { behavior: 'hold' } }),
    ], { objective: { type: 'escape', tiles: [pos(3, 0)] } });
    expect(applyAction(s, { type: 'wait', unitId: 'q', to: pos(3, 0) }, data).state.result).toBe('ongoing');
    expect(applyAction(s, { type: 'wait', unitId: 'p', to: pos(2, 0) }, data).state.result).toBe('ongoing');
    const blocked = makeBattle(['.....'], [
      place('p', 'fighter', 'player', 1, 0, { isLord: true }),
      place('e', 'fighter', 'enemy', 4, 0, { ai: { behavior: 'hold' } }),
    ], { objective: { type: 'escape', tiles: [pos(3, 0)] } });
    expect(applyAction(blocked, { type: 'wait', unitId: 'p', to: pos(3, 0) }, data).state.result).toBe('victory');
  });

  it('protect: losing the target loses; surviving the turns wins', () => {
    const placements = [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('v', 'healer', 'ally', 5, 0, { ai: { behavior: 'hold' } }),
      place('e', 'fighter', 'enemy', 7, 0, { weaponId: 'sure_axe' }),
    ];
    let s = makeBattle(['.........'], placements, { objective: { type: 'protect', unitId: 'v', turns: 1 } });
    s = patchUnit(s, 'v', { hp: 1 });
    const lost = runAiPhase(applyAction(s, end, data).state, data);
    expect(lost.state.result).toBe('defeat');
    const safe = makeBattle(['.........'], [placements[0]!, placements[1]!, place('e', 'fighter', 'enemy', 8, 0, { ai: { behavior: 'hold' } })], {
      objective: { type: 'protect', unitId: 'v', turns: 1 },
    });
    expect(runAiPhase(applyAction(safe, end, data).state, data).state.result).toBe('victory');
  });

  it('loss: the lord falling loses, and the summary lists the fallen', () => {
    let s = makeBattle(['....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('q', 'fighter', 'player', 3, 0),
      place('e', 'fighter', 'enemy', 2, 0, { weaponId: 'sure_axe' }),
    ]);
    s = patchUnit(s, 'p', { hp: 1 });
    const r = runAiPhase(applyAction(s, end, data).state, data);
    expect(r.state.result).toBe('defeat');
    expect(r.events[r.events.length - 1]).toEqual({ type: 'battleEnded', result: 'defeat', fallenPlayerUnitIds: ['p'] });
    expect(battleSummary(r.state)).toEqual({ result: 'defeat', turns: 1, fallenPlayerUnitIds: ['p'], lostForGood: ['p'], flags: {}, recruited: [] });
    const casual = { ...r.state, options: { ...r.state.options, permadeath: 'casual' as const } };
    expect(battleSummary(casual).lostForGood).toEqual([]);
  });

  it('loss: no player units left', () => {
    let s = makeBattle(['....'], [place('q', 'fighter', 'player', 1, 0), place('e', 'fighter', 'enemy', 2, 0, { weaponId: 'sure_axe' })]);
    s = patchUnit(s, 'q', { hp: 1 });
    expect(runAiPhase(applyAction(s, end, data).state, data).state.result).toBe('defeat');
  });
});

// ---------------------------------------------------------------------------
// Whole battles on the real prologue
// ---------------------------------------------------------------------------

const PLAYER_AI: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };

/** Next action for auto-play: player units charge, then end phase; AI phases use planAiAction. */
function nextAction(s: BattleState, d: GameData): Action | null {
  if (s.result !== 'ongoing') return null;
  if (s.phase !== 'player') return planAiAction(s, d);
  const u = s.units.find((x) => x.alive && x.team === 'player' && !x.acted);
  return u ? planUnitAction(s, u.id, d, PLAYER_AI) : end;
}

function prologue(seed: number, difficulty: 'normal' | 'hard' | 'lunatic' = 'normal', style: 'vanguard' | 'duelist' | 'spiritblade' = 'vanguard') {
  return createBattle(gameData.maps.prologue!, { difficulty, permadeath: 'classic', mc: { name: 'Hero', style } }, seed, gameData);
}

describe('immutability', () => {
  it('never mutates a deep-frozen input state', () => {
    let s = prologue(7, 'lunatic', 'spiritblade');
    let steps = 0;
    for (let a = nextAction(s, gameData); a && steps < 500; a = nextAction(s, gameData), steps++) {
      const frozen = deepFreeze(structuredClone(s));
      const snapshot = JSON.stringify(frozen);
      const r = applyAction(frozen, a, gameData);
      expect(JSON.stringify(frozen)).toBe(snapshot);
      s = r.state;
    }
    expect(s.result).not.toBe('ongoing');
  });

  it('queries work on frozen state', () => {
    const s = deepFreeze(prologue(1));
    expect(() => nextAction(s, gameData)).not.toThrow();
  });
});

describe('serialization', () => {
  it('a JSON round trip after every action plays out identically', () => {
    for (const [seed, diff] of [
      [3, 'normal'],
      [11, 'hard'],
      [5, 'lunatic'],
    ] as const) {
      let direct = prologue(seed, diff, 'duelist');
      let tripped = prologue(seed, diff, 'duelist');
      const evA: BattleEvent[] = [];
      const evB: BattleEvent[] = [];
      for (let i = 0; i < 500; i++) {
        const a = nextAction(direct, gameData);
        const b = nextAction(tripped, gameData);
        expect(b).toEqual(a);
        if (!a || !b) break;
        const ra = applyAction(direct, a, gameData);
        const rb = applyAction(tripped, b, gameData);
        direct = ra.state;
        tripped = JSON.parse(JSON.stringify(rb.state)) as BattleState;
        evA.push(...ra.events);
        evB.push(...rb.events);
      }
      expect(evB).toEqual(evA);
      expect(tripped).toEqual(direct);
      expect(direct.result).not.toBe('ongoing');
    }
  });

  it('state holds only plain JSON values', () => {
    const s = runAiPhase(applyAction(prologue(2), end, gameData).state, gameData).state;
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const check = (v: unknown): void => {
      if (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || typeof v === 'function') throw new Error('not JSON');
      if (v && typeof v === 'object') {
        expect([Object.prototype, Array.prototype]).toContain(Object.getPrototypeOf(v));
        Object.values(v).forEach(check);
      }
    };
    check(s);
  });
});

describe('full battles', () => {
  it('a scripted fixture battle plays to victory with the expected events', () => {
    let s = makeBattle(['.....', '.....'], [
      place('p', 'fighter', 'player', 0, 0, { isLord: true, weaponId: 'sure_axe' }),
      place('e1', 'rogue', 'enemy', 3, 0, { ai: { behavior: 'hold' } }),
      place('e2', 'rogue', 'enemy', 4, 1, { ai: { behavior: 'charge' }, weaponId: 'dagger' }),
    ]);
    s = patchUnit(s, 'p', { stats: { hp: 40, def: 10 }, hp: 40 });
    // Turn 1: hit e1 (10 damage, it survives on 8 and doubles back for 0).
    let r = applyAction(s, { type: 'attack', unitId: 'p', to: pos(2, 0), targetId: 'e1' }, data);
    expect(types(r.events)).toEqual(['unitMoved', 'combatStarted', 'strike', 'strike', 'strike', 'combatEnded', 'xpGained', 'unitActed']);
    s = r.state;
    expect(unit(s, 'e1').hp).toBe(8);
    expect(unit(s, 'p').hp).toBe(40);
    r = applyAction(s, end, data);
    r = runAiPhase(r.state, data);
    s = r.state;
    expect(s).toMatchObject({ turn: 2, phase: 'player', result: 'ongoing' });
    // Then let the charge AI finish the job for the player.
    for (let i = 0; i < 50 && s.result === 'ongoing'; i++) s = applyAction(s, nextAction(s, data)!, data).state;
    expect(s.result).toBe('victory');
    expect(battleSummary(s).fallenPlayerUnitIds).toEqual([]);
  });

  it('the prologue plays to the end on every difficulty and style', () => {
    for (const diff of ['normal', 'hard', 'lunatic'] as const) {
      for (const style of ['vanguard', 'duelist', 'spiritblade'] as const) {
        let s = prologue(42, diff, style);
        const events: BattleEvent[] = [];
        for (let a = nextAction(s, gameData), i = 0; a && i < 1000; a = nextAction(s, gameData), i++) {
          const r = applyAction(s, a, gameData);
          s = r.state;
          events.push(...r.events);
        }
        expect(s.result).not.toBe('ongoing');
        expect(events.filter((e) => e.type === 'battleEnded')).toHaveLength(1);
        expect(events[events.length - 1]!.type).toBe('battleEnded');
      }
    }
  });

  it('normal prologue with seed 42 is a win', () => {
    let s = prologue(42);
    for (let a = nextAction(s, gameData), i = 0; a && i < 1000; a = nextAction(s, gameData), i++) s = applyAction(s, a, gameData).state;
    expect(s.result).toBe('victory');
  });
});

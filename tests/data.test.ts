import { describe, expect, it } from 'vitest';
import { createBattle, validateGameData, type GameData, type UnitPlacement } from '../src/core';
import { gameData } from '../src/data';

const clone = (): GameData => structuredClone(gameData);

describe('game data', () => {
  it('passes validation (all ids, shapes and placements)', () => {
    expect(validateGameData(gameData)).toEqual([]);
  });

  it('has the classes and weapons the first build needs', () => {
    for (const c of ['vanguard', 'duelist', 'spiritblade', 'wanderer', 'soldier', 'ranger', 'adept', 'medic', 'legionary', 'hunter', 'inquisitor', 'archer', 'hunter_captain']) {
      expect(gameData.classes[c], c).toBeDefined();
    }
    for (const w of ['widows_hush_vanguard', 'widows_hush_duelist', 'widows_hush_spiritblade', 'gravemaw', 'thousand_needles', 'mending_rod']) {
      expect(gameData.weapons[w], w).toBeDefined();
    }
    const hush = ['vanguard', 'duelist', 'spiritblade'].map((s) => gameData.weapons[`widows_hush_${s}`]!.school);
    expect(hush).toEqual(['heavy', 'swift', 'arcane']);
  });

  it('every MC style can wield its form of Widow\'s Hush', () => {
    for (const s of ['vanguard', 'duelist', 'spiritblade']) {
      expect(gameData.classes[s]!.weaponKinds).toContain(gameData.weapons[`widows_hush_${s}`]!.kind);
    }
  });

  it('the prologue is a portrait-sized rout map with the MC and the Stranger', () => {
    const m = gameData.maps.prologue!;
    expect(m.width).toBeLessThan(m.height);
    expect(m.objective).toEqual({ type: 'rout' });
    expect(m.placements.some((p) => p.kind === 'mc')).toBe(true);
    const stranger = m.placements.find((p): p is UnitPlacement => p.kind === 'unit' && p.id === 'stranger');
    expect(stranger?.team).toBe('player');
    const enemies = m.placements.filter((p) => p.kind === 'unit' && p.team === 'enemy');
    expect(enemies.length).toBeGreaterThanOrEqual(5);
    expect(enemies.length).toBeLessThanOrEqual(6);
    const s = createBattle(m, { difficulty: 'normal', permadeath: 'casual', mc: { name: 'Hero', style: 'duelist' } }, 1, gameData);
    expect(s.units.find((u) => u.id === 'mc')).toMatchObject({ isLord: true, classId: 'duelist' });
  });

  it('on every map, every tile passable on foot is reachable from the MC slot', () => {
    for (const m of Object.values(gameData.maps)) {
      const passable = (x: number, y: number): boolean => {
        const ch = m.tiles[y]?.[x];
        if (ch === undefined) return false;
        const cost = gameData.terrain[m.legend[ch]!]!.moveCost.foot;
        return cost !== null && cost !== undefined;
      };
      const mc = m.placements.find((p) => p.kind === 'mc')!;
      const seen = new Set<string>([`${mc.pos.x},${mc.pos.y}`]);
      const queue = [mc.pos];
      while (queue.length > 0) {
        const p = queue.shift()!;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const x = p.x + dx;
          const y = p.y + dy;
          if (!passable(x, y) || seen.has(`${x},${y}`)) continue;
          seen.add(`${x},${y}`);
          queue.push({ x, y });
        }
      }
      const cut: string[] = [];
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (passable(x, y) && !seen.has(`${x},${y}`)) cut.push(`${x},${y}`);
      expect(cut, `map ${m.id}`).toEqual([]);
    }
  });

  it('catches broken references', () => {
    const d = clone();
    d.classes.hunter!.startingWeapon = 'nope';
    const m = d.maps.prologue!;
    m.tiles[0] = 'XX' + m.tiles[0]!.slice(2);
    m.legend.F = 'swamp';
    const p = m.placements.find((x): x is UnitPlacement => x.kind === 'unit' && x.id === 'hunter_1')!;
    p.classId = 'ghost';
    const errs = validateGameData(d).join('\n');
    expect(errs).toMatch(/hunter: unknown startingWeapon nope/);
    expect(errs).toMatch(/char 'X' not in legend/);
    expect(errs).toMatch(/unknown terrain swamp/);
    expect(errs).toMatch(/unknown class ghost/);
  });

  it('catches bad placements and objectives', () => {
    const d = clone();
    const m = d.maps.prologue!;
    m.placements.push({ kind: 'unit', id: 'stranger', name: 'x', classId: 'hunter', team: 'enemy', level: 1, pos: { x: 0, y: 3 }, ai: { behavior: 'charge' } });
    m.objective = { type: 'defeatBoss' };
    const errs = validateGameData(d).join('\n');
    expect(errs).toMatch(/duplicate unit id stranger/);
    expect(errs).toMatch(/impassable water/);
    expect(errs).toMatch(/defeatBoss without a boss/);
  });
});

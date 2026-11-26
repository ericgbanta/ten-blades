import { describe, expect, it } from 'vitest';
import { applyAction, type BattleState } from '../src/core';
import {
  NO_SELECTION,
  menuOptions,
  overlayFor,
  previewOf,
  readyUnitIds,
  runCommand,
  tapTile,
  type Selection,
} from '../src/battle/selection';
import { fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();

// p (fighter, mov 4) at 0,0; healer h at 0,2; enemy e at 3,0; far enemy f at 7,3.
function battle(): BattleState {
  return makeBattle(
    ['........', '........', '........', '........'],
    [
      place('p', 'fighter', 'player', 0, 0, { isLord: true }),
      place('h', 'healer', 'player', 0, 2),
      place('e', 'rogue', 'enemy', 3, 0),
      place('f', 'rogue', 'enemy', 7, 3),
    ],
  );
}

describe('tapTile', () => {
  it('selects a ready player unit and inspects anything else', () => {
    const s = battle();
    expect(tapTile(s, NO_SELECTION, pos(0, 0), data)).toEqual({ kind: 'unit', unitId: 'p' });
    expect(tapTile(s, NO_SELECTION, pos(3, 0), data)).toEqual({ kind: 'inspect', unitId: 'e' });
    expect(tapTile(s, NO_SELECTION, pos(5, 1), data)).toEqual(NO_SELECTION);
    const acted = patchUnit(s, 'p', { acted: true });
    expect(tapTile(acted, NO_SELECTION, pos(0, 0), data)).toEqual({ kind: 'inspect', unitId: 'p' });
  });

  it('moves the preview to a reachable tile, its own tile included, and backs out elsewhere', () => {
    const s = battle();
    const sel: Selection = { kind: 'unit', unitId: 'p' };
    expect(tapTile(s, sel, pos(2, 0), data)).toEqual({ kind: 'menu', unitId: 'p', to: pos(2, 0) });
    expect(tapTile(s, sel, pos(0, 0), data)).toEqual({ kind: 'menu', unitId: 'p', to: pos(0, 0) });
    expect(tapTile(s, sel, pos(7, 0), data)).toEqual(NO_SELECTION);
    expect(tapTile(s, sel, pos(0, 2), data)).toEqual({ kind: 'unit', unitId: 'h' });
    expect(tapTile(s, sel, pos(3, 0), data)).toEqual({ kind: 'inspect', unitId: 'e' });
  });

  it('retargets the preview from the menu, or returns to the range view', () => {
    const s = battle();
    const menu: Selection = { kind: 'menu', unitId: 'p', to: pos(2, 0) };
    expect(tapTile(s, menu, pos(1, 1), data)).toEqual({ kind: 'menu', unitId: 'p', to: pos(1, 1) });
    expect(tapTile(s, menu, pos(7, 0), data)).toEqual({ kind: 'unit', unitId: 'p' });
    expect(tapTile(s, menu, pos(0, 2), data)).toEqual({ kind: 'unit', unitId: 'p' });
  });

  it('opens the forecast on a valid target and backs out on anything else', () => {
    const s = battle();
    const target: Selection = { kind: 'target', unitId: 'p', to: pos(2, 0), mode: 'attack' };
    const confirm = tapTile(s, target, pos(3, 0), data);
    expect(confirm).toEqual({ kind: 'confirm', unitId: 'p', to: pos(2, 0), mode: 'attack', targetId: 'e' });
    expect(tapTile(s, target, pos(7, 3), data)).toEqual({ kind: 'menu', unitId: 'p', to: pos(2, 0) });
    expect(tapTile(s, confirm, pos(5, 2), data)).toEqual(target);
  });
});

describe('menuOptions', () => {
  it('offers Attack only with a target in reach, and always Wait and Cancel', () => {
    const s = battle();
    expect(menuOptions(s, { kind: 'menu', unitId: 'p', to: pos(2, 0) }, data)).toEqual(['attack', 'wait', 'cancel']);
    expect(menuOptions(s, { kind: 'menu', unitId: 'p', to: pos(0, 1) }, data)).toEqual(['wait', 'cancel']);
    expect(menuOptions(s, { kind: 'unit', unitId: 'p' }, data)).toEqual([]);
  });

  it('offers Heal next to a wounded friend', () => {
    const s = patchUnit(battle(), 'p', { hp: 5 });
    expect(menuOptions(s, { kind: 'menu', unitId: 'h', to: pos(0, 1) }, data)).toEqual(['heal', 'wait', 'cancel']);
    expect(menuOptions(battle(), { kind: 'menu', unitId: 'h', to: pos(0, 1) }, data)).toEqual(['wait', 'cancel']);
  });
});

describe('runCommand', () => {
  it('walks menu, target and confirm, then commits the attack', () => {
    const s = battle();
    const menu: Selection = { kind: 'menu', unitId: 'p', to: pos(2, 0) };
    const target = runCommand(s, menu, 'attack', data);
    expect(target).toEqual({ selection: { kind: 'target', unitId: 'p', to: pos(2, 0), mode: 'attack' }, action: null });
    expect(runCommand(s, target.selection, 'back', data).selection).toEqual(menu);
    const confirm: Selection = { kind: 'confirm', unitId: 'p', to: pos(2, 0), mode: 'attack', targetId: 'e' };
    expect(runCommand(s, confirm, 'back', data).selection).toEqual(target.selection);
    expect(runCommand(s, confirm, 'confirm', data)).toEqual({
      selection: NO_SELECTION,
      action: { type: 'attack', unitId: 'p', to: pos(2, 0), targetId: 'e' },
    });
  });

  it('commits Wait, cancels back to the range view and ignores options not on offer', () => {
    const s = battle();
    const menu: Selection = { kind: 'menu', unitId: 'p', to: pos(0, 1) };
    expect(runCommand(s, menu, 'wait', data).action).toEqual({ type: 'wait', unitId: 'p', to: pos(0, 1) });
    expect(runCommand(s, menu, 'cancel', data)).toEqual({ selection: { kind: 'unit', unitId: 'p' }, action: null });
    expect(runCommand(s, menu, 'attack', data)).toEqual({ selection: menu, action: null });
  });

  it('drops a stale confirm instead of sending an illegal action', () => {
    const s = patchUnit(battle(), 'p', { acted: true });
    const confirm: Selection = { kind: 'confirm', unitId: 'p', to: pos(2, 0), mode: 'attack', targetId: 'e' };
    expect(runCommand(s, confirm, 'confirm', data)).toEqual({ selection: NO_SELECTION, action: null });
  });
});

describe('overlayFor', () => {
  it('shows move tiles in blue and strike tiles beyond them in red', () => {
    const s = battle();
    const o = overlayFor(s, { kind: 'unit', unitId: 'p' }, data, []);
    expect(o.move).toContainEqual(pos(3, 1));
    expect(o.move).not.toContainEqual(pos(4, 1));
    expect(o.attack).toContainEqual(pos(4, 1));
    expect(o.attack.some((a) => o.move.some((m) => m.x === a.x && m.y === a.y))).toBe(false);
    expect(o.cursor).toEqual(pos(0, 0));
  });

  it('shows an enemy threat and the targets while choosing', () => {
    const s = battle();
    const threat = overlayFor(s, { kind: 'inspect', unitId: 'e' }, data, []);
    expect(threat.move.length).toBeGreaterThan(0);
    expect(threat.attack.length).toBeGreaterThan(0);
    const t = overlayFor(s, { kind: 'target', unitId: 'p', to: pos(2, 0), mode: 'attack' }, data, [pos(1, 1)]);
    expect(t.targets).toEqual([pos(3, 0)]);
    expect(t.danger).toEqual([pos(1, 1)]);
  });
});

describe('helpers', () => {
  it('lists ready units and previews only real moves', () => {
    const s = battle();
    expect(readyUnitIds(s)).toEqual(['p', 'h']);
    const after = applyAction(s, { type: 'wait', unitId: 'p', to: pos(0, 1) }, data).state;
    expect(readyUnitIds(after)).toEqual(['h']);
    expect(previewOf(s, { kind: 'menu', unitId: 'p', to: pos(0, 0) })).toBeNull();
    expect(previewOf(s, { kind: 'menu', unitId: 'p', to: pos(1, 0) })).toEqual({ unitId: 'p', to: pos(1, 0) });
  });
});

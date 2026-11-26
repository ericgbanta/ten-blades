// The battle menu's Items panel (use an item, equip a weapon for free) and the pick between two powers, in the
// pure selection functions and in the controller.

import { describe, expect, it } from 'vitest';
import { forecast, type BattleState } from '../src/core';
import { BattleController } from '../src/battle/controller';
import { itemOptions, menuOptions, powerOptions, runCommand, tapTile, type Selection } from '../src/battle/selection';
import { SETUP, fixtureData, makeBattle, patchUnit, place, pos } from './fixtures';

const data = fixtureData();
const ROW = ['......', '......', '......'];

function battle(): BattleState {
  return patchUnit(makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0, { items: ['sure_axe', 'salve', 'dagger'] }), place('e', 'rogue', 'enemy', 2, 0)], { data }), 'p', {
    hp: 10,
  });
}

const menu: Selection = { kind: 'menu', unitId: 'p', to: pos(1, 0) };

describe('the Items panel', () => {
  it('is offered for a unit with an item or a second weapon, and lists each entry with why it cannot be used', () => {
    const s = battle();
    expect(menuOptions(s, menu, data)).toEqual(['attack', 'items', 'wait', 'cancel']);
    const only = makeBattle(ROW, [place('p', 'fighter', 'player', 0, 0), place('e', 'rogue', 'enemy', 2, 0)], { data });
    expect(menuOptions(only, menu, data)).not.toContain('items');
    const items = runCommand(s, menu, 'items', data).selection;
    expect(items).toEqual({ kind: 'items', unitId: 'p', to: pos(1, 0) });
    expect(itemOptions(s, items, data).map((o) => [o.name, o.kind, o.equipped, o.reason])).toEqual([
      ['axe', 'weapon', true, 'p already holds axe'],
      ['axe', 'weapon', false, null],
      ['Salve', 'item', false, null],
      ['dagger', 'weapon', false, 'p cannot wield dagger'],
    ]);
  });

  it('use is an action from the previewed tile; equip is free and the menu comes back', () => {
    const s = battle();
    const items: Selection = { kind: 'items', unitId: 'p', to: pos(1, 0) };
    expect(runCommand(s, items, 'use:2', data)).toEqual({ selection: { kind: 'none' }, action: { type: 'item', unitId: 'p', to: pos(1, 0), itemIndex: 2 } });
    expect(runCommand(s, items, 'equip:1', data)).toEqual({ selection: menu, action: { type: 'equip', unitId: 'p', itemIndex: 1 } });
    expect(runCommand(s, items, 'equip:3', data).action).toBeNull();
    expect(runCommand(s, items, 'back', data).selection).toEqual(menu);
    expect(tapTile(s, items, pos(4, 2), data)).toEqual(menu);
  });

  it('in the controller, equip applies at once: the menu stays on the tile and the forecast uses the new weapon', async () => {
    const s = battle();
    const checkpoints: BattleState[] = [];
    const c = new BattleController(s, data, { sleep: () => Promise.resolve(), onCheckpoint: (st) => checkpoints.push(st) });
    c.tapTile(pos(0, 0));
    c.tapTile(pos(1, 0));
    c.command('items');
    expect(c.view.items).toHaveLength(4);
    c.command('equip:1');
    expect(c.view.busy).toBe(false);
    expect(c.view.selection).toEqual(menu);
    expect(c.view.state.units[0]!.weaponId).toBe('sure_axe');
    expect(checkpoints.at(-1)!.units[0]!.weaponId).toBe('sure_axe');
    c.command('attack');
    c.tapTile(pos(2, 0));
    expect(c.view.forecast!.attacker.hit).toBe(forecast(c.view.state, 'p', 'e', pos(1, 0), data).attacker.hit);
    expect(c.view.forecast!.attacker.hit).toBe(100);
  });
});

describe('two powers in the menu', () => {
  it('lists both, the second picked with power:<id>, and carries the choice through aiming to the action', () => {
    const s = patchUnit(
      makeBattle(ROW, [place('h', 'fighter', 'player', 0, 0, { weaponId: 'hush' }), place('e', 'rogue', 'enemy', 1, 0)], { data, setup: { ...SETUP, bladeTiers: { hush: 2 } } }),
      'h',
      { resolve: 60 },
    );
    const m: Selection = { kind: 'menu', unitId: 'h', to: pos(0, 0) };
    expect(powerOptions(s, m, data).map((o) => [o.powerId, o.reason])).toEqual([
      ['echo', 'Resolve 60/100'],
      ['silence', null],
    ]);
    expect(runCommand(s, m, 'power', data).selection).toEqual(m);
    const aim = runCommand(s, m, 'power:silence', data).selection;
    expect(aim).toEqual({ kind: 'target', unitId: 'h', to: pos(0, 0), mode: 'power', powerId: 'silence' });
    const confirm = tapTile(s, aim, pos(1, 0), data);
    expect(confirm).toEqual({ kind: 'powerConfirm', unitId: 'h', to: pos(0, 0), aim: { targetId: 'e' }, powerId: 'silence' });
    expect(runCommand(s, confirm, 'confirm', data).action).toEqual({ type: 'power', unitId: 'h', to: pos(0, 0), targetId: 'e', powerId: 'silence' });
  });
});

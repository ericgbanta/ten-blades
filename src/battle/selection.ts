// The player's selection state machine. Pure functions over the battle state:
// they decide what a tap or a menu command means and which action, if any, to
// send to the core. Every rule question goes through the core's queries.

import {
  attackRange,
  attackTargets,
  DIRECTIONS,
  canUsePower,
  lineTiles,
  powerBlock,
  powerDirections,
  powerForecast,
  powerPlan,
  powerTargets,
  powerIds,
  forecast,
  itemDef,
  weaponDef,
  getUnit,
  healRange,
  healTargets,
  moveTiles,
  samePos,
  actionTiles,
  talkTargets,
  unitAt,
  unitThreatTiles,
  validateAction,
  type Action,
  type BattleState,
  type Direction,
  type PowerAim,
  type PowerForecast,
  type Forecast,
  type GameData,
  type Pos,
} from '../core';

export type TargetMode = 'attack' | 'heal' | 'talk' | 'power';

export type Selection =
  /** Nothing selected. */
  | { kind: 'none' }
  /** Looking at a unit that cannot take orders now (enemy, ally, or acted). */
  | { kind: 'inspect'; unitId: string }
  /** A ready player unit, showing where it can move and strike. */
  | { kind: 'unit'; unitId: string }
  /** The unit previews on `to` and the action menu is open. */
  | { kind: 'menu'; unitId: string; to: Pos }
  /** Choosing whom to attack or heal from `to`. With the power mode, `powerId` picks one of two powers. */
  | { kind: 'target'; unitId: string; to: Pos; mode: TargetMode; powerId?: string }
  /** The forecast (or heal preview) for one target, waiting for Confirm. Talk needs no confirm. */
  | { kind: 'confirm'; unitId: string; to: Pos; mode: 'attack' | 'heal'; targetId: string }
  /** The power forecast for an aim (a target or a direction), waiting for Confirm. */
  | { kind: 'powerConfirm'; unitId: string; to: Pos; aim: PowerAim; powerId?: string }
  /** The unit's inventory, from the menu: use an item (on itself, from `to`) or equip a weapon. */
  | { kind: 'items'; unitId: string; to: Pos };

export const NO_SELECTION: Selection = { kind: 'none' };

export type MenuOption = 'attack' | 'power' | 'heal' | 'talk' | 'items' | 'wait' | 'cancel';

/**
 * Menu options, Confirm and Back, a direction for a line power, `power:<id>` for one of two powers, and in the
 * inventory `use:<index>` (an item, using the unit's action) or `equip:<index>` (free).
 */
export type Command = MenuOption | 'confirm' | 'back' | Direction | `power:${string}` | `use:${number}` | `equip:${number}`;

/** A Power option of the action menu: shown for bearers, disabled with a reason when it cannot fire here. */
export interface PowerOption {
  powerId: string;
  name: string;
  resolve: number;
  cost: number;
  /** Why it cannot fire from the previewed tile, or null when it can. */
  reason: string | null;
}

/** One inventory entry in the battle's Items panel: what it is and whether it can be used or equipped here. */
export interface ItemOption {
  index: number;
  id: string;
  name: string;
  kind: 'weapon' | 'item';
  equipped: boolean;
  /** For an item: why it cannot be used now, or null. For a weapon: why it cannot be equipped, or null. */
  reason: string | null;
}

export interface Transition {
  selection: Selection;
  /** The action to apply, when the command commits one. */
  action: Action | null;
}

/** What a tap does: the next selection, and an action when the tap commits one (talking to a target). */
export interface TapResult {
  selection: Selection;
  action: Action | null;
}

/** True if the unit takes orders right now. */
function isReady(state: BattleState, unitId: string): boolean {
  const u = getUnit(state, unitId);
  return state.result === 'ongoing' && state.phase === 'player' && u.team === 'player' && u.alive && !u.acted;
}

/** Player units that can still act this phase. */
export function readyUnitIds(state: BattleState): string[] {
  return state.units.filter((u) => isReady(state, u.id)).map((u) => u.id);
}

function selectUnitAt(state: BattleState, pos: Pos): Selection {
  const u = unitAt(state, pos);
  if (!u) return NO_SELECTION;
  return isReady(state, u.id) ? { kind: 'unit', unitId: u.id } : { kind: 'inspect', unitId: u.id };
}

function canStopOn(state: BattleState, unitId: string, pos: Pos, data: GameData): boolean {
  return moveTiles(state, unitId, data).some((p) => samePos(p, pos));
}

function targetsFor(state: BattleState, unitId: string, to: Pos, mode: TargetMode, data: GameData, powerId?: string): string[] {
  if (mode === 'talk') return talkTargets(state, unitId, to, data);
  if (mode === 'power') return powerTargets(state, unitId, to, data, powerId);
  return mode === 'attack' ? attackTargets(state, unitId, to, data) : healTargets(state, unitId, to, data);
}

/**
 * What a tap on a map tile does, including the one tap that commits an action: choosing whom to talk to
 * (talk has no forecast to confirm).
 */
export function tapTileAction(state: BattleState, sel: Selection, pos: Pos, data: GameData): TapResult {
  if (sel.kind === 'target' && sel.mode === 'talk') {
    const t = unitAt(state, pos);
    if (t && talkTargets(state, sel.unitId, sel.to, data).includes(t.id)) {
      return commit(state, { type: 'talk', unitId: sel.unitId, to: sel.to, targetId: t.id }, data);
    }
    return { selection: { kind: 'menu', unitId: sel.unitId, to: sel.to }, action: null };
  }
  return { selection: tapTile(state, sel, pos, data), action: null };
}

/** What a tap on a map tile does. */
export function tapTile(state: BattleState, sel: Selection, pos: Pos, data: GameData): Selection {
  switch (sel.kind) {
    case 'none':
    case 'inspect':
      return selectUnitAt(state, pos);
    case 'unit': {
      const other = unitAt(state, pos);
      if (other && other.id !== sel.unitId) return selectUnitAt(state, pos);
      if (canStopOn(state, sel.unitId, pos, data)) return { kind: 'menu', unitId: sel.unitId, to: pos };
      return NO_SELECTION;
    }
    case 'menu': {
      // Another tile the unit can reach moves the preview there; anything else backs out.
      const other = unitAt(state, pos);
      const free = !other || other.id === sel.unitId;
      if (free && canStopOn(state, sel.unitId, pos, data)) return { kind: 'menu', unitId: sel.unitId, to: pos };
      return { kind: 'unit', unitId: sel.unitId };
    }
    case 'items':
      return { kind: 'menu', unitId: sel.unitId, to: sel.to };
    case 'powerConfirm':
      return tapPower(state, sel, pos, data) ?? { kind: 'target', unitId: sel.unitId, to: sel.to, mode: 'power', ...pid(sel.powerId) };
    case 'target':
    case 'confirm': {
      if (sel.kind === 'target' && sel.mode === 'power') return tapPower(state, sel, pos, data) ?? { kind: 'menu', unitId: sel.unitId, to: sel.to };
      const t = unitAt(state, pos);
      if (sel.mode !== 'talk' && sel.mode !== 'power' && t && targetsFor(state, sel.unitId, sel.to, sel.mode, data).includes(t.id)) {
        return { kind: 'confirm', unitId: sel.unitId, to: sel.to, mode: sel.mode, targetId: t.id };
      }
      return sel.kind === 'confirm'
        ? { kind: 'target', unitId: sel.unitId, to: sel.to, mode: sel.mode }
        : { kind: 'menu', unitId: sel.unitId, to: sel.to };
    }
  }
}

/**
 * A tap while aiming a power: a target picks it; for a line power, a tile on a valid direction's line picks that
 * direction. Null when the tap aims at nothing.
 */
/** `{ powerId }` when one is given, else nothing (the blade's first power). */
function pid(powerId: string | undefined): { powerId?: string } {
  return powerId === undefined ? {} : { powerId };
}

function tapPower(state: BattleState, sel: { unitId: string; to: Pos; powerId?: string }, pos: Pos, data: GameData): Selection | null {
  const plan = powerPlan(state, sel.unitId, data, sel.powerId);
  if (!plan) return null;
  const extra = pid(sel.powerId);
  if (plan.aim === 'unit') {
    const t = unitAt(state, pos);
    if (t && powerTargets(state, sel.unitId, sel.to, data, sel.powerId).includes(t.id)) return { kind: 'powerConfirm', unitId: sel.unitId, to: sel.to, aim: { targetId: t.id }, ...extra };
    return null;
  }
  const len = plan.effect.type === 'scatter' ? plan.effect.length : 0;
  for (const dir of powerDirections(state, sel.unitId, sel.to, data, sel.powerId)) {
    if (lineTiles(state, sel.to, dir, len).some((p) => samePos(p, pos))) return { kind: 'powerConfirm', unitId: sel.unitId, to: sel.to, aim: { dir }, ...extra };
  }
  return null;
}

/** One Power option of the open menu. */
function optionFor(state: BattleState, sel: { unitId: string; to: Pos }, powerId: string, data: GameData): PowerOption | null {
  const plan = powerPlan(state, sel.unitId, data, powerId);
  if (!plan) return null;
  const u = getUnit(state, sel.unitId);
  let reason = powerBlock(state, sel.unitId, data, powerId);
  if (reason !== null && reason.startsWith('Resolve')) reason = `Resolve ${u.resolve}/${plan.cost}`;
  else if (reason === null && !canUsePower(state, sel.unitId, sel.to, data, powerId)) reason = 'No target in reach';
  return { powerId, name: plan.name, resolve: u.resolve, cost: plan.cost, reason };
}

/** Every Power option for the open menu (two for an Awakened blade), or none when the unit has no power. */
export function powerOptions(state: BattleState, sel: Selection, data: GameData): PowerOption[] {
  if (sel.kind !== 'menu') return [];
  return powerIds(state, sel.unitId, data)
    .map((id) => optionFor(state, sel, id, data))
    .filter((o): o is PowerOption => o !== null);
}

/** The first Power option for the open menu, or null when the unit has no power (not a bearer, or not built yet). */
export function powerOption(state: BattleState, sel: Selection, data: GameData): PowerOption | null {
  return powerOptions(state, sel, data)[0] ?? null;
}

/** The Items panel's entries: every inventory entry, with why it cannot be used or equipped right now. */
export function itemOptions(state: BattleState, sel: Selection, data: GameData): ItemOption[] {
  if (sel.kind !== 'items') return [];
  const u = getUnit(state, sel.unitId);
  return u.inventory.map((id, index) => {
    const w = weaponDef(id, data);
    if (w) {
      const reason = validateAction(state, { type: 'equip', unitId: u.id, itemIndex: index }, data);
      return { index, id, name: w.name, kind: 'weapon', equipped: u.weaponId === id, reason };
    }
    const reason = validateAction(state, { type: 'item', unitId: u.id, to: sel.to, itemIndex: index }, data);
    return { index, id, name: itemDef(id, data)?.name ?? id, kind: 'item', equipped: false, reason };
  });
}

/** True when the Items panel has something to offer: an item, or a second weapon. */
function hasItems(state: BattleState, unitId: string, data: GameData): boolean {
  const inv = getUnit(state, unitId).inventory;
  return inv.some((id) => itemDef(id, data) !== null) || inv.filter((id) => weaponDef(id, data) !== null).length > 1;
}

/** Options for the action menu, in display order. Empty unless the menu is open. Power is listed for every
 * bearer (see powerOptions for whether each can fire); Items when the unit carries an item or a second weapon. */
export function menuOptions(state: BattleState, sel: Selection, data: GameData): MenuOption[] {
  if (sel.kind !== 'menu') return [];
  const out: MenuOption[] = [];
  if (attackTargets(state, sel.unitId, sel.to, data).length > 0) out.push('attack');
  if (powerPlan(state, sel.unitId, data)) out.push('power');
  if (healTargets(state, sel.unitId, sel.to, data).length > 0) out.push('heal');
  if (talkTargets(state, sel.unitId, sel.to, data).length > 0) out.push('talk');
  if (hasItems(state, sel.unitId, data)) out.push('items');
  out.push('wait', 'cancel');
  return out;
}

function commit(state: BattleState, action: Action, data: GameData): Transition {
  // The menu only offers legal moves, so this guards against a stale selection.
  if (validateAction(state, action, data) !== null) return { selection: NO_SELECTION, action: null };
  return { selection: NO_SELECTION, action };
}

/** What a menu or panel button does. Commands that do not apply leave the selection alone. */
export function runCommand(state: BattleState, sel: Selection, cmd: Command, data: GameData): Transition {
  const stay: Transition = { selection: sel, action: null };
  if (sel.kind === 'menu' && cmd.startsWith('power:')) {
    // One of the bearer's powers by id; the first one is the plain Power command.
    const id = cmd.slice('power:'.length);
    const options = powerOptions(state, sel, data);
    const o = options.find((x) => x.powerId === id);
    if (!o || o.reason !== null) return stay;
    const extra = options[0]?.powerId === id ? {} : { powerId: id };
    return { selection: { kind: 'target', unitId: sel.unitId, to: sel.to, mode: 'power', ...extra }, action: null };
  }
  if (sel.kind === 'items') {
    if (cmd === 'back') return { selection: { kind: 'menu', unitId: sel.unitId, to: sel.to }, action: null };
    const m = /^(use|equip):(\d+)$/.exec(cmd);
    if (!m) return stay;
    const itemIndex = Number(m[2]);
    if (m[1] === 'use') return commit(state, { type: 'item', unitId: sel.unitId, to: sel.to, itemIndex }, data);
    // Equip is free: the menu stays open on the same tile.
    const action = { type: 'equip' as const, unitId: sel.unitId, itemIndex };
    if (validateAction(state, action, data) !== null) return stay;
    return { selection: { kind: 'menu', unitId: sel.unitId, to: sel.to }, action };
  }
  if (sel.kind === 'menu') {
    if (!menuOptions(state, sel, data).includes(cmd as MenuOption)) return stay;
    if (cmd === 'power' && powerOption(state, sel, data)?.reason !== null) return stay;
    switch (cmd) {
      case 'items':
        return { selection: { kind: 'items', unitId: sel.unitId, to: sel.to }, action: null };
      case 'power':
      case 'attack':
      case 'heal':
      case 'talk':
        return { selection: { kind: 'target', unitId: sel.unitId, to: sel.to, mode: cmd }, action: null };
      case 'wait':
        return commit(state, { type: 'wait', unitId: sel.unitId, to: sel.to }, data);
      default:
        return { selection: { kind: 'unit', unitId: sel.unitId }, action: null };
    }
  }
  if (sel.kind === 'target' && cmd === 'back') {
    return { selection: { kind: 'menu', unitId: sel.unitId, to: sel.to }, action: null };
  }
  if (sel.kind === 'target' && sel.mode === 'power' && (DIRECTIONS as readonly string[]).includes(cmd)) {
    const dir = cmd as Direction;
    if (!powerDirections(state, sel.unitId, sel.to, data, sel.powerId).includes(dir)) return stay;
    return { selection: { kind: 'powerConfirm', unitId: sel.unitId, to: sel.to, aim: { dir }, ...pid(sel.powerId) }, action: null };
  }
  if (sel.kind === 'powerConfirm') {
    if (cmd === 'back') return { selection: { kind: 'target', unitId: sel.unitId, to: sel.to, mode: 'power', ...pid(sel.powerId) }, action: null };
    if (cmd === 'confirm') return commit(state, { type: 'power', unitId: sel.unitId, to: sel.to, ...sel.aim, ...pid(sel.powerId) }, data);
  }
  if (sel.kind === 'confirm') {
    if (cmd === 'back') return { selection: { kind: 'target', unitId: sel.unitId, to: sel.to, mode: sel.mode }, action: null };
    if (cmd === 'confirm') {
      return commit(state, { type: sel.mode, unitId: sel.unitId, to: sel.to, targetId: sel.targetId }, data);
    }
  }
  return stay;
}

/** Tiles to highlight on the map. */
export interface Overlay {
  /** Blue: where the selected unit (or inspected enemy) can move. */
  move: Pos[];
  /** Red: what it could strike after moving, beyond its move tiles. */
  attack: Pos[];
  /** Green: where a staff user could heal, beyond its move tiles. */
  heal: Pos[];
  /** Units that can be targeted right now. */
  targets: Pos[];
  /** All-enemy danger zone, when toggled on. */
  danger: Pos[];
  /** The tile of the selected unit or its preview. */
  cursor: Pos | null;
}

function without(tiles: Pos[], remove: Pos[]): Pos[] {
  return tiles.filter((t) => !remove.some((r) => samePos(r, t)));
}

/** Highlights for a selection. `danger` is filled in by the caller when the toggle is on. */
export function overlayFor(state: BattleState, sel: Selection, data: GameData, danger: Pos[]): Overlay {
  const empty: Overlay = { move: [], attack: [], heal: [], targets: [], danger, cursor: null };
  switch (sel.kind) {
    case 'none':
      return empty;
    case 'inspect': {
      const u = getUnit(state, sel.unitId);
      if (u.team === 'player' || !u.alive) return { ...empty, cursor: u.pos };
      const move = actionTiles(state, u.id, data);
      return { ...empty, move, attack: without(unitThreatTiles(state, u.id, data), move), cursor: u.pos };
    }
    case 'unit': {
      const move = moveTiles(state, sel.unitId, data);
      return {
        ...empty,
        move,
        attack: without(attackRange(state, sel.unitId, data), move),
        heal: without(healRange(state, sel.unitId, data), move),
        cursor: getUnit(state, sel.unitId).pos,
      };
    }
    case 'menu':
    case 'items':
      return { ...empty, cursor: sel.to };
    case 'target':
    case 'confirm': {
      if (sel.kind === 'target' && sel.mode === 'power') return { ...empty, ...powerAimOverlay(state, sel.unitId, sel.to, data, sel.powerId), cursor: sel.to };
      const targets = targetsFor(state, sel.unitId, sel.to, sel.mode, data).map((id) => getUnit(state, id).pos);
      return { ...empty, targets, cursor: sel.to };
    }
    case 'powerConfirm': {
      const fc = powerForecast(state, sel.unitId, sel.to, sel.aim, data, sel.powerId);
      const struck = fc.targets.map((t) => getUnit(state, t.unitId).pos);
      return { ...empty, attack: 'dir' in sel.aim ? without(fc.tiles, struck) : [], targets: struck, cursor: sel.to };
    }
  }
}

/** While aiming a power: its targets pulse; a line power also shows every valid line in red. */
function powerAimOverlay(state: BattleState, unitId: string, to: Pos, data: GameData, powerId?: string): Pick<Overlay, 'attack' | 'targets'> {
  const plan = powerPlan(state, unitId, data, powerId);
  if (!plan || plan.aim === 'unit') return { attack: [], targets: powerTargets(state, unitId, to, data, powerId).map((id) => getUnit(state, id).pos) };
  const len = plan.effect.type === 'scatter' ? plan.effect.length : 0;
  const tiles = powerDirections(state, unitId, to, data, powerId).flatMap((d) => lineTiles(state, to, d, len));
  const targets = tiles.filter((p) => {
    const u = unitAt(state, p);
    return u !== null && u.team !== getUnit(state, unitId).team && u.team === 'enemy';
  });
  return { attack: without(tiles, targets), targets };
}

/** The previewed move (unit and tile), if the unit stands somewhere new. */
export function previewOf(state: BattleState, sel: Selection): { unitId: string; to: Pos } | null {
  if (sel.kind !== 'menu' && sel.kind !== 'target' && sel.kind !== 'confirm' && sel.kind !== 'powerConfirm' && sel.kind !== 'items') return null;
  return samePos(getUnit(state, sel.unitId).pos, sel.to) ? null : { unitId: sel.unitId, to: sel.to };
}

/** The power forecast for a power confirm, or null. */
export function powerForecastFor(state: BattleState, sel: Selection, data: GameData): PowerForecast | null {
  if (sel.kind !== 'powerConfirm') return null;
  return powerForecast(state, sel.unitId, sel.to, sel.aim, data, sel.powerId);
}

/** The forecast for an attack confirm, or null. */
export function forecastFor(state: BattleState, sel: Selection, data: GameData): Forecast | null {
  if (sel.kind !== 'confirm' || sel.mode !== 'attack') return null;
  return forecast(state, sel.unitId, sel.targetId, sel.to, data);
}

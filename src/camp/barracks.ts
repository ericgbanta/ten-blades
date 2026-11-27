// The barracks: gear between a unit and the convoy, equipping, the roster order, and who deploys on the next map
// (the deploy rule, the bench, wounded bearers). Every change returns a new campaign or a reason. Pure.

import { classCanWield, isBound, itemDef, weaponDef, type GameData, type MapData, type PartyUnit } from '../core';
import type { CampaignSave, Result } from '../save/format';
import { actOf, chapterById, no, okv, type CampCtx } from './ctx';
import type { DeployRule, ScalingDef } from './types';

/** A party unit by id, or null. */
export function partyUnit(c: CampaignSave, unitId: string): PartyUnit | null {
  return c.party.find((u) => u.id === unitId) ?? null;
}

function withUnit(c: CampaignSave, unit: PartyUnit): CampaignSave {
  return { ...c, party: c.party.map((u) => (u.id === unit.id ? unit : u)) };
}

/** Display name of an inventory entry. */
export function entryName(id: string, data: GameData): string {
  return weaponDef(id, data)?.name ?? itemDef(id, data)?.name ?? id;
}

/** True when the unit's class can equip the weapon. Items are never equipped. */
export function canWield(unit: Pick<PartyUnit, 'classId'>, id: string, data: GameData): boolean {
  const w = weaponDef(id, data);
  return !!w && classCanWield(data.classes[unit.classId], w);
}

/** The first weapon in an inventory the unit can wield, or null. */
function firstWieldable(unit: PartyUnit, inventory: readonly string[], data: GameData): string | null {
  return inventory.find((id) => canWield(unit, id, data)) ?? null;
}

/** Equip the inventory entry at `index`. */
export function equip(c: CampaignSave, unitId: string, index: number, ctx: CampCtx): Result<CampaignSave> {
  const u = partyUnit(c, unitId);
  if (!u) return no(`No unit ${unitId}`);
  const id = u.inventory[index];
  if (id === undefined) return no('Nothing in that slot');
  if (!weaponDef(id, ctx.data)) return no(`${entryName(id, ctx.data)} is not a weapon`);
  if (!canWield(u, id, ctx.data)) return no(`${u.name} cannot wield ${entryName(id, ctx.data)}`);
  return okv(withUnit(c, { ...u, weaponId: id }));
}

/**
 * Put the entry at `index` in the convoy. A blade stays with its bearer. Giving up the equipped weapon equips the
 * next one the unit can wield, if any.
 */
export function toConvoy(c: CampaignSave, unitId: string, index: number, ctx: CampCtx): Result<CampaignSave> {
  const u = partyUnit(c, unitId);
  if (!u) return no(`No unit ${unitId}`);
  const id = u.inventory[index];
  if (id === undefined) return no('Nothing in that slot');
  if (isBound(id, ctx.data)) return no(`${entryName(id, ctx.data)} will not leave ${u.name}`);
  if (c.convoy.length >= ctx.camp.economy.convoyMax) return no('The convoy is full');
  const inventory = u.inventory.filter((_, i) => i !== index);
  const weaponId = u.weaponId === id && !inventory.includes(id) ? firstWieldable(u, inventory, ctx.data) : u.weaponId;
  return okv({ ...withUnit(c, { ...u, inventory, weaponId }), convoy: [...c.convoy, id] });
}

/** Take the convoy's entry at `convoyIndex` into the unit's inventory. An unarmed unit equips a weapon it can wield. */
export function fromConvoy(c: CampaignSave, convoyIndex: number, unitId: string, ctx: CampCtx): Result<CampaignSave> {
  const u = partyUnit(c, unitId);
  if (!u) return no(`No unit ${unitId}`);
  const id = c.convoy[convoyIndex];
  if (id === undefined) return no('Nothing there in the convoy');
  if (u.inventory.length >= ctx.data.balance.inventory.slots) return no(`${u.name} has no free slot`);
  const inventory = [...u.inventory, id];
  const weaponId = u.weaponId ?? (canWield(u, id, ctx.data) ? id : null);
  return okv({ ...withUnit(c, { ...u, inventory, weaponId }), convoy: c.convoy.filter((_, i) => i !== convoyIndex) });
}

/** Move a unit `delta` places in the roster (the order units take the map's party slots in). */
export function reorder(c: CampaignSave, unitId: string, delta: number): Result<CampaignSave> {
  const i = c.party.findIndex((u) => u.id === unitId);
  if (i < 0) return no(`No unit ${unitId}`);
  const j = Math.max(0, Math.min(c.party.length - 1, i + delta));
  if (j === i) return okv(c);
  const party = [...c.party];
  const [u] = party.splice(i, 1);
  party.splice(j, 0, u!);
  return okv({ ...c, party });
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Why a unit is or is not going: deploys, benched by choice, wounded this act, or no room left. */
export type DeployStatus = 'deploy' | 'benched' | 'wounded' | 'full';

export interface DeployInfo {
  mapId: string;
  /** Most units, the main character included. */
  max: number;
  /** Unit ids that must go (the main character always does). */
  required: string[];
  /** Every party unit in roster order with its status. */
  units: { unit: PartyUnit; status: DeployStatus }[];
  /** The units that go, in the order they take the map's slots (the main character first). */
  deployed: PartyUnit[];
  /** Enemy levels added on this map (a skirmish's scaling), 0 for a story map. */
  enemyLevelShift: number;
}

/** True when the unit is wounded and sits out the act in progress. */
export function isWounded(c: CampaignSave, unitId: string, ctx: Pick<CampCtx, 'chapters'>): boolean {
  const act = c.wounded[unitId];
  return act !== undefined && act === actOf(c, ctx.chapters);
}

/** Party slots plus the main character's slot on a map. */
export function slotsOn(map: MapData): number {
  return map.placements.filter((p) => p.kind === 'party' || p.kind === 'mc').length;
}

/** The map and rule for the next battle: a skirmish's, or the current chapter's. Null when there is no map. */
export function battleTarget(c: CampaignSave, ctx: CampCtx, skirmishId: string | null): { mapId: string; rule: DeployRule; scaling: ScalingDef | null } | null {
  if (skirmishId !== null) {
    const sk = ctx.camp.skirmishes[skirmishId];
    if (!sk || !ctx.data.maps[sk.mapId]) return null;
    return { mapId: sk.mapId, rule: sk.deploy ?? {}, scaling: sk.scaling };
  }
  const ch = chapterById(ctx.chapters, c.progress.current);
  if (!ch?.mapId || !ctx.data.maps[ch.mapId]) return null;
  return { mapId: ch.mapId, rule: ch.deploy ?? {}, scaling: null };
}

/** How far a skirmish's enemies move: the deployed party's average level, plus the offset, clamped, minus the base. */
export function scalingShift(deployed: readonly PartyUnit[], s: ScalingDef): number {
  if (deployed.length === 0) return 0;
  const avg = Math.round(deployed.reduce((n, u) => n + u.level, 0) / deployed.length);
  return Math.max(s.min, Math.min(s.max, avg + s.offset)) - s.baseLevel;
}

/**
 * Who deploys on the next map. The main character always goes, then required units, then the rest in roster
 * order until the map is full; benched and wounded units stay in camp. Null when there is no map to play.
 */
export function deployInfo(c: CampaignSave, ctx: CampCtx, skirmishId: string | null): DeployInfo | null {
  const target = battleTarget(c, ctx, skirmishId);
  if (!target) return null;
  const map = ctx.data.maps[target.mapId]!;
  const max = Math.max(1, Math.min(target.rule.max ?? slotsOn(map), slotsOn(map)));
  const lord = c.party.find((u) => u.isLord);
  const required = [...new Set([...(lord ? [lord.id] : []), ...(target.rule.required ?? [])])].filter((id) => partyUnit(c, id));
  const status = new Map<string, DeployStatus>();
  let room = max;
  const take = (u: PartyUnit) => {
    if (status.has(u.id)) return;
    if (isWounded(c, u.id, ctx) && !u.isLord) status.set(u.id, 'wounded');
    else if (room <= 0) status.set(u.id, 'full');
    else {
      status.set(u.id, 'deploy');
      room--;
    }
  };
  for (const id of required) take(partyUnit(c, id)!);
  for (const u of c.party) {
    if (status.has(u.id)) continue;
    if (c.benched.includes(u.id)) status.set(u.id, isWounded(c, u.id, ctx) ? 'wounded' : 'benched');
    else take(u);
  }
  const units = c.party.map((u) => ({ unit: u, status: status.get(u.id) ?? 'benched' }));
  // The lord fills the main character's slot wherever it stands in the roster; the others go in roster order.
  const deployed = [...(lord && status.get(lord.id) === 'deploy' ? [lord] : []), ...c.party.filter((u) => !u.isLord && status.get(u.id) === 'deploy')];
  const enemyLevelShift = target.scaling ? scalingShift(deployed, target.scaling) : 0;
  return { mapId: target.mapId, max, required, units, deployed, enemyLevelShift };
}

/** Bench a unit or bring it back. The main character and required units cannot be benched. */
export function setBenched(c: CampaignSave, unitId: string, benched: boolean, ctx: CampCtx, skirmishId: string | null): Result<CampaignSave> {
  const u = partyUnit(c, unitId);
  if (!u) return no(`No unit ${unitId}`);
  const info = deployInfo(c, ctx, skirmishId);
  if (benched && (u.isLord || info?.required.includes(unitId))) return no(`${u.name} must deploy`);
  const list = c.benched.filter((id) => id !== unitId);
  return okv({ ...c, benched: benched ? [...list, unitId] : list });
}

/**
 * Send `inId` (benched or with no room) in place of `outId` (deploying): the two swap places in the roster and
 * `outId` stays in camp, so `inId` takes exactly the slot `outId` had.
 */
export function swapDeploy(c: CampaignSave, inId: string, outId: string, ctx: CampCtx, skirmishId: string | null): Result<CampaignSave> {
  const info = deployInfo(c, ctx, skirmishId);
  if (!info) return no('There is no battle to deploy for');
  const a = info.units.find((e) => e.unit.id === inId);
  const b = info.units.find((e) => e.unit.id === outId);
  if (!a || !b) return no('No such unit');
  if (a.status === 'wounded') return no(`${a.unit.name} is wounded`);
  if (a.status === 'deploy') return no(`${a.unit.name} already deploys`);
  if (b.status !== 'deploy') return no(`${b.unit.name} is not deploying`);
  if (b.unit.isLord || info.required.includes(outId)) return no(`${b.unit.name} must deploy`);
  const party = [...c.party];
  const i = party.findIndex((u) => u.id === inId);
  const j = party.findIndex((u) => u.id === outId);
  // Only the order of non-lord units decides who fills a slot; the lord's place does not matter.
  if (i > j) [party[i], party[j]] = [party[j]!, party[i]!];
  return okv({ ...c, party, benched: [...c.benched.filter((id) => id !== inId && id !== outId), outId] });
}

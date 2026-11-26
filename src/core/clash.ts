// One fight between two units, shared by the attack action and the powers that fight (Devour, Echo's fallback):
// roll the forecast out, apply HP, falls, Resolve, Devour's kill bonus and XP. Works on the caller's own copy.

import { resolveCombat, rollHit, type StrikeResult } from './combat';
import { combatXp, grantXp } from './leveling';
import { addDevourStack, bearerPower, gainFromStrikes } from './resolve';
import type { BattleEvent, BattleState, Forecast, GameData, Unit } from './types';

export function activateHold(u: Unit): void {
  if (u.ai && u.ai.behavior === 'hold') u.ai.active = true;
}

export interface ClashOptions {
  /** The unit firing a power through this fight: it gains no Resolve from it. */
  casterId: string | null;
  /** True when the fight is Devour: a kill by the caster always adds a stack. */
  devour: boolean;
  /** Echo's fallback: after the exchange, the attacker's strike repeats once at this percent of its damage. */
  echoPercent: number | null;
}

export const PLAIN_CLASH: ClashOptions = { casterId: null, devour: false, echoPercent: null };

export interface ClashResult {
  strikes: StrikeResult[];
  defeatedId: string | null;
}

/** A unit fell: mark it and emit the event. */
export function defeat(dead: Unit, byId: string | null, events: BattleEvent[]): void {
  dead.alive = false;
  dead.acted = true;
  events.push({ type: 'unitDefeated', unitId: dead.id, byId });
}

/** A kill by `killer`: Devour's stack when its blade is Gravemaw (the passive) or the kill came from Devour. */
export function onKill(killer: Unit, viaDevour: boolean, data: GameData, events: BattleEvent[]): void {
  if (viaDevour || bearerPower(killer, data)?.effect.type === 'devour') addDevourStack(killer, data, events);
}

/** Fight `d` with `a` using the forecast `fc` (from a's current tile). */
export function clash(s: BattleState, a: Unit, d: Unit, fc: Forecast, data: GameData, events: BattleEvent[], opts: ClashOptions = PLAIN_CLASH): ClashResult {
  events.push({ type: 'combatStarted', attackerId: a.id, defenderId: d.id, forecast: fc });
  const r = resolveCombat(fc, s.rng, data.balance);
  s.rng = r.rng;
  const strikes: StrikeResult[] = [...r.strikes];
  let defeatedId = r.defeatedId;
  for (const st of r.strikes) events.push({ type: 'strike', ...st });
  a.hp = r.attackerHp;
  d.hp = r.defenderHp;
  if (opts.echoPercent !== null && defeatedId === null) {
    // Echo's fallback: the bearer's strike rings once more, weaker, and cannot be answered.
    const [hit, rng] = rollHit(s.rng, fc.attacker.hit, data.balance);
    s.rng = rng;
    const damage = hit ? Math.min(d.hp, Math.floor((fc.attacker.damage * opts.echoPercent) / 100)) : 0;
    d.hp -= damage;
    const st: StrikeResult = { attackerId: a.id, defenderId: d.id, hit, crit: false, damage, hpAfter: d.hp };
    strikes.push(st);
    events.push({ type: 'strike', ...st, echo: true });
    if (d.hp <= 0) defeatedId = d.id;
  }
  activateHold(a);
  activateHold(d);
  events.push({ type: 'combatEnded', attackerId: a.id, defenderId: d.id });
  let killer: Unit | null = null;
  if (defeatedId !== null) {
    const dead = defeatedId === a.id ? a : d;
    killer = dead === a ? d : a;
    defeat(dead, killer.id, events);
  }
  gainFromStrikes(s.units, strikes, killer ? [killer.id] : [], opts.casterId, data, events);
  if (killer) onKill(killer, opts.devour && killer.id === opts.casterId, data, events);
  for (const [u, foe] of [
    [a, d],
    [d, a],
  ] as const) {
    if (u.team !== 'player' || !u.alive) continue;
    const dealt = strikes.some((st) => st.attackerId === u.id && st.damage > 0);
    const amount = combatXp(u.level, foe.level, dealt, !foe.alive, foe.isBoss, data.balance);
    s.rng = grantXp(u, amount, s.rng, data, events);
  }
  return { strikes, defeatedId };
}

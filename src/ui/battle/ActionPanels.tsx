// The action menu, the combat forecast and the heal preview.

import { Fragment } from 'preact';
import { itemDef, weaponDef, type BattleState, type CombatSide, type Direction, type Forecast, type GameData, type PowerForecast, type TriangleEdge, type Unit } from '../../core';
import type { McLook } from '../../art/mc/look';
import type { Command, ItemOption, MenuOption, PowerOption, TargetMode } from '../../battle/selection';
import { Icon, Medallion, schoolIcon, weaponIcon, type IconName } from '../kit';
import { HpBar, ResolveGauge } from './UnitCard';
import { SCHOOL_LABEL, triangleMark } from './text';

const OPTION_LABEL: Record<MenuOption, string> = {
  attack: 'Attack',
  power: 'Power',
  heal: 'Heal',
  talk: 'Talk',
  items: 'Items',
  wait: 'Wait',
  cancel: 'Cancel',
};

type Run = (cmd: Command) => void;

function optionIcon(o: MenuOption, unit: Unit, data: GameData): IconName | null {
  const w = unit.weaponId ? (weaponDef(unit.weaponId, data) ?? undefined) : undefined;
  if (o === 'attack') return w ? weaponIcon(w) : 'sabre';
  if (o === 'heal') return 'staff';
  return null;
}

function PowerButton({ power, run, first }: { power: PowerOption; run: Run; first: boolean }) {
  const ready = power.reason === null;
  return (
    <button
      type="button"
      class={`btn power-btn${ready ? ' primary' : ''}`}
      disabled={!ready}
      aria-label={ready ? `Power: ${power.name}` : `Power: ${power.name}, not ready. ${power.reason}`}
      onClick={() => run(first ? 'power' : `power:${power.powerId}`)}
    >
      <Icon name="tenblade" size={20} />
      <span class="power-btn-text">
        <span>{power.name}</span>
        {ready ? null : <span class="power-why">{power.reason}</span>}
      </span>
      <ResolveGauge value={power.resolve} max={power.cost} label={false} />
    </button>
  );
}

export function ActionMenu({ unit, options, run, data, powers }: { unit: Unit; options: MenuOption[]; run: Run; data: GameData; powers: PowerOption[] }) {
  return (
    <section
      class={`panel action-menu${options.filter((o) => o !== 'power').length >= 4 ? ' crowded' : ''}${powers.length > 1 ? ' two-powers' : ''}`}
      aria-label={`Orders for ${unit.name}`}
    >
      <p class="panel-title">
        <span class={`team-name team-${unit.team}`}>{unit.name}</span>
        <span class="panel-sub">Orders</span>
      </p>
      <div class="btn-row">
        {options.map((o) => {
          if (o === 'power') return powers.map((p, i) => <PowerButton key={p.powerId} power={p} run={run} first={i === 0} />);
          const icon = optionIcon(o, unit, data);
          const kind = o === 'attack' || o === 'heal' || o === 'talk' ? ' primary' : o === 'cancel' ? ' quiet' : '';
          return (
            <button key={o} type="button" class={`btn${kind}`} onClick={() => run(o)}>
              {icon && <Icon name={icon} size={20} />}
              {OPTION_LABEL[o]}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const TARGET_HINT: Record<TargetMode, string> = {
  attack: 'Tap a red target to see the forecast.',
  heal: 'Tap a wounded ally to heal.',
  talk: 'Tap someone to talk to.',
  power: 'Tap a target for the power.',
};

const DIR_LABEL: Record<Direction, { arrow: string; name: string }> = {
  up: { arrow: '↑', name: 'Up' },
  left: { arrow: '←', name: 'Left' },
  right: { arrow: '→', name: 'Right' },
  down: { arrow: '↓', name: 'Down' },
};

export function TargetHint({ mode, run, dirs, powerName }: { mode: TargetMode; run: Run; dirs?: Direction[] | null; powerName?: string }) {
  if (mode === 'power' && dirs) {
    return (
      <section class="panel target-hint power-aim" aria-label={`Aim ${powerName ?? 'the power'}`}>
        <p class="power-aim-text">
          <Icon name="tenblade" size={20} />
          {powerName}: pick a direction, or tap a red line.
        </p>
        <div class="dir-pad">
          {(['up', 'left', 'right', 'down'] as const).map((d) => (
            <button key={d} type="button" class={`btn dir dir-${d}`} disabled={!dirs.includes(d)} aria-label={DIR_LABEL[d].name} onClick={() => run(d)}>
              {DIR_LABEL[d].arrow}
            </button>
          ))}
          <button type="button" class="btn quiet dir-back" onClick={() => run('back')}>
            Back
          </button>
        </div>
      </section>
    );
  }
  return (
    <section class="panel target-hint">
      <Icon name={mode === 'attack' ? 'sabre' : mode === 'heal' ? 'staff' : mode === 'power' ? 'tenblade' : 'lck'} size={22} />
      <p>{mode === 'power' && powerName ? `${powerName}: tap a red target.` : TARGET_HINT[mode]}</p>
      <button type="button" class="btn quiet" onClick={() => run('back')}>
        Back
      </button>
    </section>
  );
}

/**
 * The forecast for a power. A fight (Devour, Echo's attack) shows both sides like an attack, plus the heal or the
 * repeat strike; Scatter lists each target in the line with its damage and hit.
 */
export function PowerPanel({ fc, state, run, data, look }: { fc: PowerForecast; state: BattleState; run: Run; data: GameData; look: McLook }) {
  const bearer = state.units.find((u) => u.id === fc.bearerId)!;
  const echoOf = fc.plan.echoOf ? state.units.find((u) => u.id === fc.plan.echoOf) : undefined;
  const notes: string[] = [];
  if (fc.plan.effect.type === 'devour') notes.push(fc.healMax > 0 ? `Heals the damage dealt, up to ${fc.healMax} HP.` : 'Heals the damage dealt (at full HP now).');
  if (fc.plan.effect.type === 'devour') notes.push(`A kill adds ${fc.plan.effect.attackPerKill} attack for the rest of the map.`);
  if (fc.echoStrike) notes.push(`Then an echo strike: ${fc.echoStrike.damage} damage, ${fc.echoStrike.hit}% hit, no counter.`);
  if (fc.plan.effect.type === 'scatter') notes.push('No counters.');
  if (fc.plan.effect.type === 'strike') notes.push('No counter.');
  if (fc.status === 'silence') notes.push(fc.statusOnHit ? 'On a hit, silences it until your next turn: no counters, no powers.' : 'Silences it until your next turn, hit or miss: no counters, no powers.');
  if (fc.status === 'pin') notes.push(fc.statusOnHit ? 'On a hit, pins it in place until your next turn.' : 'Pins it in place until your next turn.');
  if (fc.plan.effect.type === 'cleave' && fc.targets.length > 1) notes.push('Then a half-strength blow on each other foe beside the bearer (no counter, no crit).');
  if (fc.bloodPrice > 0) notes.push(`The blade's price: ${bearer.name} loses ${fc.bloodPrice} HP.`);
  return (
    <section class="panel forecast power-fc" aria-label={`${fc.plan.name} forecast`}>
      <p class="panel-title power-title">
        <Icon name="tenblade" size={18} />
        <span class={`school-${(bearer.weaponId ? weaponDef(bearer.weaponId, data)?.school : undefined) ?? 'none'}`}>{fc.plan.name}</span>
        {echoOf && <span class="panel-sub">echoing {echoOf.name}</span>}
      </p>
      {fc.combat && <ForecastTable fc={fc.combat} state={state} data={data} look={look} />}
      {(!fc.combat || fc.targets.length > 1) && (
        <ul class="power-targets">
          {(fc.combat ? fc.targets.slice(1) : fc.targets).map((t) => {
            const u = state.units.find((x) => x.id === t.unitId)!;
            const left = Math.max(0, t.hp - t.side.damage);
            return (
              <li key={t.unitId} class={`power-target team-${u.team}`}>
                <Medallion unit={u} look={look} size={32} />
                <span class="pt-name">{u.name}</span>
                <span class="pt-hp num">
                  {t.hp}
                  {' → '}
                  <strong class={left === 0 ? 'ko' : ''}>{left}</strong>
                </span>
                <span class="pt-n num">
                  <Icon name="str" size={13} /> {t.side.damage}
                </span>
                <span class="pt-n num">
                  <Icon name="skl" size={13} /> {t.side.hit}%
                </span>
                <span class="pt-n num">
                  <Icon name="shard" size={13} /> {t.side.crit}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {notes.length > 0 && <p class="power-notes">{notes.join(' ')}</p>}
      <div class="btn-row">
        <button type="button" class="btn quiet" onClick={() => run('back')}>
          Back
        </button>
        <button type="button" class="btn primary" onClick={() => run('confirm')}>
          Confirm
        </button>
      </div>
    </section>
  );
}

function after(hp: number, foe: CombatSide | null): number {
  return foe ? Math.max(0, hp - foe.damage * foe.strikes) : hp;
}

function Edge({ edge }: { edge: TriangleEdge }) {
  const m = triangleMark(edge);
  if (!m) return null;
  return (
    <span class={`tri ${edge}`} role="img" aria-label={m.label}>
      {m.arrow}
    </span>
  );
}

function Head({ unit, edge, data, look, align }: { unit: Unit; edge: TriangleEdge; data: GameData; look: McLook; align: 'left' | 'right' }) {
  const w = unit.weaponId ? (weaponDef(unit.weaponId, data) ?? undefined) : undefined;
  const sIcon = w ? schoolIcon(w.school) : null;
  return (
    <div class={`fc-head ${align} team-${unit.team}`}>
      <Medallion unit={unit} look={look} size={40} />
      <div class="fc-who">
        <p class="fc-name">{unit.name}</p>
        <p class="fc-arms">
          {w ? (
            <>
              <Icon name={weaponIcon(w)} size={20} label={w.name} />
              {sIcon && <Icon name={sIcon} size={18} label={SCHOOL_LABEL[w.school]} />}
            </>
          ) : (
            <span class="muted">Unarmed</span>
          )}
          <Edge edge={edge} />
        </p>
      </div>
    </div>
  );
}

function HpCell({ hp, left, max, align }: { hp: number; left: number; max: number; align: 'left' | 'right' }) {
  return (
    <div class={`fc-hp ${align}`}>
      <span class="fc-hp-num num">
        <span class="fc-hp-was">{hp}</span>
        <span class="fc-arrow" aria-hidden="true">
          {'→'}
        </span>
        <strong class={left === 0 ? 'ko' : ''}>{left}</strong>
      </span>
      <HpBar hp={hp} after={left} max={max} />
    </div>
  );
}

const ROWS: { key: 'damage' | 'hit' | 'crit'; label: string; icon: IconName }[] = [
  { key: 'damage', label: 'Dmg', icon: 'str' },
  { key: 'hit', label: 'Hit', icon: 'skl' },
  { key: 'crit', label: 'Crit', icon: 'shard' },
];

function value(side: CombatSide, key: 'damage' | 'hit' | 'crit') {
  if (key === 'damage') {
    return (
      <>
        {side.damage}
        {side.strikes > 1 && <span class="x2"> ×{side.strikes}</span>}
      </>
    );
  }
  return (
    <>
      {side[key]}
      <span class="pct">%</span>
    </>
  );
}

/** Both sides of the fight. HP after assumes every strike lands. */
export function ForecastPanel({ fc, state, run, data, look }: { fc: Forecast; state: BattleState; run: Run; data: GameData; look: McLook }) {
  return (
    <section class="panel forecast" aria-label="Combat forecast">
      <ForecastTable fc={fc} state={state} data={data} look={look} />
      <div class="btn-row">
        <button type="button" class="btn quiet" onClick={() => run('back')}>
          Back
        </button>
        <button type="button" class="btn primary" onClick={() => run('confirm')}>
          Confirm
        </button>
      </div>
    </section>
  );
}

function ForecastTable({ fc, state, data, look }: { fc: Forecast; state: BattleState; data: GameData; look: McLook }) {
  const a = state.units.find((u) => u.id === fc.attacker.unitId)!;
  const d = state.units.find((u) => u.id === fc.defenderId)!;
  const c = fc.counter;
  return (
      <div class="fc-table">
        <Head unit={a} edge={fc.attacker.triangle} data={data} look={look} align="left" />
        <div class="fc-vs" aria-hidden="true">
          vs
        </div>
        <Head unit={d} edge={fc.defenderTriangle} data={data} look={look} align="right" />
        <HpCell hp={fc.attacker.hp} left={after(fc.attacker.hp, c)} max={a.stats.hp} align="left" />
        <div class="fc-k">
          <Icon name="hp" size={14} />
          HP
        </div>
        <HpCell hp={fc.defenderHp} left={after(fc.defenderHp, fc.attacker)} max={d.stats.hp} align="right" />
        {ROWS.map((r) => (
          <Fragment key={r.key}>
            <div class="fc-v left num">
              {value(fc.attacker, r.key)}
            </div>
            <div class="fc-k">
              <Icon name={r.icon} size={14} />
              {r.label}
            </div>
            {c ? (
              <div class="fc-v right num">
                {value(c, r.key)}
              </div>
            ) : (
              r.key === 'damage' && (
                <div class="fc-none right" style={{ gridRow: 'span 3' }}>
                  No counter
                </div>
              )
            )}
          </Fragment>
        ))}
      </div>
  );
}

export function HealPanel({ healer, target, amount, run, look }: { healer: Unit; target: Unit; amount: number; run: Run; look: McLook }) {
  const to = Math.min(target.stats.hp, target.hp + amount);
  return (
    <section class="panel forecast heal" aria-label="Heal preview">
      <div class="heal-row">
        <Medallion unit={healer} look={look} size={42} />
        <Icon name="staff" size={22} />
        <Medallion unit={target} look={look} size={42} />
        <div class="heal-info">
          <p class="panel-title">
            {healer.name} heals {target.name}
          </p>
          <p class="fc-hp-num num">
            HP {target.hp} {'→'} <strong class="heal-to">{target.hp + amount}</strong> of {target.stats.hp}
          </p>
        </div>
      </div>
      <HpBar hp={target.hp} after={to} max={target.stats.hp} />
      <div class="btn-row">
        <button type="button" class="btn quiet" onClick={() => run('back')}>
          Back
        </button>
        <button type="button" class="btn primary" onClick={() => run('confirm')}>
          Confirm
        </button>
      </div>
    </section>
  );
}

/**
 * The Items panel: the unit's inventory. Items are used on the unit itself from the previewed tile (that is its
 * action); weapons can be equipped for free and the menu comes back, so the forecast then uses the new weapon.
 */
export function ItemsPanel({ unit, items, run, data }: { unit: Unit; items: ItemOption[]; run: Run; data: GameData }) {
  return (
    <section class="panel items-panel" aria-label={`${unit.name}'s items`}>
      <p class="panel-title">
        <span class={`team-name team-${unit.team}`}>{unit.name}</span>
        <span class="panel-sub">Items</span>
      </p>
      <ul class="inv-list">
        {items.map((o) => {
          const w = o.kind === 'weapon' ? weaponDef(o.id, data) : null;
          const icon: IconName = w ? weaponIcon(w) : (itemDef(o.id, data)?.heal ?? 0) > 0 ? 'hp' : 'tenblade';
          const label = o.kind === 'weapon' ? (o.equipped ? 'Equipped' : 'Equip') : 'Use';
          return (
            <li key={o.index} class={`inv-row${o.equipped ? ' equipped' : ''}`}>
              <Icon name={icon} size={22} />
              <span class="inv-name">
                <span>{o.name}</span>
                {o.reason && !o.equipped && <span class="inv-why">{o.reason}</span>}
              </span>
              <button
                type="button"
                class={`btn${o.kind === 'item' && !o.reason ? ' primary' : ''}`}
                disabled={o.equipped || o.reason !== null}
                aria-label={`${label} ${o.name}`}
                onClick={() => run(o.kind === 'weapon' ? `equip:${o.index}` : `use:${o.index}`)}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <div class="btn-row">
        <button type="button" class="btn quiet" onClick={() => run('back')}>
          Back
        </button>
      </div>
    </section>
  );
}

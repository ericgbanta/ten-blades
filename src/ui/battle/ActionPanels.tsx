// The action menu, the combat forecast and the heal preview.

import { Fragment } from 'preact';
import type { BattleState, CombatSide, Forecast, GameData, TriangleEdge, Unit } from '../../core';
import type { McLook } from '../../art/mc/look';
import type { Command, MenuOption } from '../../battle/selection';
import { Icon, Medallion, schoolIcon, weaponIcon, type IconName } from '../kit';
import { HpBar } from './UnitCard';
import { SCHOOL_LABEL, triangleMark } from './text';

const OPTION_LABEL: Record<MenuOption, string> = {
  attack: 'Attack',
  heal: 'Heal',
  wait: 'Wait',
  cancel: 'Cancel',
};

type Run = (cmd: Command) => void;

function optionIcon(o: MenuOption, unit: Unit, data: GameData): IconName | null {
  const w = unit.weaponId ? data.weapons[unit.weaponId] : undefined;
  if (o === 'attack') return w ? weaponIcon(w) : 'sabre';
  if (o === 'heal') return 'staff';
  return null;
}

export function ActionMenu({ unit, options, run, data }: { unit: Unit; options: MenuOption[]; run: Run; data: GameData }) {
  return (
    <section class="panel action-menu" aria-label={`Orders for ${unit.name}`}>
      <p class="panel-title">
        <span class={`team-name team-${unit.team}`}>{unit.name}</span>
        <span class="panel-sub">Orders</span>
      </p>
      <div class="btn-row">
        {options.map((o) => {
          const icon = optionIcon(o, unit, data);
          const kind = o === 'attack' || o === 'heal' ? ' primary' : o === 'cancel' ? ' quiet' : '';
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

export function TargetHint({ mode, run }: { mode: 'attack' | 'heal'; run: Run }) {
  return (
    <section class="panel target-hint">
      <Icon name={mode === 'attack' ? 'sabre' : 'staff'} size={22} />
      <p>{mode === 'attack' ? 'Tap a red target to see the forecast.' : 'Tap a wounded ally to heal.'}</p>
      <button type="button" class="btn quiet" onClick={() => run('back')}>
        Back
      </button>
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
  const w = unit.weaponId ? data.weapons[unit.weaponId] : undefined;
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
  const a = state.units.find((u) => u.id === fc.attacker.unitId)!;
  const d = state.units.find((u) => u.id === fc.defenderId)!;
  const c = fc.counter;
  return (
    <section class="panel forecast" aria-label="Combat forecast">
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

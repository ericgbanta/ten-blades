// The action menu, the combat forecast and the heal preview.

import type { BattleState, CombatSide, Forecast, Unit } from '../../core';
import type { Command, MenuOption } from '../../battle/selection';
import { HpBar } from './UnitCard';
import { triangleMark } from './text';

const OPTION_LABEL: Record<MenuOption, string> = {
  attack: 'Attack',
  heal: 'Heal',
  wait: 'Wait',
  cancel: 'Cancel',
};

type Run = (cmd: Command) => void;

export function ActionMenu({ unit, options, run }: { unit: Unit; options: MenuOption[]; run: Run }) {
  return (
    <section class="panel action-menu" aria-label={`Orders for ${unit.name}`}>
      <p class="panel-title">{unit.name}</p>
      <div class="btn-row">
        {options.map((o) => (
          <button key={o} type="button" class={`btn ${o === 'cancel' ? 'quiet' : ''}`} onClick={() => run(o)}>
            {OPTION_LABEL[o]}
          </button>
        ))}
      </div>
    </section>
  );
}

export function TargetHint({ mode, run }: { mode: 'attack' | 'heal'; run: Run }) {
  return (
    <section class="panel target-hint">
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

function Side({ unit, side, foe, hp, align }: { unit: Unit; side: CombatSide | null; foe: CombatSide | null; hp: number; align: 'left' | 'right' }) {
  const edge = side ? triangleMark(side.triangle) : null;
  const left = after(hp, foe);
  return (
    <div class={`fc-side ${align} team-${unit.team}`}>
      <p class="fc-name">
        {unit.name}
        {edge && (
          <span class={`tri ${side!.triangle}`} aria-label={edge.label} title={edge.label}>
            {edge.arrow}
          </span>
        )}
      </p>
      <p class="fc-hp">
        HP {hp} {'→'} <strong class={left === 0 ? 'ko' : ''}>{left}</strong>
      </p>
      <HpBar hp={left} max={unit.stats.hp} />
      {side ? (
        <dl class="fc-nums">
          <div>
            <dt>Dmg</dt>
            <dd>
              {side.damage}
              {side.strikes > 1 && <span class="x2"> x{side.strikes}</span>}
            </dd>
          </div>
          <div>
            <dt>Hit</dt>
            <dd>{side.hit}%</dd>
          </div>
          <div>
            <dt>Crit</dt>
            <dd>{side.crit}%</dd>
          </div>
        </dl>
      ) : (
        <p class="muted fc-none">Cannot strike back</p>
      )}
    </div>
  );
}

/** Both sides of the fight. HP after assumes every strike lands. */
export function ForecastPanel({ fc, state, run }: { fc: Forecast; state: BattleState; run: Run }) {
  const a = state.units.find((u) => u.id === fc.attacker.unitId)!;
  const d = state.units.find((u) => u.id === fc.defenderId)!;
  return (
    <section class="panel forecast" aria-label="Combat forecast">
      <div class="fc-grid">
        <Side unit={a} side={fc.attacker} foe={fc.counter} hp={fc.attacker.hp} align="left" />
        <Side unit={d} side={fc.counter} foe={fc.attacker} hp={fc.defenderHp} align="right" />
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

export function HealPanel({ healer, target, amount, run }: { healer: Unit; target: Unit; amount: number; run: Run }) {
  return (
    <section class="panel forecast" aria-label="Heal preview">
      <p class="panel-title">
        {healer.name} heals {target.name}
      </p>
      <p class="fc-hp">
        HP {target.hp} {'→'} <strong>{target.hp + amount}</strong> of {target.stats.hp}
      </p>
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

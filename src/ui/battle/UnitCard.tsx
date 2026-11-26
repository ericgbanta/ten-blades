import type { GameData, Unit } from '../../core';
import type { McLook } from '../../art/mc/look';
import { McFace } from '../mc/McPicture';
import { SCHOOL_LABEL, STAT_LABEL } from './text';

const SHOWN = ['str', 'mag', 'skl', 'spd', 'lck', 'def', 'res', 'mov'] as const;

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.round((hp / max) * 100) : 0;
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'low' : 'crit';
  return (
    <div class="hpbar" role="img" aria-label={`HP ${hp} of ${max}`}>
      <div class={`hpbar-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Compact sheet for any unit: name, class, level, HP, stats and weapon. The main character shows their face. */
export function UnitCard({ unit, data, look }: { unit: Unit; data: GameData; look?: McLook }) {
  const cls = data.classes[unit.classId];
  const w = unit.weaponId ? data.weapons[unit.weaponId] : undefined;
  const face = look && unit.isLord && unit.team === 'player';
  return (
    <section class={`panel unit-card team-${unit.team}${face ? ' with-face' : ''}`} aria-label={`${unit.name} details`}>
      {face && <McFace look={look} size={52} label={`${unit.name}'s portrait`} class="unit-face" />}
      <header class="unit-head">
        <strong class="unit-name">
          {unit.name}
          {unit.isLord && <span class="tag">Lord</span>}
          {unit.isBoss && <span class="tag boss">Boss</span>}
        </strong>
        <span class="muted">
          {cls?.name ?? unit.classId} · Lv {unit.level}
          {unit.team === 'player' && ` · XP ${unit.xp}`}
        </span>
      </header>
      <div class="hp-row">
        <span>
          HP {unit.hp}/{unit.stats.hp}
        </span>
        <HpBar hp={unit.hp} max={unit.stats.hp} />
      </div>
      <dl class="stats">
        {SHOWN.map((k) => (
          <div key={k}>
            <dt>{STAT_LABEL[k]}</dt>
            <dd>{unit.stats[k]}</dd>
          </div>
        ))}
      </dl>
      <p class="weapon">
        {w ? (
          <>
            <strong>{w.name}</strong> <span class={`school ${w.school}`}>{SCHOOL_LABEL[w.school]}</span>{' '}
            <span class="muted">
              {w.heal > 0 ? `Heals ${w.heal}` : `Mt ${w.might} · Hit ${w.hit} · Crit ${w.crit}`} · Rng{' '}
              {w.range[0] === w.range[1] ? w.range[0] : `${w.range[0]}-${w.range[1]}`}
            </span>
          </>
        ) : (
          <span class="muted">No weapon</span>
        )}
      </p>
    </section>
  );
}

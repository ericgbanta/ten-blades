import { bladeOf, implementedPower, type GameData, type School, type Unit } from '../../core';
import type { McLook } from '../../art/mc/look';
import { Icon, Medallion, schoolIcon, weaponIcon } from '../kit';
import { SCHOOL_LABEL, STAT_LABEL } from './text';

const SHOWN = ['str', 'mag', 'skl', 'spd', 'lck', 'def', 'res', 'mov'] as const;

function tone(pct: number): string {
  return pct > 50 ? 'ok' : pct > 25 ? 'low' : 'crit';
}

/**
 * HP bar. `after` shows a predicted change: lower than `hp` marks the loss, higher marks a heal.
 * The fill color follows the HP that is left.
 */
export function HpBar({ hp, max, after }: { hp: number; max: number; after?: number }) {
  const pct = (n: number) => (max > 0 ? Math.max(0, Math.min(100, (n / max) * 100)) : 0);
  const end = after ?? hp;
  const label = after === undefined || after === hp ? `HP ${hp} of ${max}` : `HP ${hp} to ${after} of ${max}`;
  return (
    <div class="hpbar" role="img" aria-label={label}>
      {after !== undefined && after < hp && <div class="hpbar-loss" style={{ width: `${pct(hp)}%` }} />}
      {after !== undefined && after > hp && <div class="hpbar-gain" style={{ width: `${pct(after)}%` }} />}
      <div class={`hpbar-fill ${tone(pct(end))}`} style={{ width: `${pct(Math.min(hp, end))}%` }} />
    </div>
  );
}

/** The Resolve gauge: a bar with the value, gold when full. */
export function ResolveGauge({ value, max, label = true }: { value: number; max: number; label?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span class={`resolve${value >= max ? ' full' : ''}`} role="img" aria-label={`Resolve ${value} of ${max}`}>
      {label && <span class="resolve-k">Resolve</span>}
      <span class="resolve-bar">
        <span class="resolve-fill" style={{ width: `${pct}%` }} />
      </span>
      {label && <span class="resolve-v num">{value}</span>}
    </span>
  );
}

/** The triangle as the data says it: which school this one beats and which beats it. */
export function TriangleHint({ school, data }: { school: School; data: GameData }) {
  if (school === 'none') return null;
  const beats = data.balance.triangle.beats as Record<string, School>;
  const win = beats[school];
  const lose = (Object.keys(beats) as School[]).find((s) => beats[s] === school);
  return (
    <span class="tri-hint">
      {win && (
        <span class="tri-hint-part">
          <span class="tri advantage" aria-hidden="true">
            ▲
          </span>
          <Icon name={schoolIcon(win)!} size={16} label={`Beats ${SCHOOL_LABEL[win]}`} />
        </span>
      )}
      {lose && (
        <span class="tri-hint-part">
          <span class="tri disadvantage" aria-hidden="true">
            ▼
          </span>
          <Icon name={schoolIcon(lose)!} size={16} label={`Weak to ${SCHOOL_LABEL[lose]}`} />
        </span>
      )}
    </span>
  );
}

/** For a bearer: the power's name and the Resolve gauge. */
function BladeRow({ unit, data }: { unit: Unit; data: GameData }) {
  const blade = bladeOf(unit, data);
  if (!blade) return null;
  const power = implementedPower(blade.power, data);
  const name = power?.def.name ?? data.powers[blade.power]?.name ?? blade.power;
  return (
    <div class="blade-row" data-testid="blade-row">
      <span class="blade-power">
        <Icon name="tenblade" size={14} />
        {name}
        {!power && <span class="muted"> (sealed)</span>}
      </span>
      <ResolveGauge value={unit.resolve} max={data.balance.resolve.max} />
    </div>
  );
}

/** Compact sheet for any unit: portrait, name, class, level, HP, stats and weapon. */
export function UnitCard({ unit, data, look }: { unit: Unit; data: GameData; look?: McLook }) {
  const cls = data.classes[unit.classId];
  const w = unit.weaponId ? data.weapons[unit.weaponId] : undefined;
  const school = w?.school ?? cls?.school ?? 'none';
  const sIcon = schoolIcon(school);
  return (
    <section class={`unit-card team-${unit.team}`} aria-label={`${unit.name} details`}>
      <Medallion unit={unit} look={look} size={46} class="unit-medal" />
      <div class="unit-main">
        <header class="unit-head">
          <strong class="unit-name">{unit.name}</strong>
          {unit.isLord && <span class="tag">Lord</span>}
          {unit.isBoss && <span class="tag boss">Boss</span>}
          <span class="unit-school">
            {sIcon && <Icon name={sIcon} size={18} />}
            <span class={`school-${school}`}>{SCHOOL_LABEL[school]}</span>
            <TriangleHint school={school} data={data} />
          </span>
        </header>
        <div class="unit-sub">
          <p class="unit-class num">
            {cls?.name ?? unit.classId} · Lv {unit.level}
            {unit.team === 'player' && ` · XP ${unit.xp}`}
          </p>
          <div class="hp-row">
            <span class="hp-num num">
              <Icon name="hp" size={14} />
              <span>
                <span class="hp-cur">{unit.hp}</span>/{unit.stats.hp}
              </span>
            </span>
            <HpBar hp={unit.hp} max={unit.stats.hp} />
          </div>
        </div>
        <BladeRow unit={unit} data={data} />
      </div>
      <dl class="stats">
        {SHOWN.map((k) => (
          <div key={k} class="stat">
            <dt>
              <Icon name={k} size={17} />
              <span class="stat-k">{STAT_LABEL[k]}</span>
            </dt>
            <dd class="num">{unit.stats[k]}</dd>
          </div>
        ))}
      </dl>
      <p class="weapon">
        {w ? (
          <>
            <Icon name={weaponIcon(w)} size={20} />
            <strong class="weapon-name">{w.name}</strong>
            <span class="weapon-nums num">
              {w.heal > 0 ? (
                <span>Heals {w.heal}</span>
              ) : (
                <>
                  <span>
                    <abbr title="Might">Mt</abbr> {w.might}
                  </span>
                  <span>Hit {w.hit}</span>
                  <span>Crit {w.crit}</span>
                </>
              )}
              <span>Rng {w.range[0] === w.range[1] ? w.range[0] : `${w.range[0]}-${w.range[1]}`}</span>
            </span>
          </>
        ) : (
          <span class="muted">No weapon</span>
        )}
      </p>
    </section>
  );
}

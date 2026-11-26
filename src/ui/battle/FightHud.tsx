// The HUD of the side-view battle scene (under it in portrait, over its bottom edge in landscape) and the
// portrait cut-in that announces a power. Both only show what the controller's view says.

import { useEffect, useState } from 'preact/hooks';
import type { BattleState, GameData, Unit } from '../../core';
import type { CutInView, FightView } from '../../battle/controller';
import type { McLook } from '../../art/mc/look';
import { imageUrl } from '../../art/manifest';
import { fightLayout } from '../../game/fightLayout';
import { McPortrait } from '../mc/McPicture';
import { portraitSheet, speakerPortraitId } from '../artMap';
import { Icon, Medallion, schoolIcon, weaponIcon } from '../kit';
import { SCHOOL_LABEL } from './text';

function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function Side(props: { unit: Unit; view: FightView; data: GameData; look: McLook; align: 'left' | 'right'; healText?: string }) {
  const { unit, view, data, look, align } = props;
  const hp = view.hp[unit.id] ?? { hp: unit.hp, ms: 0 };
  const max = unit.stats.hp;
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp.hp / max) * 100)) : 0;
  const w = unit.weaponId ? data.weapons[unit.weaponId] : undefined;
  const s = w ? schoolIcon(w.school) : null;
  const n = view.numbers[unit.id];
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'low' : 'crit';
  return (
    <div class={`fh-side ${align} team-${unit.team}`} data-testid={`fight-side-${unit.id}`}>
      <div class="fh-who">
        <Medallion unit={unit} look={look} size={44} />
        <div class="fh-id">
          <p class="fh-name">{unit.name}</p>
          <p class="fh-arms">
            {w && <Icon name={weaponIcon(w)} size={20} label={w.name} />}
            {s && w && <Icon name={s} size={18} label={SCHOOL_LABEL[w.school]} />}
            <span class="fh-wname">{w?.name ?? 'Unarmed'}</span>
          </p>
        </div>
      </div>
      <div class="fh-hp">
        <span class="fh-hp-num num" data-testid={`fight-hp-${unit.id}`}>
          {hp.hp}
          <span class="fh-hp-max">/{max}</span>
        </span>
        <div class="hpbar fh-bar">
          <div class={`hpbar-fill ${tone}`} style={{ width: `${pct}%`, transition: `width ${hp.ms}ms ease-out` }} />
        </div>
      </div>
      <dl class="fh-nums num">
        {n ? (
          <>
            <div>
              <dt>Dmg</dt>
              <dd>
                {n.damage}
                {n.strikes > 1 && <span class="x2">×{n.strikes}</span>}
              </dd>
            </div>
            <div>
              <dt>Hit</dt>
              <dd>{n.hit}</dd>
            </div>
            <div>
              <dt>Crit</dt>
              <dd>{n.crit}</dd>
            </div>
          </>
        ) : (
          <div class="fh-none">{n === null ? 'No counter' : (props.healText ?? '\u00a0')}</div>
        )}
      </dl>
    </div>
  );
}

/** Several targets (Scatter): a name and a small HP bar each. */
function Crowd(props: { ids: string[]; view: FightView; state: BattleState; align: 'left' | 'right' }) {
  return (
    <ul class={`fh-crowd ${props.align}`}>
      {props.ids.map((id) => {
        const u = props.state.units.find((x) => x.id === id);
        if (!u) return null;
        const hp = props.view.hp[id] ?? { hp: u.hp, ms: 0 };
        const pct = u.stats.hp > 0 ? Math.max(0, Math.min(100, (hp.hp / u.stats.hp) * 100)) : 0;
        return (
          <li key={id} class={`team-${u.team}`} data-testid={`fight-side-${id}`}>
            <span class="fh-crowd-name">{u.name}</span>
            <span class="fh-crowd-hp num" data-testid={`fight-hp-${id}`}>
              {hp.hp}
            </span>
            <div class="hpbar">
              <div class={`hpbar-fill ${pct > 50 ? 'ok' : pct > 25 ? 'low' : 'crit'}`} style={{ width: `${pct}%`, transition: `width ${hp.ms}ms ease-out` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** For a staff heal, the healer's line: how much it restores. */
function healText(view: FightView, unitId: string): string | undefined {
  if (view.script.kind !== 'heal') return undefined;
  const h = view.script.steps.find((s) => s.kind === 'heal' && s.actor === unitId);
  return h && h.kind === 'heal' ? `Heals ${h.amount}` : undefined;
}

/** The scene's HUD: both fighters' names, portraits, HP bars that drain as hits land, arms and numbers. */
export function FightHud(props: { view: FightView; state: BattleState; data: GameData; look: McLook; onSkip: () => void }) {
  const { view, state, data, look } = props;
  const size = useWindowSize();
  const L = fightLayout(size.w, size.h);
  const front = (side: 'left' | 'right') => view.script.fighters.find((f) => f.side === side && f.slot === 0);
  const unitOf = (id: string | undefined) => (id ? state.units.find((u) => u.id === id) : undefined);
  const left = unitOf(front('left')?.unitId);
  const right = unitOf(front('right')?.unitId);
  const power = view.script.power;
  const shownFoes = view.script.fighters.filter((f) => f.side === 'right');
  const unshown = power ? power.targetIds.length - view.script.fighters.filter((f) => power.targetIds.includes(f.unitId)).length : 0;
  const crowd = view.script.fighters.filter((f) => f.side === 'right').length > 1 ? 'right' : view.script.fighters.filter((f) => f.side === 'left').length > 1 ? 'left' : null;
  const own = power ? data.powers[power.bladePowerId]?.name : undefined;
  const cast = power ? (data.powers[power.powerId]?.name ?? power.powerId) : null;
  const powerName = power ? (power.echoOf && own ? `${own}: ${cast}` : cast) : null;
  return (
    <div
      class={`fight-layer${L.landscape ? ' landscape' : ''}`}
      data-testid="fight"
      onPointerDown={(e) => {
        e.preventDefault();
        props.onSkip();
      }}
    >
      <div class="fight-hud" style={L.landscape ? { top: `${L.hud.y}px`, height: `${L.hud.h}px` } : { top: `${L.hud.y}px`, bottom: 0 }}>
        {powerName && <p class={`fh-power school-${power?.powerId}`}>{powerName}</p>}
        <div class="fh-row">
          {crowd === 'left' ? (
            <Crowd ids={view.script.fighters.filter((f) => f.side === 'left').map((f) => f.unitId)} view={view} state={state} align="left" />
          ) : (
            left && <Side unit={left} view={view} data={data} look={look} align="left" healText={healText(view, left.id)} />
          )}
          {crowd === 'right' ? (
            <Crowd ids={shownFoes.map((f) => f.unitId)} view={view} state={state} align="right" />
          ) : (
            right && <Side unit={right} view={view} data={data} look={look} align="right" />
          )}
        </div>
        {unshown > 0 && <p class="fh-more">and {unshown} more in the line</p>}
        <p class="fh-skip">Tap to skip</p>
      </div>
    </div>
  );
}

/** A power's cut-in: the bearer's portrait, angry, slides across a dark band with the power's name. */
export function CutIn(props: { cut: CutInView; state: BattleState; look: McLook; reduced: boolean; onSkip: () => void }) {
  const { cut, state, look } = props;
  const unit = state.units.find((u) => u.id === cut.unitId);
  if (!unit) return null;
  const mc = unit.isLord && unit.team === 'player';
  const sheet = portraitSheet(unit);
  const pid = !mc && sheet ? speakerPortraitId(sheet, 'angry') : null;
  const url = pid ? imageUrl(pid) : undefined;
  const echoed = cut.echoOf ? state.units.find((u) => u.id === cut.echoOf) : undefined;
  return (
    <div
      class={`cut-in school-${cut.school}${props.reduced ? ' calm' : ''}`}
      style={{ '--cut-ms': `${cut.ms}ms` }}
      data-testid="cut-in"
      onPointerDown={(e) => {
        e.preventDefault();
        props.onSkip();
      }}
    >
      <div class="cut-band">
        <div class="cut-streaks" aria-hidden="true" />
        <div class="cut-face">
          {mc ? (
            <McPortrait look={look} expr="angry" size={240} label={`${unit.name}'s portrait`} class="cut-img" />
          ) : url ? (
            <img class="cut-img" src={url} alt={`${unit.name}'s portrait`} draggable={false} />
          ) : (
            <span class="cut-initial">{unit.name.charAt(0)}</span>
          )}
        </div>
        <div class="cut-text">
          <p class="cut-who">{unit.name}</p>
          <p class="cut-name">{cut.name}</p>
          {echoed && <p class="cut-echo">echoing {echoed.name}</p>}
        </div>
      </div>
    </div>
  );
}

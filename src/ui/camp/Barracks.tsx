// The barracks: the roster (order, who is wounded or benched, the memorial of the fallen in Classic) and each
// unit's sheet (stats, blade, inventory, the convoy, equipping). The rules are src/camp/barracks.ts.

import { useState } from 'preact/hooks';
import { STAT_KEYS, isBound, weaponDef, type PartyUnit } from '../../core';
import { equip, fromConvoy, isWounded, reorder, toConvoy, canWield } from '../../camp/barracks';
import { bladeViews } from '../../camp/forge';
import { gameData } from '../../data';
import { Icon } from '../kit';
import { STAT_LABEL } from '../battle/text';
import { Screen } from '../menus/Screen';
import { campCtx } from '../saves';
import { CLASS_NAME, StatusLine, UnitMedal, entryIcon, entryLine, entryName, tierOf } from './parts';
import type { CampView } from './useCamp';

type Msg = { text: string; bad: boolean } | null;

export function Barracks({ camp, unitId }: { camp: CampView; unitId: string | null }) {
  const unit = unitId ? camp.campaign.party.find((u) => u.id === unitId) : null;
  if (unit) return <UnitSheet camp={camp} unit={unit} />;
  return <Roster camp={camp} />;
}

function Chips({ camp, u }: { camp: CampView; u: PartyUnit }) {
  const c = camp.campaign;
  const tier = tierOf(c, u);
  const blade = tier > 0 ? bladeViews(c, campCtx).find((v) => v.bearer?.id === u.id) : undefined;
  return (
    <span class="chips">
      {u.isLord && <span class="tag">Lord</span>}
      {blade && <span class={`tag blade-tag${tier >= 2 ? ' awakened' : ''}`}>{blade.tierName}</span>}
      {isWounded(c, u.id, campCtx) && <span class="tag wounded">Wounded</span>}
      {c.benched.includes(u.id) && <span class="tag benched">Stays in camp</span>}
    </span>
  );
}

function Roster({ camp }: { camp: CampView }) {
  const c = camp.campaign;
  const [msg, setMsg] = useState<Msg>(null);
  const move = (id: string, d: number) => {
    const err = camp.apply((cc) => reorder(cc, id, d));
    if (err) setMsg({ text: err, bad: true });
  };
  return (
    <Screen title="Barracks" back={() => (window.location.hash = '#/camp')} backLabel="Camp" class="camp-screen">
      <p class="menu-note">The order here is the order units take the map. Tap a unit for its sheet and gear.</p>
      <ul class="roster-list">
        {c.party.map((u, i) => {
          const w = u.weaponId ? weaponDef(u.weaponId, gameData) : null;
          return (
            <li key={u.id} class="roster-card framed">
              <button
                type="button"
                class="roster-open"
                aria-label={`${u.name}, ${CLASS_NAME(u.classId)} level ${u.level}. Open sheet`}
                onClick={() => (window.location.hash = `#/camp/barracks/${u.id}`)}
              >
                <UnitMedal c={c} u={u} size={48} />
                <span class="roster-main">
                  <span class="roster-name">
                    {u.name} <Chips camp={camp} u={u} />
                  </span>
                  <span class="roster-line num">
                    {CLASS_NAME(u.classId)} · Lv {u.level} · HP {u.stats.hp}
                  </span>
                  <span class="roster-line">
                    {w ? (
                      <>
                        <Icon name={entryIcon(u.weaponId!)} size={16} /> {w.name}
                      </>
                    ) : (
                      'Unarmed'
                    )}
                  </span>
                </span>
              </button>
              {c.party.length > 1 && (
                <span class="order-btns">
                  <button type="button" class="btn quiet order" disabled={i === 0} aria-label={`Move ${u.name} up`} onClick={() => move(u.id, -1)}>
                    ▲
                  </button>
                  <button
                    type="button"
                    class="btn quiet order"
                    disabled={i === c.party.length - 1}
                    aria-label={`Move ${u.name} down`}
                    onClick={() => move(u.id, 1)}
                  >
                    ▼
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p class="menu-note">Convoy: {c.convoy.length === 0 ? 'empty' : c.convoy.map(entryName).join(', ')}</p>
      {c.settings.permadeath === 'classic' ? (
        c.fallen.length > 0 && (
          <section class="menu-section memorial" aria-label="The fallen">
            <h2>The fallen</h2>
            <ul class="memorial-list">
              {c.fallen.map((u) => (
                <li key={u.id}>
                  <span class="memorial-name">{u.name}</span>
                  <span class="muted">
                    {CLASS_NAME(u.classId)} · Lv {u.level}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      ) : (
        <p class="menu-note">Casual: the fallen return after each battle.</p>
      )}
      <StatusLine msg={msg} />
    </Screen>
  );
}

/** The two growths the class is best at, as a hint. */
function growthHint(classId: string): string {
  const g = gameData.classes[classId]?.growths;
  if (!g) return '';
  return STAT_KEYS.filter((k) => k !== 'hp' && k !== 'mov')
    .sort((a, b) => g[b] - g[a])
    .slice(0, 2)
    .map((k) => STAT_LABEL[k])
    .join(' and ');
}

function UnitSheet({ camp, unit: u }: { camp: CampView; unit: PartyUnit }) {
  const c = camp.campaign;
  const [msg, setMsg] = useState<Msg>(null);
  const slots = gameData.balance.inventory.slots;
  const blade = bladeViews(c, campCtx).find((v) => v.bearer?.id === u.id);
  const run = (label: string, rule: Parameters<CampView['apply']>[0]) => {
    const err = camp.apply(rule);
    setMsg(err ? { text: err, bad: true } : { text: label, bad: false });
  };
  const i = c.party.findIndex((x) => x.id === u.id);
  const go = (d: number) => {
    const next = c.party[(i + d + c.party.length) % c.party.length]!;
    window.location.hash = `#/camp/barracks/${next.id}`;
  };
  return (
    <Screen title={u.name} back={() => (window.location.hash = '#/camp/barracks')} backLabel="Roster" class="camp-screen">
      <header class="sheet-head framed">
        <UnitMedal c={c} u={u} size={76} />
        <div class="sheet-id">
          <p class="sheet-class num">
            {CLASS_NAME(u.classId)} · Lv {u.level}
          </p>
          <div class="xp-row" aria-label={`XP ${u.xp} of ${gameData.balance.xp.perLevel}`}>
            <span class="xp-k">XP</span>
            <span class="xp-bar">
              <span class="xp-fill" style={{ width: `${(u.xp / gameData.balance.xp.perLevel) * 100}%` }} />
            </span>
            <span class="num">{u.xp}</span>
          </div>
          <Chips camp={camp} u={u} />
          <p class="sheet-growth">Grows best in {growthHint(u.classId)}</p>
        </div>
      </header>
      <dl class="stat-grid">
        {STAT_KEYS.map((k) => (
          <div key={k} class="stat-cell">
            <dt>
              <Icon name={k} size={16} />
              {STAT_LABEL[k]}
            </dt>
            <dd class="num">{u.stats[k]}</dd>
          </div>
        ))}
      </dl>
      {blade && (
        <section class={`menu-section sheet-blade${blade.tier >= 2 ? ' awakened' : ''}`}>
          <h2>{blade.blade.name}</h2>
          <p class="menu-note">
            {blade.tierName}. {blade.powers.map((p) => p.name).join(' and ')}.
          </p>
        </section>
      )}
      <section class="menu-section">
        <h2>
          Inventory {u.inventory.length}/{slots}
        </h2>
        <ul class="shop-list">
          {u.inventory.map((id, index) => {
            const w = weaponDef(id, gameData);
            const equipped = u.weaponId === id && u.inventory.indexOf(id) === index;
            const bound = isBound(id, gameData);
            return (
              <li key={`${id}:${index}`} class={`shop-row${equipped ? ' equipped' : ''}`}>
                <Icon name={entryIcon(id)} size={26} />
                <span class="shop-main">
                  <span class="shop-name">
                    {entryName(id)} {equipped && <span class="tag">Equipped</span>}
                  </span>
                  <span class="shop-line">{entryLine(id)}</span>
                </span>
                <span class="row-btns">
                  {w && !equipped && (
                    <button
                      type="button"
                      class="btn small"
                      disabled={!canWield(u, id, gameData)}
                      onClick={() => run(`${u.name} takes up ${entryName(id)}.`, (cc) => equip(cc, u.id, index, campCtx))}
                    >
                      Equip
                    </button>
                  )}
                  {bound ? (
                    <span class="tag bound" title={`${entryName(id)} will not leave ${u.name}`}>
                      Bound
                    </span>
                  ) : (
                    <button
                      type="button"
                      class="btn quiet small"
                      aria-label={`Put ${entryName(id)} in the convoy`}
                      onClick={() => run(`${entryName(id)} goes to the convoy.`, (cc) => toConvoy(cc, u.id, index, campCtx))}
                    >
                      Store
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section class="menu-section">
        <h2>Convoy</h2>
        {c.convoy.length === 0 ? (
          <p class="menu-note">The convoy is empty.</p>
        ) : (
          <ul class="shop-list">
            {c.convoy.map((id, index) => (
              <li key={`${id}:${index}`} class="shop-row">
                <Icon name={entryIcon(id)} size={26} />
                <span class="shop-main">
                  <span class="shop-name">{entryName(id)}</span>
                  <span class="shop-line">{entryLine(id)}</span>
                </span>
                <button
                  type="button"
                  class="btn small"
                  disabled={u.inventory.length >= slots}
                  aria-label={`Give ${entryName(id)} to ${u.name}`}
                  onClick={() => run(`${u.name} takes ${entryName(id)}.`, (cc) => fromConvoy(cc, index, u.id, campCtx))}
                >
                  Take
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {c.party.length > 1 && (
        <div class="menu-row">
          <button type="button" class="btn quiet" onClick={() => go(-1)}>
            Previous
          </button>
          <button type="button" class="btn quiet" onClick={() => go(1)}>
            Next
          </button>
        </div>
      )}
      <StatusLine msg={msg} />
    </Screen>
  );
}

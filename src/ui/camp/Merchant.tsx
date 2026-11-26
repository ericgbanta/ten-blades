// The merchant: buy weapons and items for a party member or the convoy, with who can use each and a comparison
// against the chosen member's weapon; sell at half price. Class change seals are not sold: classes do not
// promote in the first build (docs/PLAN.md). The rules are src/camp/shop.ts.

import { useState } from 'preact/hooks';
import { classCanWield, itemDef, weaponDef, type WeaponDef } from '../../core';
import { canWield } from '../../camp/barracks';
import { buy, buyPrice, sell, sellPrice, shopStock, type Holder } from '../../camp/shop';
import { gameData } from '../../data';
import { Icon } from '../kit';
import { Screen } from '../menus/Screen';
import { campCtx } from '../saves';
import { Purse, StatusLine, UnitMedal, entryIcon, entryLine, entryName } from './parts';
import type { CampView } from './useCamp';

type Msg = { text: string; bad: boolean } | null;

export function Merchant({ camp }: { camp: CampView }) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [msg, setMsg] = useState<Msg>(null);
  const [to, setTo] = useState<string>(camp.campaign.party[0]?.id ?? 'convoy');
  return (
    <Screen title="Merchant" back={() => (window.location.hash = '#/camp')} backLabel="Camp" class="camp-screen" right={<Purse c={camp.campaign} compact />}>
      <div class="camp-tabs" role="tablist" aria-label="Merchant">
        {(['buy', 'sell'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class={`creator-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>
      {tab === 'buy' ? <Buy camp={camp} to={to} setTo={setTo} onMsg={setMsg} /> : <Sell camp={camp} onMsg={setMsg} />}
      <StatusLine msg={msg} />
    </Screen>
  );
}

/** Pick who a purchase goes to: a party member or the convoy. */
function Recipient({ camp, to, setTo }: { camp: CampView; to: string; setTo: (id: string) => void }) {
  const c = camp.campaign;
  const slots = gameData.balance.inventory.slots;
  return (
    <fieldset class="recipients">
      <legend class="field-label">For</legend>
      <div class="recipient-row" role="radiogroup" aria-label="Buy for">
        {c.party.map((u) => (
          <button
            key={u.id}
            type="button"
            role="radio"
            aria-checked={to === u.id}
            class={`recipient${to === u.id ? ' on' : ''}`}
            aria-label={`${u.name}, ${u.inventory.length} of ${slots} slots`}
            onClick={() => setTo(u.id)}
          >
            <UnitMedal c={c} u={u} size={34} />
            <span class="recipient-name">{u.name}</span>
            <span class="recipient-slots num">
              {u.inventory.length}/{slots}
            </span>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={to === 'convoy'} class={`recipient${to === 'convoy' ? ' on' : ''}`} onClick={() => setTo('convoy')}>
          <span class="convoy-badge" aria-hidden="true">
            <Icon name="def" size={22} />
          </span>
          <span class="recipient-name">Convoy</span>
          <span class="recipient-slots num">{c.convoy.length}</span>
        </button>
      </div>
    </fieldset>
  );
}

/** Differences in one weapon's numbers against another's, as short signed parts. */
function compare(w: WeaponDef, vs: WeaponDef): { k: string; d: number }[] {
  return [
    { k: 'Mt', d: w.might - vs.might },
    { k: 'Hit', d: w.hit - vs.hit },
    { k: 'Crit', d: w.crit - vs.crit },
    { k: 'Rng', d: w.range[1] - vs.range[1] },
  ];
}

function Users({ camp, w }: { camp: CampView; w: WeaponDef | null }) {
  const c = camp.campaign;
  if (!w) return <span class="users any">Anyone can use it</span>;
  const yes = c.party.filter((u) => classCanWield(gameData.classes[u.classId], w));
  return (
    <span class="users" aria-label={yes.length ? `Usable by ${yes.map((u) => u.name).join(', ')}` : 'No one in the company can use it'}>
      {c.party.map((u) => {
        const ok = yes.includes(u);
        return (
          <span key={u.id} class={`user-pip${ok ? ' ok' : ''}`} aria-hidden="true" title={u.name}>
            {u.name.charAt(0)}
          </span>
        );
      })}
      {yes.length === 0 && <span class="users-none">No one can use it</span>}
    </span>
  );
}

function Buy({ camp, to, setTo, onMsg }: { camp: CampView; to: string; setTo: (id: string) => void; onMsg: (m: Msg) => void }) {
  const c = camp.campaign;
  const stock = shopStock(c, campCtx);
  const [open, setOpen] = useState<string | null>(null);
  const holder: Holder = to === 'convoy' ? { convoy: true } : { unitId: to };
  const member = c.party.find((u) => u.id === to) ?? null;
  const equipped = member?.weaponId ? weaponDef(member.weaponId, gameData) : null;
  const row = (id: string) => {
    const w = weaponDef(id, gameData);
    const price = buyPrice(id, campCtx) ?? 0;
    const isOpen = open === id;
    const usable = w && member ? canWield(member, id, gameData) : true;
    return (
      <li key={id} class={`shop-row tall${isOpen ? ' open' : ''}`}>
        <button type="button" class="shop-pick" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
          <Icon name={entryIcon(id)} size={26} />
          <span class="shop-main">
            <span class="shop-name">{entryName(id)}</span>
            <Users camp={camp} w={w} />
          </span>
          <span class={`cost-chip${c.gold >= price ? '' : ' short'}`}>
            <Icon name="coins" size={16} />
            <span class="num">{price}</span>
          </span>
        </button>
        {isOpen && (
          <div class="shop-detail">
            <p class="shop-line">{entryLine(id)}</p>
            {w && member && equipped && (
              <p class="compare" aria-label={`Against ${equipped.name}`}>
                <span class="muted">vs {equipped.name}:</span>
                {compare(w, equipped).map((x) => (
                  <span key={x.k} class={`cmp ${x.d > 0 ? 'up' : x.d < 0 ? 'down' : 'same'}`}>
                    {x.k} {x.d > 0 ? `+${x.d}` : x.d === 0 ? '=' : x.d}
                  </span>
                ))}
              </p>
            )}
            {w && member && !usable && <p class="menu-note">{member.name} cannot wield this. It can still be carried.</p>}
            <button
              type="button"
              class="btn primary wide"
              disabled={c.gold < price}
              onClick={() => {
                const err = camp.apply((cc) => buy(cc, id, holder, campCtx));
                onMsg(err ? { text: err, bad: true } : { text: `Bought ${entryName(id)} for ${member?.name ?? 'the convoy'}.`, bad: false });
              }}
            >
              Buy for {price}
            </button>
          </div>
        )}
      </li>
    );
  };
  return (
    <>
      <Recipient camp={camp} to={to} setTo={setTo} />
      <section class="menu-section">
        <h2>Weapons</h2>
        <ul class="shop-list">{stock.weapons.map(row)}</ul>
      </section>
      <section class="menu-section">
        <h2>Items</h2>
        <ul class="shop-list">{stock.items.map(row)}</ul>
      </section>
      <p class="menu-note">No class change seals: the company's classes do not change yet.</p>
    </>
  );
}

function Sell({ camp, onMsg }: { camp: CampView; onMsg: (m: Msg) => void }) {
  const c = camp.campaign;
  const groups: { who: string; holder: Holder; list: string[]; weaponId: string | null }[] = [
    ...c.party.map((u) => ({ who: u.name, holder: { unitId: u.id } as Holder, list: u.inventory, weaponId: u.weaponId })),
    { who: 'Convoy', holder: { convoy: true } as Holder, list: c.convoy, weaponId: null },
  ];
  return (
    <>
      <p class="menu-note">The merchant pays half the price.</p>
      {groups.map((g) => (
        <section key={g.who} class="menu-section">
          <h2>{g.who}</h2>
          {g.list.length === 0 ? (
            <p class="menu-note">Nothing here.</p>
          ) : (
            <ul class="shop-list">
              {g.list.map((id, index) => {
                const price = sellPrice(id, campCtx);
                const inHand = g.weaponId === id && g.list.indexOf(id) === index;
                const why = price === null ? 'Bound to its bearer' : inHand ? 'In hand' : null;
                return (
                  <li key={`${id}:${index}`} class="shop-row">
                    <Icon name={entryIcon(id)} size={26} />
                    <span class="shop-main">
                      <span class="shop-name">{entryName(id)}</span>
                      <span class="shop-line">{why ?? (itemDef(id, gameData) ? 'Item' : 'Weapon')}</span>
                    </span>
                    <button
                      type="button"
                      class="btn shop-buy"
                      disabled={why !== null}
                      aria-label={price === null ? `${entryName(id)} cannot be sold` : `Sell ${entryName(id)} for ${price}`}
                      onClick={() => {
                        const err = camp.apply((cc) => sell(cc, g.holder, index, campCtx));
                        onMsg(err ? { text: err, bad: true } : { text: `Sold ${entryName(id)} for ${price} gold.`, bad: false });
                      }}
                    >
                      {price === null ? (
                        'Keep'
                      ) : (
                        <>
                          <Icon name="coins" size={16} />
                          <span class="num">{price}</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}

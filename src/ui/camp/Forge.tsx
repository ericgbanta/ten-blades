// The forge: sword awakening (each blade's tier, powers, what the next tier grants, its shards and story
// condition) and gold upgrades for generic weapons. The rules are src/camp/forge.ts.

import { useState } from 'preact/hooks';
import { STAT_KEYS, parseWeaponId, rankedWeaponId, weaponDef } from '../../core';
import { awaken, bladeViews, forgeWeapon, powersAtTier, upgradeBlock, upgradeCost, type BladeView } from '../../camp/forge';
import { gameData } from '../../data';
import { Icon } from '../kit';
import { STAT_LABEL } from '../battle/text';
import { Confirm, Screen } from '../menus/Screen';
import { campCtx } from '../saves';
import { Purse, StatusLine, UnitMedal, entryIcon, entryName } from './parts';
import type { CampView } from './useCamp';

type Msg = { text: string; bad: boolean } | null;

export function Forge({ camp }: { camp: CampView }) {
  const [tab, setTab] = useState<'blades' | 'weapons'>('blades');
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Screen title="Forge" back={() => (window.location.hash = '#/camp')} backLabel="Camp" class="camp-screen" right={<Purse c={camp.campaign} compact />}>
      <div class="camp-tabs" role="tablist" aria-label="Forge">
        {(['blades', 'weapons'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class={`creator-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'blades' ? 'Blades' : 'Weapons'}
          </button>
        ))}
      </div>
      {tab === 'blades' ? <Blades camp={camp} onMsg={setMsg} /> : <Weapons camp={camp} onMsg={setMsg} />}
      <StatusLine msg={msg} />
    </Screen>
  );
}

function TierPips({ tier, max }: { tier: number; max: number }) {
  return (
    <span class="tier-pips" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} class={`menu-step${i < tier ? ' done' : ''}${i === tier - 1 ? ' on' : ''}`} />
      ))}
    </span>
  );
}

function boostText(b: Partial<Record<string, number>> | undefined): string {
  return STAT_KEYS.filter((k) => (b?.[k] ?? 0) !== 0)
    .map((k) => `+${b![k]} ${STAT_LABEL[k]}`)
    .join(', ');
}

function Blades({ camp, onMsg }: { camp: CampView; onMsg: (m: Msg) => void }) {
  const c = camp.campaign;
  const views = bladeViews(c, campCtx);
  const [asking, setAsking] = useState<BladeView | null>(null);
  if (views.length === 0) return <p class="menu-note">No blade has come to the company yet.</p>;
  return (
    <div class="blade-list">
      {views.map((v) => (
        <BladeCard key={v.bladeId} v={v} camp={camp} onAwaken={() => setAsking(v)} />
      ))}
      {asking?.next && (
        <Confirm
          text={`Awaken ${asking.blade.name}?`}
          detail={`Spends ${asking.next.shards} Blade Shards. ${asking.bearer?.name ?? 'Its bearer'} gains ${boostText(asking.next.def.statBoost) || 'nothing'}${
            asking.next.def.bloodPrice ? `, and the blade takes ${asking.next.def.bloodPrice} HP for every power used` : ''
          }.`}
          yes="Awaken"
          onYes={() => {
            const v = asking;
            setAsking(null);
            const err = camp.apply((cc) => awaken(cc, v.bladeId, campCtx));
            const power = v.next?.def.power ? gameData.powers[v.next.def.power]?.name : null;
            onMsg(err ? { text: err, bad: true } : { text: `${v.blade.name} awakens.${power ? ` ${power} is yours.` : ''}`, bad: false });
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </div>
  );
}

function BladeCard({ v, camp, onAwaken }: { v: BladeView; camp: CampView; onAwaken: () => void }) {
  const c = camp.campaign;
  const max = v.blade.tiers.length;
  const next = v.next;
  const nextPowers = next ? powersAtTier(v.bladeId, next.def.tier, campCtx).filter((p) => !v.powers.some((q) => q.id === p.id)) : [];
  const later = v.blade.tiers.filter((t) => t.tier > v.tier + 1);
  return (
    <article class={`blade-card framed${v.tier >= 2 ? ' awakened' : ''}`} aria-label={`${v.blade.name}, ${v.tierName}`}>
      <header class="blade-head">
        {v.bearer && <UnitMedal c={c} u={v.bearer} size={52} />}
        <div class="blade-id">
          <h2 class="blade-name">{v.blade.name}</h2>
          <p class="blade-sub">
            <TierPips tier={v.tier} max={max} />
            <span class="tier-name">{v.tierName}</span>
            {v.bearer && <span class="muted"> · {v.bearer.name}</span>}
          </p>
        </div>
      </header>
      <ul class="power-list">
        {v.powers.map((p) => (
          <li key={p.id}>
            <Icon name="tenblade" size={16} />
            <span>
              <strong>{p.name}</strong> {p.description}
            </span>
          </li>
        ))}
      </ul>
      {next && (
        <section class="next-tier" aria-label={`Next tier: ${next.def.name}`}>
          <h3 class="next-h">Next: {next.def.name}</h3>
          <ul class="next-list">
            {nextPowers.map((p) => (
              <li key={p.id}>
                New power: <strong>{p.name}</strong>. {p.description}
              </li>
            ))}
            {next.def.statBoost && (
              <li>
                {v.bearer?.name ?? 'The bearer'}: {boostText(next.def.statBoost)}
              </li>
            )}
            {!!next.def.bloodPrice && <li class="blood">The price: every power costs the bearer {next.def.bloodPrice} HP.</li>}
            {nextPowers.length === 0 && !next.def.statBoost && <li>{next.def.note}</li>}
          </ul>
          <p class="next-cost">
            <span class={`cost-chip${c.shards >= next.shards ? '' : ' short'}`}>
              <Icon name="shard" size={18} />
              <span class="num">{next.shards}</span>
            </span>
            <span class={`cond${next.met ? ' met' : ''}`}>
              <span aria-hidden="true">{next.met ? '✓' : '✗'}</span> {next.requirement}
              <span class="visually-hidden">{next.met ? ' (met)' : ' (not yet)'}</span>
            </span>
          </p>
          <button type="button" class="btn primary wide" disabled={next.block !== null} onClick={onAwaken}>
            Awaken
          </button>
          {next.block && next.block !== next.requirement && <p class="menu-note">{next.block}</p>}
        </section>
      )}
      {later.map((t) => (
        <p key={t.tier} class="later-tier">
          <span class="tier-name">{t.name}</span> · {t.requires?.text ?? 'Not designed yet'} · locked
        </p>
      ))}
    </article>
  );
}

/** Every generic weapon the company owns, by who holds it. */
function ownedWeapons(camp: CampView): { holder: { unitId: string } | { convoy: true }; who: string; index: number; id: string }[] {
  const c = camp.campaign;
  const out: { holder: { unitId: string } | { convoy: true }; who: string; index: number; id: string }[] = [];
  for (const u of c.party) u.inventory.forEach((id, index) => out.push({ holder: { unitId: u.id }, who: u.name, index, id }));
  c.convoy.forEach((id, index) => out.push({ holder: { convoy: true }, who: 'Convoy', index, id }));
  return out.filter((e) => {
    const w = weaponDef(e.id, gameData);
    return w && !w.legendary;
  });
}

function Weapons({ camp, onMsg }: { camp: CampView; onMsg: (m: Msg) => void }) {
  const list = ownedWeapons(camp);
  const c = camp.campaign;
  if (list.length === 0) return <p class="menu-note">No common steel to work. Legendary blades answer to shards, not gold.</p>;
  return (
    <>
      <p class="menu-note">
        Each rank adds {gameData.balance.weaponRanks.might} might and {gameData.balance.weaponRanks.hit} hit, up to +{gameData.balance.weaponRanks.max}.
      </p>
      <ul class="shop-list">
        {list.map((e) => {
          const w = weaponDef(e.id, gameData)!;
          const cost = upgradeCost(e.id, campCtx);
          const block = upgradeBlock(e.id, c.gold, campCtx);
          const { base, rank } = parseWeaponId(e.id);
          const up = cost !== null ? weaponDef(rankedWeaponId(base, rank + 1), gameData) : null;
          return (
            <li key={`${'unitId' in e.holder ? e.holder.unitId : 'convoy'}:${e.index}`} class="shop-row">
              <Icon name={entryIcon(e.id)} size={26} />
              <span class="shop-main">
                <span class="shop-name">{entryName(e.id)}</span>
                <span class="shop-line">
                  {e.who} ·{' '}
                  {up ? (
                    <>
                      Mt {w.might} → <strong>{up.might}</strong>, Hit {w.hit} → <strong>{up.hit}</strong>
                    </>
                  ) : (
                    'At its best'
                  )}
                </span>
              </span>
              <button
                type="button"
                class="btn shop-buy"
                disabled={block !== null}
                aria-label={cost !== null ? `Forge ${w.name} for ${cost} gold` : `${w.name} is at its best`}
                onClick={() => {
                  const err = camp.apply((cc) => forgeWeapon(cc, e.holder, e.index, campCtx));
                  onMsg(err ? { text: err, bad: true } : { text: `${w.name} is now ${up?.name ?? ''}.`, bad: false });
                }}
              >
                {cost !== null ? (
                  <>
                    <Icon name="coins" size={16} />
                    <span class="num">{cost}</span>
                  </>
                ) : (
                  'Max'
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

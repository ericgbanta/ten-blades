// The war map (a vertical route of chapters, with the side skirmishes beside the next one) and the deploy step
// that comes before a battle. The rules are src/camp/camp.ts and src/camp/barracks.ts.

import { useMemo, useState } from 'preact/hooks';
import { deployInfo, setBenched, reorder, swapDeploy, type DeployStatus } from '../../camp/barracks';
import { leaveCamp, routeNodes, skirmishList, type SkirmishEntry } from '../../camp/camp';
import type { RewardDef } from '../../camp/types';
import { campContent, gameData } from '../../data';
import { scenes, speakers, worldNames } from '../../data/story';
import { storyContextOf } from '../../story/flow';
import { Dialogue } from '../dialogue/Dialogue';
import { Icon } from '../kit';
import { Screen } from '../menus/Screen';
import { campCtx, now, startRun } from '../saves';
import { CLASS_NAME, Purse, StatusLine, UnitMedal } from './parts';
import type { CampView } from './useCamp';

function RewardLine({ r }: { r: RewardDef }) {
  return (
    <span class="reward-line">
      <span class="cost-chip">
        <Icon name="coins" size={16} />
        <span class="num">{r.gold}</span>
      </span>
      <span class="cost-chip">
        <Icon name="shard" size={16} />
        <span class="num">{r.shards}</span>
      </span>
      {(r.bonus ?? []).map((b) => (
        <span key={b.id} class="bonus-chip">
          {b.text}: {[b.gold ? `+${b.gold}` : '', b.shards ? `+${b.shards} shard` : ''].filter(Boolean).join(' ')}
        </span>
      ))}
    </span>
  );
}

function SkirmishCard({ s }: { s: SkirmishEntry }) {
  return (
    <article class={`skirmish-card framed${s.open ? '' : ' spent'}`} aria-label={`Skirmish: ${s.def.name}`}>
      <header class="skirmish-head">
        <h3 class="skirmish-name">{s.def.name}</h3>
        {s.loreUnread && <span class="choice-tag new">Lore</span>}
      </header>
      <p class="skirmish-blurb">{s.def.blurb}</p>
      <RewardLine r={s.def.rewards} />
      <p class="skirmish-left">
        <span class="num">{s.left}</span> of <span class="num">{s.cap}</span> left this chapter
      </p>
      <button type="button" class="btn primary wide" disabled={!s.open} onClick={() => (window.location.hash = `#/camp/deploy/${s.id}`)}>
        {s.open ? 'Fight' : 'No more this chapter'}
      </button>
    </article>
  );
}

export function WarMap({ camp }: { camp: CampView }) {
  const c = camp.campaign;
  const nodes = routeNodes(c, campCtx);
  const skirmishes = skirmishList(c, campCtx);
  return (
    <Screen title="War map" back={() => (window.location.hash = '#/camp')} backLabel="Camp" class="camp-screen" right={<Purse c={camp.campaign} compact />}>
      <ol class="route" aria-label="The road">
        {nodes.map((n) => (
          <li key={n.chapterId} class={`route-node ${n.kind}`}>
            <span class="route-dot" aria-hidden="true">
              {n.kind === 'done' ? '✓' : ''}
            </span>
            <div class="route-body">
              <p class="route-name">
                {n.name} <span class="route-title">· {n.title}</span>
              </p>
              {n.kind === 'done' && <p class="route-line">Done</p>}
              {n.kind === 'later' && <p class="route-line">Ahead</p>}
              {n.kind === 'next' &&
                (n.playable ? (
                  <button type="button" class="btn primary" onClick={() => (window.location.hash = '#/camp/deploy/story')}>
                    March
                  </button>
                ) : (
                  <p class="route-line soon">Coming soon: this chapter's map is not built yet.</p>
                ))}
              {n.kind === 'next' && skirmishes.length > 0 && (
                <section class="route-side" aria-label="Side skirmishes">
                  <h2 class="field-label">Side skirmishes</h2>
                  {skirmishes.map((s) => (
                    <SkirmishCard key={s.id} s={s} />
                  ))}
                </section>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Screen>
  );
}

const STATUS_TEXT: Record<DeployStatus, string> = { deploy: 'Deploying', benched: 'Stays in camp', wounded: 'Wounded', full: 'No room' };

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Choose who goes, then begin: a story chapter's intro, or a skirmish (its lore scene first, the first time). */
export function Deploy({ camp, target }: { camp: CampView; target: string }) {
  const c = camp.campaign;
  const skirmishId = target === 'story' ? null : target;
  const sk = skirmishId ? (campContent.skirmishes[skirmishId] ?? null) : null;
  const info = deployInfo(c, campCtx, skirmishId);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [lore, setLore] = useState(false);
  /** A unit with no room, picked to go in place of someone who deploys (the next tap picks who). */
  const [swapIn, setSwapIn] = useState<string | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);
  if (!info) {
    return (
      <Screen title="Deploy" back={() => (window.location.hash = '#/camp/warmap')} backLabel="Map" class="camp-screen">
        <p class="menu-note">There is no battle to deploy for here.</p>
      </Screen>
    );
  }
  const map = gameData.maps[info.mapId]!;
  const count = info.units.filter((u) => u.status === 'deploy').length;
  const begin = () => {
    if (sk && skirmishId) startRun({ slot: camp.slot, campaign: camp.campaign, resume: null, skirmish: skirmishId });
    else {
      const next = leaveCamp(camp.campaign, now());
      camp.commit(next);
      startRun({ slot: camp.slot, campaign: next, resume: null });
    }
  };
  if (lore && sk?.lore && scenes[sk.lore]) {
    return (
      <Dialogue
        scene={scenes[sk.lore]!}
        text={{ mcName: c.mc.name, pronouns: c.mc.pronouns, names: worldNames }}
        story={storyContextOf(c)}
        speakers={speakers}
        look={c.mc.look}
        reducedMotion={reduced}
        onDone={(r) => {
          const next = { ...c, flags: { ...c.flags, ...r.set, [`read_${sk.lore}`]: true } };
          camp.commit(next);
          startRun({ slot: camp.slot, campaign: next, resume: null, skirmish: skirmishId });
        }}
      />
    );
  }
  const loreUnread = !!sk?.lore && c.flags[`read_${sk.lore}`] !== true;
  const toggle = (id: string, bench: boolean) => {
    const err = camp.apply((cc) => setBenched(cc, id, bench, campCtx, skirmishId));
    setMsg(err ? { text: err, bad: true } : null);
  };
  const swap = (inId: string, outId: string) => {
    const err = camp.apply((cc) => swapDeploy(cc, inId, outId, campCtx, skirmishId));
    setMsg(err ? { text: err, bad: true } : null);
    setSwapIn(null);
  };
  const full = count >= info.max;
  const swapping = swapIn ? info.units.find((e) => e.unit.id === swapIn)?.unit ?? null : null;
  // Units the map itself puts on your side (the Ridge's wardens), who fight but do not join.
  const guests = map.placements.filter((p) => p.kind === 'unit' && p.team === 'player').length;
  const avg = info.deployed.length ? Math.round(info.deployed.reduce((n, u) => n + u.level, 0) / info.deployed.length) : 1;
  return (
    <Screen title="Deploy" back={() => (window.location.hash = '#/camp/warmap')} backLabel="Map" class="camp-screen">
      <header class="deploy-head">
        <p class="deploy-map">{sk ? sk.name : map.name}</p>
        <p class="deploy-count">
          <span class="num">{count}</span> of <span class="num">{info.max}</span> deploying
          {sk && <span class="muted"> · Foes near level {Math.max(1, avg + (sk.scaling.offset ?? 0))}</span>}
        </p>
        {guests > 0 && <p class="deploy-guests">{guests === 1 ? 'One ally of the map fights' : `${guests} allies of the map fight`} beside you.</p>}
      </header>
      {swapping && (
        <p class="deploy-swap" role="status">
          <span>
            Send <strong>{swapping.name}</strong> in place of whom?
          </span>
          <button type="button" class="btn small quiet" onClick={() => setSwapIn(null)}>
            Cancel
          </button>
        </p>
      )}
      <ul class="deploy-list">
        {info.units.map(({ unit: u, status }, i) => {
          const locked = u.isLord || info.required.includes(u.id);
          return (
            <li key={u.id} class={`deploy-row ${status}`}>
              <UnitMedal c={c} u={u} size={40} />
              <span class="deploy-main">
                <span class="deploy-name">{u.name}</span>
                <span class="deploy-line num">
                  {CLASS_NAME(u.classId)} · Lv {u.level} ·{' '}
                  <span class={`deploy-status ${status}`}>{locked && status === 'deploy' ? 'Must go' : STATUS_TEXT[status]}</span>
                </span>
              </span>
              {!locked && swapping && (
                <span class="row-btns">
                  {status === 'deploy' && (
                    <button type="button" class="btn small primary" aria-label={`Send ${swapping.name} in place of ${u.name}`} onClick={() => swap(swapping.id, u.id)}>
                      Here
                    </button>
                  )}
                </span>
              )}
              {!locked && !swapping && (
                <span class="row-btns">
                  {/* With every place taken, a unit left out swaps in directly for someone who goes. */}
                  {full && (status === 'full' || status === 'benched') ? (
                    <button type="button" class="btn small" aria-label={`Swap ${u.name} in`} onClick={() => setSwapIn(u.id)}>
                      Swap
                    </button>
                  ) : (
                    <button
                      type="button"
                      class={`btn small${status === 'benched' ? '' : ' quiet'}`}
                      disabled={status === 'wounded'}
                      aria-label={status === 'benched' ? `Send ${u.name}` : `Keep ${u.name} in camp`}
                      onClick={() => toggle(u.id, status !== 'benched')}
                    >
                      {status === 'benched' ? 'Send' : 'Stay'}
                    </button>
                  )}
                  {i > 0 && (
                    <button type="button" class="btn quiet order" aria-label={`Move ${u.name} up`} onClick={() => camp.apply((cc) => reorder(cc, u.id, -1))}>
                      ▲
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p class="menu-note">Units take the map's places in this order. Open the barracks to change gear first.</p>
      <div class="menu-foot">
        <button type="button" class="btn primary wide" onClick={() => (loreUnread ? setLore(true) : begin())}>
          {sk ? 'To battle' : 'Begin'}
        </button>
      </div>
      <StatusLine msg={msg} />
    </Screen>
  );
}

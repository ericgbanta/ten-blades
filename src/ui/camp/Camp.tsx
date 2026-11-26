// The camp route, `#/camp`: the hub between chapters, and its facilities as sub-routes (`#/camp/forge`,
// `#/camp/merchant`, `#/camp/barracks[/<unit>]`, `#/camp/warmap`, `#/camp/deploy/<story|skirmish id>`) and the
// campfire talk (`#/camp/talk/<scene>`). Every rule is in src/camp; these screens show the campaign and save each
// change through the camp session (src/ui/saves.ts). Without a session (a reload) the route goes to the title,
// where Continue lands back here.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { imageUrl } from '../../art/manifest';
import { campBackdrop, facilityOpen, facilityOpensText, readTalk, talkList } from '../../camp/camp';
import { awakenBlock } from '../../camp/forge';
import { FACILITIES, type Facility } from '../../camp/types';
import { chapters } from '../../data';
import { scenes, speakers, worldNames } from '../../data/story';
import { storyContextOf } from '../../story/flow';
import { Dialogue } from '../dialogue/Dialogue';
import { Divider, Icon, type IconName } from '../kit';
import { Confirm } from '../menus/Screen';
import { campCtx, now, writes } from '../saves';
import { Barracks } from './Barracks';
import { Forge } from './Forge';
import { Merchant } from './Merchant';
import { Purse, StatusLine, UnitMedal } from './parts';
import { lockedForTest } from './testHook';
import { useCamp, type CampView } from './useCamp';
import { Deploy, WarMap } from './WarMap';
import '../menus/menus.css';
import './camp.css';

export const goCamp = (sub = ''): void => {
  window.location.hash = `#/camp${sub ? `/${sub}` : ''}`;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Camp({ path }: { path: string }) {
  const camp = useCamp();
  useEffect(() => {
    if (!camp) window.location.replace('#/');
  }, [camp === null]);
  if (!camp) return null;
  const [, , view = '', arg = ''] = path.split('/');
  switch (view) {
    case 'forge':
      return <Forge camp={camp} />;
    case 'merchant':
      return <Merchant camp={camp} />;
    case 'barracks':
      return <Barracks camp={camp} unitId={arg || null} />;
    case 'warmap':
      return <WarMap camp={camp} />;
    case 'deploy':
      return <Deploy camp={camp} target={arg} />;
    case 'talk':
      return <Talk camp={camp} scene={arg} />;
    default:
      return <Hub camp={camp} />;
  }
}

const FACILITY_TEXT: Record<Facility, { name: string; icon: IconName }> = {
  forge: { name: 'Forge', icon: 'tenblade' },
  merchant: { name: 'Merchant', icon: 'coins' },
  barracks: { name: 'Barracks', icon: 'def' },
  warmap: { name: 'War map', icon: 'mov' },
};

/** One line under a facility's name: what is waiting there. */
function facilityLine(f: Facility, camp: CampView): string {
  const c = camp.campaign;
  switch (f) {
    case 'forge': {
      const ready = Object.keys(c.blades).filter((id) => awakenBlock(c, id, campCtx) === null);
      return ready.length > 0 ? 'A blade can awaken' : 'Awaken blades, forge steel';
    }
    case 'merchant':
      return 'Salves, steel and tonics';
    case 'barracks':
      return `${c.party.length} in the company`;
    case 'warmap':
      return 'Choose the road ahead';
  }
}

function Hub({ camp }: { camp: CampView }) {
  const c = camp.campaign;
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const chapter = chapters.find((ch) => ch.id === c.progress.current);
  const backdrop = imageUrl(`backdrop.${campBackdrop(c, campCtx)}`) ?? imageUrl('backdrop.camp');
  const talk = talkList(c, campCtx);
  const locked = lockedForTest();
  const open = (f: Facility) => facilityOpen(c, f, campCtx) && !locked.includes(f);
  // The company sits either side of the fire, the main character first on the left.
  const shown = c.party.slice(0, 6);
  const sides = { left: shown.filter((_, i) => i % 2 === 0), right: shown.filter((_, i) => i % 2 === 1) };
  const medal = shown.length > 4 ? 42 : 50;
  const save = async () => {
    camp.commit(c);
    await writes.idle();
    setMsg({ text: `Saved to slot ${camp.slot}.`, bad: false });
  };
  return (
    <main class="camp-hub">
      <section class="camp-scene" style={backdrop ? { '--camp-bg': `url("${backdrop}")` } : undefined}>
        <div class="camp-top">
          <span class="camp-top-btns">
            <button type="button" class="btn quiet camp-title-btn" onClick={() => setLeaving(true)}>
              Title
            </button>
            <button type="button" class="btn quiet camp-title-btn" onClick={() => void save()}>
              Save
            </button>
          </span>
          <Purse c={c} />
        </div>
        <div class="camp-heading">
          <h1 class="ribbon camp-ribbon">Camp</h1>
          <p class="camp-next">
            {chapter ? (
              <>
                Next: {chapter.name} <span class="camp-next-title">· {chapter.title}</span>
              </>
            ) : (
              'The road ends here, for now'
            )}
          </p>
        </div>
        <div class="camp-fire" role="img" aria-label={`By the fire: ${c.party.map((u) => u.name).join(', ')}`}>
          <div class="camp-party left">
            {sides.left.map((u) => (
              <UnitMedal key={u.id} c={c} u={u} size={medal} />
            ))}
          </div>
          <div class="fire" aria-hidden="true">
            <span class="fire-glow" />
            <span class="fire-logs" />
            <span class="flame outer" />
            <span class="flame inner" />
          </div>
          <div class="camp-party right">
            {sides.right.map((u) => (
              <UnitMedal key={u.id} c={c} u={u} size={medal} />
            ))}
          </div>
        </div>
      </section>
      <section class="camp-body">
        <nav class="facility-grid" aria-label="Facilities">
          {FACILITIES.map((f) => {
            const isOpen = open(f);
            const t = FACILITY_TEXT[f];
            return (
              <button
                key={f}
                type="button"
                class={`facility framed${isOpen ? '' : ' locked'}`}
                disabled={!isOpen}
                aria-label={isOpen ? t.name : `${t.name}, locked. ${facilityOpensText(c, f, campCtx)}`}
                onClick={() => goCamp(f)}
              >
                <Icon name={t.icon} size={34} />
                <span class="facility-name">{t.name}</span>
                <span class="facility-line">{isOpen ? facilityLine(f, camp) : facilityOpensText(c, f, campCtx)}</span>
              </button>
            );
          })}
        </nav>
        {talk.length > 0 && (
          <section class="menu-section camp-talk" aria-label="By the fire">
            <h2>By the fire</h2>
            {talk.map((t) => (
              <button key={t.scene} type="button" class={`choice talk-entry${t.read ? ' read' : ''}`} onClick={() => goCamp(`talk/${t.scene}`)}>
                <span class="choice-name">
                  {talkTitle(t.scene)}
                  {!t.read && <span class="choice-tag new">New</span>}
                </span>
                <span class="choice-line">{t.read ? 'Heard. Listen again.' : 'Something stirs by the fire.'}</span>
              </button>
            ))}
          </section>
        )}
        <StatusLine msg={msg} />
        <Divider class="camp-divider" />
      </section>
      {leaving && (
        <Confirm
          text="Back to the title?"
          detail={`The camp is saved to slot ${camp.slot}. Continue brings you back here.`}
          yes="Title"
          onYes={() => {
            window.location.hash = '#/';
          }}
          onNo={() => setLeaving(false)}
        />
      )}
    </main>
  );
}

/** A campfire scene's name in the list: its first narrated words would spoil it, so a plain title by id. */
function talkTitle(scene: string): string {
  const titles: Record<string, string> = { camp_first_night: 'The first night' };
  return (
    titles[scene] ??
    scene
      .replace(/^camp_/, '')
      .replace(/_/g, ' ')
      .replace(/^./, (ch) => ch.toUpperCase())
  );
}

/** A campfire scene: plays, then marks it read (with any flags its choices set) and returns to the hub. */
function Talk({ camp, scene }: { camp: CampView; scene: string }) {
  const def = scenes[scene];
  const reduced = useMemo(prefersReducedMotion, []);
  const c = camp.campaign;
  useEffect(() => {
    if (!def) goCamp();
  }, [def]);
  if (!def) return null;
  return (
    <Dialogue
      key={scene}
      scene={def}
      text={{ mcName: c.mc.name, pronouns: c.mc.pronouns, names: worldNames }}
      story={storyContextOf(c)}
      speakers={speakers}
      look={c.mc.look}
      reducedMotion={reduced}
      onDone={(r) => {
        camp.commit(readTalk(c, scene, r.set, campCtx, now()));
        goCamp();
      }}
    />
  );
}

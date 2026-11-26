// A hidden page for checking the main character's art: `#/dev/mc`. It shows the newest saved campaign's look (or
// a random one) as the portrait in four expressions, the token in three styles and all twelve battle poses, with a
// Randomize button and the compose times. Optional `?seed=N` after the route picks the random look.

import { useEffect, useState } from 'preact/hooks';
import { clearComposedMc, composeMcPortrait } from '../art/mc/compose';
import { MC_EXPRESSIONS, MC_POSES, lookKey, lookOptions, randomLook, LOOK_KEYS, type McLook } from '../art/mc/look';
import { createRng, nextFloat } from '../core/rng';
import { MC_STYLES } from '../save/format';
import { McPortrait, McPoseView, McToken } from './mc/McPicture';
import { Screen, goTo } from './menus/Screen';
import { settledStorage } from './saves';
import './menus/menus.css';

function seededLook(seed: number): McLook {
  let s = createRng(seed);
  return randomLook(() => {
    const [v, n] = nextFloat(s);
    s = n;
    return v;
  });
}

function seedFromHash(): number | null {
  const q = window.location.hash.indexOf('?');
  if (q < 0) return null;
  const v = new URLSearchParams(window.location.hash.slice(q + 1)).get('seed');
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
}

export interface DevMcHook {
  look(): McLook | null;
  /** Compose the current look's portrait from loaded layers (no cache), `runs` times; milliseconds each. */
  timePortrait(runs: number): Promise<number[]>;
}

declare global {
  interface Window {
    __mc?: DevMcHook;
  }
}

export function DevMc() {
  const [look, setLook] = useState<McLook | null>(null);
  const [source, setSource] = useState('');
  const [times, setTimes] = useState<Record<string, number>>({});
  useEffect(() => {
    const seed = seedFromHash();
    if (seed !== null) {
      setLook(seededLook(seed));
      setSource(`random look, seed ${seed}`);
      return;
    }
    void settledStorage().then(async (store) => {
      const slots = await store.listSlots();
      const newest = slots
        .map((s) => s.save)
        .filter((s) => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (newest) {
        setLook(newest.mc.look);
        setSource(`${newest.mc.name}'s look (newest save)`);
      } else {
        setLook(seededLook(Date.now() >>> 0));
        setSource('random look (no saves yet)');
      }
    });
  }, []);
  useEffect(() => {
    window.__mc = {
      look: () => look,
      timePortrait: async (runs) => {
        if (!look) return [];
        const out: number[] = [];
        for (let i = 0; i < runs; i++) {
          clearComposedMc();
          const t0 = performance.now();
          await composeMcPortrait(look, MC_EXPRESSIONS[i % 4]);
          out.push(performance.now() - t0);
        }
        return out;
      },
    };
    return () => {
      delete window.__mc;
    };
  }, [look]);
  const drawn = (name: string) => (ms: number) => setTimes((t) => (t[name] === undefined ? { ...t, [name]: Math.round(ms) } : t));
  const randomize = () => {
    setTimes({});
    setLook(seededLook(Date.now() >>> 0));
    setSource('random look');
  };
  return (
    <Screen title="MC art check" back={goTo('#/')} backLabel="Title" wide>
      {look && (
        <div class="devmc" data-look={lookKey(look)}>
          <div class="devmc-head">
            <p class="menu-lead">
              {source}:{' '}
              {LOOK_KEYS.map((k) => lookOptions(k).find((o) => o.id === look[k])?.name ?? look[k]).join(', ')}
            </p>
            <button type="button" class="btn primary" onClick={randomize}>
              Randomize
            </button>
          </div>
          <h2 class="devmc-h">Portrait</h2>
          <div class="devmc-row">
            {MC_EXPRESSIONS.map((e) => (
              <figure key={e}>
                <McPortrait look={look} expr={e} size={150} label={`Portrait ${e}`} onDrawn={drawn(`portrait.${e}`)} />
                <figcaption>{e}</figcaption>
              </figure>
            ))}
          </div>
          <h2 class="devmc-h">Token</h2>
          <div class="devmc-row">
            {MC_STYLES.map((s) => (
              <figure key={s}>
                <McToken look={look} style={s} size={120} label={`Token ${s}`} onDrawn={drawn(`token.${s}`)} />
                <McToken look={look} style={s} size={48} label={`Token ${s}, map size`} />
                <figcaption>{s}</figcaption>
              </figure>
            ))}
          </div>
          <h2 class="devmc-h">Battle poses</h2>
          {MC_STYLES.map((s) => (
            <div key={s} class="devmc-row poses">
              {MC_POSES.map((p) => (
                <figure key={p}>
                  <McPoseView look={look} style={s} pose={p} width={150} label={`${s} ${p}`} />
                  <figcaption>
                    {s} {p}
                  </figcaption>
                </figure>
              ))}
            </div>
          ))}
          <p class="menu-note devmc-times">
            First draw (ms, fetch and decode included):{' '}
            {Object.entries(times)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ') || '...'}
          </p>
        </div>
      )}
    </Screen>
  );
}

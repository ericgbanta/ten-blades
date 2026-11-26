// The dialogue player: portraits, name plate, text box with a typewriter reveal, choices, Log, Auto and Skip.
// The rules of a scene (what comes next, which flags a choice sets) are in the pure runner (src/story/runner.ts);
// this only shows its state and sends taps. Plays standalone over a backdrop, or over the battle map (dimmed).

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Flags, StoryContext } from '../../core';
import type { McLook } from '../../art/mc/look';
import { imageUrl } from '../../art/manifest';
import { advance, choose, skipToChoice, startScene, type RunnerContext, type SceneState, type Slot } from '../../story/runner';
import { resolveText, type TextContext } from '../../story/text';
import type { SceneDef, Side, SpeakerDef } from '../../story/types';
import { backdropArtId, speakerPortraitId } from '../artMap';
import { McPortrait } from '../mc/McPicture';
import './dialogue.css';

/** Milliseconds per character of the typewriter. */
const TYPE_MS = 26;
/** Auto mode waits this long after a line is shown, plus a little per character. */
const AUTO_MS = 1300;
const AUTO_PER_CHAR_MS = 22;

export interface SceneResult {
  /** Flags set by the choices made. */
  set: Flags;
  choices: number[];
}

export interface DialogueProps {
  scene: SceneDef;
  text: TextContext;
  story: StoryContext;
  speakers: Readonly<Record<string, SpeakerDef>>;
  look: McLook;
  /** Over the battle map: no backdrop, the map shows through a dark veil. */
  overlay?: boolean;
  reducedMotion: boolean;
  onDone: (result: SceneResult) => void;
}

function speakerName(id: string, speakers: DialogueProps['speakers'], text: TextContext): string {
  const def = speakers[id];
  if (!def) return id.charAt(0).toUpperCase() + id.slice(1);
  return resolveText(def.name, text);
}

export function Dialogue(props: DialogueProps): JSX.Element {
  const { scene, speakers, text, look, reducedMotion } = props;
  const ctx: RunnerContext = useMemo(() => ({ story: props.story, speakers }), [props.story, speakers]);
  const [st, setSt] = useState<SceneState>(() => startScene(scene, ctx));
  // How much of the current line is shown. Tied to the runner state it belongs to, so a tap that lands just as a
  // new line appears can never count the old line's progress.
  const [reveal, setReveal] = useState<{ of: SceneState; n: number }>({ of: st, n: 0 });
  const [logOpen, setLogOpen] = useState(false);
  const [askSkip, setAskSkip] = useState(false);
  const [auto, setAuto] = useState(false);
  const [shake, setShake] = useState(0);
  const [flash, setFlash] = useState(0);
  const done = useRef(false);

  const line = st.at.kind === 'line' ? st.at.line : null;
  const full = line ? resolveText(line.text, text) : '';
  const shown = reveal.of === st ? reveal.n : reducedMotion ? full.length : 0;
  const complete = !line || shown >= full.length;
  const voice = line ? speakers[line.speaker]?.voice : undefined;

  // Typewriter: reveal the line a character at a time (all at once under reduced motion). A tap shows the rest
  // of the line and stops the reveal.
  const rushed = useRef<SceneState | null>(null);
  useEffect(() => {
    if (!line || reducedMotion) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const n = rushed.current === st ? full.length : Math.min(full.length, Math.floor((performance.now() - t0) / TYPE_MS) + 1);
      setReveal({ of: st, n });
      if (n < full.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [st]);

  // Screen effects passed on the way to this stop.
  useEffect(() => {
    if (reducedMotion) return;
    if (st.fx.includes('shake')) setShake((n) => n + 1);
    if (st.fx.includes('flash')) setFlash((n) => n + 1);
  }, [st]);

  // The end of the scene.
  useEffect(() => {
    if (st.at.kind !== 'end' || done.current) return;
    done.current = true;
    props.onDone({ set: st.set, choices: st.choices });
  }, [st]);

  // Auto mode: go on a little after the line is shown.
  useEffect(() => {
    if (!auto || !complete || !line || logOpen || askSkip) return;
    const id = setTimeout(() => setSt((s) => advance(scene, s, ctx)), AUTO_MS + full.length * AUTO_PER_CHAR_MS);
    return () => clearTimeout(id);
  }, [auto, complete, st, logOpen, askSkip]);

  const next = () => {
    if (logOpen || askSkip || !line) return;
    if (!complete) {
      rushed.current = st;
      setReveal({ of: st, n: full.length });
    } else setSt((s) => advance(scene, s, ctx));
  };

  // Desktop: Enter or Space go on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onStageTap = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .dlg-log, .dlg-ask')) return;
    next();
  };

  const backdrop = props.overlay ? null : backdropArtId(st.backdrop);
  const backdropUrl = backdrop ? imageUrl(backdrop) : undefined;
  const name = line && !voice ? speakerName(line.speaker, speakers, text) : '';
  const side: Side | null = st.speaking;

  return (
    <div
      class={`dlg${props.overlay ? ' over-map' : ''}${shake % 2 === 1 ? ' shake-a' : shake > 0 ? ' shake-b' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Scene"
      data-scene={scene.id}
      onClick={onStageTap}
    >
      {!props.overlay && (
        <div class={`dlg-backdrop${backdropUrl ? '' : ' plain'}`} style={backdropUrl ? { backgroundImage: `url("${backdropUrl}")` } : undefined} />
      )}
      <div class="dlg-stage">
        <PortraitSlot slot={st.left} side="left" speaking={side} look={look} speakers={speakers} text={text} />
        <PortraitSlot slot={st.right} side="right" speaking={side} look={look} speakers={speakers} text={text} />
      </div>
      <div class="dlg-top">
        <button type="button" class={`btn quiet dlg-tool${auto ? ' on' : ''}`} aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
          Auto
        </button>
        <button type="button" class="btn quiet dlg-tool" onClick={() => setLogOpen(true)}>
          Log
        </button>
        {st.at.kind === 'line' && (
          <button type="button" class="btn quiet dlg-tool" onClick={() => setAskSkip(true)}>
            Skip
          </button>
        )}
      </div>
      {st.at.kind === 'choice' && (
        <div class="dlg-choices" role="group" aria-label="Choose">
          {st.at.options.map((o, i) => (
            <button key={i} type="button" class="btn dlg-choice" onClick={() => setSt((s) => choose(scene, s, i, ctx))}>
              {resolveText(o.text, text)}
            </button>
          ))}
        </div>
      )}
      {line && (
        <div class={`dlg-box framed${voice ? ` voice-${voice}` : ''}${side ? ` from-${side}` : ''}`}>
          {name && <span class={`dlg-name${side === 'right' ? ' right' : ''}`}>{name}</span>}
          {/* The rest of the line is laid out but hidden, so the box keeps its size while the text types. */}
          <p class="dlg-text">
            <span aria-hidden="true">{full.slice(0, shown)}</span>
            <span class="dlg-rest" aria-hidden="true">
              {full.slice(shown)}
            </span>
            <span class="visually-hidden">{full}</span>
          </p>
          <button type="button" class={`dlg-next${complete ? ' ready' : ''}`} aria-label="Next line" onClick={next}>
            <span aria-hidden="true">▼</span>
          </button>
        </div>
      )}
      <div class={`dlg-fade${st.dark ? ' dark' : ''}`} aria-hidden="true" />
      {flash > 0 && <div key={flash} class="dlg-flash" aria-hidden="true" />}
      {logOpen && <SceneLog st={st} speakers={speakers} text={text} onClose={() => setLogOpen(false)} />}
      {askSkip && (
        <div class="dlg-ask" role="alertdialog" aria-label="Skip this scene?">
          <div class="dlg-ask-box framed">
            <p>Skip this scene?</p>
            <p class="dlg-ask-detail">{st.log.length > 0 ? 'The Log keeps every line. ' : ''}A choice still stops the skip.</p>
            <div class="dlg-row">
              <button type="button" class="btn quiet" onClick={() => setAskSkip(false)}>
                Keep reading
              </button>
              <button
                type="button"
                class="btn primary"
                onClick={() => {
                  setAskSkip(false);
                  setSt((s) => skipToChoice(scene, s, ctx));
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PortraitSlot(props: {
  slot: Slot | null;
  side: Side;
  speaking: Side | null;
  look: McLook;
  speakers: DialogueProps['speakers'];
  text: TextContext;
}): JSX.Element | null {
  const { slot, side } = props;
  if (!slot) return null;
  const sheet = props.speakers[slot.speaker]?.portrait ?? null;
  const label = `${speakerName(slot.speaker, props.speakers, props.text)}, ${slot.expr}`;
  const cls = `dlg-portrait ${side}${props.speaking === side ? ' speaking' : ' dim'}`;
  if (sheet === 'mc') {
    return (
      <div class={cls} key={`${side}-mc`}>
        <McPortrait look={props.look} expr={slot.expr} size={384} label={label} class="dlg-img" />
      </div>
    );
  }
  const art = sheet ? speakerPortraitId(sheet, slot.expr) : null;
  const url = art ? imageUrl(art) : undefined;
  return (
    <div class={cls} key={`${side}-${slot.speaker}`}>
      {url ? <img class="dlg-img" src={url} alt={label} draggable={false} decoding="async" /> : <Silhouette label={label} />}
    </div>
  );
}

/** Head and shoulders in shadow, for a speaker with no portrait yet. */
function Silhouette({ label }: { label: string }): JSX.Element {
  return (
    <svg class="dlg-img dlg-silhouette" viewBox="0 0 384 384" role="img" aria-label={label}>
      <path d="M192 70c-44 0-74 34-74 82 0 34 16 62 40 76-62 12-110 52-122 156h312c-12-104-60-144-122-156 24-14 40-42 40-76 0-48-30-82-74-82z" />
    </svg>
  );
}

function SceneLog(props: { st: SceneState; speakers: DialogueProps['speakers']; text: TextContext; onClose: () => void }): JSX.Element {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, []);
  return (
    <div class="dlg-log" role="dialog" aria-modal="true" aria-label="Scene log">
      <div class="dlg-log-box framed">
        <p class="dlg-log-title">Log</p>
        <ol class="dlg-log-list" ref={list}>
          {props.st.log.map((e, i) => {
            const voice = props.speakers[e.speaker]?.voice;
            const who = e.choice ? 'You chose' : voice ? '' : speakerName(e.speaker, props.speakers, props.text);
            return (
              <li key={i} class={`${voice ? `voice-${voice}` : ''}${e.choice ? ' choice' : ''}`}>
                {who && <span class="dlg-log-who">{who}</span>}
                <span class="dlg-log-text">{resolveText(e.text, props.text)}</span>
              </li>
            );
          })}
        </ol>
        <button type="button" class="btn primary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

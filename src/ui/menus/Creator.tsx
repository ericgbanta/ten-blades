// The character creator: a live portrait and map token at the top, the options below in four tabs (Look, Hair,
// Face, Style). Tapping the portrait cycles the expression. Options come from src/data/looks.json.

import { useState } from 'preact/hooks';
import { lookOptions, type ColorOption, type LookKey, type McExpression, type McLook } from '../../art/mc/look';
import { MC_STYLES } from '../../save/format';
import { McPortrait, McToken } from '../mc/McPicture';
import { Choices } from './Screen';
import { STYLE_TEXT, styleSchool } from './copy';
import { nextExpression, randomized, withLook, withMc, type NewGameDraft } from './newGameDraft';

type Tab = 'look' | 'hair' | 'face' | 'style';
const TABS: readonly { id: Tab; name: string }[] = [
  { id: 'look', name: 'Look' },
  { id: 'hair', name: 'Hair' },
  { id: 'face', name: 'Face' },
  { id: 'style', name: 'Style' },
];

const EXPRESSION_TEXT: Record<McExpression, string> = { neutral: 'calm', angry: 'angry', hurt: 'hurt', smile: 'smiling' };

interface Props {
  draft: NewGameDraft;
  set: (f: (d: NewGameDraft) => NewGameDraft) => void;
}

export function Creator({ draft, set }: Props) {
  const [tab, setTab] = useState<Tab>('look');
  const [expr, setExpr] = useState<McExpression>('neutral');
  const look = draft.mc.look;
  const setLook = (patch: Partial<McLook>) => set((d) => withLook(d, patch));
  const field = (key: LookKey, label: string, cols: number) => (
    <OptionGroup label={label} cols={cols} value={look[key]} options={lookOptions(key)} onChange={(v) => setLook({ [key]: v })} />
  );
  const colors = (key: 'skin' | 'hairColor' | 'accent', label: string) => (
    <Swatches label={label} value={look[key]} options={lookOptions(key) as readonly ColorOption[]} onChange={(v) => setLook({ [key]: v })} />
  );
  return (
    <div class="creator">
      <div class="creator-preview">
        <button
          type="button"
          class="creator-portrait"
          onClick={() => setExpr(nextExpression)}
          aria-label={`Portrait, ${EXPRESSION_TEXT[expr]}. Tap to change the expression.`}
        >
          <McPortrait look={look} expr={expr} size={152} label={`Your hero, ${EXPRESSION_TEXT[expr]}`} />
        </button>
        <div class="creator-side">
          <McToken look={look} style={draft.mc.style} size={88} label={`Map token, ${STYLE_TEXT[draft.mc.style].name}`} class="creator-token" />
          <button type="button" class="btn quiet creator-random" onClick={() => set((d) => randomized(d, Date.now()))}>
            Randomize
          </button>
        </div>
      </div>
      <div class="creator-main">
        <div class="creator-tabs" role="tablist" aria-label="Creator sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`creator-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="creator-panel"
              class={`creator-tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div class="creator-panel" role="tabpanel" id="creator-panel" aria-labelledby={`creator-tab-${tab}`}>
          {tab === 'look' && (
            <>
              {field('body', 'Body type', 2)}
              {colors('skin', 'Skin tone')}
            </>
          )}
          {tab === 'hair' && (
            <>
              {field('hairStyle', 'Hair style', 4)}
              {colors('hairColor', 'Hair color')}
            </>
          )}
          {tab === 'face' && (
            <>
              {field('eyes', 'Eyes', 3)}
              {field('scar', 'Scar or marking', 3)}
            </>
          )}
          {tab === 'style' && (
            <>
              <Choices
                label="Combat style"
                value={draft.mc.style}
                options={MC_STYLES.map((s) => ({ value: s, name: STYLE_TEXT[s].name, tag: styleSchool(s), line: STYLE_TEXT[s].feel }))}
                onChange={(style) => set((d) => withMc(d, { style }))}
              />
              {colors('accent', 'Outfit accent')}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OptionGroup(props: { label: string; cols: number; value: string; options: readonly { id: string; name: string }[]; onChange: (v: string) => void }) {
  return (
    <fieldset class="opts">
      <legend>{props.label}</legend>
      <div class="opt-grid" role="radiogroup" aria-label={props.label} style={{ gridTemplateColumns: `repeat(${props.cols}, minmax(0, 1fr))` }}>
        {props.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === props.value}
            class={`opt${o.id === props.value ? ' on' : ''}`}
            onClick={() => props.onChange(o.id)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Swatches(props: { label: string; value: string; options: readonly ColorOption[]; onChange: (v: string) => void }) {
  const current = props.options.find((o) => o.id === props.value);
  return (
    <fieldset class="opts">
      <legend>
        {props.label}
        {current && <span class="opts-value">{current.name}</span>}
      </legend>
      <div class="swatches" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === props.value}
            aria-label={o.name}
            title={o.name}
            class={`swatch${o.id === props.value ? ' on' : ''}`}
            style={{ background: `linear-gradient(135deg, ${o.base} 0 58%, ${o.shadow} 58% 100%)` }}
            onClick={() => props.onChange(o.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}

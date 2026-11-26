// The UI kit: hands the kit images to CSS, and small pieces every screen shares (icons, the portrait
// medallion). The art comes through the manifest; anything missing falls back to a plain CSS shape.

import type { JSX } from 'preact';
import { imageMeta, imageUrl, type ArtEntry } from '../art/manifest';
import type { McLook } from '../art/mc/look';
import type { Team, Unit } from '../core';
import { portraitId, type IconName } from './artMap';
import { McFace } from './mc/McPicture';

export { WEAPON_ICON, portraitId, schoolIcon, weaponIcon, type IconName } from './artMap';

/** Kit entries carry 9-slice data in the manifest. */
type KitEntry = ArtEntry & { slice?: number[]; hole?: number[] };

/** CSS variable name for each kit image id. */
const KIT_VARS: Record<string, string> = {
  'ui.frame': 'frame',
  'ui.button': 'plate',
  'ui.button_primary': 'plate-primary',
  'ui.ribbon': 'ribbon',
  'ui.medallion': 'medallion',
  'ui.divider': 'divider',
  'ui.emblem': 'emblem',
  'backdrop.village': 'backdrop',
};

/** Sets --kit-<name> (url) and --kit-<name>-slice on the root for every kit image the manifest has. */
export function installKit(root: HTMLElement = document.documentElement): void {
  for (const [id, name] of Object.entries(KIT_VARS)) {
    const url = imageUrl(id);
    if (!url) continue;
    root.style.setProperty(`--kit-${name}`, `url("${url}")`);
    const meta = imageMeta(id) as KitEntry | undefined;
    if (meta?.slice) root.style.setProperty(`--kit-${name}-slice`, meta.slice.join(' '));
    if (meta?.hole) {
      // Inset of the portrait circle under the ring, as a percent of the medallion (a little under the ring).
      const [, , r] = meta.hole;
      root.style.setProperty(`--kit-${name}-inset`, `${(((meta.width / 2 - r!) / meta.width) * 100 - 1).toFixed(1)}%`);
    }
  }
  root.classList.add('kit');
}

// ---- icons ------------------------------------------------------------------------------------------------------

/**
 * An icon from the manifest (`icon.<name>`). Decorative unless `label` is given, in which case it is an image
 * with that name. A missing icon draws a small disc with the label's first letter.
 */
export function Icon(props: { name: IconName; size?: number; label?: string; class?: string }): JSX.Element {
  const size = props.size ?? 18;
  const url = imageUrl(`icon.${props.name}`);
  const cls = `icon${props.class ? ` ${props.class}` : ''}`;
  if (!url) {
    return (
      <span
        class={`${cls} icon-missing`}
        style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.6)}px` }}
        role={props.label ? 'img' : undefined}
        aria-label={props.label}
        aria-hidden={props.label ? undefined : 'true'}
      >
        {(props.label ?? props.name).charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      class={cls}
      src={url}
      width={size}
      height={size}
      alt={props.label ?? ''}
      aria-hidden={props.label ? undefined : 'true'}
      draggable={false}
      decoding="async"
    />
  );
}

// ---- portraits --------------------------------------------------------------------------------------------------

/**
 * A round portrait in the iron medallion. The main character (a player lord with a look) shows their composed
 * face; other units their neutral portrait, cut to the face; anyone else a disc with their initial.
 */
export function Medallion(props: { unit: Unit; look?: McLook; size: number; class?: string }): JSX.Element {
  const { unit, look, size } = props;
  const mc = look && unit.isLord && unit.team === 'player';
  const pid = mc ? null : portraitId(unit);
  const url = pid ? imageUrl(pid) : undefined;
  const label = `${unit.name}'s portrait`;
  return (
    <span class={`medal team-${unit.team}${props.class ? ` ${props.class}` : ''}`} style={{ width: `${size}px`, height: `${size}px` }}>
      <span class="medal-face">
        {mc ? (
          <McFace look={look} size={size} label={label} class="medal-img" />
        ) : url ? (
          <img class="medal-img bust" src={url} alt={label} draggable={false} decoding="async" />
        ) : (
          <span class="medal-initial" role="img" aria-label={label}>
            {unit.name.charAt(0)}
          </span>
        )}
      </span>
    </span>
  );
}

/** Team color class for text, for places that show a unit's name. */
export function teamClass(team: Team): string {
  return `team-${team}`;
}

/** The bone-gold divider with its sword ornament (CSS lines stretch it to the width it is given). */
export function Divider(props: { class?: string }): JSX.Element {
  return <div class={`divider${props.class ? ` ${props.class}` : ''}`} role="presentation" />;
}

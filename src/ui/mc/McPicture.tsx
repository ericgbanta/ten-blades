// Draws a composed main character picture (src/art/mc/compose.ts) into a canvas element. The previous picture
// stays up until the next one is ready, so changing the look never flashes an empty box.

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { imageMeta } from '../../art/manifest';
import { composeMcPortrait, composeMcPose, composeMcToken, MC_CANVAS, paintMc } from '../../art/mc/compose';
import { lookKey, type McExpression, type McLook, type McPose } from '../../art/mc/look';

/** Part of the source canvas to show: [x, y, w, h]. */
export type Crop = [number, number, number, number];

interface PictureProps {
  /** Makes the picture; called again whenever `sourceKey` changes. */
  source: () => Promise<HTMLCanvasElement>;
  sourceKey: string;
  crop: Crop;
  /** CSS size of the element. */
  width: number;
  height: number;
  label: string;
  class?: string;
  onDrawn?: (ms: number) => void;
}

export function McPicture(props: PictureProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const { source, sourceKey, crop, onDrawn } = props;
  useEffect(() => {
    let live = true;
    const t0 = performance.now();
    source()
      .then((src) => {
        const c = ref.current;
        if (!live || !c) return;
        const [x, y, w, h] = crop;
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
        paintMc(c.getContext('2d')!, src, x, y, w, h);
        onDrawn?.(performance.now() - t0);
      })
      .catch((e: unknown) => console.warn('MC picture failed', e));
    return () => {
      live = false;
    };
    // `source` changes identity every render; the key says when the picture really changes.
  }, [sourceKey, crop.join(',')]);
  return (
    <canvas
      ref={ref}
      class={props.class}
      width={crop[2]}
      height={crop[3]}
      style={{ width: `${props.width}px`, height: `${props.height}px` }}
      role="img"
      aria-label={props.label}
    />
  );
}

const FULL_PORTRAIT: Crop = [0, 0, MC_CANVAS.portrait.w, MC_CANVAS.portrait.h];

export function McPortrait(props: { look: McLook; expr?: McExpression; size: number; label: string; class?: string; onDrawn?: (ms: number) => void }) {
  const expr = props.expr ?? 'neutral';
  return (
    <McPicture
      source={() => composeMcPortrait(props.look, expr)}
      sourceKey={`${lookKey(props.look)}|${expr}`}
      crop={FULL_PORTRAIT}
      width={props.size}
      height={props.size}
      label={props.label}
      class={props.class}
      onDrawn={props.onDrawn}
    />
  );
}

/** A square around the face of a body's portrait, for small heads (the unit card). */
export function faceCrop(look: McLook): Crop {
  const r = imageMeta(`mc.${look.body}.face.${look.eyes}.neutral`)?.layer?.rect;
  if (!r) return [96, 16, 192, 192];
  const side = Math.round(Math.max(r[2], r[3]) * 0.92);
  const cx = r[0] + r[2] / 2;
  const x = Math.max(0, Math.min(MC_CANVAS.portrait.w - side, Math.round(cx - side / 2)));
  const y = Math.max(0, Math.min(MC_CANVAS.portrait.h - side, r[1] - Math.round(side * 0.08)));
  return [x, y, side, side];
}

export function McFace(props: { look: McLook; size: number; label: string; class?: string }) {
  return (
    <McPicture
      source={() => composeMcPortrait(props.look, 'neutral')}
      sourceKey={lookKey(props.look)}
      crop={faceCrop(props.look)}
      width={props.size}
      height={props.size}
      label={props.label}
      class={props.class}
    />
  );
}

const FULL_TOKEN: Crop = [0, 0, MC_CANVAS.token.w, MC_CANVAS.token.h];

export function McToken(props: { look: McLook; style: string; size: number; label: string; class?: string; onDrawn?: (ms: number) => void }) {
  return (
    <McPicture
      source={() => composeMcToken(props.look, props.style)}
      sourceKey={`${lookKey(props.look)}|${props.style}`}
      crop={FULL_TOKEN}
      width={props.size}
      height={props.size}
      label={props.label}
      class={props.class}
      onDrawn={props.onDrawn}
    />
  );
}

/** The part of the 512 x 384 pose canvas a figure uses. */
const POSE_CROP: Crop = [24, 48, 488, 336];

export function McPoseView(props: { look: McLook; style: string; pose: McPose; width: number; label: string; class?: string }) {
  return (
    <McPicture
      source={() => composeMcPose(props.look, props.style, props.pose)}
      sourceKey={`${lookKey(props.look)}|${props.style}|${props.pose}`}
      crop={POSE_CROP}
      width={props.width}
      height={Math.round((props.width * POSE_CROP[3]) / POSE_CROP[2])}
      label={props.label}
      class={props.class}
    />
  );
}

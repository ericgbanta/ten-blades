// Camera math for the map, kept free of Phaser so it can be unit tested.
// The camera has its origin at the top left: screen = (world - scroll) * zoom.
// Screen values here are canvas pixels (CSS pixels times the device pixel ratio).

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface View {
  /** Canvas size. */
  width: number;
  height: number;
  /** Canvas pixels covered by overlays on each side. */
  insets: Insets;
}

export interface CameraPose {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

/** Allowed scroll on one axis: the map fills the free span, or sits anywhere inside it if smaller. */
function clampAxis(scroll: number, zoom: number, mapLen: number, lo: number, hi: number): number {
  const a = lo === 0 ? 0 : -lo / zoom; // map start at the free span's start (no -0)
  const b = mapLen - hi / zoom; // map end at the free span's end
  return Math.min(Math.max(scroll, Math.min(a, b)), Math.max(a, b));
}

/** Keep the map inside the uncovered part of the view. */
export function clampPose(pose: CameraPose, mapW: number, mapH: number, view: View): CameraPose {
  const { width, height, insets } = view;
  return {
    zoom: pose.zoom,
    scrollX: clampAxis(pose.scrollX, pose.zoom, mapW, insets.left, width - insets.right),
    scrollY: clampAxis(pose.scrollY, pose.zoom, mapH, insets.top, height - insets.bottom),
  };
}

/** Zoom to `zoom` keeping the world point under the screen point (sx, sy) fixed. */
export function zoomAround(pose: CameraPose, zoom: number, sx: number, sy: number): CameraPose {
  const wx = sx / pose.zoom + pose.scrollX;
  const wy = sy / pose.zoom + pose.scrollY;
  return { zoom, scrollX: wx - sx / zoom, scrollY: wy - sy / zoom };
}

/** Center the map in the uncovered part of the view. */
export function centerPose(zoom: number, mapW: number, mapH: number, view: View): CameraPose {
  const { width, height, insets } = view;
  const cx = (insets.left + width - insets.right) / 2;
  const cy = (insets.top + height - insets.bottom) / 2;
  return { zoom, scrollX: mapW / 2 - cx / zoom, scrollY: mapH / 2 - cy / zoom };
}

/**
 * The smallest scroll change that brings the world rectangle (x, y, w, h) inside the
 * uncovered view with `margin` canvas pixels to spare. Unchanged if already inside.
 */
export function revealRect(pose: CameraPose, x: number, y: number, w: number, h: number, view: View, margin: number): CameraPose {
  const { width, height, insets } = view;
  const axis = (scroll: number, start: number, len: number, lo: number, hi: number): number => {
    const viewStart = scroll + (lo + margin) / pose.zoom;
    const viewEnd = scroll + (hi - margin) / pose.zoom;
    if (viewEnd - viewStart < len) return start + len / 2 - (lo + hi) / 2 / pose.zoom;
    if (start < viewStart) return scroll - (viewStart - start);
    if (start + len > viewEnd) return scroll + (start + len - viewEnd);
    return scroll;
  };
  return {
    zoom: pose.zoom,
    scrollX: axis(pose.scrollX, x, w, insets.left, width - insets.right),
    scrollY: axis(pose.scrollY, y, h, insets.top, height - insets.bottom),
  };
}

/** Default tile size in CSS pixels: fit the map if that keeps tiles at least `min`, capped at `max`. */
export function defaultTileCss(cols: number, rows: number, cssW: number, cssH: number, min: number, max: number): number {
  const fit = Math.min(cssW / cols, cssH / rows);
  return Math.max(min, Math.min(max, Math.floor(fit)));
}

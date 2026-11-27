import type { Insets } from '../../game/camera';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How much of each side of the viewport the overlay boxes cover. Wide boxes are
 * top or bottom bars; narrow ones are side columns (the landscape dock). `safe` is the
 * device's safe-area insets, which count as covered on their own.
 */
export function coveredInsets(vw: number, vh: number, boxes: Box[], safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 }): Insets {
  // The safe areas (notch, home indicator) count as covered too, so no tile rests under them.
  const out: Insets = { ...safe };
  for (const b of boxes) {
    const w = b.right - b.left;
    if (w <= 0 || b.bottom - b.top <= 0) continue;
    if (w >= vw * 0.6) {
      if ((b.top + b.bottom) / 2 < vh / 2) out.top = Math.max(out.top, b.bottom);
      else out.bottom = Math.max(out.bottom, vh - b.top);
    } else if ((b.left + b.right) / 2 > vw / 2) out.right = Math.max(out.right, vw - b.left);
    else out.left = Math.max(out.left, b.right);
  }
  return out;
}

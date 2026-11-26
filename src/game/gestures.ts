// Turns raw pointer events into tap, pan and pinch gestures. A press only counts
// as a tap if it never moved past the threshold and no second finger joined, so
// panning never selects a tile. Free of Phaser so it can be unit tested.

export type Gesture =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'pan'; dx: number; dy: number }
  /** Scale relative to the previous pinch step, around the fingers' midpoint, plus its drift. */
  | { kind: 'pinch'; scale: number; cx: number; cy: number; dx: number; dy: number };

interface Point {
  x: number;
  y: number;
}

export class GestureTracker {
  private pointers = new Map<number, Point>();
  private start: Point = { x: 0, y: 0 };
  private tapPossible = false;
  private dragging = false;
  private pinch: { dist: number; mid: Point } | null = null;

  /** `threshold` is how far, in the same units as the points, a press may wander and still be a tap. */
  constructor(private readonly threshold: number) {}

  down(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y });
    if (this.pointers.size === 1) {
      this.start = { x, y };
      this.tapPossible = true;
      this.dragging = false;
      this.pinch = null;
    } else {
      this.tapPossible = false;
      this.pinch = this.pinchShape();
    }
  }

  move(id: number, x: number, y: number): Gesture | null {
    const prev = this.pointers.get(id);
    if (!prev) return null;
    this.pointers.set(id, { x, y });
    if (this.pointers.size === 1) {
      if (!this.dragging) {
        if (Math.hypot(x - this.start.x, y - this.start.y) <= this.threshold) return null;
        this.dragging = true;
        this.tapPossible = false;
        return { kind: 'pan', dx: x - this.start.x, dy: y - this.start.y };
      }
      return { kind: 'pan', dx: x - prev.x, dy: y - prev.y };
    }
    const now = this.pinchShape();
    const last = this.pinch;
    this.pinch = now;
    if (!now || !last || last.dist === 0) return null;
    return { kind: 'pinch', scale: now.dist / last.dist, cx: now.mid.x, cy: now.mid.y, dx: now.mid.x - last.mid.x, dy: now.mid.y - last.mid.y };
  }

  /** Release a pointer. Returns a tap when the press qualifies. `cancel` never taps. */
  up(id: number, x: number, y: number, cancel = false): Gesture | null {
    if (!this.pointers.has(id)) return null;
    this.pointers.delete(id);
    const remaining = this.pointers.size;
    if (remaining === 0) {
      const tap = this.tapPossible && !cancel;
      this.tapPossible = false;
      this.pinch = null;
      return tap ? { kind: 'tap', x, y } : null;
    }
    // A finger lifted from a pinch: keep panning with the others, never tap.
    this.dragging = true;
    this.pinch = this.pinchShape();
    return null;
  }

  private pinchShape(): { dist: number; mid: Point } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
}

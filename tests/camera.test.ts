import { describe, expect, it } from 'vitest';
import { centerOn, centerPose, clampPose, defaultTileCss, revealRect, zoomAround, NO_INSETS, type View } from '../src/game/camera';
import { GestureTracker } from '../src/game/gestures';
import { coveredInsets } from '../src/ui/battle/insets';

const view: View = { width: 400, height: 600, insets: { top: 50, right: 0, bottom: 100, left: 0 } };

describe('camera math', () => {
  it('keeps a large map filling the free area', () => {
    // Map 800 x 1000 world units at zoom 1.
    expect(clampPose({ zoom: 1, scrollX: -300, scrollY: -300 }, 800, 1000, view)).toEqual({ zoom: 1, scrollX: 0, scrollY: -50 });
    expect(clampPose({ zoom: 1, scrollX: 900, scrollY: 900 }, 800, 1000, view)).toEqual({ zoom: 1, scrollX: 400, scrollY: 500 });
  });

  it('lets a small map slide but never leave the free area', () => {
    const p = clampPose({ zoom: 1, scrollX: -50, scrollY: 0 }, 200, 200, view);
    expect(p.scrollX).toBe(-50);
    expect(clampPose({ zoom: 1, scrollX: 500, scrollY: 0 }, 200, 200, view).scrollX).toBe(0);
    expect(clampPose({ zoom: 1, scrollX: -500, scrollY: 0 }, 200, 200, view).scrollX).toBe(-200);
  });

  it('zooms around a fixed screen point', () => {
    const p = zoomAround({ zoom: 1, scrollX: 0, scrollY: 0 }, 2, 100, 100);
    expect(p).toEqual({ zoom: 2, scrollX: 50, scrollY: 50 });
  });

  it('centers in the free area and reveals hidden rectangles with the least scroll', () => {
    const c = centerPose(1, 400, 400, view);
    expect(c).toEqual({ zoom: 1, scrollX: 0, scrollY: -75 });
    const pose = { zoom: 1, scrollX: 0, scrollY: 0 };
    // A tile at y 460 to 524 sits under the bottom overlay (free area ends at 500).
    expect(revealRect(pose, 100, 460, 64, 64, view, 10).scrollY).toBe(34);
    expect(revealRect(pose, 100, 100, 64, 64, view, 10)).toEqual(pose);
    expect(revealRect({ zoom: 1, scrollX: 0, scrollY: 100 }, 100, 100, 64, 64, view, 10).scrollY).toBe(40);
  });

  it('picks a default tile size of at least the minimum', () => {
    expect(defaultTileCss(10, 12, 375, 550, 46, 64)).toBe(46);
    expect(defaultTileCss(10, 12, 1200, 1000, 46, 64)).toBe(64);
    expect(defaultTileCss(10, 12, 600, 660, 46, 64)).toBe(55);
    expect(NO_INSETS.top).toBe(0);
  });

  it('fits a 10 to 12 column map to a phone width at 36 px or more, else falls back to 44 px', () => {
    // The prologue on a 375 x 667 phone with the bars at rest: the whole map fits.
    expect(defaultTileCss(10, 12, 375, 554, 36, 64, 44)).toBe(37);
    // 11 columns at 430 wide fit the width but not the height: the player pans up and down.
    expect(defaultTileCss(11, 20, 430, 600, 36, 64, 44)).toBe(39);
    // 12 columns at 430 wide would be 35.8 px: too small, so 44 px.
    expect(defaultTileCss(12, 20, 430, 760, 36, 64, 44)).toBe(44);
    // 14 columns cannot fit at 36 px on a 375 px phone.
    expect(defaultTileCss(14, 18, 375, 554, 36, 64, 44)).toBe(44);
  });

  it('centers a world point in the uncovered view', () => {
    const p = centerOn(2, 300, 400, view);
    expect(p).toEqual({ zoom: 2, scrollX: 300 - 200 / 2, scrollY: 400 - 275 / 2 });
  });
});

describe('GestureTracker', () => {
  it('taps when the press stays inside the threshold', () => {
    const g = new GestureTracker(10);
    g.down(1, 100, 100);
    expect(g.move(1, 104, 103)).toBeNull();
    expect(g.up(1, 104, 103)).toEqual({ kind: 'tap', x: 104, y: 103 });
  });

  it('pans past the threshold and then never taps', () => {
    const g = new GestureTracker(10);
    g.down(1, 100, 100);
    expect(g.move(1, 120, 100)).toEqual({ kind: 'pan', dx: 20, dy: 0 });
    expect(g.move(1, 125, 98)).toEqual({ kind: 'pan', dx: 5, dy: -2 });
    expect(g.up(1, 125, 98)).toBeNull();
  });

  it('pinches with two fingers and does not tap when they lift', () => {
    const g = new GestureTracker(10);
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    const p = g.move(2, 300, 100);
    expect(p).toMatchObject({ kind: 'pinch', scale: 2, cx: 200, cy: 100 });
    expect(g.up(2, 300, 100)).toBeNull();
    expect(g.move(1, 110, 100)).toEqual({ kind: 'pan', dx: 10, dy: 0 });
    expect(g.up(1, 110, 100)).toBeNull();
  });

  it('ignores moves without a press and cancelled presses', () => {
    const g = new GestureTracker(10);
    expect(g.move(0, 5, 5)).toBeNull();
    g.down(1, 0, 0);
    expect(g.up(1, 0, 0, true)).toBeNull();
  });
});

describe('coveredInsets', () => {
  it('reads wide boxes as top and bottom bars and narrow ones as side columns', () => {
    const portrait = coveredInsets(375, 667, [
      { left: 0, top: 0, right: 375, bottom: 57 },
      { left: 0, top: 500, right: 375, bottom: 667 },
    ]);
    expect(portrait).toEqual({ top: 57, right: 0, bottom: 167, left: 0 });
    const landscape = coveredInsets(667, 375, [
      { left: 0, top: 0, right: 667, bottom: 57 },
      { left: 367, top: 57, right: 667, bottom: 375 },
      { left: 0, top: 0, right: 0, bottom: 0 },
    ]);
    expect(landscape).toEqual({ top: 57, right: 300, bottom: 0, left: 0 });
  });

  it('counts the safe areas as covered: the notch side and the home indicator in landscape', () => {
    const boxes = [
      { left: 0, top: 0, right: 667, bottom: 57 },
      { left: 367, top: 57, right: 667, bottom: 375 },
    ];
    expect(coveredInsets(667, 375, boxes, { top: 0, right: 47, bottom: 21, left: 47 })).toEqual({ top: 57, right: 300, bottom: 21, left: 47 });
  });
});

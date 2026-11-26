#!/usr/bin/env python3
"""Cut the UI kit and the icon sheets out of their green background and pack them as WebP into src/art.

Usage:  python3 tools/art/pack_ui.py <raw_dir> [kit] [icons]

<raw_dir> holds the raw generated PNGs: ui-kit.png (3x2), icons-stats.png (4x3) and icons-items.png (4x3). With no
names both groups are packed. Keying and splitting reuse tools/art/pack.py. Writes src/art/ui and src/art/icons,
merges the `ui.*` and `icon.*` entries into src/art/assets.json (nothing else in it is touched) and writes a
report, tools/art/packed-ui.json.

The panel frame is rebuilt for CSS border-image: the four corners are cut from the generated frame and each edge
is made from one clean stretch of that side (between the corner plate and the middle rivet), mirrored so it tiles
without a seam. The generated edges carry a rivet in the middle, so they cannot be stretched or repeated as they
are. Every 9-slice entry carries `slice` ([top, right, bottom, left] in image px, as border-image-slice takes it).
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pack import ART, alpha_bbox, key, paste, resize, save_webp, split_cells  # noqa: E402

STAT_ICONS = ['hp', 'str', 'mag', 'skl', 'spd', 'lck', 'def', 'res', 'mov', 'heavy', 'swift', 'arcane']
ITEM_ICONS = ['greatsword', 'axe', 'lance', 'sabre', 'dagger', 'bow', 'tome', 'talisman', 'staff', 'shard', 'coins', 'tenblade']
ICON = 96          # square icon canvas; the UI shows icons at 16 to 28 CSS px
ICON_PAD = 2       # px left around the icon on that canvas (tight, so the emblem stays big at 20 px)
EMBLEM = 192       # the ten-blade star again, larger, for the title screen (ui.emblem)

# UI kit cells, reading order of the 3x2 sheet.
KIT = ['frame', 'button', 'button_primary', 'ribbon', 'medallion', 'divider']
# Also written: ui.emblem, the ten-blade star from the item icon sheet at EMBLEM px.

# Panel frame rebuild, in generated-image px (the generated frame is about 381 px square with a 42 px border).
FRAME_CORNER = 72          # corner plates reach about 68 px in from each side
FRAME_EDGE = (80, 170)     # a clean stretch of each side: after the corner plate, before the middle rivet
FRAME_SCALE = 0.6          # output scale; the frame shows at about 0.25 of the generated size
# Button plates: corners and the gold line sit inside these slices (generated px, then scaled).
BUTTON_SLICE = (40, 56, 40, 56)
BUTTON_SCALE = 0.5
RIBBON_SCALE = 0.6
RIBBON_ENDS = 128          # generated px of each forked end kept unstretched (the tail and the fold)
MEDALLION = 192
DIVIDER_H = 48


def crop_tight(rgba):
    x0, y0, x1, y1 = alpha_bbox(rgba)
    return rgba[y0:y1, x0:x1]


def entry_for(canvas, rel, extra=None):
    bx0, by0, bx1, by1 = alpha_bbox(canvas)
    e = {'path': rel, 'width': int(canvas.shape[1]), 'height': int(canvas.shape[0]), 'bbox': [bx0, by0, bx1 - bx0, by1 - by0]}
    if extra:
        e.update(extra)
    return e


def write(canvas, rel, iid, assets, report, extra=None):
    nbytes = save_webp(canvas, rel)
    e = entry_for(canvas, rel, extra)
    assets[iid] = e
    report[iid] = {**e, 'bytes': nbytes}


def scaled(rgba, k):
    h, w = rgba.shape[:2]
    return resize(rgba, (max(1, round(w * k)), max(1, round(h * k))))


# ---- icons ------------------------------------------------------------------------------------------------------
def pack_icons(raw, sheet, names, assets, report):
    path = os.path.join(raw, f'icons-{sheet}.png')
    if not os.path.exists(path):
        print(f'  missing {path}')
        return
    cells, _ = split_cells(key(path), 3, 4, name=f'icons-{sheet}')
    for name, cell in zip(names, cells):
        crop = crop_tight(cell)
        write(fit_square(crop, ICON, ICON_PAD), f'icons/{name}.webp', f'icon.{name}', assets, report)
        if name == 'tenblade':
            write(fit_square(crop, EMBLEM, 0), 'ui/emblem.webp', 'ui.emblem', assets, report)


def fit_square(crop, size, pad):
    """The item scaled to fill a size x size canvas (less pad on every side), centered."""
    h, w = crop.shape[:2]
    k = (size - 2 * pad) / max(w, h)
    small = resize(crop, (max(1, round(w * k)), max(1, round(h * k))))
    canvas = np.zeros((size, size, 4), np.float32)
    paste(canvas, small, (size - small.shape[1]) // 2, (size - small.shape[0]) // 2)
    return canvas


# ---- panel frame ------------------------------------------------------------------------------------------------
def seamless(strip, axis):
    """The strip followed by its mirror image along `axis`, so it repeats without a seam."""
    return np.concatenate([strip, np.flip(strip, axis=axis)], axis=axis)


def rebuild_frame(f):
    """A 9-slice frame from the generated one: corners kept, every edge rebuilt from a clean mirrored stretch."""
    s = f.shape[0]
    c = FRAME_CORNER
    a, b = FRAME_EDGE
    top = seamless(f[:c, a:b], 1)
    bottom = seamless(f[s - c:, a:b], 1)
    left = seamless(f[a:b, :c], 0)
    right = seamless(f[a:b, s - c:], 0)
    e = top.shape[1]
    n = 2 * c + e
    out = np.zeros((n, n, 4), np.float32)
    center = np.median(f[s // 2 - 40:s // 2 + 40, s // 2 - 40:s // 2 + 40].reshape(-1, 4), axis=0)
    out[:, :] = center
    out[:c, c:c + e] = top
    out[n - c:, c:c + e] = bottom
    out[c:c + e, :c] = left
    out[c:c + e, n - c:] = right
    out[:c, :c] = f[:c, :c]
    out[:c, n - c:] = f[:c, s - c:]
    out[n - c:, :c] = f[s - c:, :c]
    out[n - c:, n - c:] = f[s - c:, s - c:]
    return out, center


def pack_kit(raw, assets, report):
    path = os.path.join(raw, 'ui-kit.png')
    if not os.path.exists(path):
        print(f'  missing {path}')
        return
    cells, _ = split_cells(key(path), 2, 3, name='ui-kit')
    pieces = dict(zip(KIT, (crop_tight(c) for c in cells)))

    # Frame: square up the generated one first (it is a pixel or two off square), then rebuild.
    f = pieces['frame']
    side = min(f.shape[:2])
    f = resize(f, (side, side)) if f.shape[0] != f.shape[1] else f
    frame, center = rebuild_frame(f)
    frame = scaled(frame, FRAME_SCALE)
    c = round(FRAME_CORNER * FRAME_SCALE)
    hexc = '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in center[:3])
    write(frame, 'ui/frame.webp', 'ui.frame', assets, report, {'slice': [c, c, c, c], 'repeat': 'round', 'center': hexc})

    for name in ('button', 'button_primary'):
        p = scaled(pieces[name], BUTTON_SCALE)
        sl = [round(v * BUTTON_SCALE) for v in BUTTON_SLICE]
        write(p, f'ui/{name}.webp', f'ui.{name}', assets, report, {'slice': sl, 'repeat': 'stretch'})

    r = scaled(pieces['ribbon'], RIBBON_SCALE)
    e = round(RIBBON_ENDS * RIBBON_SCALE)
    write(r, 'ui/ribbon.webp', 'ui.ribbon', assets, report, {'slice': [0, e, 0, e], 'repeat': 'stretch'})

    # Medallion: square canvas, ring centered; record the hole (center and radius, canvas px) for the portrait clip.
    m = pieces['medallion']
    h, w = m.shape[:2]
    k = (MEDALLION - 2) / max(h, w)
    ms = resize(m, (round(w * k), round(h * k)))
    canvas = np.zeros((MEDALLION, MEDALLION, 4), np.float32)
    ox, oy = (MEDALLION - ms.shape[1]) // 2, (MEDALLION - ms.shape[0]) // 2
    paste(canvas, ms, ox, oy)
    hole = canvas[..., 3] < 0.5
    cy, cx = MEDALLION // 2, MEDALLION // 2
    rx = 0
    while cx + rx < MEDALLION and hole[cy, cx + rx]:
        rx += 1
    ry = 0
    while cy + ry < MEDALLION and hole[cy + ry, cx]:
        ry += 1
    write(canvas, 'ui/medallion.webp', 'ui.medallion', assets, report, {'hole': [cx, cy, min(rx, ry)]})

    d = pieces['divider']
    write(scaled(d, DIVIDER_H / d.shape[0]), 'ui/divider.webp', 'ui.divider', assets, report)


# ---- main -------------------------------------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw = sys.argv[1]
    names = set(sys.argv[2:])
    want = lambda k: not names or k in names
    assets_path = os.path.join(ART, 'assets.json')
    manifest = json.load(open(assets_path))
    assets, report = manifest.setdefault('images', {}), {}
    if want('icons'):
        print('icons stats')
        pack_icons(raw, 'stats', STAT_ICONS, assets, report)
        print('icons items')
        pack_icons(raw, 'items', ITEM_ICONS, assets, report)
    if want('kit'):
        print('ui kit')
        pack_kit(raw, assets, report)
    manifest['images'] = {k: assets[k] for k in sorted(assets)}
    with open(assets_path, 'w') as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write('\n')
    rp = os.path.join(HERE, 'packed-ui.json')
    full = json.load(open(rp)) if os.path.exists(rp) else {}
    full.update(report)
    with open(rp, 'w') as f:
        json.dump({k: full[k] for k in sorted(full)}, f, indent=1, sort_keys=True)
        f.write('\n')
    total = 0
    for k in sorted(report):
        r = report[k]
        total += r['bytes']
        print(f'{k:24} {r["width"]:>4}x{r["height"]:<4} {r["bytes"]:>7}')
    print(f'{len(report)} images, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()

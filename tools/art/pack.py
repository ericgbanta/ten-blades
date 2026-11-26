#!/usr/bin/env python3
"""Cut the generated art out of its flat green background and pack it as WebP into src/art.

Usage:  python3 tools/art/pack.py <raw_dir> [names...]

<raw_dir> holds the raw generated PNGs (see docs/ART_GENERATION.md). With no names every sheet found is
packed; names limit it to those characters (for example `archer stranger`) or sheet groups (`tokens`, `tiles`,
backdrops).
Needs numpy, scipy and Pillow. Writes src/art/battle, portraits, tokens, tiles and backdrops, merges the entries
into src/art/assets.json and writes tools/art/packed.json (a report of what was packed).
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
ART = os.path.join(REPO, 'src', 'art')

# ---- what each sheet holds -------------------------------------------------------------------------------------
NAMED = ['stranger', 'gravemaw', 'captain']
MILITIA = ['soldier', 'ranger', 'adept', 'medic']
IMPERIAL = ['legionary', 'hunter', 'inquisitor', 'archer']
LATE_NAMED = ['needles']             # named characters made after the first sheets; their token is a single image
SINGLE_BUSTS = ['adept']             # generic units whose bust was redone as a single image (bust-<id>.png)
SINGLE_TOKENS = ['needles', 'adept'] # tokens made as single images (token-<id>.png); these win over sheet cells
POSE_CHARS = NAMED + LATE_NAMED + MILITIA + IMPERIAL
POSES = ['idle', 'windup', 'strike', 'hit']        # 2x2 order: top-left, top-right, bottom-left, bottom-right
EXPRS = ['neutral', 'angry', 'hurt', 'smile']
# Map tokens are looked up by class id (src/game/MapScene.ts asks for token.<classId>).
TOKEN_ID = {'stranger': 'wanderer', 'captain': 'hunter_captain', 'gravemaw': 'gravemaw_bearer', 'needles': 'needles_bearer'}

# ---- fixed layout -----------------------------------------------------------------------------------------------
BATTLE_W, BATTLE_H = 512, 384     # one canvas for every battle pose of every character
GROUND_Y = 360                    # feet baseline on that canvas
ANCHOR_X = 192                    # feet center of the idle pose (characters face right, so weapons reach right)
IDLE_HEIGHT = {'needles': 205}                  # per character override of the idle body height in px; default below
DEFAULT_IDLE_HEIGHT = 240
PORTRAIT = 384                    # square portrait canvas
PORTRAIT_MARGIN = 8
TOKEN = 192                       # square token canvas
TOKEN_MARGIN = 8
TILE_ORDER = ['plain', 'road', 'forest', 'hill', 'fort', 'village', 'water', 'wall']   # 4x2 grid, reading order
TILE_SETS = ['village']           # tiles-<set>.png; the first set found supplies tile.<terrainId>
TILE_SIZE = 96                    # square tile canvas (the map draws it at about 46 CSS px, so 2x on a 2x screen)
TILE_INSET = 4                    # source px dropped from every edge of a tile rectangle (removes edge fringe)
BACKDROPS = ['village']           # backdrop-<name>.png
BACKDROP_SIZE = (1152, 768)
WEBP_QUALITY = 90


# ---- keying -----------------------------------------------------------------------------------------------------
def key(path):
    """Float RGBA array (H, W, 4, values 0..1) with the green removed.

    A pixel is green background by how much green exceeds both red and blue ("dom"). The art is dark ink and
    muted color with no real green, so dom is near 0 on the character and near 1 on the background. Edge pixels
    are a mix of art and pure green, so alpha = 1 - dom and the art color is unmixed from the green, which
    removes both halo and fringe. Enclosed pockets (between an arm and the body, inside a bow) are keyed when
    they reach strong green somewhere (peak dom above 0.5); a pale yellow-green glow never does.
    """
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    dom = g - np.maximum(r, b)
    loose = dom > 0.12
    lab, n = ndi.label(loose)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    idx = np.arange(1, n + 1)
    peaks = ndi.maximum(dom, lab, idx)
    is_bg = np.zeros(n + 1, bool)
    for i in idx:
        is_bg[i] = (i in border) or peaks[i - 1] > 0.5
    region = ndi.binary_dilation(is_bg[lab], iterations=1)
    alpha = np.clip(1 - dom / 0.95, 0, 1)
    alpha = np.where(region, alpha, 1.0)
    alpha = np.where(alpha > 0.96, 1.0, alpha)
    alpha = np.where(alpha < 0.04, 0.0, alpha)
    a = np.maximum(alpha, 1e-3)[..., None]
    spill = np.stack([np.zeros_like(g), np.ones_like(g), np.zeros_like(g)], -1)
    rgb = np.clip((im - (1 - a) * spill) / a, 0, 1)
    # Whatever green is left on a partly transparent edge pixel is spill: clamp it to the other channels.
    edge = (alpha > 0) & (alpha < 1)
    cap = np.maximum(rgb[..., 0], rgb[..., 2])
    rgb[..., 1] = np.where(edge, np.minimum(rgb[..., 1], cap), rgb[..., 1])
    rgb = np.where(alpha[..., None] > 0, rgb, 0)
    return np.dstack([rgb, alpha])


# ---- splitting a sheet into its items ---------------------------------------------------------------------------
def split_cells(rgba, rows, cols, min_area=40, name=''):
    """One RGBA array per grid cell, same size as the sheet, everything outside that cell's item cleared.

    Pieces are found as connected components of the keyed image (dilated a little so edge pixels and nearly
    touching bits stay together). A component belongs to the cell that holds most of it, even when it crosses a
    cell line, so a long weapon is not chopped and a detached arrow or smoke wisp stays with its character.
    A component that really straddles two cells (neighbors touching) is cut along the cell line instead.
    Returns (cells, mains): mains is each cell's largest component as a boolean mask.
    """
    h, w = rgba.shape[:2]
    alpha = rgba[..., 3]
    solid = alpha > 0.35
    lab, n = ndi.label(ndi.binary_dilation(solid, iterations=2))
    k = rows * cols
    cell_of = (np.minimum(np.arange(h)[:, None] * rows // h, rows - 1) * cols
               + np.minimum(np.arange(w)[None, :] * cols // w, cols - 1))
    area = np.bincount(lab[solid], minlength=n + 1)
    counts = np.bincount(lab[solid] * k + cell_of[solid], minlength=(n + 1) * k).reshape(n + 1, k)
    best = counts.argmax(axis=1)
    whole = counts.max(axis=1) >= 0.9 * np.maximum(area, 1)
    comp_owner = np.where(area >= min_area, best, -1)
    for i in np.nonzero((area > 0) & (area < min_area))[0]:
        print(f'  {name}: dropped a {area[i]} px speck')
    for i in np.nonzero((area >= min_area) & ~whole)[0]:
        print(f'  {name}: a piece of {area[i]} px straddles cells {np.nonzero(counts[i])[0].tolist()}, cut on the cell line')
    owner = comp_owner[lab]                       # whole components go to their cell
    split = (~whole)[lab] & (area[lab] >= min_area)
    owner = np.where(split, cell_of, owner)       # straddlers are cut on the cell line
    owner[lab == 0] = -1
    piece = np.where(owner >= 0, lab * k + owner, 0)
    pa = np.bincount(piece[solid & (owner >= 0)], minlength=(n + 1) * k).reshape(n + 1, k)
    cells, mains = [], []
    for c in range(k):
        out = rgba.copy()
        out[..., 3] = np.where(owner == c, alpha, 0)
        cells.append(out)
        mains.append(solid & (piece == int(pa[:, c].argmax()) * k + c) & (owner == c))
    return cells, mains


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def alpha_bbox(rgba, thr=0.03):
    return bbox(rgba[..., 3] > thr)


def resize(rgba, size):
    """Lanczos resize of a float RGBA array through premultiplied alpha, so edges do not pick up a color cast."""
    a = rgba[..., 3:4]
    pm = np.dstack([rgba[..., :3] * a, a])
    chans = [np.asarray(Image.fromarray(pm[..., k]).resize(size, Image.LANCZOS)) for k in range(4)]
    out = np.stack(chans, -1)
    al = np.clip(out[..., 3:4], 0, 1)
    rgb = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    return np.clip(np.dstack([rgb, al]), 0, 1)


def paste(canvas, img, x, y):
    """Alpha-over paste of a float RGBA array onto a float RGBA canvas at integer (x, y), clipped to the canvas."""
    h, w = img.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(canvas.shape[1], x + w), min(canvas.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    canvas[y0:y1, x0:x1] = img[y0 - y:y1 - y, x0 - x:x1 - x]


def save_webp(rgba, rel):
    path = os.path.join(ART, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    arr = (np.clip(rgba, 0, 1) * 255).round().astype(np.uint8)
    arr[arr[..., 3] == 0] = 0
    Image.fromarray(arr, 'RGBA').save(path, 'WEBP', quality=WEBP_QUALITY, method=4, alpha_quality=100)
    return os.path.getsize(path)


# ---- battle poses -----------------------------------------------------------------------------------------------
def feet_center(main, y_top, y_bot):
    """x of the middle of the feet: the horizontal span of the lowest 5 percent of the main piece."""
    rows = main[max(y_top, y_bot - max(6, int((y_bot - y_top) * 0.05))):y_bot]
    xs = np.nonzero(rows.any(axis=0))[0]
    return (xs.min() + xs.max() + 1) / 2


def pack_poses(raw, cid, report, assets):
    path = os.path.join(raw, f'poses-{cid}.png')
    if not os.path.exists(path):
        return
    cells, mains = split_cells(key(path), 2, 2, name=f'poses-{cid}')
    boxes = [alpha_bbox(c) for c in cells]
    ix0, iy0, ix1, iy1 = bbox(mains[0])
    idle_h = IDLE_HEIGHT.get(cid, DEFAULT_IDLE_HEIGHT)
    scale = idle_h / (iy1 - iy0)
    # Placement uses the main piece (the body), not the whole box, so a loose arrow cannot move the feet.
    for pose, cell, main, bb in zip(POSES, cells, mains, boxes):
        mx0, my0, mx1, my1 = bbox(main)
        fx = feet_center(main, my0, my1)
        crop = cell[bb[1]:bb[3], bb[0]:bb[2]]
        size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
        small = resize(crop, size)
        ox = round(ANCHOR_X - (fx - bb[0]) * scale)
        oy = round(GROUND_Y - (my1 - bb[1]) * scale)
        extent = {'left': ANCHOR_X - ox, 'right': ox + size[0] - ANCHOR_X, 'top': GROUND_Y - oy, 'below': oy + size[1] - GROUND_Y}
        if ox < 0 or oy < 0 or ox + size[0] > BATTLE_W or oy + size[1] > BATTLE_H:
            print(f'  WARNING {cid}-{pose} does not fit the canvas: {extent}')
        canvas = np.zeros((BATTLE_H, BATTLE_W, 4), np.float32)
        paste(canvas, small, ox, oy)
        nbytes = save_webp(canvas, f'battle/{cid}-{pose}.webp')
        bx0, by0, bx1, by1 = alpha_bbox(canvas)
        entry = {'path': f'battle/{cid}-{pose}.webp', 'width': BATTLE_W, 'height': BATTLE_H, 'groundY': GROUND_Y, 'anchorX': ANCHOR_X,
                 'bbox': [bx0, by0, bx1 - bx0, by1 - by0], 'scale': round(scale, 4)}
        assets[f'battle.{cid}.{pose}'] = entry
        report[f'battle.{cid}.{pose}'] = {**entry, 'bytes': nbytes, 'extent': extent}


# ---- portraits --------------------------------------------------------------------------------------------------
def fit_portrait(items):
    """items: {name: cell RGBA array}. The busts are cut flat at the bottom, so each is cropped tight and
    bottom-aligned and centered on the canvas, all at one scale (set by the largest of the four), which keeps
    the shoulders and the face in the same place from one expression to the next."""
    boxes = {n: alpha_bbox(c) for n, c in items.items()}
    mw = max(b[2] - b[0] for b in boxes.values())
    mh = max(b[3] - b[1] for b in boxes.values())
    inner = PORTRAIT - 2 * PORTRAIT_MARGIN
    k = min(inner / mw, inner / mh)
    out = {}
    for name, cell in items.items():
        b = boxes[name]
        w, h = round((b[2] - b[0]) * k), round((b[3] - b[1]) * k)
        canvas = np.zeros((PORTRAIT, PORTRAIT, 4), np.float32)
        paste(canvas, resize(cell[b[1]:b[3], b[0]:b[2]], (w, h)), (PORTRAIT - w) // 2, PORTRAIT - PORTRAIT_MARGIN - h)
        out[name] = canvas
    return out


def write_portrait(cid, expr, canvas, report, assets):
    nbytes = save_webp(canvas, f'portraits/{cid}-{expr}.webp')
    bx0, by0, bx1, by1 = alpha_bbox(canvas)
    entry = {'path': f'portraits/{cid}-{expr}.webp', 'width': PORTRAIT, 'height': PORTRAIT, 'bbox': [bx0, by0, bx1 - bx0, by1 - by0]}
    assets[f'portrait.{cid}.{expr}'] = entry
    report[f'portrait.{cid}.{expr}'] = {**entry, 'bytes': nbytes}


def pack_expr(raw, cid, report, assets):
    path = os.path.join(raw, f'expr-{cid}.png')
    if not os.path.exists(path):
        return
    cells, _ = split_cells(key(path), 2, 2, name=f'expr-{cid}')
    h, w = cells[0].shape[:2]
    # Slice each cell to its own grid square, so the union box is in cell coordinates (the same spot in every cell).
    local = [c[(i // 2) * (h // 2):(i // 2 + 1) * (h // 2), (i % 2) * (w // 2):(i % 2 + 1) * (w // 2)] for i, c in enumerate(cells)]
    for expr, canvas in fit_portrait(dict(zip(EXPRS, local))).items():
        write_portrait(cid, expr, canvas, report, assets)


def pack_busts(raw, sheet, ids, report, assets, single=False):
    path = os.path.join(raw, f'bust-{sheet}.png' if single else f'busts-{sheet}.png')
    if not os.path.exists(path):
        return
    cells, _ = split_cells(key(path), 1 if single else 2, 1 if single else 2, name=f'busts-{sheet}')
    # One scale for the whole sheet, so the four generic busts read as the same size next to each other.
    boxes = [alpha_bbox(c) for c in cells]
    inner = PORTRAIT - 2 * PORTRAIT_MARGIN
    k = min(min(inner / (b[2] - b[0]), inner / (b[3] - b[1])) for b in boxes)
    for cid, cell, b in zip(ids, cells, boxes):
        crop = cell[b[1]:b[3], b[0]:b[2]]
        w, h = round((b[2] - b[0]) * k), round((b[3] - b[1]) * k)
        canvas = np.zeros((PORTRAIT, PORTRAIT, 4), np.float32)
        paste(canvas, resize(crop, (w, h)), (PORTRAIT - w) // 2, PORTRAIT - PORTRAIT_MARGIN - h)
        write_portrait(cid, 'neutral', canvas, report, assets)


# ---- tokens -----------------------------------------------------------------------------------------------------
def pack_tokens(raw, sheet, ids, report, assets, single=False):
    path = os.path.join(raw, f'token-{sheet}.png' if single else f'tokens-{sheet}.png')
    if not os.path.exists(path):
        return
    cells, _ = split_cells(key(path), 1, len(ids), name=f'tokens-{sheet}')
    inner = TOKEN - 2 * TOKEN_MARGIN
    for cid, cell in zip(ids, cells):
        b = alpha_bbox(cell)
        crop = cell[b[1]:b[3], b[0]:b[2]]
        k = min(inner / (b[2] - b[0]), inner / (b[3] - b[1]))
        w, h = max(1, round((b[2] - b[0]) * k)), max(1, round((b[3] - b[1]) * k))
        canvas = np.zeros((TOKEN, TOKEN, 4), np.float32)
        paste(canvas, resize(crop, (w, h)), (TOKEN - w) // 2, TOKEN - TOKEN_MARGIN - h)
        tid = TOKEN_ID.get(cid, cid)
        nbytes = save_webp(canvas, f'tokens/{tid}.webp')
        bx0, by0, bx1, by1 = alpha_bbox(canvas)
        entry = {'path': f'tokens/{tid}.webp', 'width': TOKEN, 'height': TOKEN, 'bbox': [bx0, by0, bx1 - bx0, by1 - by0]}
        assets[f'token.{tid}'] = entry
        report[f'token.{tid}'] = {**entry, 'bytes': nbytes}


# ---- tiles and backdrops ----------------------------------------------------------------------------------------
def runs(flag):
    """[start, end) index runs where the 1-D boolean array is true."""
    d = np.diff(np.concatenate([[0], flag.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0].tolist(), np.nonzero(d == -1)[0].tolist()))


def pack_tiles(raw, tset, report, assets):
    """Terrain tiles from tiles-<tset>.png: a 4x2 grid of square tiles on #00ff00 green with green gaps.

    Tile rectangles are the runs of non-green columns and rows. Each is inset TILE_INSET px to drop edge fringe,
    then resized to TILE_SIZE square and saved as an opaque WebP (the tiles are not keyed).
    """
    path = os.path.join(raw, f'tiles-{tset}.png')
    if not os.path.exists(path):
        return
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    solid = (im[..., 1] - np.maximum(im[..., 0], im[..., 2])) < 0.3
    cols = [r for r in runs(solid.mean(axis=0) > 0.3) if r[1] - r[0] > 40]
    rows = [r for r in runs(solid.mean(axis=1) > 0.3) if r[1] - r[0] > 40]
    if len(cols) != 4 or len(rows) != 2:
        sys.exit(f'tiles-{tset}: expected a 4x2 grid, found {len(cols)}x{len(rows)}')
    k = 0
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            tid = TILE_ORDER[k]
            k += 1
            crop = Image.open(path).convert('RGB').crop((x0 + TILE_INSET, y0 + TILE_INSET, x1 - TILE_INSET, y1 - TILE_INSET))
            rel = f'tiles/{tid}.webp'
            out = os.path.join(ART, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            crop.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS).save(out, 'WEBP', quality=WEBP_QUALITY, method=4)
            entry = {'path': rel, 'width': TILE_SIZE, 'height': TILE_SIZE, 'bbox': [0, 0, TILE_SIZE, TILE_SIZE]}
            assets[f'tile.{tid}'] = entry
            report[f'tile.{tid}'] = {**entry, 'bytes': os.path.getsize(out), 'source': [x0, y0, x1 - x0, y1 - y0]}


def pack_backdrop(raw, name, report, assets):
    """A full-screen battle backdrop from backdrop-<name>.png, resized to BACKDROP_SIZE (opaque WebP)."""
    path = os.path.join(raw, f'backdrop-{name}.png')
    if not os.path.exists(path):
        return
    rel = f'backdrops/{name}.webp'
    out = os.path.join(ART, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.open(path).convert('RGB').resize(BACKDROP_SIZE, Image.LANCZOS).save(out, 'WEBP', quality=WEBP_QUALITY, method=4)
    entry = {'path': rel, 'width': BACKDROP_SIZE[0], 'height': BACKDROP_SIZE[1], 'bbox': [0, 0, *BACKDROP_SIZE]}
    assets[f'backdrop.{name}'] = entry
    report[f'backdrop.{name}'] = {**entry, 'bytes': os.path.getsize(out)}


# ---- main -------------------------------------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw = sys.argv[1]
    names = set(sys.argv[2:])
    want = lambda *keys: not names or any(k in names for k in keys)
    assets_path = os.path.join(ART, 'assets.json')
    manifest = json.load(open(assets_path)) if os.path.exists(assets_path) else {'images': {}}
    assets, report = manifest.setdefault('images', {}), {}
    for cid in POSE_CHARS:
        if want(cid, 'poses', 'battle'):
            print(f'poses {cid}')
            pack_poses(raw, cid, report, assets)
    for cid in NAMED + LATE_NAMED:
        if want(cid, 'expr', 'portraits'):
            print(f'expressions {cid}')
            pack_expr(raw, cid, report, assets)
    for sheet, ids in (('militia', MILITIA), ('imperial', IMPERIAL)):
        if want(*ids, 'busts', 'portraits'):
            print(f'busts {sheet}')
            pack_busts(raw, sheet, ids, report, assets)
    for sheet, ids in (('named', NAMED), ('militia', MILITIA), ('imperial', IMPERIAL)):
        if want(*ids, 'tokens'):
            print(f'tokens {sheet}')
            pack_tokens(raw, sheet, ids, report, assets)
    for cid in SINGLE_BUSTS:
        if want(cid, 'busts', 'portraits'):
            print(f'bust {cid}')
            pack_busts(raw, cid, [cid], report, assets, single=True)
    for cid in SINGLE_TOKENS:
        if want(cid, 'tokens'):
            print(f'token {cid}')
            pack_tokens(raw, cid, [cid], report, assets, single=True)
    for tset in TILE_SETS:
        if want(tset, 'tiles'):
            print(f'tiles {tset}')
            pack_tiles(raw, tset, report, assets)
    for name in BACKDROPS:
        if want(name, 'backdrops'):
            print(f'backdrop {name}')
            pack_backdrop(raw, name, report, assets)
    manifest['images'] = {k: assets[k] for k in sorted(assets)}
    with open(assets_path, 'w') as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write('\n')
    full = {}
    rp = os.path.join(HERE, 'packed.json')
    if os.path.exists(rp):
        full = json.load(open(rp))
    full.update(report)
    with open(rp, 'w') as f:
        json.dump({k: full[k] for k in sorted(full)}, f, indent=1, sort_keys=True)
        f.write('\n')
    print(f'\n{"id":34} {"size":>9} {"bytes":>8}')
    total = 0
    for k in sorted(report):
        r = report[k]
        total += r['bytes']
        print(f'{k:34} {r["width"]:>4}x{r["height"]:<4} {r["bytes"]:>8}')
    print(f'{len(report)} images, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()

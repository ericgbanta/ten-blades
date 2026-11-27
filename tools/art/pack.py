#!/usr/bin/env python3
"""Cut the generated art out of its flat green background and pack it as WebP into src/art.

Usage:  python3 tools/art/pack.py <raw_dir> [names...]

<raw_dir> holds the raw generated PNGs (see docs/ART_GENERATION.md). With no names every sheet found is
packed; names limit it to those characters (for example `archer stranger`) or sheet groups (`tokens`, `tiles`,
`backdrops`, `map` for the variant and connector tiles and their pieces, `props`, `tiled` for the Tiled tileset).
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
# tiles-<set>.png and the terrain id of each of its 4x2 tiles in reading order. Each set supplies tile.<terrainId>.
TILE_SETS = {
    'village': TILE_ORDER,
    'stone': ['cobble', 'flagstone', 'building', 'stall', 'rubble', 'canal', 'gate', 'crates'],
}
TILE_SIZE = 96                    # square tile canvas (the map draws it at about 46 CSS px, so 2x on a 2x screen)
TILE_INSET = 4                    # source px dropped from every edge of a tile rectangle (removes edge fringe)
BACKDROPS = ['village', 'forest', 'ruin', 'town', 'camp']  # backdrop-<name>.png
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


def pack_tiles(raw, tset, report, assets, order=TILE_ORDER):
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
            tid = order[k]
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


# ---- map tiles: variants, connectors, pieces, props ------------------------------------------------------------
# tiles-village2.png: 4x2 variant tiles, packed as tile.<terrain>.<n> (tile.<terrain> stays variant 1).
VARIANT_SHEET = 'village2'
VARIANTS = [('plain', 2), ('plain', 3), ('forest', 2), ('forest', 3), ('hill', 2), ('water', 2), ('village', 2), ('village', 3)]
# tiles-stone2.png: 4x2 variants of the town and ruin tiles, packed as tile.<terrain>.<n>. Color-matched to tiles-stone.
STONE_VARIANT_SHEET = 'stone2'
STONE_VARIANTS = [('cobble', 2), ('cobble', 3), ('flagstone', 2), ('flagstone', 3), ('building', 2), ('building', 3), ('building', 4), ('rubble', 2)]
# tiles-connect.png: 4x2 flat connector tiles, packed as tile.<name>. bridge and ford are also terrain tiles.
CONNECT_SHEET = 'connect'
CONNECTORS = ['road.straight', 'road.cross', 'wall.straight', 'wall.cross', 'shore.edge', 'shore.corner', 'bridge', 'ford']
# props-village.png: 4x3 cut-out props, packed as prop.<name>.
PROPS = ['fence', 'cart', 'barrels', 'rubble', 'banner', 'well', 'haystack', 'dead_tree', 'campfire', 'signpost', 'graves', 'wheel']
# props-town.png: 4x3 cut-out props for towns and ruins, packed as prop.<name> the same way.
TOWN_PROPS = ['street_lamp', 'fountain', 'hand_cart', 'shop_sign', 'fish_baskets', 'standard', 'bench', 'notice_board',
              'column_stump', 'fallen_statue', 'brazier', 'spear_rack']
PROP_SHEETS = [('props-village', PROPS), ('props-town', TOWN_PROPS)]
PROP_SCALE = 0.3                  # source px to packed px; a source tile is about 330 px, so a tile is about 100 px
PROP_SCALE_BY = {'cart': 0.85, 'well': 0.9, 'haystack': 0.85, 'dead_tree': 1.05, 'banner': 1.0, 'barrels': 0.85, 'graves': 0.85}
PROP_MARGIN = 4                   # px below the contact shadow on the prop canvas
WORK = 384                        # tiles are processed at 4x the packed size, then reduced to TILE_SIZE


def grid_tiles(path):
    """The 4x2 tiles of a tile sheet as float RGB arrays, each inset TILE_INSET px and resized to WORK square."""
    img = Image.open(path).convert('RGB')
    im = np.asarray(img).astype(np.float32) / 255
    solid = (im[..., 1] - np.maximum(im[..., 0], im[..., 2])) < 0.3
    cols = [r for r in runs(solid.mean(axis=0) > 0.3) if r[1] - r[0] > 40]
    rows = [r for r in runs(solid.mean(axis=1) > 0.3) if r[1] - r[0] > 40]
    if len(cols) != 4 or len(rows) != 2:
        sys.exit(f'{os.path.basename(path)}: expected a 4x2 grid, found {len(cols)}x{len(rows)}')
    out = []
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            crop = img.crop((x0 + TILE_INSET, y0 + TILE_INSET, x1 - TILE_INSET, y1 - TILE_INSET)).resize((WORK, WORK), Image.LANCZOS)
            out.append(np.asarray(crop).astype(np.float32) / 255)
    return out


def grass_mask(t):
    """Pixels of the dull olive grass (not ink, not earth, not stone, not water)."""
    r, g, b = t[..., 0], t[..., 1], t[..., 2]
    lum = t.mean(-1)
    return (lum > 0.18) & (lum < 0.45) & (np.abs(r - g) < 0.05) & (g > b + 0.03)


def water_mask(t):
    """Pixels of the dark blue river water (blue above red)."""
    return t[..., 2] > t[..., 0] + 0.03


def color_stats(tiles, mask_fn):
    px = np.concatenate([t[mask_fn(t)] for t in tiles])
    return px.mean(0), px.std(0)


def color_match(tiles, ref_grass, ref_water):
    """Shift each sheet's colors so its grass (and its water) has the mean and spread of the reference tiles.

    Generated sheets drift a little in brightness and hue from the first tileset, which shows as a checkerboard
    where tiles from two sheets meet. Each channel gets an affine map fitted on the grass pixels of the whole sheet
    and another fitted on its water pixels; a pixel uses the water map in proportion to how blue it is. Returns the
    corrected tiles and a description of the shift."""
    have_water = any(water_mask(t).mean() > 0.2 for t in tiles)
    gm, gs = color_stats(tiles, grass_mask)
    maps = {'grass': (gm, gs, *ref_grass)}
    if have_water:
        wm, ws = color_stats([t for t in tiles if water_mask(t).mean() > 0.2], lambda t: water_mask(t) & (t.mean(-1) < 0.3))
        maps['water'] = (wm, ws, *ref_water)

    def apply(t, m):
        sm, ss, rm, rs = m
        k = np.clip(rs / np.maximum(ss, 1e-3), 0.92, 1.08)
        return (t - sm) * k + rm

    out = []
    for t in tiles:
        g = apply(t, maps['grass'])
        if have_water:
            w = np.clip((t[..., 2] - t[..., 0]) / 0.06, 0, 1)[..., None]
            g = g * (1 - w) + apply(t, maps['water']) * w
        out.append(np.clip(g, 0, 1))
    note = {k: {'shift': np.round((m[2] - m[0]) * 255, 1).tolist(), 'scale': np.round(np.clip(m[3] / np.maximum(m[1], 1e-3), 0.92, 1.08), 3).tolist()}
            for k, m in maps.items()}
    return out, note


def stone_color_match(tiles, ref_tiles):
    """Shift a stone variant sheet so its paving (cobble and flagstone tiles, the first four) has the mean and spread
    of the reference sheet's cobble and flagstone, per channel. The same map is applied to the whole sheet, since the
    drift (a warmer cast) is a property of the generation, not of one tile. Spread changes are limited like color_match."""
    sm = np.concatenate([t.reshape(-1, 3) for t in tiles[:4]])
    rm = np.concatenate([t.reshape(-1, 3) for t in ref_tiles])
    k = np.clip(rm.std(0) / np.maximum(sm.std(0), 1e-3), 0.92, 1.08)
    out = [np.clip((t - sm.mean(0)) * k + rm.mean(0), 0, 1) for t in tiles]
    return out, {'shift': np.round((rm.mean(0) - sm.mean(0)) * 255, 1).tolist(), 'scale': np.round(k, 3).tolist()}


def save_tile(rgb, rel, assets, report, extra=None):
    out = os.path.join(ART, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    arr = (np.clip(rgb, 0, 1) * 255).round().astype(np.uint8)
    Image.fromarray(arr, 'RGB').resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS).save(out, 'WEBP', quality=WEBP_QUALITY, method=4)
    entry = {'path': rel, 'width': TILE_SIZE, 'height': TILE_SIZE, 'bbox': [0, 0, TILE_SIZE, TILE_SIZE]}
    key = 'tile.' + rel[len('tiles/'):-len('.webp')].replace('-', '.')
    assets[key] = entry
    report[key] = {**entry, 'bytes': os.path.getsize(out), **(extra or {})}


def save_piece(rgb, alpha, name, assets, report):
    """An overlay piece: WORK-size RGB plus a soft alpha, reduced to TILE_SIZE and saved with alpha."""
    rgba = np.dstack([rgb, np.clip(alpha, 0, 1)]).astype(np.float32)
    small = resize(rgba, (TILE_SIZE, TILE_SIZE))
    rel = f'tiles/piece-{name.replace(".", "-")}.webp'
    nbytes = save_webp(small, rel)
    bx0, by0, bx1, by1 = alpha_bbox(small)
    entry = {'path': rel, 'width': TILE_SIZE, 'height': TILE_SIZE, 'bbox': [bx0, by0, bx1 - bx0, by1 - by0]}
    assets[f'piece.{name}'] = entry
    report[f'piece.{name}'] = {**entry, 'bytes': nbytes}


def soft(mask, sigma):
    return np.clip(ndi.gaussian_filter(mask.astype(np.float32), sigma, mode='nearest'), 0, 1)


def smooth_profile(v, size=15):
    return ndi.median_filter(np.asarray(v, np.float32), size=size, mode='nearest')


def band_rows(feature, y_lo, y_hi):
    """Per column: the first and last row of `feature` between y_lo and y_hi, median smoothed (NaN-free)."""
    sub = feature[y_lo:y_hi]
    has = sub.any(axis=0)
    top = np.where(has, sub.argmax(axis=0), 0) + y_lo
    bot = np.where(has, sub.shape[0] - 1 - sub[::-1].argmax(axis=0), 0) + y_lo
    med_t, med_b = np.median(top[has]), np.median(bot[has])
    top = np.where(has, top, med_t)
    bot = np.where(has, bot, med_b)
    return smooth_profile(top), smooth_profile(bot)


def rows_mask(top, bot):
    y = np.arange(WORK)[:, None]
    return (y >= top[None, :]) & (y <= bot[None, :])


def shift_rows(t, s):
    return np.roll(t, int(s), axis=0)


def road_pieces(straight, cross, assets, report):
    """Road overlays, all for a road running east (the map rotates them): the arm from the center to the east edge,
    the full straight, the hub that fills the center, and the lip that closes the north side of the hub."""
    red = straight[..., 0] - straight[..., 1]
    top, bot = band_rows(red > 0.05, WORK // 6, WORK * 5 // 6)
    c = float(np.median((top + bot) / 2))
    s = round(WORK / 2 - c)
    t = shift_rows(straight, s)
    top, bot = top + s, bot + s
    hw = float(np.median((bot - top) / 2))
    pad = 9
    band = rows_mask(top - pad, bot + pad)
    x = np.arange(WORK)[None, :]
    save_piece(t, soft(band, 1.6), 'road.straight', assets, report)
    save_piece(t, soft(band & (x >= WORK // 2), 1.6) * (x >= WORK // 2), 'road.arm', assets, report)
    # The lip: the ink edge and a strip of dirt along the north side, a little wider than the hub.
    lip_depth = 16
    lo, hi = WORK / 2 - hw - 2 * pad, WORK / 2 + hw + 2 * pad
    lip = rows_mask(top - pad, top + lip_depth) & (x >= lo) & (x <= hi)
    save_piece(t, soft(lip, 1.2), 'road.lip', assets, report)
    # The hub: plain dirt from the crossroads center, stretched over the square inside the lips.
    redc = cross[..., 0] - cross[..., 1]
    cl, cr = band_rows((redc > 0.05).T, 0, WORK)  # per row: left and right of the vertical road
    vx0, vx1 = float(np.median(cl[:WORK // 4])), float(np.median(cr[:WORK // 4]))
    ct, cb = band_rows(redc > 0.05, 0, WORK)
    hy0, hy1 = float(np.median(ct[:WORK // 4])), float(np.median(cb[:WORK // 4]))
    inset = 20
    src = cross[int(hy0 + inset):int(hy1 - inset), int(vx0 + inset):int(vx1 - inset)]
    side = int(round(2 * (hw - 6)))
    hub_img = np.asarray(Image.fromarray((src * 255).astype(np.uint8)).resize((side, side), Image.LANCZOS)).astype(np.float32) / 255
    rgb = np.zeros((WORK, WORK, 3), np.float32)
    o = WORK // 2 - side // 2
    rgb[o:o + side, o:o + side] = hub_img
    m = np.zeros((WORK, WORK), bool)
    m[o + 2:o + side - 2, o + 2:o + side - 2] = True
    save_piece(rgb, soft(m, 2.5), 'road.hub', assets, report)
    return {'band_center_shift': s, 'half_width': hw, 'cross_bands': [vx0, vx1, hy0, hy1]}


def stone_mask(t):
    lum = t.mean(-1)
    sat = t.max(-1) - t.min(-1)
    return (lum > 0.3) & (sat < 0.09)


def wall_pieces(straight, cross, assets, report):
    """Wall overlays, unrotated: east and west halves of the straight wall, north and south arms from the junction
    tile's vertical wall, and its center pillar. Each keeps the wall's ink and the dark shadow it casts.

    The walls are found as the rows (or columns) that are mostly not grass: grass tufts and pebbles never fill a
    whole row, the wall does."""
    def span(frac, lo, hi, thr=0.55):
        idx = np.nonzero(frac[lo:hi] > thr)[0] + lo
        return float(idx.min()), float(idx.max())

    ng_cross = ~grass_mask(cross)
    vx0, vx1 = span(ng_cross[: WORK // 3].mean(axis=0), 0, WORK)
    hy0, hy1 = span(ng_cross[:, : WORK // 3].mean(axis=1), 0, WORK)
    sy0, sy1 = span((~grass_mask(straight)).mean(axis=1), 0, WORK)
    s = round((hy0 + hy1) / 2 - (sy0 + sy1) / 2)
    t = shift_rows(straight, s)
    sy0, sy1 = sy0 + s, sy1 + s
    x = np.arange(WORK)[None, :]
    y = np.arange(WORK)[:, None]
    band = (y >= sy0 - 5) & (y <= sy1 + 6) & np.ones((1, WORK), bool)
    save_piece(t, soft(band & (x >= WORK // 2 - 4), 1.4), 'wall.east', assets, report)
    save_piece(t, soft(band & (x <= WORK // 2 + 4), 1.4), 'wall.west', assets, report)
    vband = (x >= vx0 - 5) & (x <= vx1 + 6) & np.ones((WORK, 1), bool)
    save_piece(cross, soft(vband & (y <= WORK // 2 + 4), 1.4), 'wall.north', assets, report)
    save_piece(cross, soft(vband & (y >= WORK // 2 - 4), 1.4), 'wall.south', assets, report)
    # The pillar: the box around the center a little wider than the walls, with its shadow.
    cx, cy = (vx0 + vx1) / 2, (hy0 + hy1) / 2
    r = max(vx1 - vx0, hy1 - hy0) / 2 + 10
    post = (x >= cx - r) & (x <= cx + r + 4) & (y >= cy - r) & (y <= cy + r + 4)
    save_piece(cross, soft(post, 1.4), 'wall.post', assets, report)
    return {'vertical': [vx0, vx1], 'horizontal': [hy0, hy1], 'straight': [sy0, sy1], 'straight_shift': s}


def shore_pieces(edge, corner, assets, report):
    """Shore overlays for a water tile, for land to the north (rotated by the map): the bank with its inked lip,
    the land alone (drawn again over every bank so a lip never shows inside land where two banks meet), and the
    small quarter-round bank for land only on the diagonal (north west)."""
    w = water_mask(edge)
    w = ndi.binary_opening(w, iterations=2)
    first = np.where(w.any(axis=0), w.argmax(axis=0), WORK // 4).astype(np.float32)
    first = ndi.median_filter(first, size=5, mode='nearest')
    y = np.arange(WORK)[:, None]
    bank = y < first[None, :] + 2
    save_piece(edge, soft(bank, 1.2), 'shore.bank', assets, report)
    lip = 24
    land = y < first[None, :] - lip
    save_piece(edge, soft(land, 2.0), 'shore.land', assets, report)
    wc = ndi.binary_opening(water_mask(corner), iterations=2)
    x = np.arange(WORK)[None, :]
    lab, n = ndi.label(~wc & (x < WORK // 2) & (y < WORK // 2))
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    inner = lab == (int(np.argmax(sizes)) + 1)
    inner = ndi.binary_dilation(inner, iterations=2)
    save_piece(corner, soft(inner, 1.2), 'shore.inner', assets, report)
    return {'bank_depth': [float(first.min()), float(np.median(first)), float(first.max())], 'edge_depth_lr': [float(first[0]), float(first[-1])]}


def deck_piece(tile, feature, name, grow, sigma, assets, report):
    """A crossing (bridge planks, ford stones) for a horizontal crossing, centered on the tile's middle row so it
    can be turned for a vertical one."""
    top, bot = band_rows(feature, WORK // 8, WORK * 7 // 8)
    t0, b0 = float(np.median(top)), float(np.median(bot))
    s = round(WORK / 2 - (t0 + b0) / 2)
    t = shift_rows(tile, s)
    y = np.arange(WORK)[:, None]
    m = (y >= t0 + s - grow[0]) & (y <= b0 + s + grow[1]) & np.ones((1, WORK), bool)
    save_piece(t, soft(m, sigma), name, assets, report)
    return {'rows': [t0 + s, b0 + s]}


def ford_piece(tile, assets, report):
    """The ford's stepping stones alone (with their ink and the ripple ring around them), for a horizontal crossing
    centered on the middle row. The map draws them over the banks, so the stones lead from bank to bank."""
    st = stone_mask(tile)
    rows = st.mean(axis=1) > 0.15
    st = st & rows[:, None]
    lab, n = ndi.label(st)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, a in enumerate(sizes) if a > 200])
    keep = ndi.binary_fill_holes(ndi.binary_dilation(keep, iterations=7))
    ys = np.nonzero(keep.any(axis=1))[0]
    s = round(WORK / 2 - (ys.min() + ys.max()) / 2)
    save_piece(shift_rows(tile, s), soft(shift_rows(keep, s), 1.5), 'ford.deck', assets, report)
    return {'rows': [float(ys.min() + s), float(ys.max() + s)], 'stones': int(sum(1 for a in sizes if a > 200))}


def pack_map_tiles(raw, report, assets):
    """Variant tiles, connector tiles and the overlay pieces cut from them. Colors are matched to tiles-village."""
    base_path = os.path.join(raw, 'tiles-village.png')
    if not os.path.exists(base_path):
        print('  tiles-village.png is needed as the color reference')
        return
    base = grid_tiles(base_path)
    ref_grass = color_stats([base[0]], grass_mask)
    ref_water = color_stats([base[6]], lambda t: water_mask(t) & (t.mean(-1) < 0.3))
    notes = {}
    vpath = os.path.join(raw, f'tiles-{VARIANT_SHEET}.png')
    if os.path.exists(vpath):
        tiles, note = color_match(grid_tiles(vpath), ref_grass, ref_water)
        notes[VARIANT_SHEET] = note
        print(f'  {VARIANT_SHEET} color shift {note}')
        for (tid, n), t in zip(VARIANTS, tiles):
            save_tile(t, f'tiles/{tid}-{n}.webp', assets, report)
    spath = os.path.join(raw, f'tiles-{STONE_VARIANT_SHEET}.png')
    bpath = os.path.join(raw, 'tiles-stone.png')
    if os.path.exists(spath) and os.path.exists(bpath):
        stone = grid_tiles(bpath)
        tiles, note = stone_color_match(grid_tiles(spath), [stone[0], stone[1]])
        notes[STONE_VARIANT_SHEET] = note
        print(f'  {STONE_VARIANT_SHEET} color shift {note}')
        for (tid, n), t in zip(STONE_VARIANTS, tiles):
            save_tile(t, f'tiles/{tid}-{n}.webp', assets, report)
    cpath = os.path.join(raw, f'tiles-{CONNECT_SHEET}.png')
    if os.path.exists(cpath):
        tiles, note = color_match(grid_tiles(cpath), ref_grass, ref_water)
        notes[CONNECT_SHEET] = note
        print(f'  {CONNECT_SHEET} color shift {note}')
        for name, t in zip(CONNECTORS, tiles):
            save_tile(t, f'tiles/{name.replace(".", "-")}.webp', assets, report)
        c = dict(zip(CONNECTORS, tiles))
        notes['road'] = road_pieces(c['road.straight'], c['road.cross'], assets, report)
        notes['wall'] = wall_pieces(c['wall.straight'], c['wall.cross'], assets, report)
        notes['shore'] = shore_pieces(c['shore.edge'], c['shore.corner'], assets, report)
        b = c['bridge']
        notes['bridge'] = deck_piece(b, ~water_mask(b) & (b[..., 0] > b[..., 2]), 'bridge.deck', (4, 12), 1.2, assets, report)
        f = c['ford']
        notes['ford'] = ford_piece(f, assets, report)
    report['_map_tiles'] = notes


def pack_props(raw, report, assets):
    """Map props from props-village.png and props-town.png: keyed, split, cropped to the art and scaled by one shared factor (a few
    props by their own factor), then placed bottom centered on a 96 or 128 px canvas. `anchorX` and `groundY` give
    the point under the contact shadow that the map puts on the lower middle of a tile."""
    for sheet, names in PROP_SHEETS:
        pack_prop_sheet(raw, sheet, names, report, assets)


def pack_prop_sheet(raw, sheet, names, report, assets):
    path = os.path.join(raw, f'{sheet}.png')
    if not os.path.exists(path):
        return
    cells, _ = split_cells(key(path), 3, 4, name=sheet)
    for name, cell in zip(names, cells):
        b = alpha_bbox(cell)
        crop = cell[b[1]:b[3], b[0]:b[2]]
        k = PROP_SCALE * PROP_SCALE_BY.get(name, 1.0)
        w, h = max(1, round(crop.shape[1] * k)), max(1, round(crop.shape[0] * k))
        size = 96 if w <= 96 - 4 and h <= 96 - PROP_MARGIN - 2 else 128
        fit = min(1.0, (size - 4) / w, (size - PROP_MARGIN - 2) / h)
        if fit < 1:
            w, h = max(1, round(w * fit)), max(1, round(h * fit))
        canvas = np.zeros((size, size, 4), np.float32)
        ox, oy = (size - w) // 2, size - PROP_MARGIN - h
        paste(canvas, resize(crop, (w, h)), ox, oy)
        rel = f'props/{name}.webp'
        nbytes = save_webp(canvas, rel)
        bx0, by0, bx1, by1 = alpha_bbox(canvas)
        entry = {'path': rel, 'width': size, 'height': size, 'bbox': [bx0, by0, bx1 - bx0, by1 - by0],
                 'anchorX': size // 2, 'groundY': size - PROP_MARGIN}
        assets[f'prop.{name}'] = entry
        report[f'prop.{name}'] = {**entry, 'bytes': nbytes}


def write_tiled_tileset(report):
    """tools/maps/tiles.png (one packed base tile per terrain id, in terrain.json order) and tools/maps/tiles.tsj,
    the Tiled tileset whose tiles carry the terrain id as their class and as a `terrain` property."""
    terrain = json.load(open(os.path.join(REPO, 'src', 'data', 'terrain.json')))
    ids = list(terrain)
    cols = 5
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * TILE_SIZE, rows * TILE_SIZE), (60, 40, 60))
    tiles = []
    for i, tid in enumerate(ids):
        p = os.path.join(ART, 'tiles', f'{tid}.webp')
        if os.path.exists(p):
            sheet.paste(Image.open(p).convert('RGB').resize((TILE_SIZE, TILE_SIZE)), ((i % cols) * TILE_SIZE, (i // cols) * TILE_SIZE))
        tiles.append({'id': i, 'type': tid, 'properties': [{'name': 'terrain', 'type': 'string', 'value': tid}]})
    out_dir = os.path.join(REPO, 'tools', 'maps')
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, 'tiles.png'))
    tsj = {'type': 'tileset', 'version': '1.10', 'tiledversion': '1.10.2', 'name': 'terrain', 'tilewidth': TILE_SIZE,
           'tileheight': TILE_SIZE, 'tilecount': len(ids), 'columns': cols, 'margin': 0, 'spacing': 0,
           'image': 'tiles.png', 'imagewidth': cols * TILE_SIZE, 'imageheight': rows * TILE_SIZE, 'tiles': tiles}
    with open(os.path.join(out_dir, 'tiles.tsj'), 'w') as f:
        json.dump(tsj, f, indent=1)
        f.write('\n')
    print(f'  tileset: {len(ids)} terrains -> tools/maps/tiles.png, tiles.tsj')


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
    for tset, order in TILE_SETS.items():
        if want(tset, 'tiles'):
            print(f'tiles {tset}')
            pack_tiles(raw, tset, report, assets, order)
    if want('map', 'variants', 'connect', 'pieces'):
        print('map tiles')
        pack_map_tiles(raw, report, assets)
    if want('props'):
        print('props')
        pack_props(raw, report, assets)
    if want('tiled', 'tiles', 'map'):
        write_tiled_tileset(report)
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
        if k.startswith('_'):
            continue
        r = report[k]
        total += r['bytes']
        print(f'{k:34} {r["width"]:>4}x{r["height"]:<4} {r["bytes"]:>8}')
    print(f'{len([k for k in report if not k.startswith("_")])} images, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Main character layer experiment: key-color segmentation, recoloring, hair layers, expressions, tokens, poses.

Usage:  python3 tools/art/mc_build.py [raw_dir] [out_dir]

raw_dir holds the six raw test PNGs (mc-base, mc-face-bust, mc-hair-bust, mc-hair-chibi, mc-hair-side,
mc-poses-vanguard). out_dir gets the evaluation sheets (PNG plus a JPG at most 1600 px on the long side) and a
report, registration.json. Needs numpy, scipy, Pillow and opencv-python-headless.

The art is drawn in key colors: skin is the only warm tan, hair the only saturated blue, the accent cloth (scarf,
sash) the only saturated red, everything else neutral grey, black or steel. Each key region is flat color plus a
darker shadow tone plus anti-aliased edges into black ink, so every pixel is modelled as a mix
    p = t * F + (1 - t) * N
of the nearest flat region color F and the nearest neutral color N (usually ink). t is the pixel's soft
membership in the region. Recoloring adds t * (F' - F), where F' is F carried to the target palette by its place
between the source base and shadow tones, so ink edges and shading shapes stay exactly as drawn (the color part of
what the model leaves unexplained is dropped, so key-color noise cannot tint a dark target).

Views:
  portrait  the four bald expression busts are registered to the neutral one (similarity, sub-pixel); each hair
            bust is registered to the neutral bald bust on the face and neck, and its hair layer (hair color, the
            hair's own ink, a braid clasp, the hair cell's skin where the bald skull's outline would show) is laid
            over any expression. A shaved scalp becomes a translucent film, so it follows every skin tone.
  token     whole chibis per hair (the model's drawings, recolored) and, for comparison, hair layers over the bald
            chibi from mc-base.
  poses     each side-profile hair head is registered to the topknot one, which is fitted to every pose's head by
            shape (skin silhouette, scale shared across poses, rotation per pose); the hair is shrunk with thickened
            ink to match the body's line weight and kept behind steel and hands.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy import optimize

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pack import key, split_cells, resize, paste, alpha_bbox, bbox, BATTLE_W, BATTLE_H, GROUND_Y, ANCHOR_X, \
    DEFAULT_IDLE_HEIGHT, PORTRAIT, PORTRAIT_MARGIN, TOKEN, TOKEN_MARGIN, feet_center  # noqa: E402

SCRATCH = '/tmp/claude-0/-home-user/02284ef6-c071-5898-a4a9-33dbf5952dd3/scratchpad'
RAW = os.path.join(SCRATCH, 'art', 'out')
OUT = os.path.join(SCRATCH, 'mc')

HAIRS = ['crop', 'shoulder', 'braid', 'topknot']
EXPRS = ['neutral', 'angry', 'hurt', 'smile']
POSES = ['idle', 'windup', 'strike', 'hit']


# ---- palettes (base, shadow); shadow None = derived by shadow_of() ------------------------------------------------
def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


SKIN = {  # very fair to very dark, natural; the second tone is the cel shadow
    'porcelain': ('#f3d5c3', '#dcae9a'),
    'fair': ('#e8bd9c', '#cf9878'),
    'tan': ('#c99470', '#ab7452'),
    'olive': ('#a87a52', '#89603d'),
    'brown': ('#7d5236', '#623e27'),
    'deep': ('#4f3222', '#3b2418'),
}
HAIR = {  # dark hair is kept clearly lighter than the ink so the black shadow shapes still read
    'black': ('#3a3e4c', '#24262f'),
    'darkbrown': ('#4e3728', '#36251b'),
    'chestnut': ('#7a4a2c', '#57321e'),
    'auburn': ('#8e3f26', '#652a1a'),
    'copper': ('#c0602e', '#93431f'),
    'blond': ('#d9b56a', '#b18a48'),
    'platinum': ('#d3d0c6', '#a9a59c'),
    'grey': ('#8c8c8e', '#67676b'),
    'white': ('#eae6de', '#c2bdb4'),
    'teal': ('#2f6b6a', '#1f4a4c'),
}
ACCENT = {  # muted, to sit inside the charcoal and bone palette
    'crimson': ('#8f1f24', None),
    'teal': ('#2f6f6c', None),
    'mustard': ('#b48a2c', None),
    'violet': ('#5c3d78', None),
    'olive': ('#5b6630', None),
    'bone': ('#d8cfb8', None),
}


def shadow_of(base):
    """Cel shadow for a base color: value x0.7, saturation x1.1, same hue."""
    hsv = cv2.cvtColor(base.reshape(1, 1, 3).astype(np.float32), cv2.COLOR_RGB2HSV)[0, 0]
    out = np.array([[[hsv[0], min(1, hsv[1] * 1.1), hsv[2] * 0.7]]], np.float32)
    return cv2.cvtColor(out, cv2.COLOR_HSV2RGB)[0, 0]


def pal(entry):
    b = hexrgb(entry[0])
    s = hexrgb(entry[1]) if entry[1] else shadow_of(b)
    return b, s


# ---- A. segmentation ---------------------------------------------------------------------------------------------
def hsv_of(rgb):
    hsv = cv2.cvtColor(np.ascontiguousarray(rgb, np.float32), cv2.COLOR_RGB2HSV)
    return hsv[..., 0], hsv[..., 1], hsv[..., 2]


def hue_in(h, lo, hi):
    return (h >= lo) & (h <= hi) if lo <= hi else (h >= lo) | (h <= hi)


# hue range (degrees), min saturation, max saturation, min value, min core component area
KEYS = {
    'skin': ((10, 42), 0.22, 0.75, 0.42, 30),
    'hair': ((200, 255), 0.45, 1.0, 0.22, 12),
    'accent': ((345, 12), 0.55, 1.0, 0.30, 60),
}


# wider hue ranges for the rim: anti-aliased hair edges against the green screen come out teal after unmixing
TINT = {'skin': (5, 48), 'hair': (170, 275), 'accent': (330, 20)}


def segment(rgba):
    """Soft masks {skin, hair, accent, neutral} (0..1, sum to the pixel's coverage) plus the local flat
    color F of each key region and the local neutral color N. See the module doc for the mixing model."""
    rgb, a = rgba[..., :3], rgba[..., 3]
    h, s, v = hsv_of(rgb)
    solid = a > 0.9
    cores = {}
    for name, ((lo, hi), smin, smax, vmin, amin) in KEYS.items():
        m = solid & hue_in(h, lo, hi) & (s >= smin) & (s <= smax) & (v >= vmin)
        m = ndi.binary_opening(m, iterations=1) if name != 'hair' else m
        lab, n = ndi.label(m)
        if n:
            area = np.bincount(lab.ravel())
            keep = area >= amin
            keep[0] = False
            m = keep[lab]
        cores[name] = m
    anycore = np.zeros_like(solid)
    for m in cores.values():
        anycore |= m
    chroma = rgb.max(-1) - rgb.min(-1)
    neutral_core = solid & ~ndi.binary_dilation(anycore, iterations=1) & ((chroma < 0.05) | (v < 0.06))
    if not neutral_core.any():
        neutral_core = solid & ~anycore
    _, (ny, nx) = ndi.distance_transform_edt(~neutral_core, return_indices=True)
    N = rgb[ny, nx]
    masks, flats, tones, resids = {}, {}, {}, {}
    total = np.zeros(a.shape, np.float32)
    for name, core in cores.items():
        inner = ndi.binary_erosion(core, iterations=1)
        inner = inner if inner.sum() > 0.25 * core.sum() else core
        if inner.sum() < 20:
            masks[name] = np.zeros(a.shape, np.float32)
            flats[name] = np.zeros_like(rgb)
            continue
        # The region's flat tones (base, shadow, maybe a highlight): k-means on the inner core colors, merging
        # centers that are close. Every pixel's F is the tone of its nearest inner core pixel, so the
        # anti-aliased rim never leaks into F.
        cols = rgb[inner].astype(np.float32)
        k = min(5, len(cols))
        _, lab, cen = cv2.kmeans(cols, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-4), 3,
                                 cv2.KMEANS_PP_CENTERS)
        lab = lab.ravel()
        cnt = np.bincount(lab, minlength=k)
        order = np.argsort(-cnt)
        keep = []
        for i in order:
            if cnt[i] < 0.004 * len(cols):
                continue
            j = next((j for j in keep if np.linalg.norm(cen[i] - cen[j]) < 0.07), None)
            if j is None:
                keep.append(i)
        remap = np.array([min(keep, key=lambda j: np.linalg.norm(cen[i] - cen[j])) for i in range(k)])
        tone_img = np.zeros(a.shape, np.int32)
        tone_img[inner] = remap[lab]
        snapped = np.zeros_like(rgb)
        snapped[inner] = cen[remap[lab]]
        d, (fy, fx) = ndi.distance_transform_edt(~inner, return_indices=True)
        F = snapped[fy, fx]
        diff = F - N
        t = np.sum((rgb - N) * diff, -1) / np.maximum(np.sum(diff * diff, -1), 1e-4)
        t = np.clip(t, 0, 1)
        # The pixel must lie close to the F-N line (a grey cloth pixel beside a red edge is not partly red).
        resid = np.linalg.norm(rgb - (N + t[..., None] * diff), axis=-1)
        # The rim: a few px of the core, or further out (dark strands, shadow tips) when the pixel visibly carries
        # the region's hue. Chroma (max - min) rather than saturation, so near-black noise does not count.
        tinted = hue_in(h, *TINT[name]) & (chroma > 0.045)
        t = np.where((resid < 0.12) | tinted, t, t * np.clip(1 - (resid - 0.12) / 0.1, 0, 1))
        # only hair has thin strands far from its flat color; a reddish dark line on the face is ink, not scarf
        reach = {'hair': (14, 60), 'skin': (8, 0), 'accent': (5, 0)}[name]
        far = tinted & (s > 0.35) & (d <= reach[1])
        t = np.where((d <= 3.5) | (tinted & (d <= reach[0])) | far, t, 0)
        t = np.where(inner, 1.0, t)
        masks[name] = (t * a).astype(np.float32)
        resids[name] = np.where(inner, -1.0, resid)
        flats[name] = F
        tones[name] = [(cen[i], int(np.sum(cnt[remap == i]))) for i in keep]
        total += masks[name]
    # a rim pixel claimed by two regions (a dark line where skin meets the scarf) goes to the one that explains it
    # best; one region per pixel keeps recoloring from mixing two palettes into a third color
    names = [k for k in masks if k in resids]
    if len(names) > 1:
        R = np.stack([np.where(masks[k] > 0, resids[k], np.inf) for k in names])
        win = R.argmin(0)
        for i, k in enumerate(names):
            masks[k] = np.where(win == i, masks[k], 0).astype(np.float32)
    total = sum(masks.values())
    over = np.maximum(total / np.maximum(a, 1e-4), 1)
    for name in masks:
        masks[name] /= over
    masks['neutral'] = np.clip(a - sum(masks[k] for k in cores), 0, 1)
    return {'masks': masks, 'flats': flats, 'N': N, 'tones': tones}


LUM = np.array([0.299, 0.587, 0.114], np.float32)


def tone_stats(seg, name):
    """Source (base, shadow) luminance of a region: the most common tone and the darker one (or 0.75 x base)."""
    tl = seg['tones'].get(name)
    if not tl:
        return None
    base = float(tl[0][0] @ LUM)
    darker = [float(c @ LUM) for c, n in tl[1:] if float(c @ LUM) < base * 0.92]
    return base, (darker[0] if darker else base * 0.75)   # the most common darker tone


def recolor(rgba, seg, region, target, stats=None):
    """Remap one key region to target=(base, shadow) RGB. Keeps ink edges and the drawn shading shapes."""
    masks, flats = seg['masks'], seg['flats']
    st = stats or tone_stats(seg, region)
    if st is None:
        return rgba
    base_l, shad_l = st
    tb, ts = target
    F = flats[region]
    lum = F @ LUM
    # u = 0 at the base tone, 1 at the shadow tone; above the base it becomes a highlight (u < 0)
    u = np.clip((base_l - lum) / max(base_l - shad_l, 1e-3), -0.6, 1.25)[..., None]
    hl = np.clip(tb + (tb - ts) * 0.6, 0, 1)
    Ft = np.where(u >= 0, tb + (ts - tb) * u, tb + (hl - tb) * (-u / 0.6) * 0.6)
    Ft = np.clip(Ft, 0, 1)
    a = np.maximum(rgba[..., 3:4], 1e-4)
    t = (masks[region] / a[..., 0])[..., None]
    # what the mix model leaves unexplained: its brightness part is kept (soft steps between the base and shadow
    # tones), its color part is dropped (key-color noise, which would tint a dark target, e.g. green in black hair)
    N = seg['N']
    r = rgba[..., :3] - (N + t * (F - N))
    r_chroma = r - (r @ LUM)[..., None]
    out = rgba.copy()
    out[..., :3] = np.clip(rgba[..., :3] + t * (Ft - F) - np.clip(3 * t, 0, 1) * r_chroma, 0, 1)
    return out


def recolor_all(rgba, look, seg=None, stats=None):
    """look: dict with skin, hair, accent palette names (any may be missing = keep key color)."""
    seg = seg or segment(rgba)
    out = rgba
    stats = stats or {}
    if look.get('skin'):
        out = recolor(out, seg, 'skin', pal(SKIN[look['skin']]), stats.get('skin'))
    if look.get('hair'):
        out = recolor(out, seg, 'hair', pal(HAIR[look['hair']]), stats.get('hair'))
    if look.get('accent'):
        out = recolor(out, seg, 'accent', pal(ACCENT[look['accent']]), stats.get('accent'))
    return out


# ---- cells and compositing helpers -------------------------------------------------------------------------------
_KEYED = {}


def keyed(name):
    if name not in _KEYED:
        k = key(os.path.join(RAW, f'{name}.png'))
        # despill everywhere, not only on the alpha edge: no key color is green, so green above both red and blue
        # is screen spill (it shows as teal tips on thin hair strands that are fully opaque)
        k[..., 1] = np.minimum(k[..., 1], np.maximum(k[..., 0], k[..., 2]) + 0.01)
        _KEYED[name] = k
    return _KEYED[name]


CELL_ORIGIN = {}   # id(crop) -> (x, y) of the crop's top-left corner relative to its grid square


def cells_of(name, rows, cols, margin=24, main_only=False):
    """Each grid item of a raw sheet cropped to its box plus a margin (keyed float RGBA). The crop's position in
    its own grid square is kept in CELL_ORIGIN (pack.py aligns expression cells by that position). main_only
    keeps just the largest piece (drops a neighbor's cape cut off at the cell line)."""
    cells, mains = split_cells(keyed(name), rows, cols, name=name)
    out = []
    for i, c in enumerate(cells):
        if main_only:
            c = c.copy()
            c[..., 3] *= ndi.binary_dilation(mains[i], iterations=3)
        x0, y0, x1, y1 = alpha_bbox(c)
        h, w = c.shape[:2]
        x0, y0, x1, y1 = max(0, x0 - margin), max(0, y0 - margin), min(w, x1 + margin), min(h, y1 + margin)
        crop = np.ascontiguousarray(c[y0:y1, x0:x1])
        CELL_ORIGIN[id(crop)] = (x0 - (i % cols) * w // cols, y0 - (i // cols) * h // rows)
        out.append(crop)
    return out


def over(top, bottom):
    """Alpha-over of two straight-alpha float RGBA arrays of the same size."""
    ta, ba = top[..., 3:4], bottom[..., 3:4]
    oa = ta + ba * (1 - ta)
    rgb = (top[..., :3] * ta + bottom[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6)
    return np.dstack([np.where(oa > 1e-6, rgb, 0), oa])


def flat_on(rgba, bg):
    bg = np.asarray(bg, np.float32)
    return rgba[..., :3] * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4])


def warp(rgba, M, size, interp=cv2.INTER_CUBIC):
    """Affine warp (2x3 matrix, source -> destination) of a straight-alpha RGBA array, via premultiplied alpha."""
    pm = np.dstack([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]]).astype(np.float32)
    out = cv2.warpAffine(pm, M.astype(np.float64), size, flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = np.clip(out, 0, 1)
    a = out[..., 3:4]
    rgb = np.where(a > 1e-4, out[..., :3] / np.maximum(a, 1e-4), 0)
    return np.dstack([np.clip(rgb, 0, 1), a])


def warp_mask(m, M, size):
    return np.clip(cv2.warpAffine(m.astype(np.float32), M.astype(np.float64), size, flags=cv2.INTER_LINEAR), 0, 1)


def sim_matrix(p):
    s, th, tx, ty = p
    c, n = s * np.cos(th), s * np.sin(th)
    return np.array([[c, -n, tx], [n, c, ty]], np.float64)


def compose(A, B):
    """Matrix of 'apply B, then A' for 2x3 affine matrices."""
    A3 = np.vstack([A, [0, 0, 1]])
    B3 = np.vstack([B, [0, 0, 1]])
    return (A3 @ B3)[:2]


# ---- registration -------------------------------------------------------------------------------------------------
def reg_signal(rgba):
    """Grey image for registration: the drawing over white, so ink is dark and background light."""
    g = flat_on(rgba, (1, 1, 1)) @ LUM
    return cv2.GaussianBlur(g.astype(np.float32), (0, 0), 1.2)


def ink_of(rgba, seg=None):
    """Soft ink mask: dark neutral pixels (the black lines and solid blacks)."""
    lum = rgba[..., :3] @ LUM
    return np.clip((0.22 - lum) / 0.14, 0, 1) * rgba[..., 3]


def register(moving, fixed, exclude_moving=None, exclude_fixed=None, init=None, bottom_cut=0, trunc=0.35, roi=None):
    """Similarity transform (scale, rotation, translation) carrying `moving` onto `fixed`.

    Initial guess from ORB features (RANSAC, similarity) or `init`, then refined with Nelder-Mead on a truncated
    L1 difference of the blurred drawings over white, ignoring the excluded masks (hair, which differs by design)
    and the bottom `bottom_cut` px of the fixed frame (busts are cut flat at different heights).
    `roi` (fixed frame, 0..1) limits the comparison to an area, for example the head.
    Returns the 2x3 matrix (moving -> fixed coordinates) and the final cost.
    """
    H, W = fixed.shape[:2]
    fs, ms = reg_signal(fixed), reg_signal(moving)
    exm = np.zeros(moving.shape[:2], np.float32) if exclude_moving is None else exclude_moving.astype(np.float32)
    exf = np.zeros((H, W), bool) if exclude_fixed is None else exclude_fixed
    base_w = (ndi.binary_dilation(fixed[..., 3] > 0.3, iterations=6) & ~exf).astype(np.float32)
    if bottom_cut:
        base_w[H - bottom_cut:] = 0
    if roi is not None:
        base_w *= roi
    if init is None:
        orb = cv2.ORB_create(4000)
        u8 = lambda g: (np.clip(g, 0, 1) * 255).astype(np.uint8)
        km, dm = orb.detectAndCompute(u8(ms), ((exm < 0.5) & (moving[..., 3] > 0.3)).astype(np.uint8) * 255)
        kf, df = orb.detectAndCompute(u8(fs), (base_w > 0).astype(np.uint8) * 255)
        init = np.array([[1, 0, (W - moving.shape[1]) / 2], [0, 1, (H - moving.shape[0]) / 2]], np.float64)
        if dm is not None and df is not None and len(km) > 10 and len(kf) > 10:
            matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(dm, df)
            if len(matches) >= 8:
                src = np.float32([km[m.queryIdx].pt for m in matches])
                dst = np.float32([kf[m.trainIdx].pt for m in matches])
                M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4)
                if M is not None and inl is not None and inl.sum() >= 8:
                    init = M
    s0 = float(np.hypot(init[0, 0], init[1, 0]))
    th0 = float(np.arctan2(init[1, 0], init[0, 0]))
    p0 = np.array([s0, th0, init[0, 2], init[1, 2]])

    def cost(p, step=1):
        M = sim_matrix(p)
        wm = cv2.warpAffine(ms, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=1.0)
        we = cv2.warpAffine(exm, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
        w = base_w * (we < 0.05)
        d = np.minimum(np.abs(wm - fs), trunc)
        return float((d * w)[::step, ::step].sum() / max(w[::step, ::step].sum(), 1))

    scales = np.array([0.01, 0.01, 2.0, 2.0])
    f = lambda q, step: cost(p0 + q * scales, step)
    best = optimize.minimize(lambda q: f(q, 2), np.zeros(4), method='Nelder-Mead',
                             options={'xatol': 0.02, 'fatol': 1e-6, 'maxiter': 600, 'initial_simplex':
                                      np.vstack([np.zeros(4), np.eye(4) * 3])})
    best = optimize.minimize(lambda q: f(q, 1), best.x, method='Nelder-Mead',
                             options={'xatol': 0.005, 'fatol': 1e-7, 'maxiter': 600, 'initial_simplex':
                                      np.vstack([best.x, best.x + np.eye(4) * 0.5])})
    p = p0 + best.x * scales
    return sim_matrix(p), best.fun


def chamfer(moving_w, fixed, valid):
    """Mean and 90th percentile distance (px, fixed frame) from ink pixels of the warped moving image to the
    nearest ink pixel of the fixed image, over the `valid` area. Thin-line misregistration shows up directly."""
    im = ink_of(moving_w) > 0.5
    ifx = ink_of(fixed) > 0.5
    dist = ndi.distance_transform_edt(~ifx)
    v = im & valid
    if v.sum() == 0:
        return float('nan'), float('nan')
    d = dist[v]
    return float(d.mean()), float(np.percentile(d, 90))


def pad(rgba, t, r, b, l):
    return np.pad(rgba, ((t, b), (l, r), (0, 0)))


# ---- pieces: an RGBA image plus its segmentation, warped together ----------------------------------------------------
REGIONS = ('skin', 'hair', 'accent')


def piece(rgba, seg=None):
    return {'rgba': rgba, 'seg': seg or segment(rgba)}


def warp_piece(p, M, size):
    seg = p['seg']
    masks = {k: warp_mask(v, M, size) for k, v in seg['masks'].items()}
    flats = {k: cv2.warpAffine(np.ascontiguousarray(v, np.float32), M, size, flags=cv2.INTER_NEAREST,
                               borderMode=cv2.BORDER_REPLICATE) for k, v in seg['flats'].items()}
    N = cv2.warpAffine(np.ascontiguousarray(seg['N'], np.float32), M, size, flags=cv2.INTER_NEAREST,
                       borderMode=cv2.BORDER_REPLICATE)
    return {'rgba': warp(p['rgba'], M, size), 'seg': {'masks': masks, 'flats': flats, 'N': N, 'tones': seg['tones']}}


def recolor_piece(p, look, stats):
    """Recolor a piece; `stats` are the source (base, shadow) luminances per region, shared by every piece of a
    view so the hair layer and the bust beneath it map their key colors the same way."""
    return recolor_all(p['rgba'], look, p['seg'], stats)


def masked_piece(p, alpha):
    """A copy of the piece whose alpha (and region masks) are scaled to `alpha` (0..1 of the original)."""
    a0 = np.maximum(p['rgba'][..., 3], 1e-6)
    f = np.clip(alpha / a0, 0, 1)
    rgba = p['rgba'].copy()
    rgba[..., 3] = np.minimum(alpha, a0)
    masks = {k: v * f for k, v in p['seg']['masks'].items()}
    return {'rgba': rgba, 'seg': {**p['seg'], 'masks': masks}}


def merge_stats(*segs):
    out = {}
    for name in ('skin', 'hair', 'accent'):
        for s in segs:
            st = tone_stats(s, name)
            if st:
                out[name] = st
                break
    return out


# ---- C. hair layers ------------------------------------------------------------------------------------------------
def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def stubble_of(hw, base, hair_core, near_px=45):
    """Shaved scalp in a warped hair cell: skin there, skin in the bald base too, but clearly darker (stubble
    greys the scalp), near the hair. Returns a soft 0..1 strength."""
    m, mb = hw['seg']['masks'], base['seg']['masks']
    a, ab = np.maximum(hw['rgba'][..., 3], 1e-4), np.maximum(base['rgba'][..., 3], 1e-4)
    skin = (m['skin'] / a > 0.8) & (mb['skin'] / ab > 0.8)
    lh, lb = hw['rgba'][..., :3] @ LUM, base['rgba'][..., :3] @ LUM
    ratio = lh / np.maximum(lb, 1e-3)
    dark = skin & (ratio < 0.9) & (ndi.distance_transform_edt(~hair_core) <= near_px)
    dark = ndi.binary_opening(dark, structure=disk(2 if hair_core.sum() > 4000 else 1))
    lab, n = ndi.label(dark)
    if not n:
        return np.zeros(a.shape, np.float32)
    area = np.bincount(lab.ravel())
    keep = area >= max(25, 0.12 * hair_core.sum())
    keep[0] = False
    reg = ndi.binary_closing(keep[lab], structure=disk(3))
    return np.clip(cv2.GaussianBlur(reg.astype(np.float32), (0, 0), 0.8) * 1.6 - 0.3, 0, 1) * (ratio < 0.97)


def hair_selection(hw, base, near_px=22, ink_tol=2, hole_px=500, report=None, protect=None):
    """Binary selection (base frame) of the hair layer from a hair-cell piece `hw` already warped onto `base`.

    Selected: hair-colored pixels; ink that belongs to the hair, i.e. ink pixels within `near_px` of hair color
    that are not ink in the bald base (within `ink_tol` px, to forgive sub-pixel misregistration), kept only as
    whole connected pieces that touch the hair; and other pieces that differ from the base and are mostly
    enclosed by hair (a braid's metal clasp). Small holes are filled (gaps between strands over the skull);
    large holes (the face, framed by long hair) are left to the base.
    """
    m = hw['seg']['masks']
    rgba, brgba = hw['rgba'], base['rgba']
    a = rgba[..., 3]
    hair = m['hair'] > 0.25
    hair_core = ndi.binary_opening(hair, iterations=1) | (m['hair'] > 0.6)
    near = ndi.distance_transform_edt(~hair_core) <= near_px
    ink_h = ink_of(rgba) > 0.45
    ink_b = ndi.binary_dilation(ink_of(brgba) > 0.45, structure=disk(ink_tol))
    cand = ink_h & near & ~ink_b
    lab, n = ndi.label(cand, structure=np.ones((3, 3)))
    touch = np.unique(lab[ndi.binary_dilation(hair, iterations=2) & cand])
    keep = np.zeros(n + 1, bool)
    keep[touch] = True
    keep[0] = False
    ink_sel = keep[lab]
    sel = hair | ink_sel
    # differing pieces that sit inside the hair's hull (a braid's metal clasp, a tie), never on the base's skin
    diff = np.abs(flat_on(rgba, (0, 1, 0)) - flat_on(brgba, (0, 1, 0))).max(-1) > 0.12
    hull = ndi.binary_closing(np.pad(sel, 30), structure=disk(22))[30:-30, 30:-30]
    base_skin = ndi.binary_dilation(base['seg']['masks']['skin'] > 0.3, iterations=3)
    other = diff & hull & ~sel & ~base_skin & (a > 0.5)
    ol, on = ndi.label(other)
    if on:
        area = np.bincount(ol.ravel())
        big = area >= 15
        big[0] = False
        sel |= big[ol]
    # the bald skull's outline and rim highlight where the hair cell draws skin instead (the temple under a
    # hairline): take the hair cell's pixels there, so they do not show through as a stray dashed line. Only on the
    # silhouette band, never inside the face, so expression lines are left alone.
    bfg = brgba[..., 3] > 0.5
    band = bfg & (ndi.distance_transform_edt(bfg) <= 12)
    differs = np.abs(brgba[..., :3] - rgba[..., :3]).max(-1) > 0.1
    stray = differs & band & (a > 0.9) & near
    if protect is not None:
        stray &= ~protect
    sel |= ndi.binary_dilation(stray, iterations=1) & (a > 0.5)
    sel = ndi.binary_closing(sel, structure=disk(2))
    holes = ndi.binary_fill_holes(sel) & ~sel
    hl, hn = ndi.label(holes)
    if hn:
        area = np.bincount(hl.ravel())
        small = area < hole_px
        small[0] = False
        sel |= small[hl]
    sel &= a > 0.02
    # anti-aliased rims: one px outward, but never onto the base's own lines (those stay with the base)
    rim = ndi.binary_dilation(sel, iterations=1) & ~sel & (a > 0.02) & ~(ink_of(brgba) > 0.45)
    sel = sel | rim
    stub = stubble_of(hw, base, hair_core)
    if report is not None:
        report['hair_px'] = int(hair.sum())
        report['ink_px'] = int(ink_sel.sum())
        report['stubble_px'] = int((stub > 0.5).sum())
    return sel, stub


STUBBLE_ALPHA = 0.35   # a shaved scalp is the base's own skin with a film of this opacity laid over it


def hair_layer(hw, base, report=None, protect=None):
    """The hair layer piece (base frame) from a warped hair-cell piece: the hair cell's own pixels inside the
    selection (hard cut; where the cut crosses flat skin the base beneath is the same color).

    Stubble is not taken as pixels. It becomes a translucent film over the bald base's scalp, so it follows every
    skin tone. In key colors the film color is solved from the drawing (stubble = (1 - b) skin + b film, which
    comes out a dark neutral grey); recolored, it is a darkened shade of the target hair shadow."""
    sel, stub = hair_selection(hw, base, report=report, protect=protect)
    stub = stub * ~sel
    alpha = hw['rgba'][..., 3] * sel
    lay = masked_piece(hw, alpha)
    lay['film'] = np.zeros(alpha.shape, np.float32)
    if stub.max() > 0:
        core = stub > 0.9
        S = np.median(hw['rgba'][..., :3][core], axis=0)
        K = np.median(base['rgba'][..., :3][core], axis=0)
        G = np.clip((S - (1 - STUBBLE_ALPHA) * K) / STUBBLE_ALPHA, 0, 1)
        fa = stub * STUBBLE_ALPHA
        film = stub > 0
        rgba = lay['rgba']
        rgba[..., :3] = np.where(film[..., None], G, rgba[..., :3])
        rgba[..., 3] = np.where(film, fa, rgba[..., 3])
        lay['seg'] = {**lay['seg'], 'masks': {k: np.where(film, 0, v) for k, v in lay['seg']['masks'].items()}}
        lay['film'] = fa
        if report is not None:
            report['stubble_film_rgb'] = [round(float(x) * 255) for x in G]
    return lay


def recolor_layer(lay, look, stats):
    out = recolor_piece(lay, look, stats)
    if look.get('hair') and lay.get('film') is not None and lay['film'].max() > 0:
        _, shadow = pal(HAIR[look['hair']])
        film = lay['film'] > 0
        out[..., :3] = np.where(film[..., None], shadow * 0.55, out[..., :3])
    return out


# ---- D. portraits: bald expression busts registered to the neutral one, hair layers on top -------------------------
def outline_band(rgba, width=6):
    """Pixels within `width` px of the silhouette edge: the skull, ear, jaw and shoulder outline."""
    fg = rgba[..., 3] > 0.5
    return fg & ~ndi.binary_erosion(fg, iterations=width)


PAD = 170   # px of empty margin added around the bald neutral bust so hair can reach past it


def build_portraits(report):
    bald = cells_of('mc-face-bust', 2, 2, margin=0)
    hairs = cells_of('mc-hair-bust', 2, 2, margin=40)
    fx = pad(bald[0], PAD, PAD, 0, PAD)        # the bust is cut flat at the bottom: no padding there
    H, W = fx.shape[:2]
    neutral = piece(fx)
    skin_roi = ndi.binary_dilation(neutral['seg']['masks']['skin'] > 0.5, iterations=10)
    band = outline_band(fx)
    bottom = np.arange(H)[:, None] < H - 40
    rep = report.setdefault('portrait', {})
    # D. expressions onto the neutral frame. The face itself changes, so the cost is truncated and the residual is
    # measured on the silhouette outline (skull, ear, jaw, collar, shoulders), which is what the hair sits on.
    bases = {}
    for name, cell in zip(EXPRS, bald):
        if name == 'neutral':
            bases[name] = neutral
            rep['expr.neutral'] = {'scale': 1.0, 'rotation_deg': 0.0, 'shift_px': [0.0, 0.0], 'outline_chamfer_px': 0.0}
            continue
        mv = pad(cell, PAD, PAD, 0, PAD)
        # unregistered: where pack.py would put it (same position within its grid square)
        ox = CELL_ORIGIN[id(cell)][0] - CELL_ORIGIN[id(bald[0])][0]
        oy = CELL_ORIGIN[id(cell)][1] - CELL_ORIGIN[id(bald[0])][1]
        M0 = np.array([[1, 0, ox], [0, 1, oy]], np.float64)
        M, cost = register(mv, fx, bottom_cut=40, init=M0)
        w = warp_piece(piece(mv), M, (W, H))
        before = chamfer(warp(mv, M0, (W, H)), fx, band & bottom)
        after = chamfer(w['rgba'], fx, band & bottom)
        rep[f'expr.{name}'] = {'scale': round(float(np.hypot(M[0, 0], M[1, 0])), 4),
                               'rotation_deg': round(float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))), 3),
                               'shift_px': [round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)],
                               'outline_chamfer_px_unregistered': round(before[0], 3),
                               'outline_chamfer_px': round(after[0], 3), 'outline_chamfer_p90_px': round(after[1], 3)}
        bases[name] = w
    # where the expressions differ (eyes, brows, mouth): the hair layer must not replace those pixels
    protect = np.zeros((H, W), bool)
    for name in EXPRS[1:]:
        protect |= np.abs(flat_on(bases[name]['rgba'], (0, 1, 0)) - flat_on(fx, (0, 1, 0))).max(-1) > 0.15
    protect = ndi.binary_dilation(ndi.binary_opening(protect, iterations=1), iterations=6)
    # C. hair layers
    layers, warped, zones = {}, {}, {}
    for name, cell in zip(HAIRS, hairs):
        hp = piece(cell)
        hm = ndi.binary_dilation(hp['seg']['masks']['hair'] > 0.2, iterations=10)
        M, cost = register(cell, fx, exclude_moving=hm, roi=skin_roi.astype(np.float32))
        hw = warp_piece(hp, M, (W, H))
        valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & skin_roi
        ch = chamfer(hw['rgba'], fx, valid)
        r = {'scale': round(float(np.hypot(M[0, 0], M[1, 0])), 4),
             'rotation_deg': round(float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))), 3),
             'shift_px': [round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)],
             'face_chamfer_px': round(ch[0], 3), 'face_chamfer_p90_px': round(ch[1], 3), 'cost': round(cost, 4)}
        layers[name] = hair_layer(hw, neutral, report=r, protect=protect)
        warped[name] = hw
        zones[name] = ndi.binary_dilation((hw['seg']['masks']['hair'] > 0.2) | skin_roi, iterations=6)
        rep[f'hair.{name}'] = r
    return {'frame': (W, H), 'bases': bases, 'layers': layers, 'warped': warped, 'head_zone': zones}


def compose_portrait(P, hair, expr, look=None, stats=None):
    base, lay = P['bases'][expr], P['layers'][hair]
    if look:
        b = recolor_piece(base, look, stats)
        h = recolor_layer(lay, look, stats)
    else:
        b, h = base['rgba'], lay['rgba']
    return over(h, b)


def portrait_box(P):
    W, H = P['frame']
    acc = np.zeros((H, W), bool)
    for hair in HAIRS:
        for expr in EXPRS:
            acc |= over(P['layers'][hair]['rgba'], P['bases'][expr]['rgba'])[..., 3] > 0.03
    return bbox(acc)


def to_portrait(rgba, box):
    """Crop the frame to the shared box and fit it on the 384 portrait canvas, bottom aligned (as pack.py does)."""
    x0, y0, x1, y1 = box
    inner = PORTRAIT - 2 * PORTRAIT_MARGIN
    k = min(inner / (x1 - x0), inner / (y1 - y0))
    w, h = round((x1 - x0) * k), round((y1 - y0) * k)
    canvas = np.zeros((PORTRAIT, PORTRAIT, 4), np.float32)
    paste(canvas, resize(rgba[y0:y1, x0:x1], (w, h)), (PORTRAIT - w) // 2, PORTRAIT - PORTRAIT_MARGIN - h)
    return canvas


# ---- sheets --------------------------------------------------------------------------------------------------------
SLATE = (0.165, 0.18, 0.21)
WHITE = (1.0, 1.0, 1.0)


def _font(size):
    from PIL import ImageFont
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sheet(rows, row_labels=None, col_labels=None, gap=8, label_w=150, label_h=26, title=None, captions=None):
    """rows: list of lists of RGBA float tiles (sizes may differ per column; each row is as tall as its tallest
    tile). captions: optional text under each tile. Returns {'slate': PIL image, 'white': ...} with labels."""
    from PIL import ImageDraw
    ncol = max(len(r) for r in rows)
    colw = [max(r[c].shape[1] for r in rows if c < len(r)) for c in range(ncol)]
    cap_h = 20 if captions else 0
    rowh = [max(t.shape[0] for t in r) + cap_h for r in rows]
    top = (label_h if col_labels else 0) + (34 if title else 0)
    left = label_w if row_labels else 0
    W = left + sum(colw) + gap * (ncol + 1)
    H = top + sum(rowh) + gap * (len(rows) + 1)
    out = {}
    for bgname, bg in (('slate', SLATE), ('white', WHITE)):
        img = np.ones((H, W, 3), np.float32) * np.array(bg, np.float32)
        y = top + gap
        for r, row in enumerate(rows):
            x = left + gap
            for c, t in enumerate(row):
                h, w = t.shape[:2]
                ox, oy = x + (colw[c] - w) // 2, y + (rowh[r] - cap_h - h)
                img[oy:oy + h, ox:ox + w] = flat_on(t, bg) if t.shape[2] == 4 else t
                x += colw[c] + gap
            y += rowh[r] + gap
        im = Image.fromarray((np.clip(img, 0, 1) * 255).round().astype(np.uint8))
        d = ImageDraw.Draw(im)
        ink = (230, 232, 236) if bgname == 'slate' else (20, 20, 24)
        if title:
            d.text((gap, 6), title, fill=ink, font=_font(20))
        if col_labels:
            x = left + gap
            for c, lab in enumerate(col_labels):
                d.text((x + 2, top - label_h + 2), lab, fill=ink, font=_font(15))
                x += colw[c] + gap
        if captions:
            y = top + gap
            for r, row in enumerate(captions):
                x = left + gap
                for c, cap in enumerate(row):
                    d.text((x + 2, y + rowh[r] - cap_h + 2), cap, fill=ink, font=_font(13))
                    x += colw[c] + gap
                y += rowh[r] + gap
        if row_labels:
            y = top + gap
            for r, lab in enumerate(row_labels):
                for k, line in enumerate(lab.split('\n')):
                    d.text((6, y + 4 + 17 * k), line, fill=ink, font=_font(14))
                y += rowh[r] + gap
        out[bgname] = im
    return out


def save_sheet(name, sh, outdir):
    paths = []
    for bgname, im in sh.items():
        base = os.path.join(outdir, f'{name}-{bgname}')
        im.save(base + '.png')
        k = min(1.0, 1600 / max(im.size))
        small = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS) if k < 1 else im
        small.save(base + '.jpg', quality=90)
        paths.append(base + '.jpg')
    print('  wrote', ', '.join(paths))
    return paths


# ---- E. tokens -----------------------------------------------------------------------------------------------------
def body_box(p):
    """Alpha box of a figure without its hair (so every hair style is packed at the same body scale)."""
    hair = ndi.binary_dilation(p['seg']['masks']['hair'] > 0.2, iterations=3)
    return bbox((p['rgba'][..., 3] > 0.3) & ~hair)


def to_token(rgba, k, ref_box):
    """pack.py token layout at a fixed scale k: bottom centered on the 192 canvas with its 8 px margin; the
    horizontal center comes from the body box so a topknot or braid does not shift the figure."""
    x0, y0, x1, y1 = alpha_bbox(rgba)
    w, h = max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))
    canvas = np.zeros((TOKEN, TOKEN, 4), np.float32)
    cx = (ref_box[0] + ref_box[2]) / 2
    ox = round(TOKEN / 2 - (cx - x0) * k)
    oy = round(TOKEN - TOKEN_MARGIN - (ref_box[3] - y0) * k)
    paste(canvas, resize(rgba[y0:y1, x0:x1], (w, h)), ox, oy)
    return canvas


def build_tokens(report):
    """Two ways: whole chibis per hair style (the model's own drawings), and hair layers over the bald chibi from
    mc-base (same method as the portrait)."""
    rep = report.setdefault('token', {})
    whole = [piece(c) for c in cells_of('mc-hair-chibi', 1, 4, margin=30)]
    bald_cell = cells_of('mc-base', 1, 3, margin=0, main_only=True)[1]
    fx = pad(bald_cell, 90, 90, 0, 90)
    H, W = fx.shape[:2]
    bald = piece(fx)
    skin_roi = ndi.binary_dilation(bald['seg']['masks']['skin'] > 0.5, iterations=8)
    layered, warped_t = {}, {}
    for name, hp in zip(HAIRS, whole):
        hm = ndi.binary_dilation(hp['seg']['masks']['hair'] > 0.2, iterations=8)
        M, cost = register(hp['rgba'], fx, exclude_moving=hm, roi=skin_roi.astype(np.float32))
        hw = warp_piece(hp, M, (W, H))
        valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & skin_roi
        ch = chamfer(hw['rgba'], fx, valid)
        r = {'scale': round(float(np.hypot(M[0, 0], M[1, 0])), 4), 'shift_px': [round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)],
             'face_chamfer_px': round(ch[0], 3), 'face_chamfer_p90_px': round(ch[1], 3)}
        layered[name] = hair_layer(hw, bald, report=r)
        warped_t[name] = hw['rgba']
        rep[f'layered.{name}'] = r
    # one scale per method, set by the tallest figure with its hair
    inner = TOKEN - 2 * TOKEN_MARGIN
    bw = [body_box(p) for p in whole]
    k_whole = min(min(inner / (alpha_bbox(p['rgba'])[3] - alpha_bbox(p['rgba'])[1]),
                      inner / (alpha_bbox(p['rgba'])[2] - alpha_bbox(p['rgba'])[0])) for p in whole)
    tall = max((over(layered[h]['rgba'], fx)[..., 3] > 0.03).any(axis=1).sum() for h in HAIRS)
    k_layer = inner / tall
    return {'whole': dict(zip(HAIRS, whole)), 'whole_boxes': dict(zip(HAIRS, bw)), 'k_whole': k_whole,
            'bald': bald, 'bald_box': body_box(bald), 'layers': layered, 'k_layer': k_layer, 'warped': warped_t}


def token_image(T, hair, method, look=None, stats=None):
    if method == 'whole':
        p = T['whole'][hair]
        img = recolor_piece(p, look, stats) if look else p['rgba']
        return to_token(img, T['k_whole'], T['whole_boxes'][hair])
    b, lay = T['bald'], T['layers'][hair]
    img = over(recolor_layer(lay, look, stats), recolor_piece(b, look, stats)) if look else over(lay['rgba'], b['rgba'])
    return to_token(img, T['k_layer'], T['bald_box'])


# ---- F. battle poses -----------------------------------------------------------------------------------------------
def head_blob(p):
    """The pose's head (with neck): the largest skin component in the upper 45 percent of the figure."""
    a = p['rgba'][..., 3]
    y0, y1 = bbox(a > 0.3)[1], bbox(a > 0.3)[3]
    skin = p['seg']['masks']['skin'] / np.maximum(a, 1e-4) > 0.5
    lab, n = ndi.label(skin)
    best, barea = 0, 0
    for i in range(1, n + 1):
        comp = lab == i
        cy = np.nonzero(comp)[0].mean()
        ar = comp.sum()
        if cy < y0 + 0.45 * (y1 - y0) and ar > barea:
            best, barea = i, ar
    return ndi.binary_fill_holes(lab == best)


def chin_point(skin):
    """Chin of a right-facing head: the skin pixel furthest along (right, down) in the lower half of the face."""
    ys, xs = np.nonzero(skin)
    k = np.argmax(xs + 0.8 * ys)
    return np.array([xs[k], ys[k]], np.float64)


def prefilter(p, s):
    """Blur a piece before shrinking it by factor s (< 1), so the warp does not alias thin lines."""
    if s >= 0.8:
        return p
    sig = 0.45 / s
    rgba = p['rgba']
    pm = np.dstack([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]])
    pm = cv2.GaussianBlur(pm, (0, 0), sig)
    a = pm[..., 3:4]
    out = np.dstack([np.where(a > 1e-4, pm[..., :3] / np.maximum(a, 1e-4), 0), a])
    masks = {k: cv2.GaussianBlur(v, (0, 0), sig) for k, v in p['seg']['masks'].items()}
    return {'rgba': np.clip(out, 0, 1).astype(np.float32), 'seg': {**p['seg'], 'masks': masks}}


def embolden(p, r):
    """Thicken the ink of a piece by r px (source pixels) around its hair, so a large drawing shrunk onto a small
    figure keeps the figure's line weight. Ink spreads into the hair and onto the background just outside it."""
    if r < 0.5:
        return p
    rgba = p['rgba']
    ink = ink_of(rgba)
    hair = p['seg']['masks']['hair'] > 0.2
    zone = ndi.binary_dilation(hair, structure=disk(int(np.ceil(r)) + 1))
    grown = ndi.grey_dilation(ink, footprint=disk(int(round(r))))
    extra = np.clip(grown - ink, 0, 1) * zone
    ink_rgb = np.array([0.02, 0.02, 0.025], np.float32)
    a = rgba[..., 3]
    na = np.maximum(a, extra)
    rgb = (rgba[..., :3] * (a * (1 - extra))[..., None] + ink_rgb * extra[..., None]) / np.maximum(na, 1e-4)[..., None]
    out = np.dstack([np.clip(rgb, 0, 1), na]).astype(np.float32)
    masks = {k: v * (1 - extra) for k, v in p['seg']['masks'].items()}
    masks['neutral'] = np.clip(na - sum(masks[k] for k in REGIONS), 0, 1)
    return {'rgba': out, 'seg': {**p['seg'], 'masks': masks}}


INK_BOOST = 0.55   # extra ink radius in pose pixels for hair shrunk onto a pose head (matches the body's lines)


SIDE_REF = 'topknot'   # the shaved sides show most of the skull, so its skin silhouette is the best head shape


def side_shape(side):
    """Head-shape model of a side-profile cell: skin silhouette (face, ear, neck, shaved scalp) plus the scalp
    just under the hair, a mask of where that model is trusted, and the chin point."""
    a = np.maximum(side['rgba'][..., 3], 1e-4)
    hm = ndi.binary_dilation(side['seg']['masks']['hair'] > 0.2, iterations=4)
    sskin = side['seg']['masks']['skin'] / a > 0.5
    lab, n = ndi.label(sskin)
    if n > 1:
        area = np.bincount(lab.ravel())
        area[0] = 0
        sskin = lab == area.argmax()
    sskin = ndi.binary_fill_holes(sskin | (ndi.binary_dilation(sskin, iterations=3) & (ink_of(side['rgba']) > 0.5) & ~hm))
    chin = chin_point(sskin & ~hm)
    sb = bbox(sskin)
    rows = np.arange(side['rgba'].shape[0])[:, None]
    near = ndi.distance_transform_edt(~sskin)
    # head only: the neck is hidden by the collar in some poses and stretched in others
    keep = (~hm) & (rows < chin[1] + 0.04 * (chin[1] - sb[1])) & (near <= 90)
    scalp = hm & (near <= 30) & (rows < chin[1])
    keep |= scalp
    model = cv2.GaussianBlur((sskin | scalp).astype(np.float32), (0, 0), 2.0)
    return {'model': model, 'keep': keep.astype(np.float32), 'chin': chin, 'box': sb}


def side_grid(shape, head, s_values, th_values):
    """For every (scale, rotation): the best translation of the side head model onto the pose head blob by
    masked template matching, and its cost. Returns {(i, j): (cost, matrix)}."""
    fsig = cv2.GaussianBlur(head.astype(np.float32), (0, 0), 0.8)
    hb = bbox(head)
    ry0, ry1 = max(0, hb[1] - 50), min(fsig.shape[0], hb[3] + 50)
    rx0, rx1 = max(0, hb[0] - 50), min(fsig.shape[1], hb[2] + 50)
    region = np.ascontiguousarray(fsig[ry0:ry1, rx0:rx1])
    h0, w0 = shape['model'].shape
    out = {}
    for i, sc in enumerate(s_values):
        for j, th in enumerate(th_values):
            M = sim_matrix((sc, th, 0, 0))
            corners = np.array([[0, 0, 1], [w0, 0, 1], [0, h0, 1], [w0, h0, 1]], np.float64) @ M.T
            mn = corners.min(0)
            M[:, 2] -= mn
            sz = tuple(int(v) + 2 for v in np.ceil(corners.max(0) - mn))
            if sz[0] >= region.shape[1] or sz[1] >= region.shape[0]:
                continue
            tpl = cv2.warpAffine(shape['model'], M, sz, flags=cv2.INTER_AREA)
            msk = (cv2.warpAffine(shape['keep'], M, sz, flags=cv2.INTER_LINEAR) > 0.5).astype(np.float32)
            if msk.sum() < 30:
                continue
            res = cv2.matchTemplate(region, tpl.astype(np.float32), cv2.TM_SQDIFF, mask=msk) / msk.sum()
            _, _, loc, _ = cv2.minMaxLoc(res)
            M[:, 2] += [rx0 + loc[0], ry0 + loc[1]]
            out[(i, j)] = (float(res[loc[1], loc[0]]), M)
    return out


def refine_side(shape, head, M0, s_fix, s_tol=0.04):
    """Nelder-Mead on the template cost, scale held within s_tol of the shared scale."""
    fsig = cv2.GaussianBlur(head.astype(np.float32), (0, 0), 0.8)
    H, W = fsig.shape
    p0 = np.array([s_fix, np.arctan2(M0[1, 0], M0[0, 0]), M0[0, 2], M0[1, 2]])
    st = np.array([0.003, 0.01, 0.5, 0.5])

    def cost(q):
        p = p0 + q * st
        M = sim_matrix(p)
        t = cv2.warpAffine(shape['model'], M, (W, H), flags=cv2.INTER_LINEAR)
        k = cv2.warpAffine(shape['keep'], M, (W, H), flags=cv2.INTER_LINEAR)
        pen = max(0.0, abs(p[0] / s_fix - 1) - s_tol) * 10
        return float((k * (t - fsig) ** 2).sum() / max(k.sum(), 1)) + pen

    r = optimize.minimize(cost, np.zeros(4), method='Nelder-Mead', options={'xatol': 0.01, 'fatol': 1e-7, 'maxiter': 800})
    return sim_matrix(p0 + r.x * st), r.fun


def side_to_ref(sides):
    """Each side-profile head registered to the reference one (same drawing size, so mostly a shift), matching the
    face and neck with the hair of both left out."""
    ref = sides[HAIRS.index(SIDE_REF)]
    H, W = ref['rgba'].shape[:2]
    a = np.maximum(ref['rgba'][..., 3], 1e-4)
    ref_hair = ndi.binary_dilation(ref['seg']['masks']['hair'] > 0.2, iterations=8)
    roi = (ndi.binary_dilation(ref['seg']['masks']['skin'] / a > 0.5, iterations=8) & ~ref_hair).astype(np.float32)
    out = {}
    for name, sp in zip(HAIRS, sides):
        if name == SIDE_REF:
            out[name] = (np.array([[1, 0, 0], [0, 1, 0]], np.float64), 0.0)
            continue
        hm = ndi.binary_dilation(sp['seg']['masks']['hair'] > 0.2, iterations=8)
        d = side_shape(ref)['chin'] - side_shape(sp)['chin']      # start with the chins together
        init = np.array([[1, 0, d[0]], [0, 1, d[1]]], np.float64)
        M, _ = register(sp['rgba'], ref['rgba'], exclude_moving=hm, exclude_fixed=ref_hair, roi=roi, init=init)
        hw = warp(sp['rgba'], M, (W, H))
        valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & (roi > 0)
        out[name] = (M, chamfer(hw, ref['rgba'], valid)[0])
    return out


def pose_layout(cells, mains):
    """pack.py battle layout: one scale from the bald idle body height, feet center on ANCHOR_X, feet on GROUND_Y."""
    ix0, iy0, ix1, iy1 = bbox(mains[0])
    scale = DEFAULT_IDLE_HEIGHT / (iy1 - iy0)
    out = []
    for main in mains:
        mx0, my0, mx1, my1 = bbox(main)
        out.append({'fx': feet_center(main, my0, my1), 'my1': my1})
    return scale, out


def place_pose(img, scale, lay):
    bb = alpha_bbox(img)
    crop = img[bb[1]:bb[3], bb[0]:bb[2]]
    size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
    ox = round(ANCHOR_X - (lay['fx'] - bb[0]) * scale)
    oy = round(GROUND_Y - (lay['my1'] - bb[1]) * scale)
    canvas = np.zeros((BATTLE_H, BATTLE_W, 4), np.float32)
    paste(canvas, resize(crop, size), ox, oy)
    return canvas


def build_poses(report):
    rep = report.setdefault('poses', {})
    cells, mains = split_cells(keyed('mc-poses-vanguard'), 2, 2, name='mc-poses-vanguard')
    scale, lays = pose_layout(cells, mains)
    rep['pack_scale'] = round(scale, 4)
    sides = [piece(c) for c in cells_of('mc-hair-side', 1, 4, margin=30)]
    rel = side_to_ref(sides)
    for name in HAIRS:
        rep[f'side.{name}.to_ref_chamfer_px'] = round(rel[name][1], 3)
    ref_shape = side_shape(sides[HAIRS.index(SIDE_REF)])
    out = {'scale': scale, 'layouts': lays, 'poses': {}, 'cells': cells}
    # pose crops and heads
    entries = {}
    for pose, cell in zip(POSES, cells):
        x0, y0, x1, y1 = alpha_bbox(cell)
        win = (max(0, x0 - 60), max(0, y0 - 60), min(cell.shape[1], x1 + 60), min(cell.shape[0], y1 + 60))
        crop = np.ascontiguousarray(cell[win[1]:win[3], win[0]:win[2]])
        bp = piece(crop)
        entries[pose] = {'win': win, 'base': bp, 'head': head_blob(bp), 'layers': {}}
    # one head scale shared by the four poses (they are one drawing scale), rotation and shift per pose
    hb0 = bbox(entries['idle']['head'])
    s0 = 0.9 * (hb0[3] - hb0[1]) / (ref_shape['box'][3] - ref_shape['box'][1])
    s_values = s0 * np.linspace(0.6, 1.5, 28)
    th_values = np.radians(np.arange(-60, 31, 3))
    grids = {pose: side_grid(ref_shape, e['head'], s_values, th_values) for pose, e in entries.items()}
    tot = []
    for i in range(len(s_values)):
        tot.append(sum(min((v[0] for (ii, j), v in g.items() if ii == i), default=1.0) for g in grids.values()))
    si = int(np.argmin(tot))
    s_fix = float(s_values[si])
    rep['head_scale'] = round(s_fix, 4)
    for pose, e in entries.items():
        # then each pose picks its own scale near the shared one (a lunge leans the head toward the viewer)
        s_pose = s_fix * np.linspace(0.85, 1.2, 8)
        g = side_grid(ref_shape, e['head'], s_pose, th_values)
        c0, M0 = min(g.values(), key=lambda t: t[0])
        Mref, cost = refine_side(ref_shape, e['head'], M0, float(np.hypot(M0[0, 0], M0[1, 0])))
        bp, head = e['base'], e['head']
        H, W = bp['rgba'].shape[:2]
        hb = bbox(head)
        head_reg = ndi.binary_dilation(head, structure=disk(3))
        ba = np.maximum(bp['rgba'][..., 3], 1e-4)
        lum = bp['rgba'][..., :3] @ LUM
        # occlusion: the hair may cover anything the bald head is drawn over (background, cape, an arm behind
        # the head), but not the sword and bracers (bright steel) or the hands (skin away from the head)
        steel = (bp['seg']['masks']['neutral'] / ba > 0.6) & (lum > 0.5)
        hands = (bp['seg']['masks']['skin'] / ba > 0.5) & ~head_reg
        allow = cv2.GaussianBlur((~ndi.binary_dilation(steel | hands, iterations=1)).astype(np.float32), (0, 0), 0.6)
        rep[pose] = {'head_box_raw': [hb[0], hb[1], hb[2] - hb[0], hb[3] - hb[1]],
                     'head_height_packed_px': round((hb[3] - hb[1]) * scale, 1),
                     'rotation_deg': round(float(np.degrees(np.arctan2(Mref[1, 0], Mref[0, 0]))), 2),
                     'scale': round(float(np.hypot(Mref[0, 0], Mref[1, 0])), 4), 'shape_cost': round(cost, 4)}
        for name, sp in zip(HAIRS, sides):
            M = compose(Mref, rel[name][0])
            s = float(np.hypot(M[0, 0], M[1, 0]))
            hw = warp_piece(prefilter(embolden(sp, INK_BOOST / s), s), M, (W, H))
            hm = ndi.binary_dilation(sp['seg']['masks']['hair'] > 0.2, iterations=6)
            valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & head_reg
            ch = chamfer(hw['rgba'], bp['rgba'], valid)
            r = {'face_chamfer_raw_px': round(ch[0], 3), 'face_chamfer_packed_px': round(ch[0] * scale, 3)}
            lay = hair_layer(hw, bp, report=r)
            lay = masked_piece(lay, lay['rgba'][..., 3] * allow) | {'film': lay['film'] * allow}
            r['occluded_hair_px'] = int(((1 - allow) * (hw['seg']['masks']['hair'] > 0.3)).sum())
            e['layers'][name] = lay
            rep[f'{pose}.{name}'] = r
        out['poses'][pose] = e
    return out


def pose_image(Pz, pose, hair, look=None, stats=None):
    e = Pz['poses'][pose]
    b = recolor_piece(e['base'], look, stats) if look else e['base']['rgba']
    img = b
    if hair:
        lay = e['layers'][hair]
        img = over(recolor_layer(lay, look, stats) if look else lay['rgba'], b)
    full = np.zeros_like(Pz['cells'][0])
    x0, y0, x1, y1 = e['win']
    full[y0:y1, x0:x1] = img
    return place_pose(full, Pz['scale'], Pz['layouts'][POSES.index(pose)])


# ---- G. evaluation sheets ------------------------------------------------------------------------------------------
LOOKS = [  # (skin, hair, accent, hair style, expression) for the recolored portrait sheet
    ('porcelain', 'black', 'crimson', 'crop', 'neutral'),
    ('deep', 'white', 'bone', 'topknot', 'angry'),
    ('fair', 'copper', 'teal', 'braid', 'smile'),
    ('brown', 'black', 'mustard', 'shoulder', 'hurt'),
    ('olive', 'darkbrown', 'olive', 'topknot', 'neutral'),
    ('tan', 'platinum', 'violet', 'shoulder', 'angry'),
    ('deep', 'black', 'crimson', 'braid', 'neutral'),
    ('porcelain', 'auburn', 'olive', 'shoulder', 'smile'),
    ('brown', 'teal', 'bone', 'crop', 'angry'),
    ('fair', 'blond', 'crimson', 'topknot', 'hurt'),
    ('olive', 'grey', 'teal', 'braid', 'angry'),
    ('tan', 'chestnut', 'mustard', 'crop', 'smile'),
]
TOKEN_LOOKS = [None, ('porcelain', 'black', 'teal'), ('deep', 'white', 'mustard'), ('olive', 'copper', 'violet')]
POSE_LOOKS = [('porcelain', 'black', 'crimson'), ('deep', 'platinum', 'teal'), ('tan', 'copper', 'bone')]
POSE_LOOK_HAIRS = ('braid', 'topknot', 'shoulder')
POSE_VIEW = (60, 96, 500, 372)   # the part of the 512 x 384 battle canvas the figures use, shown at 1x


def lookd(t):
    return None if t is None else {'skin': t[0], 'hair': t[1], 'accent': t[2]}


def small(rgba, size):
    return resize(rgba, (size, size))


def heat(a, b):
    """Absolute difference of two RGBA tiles (over grey) as a black-to-yellow heat map."""
    d = np.abs(flat_on(a, (0.5, 0.5, 0.5)) - flat_on(b, (0.5, 0.5, 0.5))).max(-1)
    d = np.clip(d * 2.5, 0, 1)
    return np.dstack([d, d * 0.85, d * 0.2, np.ones_like(d)])


def make_sheets(P, T, Pz, outdir, report):
    jpgs = []
    box = portrait_box(P)
    # 1. portrait grid in key colors
    rows = [[to_portrait(compose_portrait(P, h, e), box) for h in HAIRS] for e in EXPRS]
    jpgs += save_sheet('portrait-grid', sheet(rows, row_labels=EXPRS, col_labels=HAIRS, label_w=90,
                                              title='Portrait: bald expression bust + hair layer, key colors'), outdir)
    # 2. recolored combinations
    tiles, caps = [], []
    for sk, hc, ac, hs, ex in LOOKS:
        tiles.append(to_portrait(compose_portrait(P, hs, ex, {'skin': sk, 'hair': hc, 'accent': ac}), box))
        caps.append(f'{sk} / {hc} {hs} / {ac} / {ex}')
    rows = [tiles[i:i + 4] for i in range(0, 12, 4)]
    caps = [caps[i:i + 4] for i in range(0, 12, 4)]
    jpgs += save_sheet('portrait-colors', sheet(rows, captions=caps, title='Portrait: recolored combinations (skin / hair / accent / expression)'), outdir)
    # palettes on one portrait
    rows, caps = [], []
    rows.append([small(to_portrait(compose_portrait(P, 'shoulder', 'neutral', {'skin': k}), box), 192) for k in SKIN])
    caps.append(list(SKIN))
    hl = list(HAIR)
    rows.append([small(to_portrait(compose_portrait(P, 'crop', 'neutral', {'skin': 'tan', 'hair': k}), box), 192) for k in hl[:5]])
    caps.append(hl[:5])
    rows.append([small(to_portrait(compose_portrait(P, 'crop', 'neutral', {'skin': 'tan', 'hair': k}), box), 192) for k in hl[5:]])
    caps.append(hl[5:])
    rows.append([small(to_portrait(compose_portrait(P, 'braid', 'neutral', {'skin': 'fair', 'hair': 'black', 'accent': k}), box), 192) for k in ACCENT])
    caps.append(list(ACCENT))
    jpgs += save_sheet('palettes', sheet(rows, captions=caps, title='Palettes: skin (6), hair (10), accent (6)'), outdir)
    # 3. tokens
    rows, labels = [], []
    for method in ('whole', 'layered'):
        for lk in TOKEN_LOOKS:
            row = []
            for h in HAIRS:
                t = token_image(T, h, method, lookd(lk))
                row += [t, small(t, 96), small(t, 48)]
            rows.append(row)
            labels.append(f'{method}\n' + ('key colors' if lk is None else '\n'.join(lk)))
    cols = [f'{h} {s}' if s == 192 else str(s) for h in HAIRS for s in (192, 96, 48)]
    jpgs += save_sheet('tokens', sheet(rows, row_labels=labels, col_labels=cols, label_w=110,
                                       title='Tokens: whole chibi per hair (top) vs hair layer over the bald chibi (bottom)'), outdir)
    # 4. poses at packed scale
    rows, labels = [], []
    fig = lambda img: img[POSE_VIEW[1]:POSE_VIEW[3], POSE_VIEW[0]:POSE_VIEW[2]]
    rows.append([fig(pose_image(Pz, p, None)) for p in POSES])
    labels.append('bald')
    for h in HAIRS:
        rows.append([fig(pose_image(Pz, p, h)) for p in POSES])
        labels.append(h)
    for (lk, h) in zip(POSE_LOOKS, POSE_LOOK_HAIRS):
        rows.append([fig(pose_image(Pz, p, h, lookd(lk))) for p in POSES])
        labels.append(h + '\n' + '\n'.join(lk))
    jpgs += save_sheet('poses', sheet(rows, row_labels=labels, col_labels=POSES, label_w=100,
                                      title='Battle poses at packed size (512 x 384 canvas, idle body 240 px)'), outdir)
    # head close-ups of the packed poses, 1x and 4x
    rows, labels = [], []
    variants = [(None, None)] + [(h, None) for h in HAIRS] + list(zip(POSE_LOOK_HAIRS, POSE_LOOKS))
    for h, lk in variants:
        row = []
        for p in POSES:
            img = pose_image(Pz, p, h, lookd(lk))
            x0, y0, x1, y1 = head_box_packed(Pz, p)
            crop = img[max(0, y0 - 26):y1 + 6, max(0, x0 - 18):x1 + 14]
            row += [crop, cv2.resize(crop, (crop.shape[1] * 4, crop.shape[0] * 4), interpolation=cv2.INTER_NEAREST)]
        rows.append(row)
        labels.append((h or 'bald') + ('' if lk is None else '\n' + '\n'.join(lk)))
    jpgs += save_sheet('poses-heads', sheet(rows, row_labels=labels, col_labels=[f'{p} {z}' for p in POSES for z in ('1x', '4x')],
                                            label_w=80, title='Pose heads: packed size at 1x and 4x (nearest)'), outdir)
    # 5. diffs: layered portrait vs the model's own drawing of that hair
    rows, labels = [], []
    W, H = P['frame']
    for h in HAIRS:
        mine = to_portrait(compose_portrait(P, h, 'neutral'), box)
        model = to_portrait(P['warped'][h]['rgba'], box)
        # compare only where both exist above the bald bust's bottom (the model's bust is cut lower)
        hz = heat(mine, model)
        head = to_portrait(np.dstack([np.zeros((H, W, 3), np.float32), P['head_zone'][h].astype(np.float32)]), box)[..., 3]
        hz[..., :3] *= (0.25 + 0.75 * (head > 0.5))[..., None]
        rows.append([mine, model, hz])
        labels.append(h)
    jpgs += save_sheet('diff-portrait', sheet(rows, row_labels=labels, col_labels=['layered (bald + hair layer)', "model's own drawing", '|difference| (dimmed off the head)'],
                                              label_w=90, title='Portrait diff: neutral, key colors'), outdir)
    rows, labels = [], []
    for h in HAIRS:
        a = token_image(T, h, 'layered')
        b = to_token(T['warped'][h], T['k_layer'], T['bald_box'])     # the whole chibi, registered to the bald one
        rows.append([a, b, heat(a, b)])
        labels.append(h)
    jpgs += save_sheet('diff-token', sheet(rows, row_labels=labels, col_labels=['layered', 'whole chibi (registered)', '|difference|'], label_w=90,
                                           title='Token diff (192 px): hair layer on the bald chibi vs the whole chibi'), outdir)
    return jpgs


def head_box_packed(Pz, pose):
    e = Pz['poses'][pose]
    x0, y0, x1, y1 = bbox(e['head'])
    wx, wy = e['win'][0], e['win'][1]
    full = np.zeros(Pz['cells'][0].shape[:2], np.float32)
    full[wy + y0:wy + y1, wx + x0:wx + x1] = 1
    rgba = np.zeros(Pz['cells'][0].shape, np.float32)
    rgba[..., 3] = full
    bb = alpha_bbox(Pz['cells'][POSES.index(pose)])
    lay = Pz['layouts'][POSES.index(pose)]
    k = Pz['scale']
    ox = round(ANCHOR_X - (lay['fx'] - bb[0]) * k)
    oy = round(GROUND_Y - (lay['my1'] - bb[1]) * k)
    return (round(ox + (wx + x0 - bb[0]) * k), round(oy + (wy + y0 - bb[1]) * k),
            round(ox + (wx + x1 - bb[0]) * k), round(oy + (wy + y1 - bb[1]) * k))


def main():
    global RAW
    RAW = sys.argv[1] if len(sys.argv) > 1 else RAW
    outdir = sys.argv[2] if len(sys.argv) > 2 else OUT
    os.makedirs(outdir, exist_ok=True)
    report = {}
    print('portraits')
    P = build_portraits(report)
    print('tokens')
    T = build_tokens(report)
    print('poses')
    Pz = build_poses(report)
    print('sheets')
    jpgs = make_sheets(P, T, Pz, outdir, report)
    with open(os.path.join(outdir, 'registration.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print('wrote', os.path.join(outdir, 'registration.json'))
    return jpgs


if __name__ == '__main__':
    main()

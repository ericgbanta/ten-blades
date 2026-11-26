#!/usr/bin/env python3
"""Main character layers: key-color segmentation, recoloring, hair layers, expressions, tokens, poses.

Usage:  python3 tools/art/mc_build.py build [raw_dir] [portraits|tokens|poses...]   the game's MC layers (see below)
        python3 tools/art/mc_build.py sheets [raw_dir] [out_dir]                  contact sheets of the packed layers
        python3 tools/art/mc_build.py fixture                                     the recolor test fixture
        python3 tools/art/mc_build.py eval [raw_dir] [out_dir]                    the first layer experiment

The first half of this file is that experiment (eval), kept because the production build reuses its pieces; the
production build is in the second half. For eval:

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


def register(moving, fixed, exclude_moving=None, exclude_fixed=None, init=None, bottom_cut=0, trunc=0.35, roi=None,
             scale_bounds=None):
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
        pen = 0.0
        if scale_bounds is not None:
            pen = 10 * max(0.0, scale_bounds[0] - p[0], p[0] - scale_bounds[1])
        return float((d * w)[::step, ::step].sum() / max(w[::step, ::step].sum(), 1)) + pen

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
    cap_h = (4 + 16 * max(c.count('\n') + 1 for r in captions for c in r)) if captions else 0
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




# =====================================================================================================================
# Production build: every MC layer for both bodies, packed for runtime recoloring
# =====================================================================================================================
#
# Usage:  python3 tools/art/mc_build.py build [raw_dir]          writes src/art/mc/** and merges src/art/assets.json
#         python3 tools/art/mc_build.py sheets [raw_dir] [out]   contact sheets made from the packed files
#         python3 tools/art/mc_build.py fixture                   writes tests/fixtures/mc-recolor.json
#         python3 tools/art/mc_build.py eval [raw_dir] [out]      the layer experiment above (its evaluation sheets)
#
# Runtime format ("mc1"). Every layer is one lossless WebP twice as wide as the area it covers. The left half is the
# art: RGB is the layer's NEUTRAL part N (ink, cloth, steel; inside a key region the nearby neutral color it is mixed
# with) and A its alpha. The right half is opaque data: R = t, the pixel's membership in its key region (0..255);
# G = u, its tone in that region (0 at the base tone, 1 at the shadow tone, below 0 lighter, above 1 darker; stored
# as (u - uMin) / (uMax - uMin) * 255); B = region code * 64 (0 none, 1 skin, 2 hair, 3 accent, 4 stubble film).
# The game recolors a pixel with one lookup and one blend:
#     out = N + t * (LUT[region][G] - N)
# where LUT[region][g] is the palette tone at u (base + (shadow - base) * u, with the slope cut to 0.6 below 0),
# and the film is a constant shade of the hair color. Values are stored losslessly, so the hue of a pixel never has
# to be guessed at runtime and edges do not drift. decode() below is the reference for that math, and the fixture
# test checks that the TypeScript version gives the same pixels.
#
# Layers are built as "decompositions" in premultiplied linear channels (alpha, neutral color, membership per
# region, tone per region), so warping, resizing and stacking a hair layer onto a body are exact and only the final
# canvas is quantized.

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ART_DIR = os.path.join(REPO_ROOT, 'src', 'art')
LOOKS_PATH = os.path.join(REPO_ROOT, 'src', 'data', 'looks.json')
PROD_OUT = os.path.join(SCRATCH, 'mcprod')

BODIES = ('lean', 'broad')
EYES = ('almond', 'round', 'narrow')
HAIR_STYLES = ('crop', 'shoulder', 'braid', 'topknot', 'long', 'curls', 'ponytail', 'bob')
SCARS = ('cheek', 'brow', 'nose', 'claws', 'burn', 'tattoo')
STYLES = ('vanguard', 'duelist', 'spiritblade')

# Raw sheets per body (see tools/art/prompts/mc-*.txt for the cell orders).
SRC = {
    'lean': {
        'faces': ('mc-face-bust', 'mc-a-face2', 'mc-a-face3'),          # 2x2 neutral, angry, hurt, smile; one per eye shape
        'hair': ('mc-hair-bust', 'mc-a-hair2'),                         # 2x2 hairs 1-4, 5-8
        'scars': 'mc-a-scars',                                          # 3x2 in SCARS order
        'chibi': (('mc-hair-chibi', 4, None), ('mc-a-chibi-hair2', 5, 0)),   # (sheet, cells, index of the bald one)
        'styles': 'mc-a-chibi-styles',                                  # 1x3 bald chibis in STYLES order
        'poses': {'vanguard': 'mc-poses-vanguard', 'duelist': 'mc-a-poses-duelist', 'spiritblade': 'mc-a-poses-spirit'},
    },
    'broad': {
        'faces': ('mc-b-face1', 'mc-b-face2', 'mc-b-face3'),
        'hair': ('mc-b-hair1', 'mc-b-hair2'),
        'scars': 'mc-b-scars',
        'chibi': (('mc-b-chibi-hair1', 5, 0), ('mc-b-chibi-hair2', 5, 0)),
        'styles': 'mc-b-chibi-styles',
        'poses': {'vanguard': 'mc-b-poses-vanguard', 'duelist': 'mc-b-poses-duelist', 'spiritblade': 'mc-b-poses-spirit'},
    },
}
SIDE_SHEETS = ('mc-hair-side', 'mc-hair-side2')     # side-profile hair heads 1-4 and 5-8, shared by both bodies

with open(LOOKS_PATH) as _f:
    LOOKS = json.load(_f)
RC = LOOKS['recolor']
U_MIN, U_MAX = RC['uMin'], RC['uMax']
CODES = {'skin': 1, 'hair': 2, 'accent': 3, 'film': 4}
NCH = 11            # A, P (3), T skin hair accent film (4), U skin hair accent (3)


# ---- decompositions ----------------------------------------------------------------------------------------------
def dec_of(p, stats):
    """Premultiplied decomposition of a piece (see the format note above). `stats` maps a region to its source
    (base, shadow) luminance, which fixes where u = 0 and u = 1."""
    rgba = p['rgba']
    rgb, a = rgba[..., :3], rgba[..., 3]
    seg = p['seg']
    N = seg['N']
    S = np.zeros(a.shape + (NCH,), np.float32)
    S[..., 0] = a
    asafe = np.maximum(a, 1e-4)
    tsum = np.zeros(a.shape, np.float32)
    for i, r in enumerate(REGIONS):
        T = np.minimum(seg['masks'][r], a)
        st = stats.get(r)
        if st is None or not T.any():
            continue
        t = T / asafe
        bl, sl = st
        span = max(bl - sl, 1e-3)
        uF = (bl - seg['flats'][r] @ LUM) / span
        tt = np.maximum(t, 1e-3)[..., None]
        C = (rgb - (1 - tt) * N) / tt
        uC = (bl - C @ LUM) / span
        w = np.clip((t - 0.3) / 0.4, 0, 1)
        u = uF + w * (uC - uF)
        # inside a flat tone keep that tone's exact value (smaller files, no pixel noise in the shading)
        u = np.clip(np.where((t > 0.9) & (np.abs(uC - uF) < 0.25), uF, u), U_MIN, U_MAX)
        S[..., 4 + i] = T
        S[..., 8 + i] = T * u
        tsum += t
    tsum = np.clip(tsum, 0, 1)
    neutral = np.where(tsum[..., None] > 0, (1 - tsum)[..., None] * N, rgb)
    film = p.get('film')
    if film is not None and film.max() > 0:
        f = film > 0
        S[..., 7] = np.where(f, a, 0)
        neutral = np.where(f[..., None], 0, neutral)
    S[..., 1:4] = a[..., None] * neutral
    return S


def clip_dec(S):
    A = np.clip(S[..., 0], 0, 1)
    S[..., 0] = A
    S[..., 1:4] = np.clip(S[..., 1:4], 0, A[..., None])
    S[..., 4:8] = np.clip(S[..., 4:8], 0, A[..., None])
    T = S[..., 4:7]
    S[..., 8:11] = np.clip(S[..., 8:11], U_MIN * T, U_MAX * T)
    return S


def warp_dec(S, M, size, interp=cv2.INTER_CUBIC):
    out = np.zeros((size[1], size[0], NCH), np.float32)
    for c0 in range(0, NCH, 4):
        c1 = min(NCH, c0 + 4)
        out[..., c0:c1] = cv2.warpAffine(np.ascontiguousarray(S[..., c0:c1]), M.astype(np.float64), size, flags=interp,
                                         borderMode=cv2.BORDER_CONSTANT, borderValue=0).reshape(size[1], size[0], c1 - c0)
    return clip_dec(out)


def over_dec(top, bottom):
    return top + bottom * (1 - top[..., 0:1])


def mask_dec(S, m):
    """Scale a decomposition's coverage by m (0..1): every channel is premultiplied, so all scale together."""
    return S * m[..., None]


def resize_dec(S, size):
    """Lanczos resize of every channel (they are premultiplied, so this is the same as pack.resize)."""
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(S[..., k])).resize(size, Image.LANCZOS)) for k in range(NCH)]
    return clip_dec(np.stack(chans, -1).astype(np.float32))


def place_dec(S, window, k, canvas_wh, origin):
    """Crop the frame to `window` (x0, y0, x1, y1), scale by k and paste with its top-left corner at `origin` on an
    empty canvas. Every layer of one set uses the same window, so they stay registered after the resize."""
    x0, y0, x1, y1 = window
    crop = S[y0:y1, x0:x1]
    size = (max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k)))
    canvas = np.zeros((canvas_wh[1], canvas_wh[0], NCH), np.float32)
    paste(canvas, resize_dec(crop, size), origin[0], origin[1])
    return canvas


def nearest_fill(rgb, valid):
    if valid.all() or not valid.any():
        return rgb
    _, (iy, ix) = ndi.distance_transform_edt(~valid, return_indices=True)
    return rgb[iy, ix]


def encode(S):
    """Quantize a canvas decomposition to the mc1 art (RGBA) and data (RGB) arrays, uint8."""
    A = S[..., 0]
    As = np.maximum(A, 1e-4)
    T = S[..., 4:8]
    tmax = T.max(-1) / As
    reg = T.argmax(-1)
    has = (tmax > 0.02) & (A > 1 / 512)
    tsum = np.where(has, np.clip(T.sum(-1) / As, 0, 1), 0)
    Tr = np.take_along_axis(S[..., 4:7], np.minimum(reg, 2)[..., None], -1)[..., 0]
    Ur = np.take_along_axis(S[..., 8:11], np.minimum(reg, 2)[..., None], -1)[..., 0]
    u = np.where((reg < 3) & (Tr > 1e-6), Ur / np.maximum(Tr, 1e-6), 0)
    u = np.where(has & (reg < 3), np.clip(u, U_MIN, U_MAX), 0)
    rest = np.maximum(As * (1 - tsum), 1e-4)
    N = np.clip(S[..., 1:4] / rest[..., None], 0, 1)
    N = nearest_fill(N, (1 - tsum > 0.05) & (A > 0.02))
    vis = A > 1 / 512
    art = np.zeros(A.shape + (4,), np.uint8)
    art[..., :3] = np.round(N * 255)
    art[..., 3] = np.round(A * 255)
    art[art[..., 3] == 0] = 0
    data = np.zeros(A.shape + (3,), np.uint8)
    data[..., 0] = np.round(tsum * 255)
    data[..., 1] = np.where(has & (reg < 3), np.round((u - U_MIN) / (U_MAX - U_MIN) * 255), 0)
    code = np.where(has, reg + 1, 0)
    data[..., 2] = np.minimum(code * 64, 255)
    data[~vis | (art[..., 3] == 0)] = 0
    return art, data


# ---- the runtime recolor, as reference ---------------------------------------------------------------------------
def hex01(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float64) / 255


def palette_of(look):
    """look: {skin, hairColor, accent} ids -> {code: (base, shadow)} plus the film color."""
    def find(group, i):
        e = next(x for x in LOOKS[group] if x['id'] == i)
        return hex01(e['base']), hex01(e['shadow'])
    return {1: find('skins', look['skin']), 2: find('hairColors', look['hairColor']), 3: find('accents', look['accent'])}


def build_luts(look):
    """LUT[code] is a (256, 3) float array: the palette tone for each stored u. Code 0 is unused, 4 is the film."""
    pal = palette_of(look)
    g = np.arange(256, dtype=np.float64) / 255
    u = U_MIN + g * (U_MAX - U_MIN)
    k = np.where(u < 0, u * RC['highlightSlope'], u)[:, None]
    luts = np.zeros((5, 256, 3))
    for code, (b, s) in pal.items():
        luts[code] = np.clip(b + (s - b) * k, 0, 1)
    luts[4] = pal[2][1] * RC['filmShade']
    return luts


def decode(art, data, look):
    """The runtime recolor (src/art/mc/recolor.ts does the same): uint8 art + data -> uint8 RGBA."""
    luts = build_luts(look)
    N = art[..., :3].astype(np.float64) / 255
    t = data[..., 0].astype(np.float64) / 255
    code = np.clip(np.round(data[..., 2] / 64).astype(int), 0, 4)
    lut = luts[code, data[..., 1]]
    out = np.where((code > 0)[..., None], N + t[..., None] * (lut - N), N)
    res = np.zeros(art.shape, np.uint8)
    res[..., :3] = np.clip(np.round(out * 255), 0, 255)
    res[..., 3] = art[..., 3]
    return res


def key_view(art, data):
    """The layer in its key colors (as drawn), for checking a packed file without a palette."""
    return decode(art, data, {'skin': 'tan', 'hairColor': 'black', 'accent': 'crimson'})


# ---- files and manifest entries ----------------------------------------------------------------------------------
ART_QUALITY = 90


def write_layer(S, rel, canvas_wh, extra=None):
    """Encode a canvas decomposition, crop it to its visible pixels and save it as two WebP files: the art (lossy,
    with lossless alpha) at `rel` and the data (lossless) next to it as `<name>.data.webp`. Returns the manifest
    entry, or None for an empty layer."""
    art, data = encode(S)
    vis = art[..., 3] > 0
    if not vis.any():
        return None
    x0, y0, x1, y1 = bbox(vis)
    w, h = x1 - x0, y1 - y0
    data_rel = rel[:-len('.webp')] + '.data.webp'
    for r in (rel, data_rel):
        os.makedirs(os.path.dirname(os.path.join(ART_DIR, r)), exist_ok=True)
    Image.fromarray(np.ascontiguousarray(art[y0:y1, x0:x1]), 'RGBA').save(
        os.path.join(ART_DIR, rel), 'WEBP', quality=ART_QUALITY, method=6, alpha_quality=100)
    Image.fromarray(np.ascontiguousarray(data[y0:y1, x0:x1]), 'RGB').save(
        os.path.join(ART_DIR, data_rel), 'WEBP', lossless=True, quality=100, method=6, exact=True)
    entry = {'path': rel, 'width': canvas_wh[0], 'height': canvas_wh[1], 'bbox': [x0, y0, w, h],
             'layer': {'encoding': 'mc1', 'rect': [x0, y0, w, h], 'data': data_rel}}
    if extra:
        entry.update(extra)
    return entry


def entry_bytes(e):
    n = os.path.getsize(os.path.join(ART_DIR, e['path']))
    if e.get('layer'):
        n += os.path.getsize(os.path.join(ART_DIR, e['layer']['data']))
    return n


def read_layer(entry):
    """(art, data, rect) of a packed layer."""
    art = np.asarray(Image.open(os.path.join(ART_DIR, entry['path'])).convert('RGBA'))
    data = np.asarray(Image.open(os.path.join(ART_DIR, entry['layer']['data'])).convert('RGB'))
    return art, data, tuple(entry['layer']['rect'])


# ---- shared helpers ----------------------------------------------------------------------------------------------
def prod_tone_stats(seg, name):
    """Source (base, shadow) luminance of a key region: the most common flat tone, and the darkest tone that covers
    at least 1 percent as much (the drawn cel shadow; lighter in-between clusters are anti-aliasing)."""
    tl = seg['tones'].get(name)
    if not tl:
        return None
    base = float(tl[0][0] @ LUM)
    cands = [float(c @ LUM) for c, n in tl[1:] if float(c @ LUM) < 0.8 * base and n >= 0.01 * tl[0][1]]
    return base, (min(cands) if cands else 0.6 * base)


def piece_stats(p, fallback=None):
    out = dict(fallback or {})
    for r in REGIONS:
        st = prod_tone_stats(p['seg'], r)
        if st and (p['seg']['masks'][r] > 0.5).sum() > 150:
            out[r] = st
    return out


def prod_piece(rgba):
    """piece() plus one fix: small specks of accent red inside the skin (a reddish cel shadow on a cheek, a drawn
    scratch) are skin, not scarf. Accent components much smaller than the largest one that sit mostly in skin are
    moved to the skin region, so they follow the skin tone."""
    p = piece(rgba)
    m = p['seg']['masks']
    a = np.maximum(rgba[..., 3], 1e-4)
    acc = m['accent'] / a > 0.3
    lab, n = ndi.label(ndi.binary_dilation(acc, iterations=1))
    if n:
        area = np.bincount(lab.ravel())
        area[0] = 0
        big = area.max()
        for i in np.nonzero((area > 0) & (area < max(80, 0.05 * big)))[0]:
            comp = lab == i
            ring = ndi.binary_dilation(comp, iterations=3) & ~comp
            if (m['skin'][ring] / a[ring] > 0.3).mean() > 0.3:
                region = comp & (m['accent'] > 0)
                m['skin'] = np.where(region, m['skin'] + m['accent'], m['skin'])
                m['accent'] = np.where(region, 0, m['accent'])
    return p


def layer_dec(lay, stats):
    """Decomposition of a hair layer piece (from hair_layer: its alpha already cut to the selection, plus film)."""
    return dec_of(lay, stats)


def warp_film(lay, M, size):
    return warp_mask(lay['film'], M, size) if lay.get('film') is not None else None


def soft(mask, sigma=0.8):
    return np.clip(cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma), 0, 1)


def robust_diff(a, b, r=2):
    """Per pixel luminance difference of two aligned drawings that forgives a shift of up to r px either way (thin
    lines that moved a little are not a difference)."""
    la = flat_on(a, (0.5, 0.5, 0.5)) @ LUM
    lb = flat_on(b, (0.5, 0.5, 0.5)) @ LUM
    fp = disk(r)
    lo_b, hi_b = ndi.grey_erosion(lb, footprint=fp), ndi.grey_dilation(lb, footprint=fp)
    lo_a, hi_a = ndi.grey_erosion(la, footprint=fp), ndi.grey_dilation(la, footprint=fp)
    d1 = np.maximum(lo_b - la, 0) + np.maximum(la - hi_b, 0)      # a outside b's local range
    d2 = np.maximum(lo_a - lb, 0) + np.maximum(lb - hi_a, 0)
    return np.maximum(d1, d2)


# ---- portraits ---------------------------------------------------------------------------------------------------
def translation(dx, dy):
    return np.array([[1, 0, dx], [0, 1, dy], ], np.float64)


def bottom_row(p, frac=0.3):
    """Lowest row where the bust is solid across a good part of its width (the flat bottom cut)."""
    a = p['rgba'][..., 3] > 0.5
    w = a.any(0).sum()
    rows = np.nonzero(a.sum(1) > frac * w)[0]
    return int(rows.max()) if len(rows) else a.shape[0]


def cut_below(p, y):
    a = p['rgba'][..., 3].copy()
    a[y:] = 0
    out = masked_piece(p, a)
    if p.get('film') is not None:
        f = p['film'].copy()
        f[y:] = 0
        out['film'] = f
    return out


def with_film(p, base):
    if base.get('film') is not None:
        p['film'] = base['film'] * (p['rgba'][..., 3] > 0)
    return p


def register_cross(mv, fx, **kw):
    """Register a drawing from another sheet: ORB start, and a start from the bottom-centered alpha boxes; the
    better of the two refined results wins."""
    res = [register(mv, fx, **kw)]
    mb, fb = alpha_bbox(mv), alpha_bbox(fx)
    s0 = (fb[2] - fb[0]) / max(1, mb[2] - mb[0])
    init = np.array([[s0, 0, (fb[0] + fb[2]) / 2 - s0 * (mb[0] + mb[2]) / 2], [0, s0, fb[3] - s0 * mb[3]]], np.float64)
    res.append(register(mv, fx, init=init, **kw))
    return min(res, key=lambda r: r[1])


def mat_report(M, cost=None):
    r = {'scale': round(float(np.hypot(M[0, 0], M[1, 0])), 4),
         'rotation_deg': round(float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))), 3),
         'shift_px': [round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)]}
    if cost is not None:
        r['cost'] = round(float(cost), 4)
    return r


def build_portraits_prod(body):
    rep, entries = {}, {}
    src = SRC[body]
    faces = [cells_of(s, 2, 2, margin=0) for s in src['faces']]
    fx = pad(faces[0][0], PAD, PAD, 0, PAD)
    H, W = fx.shape[:2]
    neutral = prod_piece(fx)
    band = outline_band(fx)
    skin_roi = ndi.binary_dilation(neutral['seg']['masks']['skin'] > 0.5, iterations=10)
    bases, stats = {}, {}
    for ei, eyes in enumerate(EYES):
        cells = faces[ei]
        mv0 = pad(cells[0], PAD, PAD, 0, PAD)
        if ei == 0:
            Mn, cn = np.array([[1, 0, 0], [0, 1, 0]], np.float64), 0.0
        else:
            Mn, cn = register_cross(mv0, fx, bottom_cut=40)
        for xi, expr in enumerate(EXPRS):
            if ei == 0 and xi == 0:
                bases[(eyes, expr)] = neutral
                continue
            mv = pad(cells[xi], PAD, PAD, 0, PAD)
            if xi == 0:
                M, cost = Mn, cn
            else:
                ox = CELL_ORIGIN[id(cells[xi])][0] - CELL_ORIGIN[id(cells[0])][0]
                oy = CELL_ORIGIN[id(cells[xi])][1] - CELL_ORIGIN[id(cells[0])][1]
                M, cost = register(mv, fx, bottom_cut=40, init=compose(Mn, translation(ox, oy)))
            w = warp_piece(prod_piece(mv), M, (W, H))
            ch = chamfer(w['rgba'], fx, band & (np.arange(H)[:, None] < H - 40))
            rep[f'base.{eyes}.{expr}'] = {**mat_report(M, cost), 'outline_chamfer_px': round(ch[0], 3)}
            bases[(eyes, expr)] = w
        stats[eyes] = piece_stats(bases[(eyes, 'neutral')])
    cut = min(bottom_row(b) for b in bases.values()) - 2
    rep['bottom_cut_y'] = cut
    bases = {k: cut_below(b, cut) for k, b in bases.items()}
    # where the twelve faces differ from the neutral almond one: eyes, brows, mouth (and the hurt squint)
    # (lines that moved or appeared, not the small shading drift between sheets)
    diff = np.zeros((H, W), bool)
    for k, b in bases.items():
        diff |= robust_diff(b['rgba'], fx, r=2) > 0.2
    diff = ndi.binary_opening(diff, iterations=1) & ndi.binary_erosion(fx[..., 3] > 0.5, iterations=8)
    protect = ndi.binary_dilation(diff, iterations=6)
    features = ndi.binary_dilation(diff, iterations=2)
    # hair layers
    hcells = [c for s in src['hair'] for c in cells_of(s, 2, 2, margin=40)]
    hairs = {}
    for name, cell in zip(HAIR_STYLES, hcells):
        hp = prod_piece(cell)
        hm = ndi.binary_dilation(hp['seg']['masks']['hair'] > 0.2, iterations=10)
        M, cost = register(cell, fx, exclude_moving=hm, roi=skin_roi.astype(np.float32))
        hw = warp_piece(hp, M, (W, H))
        valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & skin_roi
        ch = chamfer(hw['rgba'], fx, valid)
        r = {**mat_report(M, cost), 'face_chamfer_px': round(ch[0], 3), 'face_chamfer_p90_px': round(ch[1], 3)}
        lay = hair_layer(hw, neutral, report=r, protect=protect)
        # The faces come from the bases: drop the hair cell's own copy of eyes, brows and mouth, except the ink
        # that outlines the hair itself (within 3 px of hair color).
        a = np.maximum(lay['rgba'][..., 3], 1e-4)
        hairc = lay['seg']['masks']['hair'] / a > 0.3
        drop = features & (ndi.distance_transform_edt(~hairc) > 3) & ~hairc
        keep = 1 - soft(drop, 0.6)
        film = lay['film'] * keep
        lay = masked_piece(lay, lay['rgba'][..., 3] * keep)
        lay['film'] = film
        lay = cut_below(lay, cut)
        r['dropped_feature_px'] = int(drop.sum())
        r['hair_over_features_px'] = int((hairc & diff).sum())
        hairs[name] = (lay, piece_stats(hp, stats['almond']))
        rep[f'hair.{name}'] = r
    # scars and markings: the difference from the neutral bald bust, on the skin
    scells = cells_of(src['scars'], 2, 3, margin=0)
    skin_zone = ndi.binary_dilation(neutral['seg']['masks']['skin'] > 0.5, iterations=2) & (np.arange(H)[:, None] < cut)
    scars = {}
    for name, cell in zip(SCARS, scells):
        mv = pad(cell, PAD, PAD, 0, PAD)
        M, cost = register_cross(mv, fx, bottom_cut=40, roi=skin_roi.astype(np.float32))
        sw = warp_piece(prod_piece(mv), M, (W, H))
        d = robust_diff(sw['rgba'], fx)
        sa = np.maximum(sw['rgba'][..., 3], 1e-4)
        cand = (d > 0.06) & skin_zone & (sw['rgba'][..., 3] > 0.9) & (sw['seg']['masks']['accent'] / sa < 0.2)
        cand = ndi.binary_opening(cand, iterations=1)
        lab, n = ndi.label(cand, structure=np.ones((3, 3)))
        if n:
            area = np.bincount(lab.ravel())
            big = area >= 20
            big[0] = False
            cand = big[lab]
        cand = ndi.binary_closing(cand, structure=disk(2))
        hit = cand & diff
        r = {**mat_report(M, cost), 'mark_px': int(cand.sum()), 'over_features_px': int(hit.sum())}
        cand &= ~ndi.binary_dilation(diff, iterations=1)
        m = soft(ndi.binary_dilation(cand, iterations=1), 0.7)
        lay = masked_piece(sw, sw['rgba'][..., 3] * m)
        scars[name] = (lay, piece_stats(sw, stats['almond']))
        rep[f'scar.{name}'] = r
    # Every base is the same bust below the face, so the bust is shipped once (the almond neutral one) and each
    # face as a layer cut to the head: the head and neck skin of all twelve faces, grown to take in their outline,
    # with a soft edge where the drawings are the same anyway.
    head = np.zeros((H, W), bool)
    for b in bases.values():
        hb = head_blob(b)
        head |= hb
    head = ndi.binary_dilation(head, structure=disk(10)) & (np.arange(H)[:, None] < cut)
    head_soft = np.clip(cv2.GaussianBlur(ndi.binary_erosion(head, iterations=3).astype(np.float32), (0, 0), 2.0), 0, 1)
    rep['face_zone_px'] = int(head.sum())
    # one placement for every layer of this body
    acc = np.zeros((H, W), bool)
    for b in bases.values():
        acc |= b['rgba'][..., 3] > 0.03
    for lay, _ in hairs.values():
        acc |= lay['rgba'][..., 3] > 0.03
    box = bbox(acc)
    inner = PORTRAIT - 2 * PORTRAIT_MARGIN
    k = min(inner / (box[2] - box[0]), inner / (box[3] - box[1]))
    origin = ((PORTRAIT - round((box[2] - box[0]) * k)) // 2, PORTRAIT - PORTRAIT_MARGIN - round((box[3] - box[1]) * k))
    rep['portrait_scale'] = round(k, 4)
    cw = (PORTRAIT, PORTRAIT)
    # Marks a sheet drew that the reference face does not have (the broad body's narrow eyes came with a scratch on
    # the cheek): differences from the almond face of the same expression, on the skin, away from the eyes, brows
    # and mouth, are replaced by the almond face's pixels.
    fzone = np.zeros((H, W), bool)
    for x in EXPRS[1:]:
        fzone |= robust_diff(bases[('almond', x)]['rgba'], fx, r=2) > 0.2
    fzone = ndi.binary_dilation(ndi.binary_opening(fzone, iterations=1), iterations=14)
    skin_face = (ndi.binary_dilation(neutral['seg']['masks']['skin'] > 0.5, iterations=2) & head
                 & ndi.binary_erosion(fx[..., 3] > 0.5, iterations=7))
    fixes = {}
    for (eyes, expr), b in bases.items():
        if eyes == 'almond':
            continue
        ref = bases[('almond', expr)]['rgba']
        darker = (b['rgba'][..., :3] @ LUM) < (ref[..., :3] @ LUM) - 0.04
        d = (robust_diff(b['rgba'], ref, r=2) > 0.06) & skin_face & darker
        d = ndi.binary_opening(d, iterations=1)
        lab, n = ndi.label(ndi.binary_dilation(d, iterations=2))
        mark = np.zeros((H, W), bool)
        for i in range(1, n + 1):
            comp = lab == i
            if comp.sum() >= 40 and (comp & fzone).sum() < 0.2 * comp.sum():
                mark |= comp
        if mark.any():
            fixes[(eyes, expr)] = soft(ndi.binary_dilation(mark, iterations=2), 1.0)
            rep[f'base.{eyes}.{expr}']['cleaned_mark_px'] = int(mark.sum())
    bust = dec_of(bases[('almond', 'neutral')], stats['almond'])
    entries[f'mc.{body}.bust'] = write_layer(place_dec(bust, box, k, cw, origin), f'mc/{body}/bust.webp', cw)
    for (eyes, expr), b in bases.items():
        S = dec_of(b, stats[eyes])
        if (eyes, expr) in fixes:
            m = fixes[(eyes, expr)][..., None]
            S = S * (1 - m) + dec_of(bases[('almond', expr)], stats['almond']) * m
        S = mask_dec(S, head_soft)
        entries[f'mc.{body}.face.{eyes}.{expr}'] = write_layer(place_dec(S, box, k, cw, origin), f'mc/{body}/face-{eyes}-{expr}.webp', cw)
    for name, (lay, st) in hairs.items():
        S = place_dec(dec_of(lay, st), box, k, cw, origin)
        entries[f'mc.{body}.hair.{name}.portrait'] = write_layer(S, f'mc/{body}/hair-{name}-portrait.webp', cw)
    for name, (lay, st) in scars.items():
        S = place_dec(dec_of(lay, st), box, k, cw, origin)
        entries[f'mc.{body}.scar.{name}'] = write_layer(S, f'mc/{body}/scar-{name}.webp', cw)
    return entries, rep


# ---- tokens ------------------------------------------------------------------------------------------------------
TOKEN_PAD = 90


def head_roi(p):
    return ndi.binary_dilation(head_blob(p), iterations=8).astype(np.float32)


def build_tokens_prod(body):
    rep, entries = {}, {}
    src = SRC[body]
    sty_cells = cells_of(src['styles'], 1, 3, margin=30)
    sty = [prod_piece(pad(c, TOKEN_PAD, TOKEN_PAD, 0, TOKEN_PAD)) for c in sty_cells]
    sty_stats = [piece_stats(p) for p in sty]
    hair_decs = {s: {} for s in STYLES}
    names = iter(HAIR_STYLES)
    for sheet, n, bald_i in src['chibi']:
        cells = cells_of(sheet, 1, n, margin=30)
        bald_cell = cells_of('mc-a-chibi-hair2', 1, 5, margin=30)[0] if bald_i is None else cells[bald_i]
        bfx = pad(bald_cell, TOKEN_PAD, TOKEN_PAD, 0, TOKEN_PAD)
        bald = prod_piece(bfx)
        bH, bW = bfx.shape[:2]
        skin_roi = ndi.binary_dilation(bald['seg']['masks']['skin'] > 0.5, iterations=8)
        # the bald chibi of this sheet onto each style's chibi, by the head
        to_style = []
        for si, sp in enumerate(sty):
            M, cost = register_cross(bfx, sp['rgba'], roi=head_roi(sp))
            to_style.append(M)
            rep[f'{sheet}.bald_to_{STYLES[si]}'] = mat_report(M, cost)
        for i, cell in enumerate(cells):
            if i == bald_i:
                continue
            name = next(names)
            hp = prod_piece(cell)
            hm = ndi.binary_dilation(hp['seg']['masks']['hair'] > 0.2, iterations=8)
            M, cost = register(cell, bfx, exclude_moving=hm, roi=skin_roi.astype(np.float32))
            hw = warp_piece(hp, M, (bW, bH))
            valid = (warp_mask(hm.astype(np.float32), M, (bW, bH)) < 0.05) & skin_roi
            ch = chamfer(hw['rgba'], bfx, valid)
            r = {**mat_report(M, cost), 'face_chamfer_px': round(ch[0], 3)}
            lay = hair_layer(hw, bald, report=r)
            S = dec_of(lay, piece_stats(hp, sty_stats[0]))
            for si, s in enumerate(STYLES):
                sh, sw_ = sty[si]['rgba'].shape[:2]
                hair_decs[s][name] = warp_dec(S, to_style[si], (sw_, sh))
            rep[f'hair.{name}'] = r
    # one scale per body: the tallest (or widest) figure with its hair fills the token
    inner = TOKEN - 2 * TOKEN_MARGIN
    windows, k = {}, 1e9
    for si, s in enumerate(STYLES):
        base = dec_of(sty[si], sty_stats[si])
        acc = base[..., 0] > 0.03
        for S in hair_decs[s].values():
            acc |= S[..., 0] > 0.03
        x0, y0, x1, y1 = bbox(acc)
        bb = bbox(sty[si]['rgba'][..., 3] > 0.3)
        cx = (bb[0] + bb[2]) / 2
        half = max(cx - x0, x1 - cx)
        k = min(k, inner / (bb[3] - y0), (TOKEN - 8) / (2 * half))
        windows[s] = (base, (x0, y0, x1, y1), cx, bb[3])
    rep['token_scale'] = round(k, 4)
    cw = (TOKEN, TOKEN)
    for s, (base, win, cx, bottom) in windows.items():
        origin = (round(TOKEN / 2 - (cx - win[0]) * k), round(TOKEN - TOKEN_MARGIN - (bottom - win[1]) * k))
        entries[f'mc.{body}.token.{s}'] = write_layer(place_dec(base, win, k, cw, origin), f'mc/{body}/token-{s}.webp', cw)
        for name, S in hair_decs[s].items():
            entries[f'mc.{body}.hair.{name}.token.{s}'] = write_layer(place_dec(S, win, k, cw, origin),
                                                                      f'mc/{body}/hair-{name}-token-{s}.webp', cw)
    return entries, rep


# ---- poses -------------------------------------------------------------------------------------------------------
def side_pieces():
    out = []
    for s in SIDE_SHEETS:
        out += [prod_piece(c) for c in cells_of(s, 1, 4, margin=30)]
    return out


def side_rel(sides):
    """Each side-profile hair head registered to the reference one (the topknot, first sheet): the face and the
    skull, with the hair of both left out and nothing below the reference chin (the second sheet is cut there)."""
    ref = sides[HAIR_STYLES.index(SIDE_REF)]
    H, W = ref['rgba'].shape[:2]
    a = np.maximum(ref['rgba'][..., 3], 1e-4)
    ref_hair = ndi.binary_dilation(ref['seg']['masks']['hair'] > 0.2, iterations=8)
    rsh = side_shape(ref)
    rows = np.arange(H)[:, None]
    roi = (ndi.binary_dilation(ref['seg']['masks']['skin'] / a > 0.5, iterations=8) & ~ref_hair & (rows < rsh['chin'][1] + 4))
    roi = roi.astype(np.float32)
    out, rep = {}, {}
    for name, sp in zip(HAIR_STYLES, sides):
        if name == SIDE_REF:
            out[name] = np.array([[1, 0, 0], [0, 1, 0]], np.float64)
            continue
        hm = ndi.binary_dilation(sp['seg']['masks']['hair'] > 0.2, iterations=8)
        ssh = side_shape(sp)
        s0 = (rsh['box'][2] - rsh['box'][0]) / max(1, ssh['box'][2] - ssh['box'][0])
        inits = [np.array([[s0, 0, rsh['chin'][0] - s0 * ssh['chin'][0]], [0, s0, rsh['chin'][1] - s0 * ssh['chin'][1]]]),
                 np.array([[1, 0, rsh['chin'][0] - ssh['chin'][0]], [0, 1, rsh['chin'][1] - ssh['chin'][1]]])]
        best = min((register(sp['rgba'], ref['rgba'], exclude_moving=hm, exclude_fixed=ref_hair, roi=roi, init=i,
                             scale_bounds=(0.8, 1.25)) for i in inits), key=lambda r: r[1])
        M = best[0]
        hw = warp(sp['rgba'], M, (W, H))
        valid = (warp_mask(hm.astype(np.float32), M, (W, H)) < 0.05) & (roi > 0)
        out[name] = M
        rep[name] = {**mat_report(M, best[1]), 'chamfer_px': round(chamfer(hw, ref['rgba'], valid)[0], 3)}
    return out, rep


POSE_MARGIN = 160
HEAD_TILT = {'idle': (-15, 24, 3), 'windup': (-15, 24, 5), 'strike': (-15, 24, 6), 'hit': (-66, 9, -30)}   # deg: lo, hi, prior
TILT_COST = 0.004


def build_poses_prod(body, style, rel):
    rep, entries = {}, {}
    sheet = SRC[body]['poses'][style]
    cells, mains = split_cells(keyed(sheet), 2, 2, name=sheet)
    scale, lays = pose_layout(cells, mains)
    rep['pack_scale'] = round(scale, 4)
    sides = side_pieces()
    side_stats = [piece_stats(sp) for sp in sides]
    ref_shape = side_shape(sides[HAIR_STYLES.index(SIDE_REF)])
    entries_p = {}
    for pose, cell in zip(POSES, cells):
        x0, y0, x1, y1 = alpha_bbox(cell)
        m = POSE_MARGIN
        win = (max(0, x0 - m), max(0, y0 - m), min(cell.shape[1], x1 + m), min(cell.shape[0], y1 + m))
        crop = np.ascontiguousarray(cell[win[1]:win[3], win[0]:win[2]])
        bp = prod_piece(crop)
        entries_p[pose] = {'win': win, 'base': bp, 'head': head_blob(bp)}
    hb0 = bbox(entries_p['idle']['head'])
    s0 = 0.9 * (hb0[3] - hb0[1]) / (ref_shape['box'][3] - ref_shape['box'][1])
    s_values = s0 * np.linspace(0.6, 1.5, 28)
    th_values = np.radians(np.arange(-60, 31, 3))
    grids = {pose: side_grid(ref_shape, e['head'], s_values, th_values) for pose, e in entries_p.items()}
    tot = [sum(min((v[0] for (ii, j), v in g.items() if ii == i), default=1.0) for g in grids.values())
           for i in range(len(s_values))]
    s_fix = float(s_values[int(np.argmin(tot))])
    rep['head_scale'] = round(s_fix, 4)
    cw = (BATTLE_W, BATTLE_H)
    for pi, (pose, e) in enumerate(entries_p.items()):
        # A round bald head says little about its own rotation, so each pose looks in a plausible range around a
        # prior (upright for the stances, thrown back for the hit), with a small cost for leaving the prior.
        lo, hi, prior = HEAD_TILT[pose]
        s_pose = s_fix * np.linspace(0.85, 1.2, 8)
        g = side_grid(ref_shape, e['head'], s_pose, np.radians(np.arange(lo, hi + 1, 3)))
        pen = lambda M: TILT_COST * abs(np.degrees(np.arctan2(M[1, 0], M[0, 0])) - prior) / 20
        c0, M0 = min(g.values(), key=lambda t: t[0] + pen(t[1]))
        Mref, cost = refine_side(ref_shape, e['head'], M0, float(np.hypot(M0[0, 0], M0[1, 0])))
        th = np.degrees(np.arctan2(Mref[1, 0], Mref[0, 0]))
        if not lo - 3 <= th <= hi + 3:
            Mref, cost = M0, c0
        bp, head = e['base'], e['head']
        H, W = bp['rgba'].shape[:2]
        head_reg = ndi.binary_dilation(head, structure=disk(3))
        ba = np.maximum(bp['rgba'][..., 3], 1e-4)
        lum = bp['rgba'][..., :3] @ LUM
        steel = (bp['seg']['masks']['neutral'] / ba > 0.6) & (lum > 0.5)
        hands = (bp['seg']['masks']['skin'] / ba > 0.5) & ~head_reg
        allow = cv2.GaussianBlur((~ndi.binary_dilation(steel | hands, iterations=1)).astype(np.float32), (0, 0), 0.6)
        lay_ = lays[pi]
        win = e['win']
        origin = (round(ANCHOR_X - (lay_['fx'] - win[0]) * scale), round(GROUND_Y - (lay_['my1'] - win[1]) * scale))
        full = (0, 0, W, H)
        base_S = dec_of(bp, piece_stats(bp))
        canvas = place_dec(base_S, full, scale, cw, origin)
        extra = {'groundY': GROUND_Y, 'anchorX': ANCHOR_X, 'scale': round(scale, 4)}
        entries[f'mc.{body}.pose.{style}.{pose}'] = write_layer(canvas, f'mc/{body}/pose-{style}-{pose}.webp', cw, extra)
        r0 = {**mat_report(Mref, cost), 'head_box': list(bbox(head))}
        # does the figure fit the canvas?
        fb = bbox(canvas[..., 0] > 0.03)
        r0['canvas_box'] = list(fb)
        if fb[0] <= 0 or fb[1] <= 0 or fb[2] >= BATTLE_W or fb[3] >= BATTLE_H:
            r0['warning'] = 'touches the canvas edge'
        rep[pose] = r0
        for hi, (name, sp) in enumerate(zip(HAIR_STYLES, sides)):
            M = compose(Mref, rel[name])
            s = float(np.hypot(M[0, 0], M[1, 0]))
            src = prefilter(embolden(sp, INK_BOOST / s), s)
            hw = warp_piece(src, M, (W, H))
            r = {}
            lay = hair_layer(hw, bp, report=r)
            lay2 = masked_piece(lay, lay['rgba'][..., 3] * allow)
            lay2['film'] = lay['film'] * allow
            r['occluded_hair_px'] = int(((1 - allow) * (hw['seg']['masks']['hair'] > 0.3)).sum())
            S = place_dec(dec_of(lay2, side_stats[hi]), full, scale, cw, origin)
            hb = bbox(S[..., 0] > 0.03) if (S[..., 0] > 0.03).any() else None
            if hb and (hb[0] <= 0 or hb[1] <= 0 or hb[2] >= BATTLE_W or hb[3] >= BATTLE_H):
                r['warning'] = 'hair touches the canvas edge'
            entries[f'mc.{body}.hair.{name}.pose.{style}.{pose}'] = write_layer(
                S, f'mc/{body}/hair-{name}-pose-{style}-{pose}.webp', cw, extra)
            rep[f'{pose}.{name}'] = r
    return entries, rep


# ---- contact sheets from the packed files -------------------------------------------------------------------------
def load_manifest():
    return json.load(open(os.path.join(ART_DIR, 'assets.json')))['images']


def compose_ids(images, ids, look, wh):
    """Decode and stack packed layers (first id at the bottom) on an empty canvas: float RGBA."""
    canvas = np.zeros((wh[1], wh[0], 4), np.float32)
    for i in ids:
        e = images.get(i)
        if e is None:
            continue
        art, data, (x, y, w, h) = read_layer(e)
        img = decode(art, data, look).astype(np.float32) / 255
        layer = np.zeros_like(canvas)
        layer[y:y + h, x:x + w] = img
        canvas = over(layer, canvas)
    return canvas


def portrait_ids(look, expr='neutral'):
    b = look['body']
    ids = [f'mc.{b}.bust', f"mc.{b}.face.{look['eyes']}.{expr}"]
    if look.get('scar', 'none') != 'none':
        ids.append(f"mc.{b}.scar.{look['scar']}")
    ids.append(f"mc.{b}.hair.{look['hairStyle']}.portrait")
    return ids


def token_ids(look, style):
    b = look['body']
    return [f'mc.{b}.token.{style}', f"mc.{b}.hair.{look['hairStyle']}.token.{style}"]


def pose_ids(look, style, pose):
    b = look['body']
    return [f'mc.{b}.pose.{style}.{pose}', f"mc.{b}.hair.{look['hairStyle']}.pose.{style}.{pose}"]


def ids_of(group):
    return [x['id'] for x in LOOKS[group]]


def make_prod_sheets(outdir):
    os.makedirs(outdir, exist_ok=True)
    images = load_manifest()
    rng = np.random.default_rng(7)
    key = {'skin': 'tan', 'hairColor': 'black', 'accent': 'crimson'}
    skins, hcols, accs = ids_of('skins'), ids_of('hairColors'), ids_of('accents')
    hstyles, eyes, scars = ids_of('hairStyles'), ids_of('eyes'), [s for s in ids_of('scars') if s != 'none']
    P = (PORTRAIT, PORTRAIT)
    for body in BODIES:
        # 1. hairs x eye shapes, neutral, one natural look per column
        rows, labels = [], []
        for e in eyes:
            row = []
            for i, h in enumerate(hstyles):
                lk = {'body': body, 'eyes': e, 'hairStyle': h, 'scar': 'none', 'skin': skins[i % 6],
                      'hairColor': hcols[(i * 3) % 10], 'accent': accs[i % 6]}
                row.append(small(compose_ids(images, portrait_ids(lk), lk, P), 256))
            rows.append(row)
            labels.append(e)
        # the scars on mixed skin tones, then on the other eye shapes and expressions
        row, row2 = [], []
        for i, sc in enumerate(scars):
            lk = {'body': body, 'eyes': 'almond', 'hairStyle': 'crop', 'scar': sc, 'skin': skins[i % 6],
                  'hairColor': 'black', 'accent': 'crimson'}
            row.append(small(compose_ids(images, portrait_ids(lk), lk, P), 256))
            lk2 = {**lk, 'eyes': eyes[1 + i % 2], 'skin': skins[(i + 3) % 6]}
            row2.append(small(compose_ids(images, portrait_ids(lk2, EXPRS[1 + i % 3]), lk2, P), 256))
        rows += [row, row2]
        labels += ['scars\nalmond', 'scars\nround/narrow\nangry/hurt/smile']
        save_sheet(f'portraits-{body}', sheet(rows, row_labels=labels, col_labels=hstyles, label_w=120,
                                              title=f'{body}: hair styles x eye shapes (neutral), then scars ({", ".join(scars)})'), outdir)
        # every expression and eye shape, bald, key colors, at full size, to check the faces line up
        rows = [[compose_ids(images, [f'mc.{body}.bust', f'mc.{body}.face.{e}.{x}'], key, P) for x in EXPRS] for e in eyes]
        save_sheet(f'faces-{body}', sheet(rows, row_labels=list(eyes), col_labels=EXPRS, label_w=90,
                                          title=f'{body}: bald faces, key colors'), outdir)
    # 2. random full looks
    tiles, caps = [], []
    for i in range(16):
        lk = {'body': BODIES[rng.integers(2)], 'skin': skins[rng.integers(6)], 'hairStyle': hstyles[rng.integers(8)],
              'hairColor': hcols[rng.integers(10)], 'eyes': eyes[rng.integers(3)],
              'scar': (['none'] + scars)[rng.integers(7)], 'accent': accs[rng.integers(6)]}
        ex = EXPRS[rng.integers(4)]
        tiles.append(small(compose_ids(images, portrait_ids(lk, ex), lk, P), 288))
        caps.append(f"{lk['body']} {lk['skin']} {lk['eyes']} {ex}\n{lk['hairColor']} {lk['hairStyle']}, {lk['scar']}, {lk['accent']}")
    rows = [tiles[i:i + 4] for i in range(0, 16, 4)]
    caps = [caps[i:i + 4] for i in range(0, 16, 4)]
    save_sheet('random-looks', sheet(rows, captions=caps, gap=12, title='16 random looks (seed 7)'), outdir)
    # 3. tokens
    tlooks = [key, {'skin': 'porcelain', 'hairColor': 'blond', 'accent': 'teal'},
              {'skin': 'deep', 'hairColor': 'white', 'accent': 'mustard'}, {'skin': 'olive', 'hairColor': 'auburn', 'accent': 'violet'}]
    T = (TOKEN, TOKEN)
    for body in BODIES:
        rows, labels = [], []
        for s in STYLES:
            for li, lk0 in enumerate(tlooks[:2] if s != 'vanguard' else tlooks):
                row = []
                for h in hstyles:
                    lk = {**lk0, 'body': body, 'hairStyle': h}
                    t = compose_ids(images, token_ids(lk, s), lk, T)
                    row += [t, small(t, 48)]
                rows.append(row)
                labels.append(f"{s}\n{lk0['skin']}\n{lk0['hairColor']}")
        save_sheet(f'tokens-{body}', sheet(rows, row_labels=labels, col_labels=[f'{h}' if z == 0 else '48' for h in hstyles for z in (0, 1)],
                                           label_w=100, title=f'{body}: tokens 192 and 48 px'), outdir)
    # 4. poses
    plooks = [({'skin': 'fair', 'hairColor': 'copper', 'accent': 'teal'}, 0),
              ({'skin': 'deep', 'hairColor': 'platinum', 'accent': 'crimson'}, 1),
              ({'skin': 'olive', 'hairColor': 'black', 'accent': 'bone'}, 2)]
    view = (40, 70, 512, 380)
    for body in BODIES:
        rows, labels = [], []
        for s in STYLES:
            rows.append([compose_ids(images, [f'mc.{body}.pose.{s}.{p}'], key, (BATTLE_W, BATTLE_H))[view[1]:view[3], view[0]:view[2]] for p in POSES])
            labels.append(f'{s}\nbald')
            for lk0, j in plooks:
                h = hstyles[(STYLES.index(s) * 3 + j) % 8]
                lk = {**lk0, 'body': body, 'hairStyle': h}
                rows.append([compose_ids(images, pose_ids(lk, s, p), lk, (BATTLE_W, BATTLE_H))[view[1]:view[3], view[0]:view[2]] for p in POSES])
                labels.append(f"{s}\n{h}\n{lk0['hairColor']}")
        save_sheet(f'poses-{body}', sheet(rows, row_labels=labels, col_labels=POSES, label_w=100,
                                          title=f'{body}: battle poses, packed size'), outdir)
        # every hair on every pose, heads only, key colors, 2x
        rows, labels = [], []
        for s in STYLES:
            for p in POSES:
                base = images[f'mc.{body}.pose.{s}.{p}']
                bx, by, bw, bh = base['bbox']
                row = []
                for h in hstyles:
                    lk = {**key, 'body': body, 'hairStyle': h}
                    img = compose_ids(images, pose_ids(lk, s, p), lk, (BATTLE_W, BATTLE_H))
                    hb = images.get(f'mc.{body}.hair.{h}.pose.{s}.{p}')
                    hx, hy, hw_, hh = hb['bbox'] if hb else (bx, by, bw, 60)
                    x0, y0 = max(0, min(hx, bx + bw // 3) - 8), max(0, min(hy, by) - 8)
                    x1, y1 = min(BATTLE_W, hx + hw_ + 8), min(BATTLE_H, max(hy + hh, by + 70) + 8)
                    crop = img[y0:y1, x0:x1]
                    row.append(cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2), interpolation=cv2.INTER_NEAREST))
                rows.append(row)
                labels.append(f'{s}\n{p}')
        save_sheet(f'pose-hair-{body}', sheet(rows, row_labels=labels, col_labels=hstyles, label_w=100,
                                              title=f'{body}: every hair on every pose (2x, key colors)'), outdir)


# ---- fixture for the TypeScript recolor test ---------------------------------------------------------------------
def write_fixture():
    """tests/fixtures/mc-recolor.json: pixels from packed layers (every region code, edges included) and what the
    reference decode() makes of them under a few looks, so tests/mc-recolor.test.ts can check the TypeScript math."""
    images = load_manifest()
    rng = np.random.default_rng(3)
    looks = [{'body': 'lean', 'skin': 'deep', 'hairStyle': 'topknot', 'hairColor': 'platinum', 'eyes': 'round', 'scar': 'none', 'accent': 'teal'},
             {'body': 'broad', 'skin': 'porcelain', 'hairStyle': 'long', 'hairColor': 'auburn', 'eyes': 'narrow', 'scar': 'burn', 'accent': 'bone'},
             {'body': 'lean', 'skin': 'olive', 'hairStyle': 'crop', 'hairColor': 'black', 'eyes': 'almond', 'scar': 'claws', 'accent': 'mustard'}]
    pixels = []
    for lid in ('mc.lean.bust', 'mc.lean.hair.topknot.portrait', 'mc.broad.hair.long.portrait', 'mc.broad.scar.burn',
                'mc.lean.token.duelist', 'mc.broad.pose.spiritblade.strike'):
        art, data, _ = read_layer(images[lid])
        code = np.round(data[..., 2] / 64).astype(int)
        for c in range(5):
            ys, xs = np.nonzero((code == c) & (art[..., 3] > 0))
            if not len(ys):
                continue
            for k in rng.choice(len(ys), min(6, len(ys)), replace=False):
                pixels.append({'layer': lid, 'art': art[ys[k], xs[k]].tolist(), 'data': data[ys[k], xs[k]].tolist()})
    cases = []
    for lk in looks:
        art = np.array([[p['art'] for p in pixels]], np.uint8)
        data = np.array([[p['data'] for p in pixels]], np.uint8)
        out = decode(art, data, lk)[0]
        cases.append({'look': lk, 'expected': out.tolist()})
    path = os.path.join(REPO_ROOT, 'tests', 'fixtures', 'mc-recolor.json')
    with open(path, 'w') as f:
        json.dump({'note': 'Written by tools/art/mc_build.py fixture. Pixels from packed MC layers and the reference decode.',
                   'pixels': [{'art': p['art'], 'data': p['data']} for p in pixels], 'cases': cases}, f)
        f.write('\n')
    print(f'wrote {path}: {len(pixels)} pixels x {len(cases)} looks')


# ---- build driver ------------------------------------------------------------------------------------------------
def _job(args):
    kind = args[0]
    t0 = __import__('time').time()
    if kind == 'portraits':
        e, r = build_portraits_prod(args[1])
    elif kind == 'tokens':
        e, r = build_tokens_prod(args[1])
    else:
        e, r = build_poses_prod(args[1], args[2], args[3])
    print(f'  {"/".join(str(a) for a in args[:3] if isinstance(a, str))}: {len(e)} layers, '
          f'{__import__("time").time() - t0:.0f} s', flush=True)
    return tuple(args[:3] if kind == 'poses' else args[:2]), e, r


def build_all(raw, only=None):
    """Build every MC layer into src/art/mc and merge the entries into src/art/assets.json (all `mc.` ids are
    replaced). `only` limits it to job kinds (portraits, tokens, poses) for quicker iteration."""
    global RAW
    RAW = raw
    from multiprocessing import Pool
    print('side heads')
    rel, rel_rep = side_rel(side_pieces())
    jobs = []
    for body in BODIES:
        if not only or 'portraits' in only:
            jobs.append(('portraits', body))
        if not only or 'tokens' in only:
            jobs.append(('tokens', body))
        if not only or 'poses' in only:
            jobs += [('poses', body, s, rel) for s in STYLES]
    print(f'{len(jobs)} jobs')
    with Pool(min(4, len(jobs))) as pool:
        results = pool.map(_job, jobs, chunksize=1)
    assets_path = os.path.join(ART_DIR, 'assets.json')
    manifest = json.load(open(assets_path))
    images = manifest['images']
    new = {}
    report = {'side_heads': rel_rep}
    for key_, e, r in results:
        report['.'.join(key_)] = r
        new.update({k: v for k, v in e.items() if v is not None})
    # drop the old entries this run rebuilt
    def rebuilt(k):
        parts = k.split('.')
        if parts[0] != 'mc':
            return False
        for key_, _, _ in results:
            body = key_[1]
            if parts[1] != body:
                continue
            if key_[0] == 'portraits' and (parts[2] in ('portrait', 'scar', 'bust', 'face') or parts[-1] == 'portrait'):
                return True
            if key_[0] == 'tokens' and 'token' in parts:
                return True
            if key_[0] == 'poses' and 'pose' in parts and key_[2] in parts:
                return True
        return False
    for k in [k for k in images if rebuilt(k)]:
        old = images.pop(k)
        if k not in new:
            for r in (old['path'], old.get('layer', {}).get('data')):
                if r and os.path.exists(os.path.join(ART_DIR, r)):
                    os.remove(os.path.join(ART_DIR, r))
    images.update(new)
    manifest['images'] = {k: images[k] for k in sorted(images)}
    with open(assets_path, 'w') as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write('\n')
    os.makedirs(PROD_OUT, exist_ok=True)
    with open(os.path.join(PROD_OUT, 'build-report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    total = sum(entry_bytes(v) for k, v in manifest['images'].items() if k.startswith('mc.'))
    count = sum(1 for k in manifest['images'] if k.startswith('mc.'))
    print(f'{len(new)} layers written; MC set now {count} files, {total / 1024:.0f} KB')
    print('report:', os.path.join(PROD_OUT, 'build-report.json'))


def main():
    global RAW
    args = sys.argv[1:]
    cmd = args[0] if args and args[0] in ('build', 'sheets', 'fixture', 'eval') else 'eval'
    if args and args[0] == cmd:
        args = args[1:]
    if cmd == 'build':
        only = set(a for a in args if a in ('portraits', 'tokens', 'poses'))
        rest = [a for a in args if a not in only]
        build_all(rest[0] if rest else RAW, only)
    elif cmd == 'sheets':
        RAW = args[0] if args else RAW
        make_prod_sheets(args[1] if len(args) > 1 else PROD_OUT)
    elif cmd == 'fixture':
        write_fixture()
    else:
        RAW = args[0] if args else RAW
        outdir = args[1] if len(args) > 1 else OUT
        os.makedirs(outdir, exist_ok=True)
        report = {}
        print('portraits')
        P = build_portraits(report)
        print('tokens')
        T = build_tokens(report)
        print('poses')
        Pz = build_poses(report)
        print('sheets')
        make_sheets(P, T, Pz, outdir, report)
        with open(os.path.join(outdir, 'registration.json'), 'w') as f:
            json.dump(report, f, indent=1)
        print('wrote', os.path.join(outdir, 'registration.json'))


if __name__ == '__main__':
    main()

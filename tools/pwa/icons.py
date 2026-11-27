#!/usr/bin/env python3
"""Build the app icons from packed art: the ten-blade star (src/art/ui/emblem.webp) on the dark UI background.

Usage:  python3 tools/pwa/icons.py

Writes public/icons: icon-192.png, icon-512.png, icon-maskable-512.png (the star kept inside the central 80 percent
circle that Android masks to), apple-touch-icon.png (180, full bleed; iOS rounds the corners itself) and
favicon-48.png. No new art is drawn: the background is the page color with the same crimson glow the title uses,
and the star gets the title's dark drop shadow and red glow. Run it again if the emblem changes.
"""
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EMBLEM = os.path.join(ROOT, 'src', 'art', 'ui', 'emblem.webp')
OUT = os.path.join(ROOT, 'public', 'icons')

BG = (17, 13, 18)          # --c-bg
GLOW_CENTER = (52, 20, 26)  # a little warmer than the title gradient's #2a1418, so it reads at icon size
RED_GLOW = (198, 58, 64)   # --c-crimson-hi, as in the title emblem's drop-shadow

# (file, size, star size as a share of the icon)
ICONS = [
    ('icon-192.png', 192, 0.74),
    ('icon-512.png', 512, 0.74),
    ('icon-maskable-512.png', 512, 0.62),
    ('apple-touch-icon.png', 180, 0.70),
    ('favicon-48.png', 48, 0.92),
]


def background(size):
    """The page color with a soft round crimson glow in the middle."""
    img = Image.new('RGB', (size, size), BG)
    glow = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(glow)
    r = size * 0.42
    c = size / 2
    d.ellipse((c - r, c - r, c + r, c + r), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.16))
    img.paste(Image.new('RGB', (size, size), GLOW_CENTER), (0, 0), glow)
    return img


def star(size, share):
    """The emblem scaled to share x size, with its shadow and glow, on a transparent canvas of the icon size."""
    src = Image.open(EMBLEM).convert('RGBA')
    s = max(1, round(size * share))
    em = src.resize((s, s), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    off = ((size - s) // 2, (size - s) // 2)
    alpha = Image.new('L', (size, size), 0)
    alpha.paste(em.getchannel('A'), off)
    # Red glow, then a hard dark shadow a little below, then the star.
    glow_a = alpha.filter(ImageFilter.GaussianBlur(max(1, size * 0.04)))
    glow_a = glow_a.point(lambda v: int(v * 0.7))
    canvas.paste(Image.new('RGBA', (size, size), RED_GLOW + (255,)), (0, 0), glow_a)
    shadow = ImageChops.offset(alpha, 0, max(1, round(size * 0.012)))
    canvas.paste(Image.new('RGBA', (size, size), (0, 0, 0, 255)), (0, 0), shadow)
    canvas.alpha_composite(em, off)
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, share in ICONS:
        img = background(size).convert('RGBA')
        img.alpha_composite(star(size, share))
        img.convert('RGB').save(os.path.join(OUT, name), optimize=True)
        print(f'{name}: {size} px, {os.path.getsize(os.path.join(OUT, name))} bytes')


if __name__ == '__main__':
    main()

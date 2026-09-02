#!/usr/bin/env python3
"""
Builds a controlled restoration test from a photograph you already have.

A random old photo tells you whether the output *looks* nicer. It cannot tell
you whether the model recovered the real face or invented a plausible different
one — and that distinction is the entire product promise.

So instead: take a sharp photo, damage it in known ways, restore the damaged
copy, and compare against the original you kept. Now "did it work" has an
answer instead of an opinion.

    python3 scripts/degrade.py my-photo.jpg
    python3 scripts/degrade.py my-photo.jpg --out ./test-photos
"""

import argparse
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


def blurry(im):
    """Missed focus or a shaking hand — the most common complaint."""
    return im.filter(ImageFilter.GaussianBlur(radius=max(1.6, min(im.size) / 260)))


def noisy(im):
    """Shot in the dark: heavy sensor grain over a soft image."""
    im = im.filter(ImageFilter.GaussianBlur(radius=0.9))
    pixels = im.load()
    width, height = im.size
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y][:3]
            n = random.gauss(0, 26)
            pixels[x, y] = (
                max(0, min(255, int(r + n))),
                max(0, min(255, int(g + random.gauss(0, 26)))),
                max(0, min(255, int(b + random.gauss(0, 26)))),
            )
    return im


def lowres(im):
    """Forwarded through chat apps until only a thumbnail survived."""
    small = im.resize((max(1, im.width // 6), max(1, im.height // 6)), Image.BILINEAR)
    return small.resize(im.size, Image.BILINEAR)


def compressed(im, out_path):
    """The classic 'forwarded twenty times' look: JPEG eating itself."""
    working = im
    for quality in (16, 12, 9):
        working.save(out_path, "JPEG", quality=quality)
        working = Image.open(out_path).convert("RGB")
    return working


def aged(im):
    """A print left in a drawer for forty years: faded, warm, scratched, vignetted."""
    im = ImageEnhance.Color(im).enhance(0.32)
    im = ImageEnhance.Contrast(im).enhance(0.74)

    sepia = Image.new("RGB", im.size, (196, 158, 108))
    im = Image.blend(im, sepia, 0.24)

    draw = ImageDraw.Draw(im)
    for _ in range(11):
        x = random.randint(0, im.width)
        y = random.randint(0, im.height)
        draw.line(
            [(x, y), (x + random.randint(-70, 70), y + random.randint(-160, 160))],
            fill=(232, 226, 210),
            width=random.choice([1, 1, 2]),
        )

    # Vignette: darkest at the corners, untouched in the middle.
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse(
        [-im.width * 0.18, -im.height * 0.18, im.width * 1.18, im.height * 1.18], fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=min(im.size) / 9))
    return Image.composite(im, ImageEnhance.Brightness(im).enhance(0.55), mask)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--out", default="./test-photos")
    parser.add_argument("--seed", type=int, default=7, help="fixed so runs are comparable")
    args = parser.parse_args()

    random.seed(args.seed)
    source = Path(args.source)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    original = Image.open(source).convert("RGB")
    # Cap the source so the damage reads at a realistic scale.
    if max(original.size) > 1400:
        ratio = 1400 / max(original.size)
        original = original.resize(
            (int(original.width * ratio), int(original.height * ratio)), Image.LANCZOS
        )

    stem = source.stem
    original.save(out / f"{stem}-00-original.jpg", "JPEG", quality=95)
    print(f"الأصل محفوظ للمقارنة → {stem}-00-original.jpg  ({original.width}×{original.height})")

    for label, build in (
        ("blurry", blurry),
        ("noisy", noisy),
        ("lowres", lowres),
        ("aged", aged),
    ):
        path = out / f"{stem}-{label}.jpg"
        build(original.copy()).save(path, "JPEG", quality=88)
        print(f"  {label:<10} → {path.name}")

    path = out / f"{stem}-compressed.jpg"
    compressed(original.copy(), path)
    print(f"  compressed → {path.name}")

    print(f"\n✅ خمس نسخ تالفة في {out}/ — والأصل محفوظ للمقارنة")


if __name__ == "__main__":
    main()

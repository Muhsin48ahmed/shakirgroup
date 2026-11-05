"""Write the smaller and lighter copies of the Shakir Foam page images.

Usage: python3 tools/foam_variants.py [--force]

--force rewrites every copy, even those newer than their JPEG.

Reads the JPEGs already in the repo (the original studio photos are not
kept) and writes, next to each one:
  <name>.<fmt>          the same size in a lighter format
  <name>-<side>.<fmt>   a smaller copy, <side> px on its long side
For the photos <fmt> is avif and webp, and the smaller copies also get a
JPEG for browsers that read neither. Cover textures get webp only, since
the 3D viewer picks one format in script rather than through <picture>.

  img/products/<slug>.jpg                 card photos, 720 px square
  img/products/foam/<slug>-<n>.jpg        gallery photos, 1400 px long side
  img/products/foam/tex/<slug>-top.jpg    3D cover textures, 2048 px
  img/products/foam/tex/<slug>-side.jpg   3D edge textures, 2048 x 256
  the award photos on the foam page       same size, lighter formats only

A copy is only rewritten when its JPEG is newer, so a second run changes
nothing. Run it after tools/foam_images.py and before tools/foam_catalog.py,
which only links the copies that exist.
"""
import glob
import os
import re
import sys

from PIL import Image

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AWARDS = ["img/award-easa-2026.jpg", "img/awards/soba-2024-stage.jpg", "img/awards/soba-2022-foam.jpg"]

CARD_SIZES = (360,)          # phones show two cards a row, about 180 css px each
GALLERY_SIZES = (320, 700)   # viewer thumbnails (64 css px, cropped square), phone stage
TEXTURE_SIZES = (1024,)      # the phone tier of the 3D covers
PHOTO_FORMATS = ("avif", "webp")
TEXTURE_FORMATS = ("webp",)
QUALITY = {"jpg": 78, "webp": 82, "avif": 60}   # matched by SSIM: AVIF 60 ≈ WebP 82 ≈ JPEG 82
TEXTURE_JPEG_QUALITY = 82                        # what tools/foam_images.py writes textures at
AVIF_SPEED = 4

GALLERY_PHOTO = re.compile(r"-[1-9]\.jpg$")


def jobs(site):
    """(source JPEG, smaller long sides, formats, JPEG quality) for every image the page uses."""
    products = os.path.join(site, "img", "products")
    textures = os.path.join(products, "foam", "tex")
    gallery = sorted(p for p in glob.glob(os.path.join(products, "foam", "*.jpg")) if GALLERY_PHOTO.search(p))
    slugs = sorted({GALLERY_PHOTO.sub("", os.path.basename(p)) for p in gallery})
    cards = [p for p in (os.path.join(products, f"{s}.jpg") for s in slugs) if os.path.exists(p)]
    covers = sorted(glob.glob(os.path.join(textures, "*-top.jpg")) + glob.glob(os.path.join(textures, "*-side.jpg")))
    awards = [os.path.join(site, p) for p in AWARDS]
    missing = [p for p in awards if not os.path.exists(p)]
    if missing:
        raise SystemExit(f"award photo not found: {', '.join(missing)}")
    return ([(p, CARD_SIZES, PHOTO_FORMATS, QUALITY["jpg"]) for p in cards]
            + [(p, GALLERY_SIZES, PHOTO_FORMATS, QUALITY["jpg"]) for p in gallery]
            + [(p, TEXTURE_SIZES, TEXTURE_FORMATS, TEXTURE_JPEG_QUALITY) for p in covers]
            + [(p, (), PHOTO_FORMATS, QUALITY["jpg"]) for p in awards])


def save(img, path, fmt, jpeg_quality):
    if fmt == "jpg":
        img.save(path, "JPEG", quality=jpeg_quality, optimize=True, progressive=True)
    elif fmt == "webp":
        img.save(path, "WEBP", quality=QUALITY["webp"], method=6)
    else:
        img.save(path, "AVIF", quality=QUALITY["avif"], speed=AVIF_SPEED)


def is_fresh(out, src):
    return os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src)


def copies(src, sizes, formats):
    """(output path, long side or None for full size, format) for one source JPEG."""
    base = src[: -len(".jpg")]
    full = [(f"{base}.{fmt}", None, fmt) for fmt in formats]
    smaller = [(f"{base}-{side}.{fmt}", side, fmt) for side in sizes for fmt in (*formats, "jpg")]
    return full + smaller


def write_copies(src, sizes, formats, jpeg_quality, force):
    todo = [c for c in copies(src, sizes, formats) if force or not is_fresh(c[0], src)]
    if not todo:
        return 0
    with Image.open(src) as opened:
        original = opened.convert("RGB")
    for out, side, fmt in todo:
        img = original
        if side and max(original.size) > side:
            img = original.copy()
            img.thumbnail((side, side), Image.LANCZOS)
        save(img, out, fmt, jpeg_quality)
    return len(todo)


def main(site=SITE, force=False):
    written = sum(write_copies(*job, force) for job in jobs(site))
    print(f"{written} image copies written" if written else "image copies up to date")


if __name__ == "__main__":
    main(force="--force" in sys.argv[1:])

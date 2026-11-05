"""Cut Shakir Foam product photos into gallery images and 3D textures.

Usage: python3 tools/foam_images.py <raw-dir> <site-dir>

<raw-dir> holds the original photos from foam.shakirgroup.com/images/,
named p<folder>-<n>.jpg (for example p23-1.jpg). For each product this writes
  img/products/foam/<slug>-<n>.jpg     gallery photos, 1400 px long side
  img/products/foam/tex/<slug>-top.jpg the straight-on face, cropped
  img/products/foam/tex/<slug>-side.jpg the edge, cropped and laid flat
"""
import os
import sys
from PIL import Image, ImageOps, ImageFilter

GALLERY_SIDE = 1400
TEXTURE_SIDE = 1024
SIDE_TEXTURE_HEIGHT = 160
BG_DISTANCE = 34          # colour distance that counts as "not background"
STRIP_FILL = 0.6          # share of an edge-strip column that must be mattress
STRIP_ROW_SHARE = 0.9     # an edge-strip row must be this close to the fullest row
FILL_SHARE = 0.5          # share of the fullest row/column that counts as mattress

# folder -> (slug, face photo, edge photo); None when the angle was never shot
PRODUCTS = {
    2: ("shakir-15-120x190", None, None),
    3: ("shakir-15-150", 3, None),
    4: ("shakir-15-180x190", 1, None),
    5: ("shakir-20-180x200", 3, None),
    6: ("shakir-15-90x190-damask", 3, 1),
    7: ("shakir-12-90x190-floral", 2, 4),
    8: ("shakir-15-90x190-olive", 2, 1),
    9: ("shakir-12-90x190-red", 2, 4),
    20: ("comfort-25-150x190", 1, 3),
    21: ("comfort-20-120x190", 2, 4),
    22: ("sweetdream-20-90x190", 2, 4),
    23: ("sweetdream-30-180x200", 1, 3),
    24: ("sweetdream-25-180x200", 2, 4),
    25: ("sweetdream-20-180x200", 1, 3),
}


# extra trim on a face crop, as (left, right) shares of its width, where the
# straight-on photo also caught a strip of the mattress side
FACE_TRIM = {
    "shakir-12-90x190-floral": (0.15, 0.0),
    "shakir-15-90x190-olive": (0.0, 0.11),
}

# extra trim on an edge strip after the automatic pass, as
# (left, top, right, bottom) shares, where the backdrop fooled it
SIDE_TRIM = {
    "shakir-12-90x190-floral": (0.05, 0.06, 0.04, 0.06),
    "shakir-15-90x190-olive": (0.04, 0.46, 0.0, 0.03),
}


def trim(img, left, top, right, bottom):
    return img.crop((int(img.width * left), int(img.height * top),
                     int(img.width * (1 - right)), int(img.height * (1 - bottom))))


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def median(colours):
    return tuple(sorted(c[i] for c in colours)[len(colours) // 2] for i in range(3))


def distance(a, b):
    return sum(abs(a[i] - b[i]) for i in range(3))


def mattress_box(img):
    """Bounding box of the mattress against the studio backdrop.

    The backdrop shades from wall to floor, so each row is compared with the
    backdrop at its own left and right edges (either one may be darker). A row or column counts as
    mattress when it holds at least half as many mattress pixels as the
    fullest one, which ignores stray shadows and noise.
    """
    small = img.copy()
    small.thumbnail((500, 500))
    small = small.filter(ImageFilter.MedianFilter(5))
    w, h = small.size
    px = small.load()
    edge = max(3, w // 30)
    row_counts, col_counts = [0] * h, [0] * w
    for y in range(h):
        left = median([px[x, y] for x in range(edge)])
        right = median([px[x, y] for x in range(w - edge, w)])
        for x in range(w):
            if distance(px[x, y], left) > BG_DISTANCE and distance(px[x, y], right) > BG_DISTANCE:
                row_counts[y] += 1
                col_counts[x] += 1
    rows = [y for y in range(h) if row_counts[y] >= FILL_SHARE * max(row_counts)]
    cols = [x for x in range(w) if col_counts[x] >= FILL_SHARE * max(col_counts)]
    if not rows or not cols:
        raise ValueError("no mattress found")
    sx, sy = img.width / w, img.height / h
    return (int(cols[0] * sx), int(rows[0] * sy), int((cols[-1] + 1) * sx), int((rows[-1] + 1) * sy))


def tighten_strip(strip):
    """Trim a horizontal edge strip to the rows and columns that are mostly mattress.

    The backdrop vignettes, so rows are compared with the fullest row rather
    than with a fixed share.

    Thin mattresses photographed edge-on leave a lot of backdrop above and
    below the first crop; the backdrop colour is read from the strip's own
    top and bottom rows.
    """
    small = strip.resize((400, max(20, int(400 * strip.height / strip.width))))
    w, h = small.size
    px = small.load()
    backdrop = median([px[x, y] for x in range(w) for y in (0, 1, h - 2, h - 1)])
    is_mattress = [[distance(px[x, y], backdrop) > BG_DISTANCE for x in range(w)] for y in range(h)]
    fill = [sum(row) / w for row in is_mattress]
    rows = [y for y in range(h) if fill[y] >= STRIP_ROW_SHARE * max(fill)]
    if not rows:
        return strip
    cols = [x for x in range(w) if sum(is_mattress[y][x] for y in rows) > STRIP_FILL * len(rows)]
    if not cols:
        return strip
    sx, sy = strip.width / w, strip.height / h
    return strip.crop((int(cols[0] * sx), int(rows[0] * sy), int((cols[-1] + 1) * sx), int((rows[-1] + 1) * sy)))


def save_jpeg(img, path, quality=80):
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def main(raw, site):
    out = os.path.join(site, "img", "products", "foam")
    tex = os.path.join(out, "tex")
    os.makedirs(tex, exist_ok=True)
    for folder, (slug, face, edge) in PRODUCTS.items():
        for n in range(1, 5):
            src = os.path.join(raw, f"p{folder:02d}-{n}.jpg")
            if not os.path.exists(src):
                continue
            img = load(src)
            img.thumbnail((GALLERY_SIDE, GALLERY_SIDE))
            save_jpeg(img, os.path.join(out, f"{slug}-{n}.jpg"), 78)
        if face:
            img = load(os.path.join(raw, f"p{folder:02d}-{face}.jpg"))
            top = img.crop(mattress_box(img))
            left, right = FACE_TRIM.get(slug, (0.0, 0.0))
            top = trim(top, left, 0, right, 0)
            top.thumbnail((TEXTURE_SIDE, TEXTURE_SIDE))
            save_jpeg(top, os.path.join(tex, f"{slug}-top.jpg"))
        if edge:
            img = load(os.path.join(raw, f"p{folder:02d}-{edge}.jpg"))
            side = img.crop(mattress_box(img))
            if side.height > side.width:
                side = side.rotate(90, expand=True)
            side = trim(tighten_strip(side), *SIDE_TRIM.get(slug, (0, 0, 0, 0)))
            side = side.resize((TEXTURE_SIDE, SIDE_TEXTURE_HEIGHT))
            save_jpeg(side, os.path.join(tex, f"{slug}-side.jpg"))
        print("ok", slug)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

"""Build the Shakir Foam brand cards, filters and mattress catalogue.

Usage: python3 tools/foam_catalog.py

Rewrites the blocks between the <!-- generated:NAME --> markers in
foam/index.html. Product facts come from foam.shakirgroup.com/products.
Models with no photo on that site (their image links return 404) are drawn
to scale instead of shown with a stock or invented picture.
Run tools/foam_variants.py first: card photos link its AVIF, WebP and
phone-sized copies.
"""
import html
import json
import os
import re
import urllib.parse

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(SITE, "foam", "index.html")
PHOTO_DIR = os.path.join(SITE, "img", "products", "foam")
META_PATH = os.path.join(PHOTO_DIR, "tex", "meta.json")
QUILTED_BRANDS = {"sweet-dream", "comfort"}   # knitted, quilted covers rather than printed cotton
WHATSAPP = "https://wa.me/252611111100?text="
ARROW = ('<svg class="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
         '<path d="M2 8h11m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.4"/></svg>')

BRANDS = [
    ("sweet-dream", "Sweet Dream", "Premium comfort, including the double-layer range."),
    ("shakir", "Shakir", "Our flagship line, 10 to 20 cm, in every size."),
    ("comfort", "Comfort", "Everyday mattresses for homes, guesthouses and schools."),
    ("anfac", "Anfac", "Dependable value for homes and institutions."),
    ("five-star", "Five Star", "Hotel grade, built for demanding hospitality use."),
    ("layali", "Layali", "Made for deep, restful sleep."),
]
BRAND_NAMES = {slug: name for slug, name, _ in BRANDS}
BRAND_PHOTO = {"sweet-dream": "sweetdream-25-180x200", "shakir": "shakir-15-180x190", "comfort": "comfort-25-150x190"}

SIZES = [
    ("single", "Single · 90 cm"),
    ("three-quarter", "Three-quarter · 120 cm"),
    ("double", "Double · 150–180 cm"),
    ("king", "King · 180 × 200 cm"),
]

# brand, cover name, thickness cm, width, length, size class, photo slug, badges, layers
# length None = the site gives only the width
PRODUCTS = [
    ("sweet-dream", "", 30, 180, 200, "king", "sweetdream-30-180x200", ["Double layer", "Hotel grade"], 2),
    ("sweet-dream", "", 25, 180, 200, "king", "sweetdream-25-180x200", ["Double layer"], 2),
    ("sweet-dream", "", 20, 180, 200, "king", "sweetdream-20-180x200", ["Double layer", "2 covers"], 2),
    ("sweet-dream", "", 20, 90, 190, "single", "sweetdream-20-90x190", [], 1),
    ("shakir", "", 20, 180, 200, "king", "shakir-20-180x200", [], 1),
    ("shakir", "", 20, 180, 190, "double", None, [], 1),
    ("shakir", "", 15, 180, 190, "double", "shakir-15-180x190", [], 1),
    ("shakir", "Rose", 15, 150, None, "double", "shakir-15-150", [], 1),
    ("shakir", "", 15, 120, 190, "three-quarter", "shakir-15-120x190", [], 1),
    ("shakir", "Damask", 15, 90, 190, "single", "shakir-15-90x190-damask", [], 1),
    ("shakir", "Olive", 15, 90, 190, "single", "shakir-15-90x190-olive", [], 1),
    ("shakir", "Floral", 12, 90, 190, "single", "shakir-12-90x190-floral", [], 1),
    ("shakir", "Red", 12, 90, 190, "single", "shakir-12-90x190-red", [], 1),
    ("shakir", "", 10, 90, 190, "single", None, ["2 covers"], 1),
    ("comfort", "", 25, 150, 190, "double", "comfort-25-150x190", [], 1),
    ("comfort", "", 20, 120, 190, "three-quarter", "comfort-20-120x190", ["Pillow top"], 2),
    ("anfac", "", 12, 90, 190, "single", None, ["2 covers"], 1),
    ("anfac", "", 10, 90, 190, "single", None, ["2 covers"], 1),
    ("five-star", "", 20, 180, 200, "king", None, ["Hotel grade"], 1),
    ("layali", "", 20, 150, 190, "double", None, [], 1),
]
ASSUMED_LENGTH = 190
CARD_SIDE = 720                     # card photos are square
CARD_SMALL = 360                    # the copy tools/foam_variants.py writes for phones
CARD_FORMATS = (("avif", "image/avif"), ("webp", "image/webp"))
# rendered width of a card photo, from the grids in css/foam.css (gutter 16 px on phones, --max 1240 px)
CATALOG_SIZES = "(max-width: 760px) calc(50vw - 23px), (max-width: 1100px) 31vw, 272px"
BRAND_SIZES = "(max-width: 560px) calc(100vw - 32px), (max-width: 960px) 46vw, 368px"
META = json.load(open(META_PATH)) if os.path.exists(META_PATH) else {}


def esc(text):
    return html.escape(text, quote=True)


def slug_of(p):
    """The mattress's link name, e.g. sweet-dream-30-180x200 or shakir-15-90x190-damask.

    It is the part of a shared link after the #, so it must stay the same
    once published: brand, thickness, size, then the cover when one brand
    has two covers in the same size.
    """
    brand, cover, cm, w, l, *_ = p
    size = f"{w}x{l}" if l else f"{w}"
    return f"{brand}-{cm}-{size}" + (f"-{cover.lower()}" if cover else "")


def name_of(p):
    brand, cover, cm = p[0], p[1], p[2]
    return f"{BRAND_NAMES[brand]} {cm} cm" + (f" · {cover}" if cover else "")


def size_label(p):
    _, _, _, w, l, *_ = p
    return f"{w} × {l} cm" if l else f"{w} cm wide"


def photos_of(slug):
    if not slug:
        return []
    return [n for n in range(1, 5) if os.path.exists(os.path.join(PHOTO_DIR, f"{slug}-{n}.jpg"))]


def picture(slug, alt, sizes):
    """A card photo as <picture>: AVIF, then WebP, then JPEG, each at 360 and 720 px.

    Only the copies tools/foam_variants.py has written are listed, so a
    missing copy falls back to the plain JPEG rather than a broken link.
    """
    base = f"img/products/{slug}"

    def srcset(ext):
        files = [(f"{base}-{CARD_SMALL}.{ext}", CARD_SMALL), (f"{base}.{ext}", CARD_SIDE)]
        return ", ".join(f"../{path} {w}w" for path, w in files if os.path.exists(os.path.join(SITE, path)))

    sources = "".join(f'<source type="{mime}" srcset="{srcset(ext)}" sizes="{sizes}">'
                      for ext, mime in CARD_FORMATS if srcset(ext))
    img = (f'<img src="../{base}.jpg" srcset="{srcset("jpg")}" sizes="{sizes}" alt="{esc(alt)}" loading="lazy" '
           f'decoding="async" width="{CARD_SIDE}" height="{CARD_SIDE}">')
    return f"<picture>{sources}{img}</picture>"


def texture(slug, part):
    path = f"img/products/foam/tex/{slug}-{part}.jpg"
    return "../" + path if slug and os.path.exists(os.path.join(SITE, path)) else ""


def drawing(w, l, h, label):
    """A to-scale isometric drawing of a w x l x h cm mattress, as inline SVG."""
    cos30, sin30 = 0.866, 0.5

    def pt(x, y, z):
        return ((x - z) * cos30, (x + z) * sin30 - y)

    corners = {k: pt(*v) for k, v in {
        "a": (0, h, 0), "b": (w, h, 0), "c": (w, h, l), "d": (0, h, l),
        "e": (w, 0, 0), "f": (w, 0, l), "g": (0, 0, l)}.items()}
    xs = [c[0] for c in corners.values()]
    ys = [c[1] for c in corners.values()]
    box_w, box_h = max(xs) - min(xs), max(ys) - min(ys)
    scale = min(240 / box_w, 150 / box_h)
    ox = 160 - (min(xs) + box_w / 2) * scale
    oy = 104 - (min(ys) + box_h / 2) * scale

    def poly(*keys):
        return " ".join(f"{ox + corners[k][0] * scale:.1f},{oy + corners[k][1] * scale:.1f}" for k in keys)

    fx, fy = corners["f"]
    gx, gy = corners["g"]
    lx, ly = ox + (fx + gx) / 2 * scale, oy + (fy + gy) / 2 * scale + 22
    return (
        f'<svg class="drawing" viewBox="0 0 320 208" role="img" aria-label="{esc(label)}">'
        f'<polygon class="drawing-top" points="{poly("a", "b", "c", "d")}"/>'
        f'<polygon class="drawing-side" points="{poly("d", "c", "f", "g")}"/>'
        f'<polygon class="drawing-end" points="{poly("b", "c", "f", "e")}"/>'
        f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle">{h} cm</text>'
        "</svg>"
    )


def product_data(p):
    brand, cover, cm, w, l, size, slug, badges, layers = p
    return {
        "slug": slug_of(p), "name": name_of(p), "brand": BRAND_NAMES[brand], "size": size_label(p),
        "dims": [w, l or ASSUMED_LENGTH, cm], "lengthKnown": bool(l), "layers": layers,
        "badges": badges,
        "photos": [f"../img/products/foam/{slug}-{n}.jpg" for n in photos_of(slug)],
        "top": texture(slug, "top"), "side": texture(slug, "side"),
        "quilted": brand in QUILTED_BRANDS,
        "piping": META.get(slug, {}).get("piping"),
        "seam": META.get(slug, {}).get("seam") if layers == 2 else None,
    }


def ask_link(name, size):
    text = urllib.parse.quote(f"Salaam, I would like a price for {name} ({size}).")
    return f'<a class="ask-price" href="{WHATSAPP}{text}" rel="noopener">Ask for a price {ARROW}</a>'


def card(p):
    brand, cover, cm, w, l, size, slug, badges, layers = p
    name, dims = name_of(p), size_label(p)
    if slug:
        media = picture(slug, f"{name} mattress", CATALOG_SIZES)
    else:
        media = drawing(w, l or ASSUMED_LENGTH, cm, f"{name} mattress, drawn to scale")
    data = esc(json.dumps(product_data(p), ensure_ascii=False, separators=(",", ":")))
    badge_html = "".join(f"<li>{esc(b)}</li>" for b in badges)
    note = "" if slug else '<span class="product-note">Drawn to scale</span>'
    return (
        f'          <li class="product{"" if slug else " product--drawn"}" id="{slug_of(p)}" data-size="{size}" data-brand="{brand}" data-product="{data}">'
        f'<div class="product-img">{media}<span class="product-cat">{esc(BRAND_NAMES[brand])}</span>{note}'
        f'<button class="product-view" type="button" data-view><span>View in 3D</span>'
        f'<span class="sr-only">: {esc(name)}, {esc(dims)}</span></button></div>'
        f'<h3>{esc(name)}</h3><p>{esc(dims)}</p>'
        + (f'<ul class="badges">{badge_html}</ul>' if badges else "")
        + ask_link(name, dims) + "</li>"
    )


def brand_card(slug, name, blurb):
    models = [p for p in PRODUCTS if p[0] == slug]
    photographed = [p for p in models if p[6]]
    shown = next((p for p in photographed if p[6] == BRAND_PHOTO.get(slug)), photographed[0] if photographed else None)
    if shown:
        media = f'<div class="brand-photo">{picture(shown[6], "", BRAND_SIZES)}</div>'
    else:
        p = models[0]
        media = (f'<div class="brand-photo brand-photo--drawn">'
                 f'{drawing(p[3], p[4] or ASSUMED_LENGTH, p[2], f"{name_of(p)}, drawn to scale")}'
                 '<span class="product-note">Drawn to scale</span></div>')
    count = len(models)
    noun = "mattress" if count == 1 else "mattresses"
    return (
        f'          <li class="reveal"><a class="brand-card" href="?brand={slug}#range" data-brand-link="{slug}">{media}'
        f'<div class="brand-body"><h3>{esc(name)}</h3><p>{esc(blurb)}</p>'
        f'<span class="brand-more">See {"the" if count == 1 else f"all {count}"} {noun} {ARROW}</span></div></a></li>'
    )


def chip(group, value, label, count, pressed):
    return (f'<button class="filter" type="button" data-filter-{group}="{value}" aria-pressed="{str(pressed).lower()}">'
            f'{esc(label)} <span data-count>{count}</span></button>')


def filters():
    size_chips = [chip("size", "all", "All sizes", len(PRODUCTS), True)]
    size_chips += [chip("size", s, label, sum(p[5] == s for p in PRODUCTS), False) for s, label in SIZES]
    brand_chips = [chip("brand", "all", "All brands", len(PRODUCTS), True)]
    brand_chips += [chip("brand", s, n, sum(p[0] == s for p in PRODUCTS), False) for s, n, _ in BRANDS]
    return (
        '        <div class="catalog-filters">\n'
        '          <div class="size-filter" role="group" aria-labelledby="filter-size-label">'
        '<span class="filter-label" id="filter-size-label">Size</span>' + "".join(size_chips) + "</div>\n"
        '          <div class="size-filter" role="group" aria-labelledby="filter-brand-label">'
        '<span class="filter-label" id="filter-brand-label">Brand</span>' + "".join(brand_chips) + "</div>\n"
        "        </div>\n"
        '        <p class="sr-only" role="status" data-filter-status></p>\n'
        '        <ul class="catalog foam-catalog" data-catalog>\n'
        + "\n".join(card(p) for p in PRODUCTS)
        + "\n        </ul>\n"
        '        <p class="catalog-empty" data-catalog-empty hidden>No mattress matches both filters. '
        '<button type="button" data-filter-reset>Show all mattresses</button></p>\n'
        '        <p class="also-note">Models shown as drawings have no photo yet; ask on WhatsApp to see the current covers. '
        "Also in the range: the Diamond mattress, and orthopedic, spring and memory-foam mattresses.</p>\n"
    )


def replace_block(page, name, content):
    pattern = re.compile(rf"(<!-- generated:{name} -->\n).*?(\s*<!-- /generated:{name} -->)", re.S)
    if not pattern.search(page):
        raise SystemExit(f"marker generated:{name} not found in {PAGE}")
    return pattern.sub(lambda m: m.group(1) + content.rstrip("\n") + "\n" + m.group(2).lstrip(), page)


def check_slugs():
    slugs = [slug_of(p) for p in PRODUCTS]
    repeated = sorted({s for s in slugs if slugs.count(s) > 1})
    if repeated:
        raise SystemExit(f"two mattresses share a link name: {', '.join(repeated)}")


def main():
    check_slugs()
    page = open(PAGE, encoding="utf-8").read()
    page = replace_block(page, "brands", "\n".join(brand_card(*b) for b in BRANDS))
    page = replace_block(page, "catalog", filters())
    open(PAGE, "w", encoding="utf-8").write(page)
    print(f"{len(PRODUCTS)} mattresses, {len(BRANDS)} brands written")


if __name__ == "__main__":
    main()

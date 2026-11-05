/* Shakir Foam — which copy of an image this browser should fetch.
   tools/foam_variants.py writes every photo and cover texture next to its
   JPEG as <name>.<format> (same size) and <name>-<long side>.<format>
   (smaller). Static markup picks through <picture>; the viewer and the 3D
   covers are built in script, so they ask here instead. */

const PHONE_SCREEN = 760;   // css px on the screen's short side; tablets and laptops are wider

// 1 × 1 px images: a browser that decodes one can show that format
const PROBES = {
  avif: "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAFwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAH21kYXQSAAoFGAAGBCAyDBgACiiihAAAsBKamA==",
  webp: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAsBMJaQAA3AA/veMAAA=",
};

function decodes(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

let supported = new Set(["jpg"]);

/* Settles once the probes have decoded (a few milliseconds after load).
   Until then `pick` answers "jpg", which every browser shows. */
export const formatsReady = Promise.all(
  Object.entries(PROBES).map(async ([format, src]) => ((await decodes(src)) ? format : null)),
).then((found) => {
  supported = new Set(["jpg", ...found.filter(Boolean)]);
});

/* The first of `preferred` this browser can show, else "jpg". */
export function pick(preferred) {
  return preferred.find((format) => supported.has(format)) ?? "jpg";
}

/* Phones get the smaller copies. The screen's short side, not the window,
   decides: a phone stays a phone in landscape, and a narrow desktop window
   still has a large, sharp screen behind it. */
export function isPhone() {
  return Math.min(screen.width, screen.height) <= PHONE_SCREEN;
}

/* The URL of one copy of a JPEG: `size` is the long side of a smaller copy
   (omit it for the original size), `format` one of jpg, webp, avif. */
export function copyOf(jpegUrl, { size = null, format = "jpg" } = {}) {
  if (!size && format === "jpg") return jpegUrl;
  return jpegUrl.replace(/\.jpg$/, `${size ? `-${size}` : ""}.${format}`);
}

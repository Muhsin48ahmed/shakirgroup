/* Shakir Foam — the 3D mattress.
   A soft, pillowed body at the mattress's real size, wrapped in its own
   photos, with piping where the cover has it and a separate pillow-top
   layer on double-layer models. Units are metres.
   The mattress appears at once in a plain cover; its photos are laid on
   as they arrive, and it stays plain if they never do. */

import { coverUrl, formatsReady } from "./foam-media.js";

const CM = 0.01;
const SEGMENTS = { across: 64, thick: 10 };
const ROUNDNESS = 0.34;              // edge radius as a share of the body height
const MAX_RADIUS = 4 * CM;
const CROWN = 0.16;                  // how far the top domes, as a share of height
const MAX_CROWN = 2.4 * CM;
const SIDE_BULGE = 0.1;              // how far the sides belly out
const MAX_SIDE_BULGE = 1.4 * CM;
const TOPPER_INSET = 0.8 * CM;       // a pillow top sits slightly inside the base
const PIPING_RADIUS = 0.42 * CM;
const PIPING_STEPS = 260;
const PLAIN_COVER = 0xf1ece2;
const BUMP_QUILTED = 6;             // relief taken from the cover photo's light and dark
const BUMP_PRINTED = 1.5;
const FINITE_STEP = 0.0015;
const SMALL_GPU_TEXTURE = 4096;      // a GPU that can't hold this gets the phone set of covers

// loaded with the 3D view, when the format probes have almost always settled; this makes sure
await formatsReady;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const falloff = (t) => clamp(1 - t ** 4, 0, 1);

/* The surface: a box with rounded edges, domed faces and a flat underside.
   `shape` maps any point on the plain box's surface onto that surface. */
function surface({ w, h, l, crownBottom = 0 }) {
  const hw = w / 2, hh = h / 2, hl = l / 2;
  const r = Math.min(h * ROUNDNESS, MAX_RADIUS);
  const crown = Math.min(h * CROWN, MAX_CROWN);
  const bulge = Math.min(h * SIDE_BULGE, MAX_SIDE_BULGE);
  return (x, y, z) => {
    const ix = clamp(x, -hw + r, hw - r);
    const iy = clamp(y, -hh + r, hh - r);
    const iz = clamp(z, -hl + r, hl - r);
    const dx = x - ix, dy = y - iy, dz = z - iz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const px = ix + nx * r, py = iy + ny * r, pz = iz + nz * r;
    const fx = falloff(px / hw), fy = falloff(py / hh), fz = falloff(pz / hl);
    const up = ny > 0 ? crown : crownBottom;
    return [
      px + nx * bulge * fy * fz,
      py + ny * up * fx * fz,
      pz + nz * bulge * fy * fx,
    ];
  };
}

function pillowGeometry(THREE, size) {
  const { w, h, l } = size;
  const { across, thick } = SEGMENTS;
  const geometry = new THREE.BoxGeometry(w, h, l, across, thick, across);
  const shape = surface(size);
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const e = FINITE_STEP;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const face = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
    const axis = face.findIndex((c) => c !== 0);
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    const at = (k, d) => { const q = [...p]; q[k] += d; return shape(...q); };
    a.fromArray(at(u, e)).sub(b.fromArray(at(u, -e)));
    b.fromArray(at(v, e)).sub(n.fromArray(at(v, -e)));
    n.crossVectors(a, b).normalize();
    if (n.dot(a.fromArray(face)) < 0) n.negate();
    const q = shape(...p);
    pos.setXYZ(i, q[0], q[1], q[2]);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return { geometry, shape };
}

function pipingAround(THREE, shape, size, y, colour) {
  const hw = size.w / 2, hl = size.l / 2;
  const perimeter = 4 * (hw + hl);
  const points = [];
  for (let i = 0; i < PIPING_STEPS; i += 1) {
    let s = (i / PIPING_STEPS) * perimeter;
    let x, z;
    if (s < 2 * hw) { x = -hw + s; z = hl; }
    else if ((s -= 2 * hw) < 2 * hl) { x = hw; z = hl - s; }
    else if ((s -= 2 * hl) < 2 * hw) { x = hw - s; z = -hl; }
    else { s -= 2 * hw; x = -hw; z = -hl + s; }
    points.push(new THREE.Vector3(...shape(x, y, z)));
  }
  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
  const tube = new THREE.TubeGeometry(curve, PIPING_STEPS * 2, PIPING_RADIUS, 8, true);
  const material = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.5 });
  const mesh = new THREE.Mesh(tube, material);
  mesh.castShadow = true;
  return mesh;
}

/* ---------- Materials ---------- */

function fetchTexture(THREE, url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

/* A cover photo as a texture, or null if neither the WebP nor the JPEG copy loads. */
async function loadTexture(THREE, renderer, jpegUrl) {
  const isSmallGpu = renderer.capabilities.maxTextureSize < SMALL_GPU_TEXTURE;
  const urls = [...new Set([coverUrl(jpegUrl, { isSmallGpu }), coverUrl(jpegUrl, { isSmallGpu, format: "jpg" })])];
  for (const url of urls) {
    try {
      const texture = await fetchTexture(THREE, url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return texture;
    } catch {
      console.warn("Shakir Foam 3D viewer: cover photo didn't load", url);
    }
  }
  return null;
}

/* Every material starts as the plain cover; dress() lays the photo on later. */
function fabric(THREE) {
  return new THREE.MeshPhysicalMaterial({
    color: PLAIN_COVER,
    roughness: 0.86,
    sheen: 0.7,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.55,
  });
}

/* A side texture cut to one layer's band of the edge strip. */
function sideBand(base, repeatX, from, to) {
  if (!base) return null;
  const t = base.clone();
  t.repeat.set(repeatX, to - from);
  t.offset.set(0, from);
  t.needsUpdate = true;
  return t;
}

function dress(material, map, { quilted }) {
  if (!map) return;
  Object.assign(material, { map, bumpMap: map, bumpScale: quilted ? BUMP_QUILTED : BUMP_PRINTED });
  material.color.set(0xffffff);
  material.needsUpdate = true;
}

/* One layer's body. `faces` says which photo, and which band of it, each face gets once loaded. */
function body(THREE, size) {
  const { geometry, shape } = pillowGeometry(THREE, size);
  const materials = { long: fabric(THREE), short: fabric(THREE), top: fabric(THREE) };
  const { long, short, top } = materials;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const mesh = new THREE.Mesh(geometry, [long, long, top, top, short, short]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, shape, materials };
}

/* ---------- The mattress ---------- */

/* Lays the loaded photos onto each layer, unless the mattress was put away meanwhile. */
function dressLayers(group, built, textures, { seam, quilted }) {
  const [top, side] = textures;
  if (group.userData.isDisposed) {
    textures.forEach((t) => t?.dispose());
    return;
  }
  const options = { quilted };
  built.forEach(({ layer, materials }) => {
    const ownTop = layer.hasTop ? top : null;
    dress(materials.top, ownTop ?? (seam ? sideBand(side, 1, ...layer.band) : null), options);
    dress(materials.long, sideBand(side, 1, ...layer.band), options);
    dress(materials.short, sideBand(side, layer.size.w / layer.size.l, ...layer.band), options);
  });
}

/* The mattress, at once, in a plain cover. `covers` settles once its photos are on, or have failed. */
export function buildMattress(lib, renderer, product) {
  const { THREE } = lib;
  const [w, l, h] = product.dims.map((v) => v * CM);
  const group = new THREE.Group();
  const seam = product.layers === 2 && product.seam ? product.seam : 0;
  const layers = seam
    ? [
        { size: { w, h: h * (1 - seam), l }, y: 0, band: [0, 1 - seam], hasTop: false },
        { size: { w: w - 2 * TOPPER_INSET, h: h * seam, l: l - 2 * TOPPER_INSET }, y: h * (1 - seam), band: [1 - seam, 1], hasTop: true },
      ]
    : [{ size: { w, h, l }, y: 0, band: [0, 1], hasTop: true }];

  const built = layers.map((layer) => {
    const { mesh, shape, materials } = body(THREE, layer.size);
    mesh.position.y = layer.y + layer.size.h / 2;
    group.add(mesh);
    addPiping(THREE, group, product, layer, mesh, shape);
    return { layer, materials };
  });

  const covers = Promise.all([product.top, product.side].map((src) => (src ? loadTexture(THREE, renderer, src) : null)))
    .then((textures) => dressLayers(group, built, textures, { seam, quilted: product.quilted }));
  return { group, width: w, length: l, height: h, covers };
}

function addPiping(THREE, group, product, layer, mesh, shape) {
  if (!product.piping) return;
  [1, -1].forEach((sign) => {
    const piping = pipingAround(THREE, shape, layer.size, (sign * layer.size.h) / 2, product.piping);
    piping.position.y = mesh.position.y;
    group.add(piping);
  });
}

export function disposeMattress(group) {
  group.userData.isDisposed = true;   // photos still on their way are dropped, not laid on
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    [].concat(child.material).forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  });
}

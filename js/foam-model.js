/* Shakir Foam — the 3D mattress.
   A soft, pillowed body at the mattress's real size, wrapped in its own
   photos, with piping where the cover has it and a separate pillow-top
   layer on double-layer models. Units are metres. */

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

function loadTexture(THREE, renderer, url) {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function fabric(THREE, map, { quilted }) {
  return new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : PLAIN_COVER,
    map: map ?? null,
    bumpMap: map ?? null,
    bumpScale: map ? (quilted ? BUMP_QUILTED : BUMP_PRINTED) : 0,
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

function body(THREE, size, maps, options) {
  const { geometry, shape } = pillowGeometry(THREE, size);
  const long = fabric(THREE, maps.long, options);
  const short = fabric(THREE, maps.short, options);
  const top = fabric(THREE, maps.top, options);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const mesh = new THREE.Mesh(geometry, [long, long, top, top, short, short]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, shape };
}

/* ---------- The mattress ---------- */

export function buildMattress(lib, renderer, product) {
  const { THREE } = lib;
  const [w, l, h] = product.dims.map((v) => v * CM);
  const group = new THREE.Group();
  const top = product.top ? loadTexture(THREE, renderer, product.top) : null;
  const side = product.side ? loadTexture(THREE, renderer, product.side) : null;
  const options = { quilted: product.quilted };
  const seam = product.layers === 2 && product.seam ? product.seam : 0;
  const layers = seam
    ? [
        { size: { w, h: h * (1 - seam), l }, y: 0, band: [0, 1 - seam], top: null },
        { size: { w: w - 2 * TOPPER_INSET, h: h * seam, l: l - 2 * TOPPER_INSET }, y: h * (1 - seam), band: [1 - seam, 1], top },
      ]
    : [{ size: { w, h, l }, y: 0, band: [0, 1], top }];

  layers.forEach((layer) => {
    const maps = {
      top: layer.top ?? (seam ? sideBand(side, 1, layer.band[0], layer.band[1]) : null),
      long: sideBand(side, 1, ...layer.band),
      short: sideBand(side, layer.size.w / layer.size.l, ...layer.band),
    };
    const { mesh, shape } = body(THREE, layer.size, maps, options);
    mesh.position.y = layer.y + layer.size.h / 2;
    group.add(mesh);
    if (!product.piping) return;
    [1, -1].forEach((sign) => {
      const piping = pipingAround(THREE, shape, layer.size, (sign * layer.size.h) / 2, product.piping);
      piping.position.y = mesh.position.y;
      group.add(piping);
    });
  });
  return { group, width: w, length: l, height: h };
}

export function disposeMattress(group) {
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    [].concat(child.material).forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  });
}

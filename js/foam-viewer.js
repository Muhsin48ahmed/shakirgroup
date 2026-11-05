/* Shakir Foam — mattress viewer.
   Opens from any catalogue card: a 3D model built at the mattress's real
   size and wrapped in its own photos, plus the photo gallery.
   Three.js is fetched only the first time someone opens the 3D view. */

const CM = 0.01;                       // scene units are metres
const PLAIN_COVER = 0xf1ece2;
const MAX_PIXEL_RATIO = 2;
const FRAME_MARGIN = 1.15;             // breathing room around the mattress
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const dialog = document.querySelector("[data-viewer]");
const el = dialog && {
  canvas: dialog.querySelector("[data-viewer-canvas]"),
  photo: dialog.querySelector("[data-viewer-photo]"),
  drawing: dialog.querySelector("[data-viewer-drawing]"),
  hint: dialog.querySelector("[data-viewer-hint]"),
  loading: dialog.querySelector("[data-viewer-loading]"),
  thumbs: dialog.querySelector("[data-viewer-thumbs]"),
  brand: dialog.querySelector("[data-viewer-brand]"),
  name: dialog.querySelector("[data-viewer-name]"),
  specs: dialog.querySelector("[data-viewer-specs]"),
  badges: dialog.querySelector("[data-viewer-badges]"),
  note: dialog.querySelector("[data-viewer-note]"),
  ask: dialog.querySelector("[data-viewer-ask]"),
};

let libraryPromise = null;
let view = null;           // the Three.js scene, created once
let current = null;        // { product, card }
let has3D = true;

function loadLibrary() {
  libraryPromise ??= Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/geometries/RoundedBoxGeometry.js"),
  ]).then(([THREE, controls, box]) => ({
    THREE, OrbitControls: controls.OrbitControls, RoundedBoxGeometry: box.RoundedBoxGeometry,
  }));
  return libraryPromise;
}

/* ---------- Scene ---------- */

function createView(lib) {
  const { THREE, OrbitControls } = lib;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.canvas.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8ba, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotateSpeed = 1.1;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = el.canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(el.canvas);

  return { lib, renderer, scene, camera, controls, sun, resize, mesh: null, frame: 0 };
}

function coverMaterial(lib, url, repeatX = 1) {
  const { THREE } = lib;
  if (!url) return new THREE.MeshStandardMaterial({ color: PLAIN_COVER, roughness: 0.92 });
  const map = new THREE.TextureLoader().load(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = view.renderer.capabilities.getMaxAnisotropy();
  map.repeat.set(repeatX, 1);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.88 });
}

function disposeMesh(mesh) {
  if (!mesh) return;
  view.scene.remove(mesh);
  mesh.geometry.dispose();
  new Set(mesh.material).forEach((m) => { m.map?.dispose(); m.dispose(); });
}

function buildMattress(product) {
  const { lib, scene, camera, controls, sun } = view;
  const [w, l, h] = product.dims.map((v) => v * CM);
  const geometry = new lib.RoundedBoxGeometry(w, h, l, 4, Math.min(h * 0.28, 0.03));
  const top = coverMaterial(lib, product.top);
  const longSide = coverMaterial(lib, product.side);
  const shortSide = coverMaterial(lib, product.side, w / l);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const mesh = new lib.THREE.Mesh(geometry, [longSide, longSide, top, top, shortSide, shortSide]);
  mesh.position.y = h / 2;
  mesh.castShadow = true;

  disposeMesh(view.mesh);
  view.mesh = mesh;
  scene.add(mesh);

  const reach = Math.hypot(w, l, h);
  const halfFov = (camera.fov * Math.PI) / 360;
  const distance = (reach * 0.5 * FRAME_MARGIN) / Math.tan(halfFov) / Math.min(1, camera.aspect);
  camera.position.copy(new lib.THREE.Vector3(0.95, 0.8, 1.15).normalize().multiplyScalar(distance));
  controls.target.set(0, h / 2, 0);
  controls.minDistance = distance * 0.45;
  controls.maxDistance = distance * 2;
  controls.autoRotate = !reducedMotion;
  controls.update();

  sun.position.set(reach * 1.2, reach * 2.2, reach * 1.4);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: reach * 6 });
  sun.shadow.camera.updateProjectionMatrix();
}

function loop() {
  view.controls.update();
  view.renderer.render(view.scene, view.camera);
  view.frame = requestAnimationFrame(loop);
}

function stopLoop() {
  if (view?.frame) cancelAnimationFrame(view.frame);
  if (view) view.frame = 0;
}

/* ---------- Views: 3D, photos, drawing ---------- */

function showStage(kind) {
  el.canvas.hidden = kind !== "3d";
  el.hint.hidden = kind !== "3d";
  el.photo.hidden = kind !== "photo";
  el.drawing.hidden = kind !== "drawing";
  if (kind !== "3d") stopLoop();
}

async function show3D() {
  showStage("3d");
  el.loading.hidden = Boolean(view);
  try {
    const lib = await loadLibrary();
    view ??= createView(lib);
    if (!dialog.open || !current) return;
    view.resize();
    buildMattress(current.product);
    el.loading.hidden = true;
    stopLoop();
    loop();
  } catch (error) {
    console.error("Shakir Foam 3D viewer could not start", error);
    has3D = false;
    el.loading.hidden = true;
    renderThumbs();
    selectThumb(el.thumbs.querySelector("button"));
  }
}

function showPhoto(src, alt) {
  showStage("photo");
  el.photo.src = src;
  el.photo.alt = alt;
}

function showDrawing() {
  showStage("drawing");
  const svg = current.card.querySelector(".drawing");
  el.drawing.replaceChildren(svg ? svg.cloneNode(true) : document.createTextNode(""));
}

function thumbButton(label, content, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "viewer-thumb";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  button.append(content);
  button.addEventListener("click", () => selectThumb(button));
  button.onSelect = onSelect;
  return button;
}

function renderThumbs() {
  const { product } = current;
  const buttons = [];
  if (has3D) {
    const badge = document.createElement("span");
    badge.className = "viewer-thumb-3d";
    badge.textContent = "3D";
    buttons.push(thumbButton("3D view", badge, show3D));
  }
  product.photos.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    const alt = `${product.name}, photo ${i + 1} of ${product.photos.length}`;
    buttons.push(thumbButton(`Photo ${i + 1}`, img, () => showPhoto(src, alt)));
  });
  if (!product.photos.length) {
    const label = document.createElement("span");
    label.className = "viewer-thumb-3d";
    label.textContent = "Plan";
    buttons.push(thumbButton("Drawing to scale", label, showDrawing));
  }
  el.thumbs.replaceChildren(...buttons);
}

function selectThumb(button) {
  if (!button) return;
  el.thumbs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  button.onSelect();
}

/* ---------- Product details ---------- */

function specRow(term, detail) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = detail;
  row.append(dt, dd);
  return row;
}

function noteFor(product) {
  if (!product.photos.length) {
    return "We don’t have a photo of this model yet, so the 3D view shows it at its real size in a plain cover. Ask on WhatsApp to see the current covers.";
  }
  const lengthNote = product.lengthKnown ? "" : " The length isn’t listed, so it is shown at 190 cm.";
  if (!product.top) return `The 3D view shows its real size in a plain cover; the photos show the actual cover.${lengthNote}`;
  return `The 3D view is built at its real size from the product photos.${lengthNote}`;
}

function fillDetails(product, card) {
  el.brand.textContent = product.brand;
  el.name.textContent = product.name;
  el.specs.replaceChildren(
    specRow("Size", product.size),
    specRow("Thickness", `${product.dims[2]} cm`),
    specRow("Cut to size", "On request"),
  );
  el.badges.replaceChildren(...product.badges.map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  el.badges.hidden = !product.badges.length;
  el.note.textContent = noteFor(product);
  el.ask.href = card.querySelector(".ask-price")?.href ?? el.ask.href;
}

function open(card) {
  let product;
  try {
    product = JSON.parse(card.dataset.product);
  } catch (error) {
    console.error("Shakir Foam viewer: bad product data", error);
    return;
  }
  current = { product, card };
  fillDetails(product, card);
  renderThumbs();
  dialog.showModal();
  selectThumb(el.thumbs.querySelector("button"));
}

function close() {
  stopLoop();
  dialog.close();
}

function init() {
  if (!dialog || typeof dialog.showModal !== "function") return;
  if (window.matchMedia("(pointer: coarse)").matches) el.hint.textContent = "Drag to turn · pinch to zoom";
  document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => open(button.closest(".product")))
  );
  dialog.querySelector("[data-viewer-close]").addEventListener("click", close);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  // "close" fires a task later, possibly after the next open, so it must not clear `current`
  dialog.addEventListener("close", stopLoop);
}

init();

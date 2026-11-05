/* Shakir Foam — mattress viewer.
   Opens from any catalogue card: a 3D model built at the mattress's real
   size and wrapped in its own photos, plus the photo gallery.
   Three.js is fetched only the first time someone opens the 3D view. */

const MAX_PIXEL_RATIO = 2;
const FRAME_MARGIN = 1.05;             // share of the bounding sphere kept in frame; a flat mattress fills less
const INTRO_PULL = 1.35;               // the camera starts this much further out
const INTRO_MS = 1400;
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
    import("three/addons/environments/RoomEnvironment.js"),
    import("./foam-model.js"),
  ]).then(([THREE, controls, room, model]) => ({
    THREE, OrbitControls: controls.OrbitControls, RoomEnvironment: room.RoomEnvironment, model,
  }));
  return libraryPromise;
}

/* ---------- Scene ---------- */

function softShadowTexture(THREE) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // shadowBlur (not ctx.filter, which Safari lacks): draw the rectangle off-canvas, keep its blurred shadow
  const inset = size * 0.2;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = size * 0.09;
  ctx.shadowOffsetX = size * 2;
  ctx.fillRect(inset - size * 2, inset, size - 2 * inset, size - 2 * inset);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createView(lib) {
  const { THREE, OrbitControls, RoomEnvironment } = lib;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps the covers' colours true
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.canvas.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 60);
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  const fill = new THREE.DirectionalLight(0xe8eef8, 0.35);
  // a soft light that travels with the camera, so whichever side faces you stays readable
  const headlight = new THREE.DirectionalLight(0xffffff, 1.05);
  headlight.position.set(0.4, 0.8, 1);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);
  scene.add(sun, sun.target, fill, camera);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: softShadowTexture(THREE), transparent: true, opacity: 0.55, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.0005;
  scene.add(ground, contact);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotateSpeed = 0.8;
  controls.addEventListener("start", () => { controls.autoRotate = false; view.intro = null; });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = el.canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(el.canvas);

  return { lib, renderer, scene, camera, controls, sun, fill, contact, resize, mattress: null, intro: null, frame: 0 };
}

function placeMattress(product) {
  const { lib, renderer, scene, camera, controls, sun, fill, contact } = view;
  if (view.mattress) {
    scene.remove(view.mattress);
    lib.model.disposeMattress(view.mattress);
  }
  const { group, width, length, height } = lib.model.buildMattress(lib, renderer, product);
  view.mattress = group;
  scene.add(group);
  contact.scale.set(width * 1.55, length * 1.45, 1);

  const reach = Math.hypot(width, length, height);
  const halfFovV = (camera.fov * Math.PI) / 360;
  const halfFovH = Math.atan(Math.tan(halfFovV) * camera.aspect);
  const distance = (reach * 0.5 * FRAME_MARGIN) / Math.tan(Math.min(halfFovV, halfFovH));
  const direction = new lib.THREE.Vector3(0.95, 0.72, 1.2).normalize();
  controls.target.set(0, height * 0.45, 0);
  controls.minDistance = distance * 0.4;
  controls.maxDistance = distance * 2;
  controls.autoRotate = !reducedMotion;
  view.intro = reducedMotion ? null : { start: performance.now(), from: distance * INTRO_PULL, to: distance, direction };
  camera.position.copy(direction).multiplyScalar(reducedMotion ? distance : distance * INTRO_PULL).add(controls.target);
  controls.update();

  sun.position.set(-reach * 0.9, reach * 2.4, reach * 1.3);
  fill.position.set(reach * 1.5, reach * 0.6, -reach);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.01, far: reach * 6 });
  sun.shadow.camera.updateProjectionMatrix();
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function loop(now) {
  const { intro, camera, controls } = view;
  if (intro) {
    const t = Math.min(1, (now - intro.start) / INTRO_MS);
    const d = intro.from + (intro.to - intro.from) * easeOut(t);
    camera.position.copy(intro.direction).multiplyScalar(d).add(controls.target);
    if (t === 1) view.intro = null;
  }
  controls.update();
  view.renderer.render(view.scene, camera);
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
    placeMattress(current.product);
    el.loading.hidden = true;
    stopLoop();
    view.frame = requestAnimationFrame(loop);
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
  dialog.addEventListener("close", () => { if (!dialog.open) stopLoop(); });
}

init();

/* Shakir Foam — mattress viewer.
   Opens from any catalogue card: a 3D model built at the mattress's real
   size and wrapped in its own photos, plus the photo gallery.
   Three.js is fetched only the first time someone opens the 3D view. */

import { copyOf, coverUrl, isPhone, pick } from "./foam-media.js";
import { createShare } from "./foam-share.js";

const MAX_PIXEL_RATIO = 2;
const PHONE_PHOTO = 700;               // long side of the gallery copy phones get (the original is 1400)
const THUMB_PHOTO = 320;               // long side of the thumbnail copy
const THUMB_SIDE = 64;                 // css px, as .viewer-thumb in css/foam.css
const FRAME_MARGIN = 1.05;             // share of the bounding sphere kept in frame; a flat mattress fills less
const INTRO_PULL = 1.35;               // the camera starts this much further out
const INTRO_MS = 1400;
const ROTATE_MS = 5000;                // auto-rotation stops itself after this; the toggle restarts it (WCAG 2.2.2)
const COVER_WAIT_MS = 4000;            // the longest "Loading 3D view…" waits for the cover photos
const VIEWER_ENTRY = "foamViewer";   // history.state key: this entry was added by opening the viewer
const NO_3D_LABEL = { photos: "View photos", drawing: "View drawing" };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const dialog = document.querySelector("[data-viewer]");
const el = dialog && {
  canvas: dialog.querySelector("[data-viewer-canvas]"),
  photo: dialog.querySelector("[data-viewer-photo]"),
  drawing: dialog.querySelector("[data-viewer-drawing]"),
  hint: dialog.querySelector("[data-viewer-hint]"),
  loading: dialog.querySelector("[data-viewer-loading]"),
  rotate: dialog.querySelector("[data-viewer-rotate]"),
  notice: dialog.querySelector("[data-viewer-notice]"),
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
let has3D = null;          // null until the first open checks for WebGL
let rotateTimer = 0;
const prefetched = new Map();   // cover URL -> Image, fetched while three.js loads
const showShare = dialog ? createShare(dialog) : () => {};

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
  controls.addEventListener("start", () => { setRotating(false); view.intro = null; });

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

/* Places the product's mattress and frames it. Returns a promise that settles when its cover photos are on. */
function placeMattress(product) {
  const { lib, renderer, scene, camera, controls, sun, fill, contact } = view;
  if (view.mattress) {
    scene.remove(view.mattress);
    lib.model.disposeMattress(view.mattress);
  }
  const { group, width, length, height, covers } = lib.model.buildMattress(lib, renderer, product);
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
  setRotating(false);
  view.intro = reducedMotion ? null : { start: performance.now(), from: distance * INTRO_PULL, to: distance, direction };
  camera.position.copy(direction).multiplyScalar(reducedMotion ? distance : distance * INTRO_PULL).add(controls.target);
  controls.update();

  sun.position.set(-reach * 0.9, reach * 2.4, reach * 1.3);
  fill.position.set(reach * 1.5, reach * 0.6, -reach);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.01, far: reach * 6 });
  sun.shadow.camera.updateProjectionMatrix();
  return covers;
}

/* Turns the slow auto-rotation on or off. `stopAfter` ends a rotation the visitor didn't ask for. */
function setRotating(isOn, { stopAfter = 0 } = {}) {
  clearTimeout(rotateTimer);
  if (view) view.controls.autoRotate = isOn;
  el.rotate.setAttribute("aria-pressed", String(isOn));
  if (isOn && stopAfter) rotateTimer = setTimeout(() => setRotating(false), stopAfter);
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
  const is3D = kind === "3d";
  el.canvas.hidden = !is3D;
  el.photo.hidden = kind !== "photo";
  el.drawing.hidden = kind !== "drawing";
  // the hint, the rotation toggle and "Loading" belong to a 3D view that is ready, or on its way
  el.hint.hidden = true;
  el.rotate.hidden = true;
  el.loading.hidden = !is3D;
  if (!is3D) stopLoop();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Still showing the 3D view of the same opening of the viewer? */
function isShowing3D(shown) {
  return dialog.open && current === shown && !el.canvas.hidden;
}

async function show3D() {
  showStage("3d");
  const shown = current;
  try {
    const lib = await loadLibrary();
    view ??= createView(lib);
    if (!isShowing3D(shown)) return;
    view.resize();
    const covers = placeMattress(shown.product);
    stopLoop();
    view.frame = requestAnimationFrame(loop);
    // the plain cover shows straight away; "Loading" stays until the photos are on it
    await Promise.race([covers, wait(COVER_WAIT_MS)]);
    if (!isShowing3D(shown)) return;
    el.loading.hidden = true;
    el.hint.hidden = false;
    el.rotate.hidden = false;
    setRotating(!reducedMotion, { stopAfter: ROTATE_MS });
  } catch (error) {
    console.error("Shakir Foam 3D viewer could not start", error);
    without3D();
  }
}

/* 3D can't start here: show the photos or the plan instead, keep focus in the dialog, and say why. */
function without3D() {
  has3D = false;
  relabelCards();
  if (!dialog.open || !current) return;
  const hadFocus = !dialog.contains(document.activeElement) || el.thumbs.contains(document.activeElement);
  renderThumbs();
  const first = el.thumbs.querySelector("button");
  selectThumb(first);
  if (hadFocus) first?.focus();
  el.note.textContent = noteFor(current.product);
  el.notice.textContent = `The 3D view isn’t available on this device, so the ${
    current.product.photos.length ? "photos are" : "drawing to scale is"} shown instead.`;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/* Once 3D is known to be missing, the cards stop promising it. */
function relabelCards() {
  document.querySelectorAll("[data-catalog] .product").forEach((card) => {
    const label = card.querySelector(".product-view > span:first-child");
    if (label) label.textContent = card.classList.contains("product--drawn") ? NO_3D_LABEL.drawing : NO_3D_LABEL.photos;
  });
}

/* Starts the cover photos downloading while three.js loads, so they're cached when the model asks. */
function prefetchCovers(product) {
  [product.top, product.side].filter(Boolean).map((src) => coverUrl(src)).forEach((url) => {
    if (prefetched.has(url)) return;
    const image = new Image();
    image.crossOrigin = "anonymous";   // as three.js's loader asks, so the cached copy matches
    image.src = url;
    prefetched.set(url, image);
  });
}

/* A gallery photo as this browser should fetch it: AVIF or WebP when it
   can show them, and the 700 px copy on phones. */
function photoUrl(src, size) {
  return copyOf(src, { size, format: pick(["avif", "webp"]) });
}

function showPhoto(src, alt) {
  showStage("photo");
  el.photo.src = photoUrl(src, isPhone() ? PHONE_PHOTO : null);
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
    img.src = photoUrl(src, THUMB_PHOTO);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = img.height = THUMB_SIDE;
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
  const lengthNote = product.lengthKnown ? "" : " The length isn’t listed, so it is shown at 190 cm.";
  if (!has3D) {
    return product.photos.length
      ? `The 3D view isn’t available on this device; the photos show the actual cover.${lengthNote}`
      : "We don’t have a photo of this model yet, and the 3D view isn’t available on this device, so it is drawn to scale. Ask on WhatsApp to see the current covers.";
  }
  if (!product.photos.length) {
    return "We don’t have a photo of this model yet, so the 3D view shows it at its real size in a plain cover. Ask on WhatsApp to see the current covers.";
  }
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
  showShare(product);
}

/* Shows `card` in the viewer. Returns false if its product data can't be read. */
function open(card) {
  let product;
  try {
    product = { slug: card.id, ...JSON.parse(card.dataset.product) };
  } catch (error) {
    console.error("Shakir Foam viewer: bad product data", error);
    return false;
  }
  current = { product, card };
  has3D ??= supportsWebGL();
  if (has3D) prefetchCovers(product);
  else relabelCards();
  el.notice.textContent = "";
  fillDetails(product, card);
  renderThumbs();
  const first = el.thumbs.querySelector("button");
  if (!dialog.open) {
    dialog.showModal();
    // not left to showModal(): it can pick the thumbnail strip itself, which scrolls on narrow phones
    first?.focus();
  }
  selectThumb(first);
  return true;
}

function close() {
  stopLoop();
  dialog.close();
}

/* ---------- Links: #slug opens a mattress; Back closes it ---------- */

function pageUrl() {
  return location.pathname + location.search;
}

/* The catalogue card a #hash names, or null for any other hash. */
function cardFor(hash) {
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const card = id ? document.getElementById(id) : null;
  return card?.matches("[data-catalog] .product[data-product]") ? card : null;
}

function pushEntry(card) {
  history.pushState({ [VIEWER_ENTRY]: card.id }, "", `${pageUrl()}#${card.id}`);
}

/* Opens the viewer as its own history entry, so Back closes it and the address bar holds its link. */
function openEntry(card) {
  if (open(card)) pushEntry(card);
}

/* Runs `fn` once the browser has done its own scroll and focus for a #fragment, two frames on. */
function afterFragment(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/* The browser's jump to a #fragment takes focus out of the dialog it opens; put it back. */
function keepFocusInside() {
  if (dialog.open && !dialog.contains(document.activeElement)) el.thumbs.querySelector("button")?.focus();
}

/* Closed with nothing to hand focus back to (it opened from a link): focus its card, where the visitor is.
   Chrome can leave focus on a button inside the closed dialog then, so that counts as nothing too.
   Called as each close happens, and again from the "close" event, which Chrome holds for a frame. */
function returnFocus() {
  const active = document.activeElement;
  if (dialog.open || (active && active !== document.body && !dialog.contains(active))) return;
  current?.card.querySelector("[data-view]")?.focus({ preventScroll: true });
}

/* When the viewer is closed by its own controls: drop the mattress from the URL without scrolling.
   Called once per close, as it happens; Back has already left the entry, so it doesn't call this. */
function leaveEntry() {
  if (history.state?.[VIEWER_ENTRY]) history.back();
  else if (cardFor(location.hash)) history.replaceState(history.state, "", pageUrl());
}

function closeByUser() {
  close();
  returnFocus();
  leaveEntry();
}

/* Back, Forward, or a #slug typed into the address bar. */
function followHistory() {
  const card = cardFor(location.hash);
  if (card && (!dialog.open || card !== current?.card)) {
    if (open(card)) afterFragment(keepFocusInside);
  } else if (!card && dialog.open) {
    close();
    returnFocus();
  }
}

/* A shared link: put the page under the mattress, so Back closes the viewer instead of leaving.
   The history entries wait for the browser's own jump to the card: the page entry keeps that
   position, so closing returns to exactly where the page already is. */
function openFromLink() {
  const card = cardFor(location.hash);
  if (!card || !open(card)) return;
  afterFragment(() => {
    keepFocusInside();
    if (!dialog.open || current?.card !== card) return;   // closed meanwhile: leaveEntry() tidied the URL
    history.replaceState(null, "", pageUrl());
    pushEntry(card);
  });
}

function init() {
  if (!dialog || typeof dialog.showModal !== "function") return;
  if (window.matchMedia("(pointer: coarse)").matches) el.hint.textContent = "Drag to turn · pinch to zoom";
  document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => openEntry(button.closest(".product")))
  );
  dialog.querySelector("[data-viewer-close]").addEventListener("click", closeByUser);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeByUser(); });
  // Escape, or Android's back gesture: the dialog closes itself straight after, so focus waits a task
  dialog.addEventListener("cancel", () => {
    leaveEntry();
    setTimeout(returnFocus);
  });
  // "close" fires a task later (Chrome waits for a frame), possibly after the next open,
  // so it must not clear `current` or touch the URL
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    stopLoop();
    returnFocus();
  });
  el.rotate.addEventListener("click", () => setRotating(el.rotate.getAttribute("aria-pressed") !== "true"));
  window.addEventListener("popstate", followHistory);
  openFromLink();
}

init();

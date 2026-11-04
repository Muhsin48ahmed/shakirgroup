/* Shakir Group — homepage interactions: business showcase, product rail and awards reel */
(function () {
  "use strict";

  const SHOWCASE_ROOT_MARGIN = "-45% 0px -45% 0px";
  const RAIL_STEP_RATIO = 0.85;
  const RAIL_END_TOLERANCE_PX = 4;
  const SWIPE_MIN_PX = 40;
  const THUMB_SCROLL_OFFSET_PX = 16;
  const REEL_INTERVAL_MS = 6500;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smoothOrInstant = () => (prefersReducedMotion ? "auto" : "smooth");

  function initShowcase() {
    const root = document.querySelector("[data-showcase]");
    if (!root || !("IntersectionObserver" in window)) return;
    const items = [...root.querySelectorAll("[data-showcase-item]")];
    const images = [...root.querySelectorAll("[data-showcase-img]")];
    const counter = root.querySelector("[data-showcase-count]");
    const place = root.querySelector("[data-showcase-place]");

    const activate = (item) => {
      const key = item.dataset.showcaseItem;
      items.forEach((el) => el.classList.toggle("is-active", el === item));
      root.dataset.active = key;
      images.forEach((img) => img.classList.toggle("is-active", img.dataset.showcaseImg === key));
      if (counter) counter.textContent = String(items.indexOf(item) + 1).padStart(2, "0");
      if (place) place.textContent = item.dataset.place || "";
    };

    const observer = new IntersectionObserver(
      (entries) => entries.filter((e) => e.isIntersecting).forEach((e) => activate(e.target)),
      { rootMargin: SHOWCASE_ROOT_MARGIN }
    );
    items.forEach((item) => observer.observe(item));
    if (items[0]) activate(items[0]);
    items.forEach((item) => item.addEventListener("focusin", () => activate(item)));

    // Backup for throttled observers: activate whichever item crosses the middle of the screen.
    window.addEventListener("scroll", () => {
      const middle = window.innerHeight / 2;
      const current = items.find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      });
      if (current && !current.classList.contains("is-active")) activate(current);
    }, { passive: true });
  }

  function initRail() {
    const rail = document.querySelector("[data-rail]");
    if (!rail) return;
    const prev = document.querySelector("[data-rail-prev]");
    const next = document.querySelector("[data-rail-next]");
    const bar = document.querySelector("[data-rail-progress]");

    const update = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      const visible = rail.scrollWidth ? rail.clientWidth / rail.scrollWidth : 1;
      const progress = max > 0 ? rail.scrollLeft / max : 0;
      if (bar) {
        bar.style.width = `${Math.max(visible, 0.08) * 100}%`;
        bar.style.left = `${progress * (1 - visible) * 100}%`;
      }
      if (prev) prev.disabled = rail.scrollLeft <= RAIL_END_TOLERANCE_PX;
      if (next) next.disabled = rail.scrollLeft >= max - RAIL_END_TOLERANCE_PX;
    };

    const step = (direction) => {
      rail.scrollBy({ left: direction * rail.clientWidth * RAIL_STEP_RATIO, behavior: smoothOrInstant() });
    };

    if (prev) prev.addEventListener("click", () => step(-1));
    if (next) next.addEventListener("click", () => step(1));
    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function initReel() {
    const reel = document.querySelector("[data-reel]");
    if (!reel) return;
    const slides = [...reel.querySelectorAll(".reel-slide")];
    const track = reel.querySelector(".reel-track");
    const toggle = reel.querySelector("[data-reel-toggle]");
    const thumbStrip = document.querySelector("[data-reel-thumbs]");
    const thumbs = [...document.querySelectorAll("[data-reel-thumb]")];
    const state = { index: 0, userPaused: prefersReducedMotion, hovering: false, focused: false, offscreen: false, timer: 0 };

    const isPaused = () => state.userPaused || state.hovering || state.focused || state.offscreen || document.hidden;

    // one timer drives autoplay; any pause clears it, resuming starts a fresh interval
    const schedule = () => {
      window.clearTimeout(state.timer);
      if (!isPaused()) state.timer = window.setTimeout(() => show(state.index + 1), REEL_INTERVAL_MS);
    };

    const syncPaused = () => {
      reel.classList.toggle("is-paused", isPaused());
      track.setAttribute("aria-live", state.userPaused ? "polite" : "off");
      toggle.setAttribute("aria-label", state.userPaused ? "Play slideshow" : "Pause slideshow");
      schedule();
    };

    // keep the thumbnail strip in step; on narrow screens scroll it sideways only (never the page)
    const syncThumbs = () => {
      thumbs.forEach((thumb, i) => {
        thumb.classList.toggle("is-active", i === state.index);
        thumb.setAttribute("aria-current", String(i === state.index));
      });
      const active = thumbs[state.index];
      if (!thumbStrip || !active || thumbStrip.scrollWidth <= thumbStrip.clientWidth) return;
      const item = active.parentElement;
      const isOutOfView = item.offsetLeft < thumbStrip.scrollLeft
        || item.offsetLeft + item.offsetWidth > thumbStrip.scrollLeft + thumbStrip.clientWidth;
      if (isOutOfView) thumbStrip.scrollTo({ left: item.offsetLeft - THUMB_SCROLL_OFFSET_PX, behavior: smoothOrInstant() });
    };

    function show(next) {
      state.index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const isActive = i === state.index;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("aria-hidden", String(!isActive));
      });
      syncThumbs();
      schedule();
    }

    thumbs.forEach((thumb, i) => thumb.addEventListener("click", () => show(i)));
    reel.querySelector("[data-reel-prev]").addEventListener("click", () => show(state.index - 1));
    reel.querySelector("[data-reel-next]").addEventListener("click", () => show(state.index + 1));
    toggle.addEventListener("click", () => { state.userPaused = !state.userPaused; syncPaused(); });

    reel.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { state.hovering = true; syncPaused(); } });
    reel.addEventListener("pointerleave", () => { state.hovering = false; syncPaused(); });
    // keyboard users get a still reel while they are inside it or its thumbnails
    [reel, thumbStrip].filter(Boolean).forEach((el) => {
      el.addEventListener("focusin", () => { state.focused = true; syncPaused(); });
      el.addEventListener("focusout", (e) => {
        if (reel.contains(e.relatedTarget) || (thumbStrip && thumbStrip.contains(e.relatedTarget))) return;
        state.focused = false; syncPaused();
      });
    });
    reel.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") show(state.index - 1);
      if (e.key === "ArrowRight") show(state.index + 1);
    });

    let startX = null;
    reel.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") startX = e.clientX; });
    reel.addEventListener("pointercancel", () => { startX = null; });
    reel.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > SWIPE_MIN_PX) show(state.index + (dx < 0 ? 1 : -1));
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => { state.offscreen = !entry.isIntersecting; syncPaused(); }).observe(reel);
    }
    document.addEventListener("visibilitychange", syncPaused);

    show(0);
    syncPaused();
  }

  initShowcase();
  initRail();
  initReel();
})();

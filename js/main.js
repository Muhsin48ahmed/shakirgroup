/* Shakir Group — shared page behaviour: header state, mobile nav, reveal, year */
(function () {
  "use strict";

  const SCROLL_THRESHOLD_PX = 8;
  const DESKTOP_NAV_MIN_PX = 1101;
  const REVEAL_FALLBACK_MS = 1200;
  const REVEAL_ENTER_RATIO = 0.92;

  function initHeader() {
    const header = document.querySelector("[data-header]");
    if (!header) return;
    const update = () => header.classList.toggle("is-scrolled", window.scrollY > SCROLL_THRESHOLD_PX);
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function initNav() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const header = document.querySelector("[data-header]");
    if (!toggle || !header) return;
    const root = document.documentElement;

    const setOpen = (isOpen) => {
      if (isOpen) {
        root.style.setProperty("--nav-top", `${header.getBoundingClientRect().bottom}px`);
      }
      root.classList.toggle("nav-open", isOpen);
      document.body.classList.toggle("nav-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Menu");
      // keep keyboard and screen-reader focus inside the open menu
      document.querySelectorAll("main, footer, .utility").forEach((el) => { el.inert = isOpen; });
      if (isOpen) {
        const first = document.querySelector("#site-nav a");
        if (first) first.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener("click", () => setOpen(!root.classList.contains("nav-open")));
    document.querySelectorAll("#site-nav a").forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("nav-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth >= DESKTOP_NAV_MIN_PX) setOpen(false);
    });
  }

  function initReveal() {
    const items = document.querySelectorAll(".reveal, .reveal-img");
    document.documentElement.classList.add("reveal-ready");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    // Enter: animate in once the element is properly on screen.
    const enterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-in");
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    // Exit: reset only once the element has fully left the viewport, so it replays next time
    // without ever hiding while any part of it is still visible.
    const exitObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) entry.target.classList.remove("is-in");
        });
      },
      { threshold: 0 }
    );
    items.forEach((el) => {
      enterObserver.observe(el);
      exitObserver.observe(el);
    });

    // Safety net and replay: never leave on-screen content hidden if an observer is throttled
    // or late, and reset anything fully off screen so it animates again on the next pass.
    const revealVisible = () => {
      const enterLine = window.innerHeight * REVEAL_ENTER_RATIO;
      items.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const isOffScreen = rect.bottom <= 0 || rect.top >= window.innerHeight;
        if (isOffScreen) el.classList.remove("is-in");
        else if (rect.top < enterLine) el.classList.add("is-in");
      });
    };
    window.addEventListener("scroll", revealVisible, { passive: true });
    window.addEventListener("load", revealVisible);
    setTimeout(revealVisible, REVEAL_FALLBACK_MS);
  }

  function initYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = year; });
  }

  function initBackToTop() {
    const button = document.querySelector("[data-to-top]");
    if (!button) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    button.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
      const skip = document.querySelector(".header .brand");
      if (skip) skip.focus({ preventScroll: true });
    });
  }

  initHeader();
  initNav();
  initReveal();
  initYear();
  initBackToTop();
})();

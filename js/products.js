/* Shakir Group — Products page: category filter (deep-linkable via #category) */
(function () {
  "use strict";

  const ALL = "all";

  function init() {
    const buttons = [...document.querySelectorAll("[data-filter]")];
    const groups = [...document.querySelectorAll("[data-group]")];
    if (!buttons.length || !groups.length) return;
    const valid = new Set([ALL, ...groups.map((g) => g.dataset.group)]);
    const status = document.querySelector("[data-filter-status]");

    const apply = (filter, shouldScroll) => {
      const active = valid.has(filter) ? filter : ALL;
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === active)));
      groups.forEach((g) => { g.hidden = active !== ALL && g.dataset.group !== active; });
      const shown = groups.filter((g) => !g.hidden).reduce((n, g) => n + g.querySelectorAll(".product").length, 0);
      const pressed = buttons.find((btn) => btn.dataset.filter === active);
      if (status) status.textContent = `Showing ${shown} products${active === ALL ? "" : ` in ${pressed.firstChild.textContent.trim()}`}.`;
      const strip = pressed && pressed.parentElement;
      if (strip && strip.scrollWidth > strip.clientWidth) {
        strip.scrollTo({ left: Math.max(0, pressed.offsetLeft - strip.clientWidth / 2 + pressed.offsetWidth / 2) });
      }
      // Newly shown groups may hold reveal-on-scroll items; show them straight away.
      groups.filter((g) => !g.hidden).forEach((g) => {
        g.querySelectorAll(".reveal, .reveal-img").forEach((el) => el.classList.add("is-in"));
      });
      if (shouldScroll) {
        document.querySelector("[data-catalogue]").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter;
        history.replaceState(null, "", filter === ALL ? location.pathname : `#${filter}`);
        apply(filter, true);
      });
    });

    const applyHash = (shouldScroll) => {
      const fromHash = decodeURIComponent(location.hash.replace("#", ""));
      apply(fromHash || ALL, shouldScroll && valid.has(fromHash));
    };
    window.addEventListener("hashchange", () => applyHash(true));
    applyHash(Boolean(location.hash));
  }

  init();
})();

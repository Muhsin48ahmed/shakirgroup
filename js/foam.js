/* Shakir Foam — mattress finder: filter the catalogue by bed size and brand.
   The filters live in the URL query (?size=king&brand=sweet-dream#range),
   so a filtered view can be shared; the #hash is left to the viewer. */
(function () {
  "use strict";

  const ALL = "all";
  const GROUPS = ["size", "brand"];
  const RANGE_ID = "range";
  const RETURN_VISITS = ["reload", "back_forward"];   // the browser restores the scroll itself

  function init() {
    const cards = [...document.querySelectorAll("[data-catalog] .product")];
    if (!cards.length) return;
    const buttons = Object.fromEntries(
      GROUPS.map((g) => [g, [...document.querySelectorAll(`[data-filter-${g}]`)]])
    );
    const status = document.querySelector("[data-filter-status]");
    const empty = document.querySelector("[data-catalog-empty]");
    const known = Object.fromEntries(
      GROUPS.map((g) => [g, new Set(buttons[g].map((b) => b.dataset[`filter${cap(g)}`]))])
    );
    let state = filtersFrom(location.search, known);

    const matches = (card, filters) =>
      GROUPS.every((g) => filters[g] === ALL || card.dataset[g] === filters[g]);

    const labelOf = (group, value) => {
      const button = buttons[group].find((b) => b.dataset[`filter${cap(group)}`] === value);
      return button ? button.firstChild.textContent.trim() : value;
    };

    const updateCounts = () => {
      GROUPS.forEach((group) => {
        buttons[group].forEach((button) => {
          const value = button.dataset[`filter${cap(group)}`];
          const count = cards.filter((c) => matches(c, { ...state, [group]: value })).length;
          button.querySelector("[data-count]").textContent = String(count);
          button.classList.toggle("is-empty", count === 0);
        });
      });
    };

    const render = () => {
      GROUPS.forEach((group) =>
        buttons[group].forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset[`filter${cap(group)}`] === state[group]))
        )
      );
      let shown = 0;
      cards.forEach((card) => {
        const isMatch = matches(card, state);
        card.hidden = !isMatch;
        if (!isMatch) return;
        shown += 1;
        card.querySelectorAll(".reveal, .reveal-img").forEach((el) => el.classList.add("is-in"));
      });
      updateCounts();
      if (empty) empty.hidden = shown > 0;
      const parts = GROUPS.filter((g) => state[g] !== ALL).map((g) => labelOf(g, state[g]));
      const noun = shown === 1 ? "mattress" : "mattresses";
      if (status) status.textContent = `Showing ${shown} ${noun}${parts.length ? `, ${parts.join(", ")}` : ""}.`;
    };

    const set = (changes) => {
      state = { ...state, ...changes };
      render();
    };

    // a chip refines the view in place: rewrite the URL rather than add a Back step per click
    const setFromChip = (changes) => {
      set(changes);
      history.replaceState(history.state, "", urlFor(state));
    };

    const openBrand = (event, brand) => {
      const isNewTab = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (isNewTab || !known.brand.has(brand)) return;
      event.preventDefault();
      set({ brand, size: ALL });
      history.pushState(null, "", urlFor(state));
      document.getElementById(RANGE_ID)?.scrollIntoView();
    };

    const followHistory = () => {
      const next = filtersFrom(location.search, known);
      if (GROUPS.some((g) => next[g] !== state[g])) set(next);
    };

    GROUPS.forEach((group) =>
      buttons[group].forEach((button) =>
        button.addEventListener("click", () => setFromChip({ [group]: button.dataset[`filter${cap(group)}`] }))
      )
    );
    document.querySelectorAll("[data-brand-link]").forEach((link) =>
      link.addEventListener("click", (event) => openBrand(event, link.dataset.brandLink))
    );
    document.querySelector("[data-filter-reset]")?.addEventListener("click", () => setFromChip({ size: ALL, brand: ALL }));
    window.addEventListener("popstate", followHistory);
    render();
    if (isFiltered(state) && isFirstVisit() && ["", `#${RANGE_ID}`].includes(location.hash)) {
      document.getElementById(RANGE_ID)?.scrollIntoView();
    }
  }

  /* The filters a URL query asks for; a value with no matching chip counts as "all". */
  function filtersFrom(search, known) {
    const params = new URLSearchParams(search);
    return Object.fromEntries(
      GROUPS.map((g) => {
        const value = params.get(g);
        return [g, value && known[g].has(value) ? value : ALL];
      })
    );
  }

  /* The page URL for these filters, scrolled to the catalogue: ?brand=sweet-dream#range */
  function urlFor(filters) {
    const query = new URLSearchParams(GROUPS.filter((g) => filters[g] !== ALL).map((g) => [g, filters[g]])).toString();
    return `${location.pathname}${query ? `?${query}` : ""}#${RANGE_ID}`;
  }

  function isFiltered(filters) {
    return GROUPS.some((g) => filters[g] !== ALL);
  }

  function isFirstVisit() {
    const entry = performance.getEntriesByType?.("navigation")[0];
    return !entry || !RETURN_VISITS.includes(entry.type);
  }

  function cap(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  init();
})();

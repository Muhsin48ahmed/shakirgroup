/* Shakir Foam — mattress finder: filter the catalogue by bed size and brand */
(function () {
  "use strict";

  const ALL = "all";
  const GROUPS = ["size", "brand"];

  function init() {
    const cards = [...document.querySelectorAll("[data-catalog] .product")];
    if (!cards.length) return;
    const buttons = Object.fromEntries(
      GROUPS.map((g) => [g, [...document.querySelectorAll(`[data-filter-${g}]`)]])
    );
    const status = document.querySelector("[data-filter-status]");
    const empty = document.querySelector("[data-catalog-empty]");
    let state = { size: ALL, brand: ALL };

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

    GROUPS.forEach((group) =>
      buttons[group].forEach((button) =>
        button.addEventListener("click", () => set({ [group]: button.dataset[`filter${cap(group)}`] }))
      )
    );
    document.querySelectorAll("[data-brand-link]").forEach((link) =>
      link.addEventListener("click", () => set({ brand: link.dataset.brandLink, size: ALL }))
    );
    document.querySelector("[data-filter-reset]")?.addEventListener("click", () => set({ size: ALL, brand: ALL }));
    render();
  }

  function cap(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  init();
})();

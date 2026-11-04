/* Shakir Foam — mattress finder: filter the catalogue by bed size */
(function () {
  "use strict";

  const ALL = "all";

  function init() {
    const buttons = [...document.querySelectorAll("[data-size-filter]")];
    const cards = [...document.querySelectorAll("[data-size-catalog] .product")];
    const status = document.querySelector("[data-size-status]");
    if (!buttons.length || !cards.length) return;

    const apply = (size) => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sizeFilter === size)));
      let shown = 0;
      cards.forEach((card) => {
        const isMatch = size === ALL || card.dataset.size === size;
        card.hidden = !isMatch;
        if (isMatch) {
          shown += 1;
          card.querySelectorAll(".reveal, .reveal-img").forEach((el) => el.classList.add("is-in"));
        }
      });
      const label = buttons.find((b) => b.dataset.sizeFilter === size).firstChild.textContent.trim();
      if (status) status.textContent = `Showing ${shown} mattresses${size === ALL ? "" : `, ${label}`}.`;
    };

    buttons.forEach((button) => button.addEventListener("click", () => apply(button.dataset.sizeFilter)));
    apply(ALL);
  }

  init();
})();

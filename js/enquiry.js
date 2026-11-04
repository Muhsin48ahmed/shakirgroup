/* Shakir Group — enquiry form: validates input and hands off to WhatsApp (primary) or email.
   Replace with a server endpoint when the site gets a backend. */
(function () {
  "use strict";

  const WHATSAPP_NUMBER = "252611111100";
  const RECIPIENTS = Object.freeze({
    info: "info@shakirgroup.com",
    sales: "sales@shakirgroup.com",
    customercare: "customercare@shakirgroup.com",
    support: "support@shakirgroup.com",
    dubai: "shakir@shakir.so",
  });
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_PATTERN = /^[+\d][\d\s()-]{5,}$/;
  const MIN_MESSAGE_LENGTH = 10;
  const FALLBACK_DELAY_MS = 1500;

  const RULES = Object.freeze({
    name: (v) => (v.length >= 2 ? "" : "Please enter your full name."),
    phone: (v, all) => {
      if (v === "" && all.email === "") return "Please give a phone number or an email address.";
      return v === "" || PHONE_PATTERN.test(v) ? "" : "Please enter a valid phone number.";
    },
    email: (v) => (v === "" || EMAIL_PATTERN.test(v) ? "" : "Please enter a valid email address, or leave it blank."),
    team: (v) => (Object.prototype.hasOwnProperty.call(RECIPIENTS, v) ? "" : "Please choose a team."),
    message: (v) => (v.length >= MIN_MESSAGE_LENGTH ? "" : `Please write at least ${MIN_MESSAGE_LENGTH} characters.`),
  });

  // Prefill from links such as contact.html?product=Sweet%20Dream%2030%20cm#enquiry
  function prefillFromQuery(form) {
    const product = new URLSearchParams(window.location.search).get("product");
    if (!product) return;
    form.elements.team.value = "sales";
    form.elements.message.value = `I'd like a price for: ${product.slice(0, 200)}`;
  }

  const readValues = (form) =>
    Object.fromEntries(Object.keys(RULES).map((key) => [key, String(form.elements[key].value || "").trim()]));

  const validate = (values) =>
    Object.fromEntries(Object.entries(RULES).map(([key, rule]) => [key, rule(values[key], values)]));

  function showErrors(form, errors) {
    Object.entries(errors).forEach(([key, message]) => {
      const input = form.elements[key];
      input.setAttribute("aria-invalid", message ? "true" : "false");
      document.getElementById(input.getAttribute("aria-describedby")).textContent = message;
    });
  }

  function buildBody(values, teamLabel) {
    return [
      `${teamLabel} — website enquiry`,
      "",
      values.message,
      "",
      `Name: ${values.name}`,
      values.phone ? `Phone: ${values.phone}` : null,
      values.email ? `Email: ${values.email}` : null,
    ].filter((line) => line !== null).join("\n");
  }

  function handOff(channel, values, teamLabel) {
    const body = buildBody(values, teamLabel);
    if (channel === "whatsapp") {
      return { url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(body)}`, label: "WhatsApp" };
    }
    const subject = `Website enquiry — ${teamLabel} — ${values.name}`;
    return {
      url: `mailto:${RECIPIENTS[values.team]}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      label: "your email app",
    };
  }

  function init() {
    const form = document.querySelector("[data-enquiry-form]");
    if (!form) return;
    const status = form.querySelector("[data-form-status]");
    prefillFromQuery(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const channel = (event.submitter && event.submitter.dataset.send) || "whatsapp";
      const values = readValues(form);
      const errors = validate(values);
      showErrors(form, errors);
      const firstInvalid = Object.keys(errors).find((key) => errors[key]);
      if (firstInvalid) {
        status.textContent = "Please check the highlighted fields.";
        form.elements[firstInvalid].focus();
        return;
      }
      const teamLabel = form.querySelector(`#f-team option[value="${values.team}"]`).textContent;
      const target = handOff(channel, values, teamLabel);
      status.textContent = `Opening ${target.label} with your message ready to send…`;
      if (channel === "whatsapp") window.open(target.url, "_blank", "noopener");
      else window.location.href = target.url;
      window.setTimeout(() => {
        status.innerHTML = 'Didn’t open? Call <a href="tel:323">323</a> from Somalia, '
          + `<a href="tel:+252611111100">+252 61 111 1100</a>, or email <a href="mailto:${RECIPIENTS[values.team]}">${RECIPIENTS[values.team]}</a>.`;
      }, FALLBACK_DELAY_MS);
    });
  }

  init();
})();

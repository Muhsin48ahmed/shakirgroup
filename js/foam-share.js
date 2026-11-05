/* Shakir Foam — share the mattress on show in the viewer.
   Phones get the system share sheet; other browsers copy the link and say
   so. "Send on WhatsApp" opens WhatsApp's contact picker with the
   mattress name and its link already typed. */

const WHATSAPP_SEND = "https://wa.me/?text=";   // no number: the sender picks the contact
const STATUS_MS = 4000;
const MESSAGES = {
  copied: "Link copied",
  failed: "Couldn’t copy. The link is in the address bar.",
};

/* The link that opens this mattress's viewer: the page without its filters, plus the mattress's #slug. */
export function productLink(slug) {
  return `${location.origin}${location.pathname}#${slug}`;
}

function canShare() {
  return typeof navigator.share === "function";
}

/* Resolves to "shared", "cancelled", "copied" or "failed". */
async function shareOrCopy(link) {
  if (canShare()) {
    try {
      await navigator.share(link);
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
      console.warn("Shakir Foam: share sheet failed, copying instead", error);
    }
  }
  try {
    await navigator.clipboard.writeText(link.url);
    return "copied";
  } catch (error) {
    console.warn("Shakir Foam: could not copy the link", error);
    return "failed";
  }
}

function linkFor(product) {
  const url = productLink(product.slug);
  return { title: `${product.name} · Shakir Foam`, text: `${product.name} (${product.size}), Shakir Foam`, url };
}

/* Wires the share controls inside `root`. Returns show(product), to call each time the viewer opens. */
export function createShare(root) {
  const button = root.querySelector("[data-viewer-share]");
  const send = root.querySelector("[data-viewer-send]");
  const status = root.querySelector("[data-viewer-share-status]");
  if (!button || !send || !status) return () => {};

  let link = null;
  let clearTimer = 0;

  const say = (message) => {
    clearTimeout(clearTimer);
    status.textContent = message;
    if (message) clearTimer = setTimeout(() => { status.textContent = ""; }, STATUS_MS);
  };

  button.textContent = canShare() ? "Share" : "Copy link";
  button.addEventListener("click", async () => {
    if (!link) return;
    say(MESSAGES[await shareOrCopy(link)] ?? "");
  });

  return (product) => {
    link = linkFor(product);
    send.href = WHATSAPP_SEND + encodeURIComponent(`${link.text}\n${link.url}`);
    say("");
  };
}

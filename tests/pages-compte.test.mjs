// Pages du compte : un élément « hidden » reste caché, et un clic sur « Mon compte » garde son effet normal.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("style : un élément « hidden » reste caché, même si sa classe l'affiche (display: grid, flex…)", () => {
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

// Charge js/espace-compte.js avec un faux document, et renvoie les écouteurs posés sur le document
function chargerEspaceCompte() {
  const ecouteurs = {};
  const element = () => ({ addEventListener() {}, querySelector: element, hidden: false, textContent: "", className: "", innerHTML: "", value: "" });
  const ctx = {
    document: { getElementById: element, querySelector: element, addEventListener: (type, fn) => { ecouteurs[type] = fn; } },
    location: { search: "", replace() {}, href: "" },
    Compte: { session: () => ({}), droits: async () => ({ offertes_restantes: 3 }), simulations: async () => [], utilisateur: async () => ({ email: "a@exemple.fr" }) },
    CONFIG_COMPTE: { simulationsOffertes: 3 }, esc: s => s, URLSearchParams
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../js/espace-compte.js", import.meta.url), "utf8"), ctx);
  return ecouteurs;
}

test("Mon compte : un clic sur un lien ou un bouton d'envoi n'est pas annulé", async () => {
  const { click } = chargerEspaceCompte();
  let annule = false;
  const lien = { id: "", closest: () => null, matches: () => false };
  await click({ target: lien, preventDefault: () => { annule = true; } });
  assert.equal(annule, false);
});

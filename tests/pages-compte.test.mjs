// Pages du compte : un élément « hidden » reste caché, un clic sur « Mon compte » garde son effet normal,
// et leurs scripts ne démarrent qu'en mode comptes.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
// La vraie règle de bascule (js/mode-site.js chargé sans page : seulement ses fonctions)
const { modeSite } = (() => { const c = vm.createContext({}); vm.runInContext(lire("js/mode-site.js"), c); return c; })();

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
    location: { hostname: "localhost", search: "", replace() {}, href: "" }, modeSite,
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

// ---- Démarrage des scripts des pages de compte : en mode comptes seulement ----
// En mode gratuit, js/mode-site.js renvoie ces pages vers l'accueil, mais pas immédiatement : avant ce renvoi, aucun script de page
// ne doit lire un retour d'e-mail (#access_token=…), écrire une session ou son cookie, appeler Supabase ou renvoyer ailleurs.

// Charge « script » dans un navigateur simulé à l'adresse « hote » ; renvoie ce qu'il a fait au chargement : fonctions de Compte
// appelées (session, retour d'e-mail, appels à Supabase), renvois (location.replace, location.href) et scripts ajoutés à la page.
async function demarrer(script, hote) {
  const appels = [], renvois = [], scripts = [];
  const reponses = { session: null, lireRetourEmail: null, jetonValide: false, droits: { offertes_restantes: 3 }, simulations: [], utilisateur: { email: "a@exemple.fr" } };
  const Compte = new Proxy({}, { get: (_, nom) => () => { appels.push(nom); return nom === "session" ? reponses.session : Promise.resolve(reponses[nom]); } });
  const element = () => ({ addEventListener() {}, querySelector: element, querySelectorAll: () => [], hidden: false, textContent: "", className: "", innerHTML: "", value: "", dataset: {} });
  const location = { hostname: hote, pathname: "/", search: "", hash: "", replace: u => renvois.push(u) };
  Object.defineProperty(location, "href", { get: () => "", set: u => renvois.push(u) });
  const ctx = vm.createContext({
    console, URLSearchParams, setTimeout, modeSite, Compte, location, history: { replaceState() {} }, window: {}, esc: s => String(s),
    CONFIG_COMPTE: { simulationsOffertes: 3, prixAffiche: "4 €", turnstileCle: "cle" },
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], addEventListener() {}, title: "",
      createElement: () => ({}), head: { appendChild: s => scripts.push(s.src) } }
  });
  vm.runInContext(lire(script), ctx, { filename: script });
  await new Promise(r => setImmediate(r));   // laisse finir le démarrage asynchrone
  return { appels, renvois, scripts };
}

test("pages de compte en mode gratuit : aucun démarrage (ni session, ni Supabase, ni renvoi, ni Turnstile)", async () => {
  for (const script of ["js/connexion.js", "js/espace-compte.js", "js/abonnement.js"])
    for (const hote of ["cleante-f.github.io", "decrypte-ton-fonds.pages.dev"])
      assert.deepEqual(await demarrer(script, hote), { appels: [], renvois: [], scripts: [] }, `${script} sur ${hote}`);
});

test("pages de compte en mode comptes : démarrage inchangé", async () => {
  const connexion = await demarrer("js/connexion.js", "localhost");
  assert.ok(connexion.appels.includes("lireRetourEmail"), "connexion : retour d'e-mail non lu");
  assert.deepEqual(connexion.scripts, ["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=captchaPret"]);
  const espace = await demarrer("js/espace-compte.js", "comptes.decrypte-ton-fonds.pages.dev");
  for (const nom of ["session", "droits", "simulations", "utilisateur"]) assert.ok(espace.appels.includes(nom), `compte : ${nom} non appelée`);
  assert.deepEqual(espace.renvois, ["connexion.html?vue=connexion&retour=compte.html"], "compte : sans session, renvoi vers la connexion");
  assert.ok((await demarrer("js/abonnement.js", "localhost")).appels.includes("session"), "abonnement : offre non affichée");
});

// Positions [début, fin] de chaque bloc « if (modeSite(location.hostname) === "comptes") { … } » (accolades équilibrées)
function blocsComptes(js) {
  const blocs = [], garde = /if \(modeSite\(location\.hostname\) === "comptes"\) \{/g;
  for (let m; (m = garde.exec(js));) {
    let i = m.index + m[0].length - 1;
    for (let profondeur = 0; i < js.length; i++) if (js[i] === "{") profondeur++; else if (js[i] === "}" && --profondeur === 0) break;
    blocs.push([m.index, i]);
  }
  return blocs;
}

test("scripts des pages de compte : démarrage dans un bloc modeSite(location.hostname) === \"comptes\"", () => {
  const demarrages = { "js/connexion.js": ["Compte.lireRetourEmail()"], "js/espace-compte.js": ["Compte.session()", "rafraichirEspace().catch"],
    "js/abonnement.js": ["afficherOffre();"] };
  for (const [script, reperes] of Object.entries(demarrages)) {
    const js = lire(script), blocs = blocsComptes(js);
    assert.ok(js.includes("modeSite("), `${script} : modeSite( absent`);
    for (const repere of reperes) {
      assert.ok(js.includes(repere), `${script} : « ${repere} » absent`);
      for (let i = js.indexOf(repere); i >= 0; i = js.indexOf(repere, i + 1))
        assert.ok(blocs.some(([debut, fin]) => debut < i && i < fin), `${script} : « ${repere} » hors du bloc réservé au mode comptes`);
    }
  }
});

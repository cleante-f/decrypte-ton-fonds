import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
function charger(fichiers, globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}

test("modeSite : comptes seulement sur la liste", () => {
  const { modeSite } = charger(["js/mode-site.js"]);
  for (const h of ["comptes.decrypte-ton-fonds.pages.dev", "localhost", "COMPTES.Decrypte-Ton-Fonds.pages.dev",
    "comptes.decrypte-ton-fonds.pages.dev.", "localhost.", " localhost "]) assert.equal(modeSite(h), "comptes", h);
  for (const h of ["cleante-f.github.io", "decrypte-ton-fonds.pages.dev", "2d427da0.decrypte-ton-fonds.pages.dev", "127.0.0.1", "exemple.org", "", undefined])
    assert.equal(modeSite(h), "gratuit", String(h));
});
test("hebergeurSite", () => {
  const { hebergeurSite } = charger(["js/mode-site.js"]);
  assert.equal(hebergeurSite("cleante-f.github.io"), "github");
  for (const h of ["decrypte-ton-fonds.pages.dev", "comptes.decrypte-ton-fonds.pages.dev", "localhost", "127.0.0.1"]) assert.equal(hebergeurSite(h), "cloudflare", h);
});
test("estPageCompte : GitHub, Cloudflare (sans .html), jamais l'accueil", () => {
  const { estPageCompte } = charger(["js/mode-site.js"]);
  for (const c of ["/connexion.html", "/decrypte-ton-fonds/compte.html", "/abonnement", "/cgv.html", "/decrypte-ton-fonds/connexion"])
    assert.equal(estPageCompte(c), true, c);
  for (const c of ["/", "/index.html", "/decrypte-ton-fonds/", "/simulateur.html", "/mentions-legales.html", "/confidentialite"])
    assert.equal(estPageCompte(c), false, c);
});
test("marquage de la page et renvoi des pages de compte (navigateur simulé)", () => {
  const remplace = [];
  const doc = { documentElement: { dataset: {} } };
  charger(["js/mode-site.js"], { document: doc, location: { hostname: "cleante-f.github.io", pathname: "/decrypte-ton-fonds/compte.html", replace: u => remplace.push(u) } });
  assert.deepEqual({ ...doc.documentElement.dataset }, { site: "gratuit", hebergePar: "github" });
  assert.deepEqual(remplace, ["index.html"]);
  const doc2 = { documentElement: { dataset: {} } }, remplace2 = [];
  charger(["js/mode-site.js"], { document: doc2, location: { hostname: "localhost", pathname: "/compte.html", replace: u => remplace2.push(u) } });
  assert.equal(doc2.documentElement.dataset.site, "comptes");
  assert.deepEqual(remplace2, []);
});

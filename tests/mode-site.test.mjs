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
// Navigateur simulé : un faux document (marquage de <html>, querySelectorAll sur des sélecteurs d'attribut, écouteurs, readyState)
// avec un élément de chaque sorte, et une fausse adresse qui note les renvois.
function naviguer(hostname, pathname, readyState = "loading") {
  const ecouteurs = {}, renvois = [];
  const element = (attribut, valeur) => ({ attribut, valeur, hidden: false, getAttribute: n => (n === attribut ? valeur : null) });
  const elements = {
    comptes: element("data-seulement", "comptes"), gratuit: element("data-seulement", "gratuit"),
    github: element("data-si-hebergeur", "github"), cloudflare: element("data-si-hebergeur", "cloudflare")
  };
  const document = {
    documentElement: { dataset: {} }, readyState,
    addEventListener: (type, fn) => { ecouteurs[type] = fn; },
    querySelectorAll: selecteurs => {
      const attributs = selecteurs.split(",").map(s => s.trim().match(/^\[([\w-]+)\]$/)?.[1]);
      assert.ok(attributs.every(Boolean), `sélecteur non simulé : ${selecteurs}`);
      return Object.values(elements).filter(e => attributs.includes(e.attribut));
    }
  };
  charger(["js/mode-site.js"], { document, location: { hostname, pathname, replace: u => renvois.push(u) } });
  const masques = () => Object.keys(elements).filter(nom => elements[nom].hidden);
  return { document, ecouteurs, renvois, masques };
}

test("marquage de la page et renvoi des pages de compte (navigateur simulé)", () => {
  const github = naviguer("cleante-f.github.io", "/decrypte-ton-fonds/compte.html");
  assert.deepEqual({ ...github.document.documentElement.dataset }, { site: "gratuit", hebergePar: "github" });
  assert.deepEqual(github.renvois, ["index.html"]);
  const local = naviguer("localhost", "/compte.html");
  assert.equal(local.document.documentElement.dataset.site, "comptes");
  assert.deepEqual(local.renvois, []);
});

test("page publique en mode gratuit : aucun renvoi", () => {
  for (const chemin of ["/decrypte-ton-fonds/index.html", "/simulateur.html", "/decrypte-ton-fonds/"])
    assert.deepEqual(naviguer("cleante-f.github.io", chemin).renvois, [], chemin);
});

test("Cloudflare, /connexion sans .html, en mode gratuit : renvoi vers l'accueil, hébergeur Cloudflare", () => {
  const page = naviguer("decrypte-ton-fonds.pages.dev", "/connexion");
  assert.deepEqual(page.renvois, ["index.html"]);
  assert.deepEqual({ ...page.document.documentElement.dataset }, { site: "gratuit", hebergePar: "cloudflare" });
});

// Le mode lecture des navigateurs ignore la feuille de style : l'attribut « hidden » cache aussi l'autre version
test("attribut hidden au chargement de la page : gratuit chez GitHub", () => {
  const page = naviguer("cleante-f.github.io", "/decrypte-ton-fonds/confidentialite.html");
  assert.equal(typeof page.ecouteurs.DOMContentLoaded, "function", "rien n'attend DOMContentLoaded");
  page.ecouteurs.DOMContentLoaded();
  assert.deepEqual(page.masques(), ["comptes", "cloudflare"]);
});

test("attribut hidden au chargement de la page : comptes chez Cloudflare", () => {
  const page = naviguer("comptes.decrypte-ton-fonds.pages.dev", "/confidentialite");
  page.ecouteurs.DOMContentLoaded();
  assert.deepEqual(page.masques(), ["gratuit", "github"]);
});

test("attribut hidden tout de suite si la page est déjà chargée", () => {
  const page = naviguer("decrypte-ton-fonds.pages.dev", "/mentions-legales", "interactive");
  assert.deepEqual(page.masques(), ["comptes", "github"]);
  assert.equal(page.ecouteurs.DOMContentLoaded, undefined);
});

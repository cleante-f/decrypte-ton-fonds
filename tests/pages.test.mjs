// Pages du site : en-tête et pied de page identiques partout, textes de l'accueil et de l'abonnement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["index", "decrypte", "performances", "simulateur", "connexion", "compte", "abonnement", "confidentialite",
  "mentions-legales", "cgv"];
export const lirePage = nom => readFileSync(new URL(`../${nom}.html`, import.meta.url), "utf8");
const CSS = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
// Premier bloc <header class="site-header"> ou <footer class="site-footer">, espaces normalisés
export function bloc(html, balise) {
  const classe = balise === "header" ? "site-header" : "site-footer";
  const m = html.match(new RegExp(`<${balise} class="${classe}">[\\s\\S]*?</${balise}>`));
  assert.ok(m, `${balise} absent`);
  return m[0].replace(/\s+/g, " ");
}

test("en-tête identique sur les 10 pages", () => {
  // #lien-compte est réécrit par Compte.majNavigation() ; aria-current dépend de la page
  const normal = nom => bloc(lirePage(nom), "header").replace(/ aria-current="page"/g, "")
    .replace(/<a class="btn-compte" id="lien-compte"[^>]*>[^<]*<\/a>/, "[lien-compte]");
  const modele = normal("index");
  for (const nom of PAGES) assert.equal(normal(nom), modele, nom);
});

test("pied de page identique sur les 10 pages", () => {
  const modele = bloc(lirePage("index"), "footer");
  for (const nom of PAGES) assert.equal(bloc(lirePage(nom), "footer"), modele, nom);
  for (const attendu of ["ni un conseil en investissement, ni une recommandation", 'href="mentions-legales.html"', 'href="cgv.html"',
    'href="confidentialite.html"', "GLEIF"]) assert.ok(modele.includes(attendu), attendu);
});

test("décrypte : réglages des alertes sous la recherche", () => {
  const html = lirePage("decrypte");
  assert.ok(!bloc(html, "header").includes("btn-reglages"));
  const recherche = html.match(/<section class="recherche"[\s\S]*?<\/section>/)[0];
  assert.ok(recherche.includes('id="btn-reglages"'));
  assert.ok(html.indexOf('id="btn-reglages"') < html.indexOf('id="panneau-reglages"'));
});

test("bouton Créateurs sobre", () => {
  const regle = CSS.match(/\.btn-createur \{[^}]*\}/)[0];
  assert.doesNotMatch(regle, /gradient|animation/);
});

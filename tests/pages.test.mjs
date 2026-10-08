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

test("accueil : textes corrigés et trois outils", () => {
  const html = lirePage("index");
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.ok(!html.includes("Euronext"), "Euronext encore cité");
  assert.ok(!main.includes("0 €"), "« 0 € » encore présent");
  for (const id of ["nb-total", "nb-francais", "nb-etf", "date-maj"]) assert.ok(main.includes(`id="${id}"`), id);
  assert.ok(main.includes("AMF (base GECO), Banque centrale européenne, ESMA, Deutsche Börse (cours différés), GLEIF et OpenFIGI"));
  const titres = [...main.matchAll(/<h2 class="outil-titre">([^<]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(titres, ["Décrypte ton fonds", "Performances", "Simulateur"]);
  for (const action of ["Décrypter un fonds →", "Voir les performances →", "Simuler →"]) assert.ok(main.includes(action), action);
  assert.equal((main.match(/>Gratuit</g) || []).length, 3);   // 2 outils toujours gratuits + la pastille du simulateur (visible en mode gratuit seulement)
  assert.ok(main.includes(">3 simulations offertes<"));
  const form = main.match(/<form class="recherche-accueil"[\s\S]*?<\/form>/)[0];
  assert.equal((form.match(/class="btn"/g) || []).length, 1);
  assert.ok(/<button type="submit" class="lien-bouton" formaction="performances.html">/.test(form));
  assert.ok(/<button type="submit" class="lien-bouton" formaction="simulateur.html">/.test(form));
});

test("abonnement : garanties reprises des CGV", () => {
  const liste = lirePage("abonnement").match(/<ul class="garanties">[\s\S]*?<\/ul>/);
  assert.ok(liste, "liste des garanties absente");
  for (const texte of ["3 simulations offertes, sans carte bancaire", "Résiliable à tout moment depuis « Mon compte »",
    "Paiement sécurisé par Stripe : tes données de carte ne passent jamais par ce site", "14 jours pour te rétracter (voir les CGV)"])
    assert.ok(liste[0].replace(/<[^>]+>/g, "").includes(texte), texte);
  assert.ok(/<li[^>]*>[^]*?14 jours[^]*?href="cgv.html"[^]*?<\/li>/.test(liste[0]), "lien vers les CGV absent");
});

test("simulateur : avertissement propre à la page conservé", () => {
  const html = lirePage("simulateur");
  const horsPied = html.replace(/<footer[\s\S]*?<\/footer>/, "");
  assert.ok(horsPied.replace(/\s+/g, " ").includes("Cette simulation repose sur des hypothèses et des données historiques. Elle ne constitue pas une garantie de performance future ni un conseil en investissement."));
});

// ---- Mode « gratuit » / « comptes » : script de bascule, éléments réservés, CSS, Turnstile ----
const HEAD = nom => lirePage(nom).match(/<head>[\s\S]*?<\/head>/)[0];

test("js/mode-site.js chargé en premier dans le <head>", () => {
  for (const nom of PAGES) {
    const head = HEAD(nom);
    const script = '<script src="js/mode-site.js"></script>';
    assert.equal(head.indexOf("<script"), head.indexOf(script), `${nom} : mode-site.js doit être le premier <script> du <head>`);
    assert.ok(head.includes(script), `${nom} : mode-site.js absent du <head>`);
    assert.ok(head.indexOf(script) < head.indexOf('<link rel="stylesheet"'), `${nom} : mode-site.js doit précéder la feuille de style`);
  }
});

test("éléments réservés au mode comptes", () => {
  const index = lirePage("index");
  // « Se connecter » / « Mon compte » : sur chaque page (le test « en-tête identique » réécrit ce lien avant de comparer)
  for (const nom of PAGES)
    assert.match(bloc(lirePage(nom), "header"), /<a class="btn-compte" id="lien-compte"[^>]*data-seulement="comptes"/, `${nom} : #lien-compte sans data-seulement="comptes"`);
  assert.ok(bloc(index, "footer").includes('<span data-seulement="comptes"><a href="cgv.html">CGV</a> · </span>'));
  assert.ok(index.includes('<span class="pilule" data-seulement="comptes">3 simulations offertes</span>'));
  assert.ok(index.includes('<span class="pilule" data-seulement="gratuit">Gratuit</span>'));
  assert.match(lirePage("simulateur"), /<p class="aide"[^>]*data-seulement="comptes"[^>]*><a href="compte\.html#simulations">/);
});

test("CSS de bascule : masquage selon le mode et l'hébergeur", () => {
  // Sans marquage (sans JavaScript, robots) : version gratuite et hébergeur GitHub, ceux du site public
  for (const selecteur of ['html:not([data-site="comptes"]) [data-seulement="comptes"]',
    'html[data-site="comptes"] [data-seulement="gratuit"]',
    'html[data-heberge-par="cloudflare"] [data-si-hebergeur="github"]',
    'html:not([data-heberge-par="cloudflare"]) [data-si-hebergeur="cloudflare"]']) {
    const i = CSS.indexOf(selecteur);
    assert.ok(i >= 0, `règle absente : ${selecteur}`);
    const regle = CSS.slice(i).match(/\{[^}]*\}/)[0];
    assert.match(regle, /display:\s*none\s*!important/, selecteur);
  }
});

test("Turnstile chargé par le script, en mode comptes seulement", () => {
  assert.ok(!lirePage("connexion").includes("challenges.cloudflare.com"), "connexion.html charge encore Turnstile");
  const js = readFileSync(new URL("../js/connexion.js", import.meta.url), "utf8");
  assert.ok(js.includes("challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=captchaPret"));
  assert.ok(js.includes("modeSite("));
  assert.match(js, /modeSite\(location\.hostname\)\s*===\s*"comptes"/);
  // L'APPEL (ligne qui commence par « chargerTurnstile(); »), pas la déclaration « function chargerTurnstile() { »
  const appel = js.search(/^chargerTurnstile\(\);/m);
  assert.ok(appel >= 0, "chargerTurnstile() n'est jamais appelée : Turnstile ne se chargerait plus en mode comptes");
  assert.ok(js.indexOf("window.captchaPret") >= 0 && js.indexOf("window.captchaPret") < appel, "l'appel de chargerTurnstile() doit venir après la définition de captchaPret");
});

test("_routes.json : js/mode-site.js exclu des Functions", () => {
  const routes = JSON.parse(readFileSync(new URL("../_routes.json", import.meta.url), "utf8"));
  assert.ok(routes.exclude.includes("/js/mode-site.js"));
});

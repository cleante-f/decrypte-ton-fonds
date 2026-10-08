// Textes légaux en deux versions : ce que montre chaque mode (gratuit / comptes) une fois les blocs de l'autre mode retirés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lirePage = nom => readFileSync(new URL(`../${nom}.html`, import.meta.url), "utf8");

// Balises sans fermeture : jamais de contenu, jamais d'imbrication
const BALISES_VIDES = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const echapper = texte => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Position [début, fin] du premier élément portant attribut="valeur" à partir de « depuis », avec tout son contenu ;
// suit l'imbrication des balises ouvrantes et fermantes de même nom, ignore les balises vides (<br>, <x/>…). null s'il n'y en a plus.
function prochainBloc(html, attribut, valeur, depuis = 0) {
  const ouvrante = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\s${echapper(attribut)}="${echapper(valeur)}"[^>]*>`, "g");
  ouvrante.lastIndex = depuis;
  const m = ouvrante.exec(html);
  if (!m) return null;
  const nom = m[1].toLowerCase();
  let fin = ouvrante.lastIndex;
  if (BALISES_VIDES.has(nom) || m[0].endsWith("/>")) return [m.index, fin];
  const balise = new RegExp(`<(/?)${nom}\\b[^>]*>`, "gi");
  balise.lastIndex = fin;
  let profondeur = 1;
  for (let b; profondeur > 0 && (b = balise.exec(html));) {
    if (b[1]) profondeur--;
    else if (!b[0].endsWith("/>")) profondeur++;
    fin = balise.lastIndex;
  }
  assert.equal(profondeur, 0, `<${nom} ${attribut}="${valeur}"> jamais refermée`);
  return [m.index, fin];
}

// Chaque élément portant attribut="valeur", avec tout son contenu
function trouverBlocs(html, attribut, valeur) {
  const blocs = [];
  for (let p = prochainBloc(html, attribut, valeur); p; p = prochainBloc(html, attribut, valeur, p[1])) blocs.push(html.slice(...p));
  return blocs;
}

// Le HTML sans les éléments portant attribut="valeur" (ni leur contenu)
export function retirerBlocs(html, attribut, valeur) {
  let reste = html;
  for (let p; (p = prochainBloc(reste, attribut, valeur));) reste = reste.slice(0, p[0]) + reste.slice(p[1]);
  return reste;
}

// Ce que voit chaque mode (le CSS masque les éléments de l'autre mode)
const enGratuit = nom => retirerBlocs(lirePage(nom), "data-seulement", "comptes");
const enComptes = nom => retirerBlocs(lirePage(nom), "data-seulement", "gratuit");
const communATous = nom => retirerBlocs(enGratuit(nom), "data-seulement", "gratuit");
const texte = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("retirerBlocs : retire l'élément et tout son contenu, en suivant l'imbrication", () => {
  assert.equal(retirerBlocs('<p>a<span data-seulement="comptes">b<span>c</span>d</span>e</p>', "data-seulement", "comptes"), "<p>ae</p>");
  assert.equal(retirerBlocs('<div data-seulement="comptes"><div/>a<br>b</div>c<div data-seulement="comptes">d</div>', "data-seulement", "comptes"), "c");
  assert.equal(retirerBlocs('a<br data-seulement="comptes">b<p data-seulement="gratuit">c</p>', "data-seulement", "comptes"), 'ab<p data-seulement="gratuit">c</p>');
  assert.equal(retirerBlocs('<p xdata-seulement="comptes">a</p>', "data-seulement", "comptes"), '<p xdata-seulement="comptes">a</p>');
});

test("texte visible en mode gratuit : ni compte, ni prestataire de paiement, ni valeur à compléter, ni adresse e-mail", () => {
  for (const nom of ["index", "decrypte", "performances", "simulateur", "confidentialite", "mentions-legales"]) {
    const html = enGratuit(nom);
    assert.ok(!html.includes("[["), `${nom} : valeur [[…]] visible en mode gratuit`);
    for (const mot of ["supabase", "stripe", "brevo", "dtf_session", "turnstile"])
      assert.ok(!html.toLowerCase().includes(mot), `${nom} : « ${mot} » visible en mode gratuit`);
    assert.doesNotMatch(html, /mailto:[^"'<>\s]*@/i, `${nom} : adresse e-mail visible en mode gratuit`);
  }
});

test("hébergeur selon l'adresse : GitHub, Inc. et Cloudflare, Inc. visibles en mode gratuit", () => {
  for (const nom of ["confidentialite", "mentions-legales"]) {
    const html = enGratuit(nom);
    assert.ok(trouverBlocs(html, "data-si-hebergeur", "github").some(b => b.includes("GitHub, Inc.")), `${nom} : GitHub, Inc. absent`);
    assert.ok(trouverBlocs(html, "data-si-hebergeur", "cloudflare").some(b => b.includes("Cloudflare, Inc.")), `${nom} : Cloudflare, Inc. absent`);
  }
  // Tableau des organismes contactés : lien vers la politique de confidentialité de chaque hébergeur
  const html = enGratuit("confidentialite");
  assert.ok(trouverBlocs(html, "data-si-hebergeur", "github").some(b => b.includes(">Politique de GitHub</a>")), "lien Politique de GitHub absent");
  assert.ok(trouverBlocs(html, "data-si-hebergeur", "cloudflare").some(b =>
    b.includes('<a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Politique de Cloudflare</a>')), "lien Politique de Cloudflare absent");
});

test("version comptes intacte", () => {
  const confidentialite = enComptes("confidentialite");
  for (const mot of ["dtf_session", "Supabase", "Stripe"]) assert.ok(confidentialite.includes(mot), `confidentialite : « ${mot} » absent en mode comptes`);
  assert.ok(enComptes("mentions-legales").includes("[[SIRET]]"), "mentions-legales : [[SIRET]] absent en mode comptes");
});

test("confidentialité en mode gratuit : services contactés, stockage, contact et droits", () => {
  const html = enGratuit("confidentialite");
  const visible = texte(html);
  for (const attendu of ["geco.amf-france.org", "data-api.ecb.europa.eu", "aucun cookie", "Tes réglages des alertes", "Copies de données publiques",
    "articles 15 à 21", "article 77"]) assert.ok(visible.includes(attendu), attendu);
  for (const absent of ["compte-session-v1", "Mémoriser mon plan", "Ton plan du simulateur"]) assert.ok(!visible.includes(absent), absent);
  assert.ok(html.includes('href="https://github.com/cleante-f/decrypte-ton-fonds/issues"'), "lien vers la page GitHub du site absent");
  assert.ok(enGratuit("mentions-legales").includes('href="https://github.com/cleante-f/decrypte-ton-fonds/issues"'), "mentions légales : contact absent");
});

test("confidentialité : bouton d'effacement, sources des serveurs et liens externes communs aux deux modes", () => {
  const commun = communATous("confidentialite");
  assert.equal((lirePage("confidentialite").match(/id="effacer-donnees"/g) || []).length, 1, "un seul bouton #effacer-donnees");
  assert.ok(commun.includes('id="effacer-donnees"'), "#effacer-donnees réservé à un mode");
  assert.ok(texte(commun).includes("Ton navigateur ne contacte jamais ces services."), "paragraphe des sources réservé à un mode");
  assert.ok(texte(commun).includes("Les liens vers d'autres sites"), "paragraphe des liens externes réservé à un mode");
});

test("un seul hébergeur visible en mode gratuit", () => {
  for (const nom of ["confidentialite", "mentions-legales"]) {
    const html = enGratuit(nom);
    assert.ok(!retirerBlocs(html, "data-si-hebergeur", "cloudflare").includes("Cloudflare, Inc."), `${nom} : Cloudflare, Inc. visible chez GitHub`);
    assert.ok(!retirerBlocs(html, "data-si-hebergeur", "github").includes("GitHub, Inc."), `${nom} : GitHub, Inc. visible chez Cloudflare`);
  }
});

test("date de mise à jour : 7 octobre 2026, commune aux deux modes", () => {
  for (const nom of ["confidentialite", "mentions-legales"])
    assert.ok(texte(communATous(nom)).includes("Page mise à jour le 7 octobre 2026."), nom);
});

// ---- Pages de compte (connexion, compte, abonnement, cgv) : elles n'existent qu'en mode comptes ----
// Sans JavaScript (robots, mode lecture, script bloqué), la page s'affiche en version gratuite : aucun formulaire
// (un envoi sans « method » mettrait l'e-mail et le mot de passe dans l'adresse), aucune offre payante, aucune valeur « [[…]] ».
const PAGES_COMPTE = ["connexion", "compte", "abonnement", "cgv"];
const contenuMain = html => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
// Texte du <body>, sans les scripts (le <title> et les <meta> du <head> ne s'affichent pas dans la page)
const texteVisible = html => texte(html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script\b[\s\S]*?<\/script>/g, " "));

test("pages de compte : jamais indexées par les moteurs de recherche", () => {
  for (const nom of PAGES_COMPTE) assert.match(lirePage(nom), /<meta name="robots" content="noindex">/, nom);
});

test("pages de compte en version gratuite (sans JavaScript) : « Page indisponible », ni formulaire, ni offre, ni valeur à compléter", () => {
  for (const nom of PAGES_COMPTE) {
    const html = enGratuit(nom);
    assert.ok(!html.includes("<form"), `${nom} : formulaire visible en mode gratuit`);
    assert.ok(!html.includes("[["), `${nom} : valeur [[…]] visible en mode gratuit`);
    assert.ok(!texteVisible(html).toLowerCase().includes("abonnement"), `${nom} : « abonnement » visible en mode gratuit`);
    assert.ok(texteVisible(html).includes("n'existe pas dans la version gratuite"), `${nom} : message de page indisponible absent`);
    assert.equal(texte(contenuMain(html)).trim(),
      "Page indisponible Cette page n'existe pas dans la version gratuite du site. Revenir à l'accueil", `${nom} : <main> en mode gratuit`);
    assert.match(contenuMain(html), /<a href="index\.html">Revenir à l'accueil<\/a>/, `${nom} : lien vers l'accueil absent`);
  }
});

test("pages de compte en mode comptes : tout le contenu de <main> dans un seul bloc réservé au mode comptes", () => {
  for (const nom of PAGES_COMPTE) {
    const main = contenuMain(enComptes(nom)).trim();
    const blocs = trouverBlocs(main, "data-seulement", "comptes");
    assert.equal(blocs.length, 1, `${nom} : un seul bloc data-seulement="comptes" attendu dans <main>`);
    assert.equal(main, blocs[0], `${nom} : contenu de <main> hors du bloc réservé au mode comptes`);
  }
  const reperes = {
    connexion: ['id="titre-compte"', 'id="message-compte"', 'id="form-inscription"', 'id="form-connexion"', 'id="form-oubli"', 'id="form-nouveau-mdp"'],
    compte: ['id="message-compte"', 'id="bloc-acces"', 'id="liste-simulations"', 'id="form-email"', 'id="form-mdp"', 'id="exporter"', 'id="deconnecter"', 'id="supprimer"'],
    abonnement: ['class="garanties"', 'id="offre"', 'id="message-compte"', "Que pourrait devenir ton investissement ?"],
    cgv: ["Conditions générales de vente", "[[PRIX]]", "[[MEDIATEUR_SITE]]", "1. Objet et vendeur", "11. Droit applicable"]
  };
  for (const [nom, attendus] of Object.entries(reperes))
    for (const attendu of attendus) assert.ok(contenuMain(enComptes(nom)).includes(attendu), `${nom} : « ${attendu} » absent en mode comptes`);
});

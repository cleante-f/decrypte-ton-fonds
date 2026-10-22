// Pages fixes des fonds dans le site : ouverture du fonds de la page (FICHE_FIXE), liens vers les pages fonds/…,
// chemins des fichiers du site depuis une page rangée dans un dossier (RACINE_SITE = "../").
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fondsDesPages } from "../scripts/construire_pages.mjs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Lignes de l'annuaire (modèle de data/annuaire.js ; ISIN réels ou inventés avec une clé de contrôle valide)
const CW8 = ["E", 0, 0, "Amundi MSCI World Swap UCITS ETF EUR Acc", "", "", "", "LU1681043599", "", "LU", "CW8", "Paris", "EUR", 1, 1];
const EUNL = ["E", 0, 0, "iShares Core MSCI World UCITS ETF USD (Acc)", "", "", "", "IE00B4L5Y983", "", "IE", "EUNL", "Xetra", "USD", 1, 1];
const SP500 = ["G", 49843, 49843, "AMUNDI PEA S&P 500 UCITS ETF", "AMUNDI ASSET MANAGEMENT", "Actions internationales", "FCP", "FR0011871128 FR0011871136", "2014-04-17", "FR", "PSP5", "", "", 1, 1];
// Même ISIN que SP500, ligne d'ETF coté : le site ouvre la ligne GECO pour cet ISIN, la page est donc celle de SP500
const SP500_COTE = ["E", 0, 0, "Amundi PEA S&P 500 ESG UCITS ETF Acc", "", "", "", "FR0011871128", "", "FR", "PSP5", "Paris", "EUR", 1, 1];
// Fonds étranger commercialisé en France : jamais de page
const ETRANGER = ["N", 40468, 0, "JPMORGAN FUNDS - GREATER CHINA FUND", "JPMORGAN ASSET MANAGEMENT (EUROPE) S.A.R.L.", "", "", "LU0522352946", "2009-11-17", "LU", "", "", "", 0, 1];
const ANNUAIRE_T = [CW8, EUNL, SP500, SP500_COTE, ETRANGER];

const SCRIPTS_DECRYPTE = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js", "js/adresses.js",
  "js/inventaire.js", "js/style.js", "js/alternatives.js", "js/composition.js", "js/affichage.js", "js/marches.js", "js/cours.js", "js/fiche-auto.js",
  "js/config-compte.js", "js/compte.js", "js/nav.js", "js/app.js"];

let numeroPage = 0;   // chaque page compile sa propre copie des scripts (voir tests/fiche-registres-ue.test.mjs)
const executer = (ctx, texte, filename) => vm.runInContext(`${texte}\n// page simulée ${++numeroPage}`, ctx, { filename });

// Objet qui accepte tout : les éléments de la page que les tests n'examinent pas
function faux() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : faux()),
    set: () => true,
    apply: () => faux()
  });
}

// Page simulée : decrypte.html (racine "") ou une page fixe (racine "../", ficheFixe = ISIN)
function page({ hash = "", ficheFixe = null, racine = null, scripts = SCRIPTS_DECRYPTE } = {}) {
  const elements = new Map(), chargements = [], requetes = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Proxy({ innerHTML: "", textContent: "", value: "", hidden: false, href: "" }, {
      get: (t, c) => (c in t ? t[c] : faux()), set: (t, c, v) => { t[c] = v; return true; } }));
    return elements.get(id);
  };
  const head = { appendChild(el) { chargements.push(el.src); setTimeout(() => el.onerror(), 0); } };
  const document = { title: "Titre de la page", getElementById: element, createElement: () => ({}), querySelectorAll: () => [],
    querySelector: () => faux(), head, addEventListener() {}, documentElement: { dataset: {} } };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, document, ANNUAIRE: ANNUAIRE_T, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hostname: "cleante-f.github.io", hash, search: "", href: "" }, history: { replaceState() {} },
    fetch: async url => { requetes.push(String(url)); throw new Error("réseau coupé"); }, alert() {} });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.scrollTo = () => {};
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  if (racine !== null) ctx.RACINE_SITE = racine;   // ce que js/mode-site.js déduit de son propre chemin
  for (const f of scripts) {
    if (f === "js/app.js" && ficheFixe) vm.runInContext(`var FICHE_FIXE = ${JSON.stringify(ficheFixe)};`, ctx);   // comme la page générée
    executer(ctx, lire(f), f);
  }
  return { ctx, element, chargements, requetes, document };
}
async function attendre(condition, delai = 3000) {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > delai) throw new Error("délai dépassé");
    await new Promise(ok => setTimeout(ok, 5));
  }
}

test("page fixe sans « # » : la fiche du fonds de la page s'ouvre, le titre de la page reste", async () => {
  const p = page({ ficheFixe: "LU1681043599", racine: "../" });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("Amundi MSCI World Swap UCITS ETF EUR Acc</h2>"));
  assert.equal(p.document.title, "Titre de la page", "le titre fait pour Google n'est pas remplacé");
});

test("page fixe : le nom de la fiche du fonds de la page est un h2 (le h1 est celui du résumé fixe) ; h1 ailleurs", async () => {
  const p = page({ ficheFixe: "LU1681043599", racine: "../" });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("Amundi MSCI World Swap UCITS ETF EUR Acc</h2>"));
  assert.ok(!resultat.innerHTML.includes("<h1"), "pas de second h1 sur la page fixe");
  // Autre fonds ouvert par « # » sur une page fixe, ou fiche sur decrypte.html : h1
  const D = { erreurs: [], composition: { fini: true, c: null } };
  const e = p.ctx.lireEntree(EUNL);
  assert.ok(p.ctx.afficherFicheAuto(e, null, D, false).includes("<h1>iShares Core MSCI World UCITS ETF USD (Acc)</h1>"));
  const d = page();
  assert.ok(d.ctx.afficherFicheAuto(d.ctx.lireEntree(CW8), null, D, false).includes("<h1>Amundi MSCI World Swap UCITS ETF EUR Acc</h1>"));
  // Autre part du fonds de la page : toujours le fonds de la page, donc h2
  const sp = page({ ficheFixe: "FR0011871128", racine: "../" });
  assert.ok(sp.ctx.afficherFicheAuto(sp.ctx.lireEntree(SP500), "FR0011871136", D, false).includes("<h2>AMUNDI PEA S&amp;P 500 UCITS ETF</h2>"));
});

test("page fixe avec « #autre » : l'adresse l'emporte", async () => {
  const p = page({ ficheFixe: "LU1681043599", racine: "../", hash: "#IE00B4L5Y983" });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("<h1>iShares Core MSCI World UCITS ETF USD (Acc)</h1>"));
  assert.ok(!resultat.innerHTML.includes("Amundi MSCI World Swap"));
});

test("decrypte.html sans « # » : rien ne s'ouvre", async () => {
  const p = page();
  await new Promise(ok => setTimeout(ok, 30));
  assert.equal(p.element("resultat").innerHTML, "");
});

test("page fixe : une recherche qui trouve un autre fonds mène à decrypte.html#…", async () => {
  const p = page({ ficheFixe: "LU1681043599", racine: "../" });
  await p.ctx.lancerRecherche("IE00B4L5Y983");
  assert.equal(p.ctx.location.href, "../decrypte.html#IE00B4L5Y983");
  assert.equal(p.ctx.location.hash, "", "la page fixe n'affiche pas un autre fonds sous son résumé");
});

test("decrypte.html : une recherche qui trouve un seul fonds l'ouvre sur place", async () => {
  const p = page();
  await p.ctx.lancerRecherche("IE00B4L5Y983");
  assert.equal(p.ctx.location.hash, "IE00B4L5Y983");
  assert.equal(p.ctx.location.href, "");
});

test("lienFiche : page fixe pour le fonds qui la possède, decrypte.html#… sinon ; préfixe de la racine", () => {
  const p = page();
  const lien = (l, isin) => p.ctx.lienFiche(p.ctx.lireEntree(l), isin);
  assert.equal(lien(CW8), "fonds/amundi-msci-world-swap-ucits-etf-eur-acc-LU1681043599.html");
  assert.equal(lien(SP500), "fonds/amundi-pea-s-p-500-ucits-etf-FR0011871128.html");
  assert.equal(lien(SP500, "FR0011871136"), "decrypte.html#FR0011871136", "autre part : la fiche de cette part");
  assert.equal(lien(SP500_COTE), "decrypte.html#FR0011871128", "même ISIN qu'un fonds GECO : la page appartient au fonds GECO");
  assert.equal(lien(ETRANGER), "decrypte.html#LU0522352946");
  const fixe = page({ ficheFixe: "LU1681043599", racine: "../" });
  assert.equal(fixe.ctx.lienFiche(fixe.ctx.lireEntree(EUNL)), "../fonds/ishares-core-msci-world-ucits-etf-usd-acc-IE00B4L5Y983.html");
  assert.equal(fixe.ctx.lienFiche(fixe.ctx.lireEntree(ETRANGER)), "../decrypte.html#LU0522352946");
});

test("adresseFonds dans le site : null pour une ligne qui ne possède pas la page ; même règle que le générateur", () => {
  const p = page();
  const adresse = l => p.ctx.adresseFonds(p.ctx.lireEntree(l));
  assert.equal(adresse(SP500_COTE), null);
  assert.equal(adresse(SP500), "fonds/amundi-pea-s-p-500-ucits-etf-FR0011871128.html");
  // Le générateur fait une page pour exactement les fonds qui ont une adresse dans le site
  const pages = fondsDesPages(ANNUAIRE_T).map(e => e.nom).sort();
  const site = ANNUAIRE_T.filter(l => adresse(l)).map(l => l[3]).sort();
  assert.deepEqual(pages, site);
  // Et chaque page ouvre, par son ISIN, la ligne dont elle porte le résumé
  for (const e of fondsDesPages(ANNUAIRE_T)) assert.equal(p.ctx.annuaireParIsin(e.isins[0]).nom, e.nom);
});

test("liste de résultats de decrypte.html : liens vers les pages fixes, decrypte.html#… sinon", async () => {
  const p = page();
  const html = p.ctx.afficherListe("amundi", [SP500, SP500_COTE, ETRANGER].map(l => p.ctx.lireEntree(l)), p.ctx.lienFiche);
  assert.ok(html.includes('href="fonds/amundi-pea-s-p-500-ucits-etf-FR0011871128.html"'), html);
  assert.ok(html.includes('href="decrypte.html#FR0011871128"'));
  assert.ok(html.includes('href="decrypte.html#LU0522352946"'));
  // Sans fonction de lien (simulateur) : « #clé », qui choisit le fonds sur place
  assert.ok(p.ctx.afficherListe("amundi", [p.ctx.lireEntree(ETRANGER)]).includes('href="#LU0522352946"'));
  // Recherche sur decrypte.html : la liste utilise ces liens
  await p.ctx.lancerRecherche("msci world");
  assert.ok(p.element("resultat").innerHTML.includes('href="fonds/amundi-msci-world-swap-ucits-etf-eur-acc-LU1681043599.html"'));
});

test("page générée (RACINE_SITE = \"../\") : fichiers de données, liens du compte et de la fiche depuis la racine", async () => {
  const p = page({ ficheFixe: "LU1681043599", racine: "../" });
  await attendre(() => p.requetes.length > 0);
  assert.ok(p.requetes.includes("../data/cours/index.json"), p.requetes.join(", "));
  await p.ctx.chargerScript("data/annuaire-registres-ue.js").catch(() => {});
  assert.ok(p.chargements.includes("../data/annuaire-registres-ue.js"), p.chargements.join(", "));
  await p.ctx.chargerPdfJs().catch(() => {});
  assert.ok(p.chargements.includes("../js/vendor/pdfjs/pdf.min.js"), p.chargements.join(", "));
  assert.equal(p.element("lien-compte").href, "../connexion.html");
  await attendre(() => p.element("resultat").innerHTML.includes("Simuler mon investissement"));
  assert.ok(p.element("resultat").innerHTML.includes('href="../simulateur.html#LU1681043599"'));
  assert.ok(p.element("resultat").innerHTML.includes('href="../performances.html#LU1681043599"'));
});

test("decrypte.html : chemins inchangés (racine vide)", async () => {
  const p = page({ hash: "#LU1681043599" });
  await attendre(() => p.requetes.length > 0);
  assert.ok(p.requetes.includes("data/cours/index.json"));
  assert.equal(p.element("lien-compte").href, "connexion.html");
  await attendre(() => p.element("resultat").innerHTML.includes("Simuler mon investissement"));
  assert.ok(p.element("resultat").innerHTML.includes('href="simulateur.html#LU1681043599"'));
});

test("js/mode-site.js déduit RACINE_SITE de son propre chemin", () => {
  const racine = src => {
    const ctx = vm.createContext({ console, location: { hostname: "cleante-f.github.io", pathname: "/", replace() {} },
      document: { currentScript: src === null ? null : { getAttribute: n => (n === "src" ? src : null) }, documentElement: { dataset: {} },
        readyState: "complete", querySelectorAll: () => [], addEventListener() {} } });
    vm.runInContext(lire("js/mode-site.js"), ctx, { filename: "js/mode-site.js" });
    return ctx.RACINE_SITE;
  };
  assert.equal(racine("js/mode-site.js"), "");
  assert.equal(racine("../js/mode-site.js"), "../");
  assert.equal(racine(null), "");
  assert.equal(racine("https://exemple.org/js/mode-site.js"), "", "jamais une adresse d'un autre site");
});

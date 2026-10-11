// Fiche d'un fonds américain (SEC) : js/fiche-auto.js avec les données de js/etats-unis.js, et noms de pays de js/inventaire.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";

process.env.TZ = "Europe/Paris";   // les dates s'affichent en heure de Paris

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

// ---------- Fonds de test : vrais détails de data/etats-unis/ (format du contrat Python → JS) ----------

const mois81 = Array.from({ length: 81 }, (_, i) => (i % 5) - 1.5);
const VANGUARD = {
  nom: "VANGUARD 500 INDEX FUND", lei: "12WZ1W76P8QD4VJ6OB47", date: "2026-06-30", actif: 1466764579568, lignes: 508, exclu: 0.01,
  top: [["NVIDIA Corp", 7.51, "US67066G1040"], ["Apple Inc", 6.59, "US0378331005"], ["Microsoft Corp", 4.3, "US5949181045"]],
  pays: [["US", 100.1]],
  classes: [["Actions", 99.75], ["Monétaire", 0.35]],
  devises: [["USD", 100.1]],
  parts: [
    ["C000007773", "Investor Shares", "VFINX", "2019-10", mois81, [0.14, null, 0.14, 0, null, "2026-04-28"]],
    ["C000007774", "Admiral Shares", "VFIAX", "2019-10", mois81, [0.04, null, 0.04, 0, null, "2026-04-28"]],
    ["C000092055", "ETF Shares", "VOO", "2019-10", mois81, [0.03, 0.03, null, null, null, "2026-04-28"]],
    ["C000170274", "Institutional Select Shares", "VFFSX", "2019-10", mois81, [0.01, null, 0.01, 0, null, "2026-04-28"]]
  ]
};
const LIGNE_S = ["S", 2839, 2839, "Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS", "", "", "", "", "US", "VFINX VFIAX VOO VFFSX", "", "USD", 1, 1];
const LIGNE_VOO = ["E", 0, 0, "Vanguard 500 Index Fund Registered Shares ETF o.N.", "", "", "", "US9229083632", "", "US", "", "", "USD", 1, 1];
const LIGNE_FR = ["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1];
const ligneS = (n, nom = "Fonds américain " + n) => ["S", n, n, nom, "Une structure", "", "", "", "", "US", "", "", "USD", 0, 1];

// Une page : tous les scripts de la fiche, un localStorage simulé, la table ISIN → série et la zone américaine
const SCRIPTS = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/inventaire.js", "js/style.js",
  "js/composition.js", "js/zones.js", "js/etats-unis.js", "js/marches.js", "js/fiche-auto.js"];
function page() {
  const stockage = new Map();
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: k => stockage.delete(k), get length() { return stockage.size; }, key: i => [...stockage.keys()][i] };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage, ANNUAIRE: [], document: {} });
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = { US9229083632: "S000002839" };`, ctx);
  for (const f of SCRIPTS) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`ANNUAIRE_ZONES["etats-unis"] = { maj: "2026-10-11", trimestre: "2026q3", lignes: [] };`, ctx);
  return ctx;
}
// Met un détail dans le morceau de données du navigateur : donneesSec le trouve sans rien charger
function avecDetail(ctx, serie, detail) {
  vm.runInContext(`ETATS_UNIS_DETAILS[${Number(serie.slice(1)) % 64}] = Object.assign(ETATS_UNIS_DETAILS[${Number(serie.slice(1)) % 64}] || {}, ${JSON.stringify({ [serie]: detail })});`, ctx);
}
// Données de la fiche comme app.js les assemble pour un fonds américain
async function donneesFiche(ctx, e, isin, detail, serie = "S000002839") {
  avecDetail(ctx, serie, detail);
  const sec = await ctx.donneesSec(e, isin);
  return { erreurs: [], sec, composition: { fini: true, c: sec && sec.compo } };
}
const fiche = (ctx, e, isin, d, chargement = false) => ctx.afficherFicheAuto(e, isin, d, chargement);

// ---------- Fiche d'une série américaine ----------

test("fiche S : identité, sources et alerte", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, VANGUARD));
  for (const attendu of ["Série SEC", "S000002839", "ETF Shares", "VOO", "Source : SEC – EDGAR", "converti en euros (taux BCE)",
    "Fonds de droit non européen (États-Unis)", "formulaire N-PORT", "Frais (prospectus déposé à la SEC)",
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=S000002839&amp;type=485&amp;count=10"]) {
    assert.ok(html.includes(attendu), attendu);
  }
  assert.ok(!html.includes("ISIN non publié"));
  assert.ok(!html.includes("AMF – base GECO"));
  assert.ok(html.includes("<h1>Vanguard 500 Index Fund</h1>"), "le titre est la ligne de l'annuaire, pas detail.nom");
  assert.ok(!html.includes("VANGUARD 500 INDEX FUND"));
  assert.ok(html.includes("Documents officiels du fonds sur EDGAR (SEC)"));
  assert.ok(html.includes("Structure déposante (SEC)"));
  assert.ok(html.includes("12WZ1W76P8QD4VJ6OB47"), "LEI");
  assert.ok(/1\s?466\s?765 M€/.test(html), "actif net en millions d'euros");
  assert.ok(html.includes("converti au taux BCE de fin de mois"));
  assert.ok(html.includes("30/06/2026"));
  assert.ok(html.includes("Pas d'indicateur SRI : il vient du DIC européen, que les fonds américains n'ont pas."));
  assert.ok(html.includes("Rendements mensuels déclarés à la SEC"));
  assert.ok(html.includes("Les performances passées ne préjugent pas des performances futures."));
  assert.ok(html.includes("Données déclarées à la SEC : vérifie le prospectus officiel avant toute décision."));
  assert.ok(html.includes("508 lignes"));
});

test("fiche S : en-tête « Série SEC <clé> · part « nom » (ticker) »", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, VANGUARD));
  assert.match(html, /<p>Série SEC S000002839 · part « ETF Shares » \(VOO\) · VANGUARD INDEX FUNDS<\/p>/);
  // en chargement, sans données : la clé seulement
  assert.match(fiche(ctx, e, undefined, null, true), /<p>Série SEC S000002839 · VANGUARD INDEX FUNDS<\/p>/);
});

test("fiche S : performances, volatilité et perte maximale, avec graphique", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, VANGUARD));
  assert.ok(html.includes("Performances et risque"));
  for (const t of ["Performance annualisée", "Volatilité", "Perte maximale"]) assert.ok(html.includes(t), t);
  for (const t of ["1 an", "3 ans", "5 ans"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("graphique-vl") && html.includes("Valeur d&#39;une part en euros (base 100)"));
  // les points mensuels sont le rythme de déclaration à la SEC, pas la fréquence de valorisation du fonds
  assert.ok(!html.includes("Valeur calculée de façon"));
  assert.ok(!html.includes("la volatilité n'est pas calculée"));
  assert.ok(!html.includes("Valeur calculée de façon mensuelle"));
  const pieges = simple(ctx.detecterPiegesAuto(e, await donneesFiche(ctx, e, undefined, VANGUARD)));
  assert.ok(!pieges.some(p => /Valeur calculée/.test(p.titre)));
});

test("fiche S : composition, notes et zones", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, VANGUARD));
  assert.ok(html.includes("Où est investi l&#39;argent") || html.includes("Où est investi l'argent"));
  assert.ok(html.includes("déclarée par le fonds à la SEC"));
  assert.ok(html.includes("NVIDIA Corp"));
  assert.ok(html.includes("Données brutes : formulaire N-PORT (SEC – EDGAR)"));
  assert.ok(!html.includes("fonds français qui suit"));
  assert.ok(!html.includes("Recherche d'un fonds français"));
});

test("fiche S : frais du prospectus, parts et alertes", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const d = await donneesFiche(ctx, e, undefined, VANGUARD);
  const html = fiche(ctx, e, undefined, d);
  for (const t of ["Frais annuels bruts", "Frais annuels nets", "Droits d&#39;entrée maximum", "Frais de sortie différés", "0,03 %", "non publié"]) {
    assert.ok(html.includes(t), t);
  }
  // section 6 : les quatre parts, la part affichée en gras
  assert.ok(html.includes("<strong>ETF Shares — VOO (cette part)</strong>"));
  for (const t of ["Investor Shares", "VFINX", "Admiral Shares", "VFIAX", "Institutional Select Shares", "VFFSX"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("4 parts"));
  // frais faibles : aucune alerte de frais
  const pieges = simple(ctx.detecterPiegesAuto(e, d));
  assert.ok(!pieges.some(p => /^Frais/.test(p.titre)));
  assert.ok(!html.includes("Analyse limitée"));
});

test("fiche S : frais élevés, droits d'entrée et frais de sortie d'après le prospectus", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", "2019-10", mois81, [2.62, 2.21, 1, 5.75, 1, "2026-02-26"]]] };
  const d = await donneesFiche(ctx, e, undefined, detail, "S000000001");
  const pieges = simple(ctx.detecterPiegesAuto(e, d));
  assert.ok(pieges.some(p => p.niveau === "alerte" && p.titre.startsWith("Frais annuels élevés : 2,21 %")));
  assert.ok(pieges.some(p => p.titre === "Droits d'entrée jusqu'à 5,75 %"));
  assert.ok(pieges.some(p => p.titre.startsWith("Frais de sortie")));
  const html = fiche(ctx, e, undefined, d);
  assert.ok(html.includes("Frais annuels élevés : 2,21 %"));
  assert.ok(html.includes("Droits d&#39;entrée jusqu&#39;à 5,75 %"));
  assert.ok(html.includes("jusqu&#39;à 5,75 %") && html.includes("1,00 %"));
});

// ---------- Un fonds américain déjà présent en Europe ----------

test("fonds américain déjà présent (VOO) : composition SEC et cours", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_VOO);
  const d = await donneesFiche(ctx, e, "US9229083632", VANGUARD);
  d.coursFini = true;
  const html = fiche(ctx, e, "US9229083632", d);
  assert.ok(html.includes("formulaire N-PORT"));
  assert.ok(html.includes("Aucun cours relevé"));
  assert.ok(!html.includes("fonds français qui suit le même indice"));
  assert.ok(!html.includes("Recherche d'un fonds français"));
  // l'identité européenne reste : l'ISIN, pas de numéro de série en en-tête
  assert.ok(html.includes("US9229083632"));
  assert.ok(!html.includes("<p>Série SEC"));
  assert.ok(html.includes("Performances et risque") && html.includes("Frais (prospectus déposé à la SEC)"));
  assert.ok(html.includes("Source : ESMA (registre FIRDS), liste Xetra et OpenFIGI"));
});

test("fonds européen sans série américaine : rien de changé", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_FR);
  const html = fiche(ctx, e, "FR0010135103", { erreurs: [], composition: { fini: true, c: null } });
  assert.ok(!html.includes("N-PORT"));
  assert.ok(!html.includes("Performances et risque"));
  assert.ok(!html.includes("prospectus déposé à la SEC"));
});

// ---------- Données qui manquent : rien ne plante ----------

test("détail minimal : identité seule", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { nom: "Fonds minimal", lei: "", date: null, actif: null, lignes: 0, exclu: 0, top: [], pays: [], classes: [], devises: [],
    parts: [["C000000001", "Class A", "AAAAX", null, null, null]] };
  const d = await donneesFiche(ctx, e, undefined, detail, "S000000001");
  assert.equal(d.sec.compo, null);
  const html = fiche(ctx, e, undefined, d);
  assert.ok(html.includes("N-PORT récent"));
  assert.ok(html.includes("Composition non disponible : ce fonds n&#39;a pas déposé d&#39;inventaire N-PORT récent à la SEC.")
    || html.includes("Composition non disponible : ce fonds n'a pas déposé d'inventaire N-PORT récent à la SEC."));
  assert.ok(html.includes("Class A") && html.includes("AAAAX"));
  assert.ok(!html.includes("graphique-vl"), "pas de rendements : pas de graphique");
  assert.ok(html.includes("pas d'historique de rendements déclaré"));
  assert.ok(html.includes("Frais (prospectus déposé à la SEC)") && html.includes("non publié"));
});

test("série sans détail (donneesSec renvoie null) : fiche d'identité", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(87));
  avecDetail(ctx, "S000000023", VANGUARD);   // un autre fonds du même morceau (87 % 64 = 23) : la série 87 n'a pas de détail
  assert.equal(await ctx.donneesSec(e, undefined), null);
  for (const d of [null, { erreurs: [], sec: null, composition: { fini: true, c: null } }, { erreurs: [], composition: { fini: true, c: null } }]) {
    const html = fiche(ctx, e, undefined, d);
    assert.ok(html.includes("Fonds américain 87"));
    assert.ok(html.includes("Série SEC S000000087"));
    assert.ok(!html.includes("graphique-vl"));
  }
  const html = fiche(ctx, e, undefined, { erreurs: [], sec: null, composition: { fini: true, c: null } });
  assert.ok(html.includes("N-PORT récent"));
  assert.ok(html.includes("Frais non disponibles"));
  assert.ok(html.includes("Analyse limitée"));
});

test("erreur de chargement des données de la SEC : annoncée, la fiche reste affichée", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, { erreurs: ["données de la SEC indisponibles (data/etats-unis/23.js non chargé)"], composition: { fini: true, c: null } });
  assert.ok(html.includes("données de la SEC indisponibles (data/etats-unis/23.js non chargé)"));
  assert.ok(html.includes("Série SEC S000002839"));
});

test("part sans rendements : ni graphique ni statistiques", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", "2019-10", null, [0.5, 0.4, 0.3, 0, 0, "2026-01-01"]]] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  assert.ok(!html.includes("graphique-vl"));
  assert.ok(html.includes("pas d'historique de rendements déclaré"));
  assert.ok(!html.includes("Perte maximale"));
  assert.ok(html.includes("formulaire N-PORT"));   // la composition, elle, existe
});

test("moins d'un an de rendements : graphique sans statistiques", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", "2026-01", [1, 2, -1, 0.5], null]] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  assert.ok(html.includes("graphique-vl"));
  assert.ok(html.includes("moins d&#39;un an") || html.includes("moins d'un an"));
  assert.ok(!html.includes("Perte maximale"));
});

test("rendement aberrant écarté : une note le dit", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const rendements = Array.from({ length: 30 }, (_, i) => (i === 3 ? 7443.59 : 0.5));
  const detail = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", "2024-01", rendements, null]] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  assert.ok(html.includes("Un ou plusieurs rendements mensuels aberrants déclarés à la SEC ont été écartés."));
  const sain = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", "2024-01", rendements.map(() => 0.5), null]] };
  const ctx2 = page();
  assert.ok(!fiche(ctx2, e, undefined, await donneesFiche(ctx2, e, undefined, sain, "S000000001")).includes("aberrants"));
});

test("aucune part déclarée : la section 6 le dit", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  assert.ok(html.includes("Aucune part n&#39;est déclarée") || html.includes("Aucune part n'est déclarée"));
  assert.ok(html.includes("Série SEC S000000001"));
  assert.ok(!html.includes("graphique-vl"));
});

test("part sans nom : le ticker sert de nom", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [["C000000001", "", "ZZZZX", null, null, null]] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  assert.ok(html.includes("part « ZZZZX » (ZZZZX)") || html.includes("part « ZZZZX »"));
});

// ---------- Frais du prospectus ----------

const FRAIS = (o = {}) => ({ brut: null, net: null, gestion: null, entree: null, sortie: null, date: null, retenu: null, ...o });

test("alertesFraisSec", () => {
  const { alertesFraisSec } = page();
  const alertes = f => simple(alertesFraisSec(f));
  const eleve = alertes(FRAIS({ net: 2.1, retenu: 2.1 }));
  assert.equal(eleve.length, 1);
  assert.equal(eleve[0].niveau, "alerte");
  assert.ok(eleve[0].titre.startsWith("Frais annuels élevés"));
  assert.equal(eleve[0].terme, "frais_courants");
  assert.ok(eleve[0].texte.length > 20);
  assert.equal(alertes(FRAIS({ net: 1.2, retenu: 1.2 }))[0].niveau, "attention");
  assert.deepEqual(alertes(FRAIS({ brut: 0.5, retenu: 0.5 })), []);
  assert.equal(alertes(FRAIS({ entree: 5.75 }))[0].titre, "Droits d'entrée jusqu'à 5,75 %");
  assert.equal(alertes(FRAIS({ entree: 5.75 }))[0].niveau, "attention");
  assert.ok(alertes(FRAIS({ sortie: 1 }))[0].titre.startsWith("Frais de sortie"));
  assert.deepEqual(alertes(FRAIS({ entree: 0, sortie: 0 })), []);
  const tout = alertes(FRAIS({ net: 2.1, retenu: 2.1, entree: 5.75, sortie: 1 }));
  assert.equal(tout.length, 3);
  assert.deepEqual(tout.map(a => a.terme), ["frais_courants", "frais_entree", "frais_sortie"]);
});

test("alertesFraisSec : données absentes ou sans chiffre", () => {
  const { alertesFraisSec } = page();
  for (const f of [null, undefined, {}, FRAIS(), FRAIS({ date: "2026-01-01" })]) assert.deepEqual(simple(alertesFraisSec(f)), []);
});

test("alertesFraisSec : frais retenus (nets sauf s'ils dépassent les bruts), pas toujours les nets", async () => {
  const ctx = page();
  // nets (2,5) au-dessus des bruts (1,5) : fraisSec retient les bruts, donc « assez élevés » et non « élevés »
  const f = ctx.fraisSec([1.5, 2.5, null, null, null, "2026-01-01"]);
  assert.equal(f.retenu, 1.5);
  const a = simple(ctx.alertesFraisSec(f));
  assert.equal(a.length, 1);
  assert.equal(a[0].niveau, "attention");
  assert.ok(a[0].titre.startsWith("Frais annuels assez élevés"));
  // seuils de js/config.js
  assert.equal(simple(ctx.alertesFraisSec(FRAIS({ retenu: 1.0 })))[0].niveau, "attention");
  assert.equal(simple(ctx.alertesFraisSec(FRAIS({ retenu: 2.0 })))[0].niveau, "alerte");
  assert.deepEqual(simple(ctx.alertesFraisSec(FRAIS({ retenu: 0.99 }))), []);
});

test("détecterPiegesAuto : frais SEC tout à null, ou absents, sans exception", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  for (const sec of [null, undefined, { frais: null }, { frais: FRAIS() }, { frais: FRAIS({ date: "2026-01-01" }) }]) {
    assert.ok(!simple(ctx.detecterPiegesAuto(e, { erreurs: [], sec })).some(p => /^Frais/.test(p.titre)));
  }
});

test("bloc des frais : ce qui existe, « non publié » sinon", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", null, null, [1.62, 1.21, 1, 0, 0, "2026-02-26"]]] };
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, detail, "S000000001"));
  for (const t of ["1,62 %", "1,21 %", "1,00 %", "aucun"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("Source : SEC – EDGAR (résumés des prospectus) · données du 26/02/2026"));
  const vide = { ...VANGUARD, parts: [["C000000001", "Class A", "AAAAX", null, null, [null, null, null, null, null, null]]] };
  const ctx2 = page();
  const html2 = fiche(ctx2, e, undefined, await donneesFiche(ctx2, e, undefined, vide, "S000000001"));
  assert.ok(html2.includes("Frais (prospectus déposé à la SEC)") && html2.includes("non publié"));
  assert.ok(!html2.includes("Source : SEC – EDGAR (résumés des prospectus)"));
});

// ---------- « Non précisé » n'est ni un pays dominant ni une devise étrangère ----------

test("pays « Non précisé » et devise « Non précisée » : jamais d'alerte de concentration ni d'exposition hors euro", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, pays: [["N/A", 70], ["US", 20], ["FR", 10]], devises: [["N/A", 80], ["EUR", 20]] };
  const d = await donneesFiche(ctx, e, undefined, detail, "S000000001");
  assert.ok(d.sec.compo.pays.some(p => p.nom === "Non précisé" && p.poids === 70));
  assert.ok(d.sec.compo.devises.some(p => p.nom === "Non précisée" && p.poids === 80));
  const html = fiche(ctx, e, undefined, d);
  assert.ok(!html.includes("Non précisé : 70,0 % du fonds"), "pas d'alerte « pays dominant »");
  assert.ok(html.includes("Pas de pays dominant"));
  assert.ok(html.includes("Le premier pays (États-Unis) pèse 20,0 %"));
  assert.ok(!html.includes("en devises étrangères, sans couverture"));
  assert.ok(html.includes("Peu d&#39;exposition aux devises étrangères") || html.includes("Peu d'exposition aux devises étrangères"));
  assert.ok(html.includes("Risque de change"));
  assert.ok(html.includes("0 % des actifs en devises hors euro"));
  // les barres de la composition montrent toujours la part non précisée
  assert.ok(html.includes("Non précisé") && html.includes("Non précisée"));
  // une vraie devise étrangère compte encore
  const ctx2 = page();
  const detail2 = { ...VANGUARD, devises: [["N/A", 50], ["USD", 40], ["EUR", 10]] };
  const html2 = fiche(ctx2, e, undefined, await donneesFiche(ctx2, e, undefined, detail2, "S000000001"));
  assert.ok(html2.includes("40 % des actifs en devises hors euro"));
  assert.ok(html2.includes("40,0 % en devises étrangères, sans couverture"));
});

test("pays dominant : un vrai pays alerte toujours", async () => {
  const ctx = page();
  const e = ctx.lireEntree(LIGNE_S);
  const html = fiche(ctx, e, undefined, await donneesFiche(ctx, e, undefined, VANGUARD));
  assert.ok(html.includes("États-Unis : 100,1 %"));
});

// ---------- Glossaire ----------

test("glossaire : serie_sec, n_port, frais_nets", () => {
  const ctx = page();
  const g = vm.runInContext("GLOSSAIRE", ctx);
  assert.equal(g.serie_sec, "Numéro donné par la SEC, le gendarme américain de la Bourse, à chaque fonds américain. Un fonds (une « série ») peut avoir plusieurs parts, avec leurs propres frais et tickers.");
  assert.equal(g.n_port, "Formulaire que chaque fonds américain dépose auprès de la SEC : la liste de toutes ses positions et ses rendements des trois derniers mois. La SEC le rend public quelques semaines plus tard.");
  assert.equal(g.frais_nets, "Frais annuels après les remises que la société de gestion s'est engagée à accorder, souvent pour une durée limitée. Les frais bruts sont ceux d'avant ces remises.");
});

// ---------- Noms des pays ----------

test("NOMS_PAYS : tous les codes pays des données SEC ont un nom français unique", () => {
  const ctx = page();
  const codes = new Set();
  const lecteur = vm.createContext({ ETATS_UNIS_DETAILS: {} });
  for (const f of readdirSync(new URL("../data/etats-unis/", import.meta.url)).filter(f => /^\d\d\.js$/.test(f))) {
    vm.runInContext(lire(`data/etats-unis/${f}`), lecteur);
  }
  for (const morceau of Object.values(lecteur.ETATS_UNIS_DETAILS)) for (const detail of Object.values(morceau)) for (const [code] of detail.pays) codes.add(code);
  assert.ok(codes.size > 150, `${codes.size} codes`);
  const noms = vm.runInContext("NOMS_PAYS", ctx);
  const sansNom = [...codes].filter(c => c !== "N/A" && !noms[c]);
  assert.deepEqual(sansNom, [], `codes sans nom : ${sansNom.join(" ")}`);
  const valeurs = Object.values(noms);
  assert.equal(new Set(valeurs).size, valeurs.length, "deux codes ont le même nom");
  // les anciens noms sont conservés
  for (const [c, n] of [["US", "États-Unis"], ["FR", "France"], ["KY", "Îles Caïmans"], ["XS", "Supranational / international"], ["VG", "Îles Vierges"]]) assert.equal(noms[c], n);
  assert.equal(noms.EG, "Égypte");
  assert.equal(noms.PR, "Porto Rico");
  // zones : un code clairement classé l'est, les autres restent « Autres »
  const zone = vm.runInContext("ZONE_PAR_PAYS", ctx);
  assert.equal(zone("PR"), "Amérique du Nord");
  assert.equal(zone("NG"), "Pays émergents");
  assert.equal(zone("MO"), "Asie-Pacifique développée");
  assert.equal(zone("LI"), "Europe hors zone euro");
  assert.equal(zone("MC"), "Zone euro");
  assert.equal(zone("XX"), "Autres");
  assert.equal(zone("US"), "Amérique du Nord");
  assert.equal(zone("FR"), "Zone euro");
});

test("composition d'un fonds d'obligations émergentes : les pays nouvellement nommés s'affichent en français", async () => {
  const ctx = page();
  const e = ctx.lireEntree(ligneS(1));
  const detail = { ...VANGUARD, pays: [["US", 40], ["NG", 30], ["EG", 20], ["XX", 10]], classes: [["Obligations", 100]], devises: [["USD", 100]] };
  const d = await donneesFiche(ctx, e, undefined, detail, "S000000001");
  const noms = Array.from(d.sec.compo.pays, p => p.nom);
  assert.deepEqual(noms, ["États-Unis", "Nigeria", "Égypte", "Organisations supranationales"]);
  const zones = Object.fromEntries(Array.from(d.sec.compo.zones, z => [z.nom, z.poids]));
  assert.equal(zones["Pays émergents"], 50);
  assert.equal(zones["Amérique du Nord"], 40);
  assert.equal(zones["Autres"], 10);
});

// ---------- js/app.js : ouverture d'un fonds américain (page simulée) ----------

const SCRIPTS_APP = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js", "js/inventaire.js",
  "js/style.js", "js/composition.js", "js/affichage.js", "js/marches.js", "js/fiche-auto.js", "js/app.js"];
const ZONE_FICHIER = `ANNUAIRE_ZONES["etats-unis"] = ${JSON.stringify({ maj: "2026-10-11", trimestre: "2026q3", lignes: [LIGNE_S] })};`;
const morceau23 = detail => `ETATS_UNIS_DETAILS[23] = ${JSON.stringify({ S000002839: detail })};`;

const sansEntites = h => h.replace(/&#39;/g, "'");

// Une page décrypte.html avec app.js : `rendus` garde chaque contenu successif de #resultat. Les <script> ajoutés sont « chargés »
// au tour suivant à partir de `fichiers` (absents : erreur de chargement).
function pageApp({ hash, annuaire = [], fichiers = {} }) {
  const elements = {}, rendus = [], gestionnaires = {};
  const element = id => (elements[id] ||= {
    id, value: "", hidden: false, childNodes: [], addEventListener() {}, setAttribute() {}, scrollIntoView() {}, replaceChildren() {}, querySelectorAll: () => [],
    set innerHTML(v) { this._html = v; if (id === "resultat") rendus.push(v); }, get innerHTML() { return this._html || ""; }
  });
  let ctx;
  const document = {
    title: "", getElementById: element, createElement: () => ({}),
    head: { appendChild(el) { setTimeout(() => { if (typeof fichiers[el.src] === "string") { vm.runInContext(fichiers[el.src], ctx, { filename: el.src }); el.onload(); } else el.onerror(); }, 0); } }
  };
  const stockage = new Map();
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: k => stockage.delete(k) };
  const window = { scrollY: 0, scrollTo() {}, addEventListener: (type, fn) => { gestionnaires[type] = fn; } };
  const location = { hash };
  ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage, document, window, location, ANNUAIRE: annuaire,
    rechercheDansAdresse: () => null, chargerCours: () => Promise.resolve(null) });
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = { US9229083632: "S000002839" };`, ctx);
  for (const f of SCRIPTS_APP) vm.runInContext(lire(f), ctx, { filename: f });
  return { ctx, rendus, location, gestionnaires, resultat: () => element("resultat").innerHTML };
}
async function attendre(condition, message) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail(message || "délai dépassé");
}

test("app.js : fonds américain, fiche en chargement puis données de la SEC", async () => {
  const p = pageApp({ hash: "#S000002839", fichiers: { "data/annuaire-etats-unis.js": ZONE_FICHIER, "data/etats-unis/23.js": morceau23(VANGUARD) } });
  await attendre(() => p.resultat().includes("formulaire N-PORT"));
  const finale = p.resultat();
  assert.ok(finale.includes("Série SEC S000002839 · part « ETF Shares » (VOO)"));
  assert.ok(finale.includes("Frais (prospectus déposé à la SEC)"));
  // pendant le chargement : la fiche annonce le chargement, sans « non disponible » trompeur
  const enChargement = p.rendus.find(h => h.includes("Série SEC") && h.includes("Chargement des données…"));
  assert.ok(enChargement, "une fiche en chargement est affichée");
  assert.ok(!enChargement.includes("Performances non disponibles") && !enChargement.includes("Composition non disponible"));
  assert.ok(p.rendus.every(h => !h.includes("Performances non disponibles")));
  assert.equal(p.ctx.document.title, "Vanguard 500 Index Fund · Décrypte ton fonds");
});

test("app.js : fonds américain, données de la SEC injoignables", async () => {
  const p = pageApp({ hash: "#S000002839", fichiers: { "data/annuaire-etats-unis.js": ZONE_FICHIER } });   // data/etats-unis/23.js manque
  await attendre(() => p.resultat().includes("Informations manquantes"));
  const finale = p.resultat();
  assert.ok(finale.includes("données de la SEC indisponibles (data/etats-unis/23.js non chargé)"));
  assert.ok(finale.includes("Série SEC S000002839"));
  assert.ok(finale.includes("Composition non disponible"));
});

test("app.js : fonds américain sans détail (série absente de son morceau)", async () => {
  const p = pageApp({ hash: "#S000002839", fichiers: { "data/annuaire-etats-unis.js": ZONE_FICHIER, "data/etats-unis/23.js": "ETATS_UNIS_DETAILS[23] = {};" } });
  await attendre(() => p.resultat().includes("N-PORT récent"));
  assert.ok(p.resultat().includes("Frais non disponibles"));
  assert.ok(!p.resultat().includes("Informations manquantes"));
});

test("app.js : fonds américain refermé avant l'arrivée des données : rien n'est affiché", async () => {
  const p = pageApp({ hash: "#S000002839", fichiers: { "data/annuaire-etats-unis.js": ZONE_FICHIER, "data/etats-unis/23.js": morceau23(VANGUARD) } });
  await attendre(() => p.resultat().includes("Série SEC"));   // la fiche en chargement
  p.location.hash = "";
  p.gestionnaires.hashchange();
  await new Promise(r => setTimeout(r, 80));
  assert.equal(p.resultat(), "");
});

test("app.js : ETF européen qui est aussi une série américaine : la composition de la SEC remplace le fonds jumeau", async () => {
  const p = pageApp({ hash: "#US9229083632", annuaire: [LIGNE_VOO],
    fichiers: { "data/etats-unis/23.js": morceau23(VANGUARD) } });
  await attendre(() => p.resultat().includes("formulaire N-PORT"));
  const finale = p.resultat();
  assert.ok(finale.includes("US9229083632") && finale.includes("Performances et risque"));
  assert.ok(finale.includes("Aucun cours relevé"));
  assert.ok(p.rendus.some(h => h.includes("Lecture des données de la SEC…")));
  assert.ok(p.rendus.every(h => !sansEntites(h).includes("fonds français qui suit le même indice") && !sansEntites(h).includes("Recherche d'un fonds français")));
});

test("app.js : fonds européen dont la série n'a pas de composition : retour à la recherche d'un fonds jumeau", async () => {
  const sansDate = { ...VANGUARD, date: null, lignes: 0, top: [], pays: [], classes: [], devises: [] };
  const p = pageApp({ hash: "#US9229083632", annuaire: [LIGNE_VOO], fichiers: { "data/etats-unis/23.js": morceau23(sansDate) } });
  await attendre(() => p.resultat().includes("Composition non calculable"));
  const finale = p.resultat();
  assert.ok(finale.includes("Performances et risque") && finale.includes("Frais (prospectus déposé à la SEC)"), "rendements et frais de la SEC gardés");
  assert.ok(p.rendus.some(h => sansEntites(h).includes("Recherche d'un fonds français qui suit le même indice")));
});

test("app.js : données de la SEC injoignables pour un fonds européen : la fiche continue", async () => {
  const p = pageApp({ hash: "#US9229083632", annuaire: [LIGNE_VOO], fichiers: {} });
  await attendre(() => p.resultat().includes("Composition non calculable"));
  assert.ok(p.resultat().includes("données de la SEC indisponibles"));
  assert.ok(p.resultat().includes("US9229083632"));
});

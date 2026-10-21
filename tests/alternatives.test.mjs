// Alternative moins chère : choix de l'indice (selon le nom ou la composition) et des fonds moins chers achetables en France.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

const SCRIPTS = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/inventaire.js", "js/style.js",
  "js/composition.js", "js/zones.js", "js/etats-unis.js", "js/marches.js", "js/fiche-auto.js", "js/alternatives.js"];

// [cle, isin, nom, frais, pea, etf, dateDic]
const ALT_T = { maj: "2026-10-20", indices: {
  "S&P 500": [
    ["G1", "FR0011111111", "AMUNDI PEA S&P 500", 0.15, 1, 1, "2025-01-01"],
    ["G2", "FR0022222222", "BNP S&P 500 UCITS ETF", 0.05, 0, 1, "2025-01-01"],
    ["G2", "FR0022222223", "BNP S&P 500 UCITS ETF (part C)", 0.06, 0, 1, "2025-01-01"],
    ["G3", "FR0033333333", "LYXOR S&P 500", 0.30, 0, 1, "2025-01-01"],
    ["G4", "FR0044444444", "FONDS S&P 500 CHER", 0.60, 0, 0, "2025-01-01"],
    ["G5", "FR0055555555", "AUTRE S&P 500", 0.45, 0, 0, "2025-01-01"]
  ],
  "Euro Stoxx 50": [["G6", "FR0066666666", "ETF EURO STOXX 50", 0.20, 0, 1, "2025-01-01"], ["G7", "FR0077777777", "ETF EURO STOXX 50 B", 0.25, 0, 1, "2025-01-01"]]
} };

function page(alt = ALT_T, sans = false) {
  const globales = { console, setTimeout, clearTimeout, ANNUAIRE: [], document: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  if (!sans) globales.ALTERNATIVES = alt;
  const ctx = vm.createContext(globales);
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of SCRIPTS) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}
const z = (nom, poids) => ({ nom, poids });
const comp = (zones, classes) => ({ zones, classes });

test("indicePourExposition : seuils et zones", () => {
  const c = page();
  const A = z("Actions", 95);
  assert.equal(c.indicePourExposition([z("Amérique du Nord", 80)], [A]), "S&P 500");
  assert.equal(c.indicePourExposition([z("Zone euro", 75)], [A]), "Euro Stoxx 50");
  assert.equal(c.indicePourExposition([z("Zone euro", 45), z("Europe hors zone euro", 40)], [z("Actions", 90)]), "Stoxx Europe 600");
  assert.equal(c.indicePourExposition([z("Pays émergents", 75)], [z("Actions", 90)]), "MSCI Emerging Markets");
  assert.equal(c.indicePourExposition([z("Asie-Pacifique développée", 75)], [z("Actions", 90)]), "Topix");
  assert.equal(c.indicePourExposition([z("Amérique du Nord", 45), z("Zone euro", 20), z("Pays émergents", 15)], [z("Actions", 90)]), "MSCI World");
  assert.equal(c.indicePourExposition([z("Amérique du Nord", 80)], [z("Actions", 60), z("Obligations", 40)]), null);
  assert.equal(c.indicePourExposition(null, null), null);
  assert.equal(c.indicePourExposition([], []), null);
});

const indiciel = { source: "G", cmpId: 1, nom: "AMUNDI PEA S&P 500", isins: ["FR0011111111"], etf: true, pays: "FR" };

test("fonds indiciel : indice du nom, lui-même exclu, tri par frais, 3 au plus", () => {
  const c = page();
  const r = simple(c.choisirAlternatives(indiciel, 0.15, null, []));
  assert.equal(r.indice, "S&P 500");
  assert.equal(r.actif, false);
  assert.ok(!r.lignes.some(l => l.cle === "G1"));
  assert.ok(r.lignes.length <= 3);
  const frais = r.lignes.map(l => l.frais);
  assert.deepEqual(frais, [...frais].sort((a, b) => a - b));
  assert.equal(r.lignes[0].cle, "G2");
});

test("fonds actif : indice choisi d'après la composition", () => {
  const c = page();
  const e = { source: "G", cmpId: 9, nom: "FONDS ACTIF USA", isins: ["FR0099999999"], etf: false, pays: "FR" };
  const r = simple(c.choisirAlternatives(e, 1.8, comp([z("Amérique du Nord", 80)], [z("Actions", 95)]), []));
  assert.equal(r.indice, "S&P 500");
  assert.equal(r.actif, true);
  assert.ok(r.lignes.length > 0);
});

test("autres : ignorés si achetable, ajoutés après la liste française sinon (frais null gardés)", () => {
  const c = page();
  const autres = [{ cle: "S9", nom: "VANGUARD 500", frais: null, pea: 0, etf: 1 }];
  const e1 = { ...indiciel, nom: "FONDS ACTIF", isins: [] };
  const comp1 = comp([z("Amérique du Nord", 80)], [z("Actions", 95)]);
  assert.ok(!simple(c.choisirAlternatives(e1, 1.8, comp1, autres)).lignes.some(l => l.cle === "S9"));
  const eS = { source: "S", cmpId: 5, nom: "VANGUARD INDEX", isins: [], etf: false, pays: "US" };
  const r = simple(c.choisirAlternatives(eS, 1.8, comp1, [{ cle: "S9", nom: "VANGUARD 500", frais: null, pea: 0, etf: 1 }]));
  assert.equal(r.lignes.length, 3);   // 3 au plus au total : le français d'abord
  assert.ok(!r.lignes.some(l => l.cle === "S9"));
  // liste française courte (Euro Stoxx 50 : 2 fonds) : l'étranger complète, frais et économie null
  const eur = simple(c.choisirAlternatives(eS, 1.8, comp([z("Zone euro", 80)], [z("Actions", 95)]), autres));
  assert.equal(eur.lignes.length, 3);
  assert.equal(eur.lignes[2].cle, "S9");
  assert.equal(eur.lignes[2].frais, null);
  assert.equal(eur.lignes[2].economie, null);
});

test("économie sur 10 ans, frais inconnus, déjà moins cher, doublons, données absentes", () => {
  const c = page();
  const e = { source: "G", cmpId: 9, nom: "FONDS ACTIF", isins: [], etf: false, pays: "FR" };
  const cp = comp([z("Amérique du Nord", 80)], [z("Actions", 95)]);
  const r = simple(c.choisirAlternatives(e, 1.8, cp, []));
  const attendu = Math.round(c.valeurFinale(10000, 4.85, 10) - c.valeurFinale(10000, 3.2, 10));
  assert.equal(r.lignes.find(l => l.frais === 0.15).economie, attendu);
  assert.equal(r.dejaMoinsCher, false);

  const bas = simple(c.choisirAlternatives(e, 0.01, cp, []));
  assert.equal(bas.dejaMoinsCher, true);
  assert.equal(bas.lignes.length, 0);

  const inconnu = simple(c.choisirAlternatives(e, null, cp, []));
  assert.ok(inconnu.lignes.length > 0 && inconnu.lignes.every(l => l.economie === null));
  assert.equal(inconnu.dejaMoinsCher, false);

  assert.equal(r.lignes.filter(l => l.cle === "G2").length, 1);

  const sans = page(ALT_T, true);
  const v = simple(sans.choisirAlternatives(e, 1.8, cp, []));
  assert.deepEqual(v.lignes, []);
});

test("achetableEnFrance", () => {
  const c = page();
  assert.equal(c.achetableEnFrance({ source: "G", isins: [] }), true);
  assert.equal(c.achetableEnFrance({ source: "N", isins: [] }), true);
  assert.equal(c.achetableEnFrance({ source: "S", isins: [] }), false);
  assert.equal(c.achetableEnFrance({ source: "E", isins: ["XX1"], pays: "KY" }), false);
  // R : OPCVM avec la France parmi les pays ; sans la France, non
  const r = (pays, nature = "OPCVM (UCITS)") => ({ source: "R", cmpId: 1, nature, isins: [], pays: "IE" });
  const avec = page(); avec.REGISTRES_UE_INFOS = { 1: ["", "IE", "DE FR", "", 0, ""] };
  assert.equal(avec.achetableEnFrance(r()), true);
  const sans = page(); sans.REGISTRES_UE_INFOS = { 1: ["", "IE", "DE ES", "", 0, ""] };
  assert.equal(sans.achetableEnFrance(r()), false);
  // E notifié en France (FIRDS + IDENTITE.notifFR)
  const n = page();
  vm.runInContext(`FIRDS = { fonds: { LU1: ["LEI1", "EUR", [], 0] } }; IDENTITE = { notifFR: ["LEI1"] };`, n);
  assert.equal(n.achetableEnFrance({ source: "E", isins: ["LU1"], pays: "LU" }), true);
});

// ---------- Section 6 de la fiche : blocAlternatives ----------

const ALT_W = { maj: "2026-10-20", indices: {
  "MSCI World": [
    ["FR0000000001", "FR0000000001", "AMUNDI PEA MSCI WORLD", 0.12, 1, 1, "2025-03-01"],
    ["FR0000000002", "FR0000000002", "BNP MSCI WORLD ETF", 0.20, 0, 1, "2025-03-01"],
    ["FR0000000003", "FR0000000003", "GESTION MSCI WORLD", 0.25, 0, 0, "2025-03-01"]
  ],
  "S&P 500": [["FR0000000009", "FR0000000009", "SANS FRAIS S&P 500", null, 0, 1, "2025-03-01"]]
} };
const cw8 = { source: "N", cmpId: 7, nom: "AMUNDI MSCI WORLD UCITS ETF", isins: ["LU1111111111"], etf: true, pays: "LU", classification: "", nature: "", gestionnaire: "X", marches: "", devise: "EUR", tickers: [] };
const dicCw8 = { gestion: 0.38, transaction: 0, entree: 0, sortie: 0, performance: false, document: { docName: "DIC", dateEffet: "2025-01-01" } };
const fiche = (c, e, d) => c.afficherFicheAuto(e, e.isins[0], { erreurs: [], composition: { fini: true, c: null }, ...d }, false);
const section6 = h => h.slice(h.indexOf("6.</span> Comparaison"));

test("blocAlternatives : fonds indiciel, 3 liens, PEA, économie, note et source", () => {
  const c = page(ALT_W);
  const h = section6(fiche(c, cw8, { dic: dicCw8 }));
  assert.equal((h.match(/href="#FR000000000[123]"/g) || []).length, 3);
  assert.ok(h.includes("éligible au PEA (d'après le nom)"));
  assert.ok(h.includes("Sur 10 000 € placés 10 ans"));
  assert.ok(h.includes("Des frais plus bas ne garantissent pas une meilleure performance ; vérifie le DIC avant toute décision."));
  assert.ok(h.includes("AMF – DIC (base GECO), relevé du"));
  assert.ok(!h.includes("Alternative indicielle (pas le même fonds)"));
});

test("blocAlternatives : fonds actif", () => {
  const c = page(ALT_W);
  const e = { ...cw8, nom: "FONDS ACTIF MONDE", etf: false };
  const compo = { zones: [z("Amérique du Nord", 55)], classes: [z("Actions", 95)] };
  const h = section6(fiche(c, e, { dic: dicCw8, composition: { fini: true, c: compo } }));
  assert.ok(h.includes("Alternative indicielle (pas le même fonds)"));
  assert.ok(h.includes("Alternative indicielle : elle suit un marché, pas la stratégie du gérant."));
});

test("blocAlternatives : pas d'indice, déjà moins cher, frais inconnus", () => {
  const c = page(ALT_W);
  const e = { ...cw8, nom: "FONDS OBLIGATAIRE", etf: false };
  assert.ok(section6(fiche(c, e, { dic: dicCw8 })).includes("pas d'alternative indicielle comparable"));
  const bas = section6(fiche(c, cw8, { dic: { ...dicCw8, gestion: 0.01 } }));
  assert.ok(bas.includes("C'est déjà l'un des fonds les moins chers sur cet indice"));
  const sp = { ...cw8, nom: "ETF S&P 500", isins: ["LU2222222222"] };
  assert.ok(section6(fiche(c, sp, { dic: dicCw8 })).includes("frais non publiés dans nos sources"));
});

test("section 6 sans ALTERNATIVES : message d'indisponibilité, pas d'exception", () => {
  const c = page(ALT_W, true);
  const h = section6(fiche(c, cw8, { dic: dicCw8 }));
  assert.ok(h.includes("Comparaison des frais indisponible pour le moment"));
  assert.ok(!h.includes("n'est pas encore disponible"));
});

test("blocAlternatives : fonds sans frais connus, pas de comparaison chiffrée", () => {
  const c = page(ALT_W);
  const h = section6(fiche(c, cw8, {}));
  assert.ok(h.includes("href=\"#FR0000000001\""));
  assert.ok(!h.includes("Sur 10 000 € placés 10 ans"));
});

// Données d'un fonds américain dans le navigateur (js/etats-unis.js) : série, morceau de données, part, rendements en euros,
// statistiques, composition N-PORT, frais et expositions pour le simulateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

// ---------- Fonds de test : vrais détails de data/etats-unis/ (format du contrat Python → JS) ----------

// Vanguard 500 : 4 parts de 81 mois (octobre 2019 → juin 2026), dont « ETF Shares » (VOO)
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
// Ashmore Emerging Markets Total Return : obligations de pays émergents, 44 pays
const PAYS_ASHMORE = [["VE", 14.34], ["MY", 6.53], ["MX", 5.81], ["CO", 5.37], ["US", 5.22], ["NG", 3.83], ["BR", 3.74], ["CL", 3.4],
  ["ZA", 3.29], ["TR", 3.22], ["RO", 3.08], ["ID", 2.7], ["PL", 2.69], ["HU", 2.38], ["AR", 2.23], ["KZ", 2.16], ["NL", 0]];
const ASHMORE = {
  nom: "Ashmore Emerging Markets Total Return Fund", lei: "5493003R6Z966WCNR691", date: "2026-07-31", actif: 22985475, lignes: 187, exclu: 0.67,
  top: [["PETROLEOS DE VENEZUELA SA", 12.24, "USP7807HAV70"], ["UNITED STATES OF AMERICA - BUREAU OF THE PUBLIC DEBT", 5.05, "US912797RS85"]],
  pays: PAYS_ASHMORE,
  classes: [["Obligations", 95.22], ["Actions", 0.17]],
  devises: [["USD", 61.29], ["MYR", 4.84], ["COP", 4.38], ["MXN", 3.06], ["NGN", 2.56], ["ZAR", 2.41], ["BRL", 2.36], ["CLP", 1.97],
    ["IDR", 1.96], ["PLN", 1.43], ["EUR", 0]],
  parts: [
    ["C000093386", "Institutional Class Shares", "EMKIX", "2019-10", Array(82).fill(0.5), [1.62, 1.21, 1, 0, 0, "2026-02-26"]],
    ["C000098150", "Class C", "EMKCX", "2019-10", Array(82).fill(0.4), [2.62, 2.21, 1, 0, 1, "2026-02-26"]]
  ]
};
// Fonds sans composition ni rendements, comme 1 527 fonds du fichier : date nulle, listes vides, aucune part
const VIDE = { nom: "BNY Dreyfus Government Cash Management", lei: "", date: null, actif: null, lignes: 0, exclu: 0, top: [], pays: [], classes: [], devises: [], parts: [] };

// Lignes de l'annuaire (format de ANNUAIRE) : fonds américain, ETF européen qui est aussi une série américaine, fonds français
const LIGNE_S = n => ["S", n, n, "Fonds américain " + n, "Gestionnaire", "", "", "", "", "US", "", "", "USD", 0, 1];
const LIGNE_VOO = ["E", 0, 0, "Vanguard 500 Index Fund Registered Shares ETF o.N.", "", "", "", "US9229083632", "", "US", "", "", "USD", 1, 1];
const LIGNE_FR = ["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1];

// Une page simulée : fonctions du site, table ISIN → série, et un `document` qui compte les <script> ajoutés puis, au tour
// suivant, exécute le texte du fichier demandé (ou signale une erreur de chargement s'il est absent de `fichiers`).
const FICHIERS_SITE = ["js/outils.js", "js/geco.js", "js/zones.js", "js/inventaire.js", "js/etats-unis.js"];
const morceauDe = (serie, detail) => `ETATS_UNIS_DETAILS[${Number(serie.slice(1)) % 64}] = ${JSON.stringify({ [serie]: detail })};`;
function monde({ fichiers = {}, isin = { US9229083632: "S000002839" }, site = FICHIERS_SITE } = {}) {
  const chargements = [];
  let ctx;
  const document = {
    createElement: () => ({}),
    head: {
      appendChild(el) {
        chargements.push(el.src);
        setTimeout(() => {
          if (typeof fichiers[el.src] === "string") { vm.runInContext(fichiers[el.src], ctx, { filename: el.src }); el.onload(); }
          else el.onerror();
        }, 0);
      }
    }
  };
  ctx = vm.createContext({ console, setTimeout, clearTimeout, document, ANNUAIRE: [] });
  vm.runInContext(`const ETATS_UNIS_ISIN = ${JSON.stringify(isin)};`, ctx);
  for (const f of site) vm.runInContext(lire(f), ctx, { filename: f });
  return { ctx, chargements, fichiers };
}
const entree = (m, ligne) => m.ctx.lireEntree(ligne);
const proche = (valeur, attendu, marge = 1e-6, message) => assert.ok(Math.abs(valeur - attendu) <= marge, message || `${valeur} ≉ ${attendu}`);
// Tableaux et objets du contexte `vm` ont d'autres prototypes que ceux du test : on les recopie ou on passe par simple() avant deepEqual
const jour = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const jours = dates => Array.from(dates, jour);

// ---------- Série et morceau de données ----------

test("serieSecDe", () => {
  const m = monde();
  const { serieSecDe } = m.ctx;
  assert.equal(serieSecDe(entree(m, LIGNE_S(2839))), "S000002839");
  assert.equal(serieSecDe(entree(m, LIGNE_S(1293613))), "S001293613");
  assert.equal(serieSecDe(entree(m, LIGNE_VOO), "US9229083632"), "S000002839");   // ISIN demandé
  assert.equal(serieSecDe(entree(m, LIGNE_VOO)), "S000002839");                    // premier ISIN de l'entrée présent dans la table
  assert.equal(serieSecDe(entree(m, LIGNE_FR)), null);
  assert.equal(serieSecDe(entree(m, LIGNE_FR), "FR0010135103"), null);
  assert.equal(serieSecDe(null, "US9229083632"), "S000002839");
  assert.equal(serieSecDe(null, null), null);
  assert.equal(serieSecDe(undefined), null);
  assert.equal(serieSecDe(entree(m, LIGNE_FR), "constructor"), null);   // la table est un objet : pas d'héritage
});

test("serieSecDe : l'ISIN demandé passe avant ceux de l'entrée", () => {
  const m = monde({ isin: { IE00AAAAAAAA: "S000000001", IE00BBBBBBBB: "S000000002" } });
  const e = { ...entree(m, LIGNE_VOO), isins: ["XX0000000000", "IE00BBBBBBBB", "IE00AAAAAAAA"] };
  assert.equal(m.ctx.serieSecDe(e, "IE00AAAAAAAA"), "S000000001");
  assert.equal(m.ctx.serieSecDe(e), "S000000002");
});

test("chargerDetailSec : un seul <script> par morceau, n % 64 sur deux chiffres", async () => {
  const m = monde({ fichiers: { "data/etats-unis/23.js": morceauDe("S000002839", VANGUARD) } });
  assert.equal(vm.runInContext("MORCEAUX_ETATS_UNIS", m.ctx), 64);
  const [a, b] = await Promise.all([m.ctx.chargerDetailSec("S000002839"), m.ctx.chargerDetailSec("S000002839")]);
  assert.equal(a.nom, "VANGUARD 500 INDEX FUND");
  assert.equal(a, b);
  assert.deepEqual(m.chargements, ["data/etats-unis/23.js"]);
  assert.equal((await m.ctx.chargerDetailSec("S000002839")).lignes, 508);   // déjà en mémoire
  assert.equal(await m.ctx.chargerDetailSec("S000000087"), null);           // même morceau (87 % 64 = 23), série absente
  assert.deepEqual(m.chargements, ["data/etats-unis/23.js"]);
});

test("chargerDetailSec : nom du fichier, série invalide, échec réseau", async () => {
  const m = monde({ fichiers: { "data/etats-unis/00.js": "ETATS_UNIS_DETAILS[0] = {};", "data/etats-unis/63.js": "ETATS_UNIS_DETAILS[63] = {};" } });
  assert.equal(await m.ctx.chargerDetailSec("S000000064"), null);
  assert.equal(await m.ctx.chargerDetailSec("S000000127"), null);
  assert.deepEqual(m.chargements, ["data/etats-unis/00.js", "data/etats-unis/63.js"]);
  for (const mauvaise of ["", "S12", "FR0010135103", null, undefined, 2839, "s000002839"]) assert.equal(await m.ctx.chargerDetailSec(mauvaise), null, String(mauvaise));
  assert.equal(m.chargements.length, 2);
  await assert.rejects(m.ctx.chargerDetailSec("S000000001"), /data\/etats-unis\/01\.js/);   // morceau absent : on le signale, ce n'est pas « pas de données »
  m.fichiers["data/etats-unis/01.js"] = morceauDe("S000000001", VIDE);                     // le fichier revient : nouvel essai
  assert.equal((await m.ctx.chargerDetailSec("S000000001")).nom, VIDE.nom);
});

test("chargerDetailSec : fichier qui ne définit pas son morceau", async () => {
  const m = monde({ fichiers: { "data/etats-unis/05.js": "// fichier vide" } });
  await assert.rejects(m.ctx.chargerDetailSec("S000000005"), /ne définit pas/);
  m.fichiers["data/etats-unis/05.js"] = morceauDe("S000000005", VIDE);
  assert.equal((await m.ctx.chargerDetailSec("S000000005")).nom, VIDE.nom);   // le fichier est rechargé
  assert.equal(m.chargements.length, 2);
});

// ---------- Parts ----------

test("lirePartSec", () => {
  const { lirePartSec } = monde().ctx;
  assert.deepEqual(simple(lirePartSec(VANGUARD.parts[2])), { classe: "C000092055", nom: "ETF Shares", ticker: "VOO", debut: "2019-10", rendements: mois81, frais: [0.03, 0.03, null, null, null, "2026-04-28"] });
  assert.equal(lirePartSec(["C1", "", "ABCDX", null, null, null]).nom, "ABCDX");   // nom vide : le ticker
  assert.equal(lirePartSec(["C1", "", "", null, null, null]).nom, "C1");           // ni nom ni ticker : la classe
  assert.equal(lirePartSec(["C1", null, null]).nom, "C1");
  assert.deepEqual(simple(lirePartSec(["C1"])), { classe: "C1", nom: "C1", ticker: "", debut: null, rendements: null, frais: null });
  const deja = lirePartSec(VANGUARD.parts[0]);
  assert.equal(lirePartSec(deja), deja);   // déjà converti : rendu tel quel
});

test("partSec : une part, ETF, ou la plus longue", () => {
  const m = monde();
  const { partSec } = m.ctx;
  const unique = { ...ASHMORE, parts: [ASHMORE.parts[1]] };
  assert.equal(partSec(unique, entree(m, LIGNE_S(30390))).nom, "Class C");
  assert.equal(partSec(unique, null).nom, "Class C");

  const etf = { ...entree(m, LIGNE_S(2839)), etf: true };
  assert.equal(partSec(VANGUARD, etf).nom, "ETF Shares");                      // entrée ETF : la part dont le nom contient ETF
  assert.equal(partSec(VANGUARD, entree(m, LIGNE_VOO)).nom, "ETF Shares");
  assert.equal(partSec(VANGUARD, entree(m, LIGNE_S(2839))).nom, "Investor Shares");   // égalité : la première

  const inegales = { ...VANGUARD, parts: [
    ["C1", "Investor", "A", "2019-10", [1, 2, 3], null],
    ["C2", "Admiral", "B", "2019-10", [null, null, 1, 2, 3, 4], null],           // 4 mois renseignés
    ["C3", "Institutional", "C", "2019-10", [1, null, 2, 3], null]               // 3 mois renseignés
  ] };
  assert.equal(partSec(inegales, entree(m, LIGNE_S(2839))).nom, "Admiral");
  assert.equal(partSec(inegales, etf).nom, "Admiral");                           // entrée ETF sans part « ETF » : même règle
  const avecZeros = { ...VANGUARD, parts: [["C1", "A", "A", "2019-10", [0, 0], null], ["C2", "B", "B", "2019-10", [1, null, null], null]] };
  assert.equal(partSec(avecZeros, null).nom, "A");                               // des 0 % sont des mois renseignés
});

test("partSec : données manquantes sans exception", () => {
  const m = monde();
  const { partSec } = m.ctx;
  assert.equal(partSec(VIDE, entree(m, LIGNE_S(1))), null);
  assert.equal(partSec({ ...VIDE, parts: undefined }, null), null);
  assert.equal(partSec(null, null), null);
  const sansRendements = { ...VIDE, parts: [["C1", "A", "A", null, null, null], ["C2", "", "B", null, null, null]] };
  assert.equal(partSec(sansRendements, null).nom, "A");
  const nomVide = { ...VIDE, parts: [["C1", "", "", null, [1], null], ["C2", "", "TICK", null, [1, 2], null]] };
  assert.equal(partSec(nomVide, null).nom, "TICK");
});

// ---------- Rendements mensuels en euros → historique ----------

test("serieEurosDepuisRendements : trou", () => {
  const { serieEurosDepuisRendements } = monde().ctx;
  const h = serieEurosDepuisRendements("2026-02", [1.0, null, 2.0, -1.0]);
  assert.deepEqual(jours(h.dates), ["31/03/2026", "30/04/2026", "31/05/2026"]);
  assert.equal(h.valeurs.length, 3);
  assert.equal(h.valeurs[0], 100);
  proche(h.valeurs[1], 102);
  proche(h.valeurs[2], 100.98);
  assert.equal(h.ignores, false);
});

test("serieEurosDepuisRendements : rien", () => {
  const { serieEurosDepuisRendements } = monde().ctx;
  assert.equal(serieEurosDepuisRendements("2026-02", [null]), null);
  assert.equal(serieEurosDepuisRendements("2026-02", [1, 2, null]), null);   // rien après le dernier trou
  assert.equal(serieEurosDepuisRendements("2026-02", []), null);
  assert.equal(serieEurosDepuisRendements(null, null), null);
  assert.equal(serieEurosDepuisRendements("2026-02", null), null);
  assert.equal(serieEurosDepuisRendements(null, [1, 2]), null);
  assert.equal(serieEurosDepuisRendements("pas une date", [1, 2]), null);
  assert.equal(serieEurosDepuisRendements("2026-02", "1,2"), null);
});

test("serieEurosDepuisRendements : un seul mois, pas de trou, changement d'année, année bissextile", () => {
  const { serieEurosDepuisRendements } = monde().ctx;
  const un = serieEurosDepuisRendements("2026-02", [null, 5]);
  assert.deepEqual(jours(un.dates), ["28/02/2026", "31/03/2026"]);   // février manque : la série commence fin février
  assert.deepEqual(simple(un.valeurs), [100, 105]);
  const an = serieEurosDepuisRendements("2025-11", [1, 2, 3]);
  assert.deepEqual(jours(an.dates), ["31/10/2025", "30/11/2025", "31/12/2025", "31/01/2026"]);
  assert.deepEqual(jours(serieEurosDepuisRendements("2024-02", [1]).dates), ["31/01/2024", "29/02/2024"]);
  assert.deepEqual(jours(serieEurosDepuisRendements("2024-01", [1]).dates), ["31/12/2023", "31/01/2024"]);
});

test("serieEurosDepuisRendements : mois aberrant traité comme un trou", () => {
  const { serieEurosDepuisRendements } = monde().ctx;
  // vrai cas : un mois à +7 443,59 % (erreur de la SEC) dans la série d'un fonds
  const h = serieEurosDepuisRendements("2026-01", [1.0, 7443.59, 2.0]);
  assert.deepEqual(jours(h.dates), ["28/02/2026", "31/03/2026"]);
  assert.deepEqual(simple(h.valeurs), [100, 102]);
  assert.equal(h.ignores, true);
  assert.equal(serieEurosDepuisRendements("2026-01", [1.0, 7443.59]), null);   // rien après le mois aberrant
  assert.equal(serieEurosDepuisRendements("2026-01", [-100, 1]).ignores, true);   // fonds à zéro : -100 % non plus
  // bornes : -99,99 et 300 sont gardés, au-delà non
  const bornes = serieEurosDepuisRendements("2026-01", [-99.99, 300]);
  assert.equal(bornes.ignores, false);
  proche(bornes.valeurs[1], 0.01);
  proche(bornes.valeurs[2], 0.04);
  assert.equal(serieEurosDepuisRendements("2026-01", [300.01, 1]).ignores, true);
  assert.equal(serieEurosDepuisRendements("2026-01", [-99.995, 1]).ignores, true);
  // un trou ordinaire n'est pas un mois aberrant
  assert.equal(serieEurosDepuisRendements("2026-01", [1, null, 2]).ignores, false);
  // valeurs qui ne sont pas des nombres : mois manquants
  assert.deepEqual(jours(serieEurosDepuisRendements("2026-01", [1, "abc", NaN, 4]).dates), ["31/03/2026", "30/04/2026"]);
});

// ---------- Statistiques ----------

const serie = (rendements, debut = "2020-01") => monde().ctx.serieEurosDepuisRendements(debut, rendements);

test("statsSec : fenêtres de 12, 36 et 60 mois", () => {
  const { statsSec } = monde().ctx;
  const s = statsSec(serie(Array(12).fill(1)));   // 13 points à +1 % par mois
  proche(s.perf.a1, (1.01 ** 12 - 1) * 100, 1e-9);
  proche(s.perf.a1, 12.68, 0.005);
  proche(s.volatilite.a1, 0, 1e-9);
  assert.equal(s.perf.a3, null);
  assert.equal(s.perf.a5, null);
  assert.equal(s.volatilite.a3, null);
  assert.equal(s.volatilite.a5, null);
  assert.equal(s.frequence, "mensuelle");
  assert.equal(jour(s.depuis), "31/12/2019");
  assert.equal(jour(s.jusqua), "31/12/2020");

  // 12 points seulement : pas de fenêtre d'un an
  const court = statsSec(serie(Array(11).fill(1)));
  assert.equal(court.perf.a1, null);
  assert.equal(court.volatilite.a1, null);

  const longue = statsSec(serie(Array(60).fill(1)));   // 61 points : les trois fenêtres
  for (const k of ["a1", "a3", "a5"]) proche(longue.perf[k], 12.68, 0.005, k);
  const presque = statsSec(serie(Array(59).fill(1)));
  assert.equal(presque.perf.a5, null);
  assert.ok(presque.perf.a3 !== null);
});

test("statsSec : volatilité (écart type des rendements logarithmiques mensuels × √12) et performance de la fenêtre", () => {
  const { statsSec } = monde().ctx;
  // 12 rendements : 2 % et -1 % en alternance, sur une série qui en compte 14 (la fenêtre d'un an ignore les deux premiers)
  const r = [10, -10, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1];
  const s = statsSec(serie(r));
  const logs = [2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1].map(x => Math.log(1 + x / 100));
  const moy = logs.reduce((a, b) => a + b, 0) / 12;
  const attendue = Math.sqrt(logs.reduce((a, x) => a + (x - moy) ** 2, 0) / 11 * 12) * 100;
  proche(s.volatilite.a1, attendue, 1e-9);
  proche(s.volatilite.a1, 5.40, 0.01);
  const produit = [2, -1, 2, -1, 2, -1, 2, -1, 2, -1, 2, -1].reduce((a, x) => a * (1 + x / 100), 1);
  proche(s.perf.a1, (produit - 1) * 100, 1e-9);
  // sur 3 ans : annualisée (rendement de 36 mois élevé à la puissance 12/36)
  const sur3 = statsSec(serie(Array(40).fill(1)));
  proche(sur3.perf.a3, 12.68, 0.005);
});

test("statsSec : perte maximale sur toute la série", () => {
  const { statsSec } = monde().ctx;
  const s = statsSec(serie([-20, 12.5], "2026-01"));   // 100 → 80 → 90
  proche(s.maxDrawdown.valeur, -20, 1e-9);
  assert.equal(s.maxDrawdown.periode, "décembre 2025 → janvier 2026");
  // sommet, creux, puis nouveau sommet et baisse moins forte : on garde la pire baisse
  const deux = statsSec(serie([10, -30, 60, -10], "2026-01"));   // 100 → 110 → 77 → 123,2 → 110,88
  proche(deux.maxDrawdown.valeur, -30, 1e-9);
  assert.equal(deux.maxDrawdown.periode, "janvier 2026 → février 2026");
  const monte = statsSec(serie([1, 1, 1], "2026-01"));
  assert.equal(monte.maxDrawdown.valeur, 0);
  assert.equal(typeof monte.maxDrawdown.periode, "string");
});

test("statsSec : séries trop courtes ou absentes", () => {
  const { statsSec } = monde().ctx;
  assert.equal(statsSec(null), null);
  assert.equal(statsSec({ dates: [], valeurs: [] }), null);
  const un = statsSec(serie([5], "2026-01"));   // 2 points
  assert.equal(un.perf.a1, null);
  assert.equal(un.volatilite.a1, null);
  proche(un.maxDrawdown.valeur, 0);
});

// ---------- Composition ----------

const MAINTENANT = new Date(2026, 9, 9);   // 9 octobre 2026

test("compositionDepuisSec : Vanguard", () => {
  const { compositionDepuisSec } = monde().ctx;
  const c = simple(compositionDepuisSec(VANGUARD, MAINTENANT));
  assert.equal(c.principale, "sec");
  assert.deepEqual(c.sec, { date: "2026-06-30", lignes: 508, exclu: 0.01 });
  assert.deepEqual(c.pays, [{ nom: "États-Unis", code: "US", poids: 100.1 }]);
  assert.deepEqual(c.zones, [{ nom: "Amérique du Nord", poids: 100.1 }]);
  assert.deepEqual(c.secteurs, []);
  assert.deepEqual(c.classes, [{ nom: "Actions", poids: 99.75 }, { nom: "Monétaire", poids: 0.35 }]);   // 100,1 % : pas de « Liquidités »
  assert.deepEqual(c.devises, [{ nom: "USD", poids: 100.1 }]);
  assert.deepEqual(c.top10, [{ nom: "NVIDIA Corp", poids: 7.51, isin: "US67066G1040" }, { nom: "Apple Inc", poids: 6.59, isin: "US0378331005" },
    { nom: "Microsoft Corp", poids: 4.3, isin: "US5949181045" }]);
  assert.equal(c.couvertureChange, false);
  assert.equal(c.lignesSontDesFonds, false);
  assert.deepEqual(c.notes, []);
  assert.equal(c.inventaire, null);
  assert.equal(c.style, null);
});

test("compositionDepuisSec : Ashmore", () => {
  const { compositionDepuisSec } = monde().ctx;
  const c = simple(compositionDepuisSec(ASHMORE, MAINTENANT));
  assert.equal(c.principale, "sec");
  assert.deepEqual(c.classes, [{ nom: "Obligations", poids: 95.22 }, { nom: "Actions", poids: 0.17 }, { nom: "Liquidités et autres", poids: 4.61 }]);
  // 17 pays → 11 + « Autres » ; noms français quand NOMS_PAYS les connaît, sinon le code
  assert.equal(c.pays.length, 12);
  assert.deepEqual(c.pays[0], { nom: "VE", code: "VE", poids: 14.34 });
  assert.deepEqual(c.pays[1], { nom: "Malaisie", code: "MY", poids: 6.53 });
  assert.deepEqual(c.pays[4], { nom: "États-Unis", code: "US", poids: 5.22 });
  assert.equal(c.pays[11].nom, "Autres");
  assert.equal(c.pays[11].code, undefined);
  proche(c.pays[11].poids, 2.7 + 2.69 + 2.38 + 2.23 + 2.16 + 0, 0.011);   // ID, PL, HU, AR, KZ et NL (0)
  const zones = Object.fromEntries(c.zones.map(z => [z.nom, z.poids]));
  proche(zones["Pays émergents"], 6.53 + 5.81 + 5.37 + 3.74 + 3.4 + 3.29 + 3.22 + 2.7 + 2.23, 0.011);
  proche(zones["Amérique du Nord"], 5.22, 0.011);
  proche(zones["Autres"], 14.34 + 3.83 + 2.16, 0.011, "VE, NG et KZ ne sont dans aucune zone");
  proche(zones["Europe hors zone euro"], 3.08 + 2.69 + 2.38, 0.011);   // RO, PL, HU
  assert.deepEqual(c.zones.map(z => z.poids), [...c.zones.map(z => z.poids)].sort((a, b) => b - a));
  assert.equal(c.devises.length, 8);   // 11 devises → 7 + « Autres »
  assert.equal(c.devises[7].nom, "Autres");
  assert.deepEqual(c.notes, []);       // exclu 0,67 < 1 et inventaire récent
  assert.equal(c.lignesSontDesFonds, false);
  assert.equal(c.sec.lignes, 187);
});

test("compositionDepuisSec : notes (dérivés, ancienneté)", () => {
  const { compositionDepuisSec } = monde().ctx;
  const derives = simple(compositionDepuisSec({ ...VANGUARD, exclu: 2.5 }, MAINTENANT).notes);
  assert.deepEqual(derives, [{ type: "derives", texte: "Les produits dérivés et les positions vendeuses (2,5 % de l'actif net) ne sont pas comptés dans ces répartitions." }]);
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, exclu: 1 }, MAINTENANT).notes.map(n => n.type)), ["derives"]);
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, exclu: 0.99 }, MAINTENANT).notes), []);

  const ancien = simple(compositionDepuisSec({ ...VANGUARD, date: "2025-07-31" }, MAINTENANT).notes);
  assert.deepEqual(ancien, [{ type: "ancien", texte: "Attention : le dernier inventaire déposé à la SEC date du 31/07/2025. La composition a pu changer depuis." }]);
  // 9 mois pile : encore récent ; un jour de plus : ancien
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, date: "2026-01-09" }, MAINTENANT).notes), []);
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, date: "2026-01-08" }, MAINTENANT).notes.map(n => n.type)), ["ancien"]);
  // les deux notes ensemble, dérivés d'abord
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, date: "2025-07-31", exclu: 3 }, MAINTENANT).notes.map(n => n.type)), ["derives", "ancien"]);
  // sans date de référence, « maintenant » est l'instant présent : l'inventaire de 2026 n'est pas encore ancien, celui de 2020 l'est
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, date: "2020-01-31" }).notes.map(n => n.type)), ["ancien"]);
});

test("compositionDepuisSec : effet de levier", () => {
  const { compositionDepuisSec } = monde().ctx;
  const levier = compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 120.2], ["Obligations", 17.2]] }, MAINTENANT);
  assert.deepEqual(simple(levier.notes), [{ type: "levier", texte: "Les positions déclarées représentent 137 % de l'actif net : le fonds utilise un effet de levier (emprunts ou produits dérivés)." }]);
  assert.ok(!levier.classes.some(c => /Liquidités/.test(c.nom)));
  // poids négatifs et supérieurs à 100 dans les vraies données : la somme décide, rien n'est supposé entre 0 et 100
  const net = compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 150], ["Obligations", -20]] }, MAINTENANT);
  assert.deepEqual(simple(net.notes.map(n => n.type)), ["levier"]);
  assert.match(net.notes[0].texte, /représentent 130 % de l'actif net/);
  // exactement 110 % : pas de note
  assert.deepEqual(simple(compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 110]] }, MAINTENANT).notes), []);
  assert.equal(compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 110.01]] }, MAINTENANT).notes[0].type, "levier");
  // sous 100 : des liquidités sont ajoutées (plus de 0,5 point), sinon rien
  const sous = compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 90]] }, MAINTENANT);
  assert.deepEqual(simple(sous.classes), [{ nom: "Actions", poids: 90 }, { nom: "Liquidités et autres", poids: 10 }]);
  assert.deepEqual(compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 99.6]] }, MAINTENANT).classes.map(c => c.nom), ["Actions"]);
  assert.deepEqual(compositionDepuisSec({ ...VANGUARD, classes: [["Actions", 99.5]] }, MAINTENANT).classes.map(c => c.nom), ["Actions"]);   // 0,5 : seuil non dépassé
});

test("compositionDepuisSec : « N/A » de N-PORT = inconnu", () => {
  const { compositionDepuisSec } = monde().ctx;
  const c = simple(compositionDepuisSec({ ...VANGUARD,
    top: [["N/A", 5, "N/A"], ["Apple Inc", 4, ""], ["Microsoft Corp", 3, null], ["Nvidia", 2, "US67066G1040"]],
    pays: [["US", 50], ["N/A", 3]],
    devises: [["USD", 50], ["N/A", 2]]
  }, MAINTENANT));
  assert.deepEqual(c.top10, [{ nom: "Position sans nom", poids: 5, isin: null }, { nom: "Apple Inc", poids: 4, isin: null },
    { nom: "Microsoft Corp", poids: 3, isin: null }, { nom: "Nvidia", poids: 2, isin: "US67066G1040" }]);
  assert.deepEqual(c.pays, [{ nom: "États-Unis", code: "US", poids: 50 }, { nom: "Non précisé", code: null, poids: 3 }]);
  assert.deepEqual(c.zones, [{ nom: "Amérique du Nord", poids: 50 }, { nom: "Autres", poids: 3 }]);
  assert.deepEqual(c.devises, [{ nom: "USD", poids: 50 }, { nom: "Non précisée", poids: 2 }]);
});

test("compositionDepuisSec : fonds de fonds, dix lignes au plus, rien de modifié", () => {
  const { compositionDepuisSec } = monde().ctx;
  const douze = Array.from({ length: 12 }, (_, i) => ["Ligne " + i, 12 - i, null]);
  const fonds = { ...VANGUARD, top: douze, classes: [["Fonds (OPC)", 50], ["Actions", 50]] };
  const avant = JSON.stringify(fonds);
  const c = compositionDepuisSec(fonds, MAINTENANT);
  assert.equal(c.top10.length, 10);
  assert.equal(c.lignesSontDesFonds, true);
  assert.equal(compositionDepuisSec({ ...fonds, classes: [["Fonds (OPC)", 49.9], ["Actions", 50.1]] }, MAINTENANT).lignesSontDesFonds, false);
  assert.equal(JSON.stringify(fonds), avant);
});

test("compositionDepuisSec : données manquantes sans exception", () => {
  const { compositionDepuisSec } = monde().ctx;
  assert.equal(compositionDepuisSec(null, MAINTENANT), null);
  assert.equal(compositionDepuisSec(VIDE, MAINTENANT), null);   // date nulle : pas de composition
  const sansListes = simple(compositionDepuisSec({ ...VIDE, date: "2026-06-30" }, MAINTENANT));
  assert.equal(sansListes.principale, "sec");
  assert.deepEqual([sansListes.pays, sansListes.zones, sansListes.classes, sansListes.devises, sansListes.top10], [[], [], [], [], []]);   // pas de « Liquidités 100 % »
  const partiel = { date: "2026-06-30" };   // champs absents
  assert.equal(compositionDepuisSec(partiel, MAINTENANT).principale, "sec");
});

// ---------- Frais ----------

test("fraisSec", () => {
  const { fraisSec } = monde().ctx;
  const attendu = { brut: 0.03, net: 0.03, gestion: null, entree: null, sortie: null, date: "2026-04-28", retenu: 0.03 };
  assert.deepEqual(simple(fraisSec([0.03, 0.03, null, null, null, "2026-04-28"])), attendu);   // tableau de frais
  assert.deepEqual(simple(fraisSec({ frais: [0.03, 0.03, null, null, null, "2026-04-28"] })), attendu);   // part lue
  assert.deepEqual(simple(fraisSec(VANGUARD.parts[2])), attendu);                                          // part brute du fichier
  assert.equal(fraisSec(null), null);
  assert.equal(fraisSec(undefined), null);
  assert.equal(fraisSec({ frais: null }), null);
  assert.equal(fraisSec({}), null);
  assert.equal(fraisSec([]), null);
  const completes = simple(fraisSec(VANGUARD.parts[0]));   // [0.14, null, 0.14, 0, null, date]
  assert.deepEqual(completes, { brut: 0.14, net: null, gestion: 0.14, entree: 0, sortie: null, date: "2026-04-28", retenu: 0.14 });
});

test("fraisSec : frais retenu et valeurs absurdes", () => {
  const { fraisSec } = monde().ctx;
  const f = (...v) => simple(fraisSec([...v, "2026-02-26"]));
  assert.equal(f(1.62, 1.21, 1, 0, 0).retenu, 1.21);       // net inférieur au brut : le net
  assert.equal(f(0.5, 0.5, null, null, null).retenu, 0.5);
  assert.equal(f(0.5, 0.9, null, null, null).retenu, 0.5); // net supérieur au brut : le brut
  assert.equal(f(0.5, null, null, null, null).retenu, 0.5);
  assert.equal(f(null, 0.4, null, null, null).retenu, 0.4);
  assert.equal(f(null, null, 1, 0, 0).retenu, null);
  // plus de 20 % de frais : valeur absente
  const absurde = f(25, 0.5, 30, 0, 40);
  assert.deepEqual(absurde, { brut: null, net: 0.5, gestion: null, entree: 0, sortie: null, date: "2026-02-26", retenu: 0.5 });
  assert.equal(f(25, 22, null, null, null).retenu, null);
  assert.equal(f(20, 20, null, null, null).brut, 20);        // 20 est encore admis
  assert.equal(f(20.01, 1, null, null, null).brut, null);
  assert.equal(f(20.01, 1, null, null, null).retenu, 1);
});

// ---------- Expositions pour le simulateur ----------

test("expositionsDepuisComposition : Vanguard et Ashmore", () => {
  const { compositionDepuisSec, expositionsDepuisComposition } = monde().ctx;
  assert.deepEqual(simple(expositionsDepuisComposition(compositionDepuisSec(VANGUARD, MAINTENANT))), [{ cle: "usa", poids: 100 }]);
  const a = simple(expositionsDepuisComposition(compositionDepuisSec(ASHMORE, MAINTENANT)));
  assert.deepEqual(a.map(e => e.cle), ["oblig10", "oblig3", "monetaire"]);   // actions à 0,17 % : sous 1 %, retirées
  proche(a[0].poids, 47.7, 0.05);
  proche(a[1].poids, 47.7, 0.05);
  proche(a[2].poids, 4.6, 0.05);
  for (const e of a) assert.equal(e.poids, Math.round(e.poids * 10) / 10);
  proche(a.reduce((s, e) => s + e.poids, 0), 100, 0.11);
});

test("expositionsDepuisComposition : zones, Fonds (OPC), Autres, monétaire", () => {
  const { expositionsDepuisComposition } = monde().ctx;
  const c = {
    classes: [{ nom: "Actions", poids: 40 }, { nom: "Fonds (OPC)", poids: 20 }, { nom: "Autres", poids: 10 }, { nom: "Obligations", poids: 20 }, { nom: "Monétaire", poids: 10 }],
    zones: [{ nom: "Amérique du Nord", poids: 40 }, { nom: "Zone euro", poids: 25 }, { nom: "Europe hors zone euro", poids: 15 }, { nom: "Asie-Pacifique développée", poids: 10 },
      { nom: "Pays émergents", poids: 5 }, { nom: "Autres", poids: 5 }]
  };
  const e = Object.fromEntries(simple(expositionsDepuisComposition(c)).map(x => [x.cle, x.poids]));
  // actions + OPC + autres = 70 réparties sur 100 de zones : usa 40 + 5 = 45 %, euro 25 %, europe 15 %, japon 10 %, émergents 5 %
  assert.deepEqual(e, { usa: 31.5, euro: 17.5, europe: 10.5, japon: 7, emergents: 3.5, oblig10: 10, oblig3: 10, monetaire: 10 });
  const liquidites = expositionsDepuisComposition({ classes: [{ nom: "Liquidités et autres", poids: 100 }], zones: [] });
  assert.deepEqual(simple(liquidites), [{ cle: "monetaire", poids: 100 }]);
});

test("expositionsDepuisComposition : clés sous 1 % retirées, total ramené à 100, sans zone", () => {
  const { expositionsDepuisComposition } = monde().ctx;
  const c = { classes: [{ nom: "Actions", poids: 95 }, { nom: "Monétaire", poids: 0.5 }, { nom: "Obligations", poids: 4.5 }],
    zones: [{ nom: "Zone euro", poids: 99.5 }, { nom: "Asie-Pacifique développée", poids: 0.5 }] };
  const e = simple(expositionsDepuisComposition(c));
  assert.deepEqual(e.map(x => x.cle), ["euro", "oblig10", "oblig3"]);   // japon (0,5 %) et monétaire (0,5 %) retirés
  assert.equal(e[0].poids, Math.round(94.525 / 99.025 * 1000) / 10);
  proche(e.reduce((s, x) => s + x.poids, 0), 100, 0.11);
  // sans zones : tout en actions américaines
  assert.deepEqual(simple(expositionsDepuisComposition({ classes: [{ nom: "Actions", poids: 80 }], zones: [] })), [{ cle: "usa", poids: 100 }]);
  assert.deepEqual(simple(expositionsDepuisComposition({ classes: [{ nom: "Actions", poids: 80 }] })), [{ cle: "usa", poids: 100 }]);
  // effet de levier : la somme dépasse 100, le total est ramené à 100
  const levier = simple(expositionsDepuisComposition({ classes: [{ nom: "Actions", poids: 130 }, { nom: "Obligations", poids: -20 }], zones: [] }));
  assert.deepEqual(levier, [{ cle: "usa", poids: 100 }]);
  // rien d'exploitable
  assert.deepEqual(simple(expositionsDepuisComposition({ classes: [], zones: [] })), []);
  assert.deepEqual(simple(expositionsDepuisComposition(null)), []);
  assert.deepEqual(simple(expositionsDepuisComposition({})), []);
});

// ---------- Tout ensemble ----------

test("donneesSec : morceau chargé une fois", async () => {
  const m = monde({ fichiers: { "data/etats-unis/23.js": morceauDe("S000002839", VANGUARD) } });
  const e = entree(m, LIGNE_S(2839));
  const [a, b] = await Promise.all([m.ctx.donneesSec(e, null), m.ctx.donneesSec(e, null)]);
  assert.deepEqual(m.chargements, ["data/etats-unis/23.js"]);   // un seul <script> pour les deux appels
  assert.equal(a.serie, "S000002839");
  assert.equal(a.detail, b.detail);
  assert.equal((await m.ctx.donneesSec(e, null)).serie, "S000002839");
  assert.equal(m.chargements.length, 1);
  assert.equal(await m.ctx.donneesSec(entree(m, LIGNE_FR), "FR0010135103"), null);   // pas une série américaine : rien à charger
  assert.equal(await m.ctx.donneesSec(entree(m, LIGNE_S(87)), null), null);          // même morceau (87 % 64 = 23), série absente
  assert.equal(m.chargements.length, 1);
});

test("donneesSec : fonds complet", async () => {
  const m = monde({ fichiers: { "data/etats-unis/23.js": morceauDe("S000002839", VANGUARD) } });
  const voo = await m.ctx.donneesSec(entree(m, LIGNE_VOO), "US9229083632");   // l'ETF européen, résolu par son ISIN
  assert.equal(voo.serie, "S000002839");
  assert.equal(voo.part.nom, "ETF Shares");
  assert.equal(voo.historique.valeurs.length, 82);   // 81 mois + le point de départ
  assert.equal(voo.historique.valeurs[0], 100);
  assert.equal(voo.historique.ignores, false);
  assert.equal(jour(voo.historique.dates[0]), "30/09/2019");
  assert.equal(jour(voo.historique.dates[81]), "30/06/2026");
  assert.ok(voo.stats.perf.a5 !== null);
  assert.equal(voo.stats.frequence, "mensuelle");
  assert.equal(voo.compo.principale, "sec");
  assert.equal(voo.frais.retenu, 0.03);

  const sansCompo = await m.ctx.donneesSec(entree(m, LIGNE_S(2839)), null, { composition: false });
  assert.equal(sansCompo.part.nom, "Investor Shares");
  assert.equal(sansCompo.compo, null);
  assert.equal(sansCompo.frais.retenu, 0.14);
  assert.ok(sansCompo.stats);
  assert.equal(sansCompo.detail.nom, "VANGUARD 500 INDEX FUND");
});

test("donneesSec : stats à partir de 13 points seulement, compo seulement avec une date", async () => {
  const detail = (rendements, date = "2026-06-30") => ({ ...ASHMORE, date, parts: [["C1", "Class A", "AAA", "2025-01", rendements, null]] });
  const m = monde({ fichiers: {
    "data/etats-unis/01.js": morceauDe("S000000001", detail(Array(12).fill(1))),   // 13 points
    "data/etats-unis/02.js": morceauDe("S000000002", detail(Array(11).fill(1))),   // 12 points
    "data/etats-unis/03.js": morceauDe("S000000003", detail(Array(12).fill(1), null))
  } });
  const treize = await m.ctx.donneesSec(entree(m, LIGNE_S(1)), null);
  assert.equal(treize.historique.valeurs.length, 13);
  assert.ok(treize.stats);
  assert.equal(treize.frais, null);   // part sans frais
  const douze = await m.ctx.donneesSec(entree(m, LIGNE_S(2)), null);
  assert.equal(douze.historique.valeurs.length, 12);
  assert.equal(douze.stats, null);
  const sansDate = await m.ctx.donneesSec(entree(m, LIGNE_S(3)), null);
  assert.equal(sansDate.compo, null);
  assert.ok(sansDate.historique);
});

test("donneesSec : données manquantes, rien ne lève d'exception", async () => {
  const sansRendements = { ...ASHMORE, parts: [["C1", "Class A", "AAA", "2025-01", null, [0.5, 0.5, null, null, null, "2026-01-01"]]] };
  const tousVides = { ...ASHMORE, parts: [["C1", "Class A", "AAA", "2025-01", [null, null], null]] };
  const m = monde({ fichiers: {
    "data/etats-unis/01.js": morceauDe("S000000001", VIDE),
    "data/etats-unis/02.js": morceauDe("S000000002", sansRendements),
    "data/etats-unis/03.js": morceauDe("S000000003", tousVides)
  } });
  const vide = await m.ctx.donneesSec(entree(m, LIGNE_S(1)), null);
  assert.equal(vide.serie, "S000000001");
  assert.equal(vide.detail.nom, VIDE.nom);
  for (const cle of ["part", "historique", "stats", "compo", "frais"]) assert.equal(vide[cle], null, cle);
  const sans = await m.ctx.donneesSec(entree(m, LIGNE_S(2)), null);
  assert.equal(sans.historique, null);
  assert.equal(sans.stats, null);
  assert.equal(sans.frais.retenu, 0.5);
  assert.equal(sans.compo.principale, "sec");
  const trous = await m.ctx.donneesSec(entree(m, LIGNE_S(3)), null);
  assert.equal(trous.historique, null);
  assert.equal(trous.stats, null);
  assert.equal(await m.ctx.donneesSec(null, null), null);
  assert.equal(await m.ctx.donneesSec(entree(m, LIGNE_S(4)), null).catch(e => e.message), "data/etats-unis/04.js non chargé");   // réseau : l'erreur remonte
});

test("donneesSec : composition sans les fonctions de l'inventaire (page Performances)", async () => {
  // js/inventaire.js n'est pas chargé sur performances.html : composition: false ne doit rien lui demander
  const m = monde({ site: ["js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js"], fichiers: { "data/etats-unis/23.js": morceauDe("S000002839", VANGUARD) } });
  assert.equal(typeof m.ctx.regrouper, "undefined");
  const d = await m.ctx.donneesSec(entree(m, LIGNE_S(2839)), null, { composition: false });
  assert.equal(d.compo, null);
  assert.ok(d.stats && d.historique && d.frais);
});

// ---------- Données réelles (data/etats-unis/, générées par scripts/construire_etats_unis.py) ----------

test("données réelles : chaque série est dans son morceau, tout se lit sans exception ni nombre absurde", () => {
  const m = monde({ isin: {} });
  for (let k = 0; k < 64; k++) vm.runInContext(lire(`data/etats-unis/${String(k).padStart(2, "0")}.js`), m.ctx);
  const details = vm.runInContext("ETATS_UNIS_DETAILS", m.ctx);
  const fini = x => JSON.stringify(x, (_, v) => (typeof v === "number" && !isFinite(v) ? "!" : v)).indexOf('"!"') < 0;
  let series = 0, aStats = 0, aCompo = 0;
  for (const k of Object.keys(details)) {
    for (const [serie, detail] of Object.entries(details[k])) {
      series++;
      assert.equal(Number(serie.slice(1)) % 64, Number(k), `${serie} dans le mauvais morceau`);
      const part = m.ctx.partSec(detail, null);
      const h = part && m.ctx.serieEurosDepuisRendements(part.debut, part.rendements);
      if (h) {
        assert.equal(h.valeurs.length, h.dates.length, serie);
        assert.ok(h.valeurs.every(v => v > 0), `${serie} : valeur nulle ou négative`);
      }
      const stats = h && h.valeurs.length >= 13 ? m.ctx.statsSec(h) : null;
      if (stats) { aStats++; assert.ok(fini(stats), `${serie} : statistiques non finies`); }
      const compo = detail.date ? m.ctx.compositionDepuisSec(detail, MAINTENANT) : null;
      if (compo) {
        aCompo++;
        assert.ok(fini(compo), `${serie} : composition non finie`);
        const expo = m.ctx.expositionsDepuisComposition(compo);
        if (expo.length) assert.ok(Math.abs(expo.reduce((s, e) => s + e.poids, 0) - 100) < 0.5, `${serie} : expositions ≠ 100 %`);
      } else {
        assert.equal(m.ctx.compositionDepuisSec(detail, MAINTENANT), null, serie);
      }
      const frais = m.ctx.fraisSec(part);
      if (frais) for (const cle of ["brut", "net", "gestion", "entree", "sortie", "retenu"]) assert.ok(frais[cle] === null || (frais[cle] >= 0 && frais[cle] <= 20), `${serie} : frais ${cle}`);
    }
  }
  assert.ok(series > 10000 && aStats > 5000 && aCompo > 5000, `${series} séries, ${aStats} avec statistiques, ${aCompo} avec composition`);
});

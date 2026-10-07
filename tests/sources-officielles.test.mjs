import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

process.env.TZ = "Europe/Paris";   // le test « changement d'heure » en dépend : en UTC, mars → avril fait déjà 31 jours pile

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));
function charger(fichiers, globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}

test("cleSociete : mêmes résultats que le Python", () => {
  const { cleSociete } = charger(["js/outils.js"]);
  for (const [nom, attendu] of JSON.parse(lire("tests/donnees/noms_societes.json"))) assert.equal(cleSociete(nom), attendu, nom);
  assert.equal(cleSociete(null), "");
});

const FICHE = ["js/glossaire.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/fiche-auto.js"];
const FIRDS_T = { maj: "2026-10-01", parNom: [], places: {}, fonds: {
  LU1681043599: ["5493003BFED2MWDBYH64", "EUR", [], 0], DE000A0F5UF5: ["529900APEXTPT6RN1778", "EUR", [], 0] } };
const IDENTITE_T = { maj: "2026-10-06", esma: "2026-10-06", notifFR: ["5493003BFED2MWDBYH64"], noms: [], fonds: {}, liquidite: {}, bce: "", gleif: "", fitrs: 2025 };
const fonds = (source, isins, autres = {}) => ({ source, cmpId: 1, prdId: 1, nom: "FONDS TEST", gestionnaire: "", classification: "", nature: "",
  isins, dateCreation: "", pays: "LU", tickers: [], marches: "", devise: "EUR", etf: source === "E", public: true, ...autres });
const TITRE_NOTIFIE = "Notifié pour la commercialisation en France (registre européen)";
const TITRE_ABSENT = "Fonds absent de la liste des fonds vendus en France";

test("notifieFrance", () => {
  const c = charger(FICHE, { FIRDS: FIRDS_T, IDENTITE: IDENTITE_T });
  assert.equal(c.notifieFrance(fonds("U", ["LU1681043599"])), true);
  assert.equal(c.notifieFrance(fonds("U", ["DE000A0F5UF5"])), false);
  assert.equal(c.notifieFrance(fonds("U", ["XX0000000000"])), false);
});

test("notifieFrance sans données", () => {
  assert.equal(charger(FICHE).notifieFrance(fonds("U", ["LU1681043599"])), false);
  const ancien = { ...IDENTITE_T }; delete ancien.notifFR;
  assert.equal(charger(FICHE, { FIRDS: FIRDS_T, IDENTITE: ancien }).notifieFrance(fonds("U", ["LU1681043599"])), false);
});

test("fonds U notifié : information à la place de l'alerte", () => {
  const c = charger(FICHE, { FIRDS: FIRDS_T, IDENTITE: IDENTITE_T });
  const oui = simple(c.detecterPiegesAuto(fonds("U", ["LU1681043599"]), null));
  assert.ok(oui.some(p => p.titre === TITRE_NOTIFIE && p.niveau === "info" && p.terme === "commercialisation"));
  assert.ok(!oui.some(p => p.titre === TITRE_ABSENT));
  const non = simple(c.detecterPiegesAuto(fonds("U", ["DE000A0F5UF5"]), null));
  assert.ok(non.some(p => p.titre === TITRE_ABSENT && p.niveau === "attention"));
});

test("ligne d'identité et source ESMA (E et U notifiés seulement)", () => {
  const c = charger(FICHE, { FIRDS: FIRDS_T, IDENTITE: IDENTITE_T });
  for (const src of ["E", "U"]) {
    const r = c.identiteEsma(fonds(src, ["LU1681043599"]), "LU1681043599");
    assert.ok(JSON.stringify(simple(r.lignes)).includes("notifié (registre européen de l'ESMA)"), src);
    assert.ok(r.source.includes("ESMA – registre de la commercialisation transfrontière des OPCVM et FIA"), src);
  }
  for (const [src, isin] of [["E", "DE000A0F5UF5"], ["N", "LU1681043599"]]) {
    const r = c.identiteEsma(fonds(src, [isin]), isin);
    assert.ok(!JSON.stringify(simple(r.lignes)).includes("registre européen de l'ESMA"), src);
    assert.ok(!r.source.includes("commercialisation transfrontière"), src);
  }
});

const SOCIETES_T = { maj: "2026-10-06", publication: "2026-10-05", societes: {
  CARMIGNACGESTION: ["GP97008", "1997-03-13", "www.carmignac.com", "Vivant"],
  AMUNDIASSETMANAGEMENT: ["GP-04000036", "2004-06-08", "", "Vivant"],
  SOCIETEFERMEE: ["GP-1", "2000-01-01", "", "Retiré"] } };
const francais = gestionnaire => fonds("G", ["FR0010135103"], { gestionnaire, pays: "FR", etf: false });

test("ligneAgrement", () => {
  const c = charger(FICHE, { SOCIETES: SOCIETES_T });
  const [libelle, valeur] = simple(c.ligneAgrement(francais("Carmignac Gestion")));
  assert.ok(libelle.includes("Agréée par l&#39;AMF"));
  assert.ok(valeur.includes("n° GP97008, depuis le 13/03/1997"));
  assert.ok(valeur.includes('href="https://www.carmignac.com" target="_blank" rel="noopener"'));
  assert.ok(valeur.includes("site de la société"));
  assert.ok(!simple(c.ligneAgrement(francais("AMUNDI ASSET MANAGEMENT")))[1].includes("site de la société"));
  assert.equal(c.ligneAgrement(francais("BLACKROCK ASSET MANAGEMENT IRELAND")), null);
  assert.equal(c.ligneAgrement(francais("")), null);
  assert.equal(c.ligneAgrement(francais("SOCIETE FERMEE")), null);
});

test("ligneAgrement sans données", () => {
  assert.equal(charger(FICHE).ligneAgrement(francais("Carmignac Gestion")), null);
});

test("alerte si l'agrément n'est pas « Vivant »", () => {
  const c = charger(FICHE, { SOCIETES: SOCIETES_T });
  assert.ok(simple(c.detecterPiegesAuto(francais("SOCIETE FERMEE"), null))
    .some(p => p.niveau === "attention" && p.titre === "Agrément de la société de gestion : Retiré"));
  assert.ok(!simple(c.detecterPiegesAuto(francais("CARMIGNAC GESTION"), null)).some(p => p.titre.startsWith("Agrément")));
});

const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const jour = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

// Valeur de la série à une date (année, mois, jour), ou undefined si aucun point n'est daté de ce jour
const valeurLe = (r, ...ajm) => r.valeurs[r.dates.findIndex(d => jour(d).join() === ajm.join())];

test("serieDepuisCsvBce : série mensuelle (taux composé, base 365), un point par jour entre deux mois publiés", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce(lire("tests/donnees/bce_livrets.csv"));
  assert.equal(r.dates.length, 30 + 31 + 1);                         // du 01/06 au 01/08 inclus
  assert.deepEqual(jour(r.dates[0]), [2026, 6, 1]);
  assert.deepEqual(jour(r.dates.at(-1)), [2026, 8, 1]);
  assert.ok(r.dates.every((d, i) => i === 0 || d > r.dates[i - 1]));
  assert.ok(r.dates.every(d => d.getHours() === 0));
  proche(valeurLe(r, 2026, 6, 1), 100);
  proche(valeurLe(r, 2026, 7, 1), 100 * 1.014 ** (30 / 365));
  proche(valeurLe(r, 2026, 8, 1), valeurLe(r, 2026, 7, 1) * 1.014 ** (31 / 365));
  proche(valeurLe(r, 2026, 6, 2), 100 * 1.014 ** (1 / 365));         // chaque jour : taux du mois, composé sur 1/365
});

test("serieDepuisCsvBce : changement d'heure", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce("TIME_PERIOD,OBS_VALUE\n2026-03,1.5\n2026-04,1.5\n");
  assert.equal(r.dates.length, 31 + 1);
  assert.ok(r.dates.every(d => d.getHours() === 0));
  proche(valeurLe(r, 2026, 4, 1), 100 * 1.015 ** (31 / 365));
});

test("serieDepuisCsvBce : série quotidienne (€STR, intérêts simples, base 360)", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce("KEY,TIME_PERIOD,OBS_VALUE\nx,2026-10-01,2.0\nx,2026-10-02,\nx,2026-10-03,2.0\n");
  assert.equal(r.valeurs.length, 2);
  proche(r.valeurs[1], 100 * (1 + 2 / 100 * 2 / 360));
});

test("serieDepuisCsvBce : série mensuelle prolongée jour par jour jusqu'à la date demandée (dernier taux appliqué)", () => {
  const { serieDepuisCsvBce } = charger(["js/outils.js"]);
  const csv = lire("tests/donnees/bce_livrets.csv");
  const seule = serieDepuisCsvBce(csv);
  const r = serieDepuisCsvBce(csv, new Date(2026, 9, 6, 15, 30));   // l'heure de la journée est ignorée
  const n = seule.dates.length;                                      // 62 points : du 01/06 au 01/08
  assert.equal(r.dates.length, n + 66);                              // + un point par jour du 02/08 au 06/10
  assert.deepEqual(simple(r.dates.slice(n - 1, n + 1).map(jour)), [[2026, 8, 1], [2026, 8, 2]]);
  assert.deepEqual(jour(r.dates.at(-1)), [2026, 10, 6]);
  assert.ok(r.dates.some(d => jour(d).join() === "2026,10,2"));
  assert.ok(r.dates.every((d, i) => i === 0 || d > r.dates[i - 1]));
  assert.ok(r.dates.every(d => d.getHours() === 0));
  proche(r.valeurs[n], r.valeurs[n - 1] * 1.0155 ** (1 / 365));
  proche(r.valeurs.at(-1), r.valeurs[n - 1] * 1.0155 ** (66 / 365));
  assert.deepEqual(simple(r.valeurs.slice(0, n)), simple(seule.valeurs));
  assert.deepEqual(simple(r.dates.slice(0, n)), simple(seule.dates));
  assert.equal(serieDepuisCsvBce(csv, new Date(2026, 7, 1)).dates.length, n);   // même jour que le dernier point : rien à ajouter
  assert.equal(serieDepuisCsvBce(csv, new Date(2026, 6, 1)).dates.length, n);   // date antérieure : rien à ajouter
});

test("serieDepuisCsvBce : prolongement à travers le changement d'heure (un point à minuit chaque jour)", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce("TIME_PERIOD,OBS_VALUE\n2026-03,1.5\n", new Date(2026, 3, 3));   // mars 2026 : passage à l'heure d'été le 29
  assert.equal(r.dates.length, 1 + 33);
  assert.ok(r.dates.every(d => d.getHours() === 0));
  assert.deepEqual(jour(r.dates.at(-1)), [2026, 4, 3]);
  proche(r.valeurs.at(-1), 100 * 1.015 ** (33 / 365));
});

test("serieDepuisCsvBce : la série quotidienne n'est pas prolongée", () => {
  const { serieDepuisCsvBce } = charger(["js/outils.js"]);
  const r = serieDepuisCsvBce("KEY,TIME_PERIOD,OBS_VALUE\nx,2026-10-01,2.0\nx,2026-10-02,\nx,2026-10-03,2.0\n", new Date(2026, 9, 6));
  assert.equal(r.valeurs.length, 2);
  assert.deepEqual(simple(r.dates.map(jour)), [[2026, 10, 1], [2026, 10, 3]]);
});

// js/performances.js touche à la page dès son chargement : on n'en extrait que les définitions testées
function extraitDePerformances(globales, ...noms) {
  const ctx = charger(["js/outils.js"], globales), source = lire("js/performances.js");
  for (const nom of noms) {
    const motif = nom === "PERIODES" ? /const PERIODES = \[[\s\S]*?\n\];\n/ : new RegExp(`function ${nom}\\([\\s\\S]*?\\n\\}\\n`);
    vm.runInContext(source.match(motif)[0], ctx);
  }
  return ctx;
}

test("serieReference : série BCE vide ou en erreur refusée et non gardée en cache", async () => {
  for (const corps of ["", "Not Found", "TIME_PERIOD,OBS_VALUE\n", "TIME_PERIOD,OBS_VALUE\n2026-08,\n"]) {
    const cacheSeries = new Map();
    const c = extraitDePerformances({ cacheSeries, BCE_API: "https://bce.test/", fetch: async () => ({ text: async () => corps }) }, "serieReference");
    await assert.rejects(c.serieReference({ cle: "ref-livrets", bce: "MIR/X" }), /série BCE indisponible/);
    assert.equal(cacheSeries.has("ref-livrets"), false);
  }
});

test("serieReference : série BCE valide, prolongée jour par jour jusqu'à aujourd'hui et gardée en cache", async () => {
  const cacheSeries = new Map(), appels = [];
  const c = extraitDePerformances({ cacheSeries, BCE_API: "https://bce.test/",
    fetch: async url => { appels.push(url); return { text: async () => lire("tests/donnees/bce_livrets.csv") }; } }, "serieReference");
  const r = await c.serieReference({ cle: "ref-livrets", bce: "MIR/X" });
  assert.ok(r.dates.length > 3);
  assert.deepEqual(jour(r.dates.at(-1)), jour(new Date()));
  assert.equal(cacheSeries.has("ref-livrets"), true);
  assert.deepEqual(appels, ["https://bce.test/MIR/X?format=csvdata&detail=dataonly&startPeriod=2019-10-01"]);
});

test("sourcesBce : une mention par référence BCE comparée", () => {
  const { sourcesBce } = extraitDePerformances({}, "sourcesBce");
  const mention = (...cles) => sourcesBce(cles.map(cle => ({ cle })));
  assert.equal(mention("ref-monde", "fonds-X"), "");
  assert.equal(mention("ref-monetaire"), " et €STR de la Banque centrale européenne");
  assert.equal(mention("ref-livrets"), " et taux moyen des livrets (BCE, données de la Banque de France ; dernier taux publié appliqué aux mois pas encore publiés)");
  assert.equal(mention("ref-monetaire", "ref-livrets"), mention("ref-monetaire") + mention("ref-livrets"));
});

test("graphique : la série des livrets prolongée garde ses points jusqu'à la dernière date du fonds", () => {
  const c = extraitDePerformances({}, "PERIODES", "indiceAvant", "debutPeriode", "pointsSurPeriode");
  const livrets = c.serieDepuisCsvBce(lire("tests/donnees/bce_livrets.csv"), new Date(2026, 9, 6));
  const finFonds = new Date(2026, 9, 5);   // les valeurs liquidatives sont publiées au plus tôt le lendemain
  const unMois = c.pointsSurPeriode(livrets, c.debutPeriode("1m", finFonds, livrets.dates[0]), finFonds);
  assert.ok(unMois, "la période « 1 mois » ne doit pas faire disparaître la série");
  assert.deepEqual(jour(unMois.pts.at(-1).d), [2026, 10, 5]);
  assert.deepEqual(jour(unMois.pts[0].d), [2026, 9, 5]);
  const sixMois = c.pointsSurPeriode(livrets, c.debutPeriode("6m", finFonds, livrets.dates[0]), finFonds);
  assert.deepEqual(jour(sixMois.pts.at(-1).d), [2026, 10, 5]);
});

test("graphique : « Cette année » part du 31 décembre, pas du 1er décembre (série mensuelle des livrets)", () => {
  const c = extraitDePerformances({}, "PERIODES", "indiceAvant", "debutPeriode", "pointsSurPeriode", "performancesAnnuelles");
  const mois = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const csv = "TIME_PERIOD,OBS_VALUE\n" + mois.map(m => `${m},1.5\n`).join("");
  const finFonds = new Date(2026, 9, 5);
  const livrets = c.serieDepuisCsvBce(csv, finFonds);
  const debut = c.debutPeriode("ytd", finFonds, livrets.dates[0]);
  const annee = c.pointsSurPeriode(livrets, debut, finFonds);
  assert.deepEqual(jour(annee.pts[0].d), jour(debut));               // 31/12/2025
  assert.deepEqual(jour(annee.pts.at(-1).d), [2026, 10, 5]);
  proche(annee.pts.at(-1).v, (1.015 ** (278 / 365) - 1) * 100);      // 278 jours du 31/12/2025 au 05/10/2026 : +1,14 %
  const ligne2026 = simple(c.performancesAnnuelles(livrets)).find(l => l.annee === 2026);
  proche(ligne2026.perf, (1.015 ** (278 / 365) - 1) * 100);          // la ligne 2026 ne contient pas décembre 2025
});

const SIMU = ["js/outils.js", "js/projection.js"];
test("valeurLivret", () => {
  const { valeurLivret } = charger(SIMU);
  proche(valeurLivret({ capital: 1000, versement: 100, frequence: 1, augmentation: 0, mois: 12 }, 0), 2200);
  proche(valeurLivret({ capital: 1000, versement: 0, frequence: 1, augmentation: 0, mois: 24 }, 3), 1000 * 1.03 ** 2);
  proche(valeurLivret({ capital: 0, versement: 1200, frequence: 12, augmentation: 0, mois: 24 }, 10), 1200 * 1.1 + 1200);
  proche(valeurLivret({ capital: 0, versement: 100, frequence: 12, augmentation: 10, mois: 24 }, 0), 210);
});

test("repereLivret sans indicateur", () => {
  const { repereLivret } = charger(SIMU);
  const P = { capital: 1000, versement: 100, frequence: 1, augmentation: 0, mois: 12 };
  assert.equal(repereLivret(P, null), null);
  assert.equal(repereLivret(P, { valeur: null, date: "2026-08" }), null);
  const r = simple(repereLivret(P, { valeur: 1.55, date: "2026-08" }));
  assert.equal(r.taux, 1.55); assert.equal(r.date, "2026-08");
  proche(r.valeur, charger(SIMU).valeurLivret(P, 1.55));
});

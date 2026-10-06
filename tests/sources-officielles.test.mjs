import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

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

test("serieDepuisCsvBce : série mensuelle (taux composé, base 365)", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce(lire("tests/donnees/bce_livrets.csv"));
  assert.deepEqual(simple(r.dates.map(jour)), [[2026, 6, 1], [2026, 7, 1], [2026, 8, 1]]);
  proche(r.valeurs[0], 100);
  proche(r.valeurs[1], 100 * 1.014 ** (30 / 365));
  proche(r.valeurs[2], r.valeurs[1] * 1.014 ** (31 / 365));
});

test("serieDepuisCsvBce : changement d'heure", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce("TIME_PERIOD,OBS_VALUE\n2026-03,1.5\n2026-04,1.5\n");
  proche(r.valeurs[1], 100 * 1.015 ** (31 / 365));
});

test("serieDepuisCsvBce : série quotidienne (€STR, intérêts simples, base 360)", () => {
  const r = charger(["js/outils.js"]).serieDepuisCsvBce("KEY,TIME_PERIOD,OBS_VALUE\nx,2026-10-01,2.0\nx,2026-10-02,\nx,2026-10-03,2.0\n");
  assert.equal(r.valeurs.length, 2);
  proche(r.valeurs[1], 100 * (1 + 2 / 100 * 2 / 360));
});

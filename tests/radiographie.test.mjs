// Radiographie du contrat : exposition cumulée, doublons, frais en euros.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

const SCRIPTS = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/inventaire.js", "js/style.js",
  "js/composition.js", "js/zones.js", "js/etats-unis.js", "js/marches.js", "js/fiche-auto.js", "js/alternatives.js", "js/radiographie.js"];

const ALT_T = { maj: "2026-10-20", indices: {
  "S&P 500": [
    ["G1", "FR0011111111", "AMUNDI PEA S&P 500", 0.15, 1, 1, "2025-01-01"],
    ["G2", "FR0022222222", "BNP S&P 500 UCITS ETF", 0.05, 0, 1, "2025-01-01"]
  ]
} };

function page() {
  const globales = { console, setTimeout, clearTimeout, ANNUAIRE: [], document: {}, ALTERNATIVES: ALT_T, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  const ctx = vm.createContext(globales);
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of SCRIPTS) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}
const c = page();
const ex = (cle, poids = 100) => ({ cle, poids });
const ent = (nom, cmpId, isin) => ({ source: "G", cmpId, nom, isins: [isin], etf: true, pays: "FR" });

test("repartitionsDeFonds : fonds 100 % usa", () => {
  const r = c.repartitionsDeFonds([ex("usa")]);
  assert.equal(r.zones.get("Amérique du Nord"), 100);
  assert.equal(r.classes.get("Actions"), 100);
  assert.equal(r.devises.get("USD"), 100);
});

test("cumulContrat : 60 000 € usa + 40 000 € oblig10", () => {
  const r = simple(c.cumulContrat([{ montant: 60000, expo: [ex("usa")] }, { montant: 40000, expo: [ex("oblig10")] }]));
  assert.deepEqual(r.zones, [{ nom: "Amérique du Nord", poids: 60 }, { nom: "Zone euro", poids: 40 }]);
  assert.deepEqual(r.classes, [{ nom: "Actions", poids: 60 }, { nom: "Obligations", poids: 40 }]);
  assert.equal(r.devises[0].nom, "USD");
});

test("cumulContrat : total 0 € sans NaN", () => {
  const r = simple(c.cumulContrat([{ montant: 0, expo: [ex("usa")] }]));
  assert.deepEqual(r, { zones: [], classes: [], devises: [] });
});

test("doublonsContrat : deux ETF S&P 500 (indice)", () => {
  const r = simple(c.doublonsContrat([
    { entree: ent("AMUNDI S&P 500", 1, "FR1"), montant: 1000, expo: [ex("usa")] },
    { entree: ent("BNP S&P 500 UCITS", 2, "FR2"), montant: 2000, expo: [ex("usa")] }]));
  assert.equal(r.memes.length, 1);
  assert.deepEqual(r.memes[0], { fonds: [0, 1], raison: "indice", montant: 3000 });
  assert.equal(r.proches.length, 0);
});

test("doublonsContrat : même fonds deux fois", () => {
  const r = simple(c.doublonsContrat([
    { entree: ent("FONDS MIXTE", 5, "FR5"), montant: 1000, expo: [ex("usa", 50), ex("oblig10", 50)] },
    { entree: ent("FONDS MIXTE", 5, "FR5B"), montant: 500, expo: [ex("usa", 50), ex("oblig10", 50)] }]));
  assert.equal(r.memes.length, 1);
  assert.equal(r.memes[0].raison, "fonds");
  assert.equal(r.memes[0].montant, 1500);
  assert.equal(r.proches.length, 0);
});

test("doublonsContrat : recouvrement 90 % -> proches ; 50/50 -> aucun", () => {
  const etf = { entree: ent("AMUNDI S&P 500", 1, "FR1"), montant: 1000, expo: [ex("usa")] };
  const actif = { entree: ent("FONDS ACTIF X", 9, "FR9"), montant: 1000, expo: [ex("usa", 90), ex("euro", 10)] };
  const r = simple(c.doublonsContrat([etf, actif]));
  assert.equal(r.memes.length, 0);
  assert.equal(r.proches.length, 1);
  assert.deepEqual(r.proches[0].fonds, [0, 1]);
  assert.equal(r.proches[0].recouvrement, 90);
  assert.equal(r.proches[0].montant, 2000);
  const moitie = { entree: ent("FONDS ACTIF Y", 8, "FR8"), montant: 1000, expo: [ex("usa", 50), ex("euro", 50)] };
  const r2 = simple(c.doublonsContrat([etf, moitie]));
  assert.equal(r2.proches.length, 0);
});

const A = (ter, terSource) => ({ ter, terSource });

test("fraisContrat : 10 000 € à 1,5 % = 150 €/an", () => {
  const r = simple(c.fraisContrat([{ entree: ent("FONDS ACTIF", 3, "FR3"), isin: "FR3", montant: 10000, A: A(1.5, "dic") }]));
  assert.equal(r.parFonds[0].frais, 1.5);
  assert.equal(r.parFonds[0].coutAnnuel, 150);
  assert.equal(r.totalAnnuel, 150);
  assert.equal(r.auMoins, false);
  assert.equal(r.inconnus, 0);
  assert.ok(r.cout10ans > 0);
});

test("fraisContrat : frais inconnu hors total, au moins", () => {
  const r = simple(c.fraisContrat([
    { entree: ent("FONDS ACTIF", 3, "FR3"), isin: "FR3", montant: 10000, A: A(1.5, "dic") },
    { entree: ent("FONDS INCONNU", 4, "FR4"), isin: "FR4", montant: 5000, A: A(2, "hypothese") }]));
  assert.equal(r.parFonds[1].frais, null);
  assert.equal(r.parFonds[1].coutAnnuel, null);
  assert.equal(r.totalAnnuel, 150);
  assert.equal(r.auMoins, true);
  assert.equal(r.inconnus, 1);
});

test("fraisContrat : tous inconnus -> total null ; total 0 € sans NaN", () => {
  const r = simple(c.fraisContrat([{ entree: ent("X", 4, "FR4"), isin: "FR4", montant: 5000, A: A(2, "hypothese") }]));
  assert.equal(r.totalAnnuel, null);
  assert.equal(r.cout10ans, null);
  const r0 = simple(c.fraisContrat([{ entree: ent("X", 4, "FR4"), isin: "FR4", montant: 0, A: A(1, "dic") }]));
  assert.equal(r0.totalAnnuel, 0);
  assert.equal(r0.cout10ans, 0);
  assert.equal(r0.parFonds[0].coutAnnuel, 0);
  assert.ok(!Number.isNaN(r0.totalAnnuel));
});

test("fraisContrat : ETF français sans DIC -> frais lus dans ALTERNATIVES", () => {
  const e = ent("AMUNDI PEA S&P 500", 1, "FR0011111111");
  const r = simple(c.fraisContrat([{ entree: e, isin: "FR0011111111", montant: 10000, A: A(2, "hypothese") }]));
  assert.equal(r.parFonds[0].frais, 0.15);
  assert.equal(r.parFonds[0].coutAnnuel, 15);
});

test("fraisContrat : alternative moins chère", () => {
  const e = ent("AMUNDI PEA S&P 500", 1, "FR0011111111");
  const r = simple(c.fraisContrat([{ entree: e, isin: "FR0011111111", montant: 10000, A: A(0.6, "dic") }]));
  const alt = r.parFonds[0].alternative;
  assert.equal(alt.cle, "G2");
  assert.equal(alt.frais, 0.05);
  assert.ok(Math.abs(alt.economieAnnuelle - 10000 * 0.55 / 100) < 1e-9);
});

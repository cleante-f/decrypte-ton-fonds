// Script de résumés des DIC (scripts/construire_resumes.mjs → data/resumes.js), lu par morceaux.
// Le réseau n'est jamais utilisé : lireDic est simulé.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidatsResumes, aLire, lireMorceau, fusionner, ecrire, garde } from "../scripts/construire_resumes.mjs";

const ligne = (cmpId, nom, isins, extra = {}) =>
  ["G", cmpId, cmpId, nom, extra.gest ?? "SOCIETE", "", extra.nature ?? "FCP", isins, "", "FR", "", "", "", 0, extra.pub ?? 1];
const A = ligne(1, "Fonds A", "FR0000000001 FR0000000011");
const B = ligne(2, "Fonds B", "FR0000000002");
const FCPE = ligne(3, "Fonds FCPE", "FR0000000003", { nature: "FCPE" });
const HSBC = ligne(4, "Fonds HSBC", "FR0000000004", { gest: "HSBC ASSET MANAGEMENT (FRANCE)" });
const PRIVE = ligne(5, "Fonds privé", "FR0000000005", { pub: 0 });
const SANS = ligne(6, "Fonds sans ISIN", "");
const ETF = ["E", 0, 0, "ETF coté", "", "", "", "LU0000000007", "", "LU", "ETF", "Paris", "EUR", 1, 1];

test("candidatsResumes : G publics avec ISIN, hors FCPE, HSBC, non publics ; ISIN de la première part", () => {
  const c = candidatsResumes([A, B, FCPE, HSBC, PRIVE, SANS, ETF, A]);
  assert.deepEqual(c.map(x => x.isin), ["FR0000000001", "FR0000000002"]);
  assert.deepEqual(c[0], { isin: "FR0000000001", nom: "Fonds A", cmpId: 1, prdId: 1 });
});

test("aLire : jamais lus d'abord, puis dateLecture croissante, plafonné", () => {
  const cand = ["a", "b", "c", "d"].map(isin => ({ isin }));
  const resumes = { fonds: { a: [1, 2, "", "", "", "2026-10-05"], b: [1, 2, "", "", "", "2026-09-01"], c: [1, 2, "", "", "", "2026-10-20"] } };
  assert.deepEqual(aLire(cand, resumes).map(x => x.isin), ["d", "b", "a", "c"]);
  assert.deepEqual(aLire(cand, resumes, 2).map(x => x.isin), ["d", "b"]);
  assert.deepEqual(aLire(cand, null, 2).map(x => x.isin), ["a", "b"]);
});

test("aLire : les essais ratés comptent comme tentés (jamais tentés d'abord, puis le plus ancien)", () => {
  const cand = ["a", "b", "c", "d"].map(isin => ({ isin }));
  const resumes = { fonds: { a: [1, 2, "", "", "", "2026-10-05"] }, essais: { b: "2026-10-21", c: "2026-09-01", a: "2026-10-20" } };
  assert.deepEqual(aLire(cand, resumes).map(x => x.isin), ["d", "c", "a", "b"]);
});

test("fusionner : essais ratés notés, effacés une fois lus, retirés si le fonds disparaît", () => {
  const ancien = { maj: "x", fonds: {}, essais: { A: "2026-09-01", B: "2026-09-01", Z: "2026-09-01" } };
  const r = fusionner(ancien, { A: [1, 1, "", "", "", "d"] }, "2026-10-22", ["A", "B", "C"], ["B", "C", "A"]);
  assert.deepEqual(r.essais, { B: "2026-10-22", C: "2026-10-22" });
});

test("lireMorceau : liste les échecs (illisible ou erreur)", async () => {
  const r = await lireMorceau([{ isin: "A" }, { isin: "B" }], async c => (c.isin === "A" ? null : { texte: DIC, date: "" }), { pause: 0 });
  assert.deepEqual(r.echecs, ["A"]);
});

const DIC = "Indicateur de risque 3 sur 7. Durée de détention recommandée : 5 ans. Frais de gestion et autres frais administratifs 1,20 %";

test("lireMorceau : lit, ignore les illisibles, propage la maintenance", async () => {
  const cand = [{ isin: "A", nom: "A" }, { isin: "B", nom: "B" }, { isin: "C", nom: "C" }];
  const lireDic = async c => { if (c.isin === "B") return null; if (c.isin === "C") throw new Error("boum"); return { texte: DIC, date: "2026-08-01" }; };
  const r = await lireMorceau(cand, lireDic, { pause: 0, aujourdhui: "2026-10-22" });
  assert.equal(r.tentes, 3);
  assert.deepEqual(Object.keys(r.lus), ["A"]);
  assert.equal(r.lus.A.length, 6);
  assert.equal(r.lus.A[4], "2026-08-01");
  assert.equal(r.lus.A[5], "2026-10-22");
  await assert.rejects(lireMorceau(cand, async () => { const e = new Error("418"); e.maintenance = true; throw e; }, { pause: 0 }), /418/);
});

test("fusionner : garde l'ancienne valeur si non relu, remplace si relu, retire les fonds disparus", () => {
  const ancien = { maj: "2026-09-01", fonds: { A: [1, 2, "", "", "", "d1"], B: [1, 3, "", "", "", "d1"], Z: [1, 1, "", "", "", "d1"] } };
  const nouveaux = { A: [9, 9, "", "", "", "d2"], C: [5, 5, "", "", "", "d2"] };
  const r = fusionner(ancien, nouveaux, "2026-10-22", ["A", "B", "C"]);
  assert.equal(r.maj, "2026-10-22");
  assert.deepEqual(Object.keys(r.fonds).sort(), ["A", "B", "C"]);
  assert.equal(r.fonds.A[0], 9);
  assert.equal(r.fonds.B[1], 3);
  assert.equal(fusionner(null, nouveaux, "m", ["A", "C"]).fonds.C[0], 5);
});

test("garde : moins de la moitié des fonds tentés lus → refus", () => {
  assert.equal(garde(10, 5), true);
  assert.equal(garde(10, 4), false);
  assert.equal(garde(0, 0), false);
});

test("ecrire : en-tête et un fonds par ligne, relisible comme RESUMES", () => {
  const dossier = mkdtempSync(join(tmpdir(), "resumes-"));
  try {
    const contenu = { maj: "2026-10-22", fonds: { FR0000000001: [1.2, 3, "5 ans", "Objectif « test »", "2026-08-01", "2026-10-22"], FR0000000002: [null, null, "", "", "", "2026-10-22"] }, essais: { FR0000000009: "2026-10-21" } };
    ecrire(contenu, dossier);
    const texte = readFileSync(join(dossier, "resumes.js"), "utf8");
    assert.ok(texte.startsWith("/* Généré par scripts/construire_resumes.mjs — ne pas modifier à la main."));
    const ctx = vm.createContext({});
    vm.runInContext(texte, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("RESUMES", ctx))), contenu);
    assert.equal(texte.split("\n").filter(l => l.includes("FR000000000")).length, 2);
  } finally { rmSync(dossier, { recursive: true }); }
});

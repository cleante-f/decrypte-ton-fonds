// Module partagé de lecture des DIC (scripts/lecture_dic.mjs) : résumé d'un DIC pour les pages de fonds.
// Les textes sont de vrais DIC lus avec pdf.js (Amundi PEA S&P 500 et BNP Paribas Easy S&P 500).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extraireDic, resumeDic, fraisCourants, choisirDocument, sectionDic, lireDicGeco } from "../scripts/lecture_dic.mjs";

const lire = f => readFileSync(new URL(`../tests/donnees/${f}`, import.meta.url), "utf8");

test("le module exporte les fonctions de lecture", () => {
  for (const f of [extraireDic, fraisCourants, choisirDocument, sectionDic, lireDicGeco]) assert.equal(typeof f, "function");
});

test("resumeDic : vrai DIC Amundi (frais 0,12 %, risque 4, 5 ans, objectif coupé)", () => {
  const r = resumeDic(extraireDic(lire("dic_amundi_pea_sp500.txt")));
  assert.equal(r.frais, 0.12);
  assert.equal(r.sri, 4);
  assert.equal(r.duree, "5 ans");
  assert.ok(r.objectif.length <= 300, `objectif de ${r.objectif.length} caractères`);
  assert.ok(r.objectif.startsWith("Le fonds est un OPCVM indiciel"));
  assert.ok(r.objectif.endsWith("…"));
  assert.ok(!/\s…$/.test(r.objectif));
});

test("resumeDic : vrai DIC BNP Paribas Easy (frais 0,14 %)", () => {
  const r = resumeDic(extraireDic(lire("dic_bnp_easy_sp500.txt")));
  assert.equal(r.frais, 0.14);
  assert.equal(r.sri, 4);
  assert.ok(r.objectif.length <= 300);
});

test("resumeDic : coupe à la fin d'une phrase si possible, sinon d'un mot", () => {
  const phrase1 = "Le fonds réplique l'indice " + "A".repeat(80) + ".";
  const long = phrase1 + " Deuxième phrase " + "mot ".repeat(80);
  const r = resumeDic({ objectif: long });
  assert.equal(r.objectif, phrase1 + "…");
  const sansPoint = resumeDic({ objectif: "mot ".repeat(200).trim() });
  assert.ok(sansPoint.objectif.length <= 300 && sansPoint.objectif.endsWith("mot…"));
});

test("resumeDic : objectif court gardé tel quel ; parties absentes → null, jamais undefined", () => {
  assert.equal(resumeDic({ objectif: "Court." }).objectif, "Court.");
  assert.deepEqual(resumeDic({}), { frais: null, sri: null, duree: null, objectif: null });
  assert.deepEqual(resumeDic(null), { frais: null, sri: null, duree: null, objectif: null });
  assert.equal(resumeDic({ sri: NaN }).sri, null);
});

test("lireDicGeco : le DIC de la part prime sur le prospectus du fonds ; sans DIC de part, documents du fonds", async () => {
  const dic = i => `Ce document fournit des informations essentielles. ${i} Indicateur de risque 3 sur 7`;
  const appels = [];
  const reel = globalThis.fetch;
  const rep = (corps) => ({ ok: true, status: 200, json: async () => corps, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    for (const [parts, attendu] of [
      [[{ isin: "FR1", documentEsEntities: [{ docTypeLib: "DIC", docName: "x", idInterne: 11, dateEffet: "2026-01-01" }] }], "/document/download/11"],
      [[{ isin: "FR1", documentEsEntities: [] }], "/document/byCompartAndProduct?compartCode=c5&prdCode=p6"]
    ]) {
      appels.length = 0;
      globalThis.fetch = async url => {
        appels.push(url.replace("https://geco.amf-france.org/back-office", ""));
        if (url.endsWith("/shares")) return rep(parts);
        if (url.includes("byCompartAndProduct")) return rep([{ docTypeLib: "Prospectus", docName: "p", idInterne: 22, dateEffet: "2026-01-01" }]);
        return rep(null);
      };
      await assert.rejects(lireDicGeco({ cmpId: 5, prdId: 6, isin: "FR1" }), /./);   // le faux PDF vide est invalide : on observe seulement les appels
      assert.equal(appels[0], "/funds/compartment/c5/shares");
      assert.ok(appels.includes(attendu), appels.join(" "));
      if (attendu.startsWith("/document/download")) assert.ok(!appels.some(a => a.includes("byCompartAndProduct")));
      else assert.ok(appels.includes("/document/download/22"));
    }
  } finally { globalThis.fetch = reel; }
});

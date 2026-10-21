// Script mensuel des frais des fonds indiciels (scripts/construire_alternatives.mjs → data/alternatives.js).
// Le texte de DIC est un vrai DIC : Amundi PEA S&P 500 UCITS ETF, part C-EUR (FR0011871128), lu avec pdf.js dans le prospectus
// publié sur GECO (document 435040, du 2026-08-06) : 0,12 % de frais de gestion, pas de coûts de transaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidats, fraisCourants, construire, ecrire, choisirDocument, sectionDic, extraireDic } from "../scripts/construire_alternatives.mjs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const DIC_SP500 = lire("tests/donnees/dic_amundi_pea_sp500.txt");

// Vraies lignes de data/annuaire.js (sauf HSBC et la ligne sans ISIN, inventées sur leur modèle)
const SP500 = ["G", 49843, 49843, "AMUNDI PEA S&P 500 UCITS ETF", "AMUNDI ASSET MANAGEMENT", "Actions internationales", "FCP", "FR0011871128 FR0011871136", "2014-04-17", "FR", "L8IP LYY1 PSP5 PSPH", "", "", 1, 1];
const LEVIER = ["G", 1, 1, "AMUNDI CAC 40 DAILY (2X) LEVERAGED UCITS ETF", "AMUNDI ASSET MANAGEMENT", "", "FCP", "FR0010592014", "", "FR", "", "", "", 1, 1];
const NON_PUBLIC = ["G", 2, 2, "ERES SELECTION S&P 500", "ERES GESTION", "", "FCPE", "990000111111", "", "FR", "", "", "", 0, 0];
const ETRANGER = ["E", 0, 0, "Amundi MSCI World Swap UCITS ETF EUR Acc", "", "", "", "LU1681043599", "", "LU", "AMEW", "Paris", "EUR", 1, 1];
const HSBC = ["G", 3, 3, "HSBC MSCI WORLD", "HSBC ASSET MANAGEMENT (FRANCE)", "", "FCP", "FR0000000003", "", "FR", "", "", "", 0, 1];
const SANS_ISIN = ["G", 4, 4, "FONDS MSCI WORLD SANS ISIN", "SOCIETE", "", "FCP", "", "", "FR", "", "", "", 0, 1];
const ACTIF = ["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1];

test("fraisCourants : vrai DIC Amundi PEA S&P 500 (0,12 %)", () => {
  const dic = extraireDic(DIC_SP500);
  assert.equal(dic.gestion, 0.12);
  assert.equal(fraisCourants(dic), 0.12);
  assert.equal(fraisCourants({ gestion: 0.1, transaction: 0.02 }), 0.12);   // arrondi : pas de 0,12000000000000001
  assert.equal(fraisCourants({ gestion: null, transaction: 0.02 }), null);
  assert.equal(fraisCourants(null), null);
});

// Vrai DIC de BNP Paribas Easy S&P 500 UCITS ETF, part FR0011550177 (prospectus GECO 410664, du 2026-04-16) : le pourcentage des
// frais de gestion (0,14 %) précède son libellé, et la page 1 parle d'un écart de suivi « inférieur à 1% » après « frais de gestion »
test("fraisCourants : vrai DIC BNP Paribas Easy S&P 500 (0,14 %, pourcentage avant le libellé)", () => {
  const dic = extraireDic(lire("tests/donnees/dic_bnp_easy_sp500.txt"));
  assert.equal(fraisCourants(dic), 0.14);
});

test("candidats : fonds GECO publics avec ISIN, indice connu, sans levier ni HSBC", () => {
  const c = candidats([SP500, LEVIER, NON_PUBLIC, ETRANGER, HSBC, SANS_ISIN, ACTIF]);
  assert.equal(c.length, 1);
  assert.deepEqual({ ...c[0] }, { cle: "FR0011871128", isin: "FR0011871128", nom: "AMUNDI PEA S&P 500 UCITS ETF", indice: "S&P 500", cmpId: 49843, prdId: 49843, pea: 1, etf: 1 });
});

test("sectionDic : DIC de la part demandée dans un prospectus qui en regroupe plusieurs", () => {
  const pages = DIC_SP500.trim().split("\n");
  assert.equal(pages.length, 3);
  const couverte = pages.map(p => p.replace(/FR0011871128/g, "FR0011871136").replace(/0,12%/g, "0,15%"));
  const prospectus = [...couverte, ...pages, "Page 1 Amundi PEA S&P 500 UCITS ETF PROSPECTUS", "Page 2 FR0011871128 FR0011871136"];
  assert.equal(fraisCourants(extraireDic(sectionDic(prospectus, "FR0011871128"))), 0.12);
  assert.equal(fraisCourants(extraireDic(sectionDic(prospectus, "FR0011871136"))), 0.15);
  assert.equal(sectionDic(prospectus, "FR0000000000"), null);          // plusieurs DIC, aucun pour cette part
  assert.equal(fraisCourants(extraireDic(sectionDic(pages, "FR0000000000"))), 0.12);   // un seul DIC : c'est le bon
  assert.equal(sectionDic(["Rapport annuel", "Bilan"], "FR0011871128"), null);
  // Titre répété en haut de chaque page (DIC de BNP Paribas) : toujours un seul DIC de 3 pages
  const titres = pages.map((p, i) => i ? "DOCUMENT D’INFORMATIONS CLÉS " + p : p);
  assert.equal(sectionDic(titres, "FR0011871128").trim().split("\n").length, 3);
});

test("choisirDocument : DIC le plus récent (celui de la part d'abord), sinon prospectus", () => {
  // Vrais documents GECO du fonds c49843 (byCompartAndProduct, 2026-10-21) : pas de DIC, le prospectus le contient
  const docs = [
    { idInterne: 115225, docName: "20210724T123228556Z_CA-FR0011871136-Z-20210331-FR.pdf", docTypeLib: "Comptes Annuels", dateEffet: "2021-03-31" },
    { idInterne: 369509, docName: "Rapport Annuel.PDF", docTypeLib: "Rapport annuel et semestriel", dateEffet: "2025-03-31" },
    { idInterne: 435040, docName: "Propectus.PDF", docTypeLib: "Prospectus", dateEffet: "2026-08-06" }
  ];
  assert.equal(choisirDocument(docs, "FR0011871128").idInterne, 435040);
  const dics = [
    { idInterne: 1, docName: "SHARE_KIID_FR001400CPO4_fr_FR_20261001.pdf", docTypeLib: "DIC PRIIPS toutes opérations", dateEffet: "2026-10-01" },
    { idInterne: 2, docName: "SHARE_KIID_FR001400CPP1_fr_FR_20261001.pdf", docTypeLib: "DIC PRIIPS toutes opérations", dateEffet: "2026-10-01" },
    { idInterne: 3, docName: "KIDDOC-2024-03-15_Action_M_EUR.pdf", docTypeLib: "DICI", dateEffet: "2025-04-30" }
  ];
  assert.equal(choisirDocument(docs.concat(dics), "FR001400CPP1").idInterne, 2);
  assert.equal(choisirDocument(docs.concat(dics), "FR0000000000").idInterne, 1);
  assert.equal(choisirDocument(docs.slice(0, 2), "FR0011871128"), null);
});

test("construire : une entrée par fonds, triée par frais, fonds sans frais écarté", async () => {
  const BNP = ["G", 48420, 48169, "BNP PARIBAS EASY S&P 500 UCITS ETF", "BNP PARIBAS ASSET MANAGEMENT Europe", "Actions internationales", "SICAV", "FR0011550177 FR0011550185 FR0011550680 FR0013041530", "2013-08-02", "FR", "", "", "", 1, 1];
  const SANS_FRAIS = ["G", 60002, 60002, "FONDS S&P 500 SANS FRAIS LISIBLES", "SOCIETE", "", "FCP", "FR0099999999", "", "FR", "", "", "", 0, 1];   // inventé
  const textes = {
    FR0011871128: DIC_SP500,
    FR0011550177: DIC_SP500.replace(/0,12%/g, "0,03%"),   // frais inventés, plus bas que ceux d'Amundi
    FR0099999999: "Document d'informations clés sans les coûts"
  };
  const lus = [];
  const lireDic = async c => { lus.push(c.cle); return textes[c.cle] ? { texte: textes[c.cle], date: "2026-08-06" } : null; };
  const { indices } = await construire([SP500, BNP, SANS_FRAIS, SP500, ACTIF], lireDic);
  assert.deepEqual(lus, ["FR0011871128", "FR0011550177", "FR0099999999"]);   // la ligne en double n'est lue qu'une fois
  assert.deepEqual(Object.keys(indices), ["S&P 500"]);
  assert.deepEqual(indices["S&P 500"].map(l => [...l]), [
    ["FR0011550177", "FR0011550177", "BNP PARIBAS EASY S&P 500 UCITS ETF", 0.03, 0, 1, "2026-08-06"],
    ["FR0011871128", "FR0011871128", "AMUNDI PEA S&P 500 UCITS ETF", 0.12, 1, 1, "2026-08-06"]
  ]);
});

test("construire : la maintenance de GECO (HTTP 418) arrête tout, une autre erreur écarte seulement le fonds", async () => {
  const maintenance = Object.assign(new Error("GECO en maintenance"), { maintenance: true });
  await assert.rejects(construire([SP500], async () => { throw maintenance; }), /maintenance/);
  const { indices } = await construire([SP500], async () => { throw new Error("PDF illisible"); });
  assert.deepEqual(indices, {});
});

test("ecrire : en-tête, constante ALTERNATIVES lisible par le site", () => {
  const dossier = mkdtempSync(join(tmpdir(), "alternatives-"));
  try {
    const contenu = { maj: "2026-10-21", indices: { "S&P 500": [
      ["FR0011550185", "FR0011550185", "BNP PARIBAS EASY S&P 500 UCITS ETF", 0.03, 0, 1, "2026-08-06"],
      ["FR0011871128", "FR0011871128", "AMUNDI PEA S&P 500 UCITS ETF", 0.12, 1, 1, "2026-08-06"]
    ] } };
    ecrire(contenu, dossier);
    const texte = readFileSync(join(dossier, "alternatives.js"), "utf8");
    assert.ok(texte.startsWith("/* Généré par scripts/construire_alternatives.mjs — ne pas modifier à la main.\n * Source : AMF – DIC (base GECO). */\n"));
    const ctx = vm.createContext({});
    vm.runInContext(texte, ctx);
    const alt = vm.runInContext("ALTERNATIVES", ctx);
    assert.equal(alt.maj, "2026-10-21");
    assert.equal(alt.indices["S&P 500"][0][3], 0.03);
    assert.deepEqual(JSON.parse(JSON.stringify(alt)), contenu);
  } finally { rmSync(dossier, { recursive: true }); }
});

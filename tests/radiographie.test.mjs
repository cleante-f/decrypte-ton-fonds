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

// ---------- Onglet « Mon contrat » du simulateur (page simulée, sans réseau) ----------

// Objet qui accepte tout (propriété, appel, affectation) : les éléments de la page que les tests n'examinent pas
function faux() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : faux()),
    set: () => true,
    apply: () => faux()
  });
}
const SCRIPTS_SIMU = ["js/mode-site.js", "js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js",
  "js/inventaire.js", "js/style.js", "js/alternatives.js", "js/radiographie.js", "js/composition.js", "js/affichage.js", "js/marches.js",
  "js/fiche-auto.js", "js/projection.js", "js/contexte-fonds.js", "js/graphiques-simu.js", "js/nav.js", "js/simulateur.js"];

function pageSimu() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Proxy({ innerHTML: "", textContent: "", value: "", hidden: false }, {
      get: (t, k) => (k in t ? t[k] : faux()), set: (t, k, v) => { t[k] = v; return true; } }));
    return elements.get(id);
  };
  const document = new Proxy({}, {
    get: (t, k) => (k === "getElementById" ? element : k === "createElement" ? () => ({}) : k === "querySelectorAll" ? () => [] : faux())
  });
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, document, ANNUAIRE: [], ALTERNATIVES: ALT_T,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hostname: "cleante-f.github.io", hash: "", search: "" }, history: { replaceState() {} }, URLSearchParams,
    fetch: async () => { throw new Error("réseau coupé"); }, alert() {} });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.element = element;
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of SCRIPTS_SIMU) vm.runInContext(lire(f), ctx, { filename: f });
  // Fonds de test : la clé est l'ISIN ; analyses factices (aucun réseau). « FRECHEC » ne se charge pas.
  vm.runInContext(`
    const FONDS_TEST = {
      FR0011111111: { source: "G", cmpId: 1, nom: "AMUNDI PEA S&P 500", isins: ["FR0011111111"], etf: true, pays: "FR" },
      FR0033333333: { source: "G", cmpId: 3, nom: "FONDS OBLIGATIONS EURO", isins: ["FR0033333333"], pays: "FR" },
      FRECHEC: { source: "G", cmpId: 7, nom: "FONDS EN PANNE", isins: ["FRECHEC"], pays: "FR" }
    };
    var chargements = 0, enParallele = 0, maxParallele = 0;
    entreeParCle = async cle => FONDS_TEST[cle] || { source: "G", cmpId: 100 + cle.length, nom: "FONDS " + cle, isins: [cle], pays: "FR" };
    chargerAnalyse = async (entree, isin) => {
      chargements++; enParallele++; maxParallele = Math.max(maxParallele, enParallele);
      await new Promise(ok => setTimeout(ok, 5));
      enParallele--;
      if (isin === "FRECHEC") throw new Error("données indisponibles");
      const oblig = isin === "FR0033333333";
      return { entree, isin, nom: entree.nom, expo: [{ cle: oblig ? "oblig10" : "usa", poids: 100 }], ter: oblig ? 1.2 : 0.6, terSource: "dic" };
    };`, ctx);
  return ctx;
}
const sans = html => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

test("simulateur : MODES contient l'onglet « Mon contrat » avec ses textes", () => {
  const ctx = pageSimu();
  const m = vm.runInContext("MODES", ctx).find(x => x.cle === "contrat");
  assert.ok(m, "mode contrat");
  assert.equal(m.nom, "Mon contrat");
  assert.equal(m.titre, "Radiographie de mon contrat");
  assert.equal(m.texte, "Tes fonds et leurs montants : exposition cumulée, doublons, frais en euros.");
  assert.deepEqual(simple(vm.runInContext("S.contrat", ctx)), { lignes: [], calc: null, enCours: false });
});

test("simulateur, contrat : 15 fonds au plus, le 16e est refusé", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  for (let i = 0; i < 16; i++) await ctx.ajouterFonds("contrat", "FR00000000" + String(i).padStart(2, "0"));
  assert.equal(S.contrat.lignes.length, 15);
  assert.equal(S.contrat.lignes[0].montant, 0);
  const html = sans(ctx.panneauContrat());
  assert.ok(html.includes("15 fonds au plus"), html);
  assert.ok(!ctx.panneauContrat().includes('data-recherche-fonds="contrat"'), "plus de champ d'ajout à 15 fonds");
});

test("simulateur, contrat : 2 fonds analysés et un fonds en échec -> exposition, doublons, frais, non analysé", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  for (const [cle, montant] of [["FR0011111111", 60000], ["FR0033333333", 40000], ["FRECHEC", 5000], ["FR0011111111", 0]]) {
    await ctx.ajouterFonds("contrat", cle);
    S.contrat.lignes.at(-1).montant = montant;
  }
  const attente = ctx.analyserContrat();
  assert.ok(sans(ctx.panneauContrat()).includes("fonds 1 sur 3…"), "progression");
  await attente;
  assert.equal(vm.runInContext("chargements", ctx), 3, "la ligne à 0 € n'est pas chargée");
  assert.ok(vm.runInContext("maxParallele", ctx) <= 3);
  const calc = S.contrat.calc;
  assert.equal(calc.totalAnalyse, 100000);
  assert.equal(calc.montantNonAnalyse, 5000);
  const html = sans(ctx.panneauContrat());
  assert.ok(html.includes("Radiographie de mon contrat"));
  assert.ok(html.includes("Exposition cumulée"));
  assert.ok(html.includes("Amérique du Nord") && html.includes("60,0 %") && html.includes("Zone euro") && html.includes("40,0 %"), html);
  assert.ok(html.includes("Amérique du Nord : 60 % du contrat"), "alerte au-delà du seuil d'un pays (50 %)");
  assert.ok(html.includes("Doublons"));
  assert.ok(html.includes("Aucun doublon repéré"));
  assert.ok(html.includes("360 € par an"), "60 000 € à 0,6 %");
  assert.ok(html.includes("480 € par an"), "40 000 € à 1,2 %");
  assert.ok(html.includes("840 € par an"), "total");
  assert.ok(html.includes("Une alternative à 0,05 % existe : −330 € par an"), html);
  assert.ok(html.includes("FONDS EN PANNE") && html.includes("non analysé"));
  assert.ok(html.includes("Non analysé : 5 000 €"), html);
  assert.ok(html.includes("Analyse pédagogique : ce n'est pas un conseil en investissement."));
  assert.ok(!/NaN|undefined/.test(html));
});

test("simulateur, contrat : même fonds deux fois -> doublon ; fonds sans exposition -> « non classé »", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  for (const [cle, montant] of [["FR0011111111", 1000], ["FR0011111111", 1000], ["FRVIDE00", 2000]]) {
    await ctx.ajouterFonds("contrat", cle);
    S.contrat.lignes.at(-1).montant = montant;
  }
  vm.runInContext(`const ancien = chargerAnalyse; chargerAnalyse = async (e, i) => i === "FRVIDE00" ? { entree: e, isin: i, nom: e.nom, expo: [], ter: 1, terSource: "hypothese" } : ancien(e, i);`, ctx);
  await ctx.analyserContrat();
  const html = sans(ctx.panneauContrat());
  assert.ok(html.includes("Ces fonds font en grande partie la même chose."));
  assert.ok(html.includes("Même indice ou même fonds"));
  assert.ok(html.includes("non classé") && html.includes("50,0 %"), html);
  assert.ok(html.includes("frais inconnus"));
  assert.ok(html.includes("au moins"));
});

test("simulateur, contrat : total 0 € -> « Indique au moins un montant », aucun chargement", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  await ctx.ajouterFonds("contrat", "FR0011111111");
  await ctx.analyserContrat();
  assert.equal(vm.runInContext("chargements", ctx), 0);
  const html = sans(ctx.panneauContrat());
  assert.ok(html.includes("Indique au moins un montant"), html);
  assert.ok(!/NaN/.test(html));
});

test("simulateur, contrat : enregistrement et relecture d'un contrat de 2 lignes", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  for (const [cle, montant] of [["FR0011111111", 12000], ["FR0033333333", 3000]]) {
    await ctx.ajouterFonds("contrat", cle);
    S.contrat.lignes.at(-1).montant = montant;
  }
  const etat = simple(ctx.etatCourant());
  assert.deepEqual(etat.contrat, [{ fonds: "FR0011111111", montant: 12000 }, { fonds: "FR0033333333", montant: 3000 }]);
  const ctx2 = pageSimu();
  const S2 = vm.runInContext("S", ctx2);
  S2.mode = "contrat";
  S2.restauration = etat;
  await ctx2.restaurerExtras(null);
  assert.deepEqual(simple(S2.contrat.lignes.map(l => [cleEntreeDe(ctx2, l), l.montant])), [["FR0011111111", 12000], ["FR0033333333", 3000]]);
  assert.equal(S2.restauration, null);
});
const cleEntreeDe = (ctx, l) => ctx.cleEntree(l.entree, l.isin);

test("simulateur, contrat : lignes figées pendant le chargement ; une ligne jamais tentée n'est pas « non analysé »", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  await ctx.ajouterFonds("contrat", "FR0011111111");
  S.contrat.lignes[0].montant = 1000;
  const attente = ctx.analyserContrat();
  const pendant = ctx.panneauContrat();
  assert.ok(/data-montant="0" disabled/.test(pendant), "montant figé");
  assert.ok(/data-retirer-contrat="0" disabled/.test(pendant), "retrait figé");
  assert.ok(!pendant.includes('data-recherche-fonds="contrat"'), "pas d'ajout pendant le chargement");
  await ctx.ajouterFonds("contrat", "FR0033333333");
  assert.equal(S.contrat.lignes.length, 1, "ajout refusé pendant le chargement");
  await attente;
  assert.ok(!/data-montant="0" disabled/.test(ctx.panneauContrat()), "lignes réactivées à la fin");
  // Une ligne avec un montant mais jamais chargée : « pas encore analysé », jamais « non analysé »
  await ctx.ajouterFonds("contrat", "FR0033333333");
  S.contrat.lignes[1].montant = 500;
  const R = ctx.calculContrat(S.contrat.lignes);
  assert.equal(R.nonAnalyses.length, 0);
  assert.equal(R.montantNonAnalyse, 0);
  S.contrat.calc = R;
  const html = sans(ctx.panneauContrat());
  assert.ok(html.includes("Pas encore analysé : FONDS OBLIGATIONS EURO"), html);
  assert.ok(!html.includes("Non analysé"));
});

test("simulateur, contrat : nom de fonds avec du HTML échappé", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  vm.runInContext(`FONDS_TEST.FRHTML = { source: "G", cmpId: 9, nom: "<img src=x onerror=alert(1)>", isins: ["FRHTML"], pays: "FR" };`, ctx);
  await ctx.ajouterFonds("contrat", "FRHTML");
  S.contrat.lignes[0].montant = 1000;
  await ctx.analyserContrat();
  const html = ctx.panneauContrat();
  assert.ok(!html.includes("<img"), "aucune balise injectée");
  assert.ok(html.includes("&lt;img"));
});

test("simulateur, contrat : simulation enregistrée sans « contrat » (ancienne) relue sans erreur", async () => {
  const ctx = pageSimu();
  const S = vm.runInContext("S", ctx);
  S.mode = "contrat";
  S.restauration = { plan: {}, mode: "contrat", comparaisons: [], portefeuille: [] };
  await ctx.restaurerExtras(null);
  assert.equal(S.contrat.lignes.length, 0);
  assert.equal(S.restauration, null);
  assert.ok(sans(ctx.panneauContrat()).includes("Radiographie de mon contrat"));
});

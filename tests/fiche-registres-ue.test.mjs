// Registre européen de l'ESMA sur le site : fiche d'un fonds européen du registre (source R), lignes de l'ESMA sur les fiches
// des fonds européens déjà présents, alertes du registre, ouverture dans les trois outils (Décrypte, Performances, Simulateur).
// Les données de test sont de vraies lignes de data/annuaire-registres-ue.js, data/registres-ue-infos.js, data/identite.js et data/firds.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";

process.env.TZ = "Europe/Paris";   // les dates s'affichent en heure de Paris

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

// Exécute un script dans une page simulée. Chaque page compile sa propre copie du texte (commentaire final différent) : sinon V8 partage
// ses informations d'exécution entre deux pages simulées qui exécutent le même texte, et une constante globale déclarée plus tard dans l'une
// (REGISTRES_UE_INFOS, chargée à la demande) peut être lue au mauvais endroit dans l'autre, ce qui rend les tests dépendants de leur ordre.
let numeroPage = 0;
const executer = (ctx, texte, filename) => vm.runInContext(`${texte}\n// page simulée ${++numeroPage}`, ctx, { filename });

// ---------- Exemples réels ----------

// Zone « registres-ue » : ["R", id, id, nom, société, "", cadre, "", "", pays, "", "", "", étf, public]
const GAM = ["R", 90728, 90728, "GAM Star Absolute Return Macro", "GAM Fund Management Limited", "", "OPCVM (UCITS)", "", "", "IE", "", "", "", 0, 1];
const QUAESTIO = ["R", 2103248, 2103248, "Quaestio Alternative Funds - Fund One", "Quaestio Capital Sgr S.P.A.", "", "FIA", "", "", "LU", "", "", "", 0, 0];
const QUAESTIO_POINT = ["R", 2103246, 2103246, "Quaestio Alternative Funds ¿ Diversified Yield Fund", "Quaestio Capital Sgr S.P.A.", "", "FIA", "", "", "LU", "", "", "", 0, 0];
const ELTIF = ["R", 2803579, 2803579, "AC ONE PLANET ELTIF-Compartiment virtuel pour OPC classique", "Alter Domus Management Company S.A.", "", "ELTIF", "", "", "LU", "", "", "", 0, 0];
const EUVECA = ["R", 2758123, 2758123, "ALSA VENTURES I SCSP-Compartiment virtuel d'un véhicule classique", "Gen II Management Company (Luxembourg) SARL", "", "EuVECA", "", "", "LU", "", "", "", 0, 0];
const PARAPLUIE = ["R", 2226841, 2226841, "1618 Investment Funds-World Equity", "Fundsight S.A.", "", "OPCVM (UCITS)", "", "", "LU", "", "", "", 0, 1];
// REGISTRES_UE_INFOS : [LEI, pays de l'autorité, pays de commercialisation, politique BCE, tranche BCE, fonds parapluie]
const INFOS_T = {
  90728: ["", "IE", "AT DE ES FR", "", 0, ""],
  2103248: ["5493007K0QZ754GJIS61", "IT", "LU", "M", 8, ""],
  2103246: ["54930037VM06T2XYAY51", "IT", "LU", "M", 5, ""],
  2803579: ["5299001427UJB27M7X21", "LU", "LU LU AT AT LI LI DE DE", "N", 5, ""],
  2758123: ["254900WJ6LGWEIKPVU96", "LU", "AT BE CZ DE DK ES FI FR GR IE IT LI LU NL PT SE", "X", 4, ""],
  2226841: ["5493003AB6BX42CT8Q55", "LU", "FR", "A", 3, "1618 Investment Funds"]
};

// Fonds européens de l'annuaire (data/annuaire.js)
const AMUNDI = ["E", 0, 0, "Amundi MSCI World Swap UCITS ETF EUR Acc", "", "", "", "LU1681043599", "", "LU", "AMEW AMEX CW8", "ETF Plus, Paris, Xetra", "EUR", 1, 1];
const JPMORGAN = ["N", 40468, 0, "JPMORGAN FUNDS - GREATER CHINA FUND", "JPMORGAN ASSET MANAGEMENT (EUROPE) S.A.R.L.", "", "", "LU0522352946 LU0117841782 LU0210526801", "2009-11-17", "LU", "", "", "", 0, 1];
const SOLYS = ["N", 100127, 0, "SOLYS - AMPLEGEST PRICING POWER TRANSATLANTIC", "Société Générale Investment Solutions (France)", "", "", "", "2024-03-28", "LU", "", "", "", 0, 1];
const CARMIGNAC = ["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1];
const VANGUARD = ["S", 2839, 2839, "Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS", "", "", "", "", "US", "VFINX VFIAX VOO VFFSX", "", "USD", 1, 1];

// data/identite.js (réduit) : noms[0] = Amundi Luxembourg S.A., noms[1] = JPMorgan…, noms[2] = Sg 29 Haussmann (index réels 24, 12 et 1336)
// Seul « DK » est inventé : l'autorité danoise est absente des vraies données (comme l'italienne), et c'est ce cas qu'il faut couvrir
const IDENTITE_T = {
  maj: "2026-10-11", esma: "2026-10-11", bce: "2026-07-31", gleif: "2026-10-11", fitrs: 2025,
  noms: ["Amundi Luxembourg S.A.", "JPMorgan Asset Management (Europe) S.À R.L.", "Sg 29 Haussmann"],
  fonds: { "5493003BFED2MWDBYH64": [0, -1, "A", 1, 1, 8, "2018-04-17", -1] },
  liquidite: {},
  notifFR: ["5493003BFED2MWDBYH64"],
  autorites: { FR: "Autorité des Marchés Financiers (AMF)", IE: "Central Bank of Ireland (CBI)", LU: "Commission de Surveillance du Secteur Financier (CSSF)" },
  esmaFonds: {
    "5493003BFED2MWDBYH64": [0, "LU", "UCITS", "FR IT NL FI SE ES AT DE IE PT DK NO"],
    "N7JU0O8IYXVVDVQIBX41": [1, "LU", "UCITS", "IE SE NL AT DE ES NO FI FR BE PT IT GR DK PL HU LI CZ SK CY"],   // un vrai LEI qui commence par N
    "N100127": [2, "LU", "UCITS", "FR CZ"],                                                                       // fonds GECO sans ISIN
    "529900DKDKDKDKDKDK00": [-1, "DK", "AIF", "DK SE"]
  }
};
const FIRDS_T = { maj: "2026-10-01", parNom: [], places: {}, fonds: {
  LU1681043599: ["5493003BFED2MWDBYH64", "EUR", [], 0],
  LU0117841782: ["N7JU0O8IYXVVDVQIBX41", "USD", [], 0],
  XS0000000001: ["529900DKDKDKDKDKDK00", "EUR", [], 0] } };

// ---------- Page simulée ----------

const SCRIPTS = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/inventaire.js", "js/style.js",
  "js/composition.js", "js/zones.js", "js/etats-unis.js", "js/marches.js", "js/fiche-auto.js"];
// Options : infos (REGISTRES_UE_INFOS), identite (IDENTITE), firds (FIRDS) ; `undefined` donné explicitement = données absentes
function page(options = {}) {
  const { infos, identite, firds } = { infos: INFOS_T, identite: IDENTITE_T, firds: FIRDS_T, ...options };
  const stockage = new Map();
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: k => stockage.delete(k), get length() { return stockage.size; }, key: i => [...stockage.keys()][i] };
  const globales = { console, setTimeout, clearTimeout, localStorage, ANNUAIRE: [], document: {} };
  if (infos !== undefined) globales.REGISTRES_UE_INFOS = infos;   // undefined : le fichier n'est pas chargé
  if (identite !== undefined) globales.IDENTITE = identite;
  if (firds !== undefined) globales.FIRDS = firds;
  const ctx = vm.createContext(globales);
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of SCRIPTS) executer(ctx, lire(f), f);
  vm.runInContext(`ANNUAIRE_ZONES["registres-ue"] = { maj: "2026-10-11", lignes: [] };`, ctx);
  return ctx;
}
const fiche = (ctx, e, isin, d = { erreurs: [], composition: { fini: true, c: null } }, chargement = false) => ctx.afficherFicheAuto(e, isin, d, chargement);
const nb = (texte, motif) => texte.split(motif).length - 1;

// ---------- Fiche R : OPCVM irlandais ----------

test("fiche R (GAM, OPCVM irlandais)", () => {
  const ctx = page();
  const e = ctx.lireEntree(GAM);
  const html = fiche(ctx, e, undefined);
  for (const attendu of ["Central Bank of Ireland (CBI), Irlande", "France, Autriche, Allemagne, Espagne", "(4 pays)", "OPCVM (UCITS)",
    "https://registers.centralbank.ie/", "Vérifier l'agrément sur le registre de la Banque centrale d'Irlande", "pas d'ISIN connu",
    "Aucune part de ce fonds n'est cotée en bourse dans l'Union européenne d'après les registres publics",
    "ESMA – registre de la commercialisation transfrontière", "GAM Fund Management Limited", "<h1>GAM Star Absolute Return Macro</h1>",
    'data-terme="autorite_controle"', 'data-terme="fia"', 'data-terme="commercialisation">Commercialisé dans',
    "Notifié pour la commercialisation en France (registre européen)", 'href="simulateur.html#R90728"', 'href="performances.html#R90728"']) {
    assert.ok(html.includes(attendu), attendu);
  }
  assert.ok(!html.includes("Fonds de droit non européen"));
  assert.ok(!html.includes("Fonds non notifié pour la France"));
  assert.ok(!html.includes("Fonds absent de la liste"));
  assert.ok(!html.includes("ISIN non publié"));
  assert.ok(!html.includes("Forme juridique"), "le cadre est dans « Type (registre européen) », pas une forme juridique");
  assert.ok(!html.includes("(CBI) (Irlande)"), "le pays est séparé du nom de l'autorité par une virgule");
  assert.ok(!html.includes("undefined") && !html.includes("null") && !html.includes("NaN"));
  // la citation de l'ESMA, une seule fois, avec la date de la zone (annuaire) ; pas de BCE ni de GLEIF : le registre n'en donne rien pour ce fonds
  assert.equal(nb(html, "Source : ESMA – registre de la commercialisation transfrontière des OPCVM et FIA (réutilisation autorisée en citant la source) · données du 11/10/2026"), 1);
  assert.ok(!html.includes("BCE – liste") && !html.includes("GLEIF"));
  // pas de LEI, pas de politique ni d'encours
  assert.ok(!html.includes("Identifiant LEI") && !html.includes("Encours") && !html.includes("Politique d"));
  // alertes
  const pieges = simple(ctx.detecterPiegesAuto(e, null));
  const info = pieges.find(p => p.titre.startsWith("Notifié pour la commercialisation en France"));
  assert.ok(info && info.niveau === "info" && info.terme === "commercialisation");
  assert.ok(!pieges.some(p => /Fonds de droit non européen/.test(p.titre)));
  assert.ok(!pieges.some(p => p.titre === "Fonds réservé"));
  assert.ok(pieges.every(p => p.niveau === "info"), "OPCVM notifié : aucune alerte, seulement des informations");
});

test("fiche R : la fiche pendant le chargement des informations, puis sans exception", () => {
  const ctx = page({ infos: undefined });
  const e = ctx.lireEntree(GAM);
  const html = fiche(ctx, e, undefined, null, true);
  assert.ok(html.includes("<h1>GAM Star Absolute Return Macro</h1>") && html.includes("pas d'ISIN connu"));
  assert.ok(!html.includes("Fonds non notifié pour la France"), "pas d'alerte avant d'avoir lu les pays");
});

// ---------- Fiche R : FIA luxembourgeois d'un gérant italien ----------

test("fiche R (Quaestio, FIA)", () => {
  const ctx = page();
  const e = ctx.lireEntree(QUAESTIO);
  const html = fiche(ctx, e, undefined);
  assert.ok(html.includes("Réservé aux investisseurs professionnels"));
  assert.ok(html.includes("Fonds non notifié pour la France"));
  assert.ok(!html.includes("Notifié pour la commercialisation en France"));
  assert.ok(!html.includes(">Fonds réservé<"), "pas d'information générique « Fonds réservé » pour un fonds du registre");
  const pieges = simple(ctx.detecterPiegesAuto(e, null));
  const pro = pieges.find(p => p.titre === "Réservé aux investisseurs professionnels");
  assert.ok(pro && pro.niveau === "attention" && pro.terme === "fia");
  const nonNotifie = pieges.find(p => p.titre === "Fonds non notifié pour la France");
  assert.ok(nonNotifie && nonNotifie.niveau === "attention" && nonNotifie.terme === "commercialisation");
  assert.ok(!pieges.some(p => p.titre === "Fonds réservé"));
  // identité : l'autorité italienne n'est pas dans IDENTITE.autorites, donc le pays seul ; type FIA ; LEI ; politique et encours de la BCE
  assert.match(html, /data-terme="autorite_controle">Autorité de contrôle<\/button><\/dt><dd>Italie<\/dd>/);
  assert.match(html, /data-terme="fia">Type \(registre européen\)<\/button><\/dt><dd>FIA<\/dd>/);
  assert.match(html, /data-terme="commercialisation">Commercialisé dans<\/button><\/dt><dd>Luxembourg \(1 pays\)<\/dd>/);
  for (const attendu of ["5493007K0QZ754GJIS61", "actions et obligations (fonds mixte)", "plus de 5 milliards d'euros", "31/07/2026",
    "BCE – liste des fonds d&#39;investissement de la zone euro", "Quaestio Capital Sgr S.P.A."]) assert.ok(html.includes(attendu), attendu);
  assert.ok(!html.includes("registers.centralbank.ie"), "fonds luxembourgeois : pas de lien vers la banque centrale d'Irlande");
  assert.ok(!html.includes("()") && !html.includes("undefined"));
});

test("fiche R : nom avec un « ¿ » (deux fonds du registre), affiché tel quel", () => {
  const ctx = page();
  const html = fiche(ctx, ctx.lireEntree(QUAESTIO_POINT), undefined);
  assert.ok(html.includes("<h1>Quaestio Alternative Funds ¿ Diversified Yield Fund</h1>"));
});

test("fiche R : ELTIF aux pays répétés, EuVECA au nom avec apostrophe, fonds parapluie", () => {
  const ctx = page();
  const eltif = fiche(ctx, ctx.lireEntree(ELTIF), undefined);
  assert.ok(eltif.includes("Luxembourg, Autriche, Liechtenstein, Allemagne (4 pays)"), "pays répétés comptés une fois");
  assert.ok(eltif.includes("ELTIF : argent bloqué longtemps"));
  assert.ok(eltif.includes("infrastructures") && eltif.includes("100 à 500 millions d'euros"), "politique « N » et tranche 5 de la BCE");
  assert.match(eltif, /<dd>ELTIF<\/dd>/);
  const veca = fiche(ctx, ctx.lireEntree(EUVECA), undefined);
  assert.ok(veca.includes("<h1>ALSA VENTURES I SCSP-Compartiment virtuel d&#39;un véhicule classique</h1>"));
  assert.ok(veca.includes("Réservé aux investisseurs avertis"));
  assert.ok(veca.includes("Notifié pour la commercialisation en France (registre européen)"));
  assert.ok(veca.includes("France, Autriche, Belgique, Tchéquie, Allemagne, Danemark"), "la France en tête, les autres dans l'ordre du registre");
  assert.ok(veca.includes("(16 pays)"));
  assert.ok(veca.includes("autres actifs"), "politique « X » de la BCE");
  const parapluie = fiche(ctx, ctx.lireEntree(PARAPLUIE), undefined);
  assert.match(parapluie, /data-terme="compartiment">Compartiment de<\/button><\/dt><dd>1618 Investment Funds<\/dd>/);
  assert.ok(parapluie.includes("GLEIF – registre des LEI (licence CC0)") && parapluie.includes("BCE – liste des fonds d&#39;investissement de la zone euro"));
  assert.ok(parapluie.includes("5493003AB6BX42CT8Q55") && parapluie.includes("5 à 50 millions d'euros"));
  assert.ok(parapluie.includes("France (1 pays)"));
});

// ---------- Fiche R : informations du registre indisponibles ----------

test("fiche R sans infos", () => {
  for (const infos of [undefined, {}, { 1: ["", "IE", "FR", "", 0, ""] }]) {   // fichier absent, vide, ou sans ce fonds
    const ctx = page({ infos });
    for (const ligne of [GAM, QUAESTIO]) {
      const e = ctx.lireEntree(ligne);
      const html = fiche(ctx, e, undefined);
      assert.ok(html.includes(`<h1>${e.nom}</h1>`));
      assert.ok(html.includes("pas d'ISIN connu") && html.includes(e.gestionnaire));
      assert.ok(html.includes("ESMA – registre de la commercialisation transfrontière"), "l'annuaire vient de l'ESMA");
      assert.ok(!html.includes("Autorité de contrôle") && !html.includes("Commercialisé dans"));
      assert.ok(!html.includes("Identifiant LEI") && !html.includes("Encours"));
      assert.ok(!html.includes("Fonds non notifié pour la France"), "sans les pays, on ne sait pas : aucune alerte inventée");
      assert.ok(!html.includes("Notifié pour la commercialisation en France"));
      assert.ok(!html.includes("undefined") && !html.includes("NaN"));
      assert.match(html, /<dd>(OPCVM \(UCITS\)|FIA)<\/dd>/, "le type vient de la ligne de l'annuaire");
    }
    // l'alerte du cadre ne dépend pas des informations
    const pieges = simple(ctx.detecterPiegesAuto(ctx.lireEntree(QUAESTIO), null));
    assert.ok(pieges.some(p => p.titre === "Réservé aux investisseurs professionnels"));
    assert.ok(!pieges.some(p => /notifi/i.test(p.titre) || p.titre === "Fonds réservé"));
  }
});

test("fiche R sans IDENTITE ni FIRDS (données absentes) : le pays de l'autorité seul", () => {
  const ctx = page({ identite: undefined, firds: undefined });
  const html = fiche(ctx, ctx.lireEntree(GAM), undefined);
  assert.ok(html.includes("<h1>GAM Star Absolute Return Macro</h1>") && html.includes("France, Autriche, Allemagne, Espagne") && html.includes("pas d'ISIN connu"));
  assert.match(html, /data-terme="autorite_controle">Autorité de contrôle<\/button><\/dt><dd>Irlande<\/dd>/);
  assert.ok(!html.includes("undefined"));
  // la fiche chargée sans rien est aussi une fiche valide
  assert.ok(fiche(ctx, ctx.lireEntree(GAM), undefined, null, true).includes("<h1>GAM Star Absolute Return Macro</h1>"));
});

// ---------- Fonds européen déjà présent ----------

test("fonds européen déjà présent (Amundi, LU1681043599)", () => {
  const ctx = page();
  const e = ctx.lireEntree(AMUNDI);
  const html = fiche(ctx, e, "LU1681043599");
  assert.ok(html.includes("Commission de Surveillance du Secteur Financier (CSSF), Luxembourg"));
  assert.ok(html.includes("12 pays"));
  assert.ok(html.includes("France, Italie, Pays-Bas, Finlande, Suède, Espagne, Autriche, Allemagne, Irlande, Portugal, Danemark, Norvège"));
  assert.match(html, /data-terme="fia">Type \(registre européen\)<\/button><\/dt><dd>OPCVM \(UCITS\)<\/dd>/);
  assert.ok(html.includes("Amundi Luxembourg S.A."));
  assert.equal(nb(html, 'data-terme="societe_gestion">Société de gestion'), 1, "la société de gestion de la BCE n'est pas répétée");
  assert.equal(nb(html, "Source : ESMA – registre de la commercialisation transfrontière"), 1, "une seule citation de l'ESMA");
  assert.ok(html.includes("fonds notifié (registre européen de l&#39;ESMA)") || html.includes("fonds notifié (registre européen de l'ESMA)"));
  assert.ok(!html.includes("registers.centralbank.ie"), "fonds luxembourgeois");
  assert.ok(!html.includes("undefined"));
  // aucune alerte nouvelle sur un fonds européen déjà présent : seules les lignes d'identité s'ajoutent
  const avant = simple(ctx.detecterPiegesAuto(e, null)).map(p => p.titre);
  assert.ok(!avant.some(t => /Réservé|non notifié/.test(t)));
});

test("fonds européen sans société de gestion dans l'annuaire : celle de l'ESMA, sans doublon avec la BCE", () => {
  const ctx = page({ identite: { ...IDENTITE_T, fonds: {} } });   // pas de ligne BCE : seule l'ESMA connaît la société
  const html = fiche(ctx, ctx.lireEntree(AMUNDI), "LU1681043599");
  assert.equal(nb(html, 'data-terme="societe_gestion">Société de gestion'), 1);
  assert.match(html, /data-terme="societe_gestion">Société de gestion<\/button><\/dt><dd>Amundi Luxembourg S\.A\.<\/dd>/);
  // si l'annuaire a déjà la société, l'ESMA n'en ajoute pas
  const jp = fiche(ctx, ctx.lireEntree(JPMORGAN), "LU0117841782");
  assert.equal(nb(jp, 'data-terme="societe_gestion">Société de gestion'), 1);
  assert.ok(!jp.includes("JPMorgan Asset Management (Europe) S.À R.L."));
});

test("fonds étranger rapproché par son LEI, même quand le LEI commence par N", () => {
  const ctx = page();
  const jp = ctx.lireEntree(JPMORGAN);
  const html = fiche(ctx, jp, "LU0117841782");
  assert.ok(html.includes("Commission de Surveillance du Secteur Financier (CSSF)") && html.includes("(20 pays)"));
  assert.ok(html.includes("France, Irlande"), "la France en tête");
  const esma = simple(ctx.esmaDe(jp, "LU0117841782"));
  assert.equal(esma.autorite, "LU");
  assert.equal(esma.cadre, "UCITS");
  assert.equal(esma.pays.length, 20);
  assert.equal(esma.pays[0], "FR");
  assert.equal(esma.gestion, "JPMorgan Asset Management (Europe) S.À R.L.");
  assert.equal(esma.lei, "N7JU0O8IYXVVDVQIBX41");
  // l'ISIN affiché n'est pas dans FIRDS : un autre ISIN du même fonds donne le LEI (comme le calcul des données)
  assert.equal(ctx.esmaDe(jp, "LU0522352946").lei, "N7JU0O8IYXVVDVQIBX41");
  // aucun ISIN connu de FIRDS : rien (le numéro de l'entrée n'est pas la clé d'un LEI)
  assert.equal(ctx.esmaDe({ ...jp, isins: ["LU0522352946"] }, "LU0522352946"), null);
});

test("fonds GECO sans ISIN : clé N<numéro>, jamais confondue avec un LEI ni une autre source", () => {
  const ctx = page();
  const solys = ctx.lireEntree(SOLYS);
  const esma = simple(ctx.esmaDe(solys, undefined));
  assert.deepEqual([esma.autorite, esma.cadre, esma.pays, esma.gestion], ["LU", "UCITS", ["FR", "CZ"], "Sg 29 Haussmann"]);
  const html = fiche(ctx, solys, undefined);
  assert.ok(html.includes("France, Tchéquie (2 pays)") && html.includes("Commission de Surveillance du Secteur Financier (CSSF)"));
  assert.equal(nb(html, 'data-terme="societe_gestion">Société de gestion'), 1);
  // la même clé numérique dans une autre source ne retrouve pas ce fonds
  for (const source of ["E", "U", "S", "G"]) assert.equal(ctx.esmaDe({ ...solys, source }, undefined), null, source);
  // une entrée N sans ISIN ni clé dans esmaFonds : aucune ligne
  assert.equal(ctx.esmaDe(ctx.lireEntree(["N", 7, 0, "Autre", "", "", "", "", "", "LU", "", "", "", 0, 1]), undefined), null);
  assert.ok(!fiche(ctx, ctx.lireEntree(["N", 7, 0, "Autre", "", "", "", "", "", "LU", "", "", "", 0, 1]), undefined).includes("Autorité de contrôle"));
});

test("autorité absente d'IDENTITE.autorites : le pays seul, jamais « undefined »", () => {
  const ctx = page();
  const e = ctx.lireEntree(["U", 5, 5, "Fonds danois", "", "", "", "XS0000000001", "", "DK", "", "", "EUR", 0, 1]);
  const html = fiche(ctx, e, "XS0000000001");
  assert.match(html, /data-terme="autorite_controle">Autorité de contrôle<\/button><\/dt><dd>Danemark<\/dd>/);
  assert.match(html, /data-terme="fia">Type \(registre européen\)<\/button><\/dt><dd>FIA<\/dd>/);
  assert.ok(html.includes("Danemark, Suède (2 pays)"), "pas de France : les pays dans l'ordre du registre");
  assert.ok(!html.includes("undefined") && !html.includes("()"));
  // sans aucune table d'autorités (anciennes données)
  const sans = page({ identite: { ...IDENTITE_T, autorites: undefined } });
  const html2 = fiche(sans, sans.lireEntree(AMUNDI), "LU1681043599");
  assert.match(html2, /data-terme="autorite_controle">Autorité de contrôle<\/button><\/dt><dd>Luxembourg<\/dd>/);
  // code de pays inconnu de PAYS : le code
  const inconnu = page({ identite: { ...IDENTITE_T, esmaFonds: { "5493003BFED2MWDBYH64": [0, "ZZ", "UCITS", "ZZ FR"] } } });
  assert.match(fiche(inconnu, inconnu.lireEntree(AMUNDI), "LU1681043599"), /<dd>ZZ<\/dd>/);
});

test("fonds européens sans données de l'ESMA : aucune ligne ajoutée", () => {
  const sansEsma = { ...IDENTITE_T }; delete sansEsma.autorites; delete sansEsma.esmaFonds;   // données d'avant cette tâche
  const ancienne = page({ identite: sansEsma });
  const actuelle = page();
  for (const [ligne, isin] of [[AMUNDI, "LU1681043599"], [JPMORGAN, "LU0522352946"], [SOLYS, undefined]]) {
    const avant = fiche(ancienne, ancienne.lireEntree(ligne), isin);
    assert.ok(!avant.includes("Autorité de contrôle") && !avant.includes("Commercialisé dans") && !avant.includes("Type (registre européen)"));
  }
  const rien = page({ identite: undefined, firds: undefined, infos: undefined });
  assert.equal(rien.esmaDe(rien.lireEntree(AMUNDI), "LU1681043599"), null);
  assert.ok(!fiche(rien, rien.lireEntree(AMUNDI), "LU1681043599").includes("Autorité de contrôle"));
  // un fonds dont aucun ISIN n'est dans FIRDS
  assert.equal(actuelle.esmaDe({ ...actuelle.lireEntree(AMUNDI), isins: ["XX0000000000"] }, "XX0000000000"), null);
});

test("fonds français (G) et américains (S) : aucune ligne de l'ESMA, fiche identique", () => {
  const sans = { ...IDENTITE_T }; delete sans.autorites; delete sans.esmaFonds;
  const a = page(), b = page({ identite: sans, infos: undefined });
  const cle = { ...IDENTITE_T.esmaFonds, "FR0010135103": [0, "FR", "UCITS", "FR"] };   // même une clé qui ressemble à l'ISIN d'un fonds français
  const c = page({ identite: { ...IDENTITE_T, esmaFonds: cle } });
  for (const ctx of [a, b, c]) {
    vm.runInContext(`FIRDS.fonds["FR0010135103"] = ["5493003BFED2MWDBYH64", "EUR", [], 0];`, ctx);
    assert.equal(ctx.esmaDe(ctx.lireEntree(CARMIGNAC), "FR0010135103"), null);
    assert.equal(ctx.esmaDe(ctx.lireEntree(VANGUARD), undefined), null);
  }
  const g = [a, b, c].map(ctx => fiche(ctx, ctx.lireEntree(CARMIGNAC), "FR0010135103"));
  assert.equal(g[0], g[1]);
  assert.equal(g[0], g[2]);
  for (const html of g) assert.ok(!html.includes("Autorité de contrôle") && !html.includes("Commercialisé dans") && !html.includes("registers.centralbank.ie"));
  const s = [a, b].map(ctx => fiche(ctx, ctx.lireEntree(VANGUARD), undefined, { erreurs: [], composition: { fini: true, c: null } }));
  assert.equal(s[0], s[1]);
  assert.ok(!s[0].includes("Autorité de contrôle") && !s[0].includes("registers.centralbank.ie"));
});

test("lien vers le registre de la Banque centrale d'Irlande : fonds domicilié en Irlande, toute source", () => {
  const ctx = page();
  const lien = 'href="https://registers.centralbank.ie/" target="_blank" rel="noopener">Vérifier l\'agrément sur le registre de la Banque centrale d\'Irlande</a>';
  const irlandais = (source, pays = "IE") => ctx.lireEntree([source, 9, 9, "Ishares Test", "", "", "", source === "N" ? "" : "IE00B4L5Y983", "", pays, "", "", "EUR", 0, 1]);
  for (const source of ["E", "U", "N"]) assert.ok(fiche(ctx, irlandais(source), source === "N" ? undefined : "IE00B4L5Y983").includes(lien), source);
  assert.ok(fiche(ctx, ctx.lireEntree(GAM), undefined).includes(lien), "R");
  for (const source of ["E", "N"]) assert.ok(!fiche(ctx, irlandais(source, "LU"), source === "N" ? undefined : "LU1681043599").includes("registers.centralbank.ie"), source + " luxembourgeois");
  assert.ok(!fiche(ctx, ctx.lireEntree(QUAESTIO), undefined).includes("registers.centralbank.ie"));
  assert.equal(nb(fiche(ctx, ctx.lireEntree(GAM), undefined), "registers.centralbank.ie"), 1);
});

// ---------- esmaDe ----------

test("esmaDe : fonds R", () => {
  const ctx = page();
  const esma = simple(ctx.esmaDe(ctx.lireEntree(QUAESTIO), undefined));
  assert.deepEqual(esma, { gestion: "Quaestio Capital Sgr S.P.A.", autorite: "IT", cadre: "AIF", pays: ["LU"], lei: "5493007K0QZ754GJIS61",
    politique: "M", tranche: 8, parapluie: "" });
  assert.equal(simple(ctx.esmaDe(ctx.lireEntree(GAM), undefined)).cadre, "UCITS");
  assert.equal(simple(ctx.esmaDe(ctx.lireEntree(EUVECA), undefined)).cadre, "EuVECA");
  assert.equal(simple(ctx.esmaDe(ctx.lireEntree(ELTIF), undefined)).cadre, "ELTIF");
  assert.equal(simple(ctx.esmaDe(ctx.lireEntree([...EUVECA.slice(0, 6), "EuSEF", ...EUVECA.slice(7)]), undefined)).cadre, "EuSEF");
  // infos absentes : on connaît la société et le cadre (annuaire), pas les pays ni l'autorité
  const sans = page({ infos: undefined });
  assert.deepEqual(simple(sans.esmaDe(sans.lireEntree(QUAESTIO), undefined)),
    { gestion: "Quaestio Capital Sgr S.P.A.", autorite: "", cadre: "AIF", pays: null, lei: "", politique: "", tranche: 0, parapluie: "" });
});

test("esmaDe : fonds européen d'après le LEI de FIRDS", () => {
  const ctx = page();
  const esma = simple(ctx.esmaDe(ctx.lireEntree(AMUNDI), "LU1681043599"));
  assert.deepEqual([esma.gestion, esma.autorite, esma.cadre, esma.lei], ["Amundi Luxembourg S.A.", "LU", "UCITS", "5493003BFED2MWDBYH64"]);
  assert.deepEqual(esma.pays.slice(0, 3), ["FR", "IT", "NL"]);
  assert.equal(esma.pays.length, 12);
  assert.equal(ctx.esmaDe({ ...ctx.lireEntree(AMUNDI), isins: [] }, undefined), null, "ni ISIN ni clé N : rien");
  assert.equal(ctx.esmaDe(ctx.lireEntree(AMUNDI), undefined).autorite, "LU", "un des ISIN de l'entrée suffit");
});

// ---------- FIA étranger commercialisé en France (GECO, famille OFIA ; type d'après ses labels : scripts/construire_annuaire.py) ----------

const FIA_GECO = ["N", 76104, 0, "10X FOUNDERS FUND GMBH & CO. KG", "10X FOUNDERS GMBH", "", "EuVECA", "", "2022-10-20", "DE", "", "", "", 0, 0];

test("fiche N d'un FIA étranger vendu en France (GECO) : alerte de son type, pas l'information générique « Fonds réservé »", () => {
  const ctx = page();
  const fia = ctx.lireEntree(FIA_GECO.map((v, i) => (i === 6 ? "FIA" : v)));
  let pieges = simple(ctx.detecterPiegesAuto(fia, null));
  const pro = pieges.find(p => p.titre === "Réservé aux investisseurs professionnels");
  assert.ok(pro && pro.niveau === "attention" && pro.terme === "fia");
  assert.equal(pro.texte, "D'après la base GECO de l'AMF, ce fonds est un FIA étranger : sa commercialisation en France vise les investisseurs professionnels. Un particulier ne peut en général pas y souscrire.");
  assert.ok(!pieges.some(p => p.titre === "Fonds réservé"));
  const euveca = ctx.lireEntree(FIA_GECO);
  pieges = simple(ctx.detecterPiegesAuto(euveca, null));
  assert.ok(pieges.some(p => p.titre === "Réservé aux investisseurs avertis"));
  assert.ok(!pieges.some(p => p.titre === "Fonds réservé" || p.titre === "Réservé aux investisseurs professionnels"));
  const html = fiche(ctx, euveca, undefined);
  assert.ok(html.includes("Réservé aux investisseurs avertis") && html.includes("Commercialisé en France depuis"));
  // un OPCVM étranger (nature vide) n'a aucune de ces alertes
  assert.ok(!simple(ctx.detecterPiegesAuto(ctx.lireEntree(JPMORGAN), null)).some(p => p.terme === "fia"));
});

// ---------- alertesRegistre ----------

test("alertesRegistre", () => {
  const ctx = page();
  const e = ctx.lireEntree(QUAESTIO);
  const alertes = (cadre, pays = ["FR"]) => simple(ctx.alertesRegistre(e, { cadre, pays }));
  // FIA
  const aif = alertes("AIF").find(a => a.titre === "Réservé aux investisseurs professionnels");
  assert.ok(aif);
  assert.equal(aif.niveau, "attention");
  assert.equal(aif.terme, "fia");
  assert.equal(aif.texte, "D'après le registre européen de l'ESMA, ce fonds est un FIA : sa commercialisation dans d'autres pays de l'Union vise les investisseurs professionnels. Un particulier ne peut en général pas y souscrire.");
  // ELTIF
  const eltif = alertes("ELTIF").find(a => a.titre.startsWith("ELTIF"));
  assert.ok(eltif);
  assert.equal(eltif.titre, "ELTIF : argent bloqué longtemps");
  assert.equal(eltif.niveau, "attention");
  assert.equal(eltif.terme, "fia");
  assert.equal(eltif.texte, "Fonds européen d'investissement à long terme (entreprises non cotées, infrastructures) : l'argent est en général bloqué plusieurs années.");
  // EuVECA et EuSEF
  for (const cadre of ["EuVECA", "EuSEF"]) {
    const a = alertes(cadre).find(x => x.titre.startsWith("Réservé aux investisseurs avertis"));
    assert.ok(a, cadre);
    assert.equal(a.titre, "Réservé aux investisseurs avertis");
    assert.equal(a.niveau, "attention");
    assert.equal(a.terme, "fia");
    assert.equal(a.texte, "Fonds européen de capital-risque ou d'entrepreneuriat social : réservé aux investisseurs professionnels ou qui investissent au moins 100 000 €.");
  }
  // OPCVM : aucune alerte de cadre, seulement la commercialisation
  assert.deepEqual(alertes("UCITS").map(a => a.titre), ["Notifié pour la commercialisation en France (registre européen)"]);
  assert.deepEqual(alertes("UCITS", ["DE"]).map(a => a.titre), ["Fonds non notifié pour la France"]);
  assert.deepEqual(alertes("UCITS", []).map(a => a.titre), ["Fonds non notifié pour la France"]);
  // commercialisation
  const non = alertes("UCITS", ["DE", "IT"])[0];
  assert.deepEqual([non.niveau, non.terme], ["attention", "commercialisation"]);
  assert.equal(non.texte, "D'après le registre européen de l'ESMA, ce fonds n'est pas déclaré pour être proposé en France : ton intermédiaire ne peut en général pas te le vendre.");
  const oui = alertes("UCITS")[0];
  assert.deepEqual([oui.niveau, oui.terme], ["info", "commercialisation"]);
  assert.equal(oui.texte, "Le fonds est déclaré pour être proposé en France, mais aucune part cotée en bourse n'est connue : demande à ton intermédiaire s'il le propose et où trouver son DIC en français.");
  // FIA, ELTIF, EuVECA, EuSEF notifiés en France : l'information ne renvoie pas vers l'intermédiaire comme pour un OPCVM, elle va dans le sens de l'alerte du cadre
  for (const cadre of ["AIF", "ELTIF", "EuVECA", "EuSEF"]) {
    const info = alertes(cadre).find(a => a.titre === "Notifié pour la commercialisation en France (registre européen)");
    assert.ok(info, cadre);
    assert.deepEqual([info.niveau, info.terme], ["info", "commercialisation"]);
    assert.equal(info.texte, "D'après le registre européen de l'ESMA, ce fonds est déclaré pour être commercialisé en France, en principe auprès d'investisseurs professionnels.", cadre);
    assert.ok(!/intermédiaire/.test(info.texte), cadre);
  }
  // cadre et pays ensemble : deux alertes, le cadre d'abord
  assert.deepEqual(alertes("AIF", ["DE"]).map(a => a.titre), ["Réservé aux investisseurs professionnels", "Fonds non notifié pour la France"]);
  // pays inconnus (informations non chargées) : pas d'alerte de commercialisation
  assert.deepEqual(simple(ctx.alertesRegistre(e, { cadre: "AIF", pays: null })).map(a => a.titre), ["Réservé aux investisseurs professionnels"]);
  assert.deepEqual(simple(ctx.alertesRegistre(e, { cadre: "UCITS", pays: null })), []);
  // cadre inconnu ou absent
  assert.deepEqual(alertes("").map(a => a.terme), ["commercialisation"]);
  assert.deepEqual(simple(ctx.alertesRegistre(e, null)), []);
});

test("alerte du nom (SIF, RAIF) : pas de doublon avec l'alerte du cadre sur un fonds du registre", () => {
  const ctx = page();
  const raif = ctx.lireEntree(["R", 2800896, 2800896, "A&G Global SICAV-RAIF-Inland Fund", "A&G Luxembourg AM S.A.", "", "FIA", "", "", "LU", "", "", "", 0, 0]);
  vm.runInContext(`REGISTRES_UE_INFOS[2800896] = ["", "LU", "LU", "", 0, ""];`, ctx);
  const titresRaif = simple(ctx.detecterPiegesAuto(raif, null)).map(p => p.titre);
  assert.equal(titresRaif.filter(t => /^(Fonds r|R)éservé/.test(t)).length, 1, titresRaif.join(" | "));
  // un fonds européen déjà présent garde son alerte du nom
  const sif = ctx.lireEntree(["E", 1, 1, "Lux SIF Test", "", "", "", "LU0000000000", "", "LU", "", "", "EUR", 0, 1]);
  assert.ok(simple(ctx.detecterPiegesAuto(sif, null)).some(p => p.titre === "Fonds réservé aux investisseurs avertis"));
});

// ---------- Vraies données ----------

// Les fichiers publiés tels quels : data/annuaire.js, firds.js, identite.js, annuaire-registres-ue.js et registres-ue-infos.js
function pageReelle() {
  const stockage = new Map();
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: k => stockage.delete(k), get length() { return stockage.size; }, key: i => [...stockage.keys()][i] };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage, document: {} });
  vm.runInContext(`const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of ["data/annuaire.js", "data/firds.js", "data/identite.js"]) executer(ctx, lire(f), f);
  for (const f of SCRIPTS) executer(ctx, lire(f), f);
  executer(ctx, lire("data/registres-ue-infos.js"), "data/registres-ue-infos.js");
  executer(ctx, lire("data/annuaire-registres-ue.js"), "data/annuaire-registres-ue.js");
  return ctx;
}

test("données réelles : chaque fonds du registre a son autorité, ses pays et son cadre, et sa fiche s'affiche", () => {
  const ctx = pageReelle();
  const lignes = vm.runInContext('ANNUAIRE_ZONES["registres-ue"].lignes', ctx);
  assert.ok(lignes.length > 10000);
  const cadres = new Set(), vus = new Set();
  let sansFrance = 0, sansNomAutorite = 0;
  lignes.forEach((l, i) => {
    const e = ctx.lireEntree(l);
    const esma = simple(ctx.esmaDe(e, undefined));
    assert.ok(esma.autorite && esma.cadre && Array.isArray(esma.pays) && esma.pays.length, `R${e.cmpId} : ${JSON.stringify(esma)}`);
    assert.equal(new Set(esma.pays).size, esma.pays.length, `R${e.cmpId} : pays répétés`);
    assert.ok(esma.pays[0] === "FR" || !esma.pays.includes("FR"), `R${e.cmpId} : la France en tête`);
    const alertes = simple(ctx.alertesRegistre(e, esma));
    assert.equal(alertes.filter(a => a.terme === "commercialisation").length, 1);
    assert.equal(alertes.some(a => a.niveau === "info"), esma.pays.includes("FR"));
    if (!esma.pays.includes("FR")) sansFrance++;
    if (!vm.runInContext(`IDENTITE.autorites["${esma.autorite}"]`, ctx)) sansNomAutorite++;
    // la fiche complète d'un fonds sur 40, d'un fonds de chaque cadre, et de ceux qui ont un fonds parapluie ou un nom hors norme
    if (i % 40 === 0 || !cadres.has(esma.cadre) || (esma.parapluie && !vus.has("p")) || /[^\x20-\x7e\u00a0-\u024f]/.test(e.nom) && vus.size < 40) {
      cadres.add(esma.cadre); if (esma.parapluie) vus.add("p"); vus.add(e.nom);
      const html = fiche(ctx, e, undefined);
      assert.ok(html.includes(`<h1>${ctx.esc(e.nom)}</h1>`) && html.includes("pas d'ISIN connu") && html.includes(`simulateur.html#R${e.cmpId}`), `R${e.cmpId}`);
      assert.ok(!/undefined|NaN|\[object/.test(html), `R${e.cmpId} : texte invalide`);
      assert.equal(html.includes("registers.centralbank.ie"), e.pays === "IE");
      assert.equal(html.includes("Fonds non notifié pour la France"), !esma.pays.includes("FR"));
      assert.equal(html.includes("Réservé aux investisseurs professionnels"), esma.cadre === "AIF");
      assert.ok(!html.includes(">Fonds réservé<"));
    }
  });
  assert.deepEqual([...cadres].sort(), ["AIF", "ELTIF", "EuSEF", "EuVECA", "UCITS"]);
  assert.ok(sansFrance > 1000 && sansNomAutorite > 0, "des fonds ne sont pas notifiés pour la France ; au moins une autorité sans nom (Italie)");
});

test("données réelles : fonds européens rapprochés du registre, et fonds français et américains laissés tels quels", () => {
  const ctx = pageReelle();
  const annuaire = vm.runInContext("ANNUAIRE", ctx);
  let trouves = 0, fiches = 0;
  const parSource = { E: 0, U: 0, N: 0 };
  annuaire.forEach((l, i) => {
    const e = ctx.lireEntree(l);
    const isin = e.isins[0];
    const esma = ctx.esmaDe(e, isin);
    if (e.source === "G") return assert.equal(esma, null);
    if (!esma) return;
    trouves++; parSource[e.source]++;
    assert.ok(esma.autorite && esma.cadre && esma.pays.length, `${e.source}${e.cmpId}`);
    if (i % 25 === 0) {
      fiches++;
      const html = fiche(ctx, e, isin);
      assert.ok(html.includes("Autorité de contrôle") && html.includes("Commercialisé dans") && html.includes("Type (registre européen)"), `${e.source}${e.cmpId}`);
      assert.equal(nb(html, "Source : ESMA – registre de la commercialisation transfrontière"), 1);
      assert.ok(!/undefined|NaN|\[object/.test(html));
      assert.equal(html.includes("registers.centralbank.ie"), e.pays === "IE");
    }
  });
  assert.ok(trouves > 5000 && fiches > 100, `${trouves} fonds, ${fiches} fiches`);
  assert.ok(parSource.E > 1000 && parSource.U > 100 && parSource.N > 100, JSON.stringify(parSource));
  // un fonds G ouvert avec une clé qui ressemble à un LEI ne reçoit rien
  assert.equal(ctx.esmaDe(ctx.lireEntree(CARMIGNAC), "FR0010135103"), null);
});

// ---------- Glossaire, fichiers publics ----------

test("glossaire : autorité de contrôle et FIA", () => {
  const ctx = page();
  const g = vm.runInContext("GLOSSAIRE", ctx);
  assert.equal(g.autorite_controle, "Autorité publique qui a autorisé le fonds et le surveille dans son pays d'origine (ex. CSSF au Luxembourg, Banque centrale d'Irlande, AMF en France). Ce contrôle ne garantit ni le capital ni la performance.");
  assert.equal(g.fia, "Fonds d'investissement alternatif : fonds européen qui ne suit pas les règles OPCVM (UCITS). Ses règles de diversification et de liquidité sont plus souples ; il est souvent réservé aux investisseurs professionnels. Les ELTIF (long terme) et EuVECA (capital-risque) en sont des formes particulières.");
});

test("fichiers publics : zone et informations exclues des Functions, chargées à la demande seulement", () => {
  const routes = JSON.parse(lire("_routes.json"));
  for (const chemin of ["/data/annuaire-registres-ue.js", "/data/registres-ue-infos.js"]) {
    assert.ok(routes.exclude.includes(chemin), chemin);
    assert.ok(existsSync(new URL(".." + chemin, import.meta.url)), chemin);
  }
  for (const nom of ["decrypte", "performances", "simulateur"]) {
    const pageHtml = lire(`${nom}.html`);
    assert.ok(!/annuaire-registres-ue|registres-ue-infos/.test(pageHtml), `${nom} : ces fichiers ne se chargent qu'à la demande (js/zones.js, js/app.js)`);
  }
  const zones = vm.runInContext(lire("js/zones.js") + ";ZONES", vm.createContext({ document: {}, setTimeout, clearTimeout }));
  assert.deepEqual(simple(zones).map(z => z.nom), ["registres-ue", "etats-unis"], "ordre de recherche : Europe, registres-ue, etats-unis");
  const ue = zones[0];
  assert.equal(ue.fichier, "data/annuaire-registres-ue.js");
  assert.equal(ue.origine, "Fonds européen (registre ESMA)");
  assert.ok(ue.motif.test("R90728") && !ue.motif.test("R") && !ue.motif.test("S000002839"));
});

// ---------- Décrypte (js/app.js) : ouverture d'une fiche R ----------

// Objet qui accepte tout (propriété, appel, affectation) : les éléments de la page que les tests n'examinent pas
function faux() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : faux()),
    set: () => true,
    apply: () => faux()
  });
}
// Une page où les fichiers « chargés à la demande » viennent de `fichiers` (texte du script, ou absent : erreur de chargement)
function pageNavigateur(scripts, { fichiers = {}, hash = "", identite = IDENTITE_T, retards = {} } = {}) {
  const stockage = new Map(), elements = new Map(), chargements = [], requetes = [];
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: k => stockage.delete(k), get length() { return stockage.size; }, key: i => [...stockage.keys()][i] };
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Proxy({ innerHTML: "", textContent: "", value: "", hidden: false }, {
      get: (t, c) => (c in t ? t[c] : faux()), set: (t, c, v) => { t[c] = v; return true; } }));
    return elements.get(id);
  };
  let ctx;
  const head = { appendChild(el) {
    chargements.push(el.src);
    setTimeout(() => {
      if (typeof fichiers[el.src] === "string") { executer(ctx, fichiers[el.src], el.src); el.onload(); } else el.onerror();
    }, retards[el.src] || 0);
  } };
  const document = new Proxy({}, {
    get: (t, k) => (k === "getElementById" ? element : k === "createElement" ? () => ({}) : k === "querySelectorAll" ? () => [] : k === "head" ? head : faux())
  });
  ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage, document, ANNUAIRE: [], IDENTITE: identite, FIRDS: FIRDS_T,
    location: { hostname: "cleante-f.github.io", hash, search: "" }, history: { replaceState() {} }, URLSearchParams,
    fetch: async url => { requetes.push(String(url)); throw new Error("réseau coupé"); }, alert() {} });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.scrollTo = () => {};
  ctx.element = element;
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of scripts) executer(ctx, lire(f), f);
  return { ctx, chargements, requetes, element };
}
async function attendre(condition, delai = 3000) {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > delai) throw new Error("délai dépassé");
    await new Promise(ok => setTimeout(ok, 5));
  }
}
const texteZone = lignes => `ANNUAIRE_ZONES["registres-ue"] = ${JSON.stringify({ maj: "2026-10-11", lignes })};`;
const texteInfos = infos => `var REGISTRES_UE_INFOS = ${JSON.stringify(infos)};`;   // comme data/registres-ue-infos.js
const SCRIPTS_APP = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js", "js/inventaire.js",
  "js/style.js", "js/composition.js", "js/affichage.js", "js/marches.js", "js/cours.js", "js/fiche-auto.js", "js/nav.js", "js/app.js"];

test("Décrypte : une fiche R charge les informations du registre, puis s'affiche sans chercher de cours", async () => {
  const p = pageNavigateur(SCRIPTS_APP, { hash: "#R90728", fichiers: {
    "data/annuaire-registres-ue.js": texteZone([GAM, QUAESTIO]), "data/registres-ue-infos.js": texteInfos(INFOS_T) } });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("Composition non calculable"));   // dernière étape : pas de fonds comparable
  const html = resultat.innerHTML;
  assert.ok(html.includes("<h1>GAM Star Absolute Return Macro</h1>") && html.includes("Central Bank of Ireland (CBI)") && html.includes("France, Autriche, Allemagne, Espagne"));
  assert.ok(html.includes("Notifié pour la commercialisation en France") && !html.includes("Chargement des données…"));
  assert.ok(!html.includes("Informations manquantes"));
  assert.deepEqual(p.chargements, ["data/annuaire-registres-ue.js", "data/registres-ue-infos.js"]);
  assert.deepEqual(p.requetes, [], "ni cours en bourse ni GECO pour un fonds sans ISIN");
  assert.ok(!html.includes("Aucun cours relevé"));
});

test("data/registres-ue-infos.js peut être exécuté deux fois (second chargement après un délai dépassé) sans « already declared »", () => {
  const texte = lire("data/registres-ue-infos.js");
  assert.ok(!texte.includes("const REGISTRES_UE_INFOS"));
  const ctx = vm.createContext({});
  vm.runInContext(texte, ctx, { filename: "data/registres-ue-infos.js" });
  assert.doesNotThrow(() => vm.runInContext(texte, ctx, { filename: "data/registres-ue-infos.js" }));
  assert.equal(vm.runInContext("typeof REGISTRES_UE_INFOS", ctx), "object");
  assert.ok(Object.keys(vm.runInContext("REGISTRES_UE_INFOS", ctx)).length > 10000);
});

test("Décrypte : fiche R, informations du registre indisponibles", async () => {
  const p = pageNavigateur(SCRIPTS_APP, { hash: "#R2103248", fichiers: { "data/annuaire-registres-ue.js": texteZone([GAM, QUAESTIO]) } });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("Composition non calculable"));
  const html = resultat.innerHTML;
  assert.ok(html.includes("Informations manquantes"));
  assert.ok(html.includes("informations du registre ESMA indisponibles"));
  assert.ok(html.includes("<h1>Quaestio Alternative Funds - Fund One</h1>") && html.includes("Quaestio Capital Sgr S.P.A.") && html.includes("pas d'ISIN connu"));
  assert.ok(html.includes("Réservé aux investisseurs professionnels"));
  assert.ok(!html.includes("Fonds non notifié pour la France"));
  assert.deepEqual(p.requetes, []);
});

test("Décrypte : fichier des informations sans les données attendues, signalé puis rechargé à la fiche suivante", async () => {
  const fichiers = { "data/annuaire-registres-ue.js": texteZone([GAM, QUAESTIO]), "data/registres-ue-infos.js": "// fichier vide" };
  const p = pageNavigateur(SCRIPTS_APP, { hash: "#R90728", fichiers });
  const resultat = p.element("resultat");
  await attendre(() => resultat.innerHTML.includes("Composition non calculable"));
  assert.ok(resultat.innerHTML.includes("informations du registre ESMA indisponibles (fichier sans les informations attendues)"));
  assert.ok(resultat.innerHTML.includes("<h1>GAM Star Absolute Return Macro</h1>"));
  fichiers["data/registres-ue-infos.js"] = texteInfos(INFOS_T);   // le fichier est de nouveau correct : il est redemandé
  p.ctx.location.hash = "#R2103248";
  p.ctx.afficherDepuisAdresse();
  await attendre(() => resultat.innerHTML.includes("Fonds non notifié pour la France"));
  assert.equal(p.chargements.filter(c => c === "data/registres-ue-infos.js").length, 2);
  assert.ok(!resultat.innerHTML.includes("Informations manquantes"));
});

test("Décrypte : fonds R inconnu, zone qui ne se charge pas", async () => {
  const inconnu = pageNavigateur(SCRIPTS_APP, { hash: "#R1", fichiers: { "data/annuaire-registres-ue.js": texteZone([GAM]) } });
  await attendre(() => inconnu.element("resultat").innerHTML.includes("Aucun fonds trouvé"));
  const panne = pageNavigateur(SCRIPTS_APP, { hash: "#R90728", fichiers: {} });
  await attendre(() => panne.element("resultat").innerHTML.includes("Impossible de charger cette liste de fonds"));
});

test("Décrypte : le fonds change pendant le chargement des informations, l'ancienne fiche ne revient pas", async () => {
  const p = pageNavigateur(SCRIPTS_APP, { hash: "#R90728", retards: { "data/registres-ue-infos.js": 80 }, fichiers: {
    "data/annuaire-registres-ue.js": texteZone([GAM, QUAESTIO]), "data/registres-ue-infos.js": texteInfos(INFOS_T) } });
  const resultat = p.element("resultat");
  await attendre(() => p.chargements.includes("data/registres-ue-infos.js"));   // la première fiche attend ses informations
  p.ctx.location.hash = "#R2103248";
  p.ctx.afficherDepuisAdresse();
  await attendre(() => resultat.innerHTML.includes("Fonds non notifié pour la France"));
  await new Promise(ok => setTimeout(ok, 100));
  assert.ok(resultat.innerHTML.includes("<h1>Quaestio Alternative Funds - Fund One</h1>") && !resultat.innerHTML.includes("<h1>GAM Star"));
});

// ---------- Performances et Simulateur : une clé R s'ouvre sans exception ----------

const AUJOURDHUI = new Date(2026, 9, 11, 12).getTime();
class DateFixe extends Date {
  constructor(...arguments_) { if (arguments_.length) super(...arguments_); else super(AUJOURDHUI); }
  static now() { return AUJOURDHUI; }
}
const SCRIPTS_PERF = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js", "js/style.js",
  "js/affichage.js", "js/nav.js", "js/performances.js"];
const SCRIPTS_SIMU = ["js/mode-site.js", "js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js",
  "js/inventaire.js", "js/style.js", "js/composition.js", "js/affichage.js", "js/marches.js", "js/fiche-auto.js", "js/projection.js",
  "js/contexte-fonds.js", "js/graphiques-simu.js", "js/nav.js", "js/simulateur.js"];
function pageOutilComplete(scripts, hash) {
  const stockage = new Map(), elements = new Map();
  const localStorage = { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)),
    removeItem: k => stockage.delete(k), get length() { return stockage.size; }, key: i => [...stockage.keys()][i] };
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Proxy({ innerHTML: "", textContent: "", value: "", hidden: false }, {
      get: (t, c) => (c in t ? t[c] : faux()), set: (t, c, v) => { t[c] = v; return true; } }));
    return elements.get(id);
  };
  const document = new Proxy({}, {
    get: (t, k) => (k === "getElementById" ? element : k === "createElement" ? () => ({}) : k === "querySelectorAll" ? () => [] : faux())
  });
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage, document, ANNUAIRE: [], Date: DateFixe,
    location: { hostname: "cleante-f.github.io", hash, search: "" }, history: { replaceState() {} }, URLSearchParams,
    fetch: async () => { throw new Error("réseau coupé"); }, alert() {} });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.element = element;
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = {};`, ctx);
  for (const f of scripts) executer(ctx, lire(f), f);
  // zones déjà chargées (le chargeur de scripts de la page simulée ne répond pas)
  vm.runInContext(`ANNUAIRE_ZONES["registres-ue"] = ${JSON.stringify({ maj: "2026-10-11", lignes: [GAM, QUAESTIO] })};
    ANNUAIRE_ZONES["etats-unis"] = { maj: "2026-10-11", trimestre: "2026q3", lignes: [] };`, ctx);
  return ctx;
}

test("Performances : une clé R s'ouvre, sans historique public ni fonds comparable, avec un message lisible", async () => {
  const ctx = pageOutilComplete(SCRIPTS_PERF, "");
  const e = await ctx.entreeParCle("R90728");
  assert.equal(e.source, "R");
  await assert.rejects(ctx.serieFonds(e, undefined), /aucune donnée publique pour ce fonds/);
  ctx.location.hash = "#R90728";
  await ctx.afficherPerformances();
  const html = ctx.element("resultat").innerHTML;
  assert.ok(html.includes("GAM Star Absolute Return Macro") && html.includes("Pas d'historique de performances disponible pour ce fonds"), html);
  assert.ok(html.includes('href="decrypte.html#R90728"'));
  // liste de résultats
  const liste = ctx.listePerf(await ctx.rechercherPartout("gam star"), "gam star");
  assert.ok(liste.includes('<a href="#R90728">GAM Star Absolute Return Macro</a>') && liste.includes("pas d'historique public"));
});

test("Simulateur : une clé R s'ouvre, profil type faute d'historique, liens vers les autres outils", async () => {
  const ctx = pageOutilComplete(SCRIPTS_SIMU, "");
  vm.runInContext(`
    async function chargerSeriesLongues() {
      const res = {};
      for (const s of SERIES_LONGUES) {
        const m = new Map();
        for (let a = 1999; a <= 2026; a++) for (let mm = 1; mm <= 12; mm++) m.set(a + "-" + String(mm).padStart(2, "0"), 0.004);
        res[s.cle] = m;
      }
      return res;
    }
    async function serieDollarMensuelle() { return new Map(); }`, ctx);
  const e = await ctx.entreeParCle("R90728");
  const A = await ctx.chargerAnalyse(e, undefined);
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.sec, undefined);
  assert.equal(A.terSource, "hypothese");
  vm.runInContext("S", ctx).chargement = { entree: e, isin: undefined };
  const carte = ctx.carteFonds(A);
  assert.ok(carte.includes("GAM Star Absolute Return Macro") && carte.includes('href="decrypte.html#R90728"') && carte.includes('href="performances.html#R90728"'));
  assert.ok(!carte.includes("undefined"));
  ctx.location.hash = "#R90728";
  await ctx.afficherDepuisAdresse();
  assert.ok(ctx.element("fonds-simu").innerHTML.includes("GAM Star Absolute Return Macro"));
});

// Annuaire par zone (js/zones.js) : chargement des fichiers de zone, clés, ouverture et recherche dans tous les pays.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));

// Lignes au format de ANNUAIRE : source, cmpId, prdId, nom, gestionnaire, classification, nature, ISIN, création, pays,
// tickers, marchés, devise, ETF (0|1), public (0|1)
const FR = ["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1];
const VOO = ["E", 0, 0, "Vanguard 500 Index Fund Registered Shares ETF o.N.", "", "", "", "US9229083632", "", "US", "", "", "USD", 1, 1];
const AMUNDI = ["E", 2, 2, "Amundi Funds Euro Corporate Bond", "Amundi", "", "", "LU1681043599", "", "LU", "CW8", "Euronext Paris", "EUR", 1, 1];
// Lignes de la zone « etats-unis » (vraies lignes de data/annuaire-etats-unis.js)
const VANGUARD_500 = ["S", 2839, 2839, "Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS", "", "", "", "", "US", "VFINX VFIAX VOO VFFSX", "", "USD", 1, 1];
const ASHMORE = ["S", 30390, 30390, "Ashmore Emerging Markets Total Return Fund", "Ashmore Funds", "", "", "", "", "US", "EMKIX EMKCX EMKAX", "", "USD", 0, 1];

// Lignes de la zone « registres-ue » (vraies lignes de data/annuaire-registres-ue.js)
const GAM_STAR = ["R", 90728, 90728, "GAM Star Absolute Return Macro", "GAM Fund Management Limited", "", "OPCVM (UCITS)", "", "", "IE", "", "", "", 0, 1];
const QUAESTIO = ["R", 2103248, 2103248, "Quaestio Alternative Funds - Fund One", "Quaestio Capital Sgr S.P.A.", "", "FIA", "", "", "LU", "", "", "", 0, 0];
const ABBEY = ["R", 2824062, 2824062, "Abbey Capital TrendPlus Strategy (UCITS)", "Waystone Management Company (IE) Limited", "", "OPCVM (UCITS)", "", "", "IE", "", "", "", 0, 1];

const FICHIER_ZONE = "data/annuaire-etats-unis.js";
const FICHIER_UE = "data/annuaire-registres-ue.js";
const texteZone = (nom, lignes) => `ANNUAIRE_ZONES[${JSON.stringify(nom)}] = ${JSON.stringify({ maj: "2026-10-11", trimestre: "2026q3", lignes })};`;
const ZONE_US = texteZone("etats-unis", [VANGUARD_500, ASHMORE]);
// Par défaut la zone des registres européens ne contient qu'un fonds qui ne répond à aucune recherche des tests ci-dessous
// (« fund », « amundi », « ashmore »…) : ils ne s'occupent que de la zone qu'ils nomment
const ZONE_UE = texteZone("registres-ue", [ABBEY]);

// Une page simulée : l'annuaire européen réduit, un `document` qui compte les <script> ajoutés puis, au tour suivant, exécute
// le texte du fichier demandé (ou signale une erreur de chargement s'il est absent de `fichiers`)
function monde({ fichiers: demandes = {}, europe = [FR, VOO, AMUNDI], isin = { US9229083632: "S000002839" } } = {}) {
  const fichiers = { [FICHIER_UE]: ZONE_UE, ...demandes };
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
  ctx = vm.createContext({ console, setTimeout, clearTimeout, document, ANNUAIRE: europe });
  for (const f of ["js/outils.js", "js/geco.js"]) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`const ETATS_UNIS_ISIN = ${JSON.stringify(isin)};`, ctx);   // data/etats-unis-isin.js
  vm.runInContext(lire("js/zones.js"), ctx, { filename: "js/zones.js" });
  return { ctx, chargements, fichiers };
}
const noms = liste => simple(liste).map(e => e.nom);

test("cleEntree : clé d'un fonds américain", () => {
  const { lireEntree, cleEntree } = monde().ctx;
  assert.equal(cleEntree(lireEntree(VANGUARD_500)), "S000002839");
  assert.equal(cleEntree(lireEntree(["S", 1293613, 1293613, "Grand numéro", "", "", "", "", "", "US", "", "", "USD", 0, 1])), "S001293613");
  assert.equal(cleEntree(lireEntree(["N", 12345, 1, "Fonds étranger", "", "", "", "", "", "LU", "", "", "EUR", 0, 1])), "N12345");
  assert.equal(cleEntree(lireEntree(FR)), "FR0010135103");
  assert.equal(cleEntree(lireEntree(VOO), "US9229083632"), "US9229083632");   // ISIN demandé
});

test("zoneDeCle", () => {
  const { zoneDeCle } = monde().ctx;
  assert.equal(zoneDeCle("S000002839"), "etats-unis");
  assert.equal(zoneDeCle("R90728"), "registres-ue");
  assert.equal(zoneDeCle("R2103248"), "registres-ue");
  for (const cle of ["FR0010135103", "N12345", "S12", "S00000283", "S0000028390", "s000002839", "", "R", "r90728", "R90728a", "RU0009029540", "R-1"]) assert.equal(zoneDeCle(cle), "europe", cle);
});

test("chargerScript : un seul <script> par fichier, nouvel essai après un échec", async () => {
  const m = monde({ fichiers: { "data/a.js": "globalThis.A = 1;" } });
  await Promise.all([m.ctx.chargerScript("data/a.js"), m.ctx.chargerScript("data/a.js")]);
  await m.ctx.chargerScript("data/a.js");
  assert.deepEqual(m.chargements, ["data/a.js"]);
  assert.equal(m.ctx.A, 1);
  await assert.rejects(m.ctx.chargerScript("data/absent.js"), /data\/absent\.js/);
  await assert.rejects(m.ctx.chargerScript("data/absent.js"));
  assert.deepEqual(m.chargements, ["data/a.js", "data/absent.js", "data/absent.js"]);
});

test("chargerScript : délai maximal, nouvel essai, onload tardif sans effet", { timeout: 10000 }, async () => {
  const m = monde();
  const elements = [];
  m.ctx.document = { createElement: () => ({}), head: { appendChild: el => elements.push(el) } };   // le fichier ne répond jamais
  vm.runInContext("DELAI_CHARGEMENT = 30;", m.ctx);   // 20 s en vrai ; ici de quoi ne pas attendre
  const debut = Date.now();
  await assert.rejects(m.ctx.chargerScript("data/muet.js"), /data\/muet\.js.*délai/);
  assert.ok(Date.now() - debut < 5000, "le délai doit être celui de DELAI_CHARGEMENT");
  assert.equal(elements.length, 1);
  elements[0].onload();    // le fichier arrive après le délai : sans effet
  elements[0].onerror();
  const essai = m.ctx.chargerScript("data/muet.js");   // le délai dépassé a retiré la promesse : nouveau <script>
  assert.equal(elements.length, 2);
  await assert.rejects(essai, /délai/);
  // une réponse dans les temps est acceptée, et le délai ne compte plus ensuite
  m.ctx.document.head.appendChild = el => { elements.push(el); setTimeout(() => el.onload(), 0); };
  await m.ctx.chargerScript("data/muet.js");
  await new Promise(fin => setTimeout(fin, 60));
  await m.ctx.chargerScript("data/muet.js");   // déjà chargé : promesse gardée, pas de nouveau <script>
  assert.equal(elements.length, 3);
});

test("chargerZone : un seul chargement pour deux appels simultanés", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const [a, b] = await Promise.all([m.ctx.chargerZone("etats-unis"), m.ctx.chargerZone("etats-unis")]);
  assert.equal(m.chargements.length, 1);
  assert.equal(a, b);
  assert.equal(a.lignes.length, 2);
  assert.equal(a.maj, "2026-10-11");
  assert.equal((await m.ctx.chargerZone("etats-unis")).lignes.length, 2);   // zone déjà là : rien de plus à charger
  assert.equal(m.chargements.length, 1);
});

test("chargerZone : nouvel essai après un échec", async () => {
  const m = monde();
  await assert.rejects(m.ctx.chargerZone("etats-unis"));
  assert.equal(m.chargements.length, 1);
  m.fichiers[FICHIER_ZONE] = ZONE_US;   // le fichier est de nouveau disponible
  assert.equal((await m.ctx.chargerZone("etats-unis")).lignes.length, 2);
  assert.equal(m.chargements.length, 2);
});

test("chargerZone : fichier sans la zone, zone inconnue", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: "// fichier vide" } });
  await assert.rejects(m.ctx.chargerZone("etats-unis"), /ne définit pas/);
  m.fichiers[FICHIER_ZONE] = ZONE_US;
  assert.equal((await m.ctx.chargerZone("etats-unis")).lignes.length, 2);   // le fichier est rechargé, pas gardé tel quel
  assert.equal(m.chargements.length, 2);
  await assert.rejects(m.ctx.chargerZone("mars"), /zone inconnue/);
});

test("entreeParCle", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const e = simple(await m.ctx.entreeParCle("S000002839"));
  assert.equal(e.nom, "Vanguard 500 Index Fund");
  assert.equal(e.source, "S");
  assert.equal(e.pays, "US");
  assert.equal(e.gestionnaire, "VANGUARD INDEX FUNDS");
  assert.deepEqual(e.tickers, ["VFINX", "VFIAX", "VOO", "VFFSX"]);
  assert.equal(m.chargements.length, 1);
  assert.equal(await m.ctx.entreeParCle("S000009999"), null);   // zone chargée, série inconnue

  const europe = monde();   // Europe : rien à charger
  assert.equal((await europe.ctx.entreeParCle("FR0010135103")).nom, "Carmignac Patrimoine");
  assert.equal((await europe.ctx.entreeParCle("US9229083632")).source, "E");
  assert.equal(await europe.ctx.entreeParCle("N12345"), null);
  assert.equal(await europe.ctx.entreeParCle("XX0000000000"), null);
  assert.equal(europe.chargements.length, 0);
});

test("entreeParCle : zone qui ne se charge pas", async () => {
  const m = monde();
  await assert.rejects(m.ctx.entreeParCle("S000002839"));
});

test("rechercherZone : ticker exact (majuscules ou minuscules), sinon tous les mots du nom et du gestionnaire", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  assert.deepEqual(simple(m.ctx.rechercherZone("etats-unis", "EMKIX")), [], "zone pas encore chargée");
  await m.ctx.chargerZone("etats-unis");
  const chercher = (...args) => noms(m.ctx.rechercherZone("etats-unis", ...args));
  assert.deepEqual(chercher("EMKIX"), [ASHMORE[3]]);
  assert.deepEqual(chercher("emkcx"), [ASHMORE[3]]);
  assert.deepEqual(chercher(" EMK AX "), [ASHMORE[3]]);
  assert.deepEqual(chercher("VOO"), [VANGUARD_500[3]]);
  assert.deepEqual(chercher("total return emerging"), [ASHMORE[3]]);
  assert.deepEqual(chercher("ashmore funds"), [ASHMORE[3]]);              // le gestionnaire compte
  assert.deepEqual(chercher("vanguard 500"), [VANGUARD_500[3]]);
  assert.deepEqual(chercher("vanguard ashmore"), []);
  assert.deepEqual(chercher("fund"), [VANGUARD_500[3], ASHMORE[3]]);
  assert.deepEqual(chercher("fund", 1), [VANGUARD_500[3]]);
  assert.deepEqual(chercher("   "), []);
});

test("rechercherPartout : ISIN européen sans charger la zone", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const r = await m.ctx.rechercherPartout("US9229083632");
  assert.deepEqual(noms(r), [VOO[3]]);
  assert.deepEqual(simple(r.incomplet), []);
  assert.equal(m.chargements.length, 0);
  assert.deepEqual(noms(await m.ctx.rechercherPartout(" cw8 ")), [AMUNDI[3]]);   // ticker européen exact
  assert.equal(m.chargements.length, 0);
});

test("rechercherPartout : ticker américain exact", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const r = await m.ctx.rechercherPartout("EMKIX");
  assert.deepEqual(noms(r), [ASHMORE[3]]);
  assert.deepEqual(simple(r.incomplet), []);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("emkix")), [ASHMORE[3]]);
  assert.equal(m.chargements.length, 2);   // les deux zones, une seule fois chacune (registres européens et États-Unis)
  assert.deepEqual(noms(await m.ctx.rechercherPartout("VOO")), [VANGUARD_500[3]]);   // le VOO européen n'a pas de ticker dans l'annuaire
});

test("rechercherPartout : fonds présent dans les deux zones affiché une fois", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const r = await m.ctx.rechercherPartout("vanguard 500");
  assert.deepEqual(noms(r), [VOO[3]]);
  assert.deepEqual(simple(r.incomplet), []);
});

test("rechercherPartout : Europe d'abord", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const r = await m.ctx.rechercherPartout("fund");
  assert.deepEqual(noms(r), [AMUNDI[3], VOO[3], ASHMORE[3]]);   // la série américaine de VOO est déjà là, côté européen
  assert.deepEqual(noms(await m.ctx.rechercherPartout("fund", 2)), [AMUNDI[3], VOO[3]]);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("fund", 3)), [AMUNDI[3], VOO[3], ASHMORE[3]]);
});

test("rechercherPartout : zone en échec", async () => {
  const m = monde();   // le fichier des États-Unis est absent
  const r = await m.ctx.rechercherPartout("ashmore");
  assert.deepEqual(simple(r), []);
  assert.deepEqual(simple(r.incomplet), ["etats-unis"]);
  const e = await m.ctx.rechercherPartout("amundi");
  assert.deepEqual(noms(e), [AMUNDI[3]]);
  assert.deepEqual(simple(e.incomplet), ["etats-unis"]);
  assert.equal(m.chargements.length, 3);   // registres européens une fois, États-Unis redemandée à chaque recherche
});

test("rechercherPartout : zone des registres européens en échec, les autres résultats restent", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US, [FICHIER_UE]: undefined } });
  const r = await m.ctx.rechercherPartout("fund");
  assert.deepEqual(noms(r), [AMUNDI[3], VOO[3], ASHMORE[3]]);   // Europe et États-Unis, sans les registres
  assert.deepEqual(simple(r.incomplet), ["registres-ue"]);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("ashmore")), [ASHMORE[3]]);
  assert.equal(m.chargements.filter(c => c === FICHIER_UE).length, 2, "la zone est redemandée à chaque recherche");
  assert.equal(m.chargements.filter(c => c === FICHIER_ZONE).length, 1);
  m.fichiers[FICHIER_UE] = texteZone("registres-ue", [GAM_STAR]);   // le fichier est de nouveau disponible
  const apres = await m.ctx.rechercherPartout("gam star");
  assert.deepEqual(noms(apres), [GAM_STAR[3]]);
  assert.deepEqual(simple(apres.incomplet), []);
});

test("rechercherPartout : les deux zones en échec", async () => {
  const m = monde({ fichiers: { [FICHIER_UE]: undefined } });
  const r = await m.ctx.rechercherPartout("amundi");
  assert.deepEqual(noms(r), [AMUNDI[3]]);
  assert.deepEqual(simple(r.incomplet), ["registres-ue", "etats-unis"]);
});

test("rechercherPartout : Europe, puis registres-ue, puis etats-unis", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US, [FICHIER_UE]: texteZone("registres-ue", [GAM_STAR, QUAESTIO, ABBEY]) } });
  const r = await m.ctx.rechercherPartout("fund");
  assert.deepEqual(noms(r), [AMUNDI[3], VOO[3], GAM_STAR[3], QUAESTIO[3], ASHMORE[3]]);   // la société de gestion compte dans la recherche
  assert.deepEqual(simple(r.incomplet), []);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("fund", 3)), [AMUNDI[3], VOO[3], GAM_STAR[3]]);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("fund", 4)), [AMUNDI[3], VOO[3], GAM_STAR[3], QUAESTIO[3]]);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("waystone")), [ABBEY[3]]);
  assert.deepEqual(m.chargements, [FICHIER_UE, FICHIER_ZONE], "les deux zones sont demandées ensemble, chacune une fois");
});

test("registres-ue : clé R<id>, ouverture et résultats de la recherche", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US, [FICHIER_UE]: texteZone("registres-ue", [GAM_STAR, QUAESTIO]) } });
  const e = simple(await m.ctx.entreeParCle("R90728"));
  assert.equal(e.nom, "GAM Star Absolute Return Macro");
  assert.equal(e.source, "R");
  assert.equal(e.cmpId, 90728);
  assert.equal(e.gestionnaire, "GAM Fund Management Limited");
  assert.equal(e.nature, "OPCVM (UCITS)");
  assert.equal(e.pays, "IE");
  assert.deepEqual(e.isins, []);
  assert.equal(e.public, true);
  assert.equal(m.ctx.cleEntree(m.ctx.lireEntree(GAM_STAR)), "R90728");
  assert.equal((await m.ctx.entreeParCle("R2103248")).public, false, "FIA : réservé");
  assert.equal(await m.ctx.entreeParCle("R1"), null);                    // zone chargée, fonds inconnu
  assert.deepEqual(m.chargements, [FICHIER_UE]);                         // l'ouverture ne charge que sa zone
  assert.deepEqual(noms(await m.ctx.rechercherPartout("star absolute")), [GAM_STAR[3]]);
  const ouvert = monde();
  ouvert.fichiers[FICHIER_UE] = undefined;
  await assert.rejects(ouvert.ctx.entreeParCle("R90728"));
});

test("rechercherPartout : requête vide, sans rien charger", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  const r = await m.ctx.rechercherPartout("   ");
  assert.deepEqual(simple(r), []);
  assert.deepEqual(simple(r.incomplet), []);
  assert.equal(m.chargements.length, 0);
});

// Une seconde zone (la tâche « registres-ue » en ajoute une vraie), placée avant les États-Unis dans l'ordre de recherche
const TEST = ["T", 7, 7, "Test Fund Alpha", "Gestion Test", "", "", "", "", "XX", "ALPHA", "", "EUR", 0, 1];
function mondeADeuxZones(fichiers) {
  const m = monde({ fichiers: { "data/annuaire-test.js": texteZone("test", [TEST]), ...fichiers } });
  vm.runInContext(`ZONES.splice(0, 0, { nom: "test", fichier: "data/annuaire-test.js", motif: /^T\\d+$/, origine: "Fonds test" });`, m.ctx);
  return m;
}

test("plusieurs zones : clés, ouverture et résultats dans l'ordre de ZONES", async () => {
  const m = mondeADeuxZones({ [FICHIER_ZONE]: ZONE_US });
  assert.equal(m.ctx.zoneDeCle("T7"), "test");
  assert.equal(m.ctx.zoneDeCle("S000002839"), "etats-unis");
  assert.equal(m.ctx.zoneDeCle("FR0010135103"), "europe");
  assert.equal((await m.ctx.entreeParCle("T7")).nom, TEST[3]);
  assert.deepEqual(m.chargements, ["data/annuaire-test.js"]);
  const r = await m.ctx.rechercherPartout("fund");
  assert.deepEqual(noms(r), [AMUNDI[3], VOO[3], TEST[3], ASHMORE[3]]);   // Europe, puis chaque zone dans l'ordre de ZONES
  assert.deepEqual(simple(r.incomplet), []);
  assert.deepEqual(noms(await m.ctx.rechercherPartout("ALPHA")), [TEST[3]]);   // ticker exact dans la première zone
  assert.deepEqual(m.chargements, ["data/annuaire-test.js", FICHIER_UE, FICHIER_ZONE]);
});

test("plusieurs zones : demandées en parallèle, une zone en échec n'empêche pas les autres", async () => {
  const m = mondeADeuxZones({});   // le fichier des États-Unis est absent
  const attente = m.ctx.rechercherPartout("fund");
  assert.deepEqual(m.chargements, ["data/annuaire-test.js", FICHIER_UE, FICHIER_ZONE], "les trois fichiers sont demandés avant d'attendre le premier");
  const r = await attente;
  assert.deepEqual(noms(r), [AMUNDI[3], VOO[3], TEST[3]]);
  assert.deepEqual(simple(r.incomplet), ["etats-unis"]);
});

// ---- Affichage : liste des résultats et fiche d'un fonds américain ----
function pageAvecAffichage(fichiersSupplementaires = []) {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US } });
  for (const f of ["js/glossaire.js", "js/affichage.js", ...fichiersSupplementaires]) vm.runInContext(lire(f), m.ctx, { filename: f });
  return m;
}

test("afficherListe : origine d'après ZONES, note si une zone n'a pas pu être chargée", async () => {
  const m = pageAvecAffichage();
  const reels = await m.ctx.rechercherPartout("ashmore");
  const html = m.ctx.afficherListe("ashmore", reels);
  assert.ok(html.includes('<a href="#S000030390">Ashmore Emerging Markets Total Return Fund</a>'));
  assert.ok(html.includes("Fonds américain (SEC)"));
  assert.ok(!html.includes("hors Europe"), "pas d'étiquette « hors Europe » en plus de l'origine de la zone");
  assert.ok(!html.includes("n'ont pas pu être chargés"));
  const europe = m.ctx.afficherListe("amundi", await m.ctx.rechercherPartout("amundi"));
  assert.ok(europe.includes("LU1681043599 · ETF · Amundi"), "l'origine des fonds européens ne change pas");

  const panne = monde();   // fichier de zone indisponible
  for (const f of ["js/glossaire.js", "js/affichage.js"]) vm.runInContext(lire(f), panne.ctx, { filename: f });
  const incomplet = panne.ctx.afficherListe("amundi", await panne.ctx.rechercherPartout("amundi"));
  assert.ok(incomplet.includes("Certains fonds n'ont pas pu être chargés (Fonds américain (SEC)) : réessaie dans un instant."), incomplet);
  const vide = panne.ctx.afficherListe("zzzz", await panne.ctx.rechercherPartout("zzzz"));
  assert.ok(vide.includes("Aucun fonds trouvé pour « zzzz »") && vide.includes("fonds américains déclarés à la SEC"));
  assert.ok(vide.includes("réessaie dans un instant"), "une zone en échec est signalée même sans résultat");
  assert.ok(!m.ctx.afficherListe("zzzz", []).includes("réessaie"), "liste vide sans propriété incomplet");
});

test("afficherListe : fonds irlandais ou luxembourgeois du registre ESMA, et note si cette zone n'a pas pu être chargée", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US, [FICHIER_UE]: texteZone("registres-ue", [GAM_STAR, QUAESTIO]) } });
  for (const f of ["js/glossaire.js", "js/affichage.js"]) vm.runInContext(lire(f), m.ctx, { filename: f });
  const html = m.ctx.afficherListe("gam", await m.ctx.rechercherPartout("gam"));
  assert.ok(html.includes('<a href="#R90728">GAM Star Absolute Return Macro</a>'));
  assert.ok(html.includes("ISIN non publié · Fonds irlandais ou luxembourgeois (registre ESMA) · GAM Fund Management Limited"), html);
  assert.ok(!html.includes("hors Europe") && !html.includes("réservé"));
  const fia = m.ctx.afficherListe("quaestio", await m.ctx.rechercherPartout("quaestio"));
  assert.ok(fia.includes('<a href="#R2103248">') && fia.includes("Fonds irlandais ou luxembourgeois (registre ESMA)") && fia.includes("· réservé"), "un FIA est signalé « réservé »");

  const panne = monde({ fichiers: { [FICHIER_ZONE]: ZONE_US, [FICHIER_UE]: undefined } });
  for (const f of ["js/glossaire.js", "js/affichage.js"]) vm.runInContext(lire(f), panne.ctx, { filename: f });
  const incomplet = panne.ctx.afficherListe("amundi", await panne.ctx.rechercherPartout("amundi"));
  assert.ok(incomplet.includes("Certains fonds n'ont pas pu être chargés (Fonds irlandais ou luxembourgeois (registre ESMA)) : réessaie dans un instant."), incomplet);
  assert.ok(!incomplet.includes("Fonds américain"));
});

test("fiche d'un fonds américain : identité seule, sans exception ni appel aux cours", async () => {
  const m = pageAvecAffichage(["js/style.js", "js/fiche-auto.js"]);
  vm.runInContext("var ANNUAIRE_DATE = '2026-10-01';", m.ctx);
  const e = await m.ctx.entreeParCle("S000002839");
  const html = m.ctx.afficherFicheAuto(e, undefined, { erreurs: [], composition: { fini: true, c: null } }, false);
  for (const attendu of ["Vanguard 500 Index Fund", "VFINX, VFIAX, VOO, VFFSX", "VANGUARD INDEX FUNDS", "Fonds de droit non européen (États-Unis)",
    'href="simulateur.html#S000002839"', 'href="performances.html#S000002839"']) assert.ok(html.includes(attendu), attendu);
  assert.ok(!html.includes("undefined"));
});

test("données réelles : tickers en minuscules, lignes sans ticker ni gestionnaire, clés uniques", async () => {
  const m = monde({ fichiers: { [FICHIER_ZONE]: lire(FICHIER_ZONE) } });
  const zone = await m.ctx.chargerZone("etats-unis");
  assert.ok(zone.lignes.length > 10000);
  const cherche = requete => noms(m.ctx.rechercherZone("etats-unis", requete));
  assert.deepEqual(cherche("ELDFX"), ["ELFUN DIVERSIFIED FUND"]);   // ticker « eldfx » en minuscules dans les données
  assert.deepEqual(cherche("eldfx"), ["ELFUN DIVERSIFIED FUND"]);
  assert.ok(cherche("2x solana").includes("2x Solana ETF"));        // ligne sans ticker
  assert.ok(cherche("kayne anderson energy infrastructure fund").includes("KAYNE ANDERSON ENERGY INFRASTRUCTURE FUND, INC"));   // sans gestionnaire
  assert.deepEqual(cherche("VOO"), ["Vanguard 500 Index Fund"]);

  const cles = new Set();
  for (const l of zone.lignes) {
    const cle = m.ctx.cleEntree(m.ctx.lireEntree(l));
    assert.match(cle, /^S\d{9}$/);
    assert.equal(m.ctx.zoneDeCle(cle), "etats-unis");
    cles.add(cle);
  }
  assert.equal(cles.size, zone.lignes.length, "une clé par ligne");
  for (const l of [zone.lignes[0], zone.lignes[5000], zone.lignes.at(-1)]) {
    const e = await m.ctx.entreeParCle(m.ctx.cleEntree(m.ctx.lireEntree(l)));
    assert.equal(e.nom, l[3]);
  }
  // les ISIN européens qui sont aussi des séries américaines pointent tous vers une ligne de la zone
  const correspondance = vm.runInContext(lire("data/etats-unis-isin.js") + ";ETATS_UNIS_ISIN", vm.createContext({}));
  assert.ok(Object.keys(correspondance).length > 1000);
  for (const serie of Object.values(correspondance)) assert.ok(cles.has(serie), serie);
});

test("données réelles : registre ESMA, clés uniques et informations pour chaque fonds", async () => {
  const m = monde({ fichiers: { [FICHIER_UE]: lire(FICHIER_UE) } });
  const zone = await m.ctx.chargerZone("registres-ue");
  assert.ok(zone.lignes.length > 10000);
  assert.match(zone.maj, /^\d{4}-\d{2}-\d{2}$/);
  const infos = vm.runInContext(lire("data/registres-ue-infos.js") + ";REGISTRES_UE_INFOS", vm.createContext({}));
  const cles = new Set();
  for (const l of zone.lignes) {
    const e = m.ctx.lireEntree(l);
    const cle = m.ctx.cleEntree(e);
    assert.match(cle, /^R\d+$/);
    assert.equal(m.ctx.zoneDeCle(cle), "registres-ue");
    assert.equal(e.isins.length, 0, cle);
    assert.ok(["IE", "LU"].includes(e.pays), cle);
    assert.ok(["OPCVM (UCITS)", "FIA", "ELTIF", "EuVECA", "EuSEF"].includes(e.nature), `${cle} : ${e.nature}`);
    assert.equal(e.public, e.nature === "OPCVM (UCITS)", cle);
    assert.ok(infos[e.cmpId], `${cle} : informations absentes`);
    cles.add(cle);
  }
  assert.equal(cles.size, zone.lignes.length, "une clé par ligne");
  assert.equal((await m.ctx.entreeParCle("R90728")).nom, "GAM Star Absolute Return Macro");
  assert.deepEqual(noms(m.ctx.rechercherZone("registres-ue", "gam star absolute")), ["GAM Star Absolute Return Macro"]);
});

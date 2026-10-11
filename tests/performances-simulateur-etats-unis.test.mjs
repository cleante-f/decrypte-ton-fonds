// Fonds américains (SEC) dans les pages Performances et Simulateur : js/performances.js et js/simulateur.js avec les données
// de js/etats-unis.js. Les deux fichiers touchent la page dès leur chargement : on les exécute dans une page simulée (document
// et éléments factices), avec un fonds de test mis directement dans le morceau de données du navigateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

process.env.TZ = "Europe/Paris";   // les dates s'affichent en heure de Paris

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ---------- Fonds de test (format du contrat Python → JS) ----------

const mois81 = Array.from({ length: 81 }, (_, i) => (i % 5) - 1.5);
const VANGUARD = {
  nom: "VANGUARD 500 INDEX FUND", lei: "12WZ1W76P8QD4VJ6OB47", date: "2026-06-30", actif: 1466764579568, lignes: 508, exclu: 0.01,
  top: [["NVIDIA Corp", 7.51, "US67066G1040"], ["Apple Inc", 6.59, "US0378331005"]],
  pays: [["US", 100.1]], classes: [["Actions", 99.75], ["Monétaire", 0.35]], devises: [["USD", 100.1]],
  parts: [
    ["C000007774", "Admiral Shares", "VFIAX", "2019-10", mois81, [0.04, null, 0.04, 0, null, "2026-04-28"]],
    ["C000092055", "ETF Shares", "VOO", "2019-10", mois81, [0.03, 0.02, null, 3, null, "2026-04-28"]]
  ]
};
// Une part dont le nom est son identifiant de classe, un rendement aberrant, pas de composition
const ABERRANT = { nom: "Fonds a rendement aberrant", lei: "", date: null, actif: null, lignes: 0, exclu: 0, top: [], pays: [], classes: [], devises: [],
  parts: [["C000999999", "", "", "2024-01", [1, 2, 7443.59, 1, -1, 2, 1], null]] };
// Des parts mais aucun rendement, une composition : le simulateur retombe sur un profil type construit sur la composition
const SANS_RENDEMENT = { ...VANGUARD, nom: "Fonds sans rendement", parts: [["C000000001", "Investor", "ABCDX", null, null, [1.2, null, 1.2, 0, null, "2026-04-28"]]] };
const SANS_RIEN = { nom: "Fonds vide", lei: "", date: null, actif: null, lignes: 0, exclu: 0, top: [], pays: [], classes: [], devises: [], parts: [] };

const ligne = (n, nom) => ["S", n, n, nom, "Une structure", "", "", "", "", "US", "", "", "USD", 1, 1];

// ---------- Page simulée ----------

// « Aujourd'hui » est fixé au 11 octobre 2026 dans la page : les textes qui parlent de donnée ancienne ne changent pas avec le temps
const AUJOURDHUI = new Date(2026, 9, 11, 12).getTime();
class DateFixe extends Date {
  constructor(...arguments_) { if (arguments_.length) super(...arguments_); else super(AUJOURDHUI); }
  static now() { return AUJOURDHUI; }
}

// Objet qui accepte tout (propriété, appel, affectation) : les éléments de la page que les tests n'examinent pas
function faux() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : faux()),
    set: () => true,
    apply: () => faux()
  });
}

const SCRIPTS_PERF = ["js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js", "js/style.js",
  "js/affichage.js", "js/nav.js", "js/performances.js"];
const SCRIPTS_SIMU = ["js/mode-site.js", "js/glossaire.js", "js/config.js", "js/outils.js", "js/geco.js", "js/zones.js", "js/etats-unis.js",
  "js/inventaire.js", "js/style.js", "js/composition.js", "js/affichage.js", "js/marches.js", "js/fiche-auto.js", "js/projection.js",
  "js/contexte-fonds.js", "js/graphiques-simu.js", "js/nav.js", "js/simulateur.js"];

function page(scripts) {
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
    location: { hostname: "cleante-f.github.io", hash: "", search: "" }, history: { replaceState() {} }, URLSearchParams,
    fetch: async () => { throw new Error("réseau coupé"); }, alert() {} });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.element = element;
  vm.runInContext(`const ANNUAIRE_DATE = "2026-10-01"; const ETATS_UNIS_ISIN = { US9229083632: "S000002839" };`, ctx);
  for (const f of scripts) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}
// Met un détail dans le morceau de données du navigateur : donneesSec le trouve sans rien charger
function avecDetail(ctx, serie, detail) {
  const k = Number(serie.slice(1)) % 64;
  vm.runInContext(`ETATS_UNIS_DETAILS[${k}] = Object.assign(ETATS_UNIS_DETAILS[${k}] || {}, ${JSON.stringify({ [serie]: detail })});`, ctx);
}
// Références de marché de l'historique long : une série mensuelle plate, sans réseau
function sansReseau(ctx) {
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
}
const sans = html => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");   // le texte, sans les balises
const jour = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// ---------- Performances ----------

test("performances, serieFonds : série SEC en euros, sans fonds jumeau ni part GECO", async () => {
  const ctx = page(SCRIPTS_PERF);
  avecDetail(ctx, "S000002839", VANGUARD);
  const e = ctx.lireEntree(ligne(2839, "Vanguard 500 Index Fund"));
  const s = await ctx.serieFonds(e, undefined);
  assert.equal(s.jumeau, null);
  assert.equal(s.part, null);
  assert.equal(s.parts, null);
  assert.equal(s.sec.serie, "S000002839");
  assert.equal(s.sec.part.ticker, "VOO");   // plusieurs parts dont une « ETF » : celle de l'ETF
  assert.equal(s.dates.length, 82);
  assert.equal(s.valeurs[0], 100);
  assert.equal(jour(s.dates[0]), "30/09/2019");
  assert.equal(jour(s.dates.at(-1)), "30/06/2026");
  assert.equal(s.nom, "Vanguard 500 Index Fund");
});

test("performances, serieFonds : sans rendement exploitable, ou sans données de la SEC, une erreur lisible", async () => {
  const ctx = page(SCRIPTS_PERF);
  avecDetail(ctx, "S000000001", SANS_RENDEMENT);
  avecDetail(ctx, "S000000002", SANS_RIEN);
  await assert.rejects(ctx.serieFonds(ctx.lireEntree(ligne(1, "Fonds sans rendement")), undefined), /aucun rendement mensuel exploitable/);
  await assert.rejects(ctx.serieFonds(ctx.lireEntree(ligne(2, "Fonds vide")), undefined), /aucun rendement mensuel exploitable/);
  await assert.rejects(ctx.serieFonds(ctx.lireEntree(ligne(65, "Fonds absent du morceau")), undefined), /aucune donnée publique/);   // 65 % 64 = 1 : morceau déjà chargé
  // Le morceau de données ne se charge pas : « données de la SEC indisponibles », sans autre exception
  ctx.chargerScript = () => Promise.reject(new Error("réseau"));
  await assert.rejects(ctx.serieFonds(ctx.lireEntree(ligne(64 * 5 + 7, "Fonds hors morceau chargé")), undefined), /données de la SEC indisponibles/);
});

test("performances, afficherSquelette : en-tête, note, source et valeur de la bulle d'une série SEC", async () => {
  const ctx = page(SCRIPTS_PERF);
  avecDetail(ctx, "S000002839", VANGUARD);
  avecDetail(ctx, "S000000003", ABERRANT);
  const E = vm.runInContext("ETAT_PERF", ctx);
  for (const [n, nom, attendu] of [[2839, "Vanguard 500 Index Fund", "Série SEC S000002839 · part « ETF Shares » (VOO)"],
    [3, "Fonds a rendement aberrant", "Série SEC S000000003 · part « C000999999 »"]]) {
    const e = ctx.lireEntree(ligne(n, nom));
    const principal = await ctx.serieFonds(e, undefined);
    E.principal = { ...principal, cle: "principal", nomCourt: nom };
    E.comparaisons = [];
    ctx.afficherSquelette(e, undefined, E.principal);
    const html = sans(ctx.element("resultat").innerHTML);
    assert.ok(html.includes(attendu), attendu);
    assert.ok(html.includes("Rendements mensuels déclarés à la SEC (formulaire N-PORT), convertis en euros (taux BCE de fin de mois) : un point par mois."));
    assert.ok(html.includes("Source : SEC – EDGAR (formulaires N-PORT), converti en euros (taux BCE)"));
    assert.ok(!html.includes("valeur calculée de façon mensuelle"), "un point par mois est un rythme de déclaration");
    assert.ok(!html.includes("Performances calculées sur la valeur liquidative"));
    assert.ok(!html.includes("(base GECO)"));
    assert.equal(html.includes("Un ou plusieurs rendements mensuels aberrants déclarés à la SEC ont été écartés."), n === 3);
  }
});

test("performances, bulle du graphique : « Valeur en euros (base 100) » pour une série SEC, valeur liquidative sinon", async () => {
  const ctx = page(SCRIPTS_PERF);
  avecDetail(ctx, "S000002839", VANGUARD);
  const E = vm.runInContext("ETAT_PERF", ctx);
  const e = ctx.lireEntree(ligne(2839, "Vanguard 500 Index Fund"));
  E.principal = { ...(await ctx.serieFonds(e, undefined)), cle: "principal", nomCourt: "Vanguard", couleur: 0 };
  E.comparaisons = [];
  const bulle = { hidden: true, innerHTML: "", style: {}, offsetWidth: 100 };
  const graphique = ctx.element("graphique");
  const normal = graphique.querySelector;
  graphique.querySelector = sel => (sel === ".bulle-perf" ? bulle : normal(sel));
  ctx.dessinerGraphique();
  E.survol = 3;
  ctx.majSurvol();
  assert.match(sans(bulle.innerHTML), /Valeur en euros \(base 100\) : \d+(,\d+)?$/);
  assert.ok(!bulle.innerHTML.includes("Valeur liquidative"));
  E.principal = { ...E.principal, sec: undefined, jumeau: null, part: { parRefDevCode: "EUR" } };
  ctx.majSurvol();
  assert.match(sans(bulle.innerHTML), /Valeur liquidative : \d/);
});

test("performances, listePerf : un fonds européen qui est une série américaine annonce les rendements de la SEC", () => {
  const ctx = page(SCRIPTS_PERF);
  const vooEurope = ctx.lireEntree(["E", 0, 0, "Vanguard 500 Index Fund Registered Shares ETF o.N.", "", "", "", "US9229083632", "", "US", "", "", "USD", 1, 1]);
  const autre = ctx.lireEntree(["E", 0, 0, "Autre fonds européen", "", "", "", "IE0000000001", "", "IE", "", "", "USD", 1, 1]);
  const americain = ctx.lireEntree(ligne(2839, "Vanguard 500 Index Fund"));
  const petit = (html, nom) => sans(html.split("<li>").find(l => l.includes(nom)));
  let html = ctx.listePerf([vooEurope, autre, americain], "vanguard");
  assert.ok(petit(html, "Vanguard 500 Index Fund Registered").includes("rendements déclarés à la SEC"));
  assert.ok(!petit(html, "Vanguard 500 Index Fund Registered").includes("pas d'historique public"));
  assert.ok(petit(html, "Autre fonds européen").includes("pas d'historique public"));
  assert.ok(petit(html, "Vanguard 500 Index Fund</a>").includes("fonds américain (données de la SEC)"));
  // un fonds jumeau n'est plus annoncé quand la SEC donne les rendements ; il l'est toujours pour un fonds sans série américaine
  vm.runInContext("trouverJumeau = () => ({ fonds: { nom: 'Jumeau' } });", ctx);
  html = ctx.listePerf([vooEurope, autre], "vanguard");
  assert.ok(!petit(html, "Vanguard 500 Index Fund Registered").includes("via un fonds qui suit le même indice"));
  assert.ok(petit(html, "Vanguard 500 Index Fund Registered").includes("rendements déclarés à la SEC"));
  assert.ok(petit(html, "Autre fonds européen").includes("via un fonds qui suit le même indice"));
});

test("performances, debutPeriode : une série qui finit un dernier jour de mois commence à la fin du mois voulu", () => {
  const ctx = page(SCRIPTS_PERF);
  const f = (periode, fin) => jour(ctx.debutPeriode(periode, fin, new Date(2019, 8, 30)));
  assert.equal(f("1m", new Date(2026, 5, 30)), "31/05/2026");
  assert.equal(f("6m", new Date(2026, 5, 30)), "31/12/2025");
  assert.equal(f("1a", new Date(2026, 1, 28)), "28/02/2025");
  assert.equal(f("1m", new Date(2026, 2, 31)), "28/02/2026");
  assert.equal(f("ytd", new Date(2026, 5, 30)), "31/12/2025");
  assert.equal(f("1m", new Date(2026, 9, 5)), "05/09/2026");   // pas un dernier jour de mois : inchangé
});

test("performances, sourcesMixtes : la source de l'autre famille de fonds s'ajoute", () => {
  const ctx = page(SCRIPTS_PERF);
  const { sourcesMixtes } = ctx;
  const sec = { sec: true }, geco = { cle: "fonds-FR0010135103" };
  assert.equal(sourcesMixtes({ sec: true }, []), "");
  assert.equal(sourcesMixtes({ sec: true }, [{ cle: "ref-monetaire" }, sec]), "");
  assert.match(sourcesMixtes({ sec: true }, [geco]), /^ et valeurs liquidatives publiées par l'AMF \(base GECO\)$/);
  assert.match(sourcesMixtes({ sec: true }, [{ cle: "ref-monde" }]), /AMF/);
  assert.equal(sourcesMixtes({}, [geco, { cle: "ref-livrets" }]), "");
  assert.match(sourcesMixtes({}, [{ ...sec, cle: "fonds-S000002839" }]), /^ et rendements mensuels déclarés à la SEC/);
});

// ---------- Simulateur ----------

async function analyse(detail, n, nom = "Fonds américain " + n, ajuster = () => {}) {
  const ctx = page(SCRIPTS_SIMU);
  sansReseau(ctx);
  if (detail) avecDetail(ctx, "S" + String(n).padStart(9, "0"), detail);   // sans détail, le morceau de données n'est pas préchargé
  ajuster(ctx);
  const e = ctx.lireEntree(ligne(n, nom));
  const A = await ctx.chargerAnalyse(e, undefined);
  const S = vm.runInContext("S", ctx);
  S.chargement = { entree: e, isin: undefined };
  S.fonds = A;
  return { ctx, A, e };
}

test("simulateur, chargerAnalyse : les rendements SEC remplacent le fonds jumeau, la composition donne l'exposition", async () => {
  const { A } = await analyse(VANGUARD, 2839, "Vanguard 500 Index Fund");
  assert.equal(A.sourceHistorique, "sec");
  assert.equal(A.sourceExpo, "sec");
  assert.equal(A.jumeau, undefined);
  assert.equal(A.st, undefined, "pas d'analyse des rendements sur une série mensuelle de la SEC");
  assert.deepEqual(JSON.parse(JSON.stringify(A.expo)), [{ cle: "usa", poids: 100 }]);
  assert.equal(A.compo, A.sec.compo);
  assert.equal(A.compo.principale, "sec");
  assert.equal(A.compoEnCours, undefined);
  assert.equal(A.comb.nbReels, 81);
  assert.ok(A.comb.nbReconstitues > 100, "historique d'avant 2019 reconstitué");
  assert.equal(A.comb.mois.at(-1), "2026-06");
  assert.equal(jour(A.derniereVL), "30/06/2026");
  assert.equal(A.ter, 0.02, "frais nets de la part ETF, plus bas que les frais bruts");
  assert.equal(A.terSource, "sec");
  assert.equal(A.entreeMax, 3);
});

test("simulateur, textes d'un fonds américain : carte, options, méthode, source de la composition", async () => {
  const { ctx, A } = await analyse(VANGUARD, 2839, "Vanguard 500 Index Fund");
  const carte = sans(ctx.carteFonds(A));
  assert.ok(carte.includes("Frais courants 0,02 % (prospectus SEC)"));
  assert.ok(carte.includes("Dernier rendement mensuel utilisé : juin 2026 (SEC – N-PORT), part « ETF Shares » (VOO)."));
  assert.ok(!carte.includes("valeur liquidative"));
  assert.ok(!carte.includes("donnée ancienne"), "juin 2026 n'est pas encore ancien en octobre 2026");
  const options = sans(ctx.optionsAvancees());
  assert.ok(options.includes("Lus dans le prospectus déposé à la SEC : 0,02 %."));
  assert.ok(options.includes("Le prospectus déposé à la SEC prévoit jusqu'à 3,0 %"));
  const rappel = sans(ctx.rappelFrais({ A, P: { frais: { courants: A.ter, entree: 0 } } }));
  assert.ok(rappel.includes("(prospectus SEC)") && rappel.includes("jusqu'à 3,0 % selon le prospectus SEC"));
  const historique = sans(ctx.carteHistorique(A));
  assert.ok(historique.includes("reconstitué à partir de sa composition (dernier inventaire déposé à la SEC)"));
  assert.ok(historique.includes("rendements mensuels déclarés à la SEC (EDGAR, formulaires N-PORT), convertis en euros"));
  assert.ok(!historique.includes("AMF (base GECO)"));
  const C = ctx.calculer(A);
  const methode = sans(ctx.comprendre(C));
  assert.ok(methode.includes("Historique mensuel du fonds : 81 mois réels (rendements déclarés à la SEC, convertis en euros au taux BCE) et "));
  assert.ok(methode.includes("mois reconstitués"));
  assert.ok(methode.includes("inventaire N-PORT du 30/06/2026 (SEC – EDGAR)"));
  assert.ok(methode.includes("Frais : prospectus déposé à la SEC (résumé du 28/04/2026), frais nets de la part « ETF Shares » (VOO)"));
  assert.ok(!methode.includes("valeur calculée de façon mensuelle"));
  assert.ok(!methode.includes("rendements mensuels aberrants"));
  assert.ok(sans(ctx.panneauContexte()).includes("Inventaire N-PORT du 30/06/2026 (SEC – EDGAR), rendements mensuels déclarés à la SEC convertis en euros (taux BCE)."));
  // Comparaison avec un second fonds américain : la provenance des frais est rappelée sous le chiffre
  avecDetail(ctx, "S000000010", VANGUARD);
  const autre = ctx.lireEntree(ligne(10, "Autre fonds américain"));
  const S = vm.runInContext("S", ctx);
  S.calc = C;
  S.comparaisons = [{ entree: autre, isin: undefined, A: await ctx.chargerAnalyse(autre, undefined) }];
  assert.ok(sans(ctx.panneauComparer()).includes("0,02 % (prospectus SEC)"));
});

test("simulateur : fonds américain sans frais publiés, l'hypothèse est à vérifier dans le prospectus, jamais dans un DIC", async () => {
  const sansFrais = { ...VANGUARD, parts: [["C000000005", "Class A", "ABCDX", "2019-10", mois81, null]] };
  const { ctx, A } = await analyse(sansFrais, 5, "Fonds sans frais");
  assert.equal(A.terSource, "hypothese");
  const options = sans(ctx.optionsAvancees());
  assert.ok(options.includes("hypothèse de 0,25 %, à vérifier dans le prospectus."), options);
  assert.ok(!options.includes("DIC"));
  // comparaison avec un autre fonds américain sans frais : la note sous le tableau
  avecDetail(ctx, "S000000006", sansFrais);
  const autre = ctx.lireEntree(ligne(6, "Autre fonds sans frais"));
  const S = vm.runInContext("S", ctx);
  S.calc = ctx.calculer(A);
  S.comparaisons = [{ entree: autre, isin: undefined, A: await ctx.chargerAnalyse(autre, undefined) }];
  const comparaison = sans(ctx.panneauComparer());
  assert.ok(comparaison.includes("* frais non disponibles automatiquement : hypothèse à vérifier dans le prospectus."), comparaison);
  assert.ok(!comparaison.includes("DIC"));
  // le texte suit la provenance des fonds : DIC pour un fonds européen, prospectus pour un fonds américain, les deux si les deux sont là
  const fr = { entree: { source: "E" }, A: { terSource: "hypothese" } }, us = { entree: { source: "S" }, A: { terSource: "hypothese" } };
  assert.equal(ctx.documentDesFrais([fr]), "le DIC");
  assert.equal(ctx.documentDesFrais([us]), "le prospectus");
  assert.equal(ctx.documentDesFrais([fr, us]), "le DIC ou le prospectus");
  assert.equal(ctx.documentDesFrais([fr, { entree: { source: "S" }, A: { terSource: "sec" } }]), "le DIC", "un fonds dont les frais sont connus ne compte pas");
});

test("simulateur : rendement aberrant écarté signalé ; sans composition, profil type et reconstitution d'avant 2019 comme un fonds français", async () => {
  const { ctx, A } = await analyse({ ...ABERRANT, parts: [["C000999999", "", "", "2019-01", Array.from({ length: 90 }, (_, i) => (i === 10 ? 7443.59 : 1)), [2, null, 2, 0, null, null]]] }, 3);
  assert.equal(A.sourceHistorique, "sec");
  assert.equal(A.sourceExpo, "defaut");
  assert.equal(A.comb.nbReels, 79, "la série commence après le rendement aberrant");
  assert.ok(A.comb.nbReconstitues > 100, "le profil type par défaut reconstitue le passé, comme pour un fonds français");
  assert.equal(A.comb.mois[A.comb.nbReconstitues], "2019-12", "l'historique réel suit la reconstitution sans trou");
  assert.equal(A.terSource, "sec");
  assert.equal(A.ter, 2);
  assert.equal(A.compo, null);
  assert.equal(A.entreeMax, 0);
  assert.ok(sans(ctx.comprendre(ctx.calculer(A))).includes("Un ou plusieurs rendements mensuels aberrants déclarés à la SEC ont été écartés."));
  assert.ok(sans(ctx.carteHistorique(A)).includes("Historique réel du fonds depuis"));
  const methode = sans(ctx.comprendre(ctx.calculer(A)));
  assert.ok(methode.includes("79 mois réels (rendements déclarés à la SEC, convertis en euros au taux BCE) et "));
  assert.ok(/ et \d+ mois reconstitués/.test(methode));
  assert.ok(methode.includes("profil type déduit de la classification ou du nom"));
});

test("simulateur : un historique SEC trop court est complété faute de mieux, même sans composition", async () => {
  const { A } = await analyse({ ...SANS_RIEN, parts: [["C000000004", "Class A", "ABCAX", "2025-01", Array(14).fill(1), [1, null, 1, 0, null, null]]] }, 4);
  assert.equal(A.comb.nbReels, 14);
  assert.ok(A.comb.nbReconstitues > 0);
  assert.equal(A.sourceExpo, "defaut");
});

test("simulateur : fonds américain sans rendement, retour au profil type (sans exception) avec composition et frais de la SEC", async () => {
  const { ctx, A } = await analyse(SANS_RENDEMENT, 1, "Fonds sans rendement");
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.sourceExpo, "sec");
  assert.equal(A.terSource, "sec");
  assert.equal(A.comb.nbReels, 0);
  assert.equal(A.derniereVL, null);
  const carte = sans(ctx.carteFonds(A));
  assert.ok(carte.includes("profil type") && carte.includes("sa composition déclarée à la SEC"));
  assert.ok(!carte.includes("Dernier rendement mensuel"));
  assert.ok(!carte.includes("n'ont pas pu être chargées"));
  const historique = sans(ctx.carteHistorique(A));   // aucun mois réel : ne doit pas lire un mois qui n'existe pas
  assert.ok(historique.includes("Pas d'historique réel pour ce fonds"));
  assert.ok(sans(ctx.comprendre(ctx.calculer(A))).includes("Historique mensuel du fonds : 0 mois réels et "));
});

// Sans rendement publié, rien ne vient de l'AMF : les lignes de provenance parlent du profil type (et de la SEC si sa composition
// ou ses frais ont servi) ; la carte du fonds montre « Série SEC <clé> » et non « ISIN non publié ».
const textesProvenance = (ctx, A) => ({
  carte: sans(ctx.carteFonds(A)), historique: sans(ctx.carteHistorique(A)), methode: sans(ctx.comprendre(ctx.calculer(A))), contexte: sans(ctx.panneauContexte())
});
const sansAmf = textes => { for (const [nom, t] of Object.entries(textes)) assert.ok(!/AMF|GECO|valeur liquidative|valeurs liquidatives/.test(t), `${nom} : ${t.match(/.{40}(AMF|GECO|valeurs? liquidatives?).{40}/)}`); };

test("simulateur, fonds américain sans rendement : provenance « profil type » (et SEC pour la composition et les frais), jamais l'AMF", async () => {
  const { ctx, A } = await analyse(SANS_RENDEMENT, 1, "Fonds sans rendement");
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.sourceExpo, "sec");
  assert.equal(A.terSource, "sec");
  const t = textesProvenance(ctx, A);
  sansAmf(t);
  assert.ok(t.carte.includes("Série SEC S000000001"), t.carte);
  assert.ok(!t.carte.includes("ISIN non publié"));
  assert.ok(t.historique.includes("Données brutes : profil type, faute de rendement publié pour ce fonds ; composition et frais : SEC (EDGAR)"), t.historique);
  assert.ok(t.methode.includes("Source : profil type, faute de rendement publié pour ce fonds ; composition et frais : SEC (EDGAR)."), t.methode);
  assert.ok(t.contexte.includes("Inventaire N-PORT du 30/06/2026 (SEC – EDGAR)"));
});

test("simulateur, fonds américain sans rendement ni composition : profil type seul, la SEC n'est citée que si elle a servi", async () => {
  // Rien de la SEC : ni composition ni frais
  let { ctx, A } = await analyse(SANS_RIEN, 2, "Fonds vide");
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.sourceExpo, "defaut");
  assert.equal(A.terSource, "hypothese");
  let t = textesProvenance(ctx, A);
  sansAmf(t);
  assert.ok(t.carte.includes("Série SEC S000000002") && !t.carte.includes("ISIN non publié"));
  assert.ok(t.historique.includes("Données brutes : profil type, faute de rendement publié pour ce fonds ; fonds de référence :"), t.historique);
  assert.ok(!/Données brutes : [^.]*SEC/.test(t.historique), t.historique);
  assert.ok(t.methode.includes("Source : profil type, faute de rendement publié pour ce fonds."), t.methode);
  assert.ok(!t.methode.includes("composition et frais : SEC"));
  assert.ok(t.contexte.includes("Profil type déduit de la classification ou du nom du fonds (pas d'analyse possible)."), t.contexte);
  // Frais de la SEC seulement
  ({ ctx, A } = await analyse({ ...SANS_RIEN, parts: [["C000000005", "Class A", "ABCAX", null, null, [1.1, 0.9, 1, 0, null, "2026-04-28"]]] }, 6, "Fonds avec frais"));
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.terSource, "sec");
  t = textesProvenance(ctx, A);
  sansAmf(t);
  assert.ok(t.historique.includes("Données brutes : profil type, faute de rendement publié pour ce fonds ; frais : SEC (EDGAR)"), t.historique);
  // Données de la SEC injoignables : profil type, la SEC n'est pas citée comme source
  ({ ctx, A } = await analyse(null, 64 * 5 + 7, "Fonds hors morceau chargé", c => { c.chargerScript = () => Promise.reject(new Error("réseau")); }));
  t = textesProvenance(ctx, A);
  sansAmf(t);
  assert.ok(t.carte.includes("Série SEC S000000327"), t.carte);
  assert.ok(!/Données brutes : [^.]*SEC/.test(t.historique), t.historique);
});

test("simulateur, fonds américain avec rendements mais sans composition : l'exposition n'est pas attribuée à l'AMF", async () => {
  const { ctx, A } = await analyse(ABERRANT, 3, "Fonds a rendement aberrant");
  assert.equal(A.sourceHistorique, "sec");
  assert.equal(A.compo, null);
  const contexte = sans(ctx.panneauContexte());
  assert.ok(!/AMF|GECO/.test(contexte), contexte);
  assert.ok(contexte.includes("Profil type déduit de la classification ou du nom du fonds (pas d'analyse possible), rendements mensuels déclarés à la SEC convertis en euros (taux BCE)."), contexte);
});

test("simulateur : fonds avec historique de l'AMF, textes d'avant (valeurs liquidatives, AMF – GECO, ISIN)", async () => {
  // Un fonds de la base GECO suit le chemin « reel » : on reprend une analyse et on la fait passer pour telle
  const { ctx, A } = await analyse(VANGUARD, 2839, "Vanguard 500 Index Fund");
  A.entree = ctx.lireEntree(["G", 1, 1, "Carmignac Patrimoine", "Carmignac Gestion", "Fonds mixtes", "FCP", "FR0010135103", "1989-11-07", "FR", "", "", "EUR", 0, 1]);
  A.isin = "FR0010135103";
  A.sourceHistorique = "reel";
  A.sourceExpo = "defaut";
  A.terSource = "hypothese";
  A.sec = undefined;
  A.compo = null;
  const carte = sans(ctx.carteFonds(A));
  assert.ok(carte.includes("FR0010135103 · Carmignac Gestion"), carte);
  assert.ok(carte.includes("Dernière valeur liquidative utilisée : 30/06/2026 (AMF – GECO)"), carte);
  assert.ok(sans(ctx.carteHistorique(A)).includes("Données brutes : valeurs liquidatives publiées par l'AMF (base GECO)"));
  assert.ok(sans(ctx.comprendre(ctx.calculer(A))).includes("Source : AMF (GECO), dernière valeur liquidative du 30/06/2026."));
  assert.ok(sans(ctx.panneauContexte()).includes("Analyse des rendements (valeurs liquidatives AMF, taux BCE)."));
});

test("simulateur : fonds américain sans aucune donnée utile, hypothèses habituelles", async () => {
  const { ctx, A } = await analyse(SANS_RIEN, 2, "Fonds vide");
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.sourceExpo, "defaut");
  assert.equal(A.terSource, "hypothese");
  assert.equal(A.ter, 0.25, "ETF sans frais publiés : 0,25 %");
  assert.equal(A.compo, null);
  const carte = sans(ctx.carteFonds(A));
  assert.ok(carte.includes("Frais courants 0,25 % (hypothèse)"));
  assert.ok(carte.includes("Aucun rendement mensuel dans les données de la SEC pour ce fonds"));
});

test("simulateur : morceau de données de la SEC indisponible, retour au chemin habituel et message", async () => {
  const { ctx, A } = await analyse(null, 64 * 5 + 7, "Fonds hors morceau chargé", c => { c.chargerScript = () => Promise.reject(new Error("réseau")); });
  assert.equal(A.secIndisponible, true);
  assert.equal(A.sec, undefined);
  assert.equal(A.sourceHistorique, "profil");
  assert.equal(A.terSource, "hypothese");
  assert.ok(sans(ctx.carteFonds(A)).includes("Les données de la SEC sur ce fonds n'ont pas pu être chargées"));
});

test("simulateur : fonds avec rendements anciens, donnée ancienne signalée", async () => {
  const { ctx, A } = await analyse({ ...VANGUARD, parts: [["C000007774", "Admiral Shares", "VFIAX", "2018-01", Array(48).fill(1), [0.04, null, 0.04, 0, null, null]]] }, 5);
  assert.equal(jour(A.derniereVL), "31/12/2021");
  assert.ok(sans(ctx.carteFonds(A)).includes("Dernier rendement mensuel utilisé : décembre 2021 (SEC – N-PORT), part « Admiral Shares » (VFIAX) — donnée ancienne."));
});

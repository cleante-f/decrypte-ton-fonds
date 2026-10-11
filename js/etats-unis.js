/*
 * Fonds américains (SEC) : les données d'un fonds, dans le navigateur.
 *
 * Les détails de tous les fonds sont dans data/etats-unis/NN.js (NN = numéro de série % 64, sur deux chiffres) : chaque fichier
 * ajoute ses fonds à ETATS_UNIS_DETAILS, et le navigateur ne télécharge que celui dont il a besoin, à l'ouverture d'un fonds.
 * Chaque fonds (« Detail », écrit par scripts/construire_etats_unis.py) contient :
 *   { nom, lei, date: "AAAA-MM-JJ"|null, actif, lignes, exclu,
 *     top: [[nom, poids, isin|null]…], pays: [[code, poids]…], classes: [[classe, poids]…], devises: [[code, poids]…],
 *     parts: [[classe, nom, ticker, debut "AAAA-MM"|null, rendements [%|null…]|null, frais [brut, net, gestion, entrée, sortie, date]|null]…] }
 * Les rendements sont déjà convertis en euros par le script. Beaucoup de données manquent (219 séries sans détail, 1 527 fonds
 * sans composition, des fonds sans part ni rendement) : rien ici ne doit planter, une donnée absente donne null.
 *
 * Ce fichier produit les mêmes objets que le reste du site (historique { dates, valeurs }, statistiques de geco.js,
 * composition de composition.js) pour que les fiches et le simulateur les affichent sans cas particulier.
 * Il se sert de js/zones.js (chargerScript) et, pour la composition seulement, de js/inventaire.js (NOMS_PAYS, ZONE_PAR_PAYS,
 * regrouper) : la page Performances n'a pas ce dernier, d'où l'option `composition: false` de donneesSec.
 *
 * Ne pas renommer ce fichier avec un nom que les bloqueurs de publicités connaissent (analyse.js, tracking.js…).
 */

const ETATS_UNIS_DETAILS = {};     // rempli par data/etats-unis/NN.js : ETATS_UNIS_DETAILS[n % 64] = { "S000002839": Detail, … }
const MORCEAUX_ETATS_UNIS = 64;    // nombre de fichiers de détails

// ---------- Série et morceau de données ----------

const _possede = (objet, cle) => Object.prototype.hasOwnProperty.call(objet, cle);

// Série SEC (« S000002839 ») d'un fonds de l'annuaire : sa propre clé pour un fonds américain ; pour un fonds européen,
// la série qui a le même LEI que lui (ETATS_UNIS_ISIN), d'après l'ISIN demandé puis les ISIN de l'entrée. Sinon null.
function serieSecDe(entree, isin) {
  if (entree && entree.source === "S") return cleEntree(entree);
  if (typeof ETATS_UNIS_ISIN === "undefined") return null;
  const serieDe = i => (typeof i === "string" && _possede(ETATS_UNIS_ISIN, i) ? ETATS_UNIS_ISIN[i] : null);
  const demandee = serieDe(isin);
  if (demandee) return demandee;
  for (const i of (entree && entree.isins) || []) {
    const serie = serieDe(i);
    if (serie) return serie;
  }
  return null;
}

// Détail d'une série (ou null si elle n'a pas de détail). Charge le morceau de données au besoin ; rejette si le fichier
// ne se charge pas (réseau, délai dépassé) : ce n'est pas la même chose que « pas de données ».
async function chargerDetailSec(serie) {
  if (typeof serie !== "string" || !/^S\d{9}$/.test(serie)) return null;
  const k = Number(serie.slice(1)) % MORCEAUX_ETATS_UNIS;
  if (!ETATS_UNIS_DETAILS[k]) {
    const fichier = `data/etats-unis/${String(k).padStart(2, "0")}.js`;
    const promesse = chargerScript(fichier);
    await promesse;
    if (!ETATS_UNIS_DETAILS[k]) {
      if (_scriptsCharges.get(fichier) === promesse) _scriptsCharges.delete(fichier);   // fichier inattendu : le prochain appel le recharge
      throw new Error(`${fichier} ne définit pas le morceau ${k}`);
    }
  }
  const morceau = ETATS_UNIS_DETAILS[k];
  return _possede(morceau, serie) ? morceau[serie] : null;
}

// ---------- Parts ----------

// Une part du fichier [classe, nom, ticker, debut, rendements, frais] sous forme d'objet. Un nom vide (53 cas dans les données)
// est remplacé par le ticker, à défaut par l'identifiant de la classe. Une part déjà lue est rendue telle quelle.
function lirePartSec(t) {
  if (t && !Array.isArray(t)) return t;
  const a = Array.isArray(t) ? t : [];
  return { classe: a[0] ?? "", nom: a[1] || a[2] || a[0] || "", ticker: a[2] ?? "", debut: a[3] ?? null, rendements: a[4] ?? null, frais: a[5] ?? null };
}

// La part qui représente le fonds : la seule s'il n'y en a qu'une ; pour un ETF, celle dont le nom contient « ETF » ;
// sinon celle qui a le plus de mois de rendement (à égalité, la première). null s'il n'y a aucune part.
function partSec(detail, entree) {
  const parts = ((detail && detail.parts) || []).map(lirePartSec);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  if (entree && entree.etf) {
    const etf = parts.find(p => /etf/i.test(p.nom));
    if (etf) return etf;
  }
  const mois = p => (Array.isArray(p.rendements) ? p.rendements.filter(r => typeof r === "number").length : 0);
  let meilleure = parts[0];
  for (const p of parts) if (mois(p) > mois(meilleure)) meilleure = p;
  return meilleure;
}

// ---------- Historique et statistiques ----------

// Un rendement mensuel hors de cette fourchette est une erreur de la SEC (vu : +7 443,59 % en un mois) : il compte comme un mois manquant
const RENDEMENT_SEC_MIN = -99.99, RENDEMENT_SEC_MAX = 300;

// Valeurs d'une part en euros (base 100) d'après ses rendements mensuels. `debut` est le mois du premier rendement ("AAAA-MM").
// La série commence après le dernier mois manquant (null, ou rendement aberrant) : le premier point (100) est la fin du mois qui
// précède le premier mois gardé, chaque point suivant est une fin de mois. Renvoie { dates, valeurs, ignores } où `ignores`
// dit si un rendement aberrant a été écarté, ou null s'il ne reste aucun mois.
function serieEurosDepuisRendements(debut, rendements) {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof debut === "string" ? debut : "");
  if (!m || !Array.isArray(rendements) || !rendements.length) return null;
  const annee = Number(m[1]), mois = Number(m[2]);
  if (mois < 1 || mois > 12) return null;

  let premier = 0, ignores = false;   // premier : indice du premier mois gardé
  rendements.forEach((r, i) => {
    const nombre = typeof r === "number" && isFinite(r);
    if (nombre && r >= RENDEMENT_SEC_MIN && r <= RENDEMENT_SEC_MAX) return;
    if (nombre) ignores = true;
    premier = i + 1;
  });
  if (premier >= rendements.length) return null;

  const finDuMois = i => new Date(annee, mois + i, 0);   // dernier jour du mois d'indice i (0 = mois de `debut`)
  const dates = [finDuMois(premier - 1)], valeurs = [100];
  for (let i = premier; i < rendements.length; i++) {
    dates.push(finDuMois(i));
    valeurs.push(valeurs[valeurs.length - 1] * (1 + rendements[i] / 100));
  }
  return { dates, valeurs, ignores };
}

// Mêmes statistiques que statistiques() (geco.js) pour une série mensuelle. Une fenêtre de k mois n'existe que si la série
// compte au moins k + 1 points. Volatilité : écart type des rendements logarithmiques mensuels × √12 ; performance annualisée.
// Les chiffres sont en %. La perte maximale porte sur toute la série.
function statsSec(h) {
  if (!h || !h.valeurs || !h.dates || h.valeurs.length < 2) return null;
  const v = h.valeurs, d = h.dates, n = v.length;
  const perf = k => (n >= k + 1 ? (Math.pow(v[n - 1] / v[n - 1 - k], 12 / k) - 1) * 100 : null);
  const volatilite = k => {
    if (n < k + 1) return null;
    const r = [];
    for (let i = n - k; i < n; i++) r.push(Math.log(v[i] / v[i - 1]));
    const moy = r.reduce((s, x) => s + x, 0) / r.length;
    const variance = r.reduce((s, x) => s + (x - moy) ** 2, 0) / (r.length - 1);
    return Math.sqrt(variance * 12) * 100;
  };
  let sommet = v[0], iSommet = 0, pire = 0, iPireSommet = 0, iPireCreux = 0;
  for (let i = 1; i < n; i++) {
    if (v[i] > sommet) { sommet = v[i]; iSommet = i; }
    const baisse = v[i] / sommet - 1;
    if (baisse < pire) { pire = baisse; iPireSommet = iSommet; iPireCreux = i; }
  }
  const moisAn = date => date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return {
    frequence: "mensuelle",
    perf: { a1: perf(12), a3: perf(36), a5: perf(60) },
    volatilite: { a1: volatilite(12), a3: volatilite(36), a5: volatilite(60) },
    maxDrawdown: { valeur: pire * 100, periode: `${moisAn(d[iPireSommet])} → ${moisAn(d[iPireCreux])}` },
    depuis: d[0], jusqua: d[n - 1]
  };
}

// ---------- Composition ----------

const _arrondi2 = x => Math.round(x * 100) / 100;

// Composition au format de assemblerComposition (composition.js), d'après le dernier rapport N-PORT du fonds. null sans date
// de rapport (le fonds n'a pas de composition). Les « N/A » de N-PORT veulent dire « inconnu ». `maintenant` sert à juger
// de l'âge du rapport.
function compositionDepuisSec(detail, maintenant = new Date()) {
  if (!detail || !detail.date) return null;
  const notes = [];

  const pays = (detail.pays || []).map(([code, poids]) => {
    const connu = code && code !== "N/A";
    return { nom: connu ? NOMS_PAYS[code] || code : "Non précisé", code: connu ? code : null, poids };
  });
  const zonesMap = new Map();
  for (const p of pays) {
    const zone = p.code ? ZONE_PAR_PAYS(p.code) : "Autres";
    zonesMap.set(zone, (zonesMap.get(zone) || 0) + p.poids);
  }
  const zones = [...zonesMap.entries()].map(([nom, poids]) => ({ nom, poids: _arrondi2(poids) })).sort((a, b) => b.poids - a.poids);

  // Des poids au-dessus de 100 ou négatifs existent (effet de levier, emprunts) : rien n'est supposé entre 0 et 100
  const classes = (detail.classes || []).map(([nom, poids]) => ({ nom, poids }));
  const somme = classes.reduce((s, c) => s + c.poids, 0);
  const liquidites = _arrondi2(100 - somme);
  if (classes.length && liquidites > 0.5) classes.push({ nom: "Liquidités et autres", poids: liquidites });

  const devises = (detail.devises || []).map(([code, poids]) => ({ nom: code && code !== "N/A" ? code : "Non précisée", poids }));
  const top10 = (detail.top || []).slice(0, 10).map(([nom, poids, isin]) =>
    ({ nom: nom && nom !== "N/A" ? nom : "Position sans nom", poids, isin: isin && isin !== "N/A" ? isin : null }));

  if (detail.exclu >= 1) notes.push({ type: "derives", texte: `Les produits dérivés et les positions vendeuses (${pct(detail.exclu, 1)} de l'actif net) ne sont pas comptés dans ces répartitions.` });
  if (somme > 110) notes.push({ type: "levier", texte: `Les positions déclarées représentent ${pct(somme, 0)} de l'actif net : le fonds utilise un effet de levier (emprunts ou produits dérivés).` });
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(detail.date);
  if (date && maintenant > new Date(Number(date[1]), Number(date[2]) - 1 + 9, Number(date[3]))) {   // plus de 9 mois
    notes.push({ type: "ancien", texte: `Attention : le dernier inventaire déposé à la SEC date du ${date[3]}/${date[2]}/${date[1]}. La composition a pu changer depuis.` });
  }

  const fonds = classes.find(c => c.nom === "Fonds (OPC)");
  return {
    inventaire: null, style: null, qualite: null,
    principale: "sec",
    sec: { date: detail.date, lignes: detail.lignes, exclu: detail.exclu },
    pays: regrouper(pays, 12), zones, secteurs: [], classes, devises: regrouper(devises, 8), top10,
    couvertureChange: false,
    lignesSontDesFonds: !!fonds && fonds.poids >= 50,
    notes
  };
}

// ---------- Frais ----------

const FRAIS_SEC_MAX = 20;   // au-delà de 20 % par an, la valeur est une erreur de lecture du prospectus

// Frais d'une part, en % par an : { brut, net, gestion, entree, sortie, date, retenu } ou null sans frais. Accepte une part lue
// (lirePartSec), une part du fichier ou le tableau de frais seul. `retenu` est le chiffre à utiliser pour les alertes et le
// simulateur : les frais nets s'ils existent et ne dépassent pas les frais bruts, sinon les frais bruts.
function fraisSec(part) {
  let f = null;
  if (Array.isArray(part)) f = typeof part[0] === "string" ? part[5] : part;
  else if (part && typeof part === "object") f = part.frais;
  if (!Array.isArray(f) || !f.length) return null;
  const taux = x => (typeof x === "number" && isFinite(x) && x <= FRAIS_SEC_MAX ? x : null);
  const [brut, net, gestion, entree, sortie] = f.slice(0, 5).map(taux);
  const retenu = net !== null && (brut === null || net <= brut) ? net : brut;
  return { brut, net, gestion, entree, sortie, date: f[5] || null, retenu };
}

// ---------- Expositions pour le simulateur ----------

// Zone de la composition → référence du simulateur (FACTEURS, style.js). Les pays sans zone connue sont comptés comme américains.
const CLE_PAR_ZONE_SEC = { "Amérique du Nord": "usa", "Autres": "usa", "Zone euro": "euro", "Europe hors zone euro": "europe",
  "Asie-Pacifique développée": "japon", "Pays émergents": "emergents" };

// Composition → [{ cle, poids }] sur les références du simulateur (usa, euro, europe, japon, emergents, oblig10, oblig3, monetaire).
// Actions, fonds (OPC) et autres sont répartis selon les zones ; les obligations, moitié ~10 ans, moitié ~3 ans ; le monétaire
// et les liquidités vont au monétaire. Les références sous 1 % sont retirées et le total ramené à 100, à une décimale.
function expositionsDepuisComposition(c) {
  if (!c) return [];
  const brut = new Map();
  const ajouter = (cle, poids) => brut.set(cle, (brut.get(cle) || 0) + poids);
  const zones = (c.zones || []).filter(z => z.poids > 0);
  const totalZones = zones.reduce((s, z) => s + z.poids, 0);
  const repartir = poids => {
    if (!totalZones) return ajouter("usa", poids);
    for (const z of zones) ajouter(CLE_PAR_ZONE_SEC[z.nom] || "usa", poids * z.poids / totalZones);
  };
  for (const classe of c.classes || []) {
    if (!(classe.poids > 0)) continue;
    if (classe.nom === "Obligations") { ajouter("oblig10", classe.poids / 2); ajouter("oblig3", classe.poids / 2); }
    else if (classe.nom === "Monétaire" || classe.nom === "Liquidités et autres") ajouter("monetaire", classe.poids);
    else repartir(classe.poids);
  }
  const gardees = [...brut.entries()].filter(([, poids]) => poids >= 1);
  const total = gardees.reduce((s, [, poids]) => s + poids, 0);
  return gardees.map(([cle, poids]) => ({ cle, poids: Math.round(poids / total * 1000) / 10 })).sort((a, b) => b.poids - a.poids);
}

// ---------- Tout ensemble ----------

// Données d'un fonds américain (ou d'un fonds européen qui est aussi une série américaine) pour les fiches et le simulateur :
// { serie, detail, part, historique, stats, compo, frais }, ou null si le fonds n'a pas de détail. `historique` n'existe qu'avec des
// rendements, `stats` qu'avec au moins 13 points (un an), `compo` qu'avec une date de rapport et si `composition` est vrai
// (js/inventaire.js doit alors être chargé). Rejette si le morceau de données ne se charge pas (voir chargerDetailSec).
async function donneesSec(entree, isin, { composition = true } = {}) {
  const serie = serieSecDe(entree, isin);
  if (!serie) return null;
  const detail = await chargerDetailSec(serie);
  if (!detail) return null;
  const part = partSec(detail, entree);
  const historique = part ? serieEurosDepuisRendements(part.debut, part.rendements) : null;
  const stats = historique && historique.valeurs.length >= 13 ? statsSec(historique) : null;
  const compo = composition && detail.date ? compositionDepuisSec(detail) : null;
  return { serie, detail, part, historique, stats, compo, frais: part ? fraisSec(part) : null };
}

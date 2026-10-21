/*
 * Alternative moins chère : pour un fonds, cherche l'indice qu'il suit (ou dont il est proche) et propose, parmi les fonds de
 * data/alternatives.js, les moins chers qui suivent le même indice et qu'on peut acheter en France.
 * Fonctions pures : elles ne touchent ni à la page ni au navigateur. L'affichage est dans fiche-auto.js.
 *
 * ALTERNATIVES = { maj, indices: { "<indice>": [[cle, isin, nom, frais, pea (0/1), etf (0/1), dateDic], …] } } (frais en % par an).
 *
 * Ne pas renommer ce fichier avec un nom que les bloqueurs de publicités connaissent (analyse.js, tracking.js…).
 */

const ALT_SEUIL_ACTIONS = 80;   // part minimale d'actions (%) pour associer un indice actions
const ALT_SEUIL_ZONE = 70;      // part minimale d'une zone (%) pour la rattacher à un indice
const ALT_MAX_LIGNES = 3;
const ALT_RENDEMENT_BRUT = 5;   // rendement brut annuel supposé (%) pour chiffrer l'économie, comme dans le simulateur
const ALT_CAPITAL = 10000;
const ALT_ANNEES = 10;

// Indice qui représente le mieux l'exposition d'un fonds. zones, classes : [{nom, poids}] (poids en %), noms de composition.js.
function indicePourExposition(zones, classes) {
  if (!Array.isArray(zones) || !Array.isArray(classes)) return null;
  const poids = (liste, nom) => { const x = liste.find(l => l.nom === nom); return x && Number.isFinite(x.poids) ? x.poids : 0; };
  if (poids(classes, "Actions") < ALT_SEUIL_ACTIONS) return null;
  const nord = poids(zones, "Amérique du Nord"), euro = poids(zones, "Zone euro"), horsEuro = poids(zones, "Europe hors zone euro");
  if (nord >= ALT_SEUIL_ZONE) return "S&P 500";
  if (euro >= ALT_SEUIL_ZONE) return "Euro Stoxx 50";
  if (euro + horsEuro >= ALT_SEUIL_ZONE) return "Stoxx Europe 600";
  if (poids(zones, "Pays émergents") >= ALT_SEUIL_ZONE) return "MSCI Emerging Markets";
  if (poids(zones, "Asie-Pacifique développée") >= ALT_SEUIL_ZONE) return "Topix";
  if (nord >= 40) return "MSCI World";
  return null;
}

// Peut-on acheter ce fonds depuis la France ? G (GECO) et N (notifié AMF) : oui ; E, U : s'il est notifié en France ;
// R (registre de l'ESMA) : OPCVM notifié en France ; S (États-Unis) et fonds hors EEE : non.
function achetableEnFrance(e) {
  if (e.source === "G" || e.source === "N") return true;
  if (e.source === "S") return false;
  if (horsEee(e)) return false;
  if (e.source === "R") {
    const x = esmaDe(e);
    return !!x && x.cadre === "UCITS" && Array.isArray(x.pays) && x.pays.includes("FR");
  }
  return notifieFrance(e);
}

// Alternatives moins chères pour le fonds e (frais fraisFonds en %, ou null). composition = {zones, classes} ou null.
// autres : candidats que fournit l'appelant pour un fonds non achetable en France : [{cle, nom, frais (null possible), pea, etf}].
function choisirAlternatives(e, fraisFonds, composition, autres) {
  const nom = e.nom || "";
  let indice = indiceDuNom(nom);
  const actif = !indice;
  if (actif) indice = composition ? indicePourExposition(composition.zones, composition.classes) : null;
  const resultat = { indice, actif, lignes: [], dejaMoinsCher: false };
  if (!indice) return resultat;

  const dejaVus = new Set();
  const cleDuFonds = e.source + e.cmpId;
  const lui = new Set(e.isins || []);
  const candidats = [];
  const ajouter = (cle, n, frais, pea, etf) => {
    if (dejaVus.has(cle) || cle === cleDuFonds) return;
    dejaVus.add(cle);
    candidats.push({ cle, nom: n, frais, pea: !!pea, etf: !!etf });
  };
  const liste = typeof ALTERNATIVES !== "undefined" && ALTERNATIVES && ALTERNATIVES.indices ? ALTERNATIVES.indices[indice] : null;
  const francais = [];
  for (const [cle, isin, n, frais, pea, etf] of Array.isArray(liste) ? liste : []) {
    if (lui.has(isin)) { dejaVus.add(cle); continue; }   // le fonds lui-même (toutes ses parts)
    francais.push([cle, n, Number.isFinite(frais) ? frais : null, pea, etf]);
  }
  francais.sort((a, b) => (a[2] === null) - (b[2] === null) || a[2] - b[2]);
  for (const f of francais) ajouter(...f);
  const nbFrancais = candidats.length;
  // Fonds non achetable en France : les candidats étrangers viennent après la liste française
  if (!achetableEnFrance(e)) for (const a of Array.isArray(autres) ? autres : []) {
    ajouter(a.cle, a.nom, Number.isFinite(a.frais) ? a.frais : null, a.pea, a.etf);
  }

  const connu = Number.isFinite(fraisFonds);
  const avecEconomie = candidats.map(c => ({
    ...c,
    economie: connu && c.frais !== null
      ? Math.round(valeurFinale(ALT_CAPITAL, ALT_RENDEMENT_BRUT - c.frais, ALT_ANNEES) - valeurFinale(ALT_CAPITAL, ALT_RENDEMENT_BRUT - fraisFonds, ALT_ANNEES))
      : null
  }));
  const garde = l => l.economie === null || l.economie > 0;
  // Déjà moins cher : on connaît les frais du fonds et des alternatives, et aucune ne fait économiser
  resultat.dejaMoinsCher = connu && avecEconomie.some(l => l.economie !== null) && !avecEconomie.some(l => l.economie !== null && l.economie > 0);
  // 3 fonds français au plus, puis les candidats étrangers (peu nombreux) à la suite
  resultat.lignes = [...avecEconomie.slice(0, nbFrancais).filter(garde).slice(0, ALT_MAX_LIGNES), ...avecEconomie.slice(nbFrancais).filter(garde)];
  return resultat;
}

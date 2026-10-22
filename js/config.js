/*
 * Seuils des alertes de concentration (en %).
 * - orange : on commence à surveiller
 * - rouge  : forte concentration
 * Ces valeurs par défaut sont modifiables dans l'écran « Réglages des alertes ».
 * Les réglages de l'utilisateur sont mémorisés dans son navigateur.
 */
const SEUILS_PAR_DEFAUT = {
  pays:    { libelle: "Poids d'un seul pays",                      orange: 40, rouge: 50 },
  secteur: { libelle: "Poids d'un seul secteur",                   orange: 25, rouge: 30 },
  top10:   { libelle: "Poids cumulé des 10 premières lignes",      orange: 30, rouge: 40 },
  ligne:   { libelle: "Poids d'une seule ligne",                   orange: 7,  rouge: 10 },
  devise:  { libelle: "Devises hors euro non couvertes",           orange: 30, rouge: 50 }
};

// Au-delà de ces frais courants annuels (%), on signale des frais élevés
const SEUILS_FRAIS = { orange: 1.0, rouge: 2.0 };

const CLE_STOCKAGE = "seuils-alertes-v1";

// Réglages enregistrés dans le compte (mode comptes, personne connectée : js/app.js) : gardés en mémoire seulement,
// ils l'emportent sur ceux du navigateur. null : aucun réglage dans le compte.
let SEUILS_DU_COMPTE = null;
const seuilValide = x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100;

// Réglages lus dans le compte (colonne reglages_fiche) : seuils connus et valides seulement ; un compte sans réglage ne change rien
function appliquerSeuilsCompte(r) {
  const propres = {};
  for (const cle in SEUILS_PAR_DEFAUT) {
    const s = r && typeof r === "object" && r[cle];
    if (s && seuilValide(s.orange) && seuilValide(s.rouge)) propres[cle] = { orange: s.orange, rouge: s.rouge };
  }
  SEUILS_DU_COMPTE = Object.keys(propres).length ? propres : null;
}

// Forme enregistrée dans le compte : { pays: { orange, rouge }, … }
function reglagesPourCompte(seuils) {
  const r = {};
  for (const cle in SEUILS_PAR_DEFAUT) if (seuils[cle]) r[cle] = { orange: Number(seuils[cle].orange), rouge: Number(seuils[cle].rouge) };
  return r;
}

function chargerSeuils() {
  const seuils = JSON.parse(JSON.stringify(SEUILS_PAR_DEFAUT));
  try {
    const sauves = SEUILS_DU_COMPTE || JSON.parse(localStorage.getItem(CLE_STOCKAGE) || "{}");
    for (const cle in sauves) {
      if (seuils[cle]) {
        seuils[cle].orange = Number(sauves[cle].orange);
        seuils[cle].rouge = Number(sauves[cle].rouge);
      }
    }
  } catch (e) {
    // Stockage indisponible (navigation privée…) : on garde les valeurs par défaut
  }
  return seuils;
}

function sauverSeuils(seuils) {
  if (SEUILS_DU_COMPTE) SEUILS_DU_COMPTE = reglagesPourCompte(seuils);
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(seuils));
  } catch (e) { /* ignoré */ }
}

function reinitialiserSeuils() {
  SEUILS_DU_COMPTE = null;
  try { localStorage.removeItem(CLE_STOCKAGE); } catch (e) { /* ignoré */ }
}

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

function chargerSeuils() {
  const seuils = JSON.parse(JSON.stringify(SEUILS_PAR_DEFAUT));
  try {
    const sauves = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || "{}");
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
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(seuils));
  } catch (e) { /* ignoré */ }
}

function reinitialiserSeuils() {
  try { localStorage.removeItem(CLE_STOCKAGE); } catch (e) { /* ignoré */ }
}

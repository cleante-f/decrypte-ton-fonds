/*
 * Outils d'analyse partagés : mise en forme des nombres, alertes de concentration, profils de risque.
 * Ce fichier ne touche pas à l'affichage : il renvoie seulement des données.
 *
 * Ne pas le renommer « analyse.js » : ce nom est bloqué par les bloqueurs de publicités (liste EasyPrivacy),
 * ce qui empêchait le site de fonctionner chez les visiteurs qui en utilisent un.
 */

// ---------- Outils ----------

// Met en minuscules et enlève les accents : « Société » → « societe »
function normaliser(texte) {
  return String(texte || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// même règle que cle_societe dans scripts/construire_identite.py
function cleSociete(nom) {
  return String(nom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Valeur d'un placement rémunéré au taux d'une série BCE (texte CSV de l'API), base 100 au départ.
// Chaque période applique le taux de la période précédente jusqu'à la date courante.
//  - série mensuelle (AAAA-MM, ex. livrets) : taux annuel composé sur le nombre exact de jours, base 365,
//    date = 1er du mois (les jours sont arrondis : le changement d'heure ne fait pas 30,96 jours) ;
//  - série quotidienne (AAAA-MM-JJ, ex. €STR) : intérêts simples, base 360.
// `jusqua` (Date, facultatif) : pour une série mensuelle, ajoute un dernier point à cette date (à minuit) en appliquant
// le dernier taux publié, pour couvrir les mois pas encore publiés. Sans effet sur une série quotidienne.
// Renvoie { dates: Date[], valeurs: number[] } ; les lignes sans valeur sont ignorées.
function serieDepuisCsvBce(texte, jusqua) {
  const lignes = texte.trim().split(/\r?\n/);
  const entete = lignes[0].split(",");
  const iD = entete.indexOf("TIME_PERIOD"), iV = entete.indexOf("OBS_VALUE");
  const dates = [], valeurs = [];
  let niveau = 100, precedent = null;
  const composer = (taux, depuis, jusquA) => (1 + taux / 100) ** (Math.round((jusquA - depuis) / 864e5) / 365);
  for (const l of lignes.slice(1)) {
    const c = l.split(","), periode = c[iD], taux = parseFloat(c[iV]);
    if (isNaN(taux)) continue;
    const mensuelle = /^\d{4}-\d{2}$/.test(periode);
    const d = mensuelle ? new Date(+periode.slice(0, 4), +periode.slice(5, 7) - 1, 1) : new Date(periode + "T00:00:00");
    if (precedent) {
      niveau *= mensuelle ? composer(precedent.taux, precedent.d, d) : 1 + precedent.taux / 100 * ((d - precedent.d) / 864e5) / 360;
    }
    dates.push(d); valeurs.push(niveau);
    precedent = { d, taux, mensuelle };
  }
  if (jusqua && precedent && precedent.mensuelle) {
    const fin = new Date(jusqua.getFullYear(), jusqua.getMonth(), jusqua.getDate());
    if (fin > precedent.d) { dates.push(fin); valeurs.push(niveau * composer(precedent.taux, precedent.d, fin)); }
  }
  return { dates, valeurs };
}

function pct(valeur, decimales = 1) {
  if (valeur === null || valeur === undefined) return "n.d.";
  return valeur.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + " %";
}

function euros(valeur) {
  return Math.round(valeur).toLocaleString("fr-FR") + " €";
}

// Les lignes « Autres » ne sont pas un vrai pays ou secteur : on les ignore pour les alertes
function sansAutres(liste) {
  return (liste || []).filter(e => !normaliser(e.nom).startsWith("autres"));
}

function plusGros(liste) {
  return sansAutres(liste).reduce((max, e) => (!max || e.poids > max.poids ? e : max), null);
}

function aLeType(fonds, type) {
  return fonds.types.includes(type);
}

// ---------- Alertes de concentration ----------

function niveauSelonSeuil(valeur, seuil) {
  if (valeur > seuil.rouge) return "rouge";
  if (valeur > seuil.orange) return "orange";
  return "vert";
}

function alertesConcentration(fonds, seuils) {
  const alertes = [];
  const r = fonds.repartition;
  const lignesSontDesFonds = aLeType(fonds, "nourricier") || aLeType(fonds, "fonds_de_fonds");

  // Pays
  const pays = plusGros(r.pays);
  if (pays) {
    const niveau = niveauSelonSeuil(pays.poids, seuils.pays);
    alertes.push({
      niveau, cle: "pays",
      titre: niveau === "vert" ? "Pas de pays dominant" : `${pays.nom} : ${pct(pays.poids)} du fonds`,
      explication: niveau === "vert"
        ? `Le premier pays (${pays.nom}) pèse ${pct(pays.poids)}, sous le seuil de ${seuils.pays.orange} %.`
        : `Si l'économie ou la Bourse de ce pays chute, une grande partie de ton placement baisse en même temps.`
    });
  }

  // Secteur
  const secteur = plusGros(r.secteurs);
  if (secteur) {
    const niveau = niveauSelonSeuil(secteur.poids, seuils.secteur);
    alertes.push({
      niveau, cle: "secteur",
      titre: niveau === "vert" ? "Pas de secteur dominant" : `${secteur.nom} : ${pct(secteur.poids)} du fonds`,
      explication: niveau === "vert"
        ? `Le premier secteur (${secteur.nom}) pèse ${pct(secteur.poids)}, sous le seuil de ${seuils.secteur.orange} %.`
        : `Un secteur peut traverser une crise longue (la tech en 2000-2002, la finance en 2008) : le fonds en subirait fortement les effets.`
    });
  }

  // Top 10 et plus grosse ligne : peu parlant quand les lignes sont elles-mêmes des fonds
  if (lignesSontDesFonds) {
    alertes.push({
      niveau: "info", cle: "top10",
      titre: "Lignes = fonds sous-jacents",
      explication: "Ce fonds détient d'autres fonds : le poids de chaque ligne ne mesure pas la concentration réelle. Regarde plutôt les répartitions par pays et par secteur."
    });
  } else if (fonds.top10 && fonds.top10.length) {
    const totalTop10 = fonds.top10.reduce((s, l) => s + l.poids, 0);
    const niveauTop = niveauSelonSeuil(totalTop10, seuils.top10);
    alertes.push({
      niveau: niveauTop, cle: "top10",
      titre: `Les 10 premières lignes : ${pct(totalTop10)}`,
      explication: niveauTop === "vert"
        ? `Le fonds est bien réparti entre de nombreux titres.`
        : `Le résultat du fonds dépend beaucoup de quelques titres : si l'un d'eux chute, tout le fonds le ressent.`
    });

    const ligne = plusGros(fonds.top10);
    const niveauLigne = niveauSelonSeuil(ligne.poids, seuils.ligne);
    alertes.push({
      niveau: niveauLigne, cle: "ligne",
      titre: niveauLigne === "vert" ? "Aucune ligne trop lourde" : `${ligne.nom} : ${pct(ligne.poids)}`,
      explication: niveauLigne === "vert"
        ? `La plus grosse ligne (${ligne.nom}) pèse ${pct(ligne.poids)}.`
        : `Un seul titre pèse lourd : un scandale ou une faillite de cet émetteur aurait un impact direct et important.`
    });
  }

  // Devises hors euro non couvertes
  const horsEuro = (r.devises || []).filter(d => d.nom !== "EUR").reduce((s, d) => s + d.poids, 0);
  const couvert = fonds.particularites.couvertureChange;
  if (couvert) {
    alertes.push({
      niveau: "vert", cle: "devise",
      titre: "Risque de change couvert",
      explication: `${pct(horsEuro)} des actifs sont en devises étrangères, mais cette part du fonds est couverte (« hedged ») contre les variations face à l'euro.`
    });
  } else {
    const niveau = niveauSelonSeuil(horsEuro, seuils.devise);
    alertes.push({
      niveau, cle: "devise",
      titre: niveau === "vert" ? "Peu d'exposition aux devises étrangères" : `${pct(horsEuro)} en devises étrangères, sans couverture`,
      explication: niveau === "vert"
        ? `Seulement ${pct(horsEuro)} des actifs sont hors euro.`
        : `Tu investis en euros, mais si le dollar (ou une autre devise) baisse face à l'euro, tu perds de l'argent même si les placements montent.`
    });
  }

  return alertes;
}

// ---------- Profils de risque (échelle SRI du DIC) ----------

const PROFILS_SRI = {
  1: "très prudent", 2: "prudent", 3: "prudent à équilibré", 4: "équilibré",
  5: "dynamique", 6: "dynamique, qui accepte de fortes baisses", 7: "très dynamique, qui accepte des pertes importantes"
};

// ---------- Coût des frais ----------

function valeurFinale(capital, tauxAnnuel, annees) {
  return capital * Math.pow(1 + tauxAnnuel / 100, annees);
}

// ---------- Données du site dans ce navigateur (localStorage) ----------
// Toutes les clés que le site peut écrire. L'adresse cleante-f.github.io est partagée avec d'autres sites
// du même compte GitHub : on ne touche jamais aux autres clés.
const CLE_CACHE_COMPO = "composition-v8-";   // v8 : les lignes gardent leur ISIN (liens vers les fonds détenus)
const CLES_STOCKAGE_SITE = [/^composition-v\d+-/, /^serie-/, /^longue-v1-/, /^simulateur-plan-v1$/, /^simulateur-memoriser$/, /^seuils-alertes-v1$/];

function clesStockageSite() {
  try { return Object.keys(localStorage).filter(k => CLES_STOCKAGE_SITE.some(re => re.test(k))); } catch (e) { return []; }
}

// Copies de données publiques périmées (plus lues, mais jamais effacées jusqu'ici) : supprimées à chaque visite
function nettoyerStockage() {
  const aujourdHui = new Date().toISOString().slice(0, 10);
  for (const k of clesStockageSite()) {
    try {
      if (/^composition-v\d+-/.test(k) && !k.startsWith(CLE_CACHE_COMPO)) { localStorage.removeItem(k); continue; }   // anciennes versions
      if (!/^(composition-|serie-|longue-)/.test(k)) continue;                                                              // plan et réglages : choisis par l'utilisateur
      const v = JSON.parse(localStorage.getItem(k) || "null");
      const perime = !v || (k.startsWith("serie-") ? v.jour !== aujourdHui : Date.now() - v.quand > 7 * 864e5);
      if (perime) localStorage.removeItem(k);
    } catch (e) { try { localStorage.removeItem(k); } catch (e2) { /* stockage indisponible */ } }
  }
}
nettoyerStockage();

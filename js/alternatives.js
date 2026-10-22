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
const ALT_SEUIL_MONDE = 40;     // part minimale d'Amérique du Nord (%) pour retenir MSCI World quand aucune zone ne domine
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
  if (nord >= ALT_SEUIL_MONDE) return "MSCI World";
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
  // 3 lignes au plus au total : la liste française d'abord, puis les candidats étrangers
  resultat.lignes = avecEconomie.filter(garde).slice(0, ALT_MAX_LIGNES);
  return resultat;
}

// ---------- Affichage : section 6 de la fiche ----------

// Frais annuels du fonds analysé (en %), ou null s'ils sont inconnus. Ordre : DIC (gestion + transaction), puis frais lus
// dans le prospectus SEC (net, à défaut brut), puis ligne de data/alternatives.js dont l'ISIN est celui de la part affichée
// (un ETF indiciel français n'a pas toujours de DIC séparé dans GECO).
function fraisDuFondsAnalyse(d, e, isin) {
  const dic = d && d.dic;
  if (dic && Number.isFinite(dic.gestion)) return dic.gestion + (Number.isFinite(dic.transaction) ? dic.transaction : 0);
  const f = d && d.sec && d.sec.frais;
  if (f && Number.isFinite(f.retenu)) return f.retenu;
  return fraisDansAlternatives([isin, ...(e && e.isins || [])]);
}

// Frais annuels (en %) de la première ligne de ALTERNATIVES dont l'ISIN figure dans `isins`, sinon null
function fraisDansAlternatives(isins) {
  const set = new Set((isins || []).filter(Boolean));
  const indices = typeof ALTERNATIVES !== "undefined" && ALTERNATIVES && ALTERNATIVES.indices ? ALTERNATIVES.indices : {};
  for (const liste of Object.values(indices))
    for (const row of Array.isArray(liste) ? liste : [])
      if (set.has(row[1]) && Number.isFinite(row[3])) return row[3];
  return null;
}

// Composition utilisable pour choisir un indice : {zones, classes} ou null
function compositionPourAlternatives(d) {
  const c = d && d.composition && d.composition.c;
  const compo = c && c.zones && c.classes ? c : d && d.sec && d.sec.compo;
  return compo && Array.isArray(compo.zones) && Array.isArray(compo.classes) ? compo : null;
}

// HTML de la section « alternative moins chère » (fonction de présentation : tout ce qui vient des données est échappé)
function blocAlternatives(e, d, chargement, isin) {
  if (typeof ALTERNATIVES === "undefined" || !ALTERNATIVES || !ALTERNATIVES.indices) return nonDispo("Comparaison des frais indisponible pour le moment.");
  // Fonds actif dont l'indice dépend de la composition : tant qu'elle n'est pas connue, on ne conclut pas
  const enCours = !!chargement || !d || (d.composition && !d.composition.fini);
  if (enCours && !indiceDuNom(e.nom || "")) return `<p class="chargement">Recherche d'alternatives moins chères…</p>`;
  const frais = fraisDuFondsAnalyse(d, e, isin);
  const r = choisirAlternatives(e, frais, compositionPourAlternatives(d), d && d.alternativesAutres);
  if (!r.indice) return `<p>Ce fonds n'a pas d'alternative indicielle comparable dans nos données : il ne suit pas un indice que nous savons repérer, ou il n'est pas investi surtout en actions.</p>`;
  let html = `<h3>${r.actif ? "Alternative indicielle (pas le même fonds)" : "Fonds moins chers qui suivent le même indice"}</h3>
    <p>Indice : <strong>${esc(r.indice)}</strong>${frais !== null ? ` · frais annuels de ce fonds : <strong>${pct(frais, 2)}</strong>` : " · frais de ce fonds non lus : l'économie ne peut pas être chiffrée"}.</p>`;
  if (r.actif) html += `<p class="aide">Alternative indicielle : elle suit un marché, pas la stratégie du gérant.</p>`;
  if (r.dejaMoinsCher) html += `<p>C'est déjà l'un des fonds les moins chers sur cet indice : nous n'avons pas trouvé d'alternative qui coûte moins.</p>`;
  else if (!r.lignes.length) html += `<p>Nous n'avons trouvé aucune alternative moins chère dans nos données.</p>`;
  if (r.lignes.length) {
    html += `<ul class="similaires">${r.lignes.map(l => `<li><a href="${esc(lienAutreFonds(l.cle))}">${esc(l.nom)}</a>
      <small>${l.etf ? "ETF" : "fonds"}${l.pea ? " · éligible au PEA (d'après le nom)" : ""} · ${l.frais !== null ? `frais ${pct(l.frais, 2)} / an` : "frais non publiés dans nos sources"}${l.economie !== null
        ? ` · Sur 10 000 € placés ${ALT_ANNEES} ans, environ ${euros(l.economie)} de plus à l'arrivée (rendement brut supposé ${ALT_RENDEMENT_BRUT} % par an)` : ""}</small></li>`).join("")}</ul>`;
  }
  html += `<p class="aide">Des frais plus bas ne garantissent pas une meilleure performance ; vérifie le DIC avant toute décision.</p>
    <p class="source">Source : AMF – DIC (base GECO), relevé du ${dateFr(ALTERNATIVES.maj)}</p>`;
  return html;
}

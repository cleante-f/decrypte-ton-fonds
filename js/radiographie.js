// Radiographie du contrat : calculs purs (exposition cumulée, doublons, frais en euros).
// Pas d'affichage ici : les fonctions ne lisent que leurs arguments (et FACTEURS, ALTERNATIVES).

const RADIO_SEUIL_PROCHES = 80;   // recouvrement zone × classe (%) à partir duquel deux fonds sont « proches »
const RADIO_RENDEMENT_BRUT = 5;   // rendement brut annuel supposé (%), comme le simulateur
const RADIO_ANNEES = 10;

// Ajoute `poids` à la clé `nom` d'une Map
function radioAjouter(map, nom, poids) {
  map.set(nom, (map.get(nom) || 0) + poids);
}

// Exposition d'un fonds (A.expo : [{cle, poids}] en %) regroupée par zone, classe d'actifs et devise
function repartitionsDeFonds(expo) {
  const zones = new Map(), classes = new Map(), devises = new Map();
  for (const { cle, poids } of expo || []) {
    const f = FACTEURS.find(x => x.cle === cle);
    if (!f || !Number.isFinite(poids)) continue;
    radioAjouter(zones, f.zone, poids);
    radioAjouter(classes, f.classe, poids);
    radioAjouter(devises, f.devise, poids);
  }
  return { zones, classes, devises };
}

const radioTrier = map => [...map].map(([nom, poids]) => ({ nom, poids })).filter(x => x.poids > 0).sort((a, b) => b.poids - a.poids);

// Cumul de plusieurs fonds : lignes = [{montant, expo}] ; poids en % du total analysé, triés par ordre décroissant
function cumulContrat(lignes) {
  const total = (lignes || []).reduce((s, l) => s + (l.montant > 0 ? l.montant : 0), 0);
  const zones = new Map(), classes = new Map(), devises = new Map();
  if (total > 0) for (const l of lignes) {
    if (!(l.montant > 0)) continue;
    const r = repartitionsDeFonds(l.expo);
    const part = l.montant / total;
    for (const [src, dst] of [[r.zones, zones], [r.classes, classes], [r.devises, devises]])
      for (const [nom, p] of src) radioAjouter(dst, nom, p * part);
  }
  return { zones: radioTrier(zones), classes: radioTrier(classes), devises: radioTrier(devises) };
}

// Clé « même fonds » : même source + cmpId pour GECO et NAV, sinon la clé habituelle (sans l'ISIN de la part)
function cleMemeFonds(e) {
  if (e.source === "G" || e.source === "N") return e.source + e.cmpId;
  return cleEntree(e);
}

// Poids (en %) d'un fonds par couple classe × zone
function poidsZoneClasse(expo) {
  const m = new Map();
  for (const { cle, poids } of expo || []) {
    const f = FACTEURS.find(x => x.cle === cle);
    if (f && Number.isFinite(poids)) radioAjouter(m, f.classe + "|" + f.zone, poids);
  }
  return m;
}

// Zones de la seule part « Actions » du contrat (poids en % de l'exposition en actions), triées par ordre décroissant
function zonesActionsContrat(lignes) {
  const zones = new Map();
  let total = 0;
  for (const l of lignes || []) {
    if (!(l.montant > 0)) continue;
    for (const [k, p] of poidsZoneClasse(l.expo)) {
      const [classe, zone] = k.split("|");
      if (classe !== "Actions") continue;
      radioAjouter(zones, zone, p * l.montant);
      total += p * l.montant;
    }
  }
  return total > 0 ? radioTrier(new Map([...zones].map(([z, v]) => [z, v / total * 100]))) : [];
}

// Doublons : lignes = [{entree, montant, expo}]
// memes = fonds identiques (même indice ou même fonds) ; proches = recouvrement zone × classe ≥ 80 %, hors paires des « memes »
function doublonsContrat(lignes) {
  const n = lignes.length;
  const parent = lignes.map((_, i) => i);
  const racine = i => parent[i] === i ? i : (parent[i] = racine(parent[i]));
  const indices = lignes.map(l => indiceDuNom(l.entree.nom || ""));
  const cles = lignes.map(l => cleMemeFonds(l.entree));
  const paireMeme = new Set();
  const memeFonds = (i, j) => cles[i] === cles[j];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (memeFonds(i, j) || (indices[i] && indices[i] === indices[j])) {
      paireMeme.add(i + "," + j);
      parent[racine(j)] = racine(i);
    }
  }
  const groupes = new Map();
  for (let i = 0; i < n; i++) {
    const r = racine(i);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(i);
  }
  const memes = [];
  for (const g of groupes.values()) {
    if (g.length < 2) continue;
    const toutPareil = g.every(i => cles[i] === cles[g[0]]);
    memes.push({ fonds: g, raison: toutPareil ? "fonds" : "indice", montant: g.reduce((s, i) => s + (lignes[i].montant || 0), 0) });
  }
  const poids = lignes.map(l => poidsZoneClasse(l.expo));
  // Un fonds d'un groupe « memes » est traité avec tout son groupe : une proximité avec l'un de ses membres vaut pour le groupe entier
  const unite = lignes.map((_, i) => memes.findIndex(m => m.fonds.includes(i)));   // numéro de groupe, -1 si aucun
  const membres = i => unite[i] >= 0 ? memes[unite[i]].fonds : [i];
  const parUnites = new Map();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (paireMeme.has(i + "," + j) || (unite[i] >= 0 && unite[i] === unite[j])) continue;
    let recouvrement = 0;
    for (const [k, p] of poids[i]) if (poids[j].has(k)) recouvrement += Math.min(p, poids[j].get(k));
    recouvrement = Math.round(recouvrement * 100) / 100;
    if (recouvrement < RADIO_SEUIL_PROCHES) continue;
    const fonds = [...new Set([...membres(i), ...membres(j)])].sort((x, y) => x - y);
    const cle = fonds.join(",");
    const deja = parUnites.get(cle);
    if (deja) deja.recouvrement = Math.max(deja.recouvrement, recouvrement);
    else parUnites.set(cle, { fonds, recouvrement, montant: fonds.reduce((s, k) => s + (lignes[k].montant || 0), 0) });
  }
  const proches = [...parUnites.values()];
  return { memes, proches };
}

// Frais annuels connus (en %) d'un fonds : DIC ou SEC (A.terSource), sinon ligne de ALTERNATIVES portant son ISIN, sinon null
function fraisConnusContrat(entree, isin, A) {
  if (A && Number.isFinite(A.ter) && (A.terSource === "dic" || A.terSource === "sec")) return A.ter;
  return fraisDansAlternatives([isin, ...(entree && entree.isins || [])]);
}

// ISIN de la ligne de ALTERNATIVES portant cette clé, ou null
function isinDeAlternative(cle) {
  const indices = typeof ALTERNATIVES !== "undefined" && ALTERNATIVES && ALTERNATIVES.indices ? ALTERNATIVES.indices : {};
  for (const liste of Object.values(indices))
    for (const row of Array.isArray(liste) ? liste : []) if (row[0] === cle) return row[1];
  return null;
}

// Frais du contrat : lignes = [{entree, isin, montant, A}]
function fraisContrat(lignes) {
  let totalAnnuel = 0, connus = 0, inconnus = 0;
  const parFonds = lignes.map((l, idx) => {
    const montant = l.montant > 0 ? l.montant : 0;
    const frais = fraisConnusContrat(l.entree, l.isin, l.A);
    if (frais === null) { inconnus++; return { frais: null, coutAnnuel: null, alternative: null }; }
    const coutAnnuel = montant * frais / 100;
    connus++;
    totalAnnuel += coutAnnuel;
    let alternative = null;
    const r = choisirAlternatives(l.entree, frais, null, []);
    const meilleure = r.lignes.find(x => x.economie !== null && x.economie > 0);
    if (meilleure) {
      // Si l'alternative est déjà dans le contrat (même ISIN ou même clé), on le dit : il suffit de regrouper
      const isinAlt = isinDeAlternative(meilleure.cle);
      const dejaDetenue = lignes.some((x, k) => k !== idx && ((x.isin && x.isin === isinAlt) || (x.entree && ((x.entree.isins || []).includes(isinAlt) || x.entree.source + x.entree.cmpId === meilleure.cle))));
      alternative = { nom: meilleure.nom + (dejaDetenue ? " (déjà dans ton contrat)" : ""), cle: meilleure.cle, frais: meilleure.frais, economieAnnuelle: montant * (frais - meilleure.frais) / 100 };
    }
    return { frais, coutAnnuel, alternative };
  });
  // Coût sur 10 ans : somme, fonds par fonds, de la perte due aux frais (exacte, sans frais moyen)
  let cout10ans = null;
  if (connus > 0) cout10ans = Math.round(lignes.reduce((s, l, i) => {
    const frais = parFonds[i].frais, montant = l.montant > 0 ? l.montant : 0;
    return frais === null ? s : s + valeurFinale(montant, RADIO_RENDEMENT_BRUT, RADIO_ANNEES) - valeurFinale(montant, RADIO_RENDEMENT_BRUT - frais, RADIO_ANNEES);
  }, 0));
  return { parFonds, totalAnnuel: connus > 0 ? totalAnnuel : null, auMoins: inconnus > 0, cout10ans, inconnus };
}

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
  const proches = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (paireMeme.has(i + "," + j)) continue;
    let recouvrement = 0;
    for (const [k, p] of poids[i]) if (poids[j].has(k)) recouvrement += Math.min(p, poids[j].get(k));
    recouvrement = Math.round(recouvrement * 100) / 100;
    if (recouvrement >= RADIO_SEUIL_PROCHES) proches.push({ fonds: [i, j], recouvrement, montant: (lignes[i].montant || 0) + (lignes[j].montant || 0) });
  }
  return { memes, proches };
}

// Frais annuels connus (en %) d'un fonds : DIC ou SEC (A.terSource), sinon ligne de ALTERNATIVES portant son ISIN, sinon null
function fraisConnusContrat(entree, isin, A) {
  if (A && Number.isFinite(A.ter) && (A.terSource === "dic" || A.terSource === "sec")) return A.ter;
  const isins = new Set([isin, ...(entree && entree.isins || [])].filter(Boolean));
  const indices = typeof ALTERNATIVES !== "undefined" && ALTERNATIVES && ALTERNATIVES.indices ? ALTERNATIVES.indices : {};
  for (const liste of Object.values(indices))
    for (const row of Array.isArray(liste) ? liste : [])
      if (isins.has(row[1]) && Number.isFinite(row[3])) return row[3];
  return null;
}

// Frais du contrat : lignes = [{entree, isin, montant, A}]
function fraisContrat(lignes) {
  let totalAnnuel = 0, connus = 0, inconnus = 0, montantConnu = 0, fraisPonderes = 0;
  const parFonds = lignes.map(l => {
    const montant = l.montant > 0 ? l.montant : 0;
    const frais = fraisConnusContrat(l.entree, l.isin, l.A);
    if (frais === null) { inconnus++; return { frais: null, coutAnnuel: null, alternative: null }; }
    const coutAnnuel = montant * frais / 100;
    connus++;
    totalAnnuel += coutAnnuel;
    montantConnu += montant;
    fraisPonderes += montant * frais;
    let alternative = null;
    const r = choisirAlternatives(l.entree, frais, null, []);
    const meilleure = r.lignes.find(x => x.economie !== null && x.economie > 0);
    if (meilleure) alternative = { nom: meilleure.nom, cle: meilleure.cle, frais: meilleure.frais, economieAnnuelle: montant * (frais - meilleure.frais) / 100 };
    return { frais, coutAnnuel, alternative };
  });
  let cout10ans = null;
  if (connus > 0 && montantConnu > 0) {
    const moyens = fraisPonderes / montantConnu;
    cout10ans = Math.round(valeurFinale(montantConnu, RADIO_RENDEMENT_BRUT, RADIO_ANNEES) - valeurFinale(montantConnu, RADIO_RENDEMENT_BRUT - moyens, RADIO_ANNEES));
  } else if (connus > 0) cout10ans = 0;
  return { parFonds, totalAnnuel: connus > 0 ? totalAnnuel : null, auMoins: inconnus > 0, cout10ans, inconnus };
}

/*
 * Assemble les résultats des deux moteurs maison en une seule « composition » pour la fiche :
 *   - moteur 1 (inventaire.js) : ce que le fonds DÉTIENT, ligne par ligne, d'après son rapport annuel
 *   - moteur 2 (style.js)      : ce à quoi le fonds est réellement EXPOSÉ, d'après ses rendements
 *
 * Règle : on part des positions réelles quand elles décrivent bien l'exposition ; sinon (réplication synthétique,
 * fonds de fonds, pas de rapport) on s'appuie sur l'analyse des rendements.
 */

const CLE_CACHE_COMPO = "composition-v7-";

function lireCacheComposition(cle) {
  try {
    const c = JSON.parse(localStorage.getItem(CLE_CACHE_COMPO + cle) || "null");
    if (c && Date.now() - c.quand < 7 * 864e5) return c.valeur;   // valable une semaine
  } catch (e) { /* ignoré */ }
  return undefined;
}
function ecrireCacheComposition(cle, valeur) {
  try {
    localStorage.setItem(CLE_CACHE_COMPO + cle, JSON.stringify({ quand: Date.now(), valeur }));
  } catch (e) {
    // stockage plein : on fait de la place en supprimant les anciennes compositions
    try { Object.keys(localStorage).filter(k => k.startsWith(CLE_CACHE_COMPO)).slice(0, 20).forEach(k => localStorage.removeItem(k)); } catch (e2) { /* ignoré */ }
  }
}

// Inventaire mis en cache par document (la lecture d'un gros PDF peut prendre du temps)
async function inventaireAvecCache(documents, nomFonds, surProgression, st) {
  const rapports = (documents || []).filter(d => /Rapport|Comptes annuels/i.test(d.docTypeLib));
  if (!rapports.length) return null;
  const cle = "inv-" + rapports.map(d => d.idInterne).sort().join("-");
  const cache = lireCacheComposition(cle);
  if (cache !== undefined) return cache;
  const actionsAttendues = st && st.r2 >= 0.6 ? (st.classes.find(c => c.nom === "Actions") || { poids: 0 }).poids : undefined;
  const inv = await analyserInventaire(documents, nomFonds, surProgression, actionsAttendues);
  if (inv) {
    // on ne garde que ce qui sert à l'affichage (pas les centaines de lignes)
    delete inv.positions;
    if (inv.document) inv.document = { docTypeLib: inv.document.docTypeLib, dateEffet: inv.document.dateEffet, idInterne: inv.document.idInterne, docName: inv.document.docName };
  }
  ecrireCacheComposition(cle, inv);
  return inv;
}

async function styleAvecCache(cle, historique) {
  const cache = lireCacheComposition("style-" + cle);
  if (cache !== undefined) return cache;
  const st = await analyserStyle(historique);
  ecrireCacheComposition("style-" + cle, st);
  return st;
}

// Qualité de l'analyse des rendements, en mots simples
function qualiteStyle(st) {
  if (!st) return null;
  if (st.expositions.length === 1 && st.expositions[0].cle === "monetaire") return { niveau: "vert", texte: "cohérente avec un placement monétaire" };
  if (st.r2 >= 0.9) return { niveau: "vert", texte: "fiable" };
  if (st.r2 >= 0.75) return { niveau: "vert", texte: "correcte" };
  if (st.r2 >= 0.5) return { niveau: "orange", texte: "approximative" };
  return { niveau: "rouge", texte: "peu fiable : le fonds ne ressemble à aucun mélange de nos références" };
}

// Devises estimées à partir des rendements
function devisesDuStyle(st) {
  const m = new Map();
  for (const e of st.expositions) {
    const f = FACTEURS.find(x => x.cle === e.cle);
    if (!f || f.devise === "USD") continue;
    m.set(f.devise, (m.get(f.devise) || 0) + e.poids);
  }
  // la couche « dollar » n'est prise en compte que si elle est nette (sinon c'est du bruit statistique)
  const couche = Math.abs(st.dollar.couche) >= 10 ? st.dollar.couche : 0;
  const autresQueUsd = [...m.values()].reduce((s, v) => s + v, 0);
  const usd = Math.min(Math.max(0, st.dollar.actions + couche), 100 - autresQueUsd);
  if (usd >= 0.5) m.set("USD", usd);
  const autres = [...m.entries()].filter(([d]) => d !== "EUR").reduce((s, [, v]) => s + v, 0);
  m.set("EUR", Math.max(0, 100 - autres));
  return [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 10) / 10 })).sort((a, b) => b.poids - a.poids);
}

// Choix de la source principale et assemblage final
function assemblerComposition(inv, st, part) {
  if (!inv && !st) return null;
  const c = { inventaire: inv, style: st, qualite: qualiteStyle(st), notes: [] };
  // Garde-fou : un inventaire dont la part d'actions contredit nettement les rendements est probablement celui d'un autre compartiment
  if (inv && inv.source === "inventaire" && st && st.r2 >= 0.8 && inv.swapsPct < 50 && inv.partFonds < 50) {
    const actInv = (inv.classes.find(x => x.nom === "Actions") || { poids: 0 }).poids;
    const actSt = (st.classes.find(x => x.nom === "Actions") || { poids: 0 }).poids;
    if (Math.abs(actInv - actSt) > 40) {
      c.notes.push({ type: "incoherent", texte: `L'inventaire trouvé dans le rapport (${Math.round(actInv)} % d'actions) ne correspond pas au comportement du fonds (≈ ${Math.round(actSt)} % d'actions d'après ses rendements) : il s'agit sans doute d'un autre compartiment. Nous utilisons donc l'analyse des rendements.` });
      c.inventaire = inv = null;
    }
  }
  const synthetique = inv && inv.swapsPct >= 50;
  const fondsDeFonds = inv && inv.partFonds >= 50;
  const styleUtilisable = st && (st.r2 >= 0.5 || (st.expositions.length === 1 && st.expositions[0].cle === "monetaire"));

  if (inv && inv.source === "inventaire" && !synthetique && !fondsDeFonds) {
    c.principale = "inventaire";
    Object.assign(c, { pays: inv.pays, zones: inv.zones, secteurs: inv.secteurs, classes: inv.classes, devises: inv.devises, top10: inv.top10 });
  } else if (inv && inv.source === "tableaux" && !(styleUtilisable && inv.classes.length === 0)) {
    c.principale = "tableaux";
    Object.assign(c, { pays: inv.pays, zones: inv.zones, secteurs: inv.secteurs, classes: inv.classes, devises: inv.devises, top10: [] });
  } else if (styleUtilisable) {
    c.principale = "style";
    Object.assign(c, { pays: st.pays, zones: st.zones, secteurs: [],
      classes: st.classes, devises: devisesDuStyle(st), top10: inv ? inv.top10 : [] });
  } else if (inv) {
    c.principale = inv.source;
    Object.assign(c, { pays: inv.pays, zones: inv.zones, secteurs: inv.secteurs, classes: inv.classes, devises: inv.devises, top10: inv.top10 });
  } else {
    return { ...c, principale: null };
  }

  if (inv && inv.document && inv.document.dateEffet) {
    const mois = (Date.now() - new Date(inv.document.dateEffet)) / (30.44 * 864e5);
    if (mois > 18) c.notes.push({ type: "ancien", texte: `Attention : le dernier inventaire disponible dans GECO date du ${new Date(inv.document.dateEffet).toLocaleDateString("fr-FR")} (il y a ${Math.round(mois / 12 * 10) / 10} ans). La composition a pu changer depuis${st ? " ; l'analyse des rendements ci-dessous, elle, porte sur les 3 dernières années" : ""}.` });
  }
  if (synthetique) c.notes.push({ type: "synthetique", texte: `Le rapport montre un contrat d'échange (swap) représentant environ ${Math.round(inv.swapsPct)} % de l'actif : les titres réellement détenus sont un « panier de substitution » sans rapport avec l'exposition réelle. La répartition affichée vient donc de l'analyse des rendements.` });
  if (fondsDeFonds) c.notes.push({ type: "fonds", texte: `Environ ${Math.round(inv.partFonds)} % de l'actif est placé dans d'autres fonds : les lignes ci-dessous sont des fonds. L'exposition réelle (ce que contiennent ces fonds) est estimée par l'analyse des rendements.` });
  // Couverture de change : on fait confiance à l'inventaire quand il est la source principale (contrats de change à terme)
  const partCouverte = /hedged|couvert/i.test(part && part.parNom || "");
  c.couvertureChange = partCouverte || (inv && inv.changeATermePct >= 20) || (c.principale === "style" && st && st.couvertureProbable && st.r2 >= 0.8);
  c.lignesSontDesFonds = fondsDeFonds || synthetique && c.principale === "style";
  return c;
}

// Objet au format attendu par alertesConcentration (analyse.js)
function pseudoFonds(c) {
  return {
    types: c.lignesSontDesFonds ? ["fonds_de_fonds"] : [],
    repartition: { pays: c.pays || [], secteurs: (c.secteurs || []).filter(s => !/Emprunts d'État/.test(s.nom)), devises: c.devises || [], classes: c.classes || [], zones: c.zones || [] },
    top10: c.top10 || [],
    particularites: { couvertureChange: c.couvertureChange }
  };
}

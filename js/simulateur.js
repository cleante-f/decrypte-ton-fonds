/*
 * Page « Simulateur » : que pourrait devenir mon investissement dans ce fonds ?
 *
 * Déroulé : l'utilisateur choisit un fonds (#ISIN dans l'adresse, partagé avec les autres onglets), répond à 4 questions,
 * puis voit plusieurs scénarios (jamais une seule « prévision »), l'éventail des trajectoires possibles,
 * l'effet des frais et de l'inflation, des crises rejouées, un objectif, une comparaison et un portefeuille.
 * Les calculs sont dans projection.js ; le contexte (macro, géopolitique, risques) dans contexte-fonds.js.
 */

const HORIZONS = [1, 2, 5, 10, 20];
const MOIS_COURANT = moisDe(new Date());
const PLAN_DEFAUT = {
  capital: 10000, versement: 300, frequence: 1, augmentation: 0, annees: 10, debut: MOIS_COURANT,
  reinvestir: true, risque: "equilibre", inflation: null, fraisCourants: null, garde: 0, entree: 0, change: 0,
  courtageFixe: 0, courtagePct: 0, pays: "FR", enveloppe: "aucune", couple: false, primeActions: HYPOTHESES_DEFAUT.primeActions
};
const MODES = [
  { cle: "projection", nom: "Projection", titre: "Voir l'évolution possible de mon investissement", texte: "Scénarios défavorable, central et favorable, sur 1 à 20 ans." },
  { cle: "objectif", nom: "Objectif", titre: "Atteindre un objectif", texte: "Combien verser, et pendant combien de temps, pour viser un montant ?" },
  { cle: "contexte", nom: "Contexte & risques", titre: "Comprendre les risques de ce fonds", texte: "Risques, économie, géopolitique, technologies, composition." },
  { cle: "crises", nom: "Crises", titre: "Et si le marché connaissait une crise ?", texte: "Rejouer 2008, le Covid, 2022… ou une baisse de 20 % ou 40 %." },
  { cle: "comparer", nom: "Comparer", titre: "Comparer plusieurs ETF", texte: "Mêmes versements, plusieurs fonds : voir les différences." },
  { cle: "diversifier", nom: "Réduire le risque", titre: "Réduire mes risques", texte: "Un fonds complémentaire qui répartit mieux le risque, et ce que ça change." },
  { cle: "portefeuille", nom: "Portefeuille", titre: "Construire mon portefeuille", texte: "Plusieurs fonds, avec des poids : diversification, corrélations." }
];
const EXEMPLES_SIMU = [["FR0011871128", "Amundi PEA S&P 500"], ["LU1681043599", "Amundi MSCI World (CW8)"], ["FR0012739431", "BNP Easy Euro Stoxx 50"], ["FR0010135103", "Carmignac Patrimoine"]];
const EXEMPLE_PORTEFEUILLE = [["FR0011871128", 50], ["FR0012739431", 30], ["FR0010429068", 20]];

const S = {
  plan: { ...PLAN_DEFAUT }, simulation: null, demarrage: null, restauration: null, etape: 1, lance: false, mode: "projection",
  fonds: null, chargement: null, calc: null, marche: null, cleMarche: null,
  vue: { reel: false, exemples: true, tensions: true },
  objectif: { montant: 100000, enEurosDuJour: false }, crise: "fin2008",
  comparaisons: [], portefeuille: { lignes: [], calc: null, enCours: false }
};
let numeroChargement = 0;

const zoneFonds = document.getElementById("fonds-simu");
const zoneAssistant = document.getElementById("assistant");
const zoneResultats = document.getElementById("resultats-simu");

// ---------- Enregistrement dans le compte (Supabase) : plus rien n'est gardé dans le navigateur ----------

let minuterieEnregistrement = 0;
const etatEnregistrement = document.getElementById("etat-enregistrement");

function etatCourant() {
  const plan = { ...S.plan };
  delete plan.debut;
  return { plan, mode: S.mode,
    comparaisons: S.comparaisons.map(c => cleEntree(c.entree, c.isin)),
    portefeuille: S.portefeuille.lignes.map(l => ({ fonds: cleEntree(l.entree, l.isin), poids: l.poids })) };
}
function programmerEnregistrement() {
  if (!S.simulation || S.restauration) return;
  clearTimeout(minuterieEnregistrement);
  minuterieEnregistrement = setTimeout(async () => {
    try {
      await Compte.enregistrerSimulation(S.simulation.id, etatCourant());
      if (etatEnregistrement) etatEnregistrement.textContent = `Simulation enregistrée dans ton compte à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`;
    } catch (err) {
      if (etatEnregistrement) etatEnregistrement.textContent = err.code === "non_connecte"
        ? "Ta session a expiré : tes derniers changements ne sont pas enregistrés. Reconnecte-toi dans un autre onglet, puis modifie un réglage."
        : `Enregistrement impossible : ${err.message}`;
    }
  }, 1500);
}

// ---------- Décompte d'une simulation (un nouveau fonds principal = une simulation) ----------

function ecranAbonnement() {
  return `<section class="carte carte-abonnement">
    <h2>Tes ${CONFIG_COMPTE.simulationsOffertes} simulations offertes sont utilisées</h2>
    <p>Tu peux toujours rouvrir et modifier celles que tu as enregistrées. Pour simuler un nouveau fonds, passe à l'abonnement :
      simulations illimitées, comparaisons et portefeuilles enregistrés.</p>
    <p class="actions-compte"><a class="btn" href="abonnement.html">Voir l'abonnement</a> <a class="btn-secondaire" href="compte.html#simulations">Mes simulations</a></p>
  </section>`;
}

async function assurerSimulation() {
  const { entree, isin } = S.chargement;
  const fonds = cleEntree(entree, isin);
  if (S.simulation && S.simulation.fonds === fonds) return true;
  if (!S.demarrage) {   // une seule demande à la fois (double clic, rendu en double)
    S.demarrage = Compte.demarrerSimulation(fonds, entree.nom).then(id => { S.simulation = { id, fonds }; return true; })
      .finally(() => { S.demarrage = null; });
  }
  try { return await S.demarrage; } catch (err) {
    S.lance = false;
    zoneResultats.innerHTML = err.code === "quota_atteint" ? ecranAbonnement()
      : err.code === "non_connecte" ? `<p class="non-dispo carte">Ta session a expiré : <a href="connexion.html?vue=connexion&retour=${encodeURIComponent("simulateur.html" + location.search + location.hash)}">reconnecte-toi</a>.</p>`
      : `<p class="non-dispo carte">Simulation impossible : ${esc(err.message)}</p>`;
    return false;
  }
}

// ---------- Chargement et analyse d'un fonds ----------

function tauxActuels() {
  const v = (cle, defaut) => { const i = indicateurCtx(cle); return i ? { valeur: i.valeur, date: i.date, ancien: donneeAncienne(i) } : { valeur: defaut, date: null, defaut: true }; };
  return { taux10: v("taux10_euro", 3), taux3: v("taux3_euro", 2.5), estr: v("estr", 2) };
}

function inflationParDefaut() {
  const i = indicateurCtx("anticipations_inflation");
  return i ? Math.round(i.valeur * 10) / 10 : 2;
}

async function chargerAnalyse(entree, isin, { composition = true, progression = () => {} } = {}) {
  const A = { entree, isin, nom: entree.nom, erreurs: [] };
  let historique = null, documents = [];
  if (entree.source === "G") {
    progression("Lecture des données officielles du fonds (AMF)…");
    const d = await chargerDonneesGeco(entree, isin);
    Object.assign(A, { part: d.part, parts: d.parts, dic: d.dic, statsReelles: d.stats, encours: d.encours });
    documents = d.documents || [];
    A.erreurs.push(...(d.erreurs || []));
    try {
      progression("Chargement de tout l'historique des valeurs liquidatives…");
      const h = await gecoJson(`/funds/chart/${d.part.idInterne}?startDate=1990-01-01`);
      if (h.x && h.x.length > 1) historique = historiqueDepuisGeco(h);
    } catch (e) { historique = d.historique || null; }
    if (!historique) historique = d.historique || null;
    A.sourceHistorique = "reel";
  } else {
    const jumeau = trouverJumeau(entree.nom, false);
    if (jumeau) {
      progression(`Chargement de l'historique d'un fonds français qui suit le même indice (${jumeau.indice})…`);
      A.jumeau = jumeau;
      const r = await historiqueCompletGeco(jumeau.fonds, jumeau.fonds.isins[0]);
      historique = r.historique;
      A.sourceHistorique = "jumeau";
      try { documents = await gecoJson(`/document/byCompartAndProduct?compartCode=c${jumeau.fonds.cmpId}&prdCode=p${jumeau.fonds.prdId}`); } catch (e) { documents = []; }
    } else A.sourceHistorique = "profil";
  }
  A.historique = historique;
  A.derniereVL = historique && historique.dates.length ? historique.dates[historique.dates.length - 1] : null;

  // Exposition : analyse des rendements (3 dernières années)
  if (historique && historique.valeurs.length >= 60) {
    progression("Analyse des rendements : à quoi le fonds est-il réellement exposé ?");
    try { A.st = await styleAvecCache(A.jumeau ? A.jumeau.fonds.isins[0] : isin, historique); } catch (e) { A.st = null; }
  }
  const styleOk = A.st && A.st.r2 >= 0.5;
  A.expo = styleOk ? A.st.expositions.map(x => ({ cle: x.cle, poids: x.poids })) : expositionsParDefaut(entree);
  A.sourceExpo = styleOk ? "style" : "defaut";

  // Historique long : réel + reconstitué avant la création du fonds
  progression("Reconstitution de l'historique long (fonds de référence depuis les années 1990)…");
  const longues = await chargerSeriesLongues(SERIES_LONGUES.map(s => s.cle));
  const couche = styleOk && Math.abs(A.st.dollar.couche) >= 10 ? A.st.dollar.couche : 0;
  const dollar = couche ? await serieDollarMensuelle().catch(() => null) : null;
  const reel = historique ? rendementsMensuels(niveauxMensuels(historique)) : new Map();
  // Reconstitution quand l'exposition est bien identifiée, ou faute de mieux quand l'historique réel est trop court
  const proxy = (styleOk && A.st.r2 >= 0.75) || A.sourceExpo === "defaut" || reel.size < 36 ? reconstituer(A.expo, couche, longues, dollar) : null;
  A.comb = historiqueCombine(reel, proxy);
  A.referencesUtilisees = proxy ? SERIES_LONGUES.filter(s => A.expo.some(x => x.cle === s.cle)) : [];
  if (A.comb.r.length < 24) throw new Error("historique trop court pour une simulation fiable (moins de 2 ans de données)");
  A.statsH = statsHistorique(A.comb);
  const mondial = marcheMondial(longues);
  A.marcheMondial = mondial;
  A.comportement = mondial && mondial.size ? comportementMarche(A.comb, mondial) : null;

  // Frais courants : lus dans le DIC, sinon hypothèse signalée
  const dic = A.dic;
  if (dic && dic.gestion !== null && dic.gestion !== undefined) { A.ter = (dic.gestion || 0) + (dic.transaction || 0); A.terSource = "dic"; }
  else { A.ter = entree.etf || /\bETF\b|UCITS/i.test(entree.nom) ? 0.25 : 1.5; A.terSource = "hypothese"; }
  A.entreeMax = dic && dic.entree ? dic.entree : 0;
  A.distribuante = /distrib/i.test((A.part && A.part.parAffctnRevnuLib) || "") || (!A.part && indicesDuNom(entree.nom).distribution);
  A.synthetique = estSynthetique(entree, indicesDuNom(entree.nom), dic);
  A.taux = tauxActuels();
  calculerModele(A, S.plan.primeActions);

  // Composition détaillée (lecture du rapport annuel) : plus longue, on ne l'attend pas
  A.compo = A.st ? assemblerComposition(null, A.st, A.part) : null;
  if (composition && documents.length) {
    A.compoEnCours = true;
    A.promesseCompo = inventaireAvecCache(documents, A.jumeau ? A.jumeau.fonds.nom : entree.nom, () => {}, A.st)
      .then(inv => { A.compo = assemblerComposition(inv, A.st, A.part) || A.compo; })
      .catch(() => {})
      .finally(() => { A.compoEnCours = false; });
  }
  return A;
}

function calculerModele(A, primeActions) {
  const taux = { taux10: A.taux.taux10.valeur, taux3: A.taux.taux3.valeur, estr: A.taux.estr.valeur };
  A.modele = modeleDeRendement({ comb: A.comb, expositions: A.expo, taux, ter: A.ter, hyp: { ...HYPOTHESES_DEFAUT, primeActions } });
}

function marcheDuFonds(A) {
  const cle = `${A.isin || A.nom}|${A.modele.g.toFixed(6)}|${A.modele.sigma.toFixed(6)}`;
  if (A.cleMarche !== cle) { A.marche = simulerMarches({ r: A.comb.r, g: A.modele.g, sigma: A.modele.sigma }); A.cleMarche = cle; }
  return A.marche;
}

// ---------- Plan complet pour le moteur ----------

function planMoteur(A, plan = S.plan) {
  const nombre = (v, d = 0) => { const x = parseFloat(String(v).replace(",", ".")); return isNaN(x) ? d : x; };
  return {
    capital: Math.max(0, nombre(plan.capital)), versement: Math.max(0, nombre(plan.versement)), frequence: Number(plan.frequence) || 1,
    augmentation: nombre(plan.augmentation), mois: Math.max(1, Math.min(40, Math.round(nombre(plan.annees, 10)))) * 12,
    inflation: plan.inflation === null || plan.inflation === "" ? inflationParDefaut() : nombre(plan.inflation, 2),
    frais: { courants: plan.fraisCourants === null || plan.fraisCourants === "" ? A.ter : nombre(plan.fraisCourants), garde: nombre(plan.garde),
      entree: nombre(plan.entree), change: nombre(plan.change), courtageFixe: nombre(plan.courtageFixe), courtagePct: nombre(plan.courtagePct) },
    dividendes: { rendement: A.modele.rendDividende * 100, reinvestis: plan.reinvestir !== false },
    fiscalite: plan.pays === "FR" && plan.enveloppe !== "aucune" ? { enveloppe: plan.enveloppe, couple: !!plan.couple, partDistribuante: A.distribuante } : null
  };
}

// Mois déjà écoulés si la date de début est dans le passé (rendements réels du fonds)
function moisPasses(A, debut) {
  if (!debut || debut >= MOIS_COURANT) return { passe: [], debutEffectif: debut || MOIS_COURANT };
  let i = A.comb.mois.indexOf(debut);
  let debutEffectif = debut;
  if (i < 0) { i = debut < A.comb.mois[0] ? 0 : -1; debutEffectif = A.comb.mois[0]; }
  if (i < 0) return { passe: [], debutEffectif: MOIS_COURANT };
  return { passe: A.comb.r.slice(i), reconstitue: A.comb.reel.slice(i).some(x => !x), debutEffectif, ajuste: debutEffectif !== debut };
}

// ---------- Calculs de la projection ----------

function calculer(A = S.fonds, plan = S.plan) {
  const P = planMoteur(A, plan);
  const T = P.mois;
  const { passe, debutEffectif, reconstitue, ajuste } = moisPasses(A, plan.debut);
  const k = Math.min(passe.length, T);
  const base = marcheDuFonds(A);
  const marche = k ? marcheAvecPasse(base, passe.slice(0, k)) : base;
  const res = appliquerPlan(marche, P, { garderMensuel: true });
  const ev = eventail(res);
  const resLong = appliquerPlan(marche, { ...P, mois: Math.max(240, T) }, { pas: 12 });
  const scen = { defavorable: scenario(res, 0.1, T), central: scenario(res, 0.5, T), favorable: scenario(res, 0.9, T) };
  // Tensions : forte baisse pendant la dernière année avant l'échéance
  // (amplitude = pire baisse sur 12 mois de l'historique, au moins 1,5 fois la volatilité annuelle)
  const baisse = Math.min(0.55, Math.max(-A.statsH.pire12, 1.5 * A.modele.sigma));
  const futur = Math.max(1, T - k);
  let mt = marcheTensions(baisse, A.modele.g, futur, futur);
  if (k) mt = marcheAvecPasse(mt, passe.slice(0, k));
  const resT = appliquerPlan(mt, P, { garderMensuel: true, pas: res.pas });
  scen.tensions = { ...scenarioUnique(resT, T), baisse };
  const horizons = {};
  for (const h of HORIZONS) {
    const t = h * 12;
    if (t > resLong.T) continue;
    const col = colonnePatrimoine(resLong, t).sort();
    horizons[h] = { p10: quantileTrie(col, 0.1), p25: quantileTrie(col, 0.25), p50: quantileTrie(col, 0.5), p75: quantileTrie(col, 0.75), p90: quantileTrie(col, 0.9),
      verse: resLong.verse[t], perte: probabiliteDePerte(resLong, t), central: scenario(resLong, 0.5, t) };
  }
  const exemples = [];
  const M = marche.mois + 1;
  // Trois trajectoires d'exemple (proches des rangs 25 %, 50 % et 75 %) pour montrer qu'aucune n'est régulière
  const finales = colonnePatrimoine(res, T);
  const tri = Array.from(finales.keys()).slice(0, 600).sort((a, b) => finales[a] - finales[b]);
  for (const p of [0.25, 0.5, 0.75]) {
    const i = tri[Math.round((tri.length - 1) * p)];
    const serie = new Float64Array(T + 1);
    for (let t = 0; t <= T; t++) serie[t] = res.V[i * (T + 1) + t];
    exemples.push(serie);
  }
  const exemple = trajectoireExemple(marche, res, Math.max(1, Math.floor(T / 12)));
  const tensionsSerie = Float64Array.from({ length: T + 1 }, (_, t) => resT.V[t]);
  return { A, P, T, k, debut: debutEffectif, ajuste, reconstitue, marche, res, ev, resLong, scen, horizons, exemples, exemple, tensionsSerie,
    baisses: baissesEnCoursDeRoute(res), finales, M };
}

// ---------- Recherche d'un fonds ----------

const champSimu = document.getElementById("champ-recherche");
document.getElementById("form-recherche").addEventListener("submit", e => {
  e.preventDefault();
  const reels = rechercherAnnuaire(champSimu.value);
  if (reels.length === 1) location.hash = cleEntree(reels[0], reels[0].isins.includes(champSimu.value.trim().toUpperCase()) ? champSimu.value.trim().toUpperCase() : null);
  else zoneFonds.innerHTML = afficherListe(champSimu.value, reels);
});
document.getElementById("exemples").innerHTML = "<span>Exemples :</span> " + EXEMPLES_SIMU.filter(([i]) => annuaireParIsin(i))
  .map(([i, n]) => `<a href="#${i}" class="chip">${esc(n)}</a>`).join(" ");

// ---------- Affichage du fonds choisi ----------

function carteFonds(A, message) {
  const e = A ? A.entree : S.chargement.entree, isin = A ? A.isin : S.chargement.isin;
  const cle = cleEntree(e, isin);
  const badges = [];
  if (e.etf) badges.push("ETF");
  if (A && A.part && A.part.parAffctnRevnuLib) badges.push(A.part.parAffctnRevnuLib);
  if (A && A.dic && A.dic.sri) badges.push(`Risque ${A.dic.sri}/7`);
  if (A) badges.push(`Frais courants ${pct(A.ter, 2)}${A.terSource === "hypothese" ? " (hypothèse)" : ""}`);
  return `<article class="carte carte-fonds-simu">
    <div class="fonds-simu-titre">
      <div><p class="surtitre">Fonds simulé</p><h2>${esc(e.nom)}</h2>
        <p class="aide">${esc(isin || "ISIN non publié")}${e.gestionnaire ? " · " + esc(e.gestionnaire) : ""}</p></div>
      <div class="actions-fiche"><a class="btn-onglet" href="decrypte.html#${esc(cle)}">Décrypter ce fonds →</a><a class="btn-onglet" href="performances.html#${esc(cle)}">Performances →</a></div>
    </div>
    ${badges.length ? `<div class="etiquettes">${badges.map(b => `<span class="etiquette">${esc(b)}</span>`).join("")}</div>` : ""}
    ${message ? `<p class="chargement">${esc(message)}</p>` : ""}
    ${A && A.jumeau ? `<p class="note">Pas d'historique public et gratuit pour cet ETF étranger : la simulation s'appuie sur un fonds français qui suit le <strong>même indice (${esc(A.jumeau.indice)})</strong>, <a href="decrypte.html#${esc(A.jumeau.fonds.isins[0])}">${esc(A.jumeau.fonds.nom)}</a>. Les frais courants de l'ETF sont une hypothèse modifiable dans les options.</p>` : ""}
    ${A && A.sourceHistorique === "profil" ? `<p class="note">Aucun historique public pour ce fonds ni pour un fonds comparable : la simulation utilise un <strong>profil type</strong> déduit de sa classification ou de son nom. Résultats très approximatifs.</p>` : ""}
    ${A && A.derniereVL ? `<p class="source">Dernière valeur liquidative utilisée : ${A.derniereVL.toLocaleDateString("fr-FR")} (AMF – GECO)${(Date.now() - A.derniereVL) / 864e5 > 15 ? " — <strong>donnée ancienne</strong>" : ""}.</p>` : ""}
  </article>`;
}

async function afficherDepuisAdresse() {
  const cle = decodeURIComponent(location.hash.slice(1));
  const numero = ++numeroChargement;
  if (!cle) { zoneFonds.innerHTML = ""; zoneAssistant.hidden = true; zoneResultats.innerHTML = ""; document.title = "Simulateur · Décrypte ton fonds"; return; }
  const entree = annuaireParIsin(cle) || annuaireParCle(cle);
  if (!entree) { zoneFonds.innerHTML = afficherListe(cle, []); return; }
  const isin = entree.isins.includes(cle) ? cle : entree.isins[0];
  document.title = `${entree.nom} · Simulateur`;
  S.fonds = null; S.calc = null; S.chargement = { entree, isin }; S.planOuvert = false;
  S.comparaisons = []; S.portefeuille = { lignes: [], calc: null };
  if (!S.restauration) S.simulation = null;   // un nouveau fonds n'hérite pas de la simulation précédente
  zoneFonds.innerHTML = carteFonds(null, "Préparation de la simulation…");
  zoneAssistant.hidden = false;
  rendreAssistant();
  zoneResultats.innerHTML = "";
  try {
    const A = await chargerAnalyse(entree, isin, { progression: m => { if (numero === numeroChargement) zoneFonds.innerHTML = carteFonds(null, m); } });
    if (numero !== numeroChargement) return;
    S.fonds = A;
    zoneFonds.innerHTML = carteFonds(A);
    rendreAssistant();
    if (S.restauration) await restaurerExtras(A); else if (S.lance && await assurerSimulation()) lancer();
    if (A.promesseCompo) A.promesseCompo.then(() => { if (S.fonds === A && S.lance && S.mode === "contexte") rendreResultats(); });
  } catch (err) {
    if (numero !== numeroChargement) return;
    zoneFonds.innerHTML = carteFonds(null) + `<p class="non-dispo">Simulation impossible pour ce fonds : ${esc(err.message)}.</p>`;
  }
}

// ---------- Assistant en 4 étapes ----------

function champNombre(champ, valeur, attributs = "") {
  return `<input type="number" inputmode="decimal" data-champ="${champ}" value="${esc(valeur)}" ${attributs}>`;
}
function puces(champ, valeurs, courant, format) {
  return `<div class="puces" role="group">${valeurs.map(v => `<button type="button" class="puce" data-puce="${champ}" data-valeur="${v}" aria-pressed="${String(Number(courant) === v)}">${format(v)}</button>`).join("")}</div>`;
}
const LIBELLE_FREQUENCE = { 1: "par mois", 3: "par trimestre", 12: "par an" };

function etapeCapital() {
  return `<h2 class="question">Combien souhaites-tu investir au départ ?</h2>
    <label class="champ-montant"><span class="sr-only">Capital initial en euros</span>${champNombre("capital", S.plan.capital, 'min="0" step="any"')}<span>€</span></label>
    ${puces("capital", [0, 1000, 5000, 10000, 50000], S.plan.capital, v => v.toLocaleString("fr-FR") + " €")}
    <p class="aide">Tu peux mettre 0 si tu préfères investir seulement de façon régulière.</p>`;
}
function etapeVersement() {
  return `<h2 class="question">Combien souhaites-tu investir ${S.plan.frequence == 1 ? "chaque mois" : S.plan.frequence == 3 ? "chaque trimestre" : "chaque année"} ?</h2>
    <label class="champ-montant"><span class="sr-only">Versement régulier en euros</span>${champNombre("versement", S.plan.versement, 'min="0" step="any"')}<span>€</span></label>
    ${puces("versement", [0, 100, 300, 500, 1000], S.plan.versement, v => v.toLocaleString("fr-FR") + " €")}
    <div class="ligne-options">
      <label>Fréquence <select data-champ="frequence">${[1, 3, 12].map(f => `<option value="${f}"${Number(S.plan.frequence) === f ? " selected" : ""}>${f === 1 ? "mensuelle" : f === 3 ? "trimestrielle" : "annuelle"}</option>`).join("")}</select></label>
      <label>Augmenter mes versements de ${champNombre("augmentation", S.plan.augmentation, 'min="0" max="20" step="0.5" class="court"')} % par an</label>
    </div>`;
}
function etapeDuree() {
  const autre = !HORIZONS.includes(Number(S.plan.annees));
  return `<h2 class="question">Pendant combien de temps ?</h2>
    ${puces("annees", HORIZONS, S.plan.annees, v => `${v} an${v > 1 ? "s" : ""}`)}
    <div class="ligne-options">
      <label>Autre durée ${champNombre("annees", autre ? S.plan.annees : "", 'min="1" max="40" step="1" class="court" placeholder="15"')} ans</label>
      <label>Date de début <input type="month" data-champ="debut" value="${esc(S.plan.debut)}" max="${moisDe(new Date(new Date().getFullYear() + 5, 0, 1))}"></label>
    </div>
    ${S.plan.debut < MOIS_COURANT ? `<p class="note">Date passée : les premiers mois de la simulation suivent l'<strong>historique réel</strong> du fonds, la suite est simulée.</p>` : ""}`;
}
function etapeChoix() {
  return `<h2 class="question">Que souhaites-tu simuler ?</h2>
    <div class="choix-modes">${MODES.map(m => `<button type="button" class="choix-mode" data-mode="${m.cle}" aria-pressed="${String(S.mode === m.cle)}">
      <strong>${esc(m.titre)}</strong><span>${esc(m.texte)}</span></button>`).join("")}</div>
    <div class="ligne-options">
      <fieldset class="groupe-puces"><legend>Niveau de risque accepté</legend>
        ${Object.entries(PROFILS_RISQUE).map(([k, p]) => `<label class="puce-radio"><input type="radio" name="risque" data-champ="risque" value="${k}"${S.plan.risque === k ? " checked" : ""}><span>${p.nom}</span></label>`).join("")}
      </fieldset>
      <fieldset class="groupe-puces"><legend>${terme("capitalisation", "Dividendes")}</legend>
        <label class="puce-radio"><input type="radio" name="reinvestir" data-champ="reinvestir" value="oui"${S.plan.reinvestir ? " checked" : ""}><span>réinvestis</span></label>
        <label class="puce-radio"><input type="radio" name="reinvestir" data-champ="reinvestir" value="non"${!S.plan.reinvestir ? " checked" : ""}><span>versés</span></label>
      </fieldset>
    </div>
    ${optionsAvancees()}`;
}

function optionsAvancees() {
  const A = S.fonds;
  const p = S.plan;
  const infl = inflationParDefaut();
  return `<details class="options-avancees"${S.optionsOuvertes ? " open" : ""}>
    <summary>Options avancées : inflation, frais, fiscalité</summary>
    <div class="grille-options">
      <label>Inflation (% par an) ${champNombre("inflation", p.inflation ?? "", `step="0.1" placeholder="${String(infl).replace(".", ",")}"`)}
        <small>Par défaut : ${pct(infl)} = inflation attendue à long terme par les prévisionnistes de la BCE${indicateurCtx("anticipations_inflation") ? ` (enquête ${esc(indicateurCtx("anticipations_inflation").date.replace("-Q", " T"))})` : ""}.</small></label>
      <label>${terme("frais_courants", "Frais courants du fonds")} (% par an) ${champNombre("fraisCourants", p.fraisCourants ?? "", `step="0.01" placeholder="${A ? String(Math.round(A.ter * 100) / 100).replace(".", ",") : ""}"`)}
        <small>${A ? (A.terSource === "dic" ? `Lus dans le DIC : ${pct(A.ter, 2)}.` : `Non disponibles : hypothèse de ${pct(A.ter, 2)}, à vérifier dans le DIC.`) : ""}</small></label>
      <label>${terme("frais_entree", "Frais d'entrée")} (% de chaque versement) ${champNombre("entree", p.entree, 'step="0.1" min="0"')}
        <small>${A && A.entreeMax ? `Le DIC prévoit jusqu'à ${pct(A.entreeMax)} : souvent nuls en ligne.` : "Souvent nuls pour un ETF."}</small></label>
      <label>Frais de courtage (€ par ordre) ${champNombre("courtageFixe", p.courtageFixe, 'step="0.5" min="0"')}</label>
      <label>Frais de courtage (% par ordre) ${champNombre("courtagePct", p.courtagePct, 'step="0.05" min="0"')}</label>
      <label>Frais de change (% de chaque versement) ${champNombre("change", p.change, 'step="0.05" min="0"')}
        <small>Si ton courtier convertit tes euros dans une autre devise.</small></label>
      <label>Droits de garde ou frais de contrat (% par an) ${champNombre("garde", p.garde, 'step="0.05" min="0"')}
        <small>Ex. frais de gestion d'une assurance-vie (souvent 0,5 à 1 %).</small></label>
      <label>Prime de risque des actions (% par an) ${champNombre("primeActions", p.primeActions, 'step="0.1" min="0" max="8"')}
        <small>Rendement supplémentaire attendu des actions par rapport aux emprunts d'État (hypothèse du modèle).</small></label>
    </div>
    <fieldset class="fiscalite"><legend>Fiscalité (seulement si les règles sont fiables)</legend>
      <label>Pays <select data-champ="pays"><option value="FR"${p.pays === "FR" ? " selected" : ""}>France</option><option value="autre"${p.pays !== "FR" ? " selected" : ""}>Autre pays</option></select></label>
      ${p.pays === "FR" ? `<label>Enveloppe <select data-champ="enveloppe">
          <option value="aucune"${p.enveloppe === "aucune" ? " selected" : ""}>Ne pas calculer</option>
          <option value="cto"${p.enveloppe === "cto" ? " selected" : ""}>Compte-titres</option>
          <option value="pea"${p.enveloppe === "pea" ? " selected" : ""}>PEA</option>
          <option value="av"${p.enveloppe === "av" ? " selected" : ""}>Assurance-vie</option></select></label>
        ${p.enveloppe === "av" ? `<label class="case"><input type="checkbox" data-champ="couple"${p.couple ? " checked" : ""}> Imposition commune (couple)</label>` : ""}
        <p class="aide">Règles en vigueur en 2026 (${esc(FISCALITE_FR.source)}, pages mises à jour le ${dateFr(FISCALITE_FR.maj)}) : prélèvement forfaitaire unique de 31,4 % (12,8 % d'impôt + 18,6 % de prélèvements sociaux) ; PEA de plus de 5 ans : 18,6 % ; assurance-vie : 17,2 % de prélèvements sociaux, et après 8 ans 7,5 % d'impôt après abattement de 4 600 € (9 200 € pour un couple). Calcul simplifié : retrait total à la fin, sans le barème progressif.
          <a href="${FISCALITE_FR.liens.pfu}" target="_blank" rel="noopener">Source</a></p>`
        : `<p class="aide">La fiscalité n'est calculée que pour la France : les règles des autres pays ne sont pas intégrées de façon fiable.</p>`}
    </fieldset>
  </details>`;
}

function rendreAssistant() {
  if (!S.chargement && !S.fonds) { zoneAssistant.hidden = true; return; }
  zoneAssistant.hidden = false;
  if (S.lance) {
    // Après la première simulation : le plan est replié derrière un bouton, pour laisser la place aux résultats
    zoneAssistant.innerHTML = `<div class="plan-bascule"><button type="button" class="btn btn-contour" id="modifier-plan" aria-controls="plan-compact"></button></div>
    <div class="plan-compact carte" id="plan-compact">
      <div class="plan-champs">
        <label>Au départ <span class="champ-euros">${champNombre("capital", S.plan.capital, 'min="0" step="any"')}<span>€</span></span></label>
        <label>Puis <span class="champ-euros">${champNombre("versement", S.plan.versement, 'min="0" step="any"')}<span>€</span></span>
          <select data-champ="frequence" aria-label="Fréquence">${[1, 3, 12].map(f => `<option value="${f}"${Number(S.plan.frequence) === f ? " selected" : ""}>${LIBELLE_FREQUENCE[f]}</option>`).join("")}</select></label>
        <label>Pendant <span class="champ-euros">${champNombre("annees", S.plan.annees, 'min="1" max="40" step="1" class="court"')}<span>ans</span></span></label>
        <label>Dividendes <select data-champ="reinvestir"><option value="oui"${S.plan.reinvestir ? " selected" : ""}>réinvestis</option><option value="non"${!S.plan.reinvestir ? " selected" : ""}>versés</option></select></label>
        <label>Risque accepté <select data-champ="risque">${Object.entries(PROFILS_RISQUE).map(([k, p]) => `<option value="${k}"${S.plan.risque === k ? " selected" : ""}>${p.nom}</option>`).join("")}</select></label>
        <label>Début <input type="month" data-champ="debut" value="${esc(S.plan.debut)}"></label>
      </div>
      ${optionsAvancees()}
    </div>`;
    basculerPlan(S.planOuvert);
    return;
  }
  const etapes = [etapeCapital, etapeVersement, etapeDuree, etapeChoix];
  zoneAssistant.innerHTML = `<div class="carte assistant-carte">
    <div class="progression-etapes" aria-label="Étape ${S.etape} sur 4">
      ${[1, 2, 3, 4].map(i => `<span class="pas${i <= S.etape ? " fait" : ""}"></span>`).join("")}
      <span class="pas-texte">Étape ${S.etape} sur 4</span>
    </div>
    <form id="form-etape" autocomplete="off" novalidate>
      ${etapes[S.etape - 1]()}
      <div class="boutons-etape">
        ${S.etape > 1 ? `<button type="button" class="btn btn-secondaire" id="etape-retour">← Retour</button>` : "<span></span>"}
        <button type="submit" class="btn btn-grand">${S.etape < 4 ? "Suivant →" : S.fonds ? "Lancer la simulation" : "Lancer la simulation (données en cours de chargement…)"}</button>
      </div>
    </form>
  </div>`;
  const champ = zoneAssistant.querySelector(".champ-montant input");
  if (champ && document.activeElement === document.body) champ.focus({ preventScroll: true });
}

// Affiche ou masque les réglages du plan (bouton « Modifier l'investissement »)
function basculerPlan(ouvert) {
  S.planOuvert = !!ouvert;
  const plan = document.getElementById("plan-compact"), bouton = document.getElementById("modifier-plan");
  if (!plan || !bouton) return;
  plan.hidden = !S.planOuvert;
  bouton.setAttribute("aria-expanded", String(S.planOuvert));
  bouton.innerHTML = S.planOuvert ? "Masquer les réglages <span aria-hidden=\"true\">▴</span>" : "<span aria-hidden=\"true\">✎</span> Modifier l'investissement";
}

// Tous les champs du plan : un seul écouteur
function lireChamp(el) {
  const champ = el.dataset.champ;
  if (champ === "reinvestir") return el.value === "oui";
  if (champ === "couple") return el.checked;
  if (["risque", "pays", "enveloppe", "debut"].includes(champ)) return el.value;
  if (["inflation", "fraisCourants"].includes(champ)) return el.value === "" ? null : el.value;
  return el.value;
}
let minuterieCalcul = 0;
function planModifie(redessinerAssistant) {
  programmerEnregistrement();
  if (!S.lance) { if (redessinerAssistant) rendreAssistant(); return; }
  clearTimeout(minuterieCalcul);
  minuterieCalcul = setTimeout(() => {
    if (redessinerAssistant) { const ouvert = zoneAssistant.querySelector(".options-avancees"); S.optionsOuvertes = ouvert && ouvert.open; rendreAssistant(); }
    lancer(true);
  }, 300);
}
zoneAssistant.addEventListener("input", e => {
  const el = e.target.closest("[data-champ]");
  if (!el || el.type === "radio" || el.tagName === "SELECT" || el.type === "month" || el.type === "checkbox") return;
  S.plan[el.dataset.champ] = lireChamp(el);
  if (el.dataset.champ === "primeActions" && S.fonds) { calculerModele(S.fonds, parseFloat(String(S.plan.primeActions).replace(",", ".")) || 0); }
  planModifie(false);
});
zoneAssistant.addEventListener("change", e => {
  const el = e.target.closest("[data-champ]");
  if (!el) return;
  if (el.type === "radio" && !el.checked) return;
  S.plan[el.dataset.champ] = lireChamp(el);
  planModifie(["frequence", "pays", "enveloppe", "debut"].includes(el.dataset.champ));
});
zoneAssistant.addEventListener("toggle", e => { if (e.target.matches(".options-avancees")) S.optionsOuvertes = e.target.open; }, true);
zoneAssistant.addEventListener("click", e => {
  if (e.target.closest("#modifier-plan")) {
    basculerPlan(!S.planOuvert);
    if (S.planOuvert) zoneAssistant.querySelector("#plan-compact input").focus({ preventScroll: true });
    return;
  }
  const puce = e.target.closest("[data-puce]");
  if (puce) { S.plan[puce.dataset.puce] = Number(puce.dataset.valeur); rendreAssistant(); planModifie(false); return; }
  const mode = e.target.closest("[data-mode]");
  if (mode) { S.mode = mode.dataset.mode; programmerEnregistrement(); zoneAssistant.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b === mode))); return; }
  if (e.target.id === "etape-retour") { S.etape = Math.max(1, S.etape - 1); rendreAssistant(); }
});
zoneAssistant.addEventListener("submit", async e => {
  e.preventDefault();
  if (S.etape < 4) { S.etape++; rendreAssistant(); return; }
  if (!S.fonds) { zoneResultats.innerHTML = `<p class="chargement carte">Les données du fonds se chargent : la simulation s'affichera dans un instant…</p>`; S.lance = true; return; }
  S.lance = true;
  S.planOuvert = false;
  rendreAssistant();
  if (await assurerSimulation()) lancer();
});

// ---------- Lancement et rendu des résultats ----------

function lancer(miseAJour) {
  if (!S.fonds) return;
  try {
    S.calc = calculer();
  } catch (err) {
    console.error(err);
    zoneResultats.innerHTML = `<p class="non-dispo carte">Calcul impossible : ${esc(err.message)}</p>`;
    return;
  }
  rendreResultats();
  if (!miseAJour) zoneResultats.scrollIntoView({ behavior: "smooth", block: "start" });
}

function rendreResultats() {
  const C = S.calc;
  if (!C) return;
  zoneResultats.innerHTML = `
    ${resume(C)}
    <nav class="onglets-simu" role="tablist" aria-label="Vues de la simulation">
      ${MODES.map(m => `<button type="button" role="tab" data-onglet="${m.cle}" aria-selected="${String(S.mode === m.cle)}">${esc(m.nom)}</button>`).join("")}
    </nav>
    <div id="panneau-simu" role="tabpanel"></div>
    <p class="avertissement-simu"><strong>Important :</strong> cette simulation repose sur des hypothèses et des données historiques. Elle ne constitue pas une garantie de performance future ni un conseil en investissement.</p>`;
  rendrePanneau();
}

function rendrePanneau() {
  const zone = document.getElementById("panneau-simu");
  if (!zone) return;
  const rendus = { projection: panneauProjection, diversifier: panneauDiversifier, objectif: panneauObjectif, crises: panneauCrises, comparer: panneauComparer, portefeuille: panneauPortefeuille, contexte: panneauContexte };
  zone.innerHTML = rendus[S.mode]();
  apresRendu();
}

function apresRendu() {
  const C = S.calc;
  if (S.mode === "projection") {
    dessinerEventail(document.getElementById("graphique-eventail"), optionsEventail(C));
    dessinerHistogramme(document.getElementById("graphique-histo"), C.finales, [
      { valeur: C.res.verse[C.T], nom: "versé", classe: "verse" },
      { valeur: C.scen.defavorable.total, nom: "défavorable", classe: "p10" },
      { valeur: C.scen.central.total, nom: "central", classe: "p50" },
      { valeur: C.scen.favorable.total, nom: "favorable", classe: "p90" }]);
  }
  if (S.mode === "diversifier") majDiversifier();
  if (S.mode === "objectif") majObjectif();
  if (S.mode === "crises") majCrise();
  if (S.mode === "comparer") majComparaison();
  if (S.mode === "portefeuille") majPortefeuilleGraphique();
}

zoneResultats.addEventListener("click", e => {
  const onglet = e.target.closest("[data-onglet]");
  if (onglet) {
    S.mode = onglet.dataset.onglet;
    programmerEnregistrement();
    basculerPlan(false);
    zoneResultats.querySelectorAll("[data-onglet]").forEach(b => b.setAttribute("aria-selected", String(b === onglet)));
    rendrePanneau();
    return;
  }
  const horizon = e.target.closest("[data-horizon]");
  if (horizon) { S.plan.annees = Number(horizon.dataset.horizon); programmerEnregistrement(); rendreAssistant(); lancer(true); return; }
  const vue = e.target.closest("[data-vue]");
  if (vue) { S.vue[vue.dataset.vue] = !S.vue[vue.dataset.vue]; rendrePanneau(); return; }
  const crise = e.target.closest("[data-crise]");
  if (crise) { S.crise = crise.dataset.crise; rendrePanneau(); return; }
  const retirer = e.target.closest("[data-retirer-comparaison]");
  if (retirer) { S.comparaisons = S.comparaisons.filter(c => cleEntree(c.entree, c.isin) !== retirer.dataset.retirerComparaison); rendrePanneau(); programmerEnregistrement(); return; }
  if (e.target.closest("#exemple-portefeuille")) { chargerExemplePortefeuille(); return; }
  if (e.target.closest("#simuler-portefeuille")) { simulerLePortefeuille(); return; }
  const retirerLigne = e.target.closest("[data-retirer-ligne]");
  if (retirerLigne) { S.portefeuille.lignes.splice(Number(retirerLigne.dataset.retirerLigne), 1); S.portefeuille.calc = null; rendrePanneau(); programmerEnregistrement(); return; }
  const ajout = e.target.closest("[data-ajouter-fonds]");
  if (ajout) { ajouterFonds(ajout.dataset.cible, ajout.dataset.ajouterFonds); return; }
});

// ---------- Résumé en tête ----------

function resume(C) {
  const P = C.P, s = C.scen;
  const plan = [];
  if (P.capital) plan.push(`<strong>${euros(P.capital)}</strong> au départ`);
  if (P.versement) plan.push(`${P.capital ? "puis " : ""}<strong>${euros(P.versement)} ${LIBELLE_FREQUENCE[P.frequence]}</strong>${P.augmentation ? ` (+${pct(P.augmentation, 1)} par an)` : ""}`);
  return `<section class="resume-simu">
    <p class="resume-phrase">Avec ${plan.join(" ") || "aucun versement"}, pendant <strong>${dureeTexte(C.T)}</strong>${C.k ? ` à partir de ${esc(moisAnnee(dateDuMois(C.debut, 0)))}` : ""}, tu verserais au total <strong>${euros(C.res.verse[C.T])}</strong>.
      Selon nos simulations, la valeur pourrait se situer <strong>entre ${eurosEstimes(s.defavorable.total)} et ${eurosEstimes(s.favorable.total)}</strong> (8 chances sur 10), avec un scénario central à <strong>${eurosEstimes(s.central.total)}</strong>.</p>
    <div class="chiffres-heros">
      <div class="chiffre-heros"><span>Total versé</span><strong>${euros(C.res.verse[C.T])}</strong></div>
      <div class="chiffre-heros accent">${rappelFrais(C)}<span>Scénario central (estimation)</span><strong>${eurosEstimes(s.central.total)}</strong><small class="${s.central.gain >= 0 ? "hausse" : "baisse"}">${eurosSigne(s.central.gain)} · ${pctSigne(s.central.perfAnnualisee)} par an</small></div>
      <div class="chiffre-heros"><span>Fourchette probable (8 chances sur 10)</span><strong>${eurosCourt(s.defavorable.total)} – ${eurosCourt(s.favorable.total)}</strong></div>
    </div>
    ${C.ajuste ? `<p class="note">L'historique du fonds commence en ${esc(moisAnnee(dateDuMois(C.debut, 0)))} : la simulation démarre à cette date.</p>` : ""}
  </section>`;
}

// Petit rappel des frais utilisés dans la simulation, avec leur provenance
function rappelFrais(C) {
  const A = C.A, f = C.P.frais;
  const saisi = v => v !== null && v !== undefined && v !== "";
  const origineCourants = saisi(S.plan.fraisCourants) ? "ta valeur" : A.terSource === "dic" ? "DIC" : "hypothèse";
  const entreeDic = A.entreeMax && !f.entree ? ` (jusqu'à ${pct(A.entreeMax, 1)} selon le DIC)` : "";
  return `<span class="rappel-frais">Frais courants ${pct(f.courants, 2)} / an <em>(${origineCourants})</em> · Frais d'entrée ${pct(f.entree, Number.isInteger(f.entree) ? 0 : 1)}${entreeDic}</span>`;
}

// ---------- Panneau « Projection » ----------

function optionsEventail(C) {
  const infl = C.P.inflation;
  return {
    T: C.T, debut: C.debut, ev: C.ev, verse: C.res.verse, pas: C.res.pas, reel: S.vue.reel, inflation: infl, moisPasses: C.k,
    tensions: S.vue.tensions ? C.tensionsSerie : null, exemples: S.vue.exemples ? C.exemples : null,
    infoSurvol: t => infoSurvol(C, t)
  };
}

function infoSurvol(C, t) {
  const r = C.res;
  const col = colonnePatrimoine(r, t).sort();
  const med = quantileTrie(col, 0.5), p10 = quantileTrie(col, 0.1), p90 = quantileTrie(col, 0.9);
  const verse = r.verse[t];
  const d = medianeColonne(r, "D", t), f = medianeColonne(r, "F", t);
  const inflation = Math.pow(1 + C.P.inflation / 100, t / 12);
  const date = dateDuMois(C.debut, t);
  const quand = t === 0 ? "Au départ" : `${t <= C.k ? "" : "Dans "}${dureeTexte(t)}${t <= C.k ? " (passé réel)" : ""}`;
  return `<div class="bulle-date">${quand} · ${esc(moisAnnee(date))}</div>
    <div class="bulle-ligne"><span>Montant investi</span><strong>${euros(verse)}</strong></div>
    <div class="bulle-ligne"><span>Valeur estimée (médiane)</span><strong>${eurosEstimes(med)}</strong></div>
    <div class="bulle-ligne"><span>8 chances sur 10</span><strong>${eurosCourt(p10)} – ${eurosCourt(p90)}</strong></div>
    <div class="bulle-ligne"><span>Gains potentiels</span><strong class="${med >= verse ? "hausse" : "baisse"}">${eurosSigne(med - verse)}</strong></div>
    <div class="bulle-ligne"><span>Dividendes ${r.reinvestis ? "réinvestis" : "versés"}</span><strong>${eurosEstimes(d)}</strong></div>
    <div class="bulle-ligne"><span>Frais payés</span><strong>${eurosEstimes(f)}</strong></div>
    <div class="bulle-ligne"><span>Après inflation (${pctSigne(inflation - 1)})</span><strong>${eurosEstimes(med / inflation)}</strong></div>
    <div class="bulle-ligne"><span>Rendement estimé</span><strong>${t >= 12 ? pctSigne(tri(C.P, t, med)) + " / an" : "—"}</strong></div>`;
}

function carteScenario(cle, titre, sousTitre, s, P) {
  const lignes = [
    ["Capital investi au total", euros(s.verse)],
    ["Valeur estimée du portefeuille", `<strong>${eurosEstimes(s.total)}</strong>`],
    ["Gain ou perte potentiel", `<span class="${s.gain >= 0 ? "hausse" : "baisse"}">${eurosSigne(s.gain)}</span>`],
    ["Performance cumulée", pctSigne(s.perfCumulee)],
    [terme("performance_annualisee", "Performance annualisée"), pctSigne(s.perfAnnualisee) + " / an"],
    [s.dividendesReinvestis ? "Dividendes réinvestis" : "Dividendes versés", eurosEstimes(s.dividendes)],
    ["Frais payés", eurosEstimes(s.frais)],
    ["Inflation prise en compte", `${pct(P.inflation, 1)} / an (${pctSigne(s.inflationCumulee, 0)} au total)`],
    ["Valeur nominale", eurosEstimes(s.total)],
    ["Valeur réelle après inflation", eurosEstimes(s.valeurReelle)]
  ];
  if (P.fiscalite) lignes.push(["Après impôts (retrait total)", `${eurosEstimes(s.valeurNette)} <small>(impôts ≈ ${eurosEstimes(s.impot)})</small>`]);
  return `<article class="scenario scenario-${cle}">
    <header><h3>${esc(titre)}</h3><p>${sousTitre}</p></header>
    <p class="scenario-valeur">${eurosEstimes(s.total)}</p>
    <dl>${lignes.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>
  </article>`;
}

function panneauProjection() {
  const C = S.calc, A = C.A, P = C.P, s = C.scen;
  const legende = `<ul class="legende-simu">
      <li><span class="cle-bande large"></span>8 chances sur 10</li>
      <li><span class="cle-bande etroite"></span>5 chances sur 10</li>
      <li><span class="cle-ligne mediane"></span>Scénario central (médiane)</li>
      <li><span class="cle-ligne verse"></span>Total versé</li>
      ${S.vue.tensions ? `<li><span class="cle-ligne tensions"></span>Scénario de tensions</li>` : ""}
      ${S.vue.exemples ? `<li><span class="cle-ligne exemple"></span>3 trajectoires possibles</li>` : ""}
    </ul>`;
  const horizonsCartes = HORIZONS.map(h => {
    const x = C.horizons[h];
    if (!x) return "";
    return `<button type="button" class="carte-horizon${h * 12 === C.T ? " actif" : ""}" data-horizon="${h}" aria-label="Simuler sur ${h} ans">
      <span class="horizon-titre">${h} an${h > 1 ? "s" : ""}</span>
      <span class="horizon-valeur">${eurosCourt(x.p50)}</span>
      <span class="horizon-fourchette">${eurosCourt(x.p10)} – ${eurosCourt(x.p90)}</span>
      <span class="horizon-verse">versé ${eurosCourt(x.verse)}</span>
      <span class="horizon-perte">${x.perte < 0.005 ? "perte quasi nulle" : `${pct(x.perte * 100, 0)} de risque de perte`}</span>
    </button>`;
  }).join("");
  // Versé / valeur possible : l'effet des intérêts composés
  const composes = [5, 10, 20].filter(h => C.horizons[h]).map(h => {
    const x = C.horizons[h], gain = Math.max(0, x.p50 - x.verse), total = Math.max(x.p50, x.verse);
    return `<div class="compose-ligne"><span class="compose-an">${h} ans</span>
      <span class="compose-barre"><span class="compose-verse" style="width:${(x.verse / total * 100).toFixed(1)}%"></span><span class="compose-gain" style="width:${(gain / total * 100).toFixed(1)}%"></span></span>
      <span class="compose-texte">${euros(x.verse)} versés → <strong>${eurosEstimes(x.p50)}</strong><small>${x.p50 > x.verse ? `les gains font ${pct(gain / x.p50 * 100, 0)} de la valeur` : "pas de gain dans le scénario central"}</small></span></div>`;
  }).join("");
  const frais = [5, 10, 20].filter(h => C.horizons[h]).map(h => {
    const c = C.horizons[h].central;
    return `<div class="frais-carte"><span class="horizon-titre">${h} ans</span>
      <dl><div><dt>Sans frais</dt><dd>${eurosEstimes(c.valeurSansFrais)}</dd></div><div><dt>Avec frais</dt><dd>${eurosEstimes(c.total)}</dd></div>
      <div class="frais-cout"><dt>Coût total estimé des frais</dt><dd>${eurosEstimes(c.coutFrais)}</dd></div></dl></div>`;
  }).join("");
  const profil = PROFILS_RISQUE[S.plan.risque] || PROFILS_RISQUE.equilibre;
  const probaDepasse = C.baisses.probaAuDela(profil.baisseMax);
  const sri = A.dic && A.dic.sri;
  const exempleAnnees = C.exemple.perfs;
  return `
  <section class="carte carte-graphique-simu">
    <div class="entete-graphique">
      <div><h2>Évolution possible de ton investissement</h2>
        <p class="aide">${HYPOTHESES_DEFAUT.trajectoires.toLocaleString("fr-FR")} trajectoires simulées. Passe la souris (ou le doigt) sur le graphique : chaque ${C.res.pas === 1 ? "mois" : "année"} affiche le détail.</p></div>
      <div class="bascules">
        <button type="button" class="bascule" data-vue="reel" aria-pressed="${S.vue.reel}">Après inflation</button>
        <button type="button" class="bascule" data-vue="exemples" aria-pressed="${S.vue.exemples}">Trajectoires</button>
        <button type="button" class="bascule" data-vue="tensions" aria-pressed="${S.vue.tensions}">Tensions</button>
      </div>
    </div>
    <div class="puces horizons-puces" role="group" aria-label="Durée">${HORIZONS.map(h => `<button type="button" class="puce" data-horizon="${h}" aria-pressed="${String(h * 12 === C.T)}">${h} an${h > 1 ? "s" : ""}</button>`).join("")}</div>
    ${legende}
    <div class="graphique-simu" id="graphique-eventail" tabindex="0" aria-label="Graphique interactif : flèches gauche et droite pour parcourir les années"></div>
    ${S.vue.reel ? `<p class="aide">Valeurs affichées en euros d'aujourd'hui (inflation de ${pct(P.inflation, 1)} par an). Le total versé reste en euros courants.</p>` : ""}
    <div class="exemple-annees">
      <p class="aide"><strong>Aucune trajectoire n'est régulière.</strong> Voici, année par année, celle qui finit le plus près du scénario central :</p>
      ${barresAnnuelles(exempleAnnees, dateDuMois(C.debut, 0).getFullYear())}
    </div>
  </section>

  <section class="scenarios" aria-label="Scénarios">
    ${carteScenario("defavorable", "Scénario défavorable", "Conditions de marché difficiles : 1 chance sur 10 de faire moins bien.", s.defavorable, P)}
    ${carteScenario("central", "Scénario central", "Hypothèses les plus raisonnables selon les données : autant de chances de faire mieux que moins bien.", s.central, P)}
    ${carteScenario("favorable", "Scénario favorable", "Conditions particulièrement favorables : 1 chance sur 10 de faire mieux.", s.favorable, P)}
    ${carteScenario("tensions", "Scénario de tensions", `Une forte baisse temporaire (${pctSigne(-s.tensions.baisse, 0)}) pendant la dernière année, juste avant l'échéance.`, s.tensions, P)}
  </section>

  <section class="carte">
    <h2>Comparer les horizons</h2>
    <p class="aide">Mêmes versements, poursuivis plus ou moins longtemps. Clique sur une durée pour l'afficher en détail.</p>
    <div class="horizons">${horizonsCartes}</div>
  </section>

  <section class="carte">
    <h2>Ce que tu as versé, et ce que ton investissement pourrait valoir</h2>
    <p class="aide">Scénario central. Plus la durée est longue, plus les gains produisent eux-mêmes des gains : ce sont les <strong>intérêts composés</strong>.</p>
    <div class="composes">${composes}</div>
    <ul class="legende-simu"><li><span class="cle-bande verse-fond"></span>Montant versé</li><li><span class="cle-bande gain-fond"></span>Gains potentiels</li></ul>
  </section>

  <section class="carte">
    <h2>L'impact des frais</h2>
    <p class="aide">Scénario central, mêmes rendements de marché. Frais pris en compte : frais courants ${pct(P.frais.courants, 2)} / an${P.frais.garde ? `, frais de contrat ${pct(P.frais.garde, 2)} / an` : ""}${P.frais.entree ? `, entrée ${pct(P.frais.entree, 1)}` : ""}${P.frais.courtageFixe || P.frais.courtagePct ? `, courtage ${P.frais.courtageFixe ? euros(P.frais.courtageFixe) : ""}${P.frais.courtagePct ? " " + pct(P.frais.courtagePct, 2) : ""} par ordre` : ""}${P.frais.change ? `, change ${pct(P.frais.change, 2)}` : ""}. Le coût total inclut ce que ces sommes auraient elles-mêmes rapporté.</p>
    <div class="frais-grille">${frais}</div>
  </section>

  <section class="carte">
    <h2>Inflation : valeur nominale et valeur réelle</h2>
    <p>Dans le scénario central, ton investissement pourrait valoir <strong>${eurosEstimes(s.central.total)}</strong> dans ${dureeTexte(C.T)}.
      Avec une inflation de <strong>${pct(P.inflation, 1)} par an</strong> (hypothèse modifiable dans les options avancées), cela correspondrait à <strong>${eurosEstimes(s.central.valeurReelle)}</strong> d'aujourd'hui :
      les prix auraient augmenté d'environ ${pct(s.central.inflationCumulee * 100, 0)}.</p>
    ${inflationActuelle()}
  </section>

  <section class="carte">
    <h2>${terme("monte_carlo", "Simulation Monte Carlo")} : la répartition des résultats</h2>
    <p>Au lieu d'une seule trajectoire, on en simule ${HYPOTHESES_DEFAUT.trajectoires.toLocaleString("fr-FR")}. Chacune enchaîne des périodes de 12 mois tirées au hasard dans l'historique du fonds
      (bonnes et mauvaises années, krachs et rebonds), recalées sur le rendement et la volatilité retenus. On regarde ensuite comment les résultats se répartissent.</p>
    <div class="graphique-simu" id="graphique-histo" tabindex="0" aria-label="Répartition des valeurs finales"></div>
    <div class="rangs">${[["10 %", 0.1], ["25 %", 0.25], ["50 %", 0.5], ["75 %", 0.75], ["90 %", 0.9]].map(([n, p]) => `<div><span>${n} des simulations en dessous de</span><strong>${eurosEstimes(quantileTrie(Float64Array.from(C.finales).sort(), p))}</strong></div>`).join("")}</div>
    <p class="resume">Selon les hypothèses utilisées, 50 % des simulations aboutissent à une valeur supérieure à ${eurosEstimes(s.central.total)} après ${dureeTexte(C.T)}.</p>
  </section>

  <section class="carte">
    <h2>Ton niveau de risque accepté : ${esc(profil.nom)}</h2>
    <p class="aide">« ${esc(profil.texte)} » : baisse temporaire supportable jusqu'à environ ${pct(profil.baisseMax * 100, 0)}.</p>
    <ul class="liste-alertes">
      <li class="alerte alerte-${probaDepasse > 0.5 ? "rouge" : probaDepasse > 0.2 ? "orange" : "vert"}">${pastille(probaDepasse > 0.5 ? "alerte" : probaDepasse > 0.2 ? "attention" : "vert")}<div>
        <strong>${pct(probaDepasse * 100, 0)} des simulations connaissent une baisse de plus de ${pct(profil.baisseMax * 100, 0)} en cours de route</strong>
        <p>Baisse maximale en cours de route (du point le plus haut au plus bas) : ${pctSigne(C.baisses.mediane, 0)} dans la moitié des simulations, et ${pctSigne(C.baisses.unSurDix, 0)} ou pire dans 1 cas sur 10.</p></div></li>
      ${sri ? `<li class="alerte alerte-${sri > profil.sriMax ? "orange" : "vert"}">${pastille(sri > profil.sriMax ? "attention" : "vert")}<div><strong>Indicateur de risque du fonds : ${sri}/7${sri > profil.sriMax ? ` (au-dessus du niveau habituel pour un profil ${profil.nom.toLowerCase()}, ${profil.sriMax}/7 au plus)` : ""}</strong>
        <p>Profil habituellement associé : ${esc(PROFILS_SRI[sri])}.</p></div></li>` : ""}
    </ul>
  </section>

  ${carteHistorique(A)}

  <section class="carte comprendre">
    <details id="comprendre"><summary class="btn btn-contour">Comprendre cette projection</summary>${comprendre(C)}</details>
  </section>`;
}

function inflationActuelle() {
  const i = indicateurCtx("inflation_euro"), f = indicateurCtx("inflation_fr"), s = indicateurCtx("anticipations_inflation");
  if (!i) return "";
  return `<p class="aide">Pour situer : inflation actuelle ${pct(i.valeur, 1)} en zone euro (${esc(periodeFr(i.date))})${f ? `, ${pct(f.valeur, 1)} en France` : ""} ; inflation attendue à long terme par les prévisionnistes de la BCE : ${s ? pct(s.valeur, 1) : "n.d."}.
    <a href="${esc(i.lien)}" target="_blank" rel="noopener">Source : BCE</a>${donneeAncienne(i) ? " — <strong>donnée ancienne</strong>" : ""}</p>`;
}

function periodeFr(d) {
  if (/^\d{4}-Q\d$/.test(d)) return `${d.slice(6)}e trimestre ${d.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(Number(d.slice(0, 4)), Number(d.slice(5)) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return new Date(d).toLocaleDateString("fr-FR");
}

// Ce que dit l'historique (réel et reconstitué)
function carteHistorique(A) {
  const h = A.statsH, cmp = A.comportement;
  const moisFr = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const premierReel = A.comb.mois[A.comb.nbReconstitues];
  const tuiles = [
    ["Perf. annualisée 1 an", h.perf.a1], ["3 ans", h.perf.a3], ["5 ans", h.perf.a5], ["10 ans", h.perf.a10], ["20 ans", h.perf.a20]
  ].map(([n, v]) => `<div class="tuile"><span>${n}</span><strong class="${v === null ? "" : v >= 0 ? "hausse" : "baisse"}">${v === null ? "—" : pctSigne(v)}</strong></div>`).join("");
  return `<section class="carte">
    <h2>Ce que dit l'historique</h2>
    <p class="aide">${A.comb.nbReconstitues ? `Historique réel du fonds depuis ${esc(moisFr(premierReel))} ; avant, historique <strong>reconstitué</strong> à partir de son exposition estimée (${terme("analyse_style", "analyse des rendements")}) appliquée à des fonds de référence très anciens.` : `Historique réel du fonds${A.jumeau ? " jumeau" : ""} depuis ${esc(moisFr(h.debut))}.`}
      Les performances passées ne préjugent pas des performances futures.</p>
    <div class="chiffres-cles">${tuiles}</div>
    <dl class="grille-infos">
      <div><dt>${terme("volatilite", "Volatilité")} (tout l'historique)</dt><dd>${pct(h.vol * 100)} par an</dd></div>
      <div><dt>${terme("max_drawdown", "Pire baisse")}</dt><dd>${pctSigne(h.perteMax.valeur, 0)} <small>(${esc(moisFr(h.perteMax.debut))} → ${esc(moisFr(h.perteMax.creux))}${h.perteMax.recuperation ? `, rattrapée en ${esc(dureeTexte(h.perteMax.moisRecuperation))}` : ", pas encore rattrapée"})</small></dd></div>
      <div><dt>Meilleurs 12 mois</dt><dd class="hausse">${pctSigne(h.meilleur12, 0)}</dd></div>
      <div><dt>Pires 12 mois</dt><dd class="baisse">${pctSigne(h.pire12, 0)}</dd></div>
      <div><dt>Périodes de 12 mois positives</dt><dd>${pct(h.part12Positifs * 100, 0)}</dd></div>
      ${h.part60Positifs !== null ? `<div><dt>Périodes de 5 ans positives</dt><dd>${pct(h.part60Positifs * 100, 0)}</dd></div>` : ""}
      ${cmp ? `<div class="large"><dt>Selon les conditions de marché (actions mondiales)</dt><dd>Les mois de hausse des marchés, le fonds a fait en moyenne ${pctSigne(cmp.fondsHausse)} (marché : ${pctSigne(cmp.marcheHausse)}) ;
        les mois de baisse, ${pctSigne(cmp.fondsBaisse)} (marché : ${pctSigne(cmp.marcheBaisse)}). Il capte donc environ ${pct(cmp.captureHausse * 100, 0)} des hausses et ${pct(cmp.captureBaisse * 100, 0)} des baisses.</dd></div>` : ""}
    </dl>
    <p class="source">Données brutes : valeurs liquidatives publiées par l'AMF (base GECO)${A.referencesUtilisees.length ? ` ; fonds de référence : ${A.referencesUtilisees.map(r => esc(r.nom)).join(", ")}` : ""}. Calculs : ce site, en données mensuelles, du ${esc(moisFr(h.debut))} au ${esc(moisFr(h.fin))}.</p>
  </section>`;
}

// « Comprendre cette projection »
function comprendre(C) {
  const A = C.A, m = A.modele, P = C.P;
  const t = A.taux;
  const moisFr = x => new Date(Number(x.slice(0, 4)), Number(x.slice(5)) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const tauxTexte = (x, nom) => x.defaut ? `${nom} : ${pct(x.valeur, 2)} (valeur par défaut : donnée indisponible)` : `${nom} : ${pct(x.valeur, 2)} au ${dateFr(x.date)}${x.ancien ? " (donnée ancienne)" : ""}`;
  const classes = Object.entries(m.classes).filter(([, v]) => v > 0.005)
    .map(([k, v]) => `${{ actions: "actions", oblig10: "obligations longues", oblig3: "obligations courtes", monetaire: "monétaire" }[k]} ${pct(v * 100, 0)} → ${pct(m.composantes[k] * 100, 1)}`).join(" ; ");
  const ctx = typeof CONTEXTE !== "undefined" ? CONTEXTE : null;
  return `<div class="comprendre-contenu">
    <h3>Données utilisées</h3>
    <ul>
      <li>Historique mensuel ${A.jumeau ? `du fonds jumeau ${esc(A.jumeau.fonds.nom)}` : "du fonds"} : ${A.comb.nbReels} mois réels${A.comb.nbReconstitues ? ` et ${A.comb.nbReconstitues} mois reconstitués` : ""}, du ${esc(moisFr(A.comb.mois[0]))} au ${esc(moisFr(A.comb.mois[A.comb.mois.length - 1]))}. Source : AMF (GECO)${A.derniereVL ? `, dernière valeur liquidative du ${A.derniereVL.toLocaleDateString("fr-FR")}` : ""}.</li>
      <li>Exposition du fonds : ${A.sourceExpo === "style" ? `analyse des rendements des 3 dernières années (${terme("r2", "R²")} = ${pct(A.st.r2 * 100, 0)})` : "profil type déduit de la classification ou du nom (pas d'analyse possible)"} : ${A.expo.map(x => `${esc((FACTEURS.find(f => f.cle === x.cle) || { nom: x.cle }).nom)} ${pct(x.poids, 0)}`).join(", ")}.</li>
      <li>Frais : ${A.terSource === "dic" ? `DIC « ${esc(A.dic.document.docName)} » du ${dateFr(A.dic.document.dateEffet)}` : "hypothèse (frais non disponibles automatiquement)"}.</li>
      <li>Taux d'intérêt (BCE) : ${tauxTexte(t.taux10, "emprunts d'État à 10 ans")} ; ${tauxTexte(t.taux3, "à 3 ans")} ; ${tauxTexte(t.estr, "€STR")}.</li>
      <li>Inflation : ${indicateurCtx("anticipations_inflation") ? `enquête de la BCE auprès des prévisionnistes (${esc(periodeFr(indicateurCtx("anticipations_inflation").date))})` : "valeur par défaut de 2 %"}${S.plan.inflation !== null && S.plan.inflation !== "" ? " — remplacée par ta valeur" : ""}.</li>
      ${P.fiscalite ? `<li>Fiscalité : règles françaises 2026, ${esc(FISCALITE_FR.source)} (mise à jour le ${dateFr(FISCALITE_FR.maj)}).</li>` : ""}
      <li>Dernière mise à jour des données économiques du site : ${ctx ? new Date(ctx.maj).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : "indisponible"}.</li>
    </ul>
    <h3>Hypothèses</h3>
    <ul>
      <li><strong>Rendement attendu retenu : ${pct(m.g * 100, 2)} par an</strong> avant frais (rendement composé, qui correspond au scénario central), soit ${pct((m.g - P.frais.courants / 100) * 100, 2)} après frais courants.
        C'est un mélange entre :
        <ul><li>une estimation « de marché » de ${pct(m.gMarche * 100, 2)} (poids ${pct((1 - m.poidsHist) * 100, 0)}) : ${classes}. Actions = taux d'État à 10 ans + prime de risque de ${pct(S.plan.primeActions, 1)} (hypothèse) ;</li>
          <li>le rendement historique de ${pct(m.gHist * 100, 2)} avant frais (poids ${pct(m.poidsHist * 100, 0)}). Sur ${m.annees.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ans, la marge d'incertitude de cette moyenne est d'environ ± ${pct(m.erreur * 100, 1)} par an : c'est pourquoi l'historique ne pèse pas davantage. Pour la partie obligataire et monétaire, il pèse encore moins : leur rendement futur dépend surtout des taux actuels.</li></ul></li>
      <li><strong>Volatilité utilisée : ${pct(m.sigma * 100, 1)} par an</strong>, mesurée sur tout l'historique mensuel (crises comprises).</li>
      <li><strong>Inflation utilisée : ${pct(P.inflation, 1)} par an.</strong></li>
      <li><strong>Frais utilisés :</strong> frais courants ${pct(P.frais.courants, 2)} / an${P.frais.garde ? `, frais de contrat ${pct(P.frais.garde, 2)} / an` : ""}, frais d'entrée ${pct(P.frais.entree, 1)}, courtage ${euros(P.frais.courtageFixe)} + ${pct(P.frais.courtagePct, 2)} par ordre, change ${pct(P.frais.change, 2)}.</li>
      <li>Revenus (dividendes, coupons) : environ ${pct(m.rendDividende * 100, 1)} par an, ${P.dividendes.reinvestis ? "réinvestis" : "versés et conservés sans être replacés"}.</li>
      <li>${HYPOTHESES_DEFAUT.trajectoires.toLocaleString("fr-FR")} trajectoires, blocs de ${HYPOTHESES_DEFAUT.bloc} mois consécutifs tirés dans l'historique. Tirages reproductibles : les mêmes données donnent les mêmes chiffres.</li>
      <li>Scénarios : défavorable = 10 % des simulations font moins bien ; central = médiane ; favorable = 10 % font mieux ; tensions = baisse de ${pct(C.scen.tensions.baisse * 100, 0)} pendant les 12 derniers mois (pire baisse sur 12 mois de l'historique du fonds, ou au moins 1,5 fois sa volatilité).</li>
    </ul>
    <h3>Facteurs macroéconomiques pris en compte</h3>
    <p><strong>Dans les chiffres</strong> : le niveau actuel des taux d'intérêt (qui détermine le rendement attendu des obligations, du monétaire et, avec la prime de risque, des actions) et l'inflation attendue.
      <strong>À titre de contexte seulement</strong> (onglet « Contexte & risques ») : croissance, chômage, dette publique, change, géopolitique, technologies. Aucun modèle fiable ne permet de traduire ces éléments en rendement futur : les intégrer dans les chiffres reviendrait à faire une prévision déguisée.</p>
    <h3>Limites du modèle</h3>
    <ul>
      <li>Le futur peut être très différent du passé : crises inédites, changement de gérant ou de politique d'investissement, fermeture du fonds.</li>
      <li>L'historique reconstitué suppose que l'exposition actuelle du fonds était la même dans le passé.</li>
      <li>Les rendements attendus sont des hypothèses : une variation de 1 point par an change fortement le résultat sur 20 ans.</li>
      <li>La fiscalité est simplifiée (retrait total à la fin, pas de barème progressif, règles pouvant changer).</li>
      <li>Les frais réels (courtier, contrat) dépendent de ton intermédiaire : vérifie-les.</li>
    </ul>
  </div>`;
}

// ---------- Panneau « Réduire le risque » ----------

// Part du fonds complémentaire : celle qui réduit le plus les variations du mélange (calculée sur l'historique commun),
// entre 20 % et 50 % pour que le fonds de départ reste majoritaire, arrondie à 5 %
const PART_MIN = 0.2, PART_MAX = 0.5;
function partQuiReduitLeRisque(A, B) {
  const an = analysePortefeuille([{ comb: A.comb, modele: A.modele, poids: 0.5 }, { comb: B.comb, modele: B.modele, poids: 0.5 }]);
  if (an.mois.length < 36) return null;
  const [sa, sb] = an.vols, rho = an.corr[0][1];
  const denom = sa * sa + sb * sb - 2 * rho * sa * sb;
  const w = denom > 0 ? (sa * sa - rho * sa * sb) / denom : PART_MAX;   // mélange à variance minimale
  return Math.round(Math.min(PART_MAX, Math.max(PART_MIN, w)) * 20) / 20;
}

function panneauDiversifier() {
  return `<section class="carte">
    <h2>Réduire le risque : un fonds complémentaire</h2>
    <div id="diversif"><p class="chargement">Recherche d'un fonds complémentaire et calcul des risques…</p></div>
  </section>`;
}

function moisPrecedent(m) { const [a, mm] = m.split("-").map(Number); return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, "0")}`; }

// Le fonds seul, et le mélange avec un fonds complémentaire, sur leur historique commun (rééquilibré chaque mois)
function melange(A, B, w) {
  const an = analysePortefeuille([{ comb: A.comb, modele: A.modele, poids: 1 - w }, { comb: B.comb, modele: B.modele, poids: w }]);
  const n = an.mois.length;
  if (n < 36) return null;
  const stats = r => { const s = statsHistorique({ mois: an.mois, r, reel: an.mois.map(() => true) }); return { vol: s.vol, perteMax: s.perteMax, pire12: s.pire12 }; };
  const k = Math.min(120, n);   // performance : les 10 dernières années au plus
  const croissance = r => { const v = [10000]; for (const x of r.slice(n - k)) v.push(v[v.length - 1] * (1 + x)); return v; };
  const bilan = v => { let sommet = v[0], pire = 0; for (const x of v) { sommet = Math.max(sommet, x); pire = Math.min(pire, x / sommet - 1); } return { finale: v[v.length - 1], annuel: Math.pow(v[v.length - 1] / v[0], 12 / k) - 1, pire }; };
  const vSans = croissance(an.series[0]), vAvec = croissance(an.rp);
  return { n, debut: an.mois[0], corr: an.corr[0][1], sans: stats(an.series[0]), avec: stats(an.rp),
    perf: { debut: moisPrecedent(an.mois[n - k]), mois: k, sans: vSans, avec: vAvec, bilanSans: bilan(vSans), bilanAvec: bilan(vAvec) } };
}

async function calculerDiversification(A) {
  const p = profilDuFonds(A);
  const diag = diagnosticRisque(A, p);
  if (!diag.candidats) return { diag, p };
  const candidats = diag.candidats.map(cle => ({ cle, ...COMPLEMENTS[cle], entree: annuaireParIsin(COMPLEMENTS[cle].isin) }))
    .filter(c => c.entree && c.entree.cmpId !== A.entree.cmpId && !(A.jumeau && A.jumeau.fonds.cmpId === c.entree.cmpId));
  const essais = await Promise.all(candidats.map(async c => {
    try {
      const B = await chargerAnalyse(c.entree, c.isin, { composition: false });
      const w = partQuiReduitLeRisque(A, B);
      const m = w === null ? null : melange(A, B, w);
      return m ? { c, B, m, w } : null;
    }
    catch (e) { return null; }
  }));
  const ok = essais.filter(Boolean);
  if (!ok.length) return { diag, p, erreur: "aucun fonds complémentaire n'a pu être chargé" };
  // On garde le fonds le plus proche (premier de la liste), sauf si un autre réduit nettement plus les variations
  // (plus de 0,5 point de volatilité) sans aggraver la pire baisse
  const meilleur = ok.reduce((b, x) => x.m.avec.vol < b.m.avec.vol ? x : b);
  const choisi = meilleur.m.avec.vol < ok[0].m.avec.vol - 0.005 && meilleur.m.avec.perteMax.valeur >= ok[0].m.avec.perteMax.valeur ? meilleur : ok[0];
  return { diag, p, choisi, autres: ok.filter(x => x !== choisi) };
}

async function majDiversifier() {
  const zone = document.getElementById("diversif");
  const A = S.fonds;
  if (!zone || !A) return;
  if (!A.diversif) A.diversif = calculerDiversification(A);
  let d;
  try { d = await A.diversif; } catch (e) { zone.innerHTML = `<p class="non-dispo">Calcul impossible : ${esc(e.message)}.</p>`; return; }
  if (S.fonds !== A || S.mode !== "diversifier" || !document.getElementById("diversif")) return;
  const cible = document.getElementById("diversif");
  if (!d.choisi) { cible.innerHTML = `<p class="resume">${esc(d.diag.texte)}</p>${d.erreur ? `<p class="non-dispo">${esc(d.erreur)}.</p>` : ""}`; return; }
  const { c, B, m, w } = d.choisi;
  const q = profilDuFonds(B);
  const moisFr = x => new Date(Number(x.slice(0, 4)), Number(x.slice(5)) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const cle = cleEntree(c.entree, c.isin);
  // Lignes du comparatif : [libellé, sans, avec, format, plus bas = mieux]
  const lignes = [
    [terme("volatilite", "Volatilité (ampleur des variations)"), m.sans.vol, m.avec.vol, x => pct(x * 100, 1) + " / an"],
    [terme("max_drawdown", "Pire baisse"), m.sans.perteMax.valeur, m.avec.perteMax.valeur, x => pctSigne(x, 0)],
    ["Pire période de 12 mois", m.sans.pire12, m.avec.pire12, x => pctSigne(x, 0)]
  ];
  if (d.diag.type === "zone") lignes.push([`Part investie ${EN_ZONE[d.diag.zone]}`, d.p[d.diag.zone] / 100, ((1 - w) * d.p[d.diag.zone] + w * q[d.diag.zone]) / 100, x => pct(x * 100, 0)]);
  if (d.diag.type === "taux") lignes.push(["Part en obligations à long terme", d.p.obligLongues / 100, ((1 - w) * d.p.obligLongues + w * q.obligLongues) / 100, x => pct(x * 100, 0)]);
  if (!d.p.couvert) lignes.push([terme("risque_change", "Part en devises étrangères"), d.p.horsEuro / 100, ((1 - w) * d.p.horsEuro + w * q.horsEuro) / 100, x => pct(x * 100, 0)]);
  const effet = (sans, avec) => {
    const moins = Math.abs(avec) < Math.abs(sans) - 0.0005, plus = Math.abs(avec) > Math.abs(sans) + 0.0005;
    return moins ? `<span class="effet mieux">▼ moins de risque</span>` : plus ? `<span class="effet moins-bien">▲ plus de risque</span>` : `<span class="effet">≈ inchangé</span>`;
  };
  const b = m.perf;
  cible.innerHTML = `
    <p class="resume">${esc(d.diag.texte)}</p>
    <article class="complement">
      <p class="surtitre">Exemple de fonds complémentaire</p>
      <h3>${esc(c.entree.nom)}</h3>
      <p>${esc(c.libelle.charAt(0).toUpperCase() + c.libelle.slice(1))} · ${esc(c.isin)} · frais courants ${pct(B.ter, 2)}${B.terSource === "hypothese" ? " (hypothèse)" : ""}</p>
      <p class="aide">Pourquoi celui-ci ? Parmi ${d.autres.length + 1} fonds compatibles, c'est ${d.autres.length ? "celui qui, en l'ajoutant, aurait le plus réduit les variations de l'ensemble" : "le fonds du même type disponible"} depuis ${esc(moisFr(m.debut))}${d.autres.length ? ` (autres possibilités : ${d.autres.map(x => esc(x.c.libelle)).join(", ")})` : ""}.</p>
      <div class="actions-fiche">
        <a class="btn-onglet" href="decrypte.html#${esc(cle)}" target="_blank" rel="noopener">Décrypter ce fonds ↗</a>
        <a class="btn-onglet" href="simulateur.html#${esc(cle)}" target="_blank" rel="noopener">Le simuler seul ↗</a>
      </div>
      <p class="repartition-exemple"><span class="barre-repartition"><span style="width:${(1 - w) * 100}%">${Math.round((1 - w) * 100)} % ton fonds</span><span style="width:${w * 100}%">${Math.round(w * 100)} %</span></span>
        La répartition qui, sur le passé, a le plus réduit les variations (ton fonds restant majoritaire), rééquilibrée chaque mois.</p>
    </article>

    <h3>Les risques : sans et avec ce fonds</h3>
    <div class="comparatif" role="table" aria-label="Risques sans et avec le fonds complémentaire">
      <div class="comparatif-ligne comparatif-entete" role="row"><span role="columnheader"></span><span role="columnheader">Sans</span><span role="columnheader">Avec</span><span role="columnheader">Effet</span></div>
      ${lignes.map(([nom, sans, avec, f]) => `<div class="comparatif-ligne" role="row"><span role="rowheader">${nom}</span><span role="cell">${f(sans)}</span><span role="cell"><strong>${f(avec)}</strong></span><span role="cell">${effet(sans, avec)}</span></div>`).join("")}
    </div>
    <p class="aide">Calculé sur l'historique commun des deux fonds, depuis ${esc(moisFr(m.debut))}. Corrélation entre les deux : ${m.corr.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} (plus elle est basse, plus l'un amortit les chutes de l'autre).</p>

    <h3>Les performances passées : sans et avec</h3>
    <p class="aide">10 000 € investis en ${esc(moisAnnee(dateDuMois(b.debut, 0)))}, sur ${dureeTexte(b.mois)}.</p>
    <ul class="legende-simu"><li><span class="pastille-serie serie-0"></span>Sans : ton fonds seul</li><li><span class="pastille-serie serie-1"></span>Avec : ${Math.round((1 - w) * 100)} % ton fonds + ${Math.round(w * 100)} % ce fonds</li><li><span class="cle-ligne verse"></span>Montant investi</li></ul>
    <div class="graphique-simu" id="graphique-diversif" tabindex="0" aria-label="Évolution de 10 000 euros, sans et avec le fonds complémentaire"></div>
    <div class="comparatif comparatif-perf" role="table" aria-label="Performances sans et avec">
      <div class="comparatif-ligne comparatif-entete" role="row"><span role="columnheader"></span><span role="columnheader">Sans</span><span role="columnheader">Avec</span></div>
      <div class="comparatif-ligne" role="row"><span role="rowheader">Valeur aujourd'hui</span><span role="cell">${euros(b.bilanSans.finale)}</span><span role="cell"><strong>${euros(b.bilanAvec.finale)}</strong></span></div>
      <div class="comparatif-ligne" role="row"><span role="rowheader">${terme("performance_annualisee", "Performance par an")}</span><span role="cell">${pctSigne(b.bilanSans.annuel)}</span><span role="cell"><strong>${pctSigne(b.bilanAvec.annuel)}</strong></span></div>
      <div class="comparatif-ligne" role="row"><span role="rowheader">Pire baisse sur la période</span><span role="cell">${pctSigne(b.bilanSans.pire, 0)}</span><span role="cell"><strong>${pctSigne(b.bilanAvec.pire, 0)}</strong></span></div>
    </div>
    <p class="aide">Réduire le risque réduit souvent aussi la performance : c'est un compromis. Performances passées, frais des deux fonds déduits ; elles ne préjugent pas des performances futures.
      Exemple pédagogique, pas un conseil en investissement.</p>`;
  dessinerMedianes(document.getElementById("graphique-diversif"), [
    { nom: "Sans", ev: { p50: b.sans }, couleur: 0 },
    { nom: "Avec", ev: { p50: b.avec }, couleur: 1 }
  ], b.mois, b.debut, Array(b.mois + 1).fill(10000), { passe: true });
}

// ---------- Panneau « Objectif » ----------

function panneauObjectif() {
  return `<section class="carte">
    <h2>Quel est ton objectif ?</h2>
    <form id="form-objectif" class="ligne-options" autocomplete="off">
      <label class="champ-montant petit">Je veux atteindre <input type="number" id="objectif-montant" min="100" step="any" value="${S.objectif.montant}"><span>€</span></label>
      <label class="case"><input type="checkbox" id="objectif-reel"${S.objectif.enEurosDuJour ? " checked" : ""}> en euros d'aujourd'hui (tenir compte de l'inflation)</label>
    </form>
    <div id="resultat-objectif"><p class="chargement">Calcul des trajectoires…</p></div>
  </section>`;
}

let minuterieObjectif = 0;
function majObjectif() {
  const zone = document.getElementById("resultat-objectif");
  if (!zone) return;
  const form = document.getElementById("form-objectif");
  form.onsubmit = e => e.preventDefault();
  form.oninput = () => {
    S.objectif.montant = Math.max(100, Number(document.getElementById("objectif-montant").value) || 0);
    S.objectif.enEurosDuJour = document.getElementById("objectif-reel").checked;
    clearTimeout(minuterieObjectif); minuterieObjectif = setTimeout(majObjectif, 350);
  };
  const C = S.calc;
  const marche = C.k ? marcheAvecPasse(marcheDuFonds(C.A), moisPasses(C.A, S.plan.debut).passe.slice(0, C.k)) : marcheDuFonds(C.A);
  const o = analyseObjectif(marche, C.P, S.objectif.montant, S.objectif.enEurosDuJour);
  const ans = C.T / 12;
  const freq = LIBELLE_FREQUENCE[C.P.frequence];
  const chance = p => p === 0.5 ? "1 chance sur 2" : p === 0.75 ? "3 chances sur 4" : "9 chances sur 10";
  const annees = Math.min(40, Math.max(ans, ...[0.5, 0.75, 0.9].map(p => o.duree[p] || 0)) + 2);
  zone.innerHTML = `
    <p class="resume-phrase">Avec ton plan actuel, <strong>${pct(o.probabilite * 100, 0)} des simulations</strong> atteignent ${euros(o.cible)}${S.objectif.enEurosDuJour ? ` (soit ${euros(S.objectif.montant)} d'aujourd'hui)` : ""} au bout de ${dureeTexte(C.T)}.</p>
    <div class="objectif-grille">
      <div class="objectif-carte"><h3>Versement ${freq} nécessaire</h3><p class="aide">avec ${euros(C.P.capital)} au départ, pendant ${dureeTexte(C.T)}</p>
        <dl>${[0.5, 0.75, 0.9].map(p => `<div><dt>${chance(p)}</dt><dd>${isFinite(o.versement[p]) ? eurosEstimes(o.versement[p]) : "hors de portée"}</dd></div>`).join("")}</dl></div>
      <div class="objectif-carte"><h3>Capital initial nécessaire</h3><p class="aide">avec ${euros(C.P.versement)} ${freq}, pendant ${dureeTexte(C.T)}</p>
        <dl>${[0.5, 0.75, 0.9].map(p => `<div><dt>${chance(p)}</dt><dd>${eurosEstimes(o.capital[p])}</dd></div>`).join("")}</dl></div>
      <div class="objectif-carte"><h3>Durée nécessaire</h3><p class="aide">avec ${euros(C.P.capital)} au départ et ${euros(C.P.versement)} ${freq}</p>
        <dl>${[0.5, 0.75, 0.9].map(p => `<div><dt>${chance(p)}</dt><dd>${o.duree[p] ? `${o.duree[p]} an${o.duree[p] > 1 ? "s" : ""}` : "plus de 40 ans"}</dd></div>`).join("")}</dl></div>
    </div>
    <ul class="legende-simu"><li><span class="cle-bande large"></span>8 chances sur 10</li><li><span class="cle-ligne mediane"></span>Scénario central</li><li><span class="cle-ligne objectif"></span>Objectif</li><li><span class="cle-ligne verse"></span>Total versé</li></ul>
    <div class="graphique-simu" id="graphique-objectif" tabindex="0"></div>
    <p class="aide">« 1 chance sur 2 » : la moitié des simulations atteignent l'objectif. Pour viser plus de sécurité (3 ou 9 chances sur 10), il faut verser davantage ou attendre plus longtemps. Ce sont des estimations, pas des garanties.</p>`;
  dessinerObjectif(document.getElementById("graphique-objectif"), { annees, p10: o.trajectoires.p10, p50: o.trajectoires.p50, p90: o.trajectoires.p90, verse: o.verseParAn, cible: o.cibleParAn, debut: C.debut });
}

// ---------- Panneau « Crises » ----------

function panneauCrises() {
  const C = S.calc, A = C.A;
  const dispo = CRISES_HISTORIQUES.map(c => ({ c, ok: A.comb.mois.includes(c.debut) }));
  const bouton = (cle, nom, sous, desactive) => `<button type="button" class="choix-crise" data-crise="${cle}" aria-pressed="${String(S.crise === cle)}"${desactive ? " disabled" : ""}><strong>${esc(nom)}</strong><span>${esc(sous)}</span></button>`;
  return `<section class="carte">
    <h2>Et si le marché connaissait une crise ?</h2>
    <p class="aide">Ton plan (${euros(C.P.capital)} au départ${C.P.versement ? `, ${euros(C.P.versement)} ${LIBELLE_FREQUENCE[C.P.frequence]}` : ""}) démarre au début de la crise. <strong>Simulation illustrative, pas une prédiction.</strong></p>
    <div class="crises">
      <div class="liste-crises">
        <p class="crises-groupe">Crises réelles, rejouées sur l'historique du fonds</p>
        ${dispo.map(({ c, ok }) => bouton(c.cle, c.nom, ok ? c.periode : `${c.periode} · historique trop court`, !ok)).join("")}
        <p class="crises-groupe">Hypothèses illustratives</p>
        ${CRISES_HYPOTHETIQUES.map(c => bouton(c.cle, c.nom, `choc estimé pour ce fonds : ${pctSigne(chocDuFonds(c, A.expo), 0)}`)).join("")}
      </div>
      <div class="detail-crise" id="detail-crise"></div>
    </div>
  </section>`;
}

function majCrise() {
  const zone = document.getElementById("detail-crise");
  if (!zone) return;
  const C = S.calc, A = C.A;
  const plan = { ...C.P, mois: 60 };
  const hist = CRISES_HISTORIQUES.find(c => c.cle === S.crise);
  let r, texte, debut = null, reelTexte = "";
  if (hist) {
    r = rejouerCriseHistorique(A.comb, hist, plan, 60);
    if (!r) { S.crise = CRISES_HYPOTHETIQUES[0].cle; return majCrise(); }
    texte = hist.texte; debut = hist.debut;
    reelTexte = r.reel === "reel" ? "Rendements réels du fonds pendant cette période." : r.reel === "mixte" ? "Rendements réels du fonds, complétés avant sa création par son historique reconstitué." : "Le fonds n'existait pas : rendements reconstitués à partir de son exposition actuelle.";
  } else {
    const h = CRISES_HYPOTHETIQUES.find(c => c.cle === S.crise) || CRISES_HYPOTHETIQUES[0];
    r = rejouerCriseHypothetique(h, A.expo, A.modele.g, plan, 60);
    texte = h.texte;
    reelTexte = `Choc appliqué à chaque exposition du fonds sur ${dureeTexte(h.mois)} (${pctSigne(r.choc, 0)} au total pour ce fonds), puis retour au rythme du scénario central. Hypothèses choisies par ce site, à titre d'illustration.`;
  }
  const avecReel = S.crise === "inflation" || S.crise === "taux2022";
  const fin = r.valeurFinale, verseFin = r.verseFinal;
  zone.innerHTML = `<p>${esc(texte)}</p>
    <div class="graphique-simu" id="graphique-crise" tabindex="0"></div>
    <ul class="legende-simu"><li><span class="cle-ligne mediane"></span>Valeur de ton investissement</li><li><span class="cle-ligne verse"></span>Total versé</li>${avecReel ? `<li><span class="cle-ligne reelle"></span>En euros d'aujourd'hui</li>` : ""}<li><span class="cle-bande crise"></span>Période de crise</li></ul>
    <div class="chiffres-cles">
      <div class="tuile"><span>Baisse du fonds (du haut au bas)</span><strong class="baisse">${pctSigne(r.baisseMarche, 0)}</strong></div>
      <div class="tuile"><span>Pire moment pour toi</span><strong class="${r.pireEcart < 0 ? "baisse" : ""}">${r.pireEcart < 0 ? eurosSigne(r.pireEcart) : "jamais sous le versé"}</strong><small>${r.pireEcart < 0 ? `après ${dureeTexte(r.moisPireEcart)}` : ""}</small></div>
      <div class="tuile"><span>Retour au-dessus du versé</span><strong>${r.pireEcart >= 0 ? "—" : r.moisRetour !== null ? `après ${dureeTexte(r.moisRetour)}` : "pas dans les 5 ans"}</strong></div>
      <div class="tuile"><span>Au bout de ${dureeTexte(r.n)}</span><strong class="${fin >= verseFin ? "hausse" : "baisse"}">${eurosEstimes(fin)}</strong><small>pour ${euros(verseFin)} versés</small></div>
    </div>
    <p class="aide">${esc(reelTexte)} Continuer à investir pendant la baisse permet d'acheter moins cher : c'est souvent ce qui raccourcit le retour à l'équilibre.</p>`;
  dessinerCrise(document.getElementById("graphique-crise"), r, debut, avecReel);
}

// ---------- Ajout de fonds (comparaison, portefeuille) ----------

function champAjoutFonds(cible, placeholder) {
  return `<div class="comparer-fonds ajout-fonds">
    <label for="ajout-${cible}" class="sr-only">${esc(placeholder)}</label>
    <input id="ajout-${cible}" type="search" placeholder="${esc(placeholder)}" autocomplete="off" data-recherche-fonds="${cible}">
    <ul class="suggestions" id="suggestions-${cible}" hidden></ul>
  </div>`;
}

let minuterieRecherche = 0;
zoneResultats.addEventListener("input", e => {
  const champ = e.target.closest("[data-recherche-fonds]");
  if (champ) {
    clearTimeout(minuterieRecherche);
    minuterieRecherche = setTimeout(() => {
      const liste = document.getElementById("suggestions-" + champ.dataset.rechercheFonds);
      const q = champ.value.trim();
      const res = q.length < 2 ? [] : rechercherAnnuaire(q, 8).filter(x => x.isins.length || x.source !== "G");
      liste.hidden = !res.length;
      liste.innerHTML = res.map(x => `<li><button type="button" data-ajouter-fonds="${esc(cleEntree(x))}" data-cible="${champ.dataset.rechercheFonds}">${esc(x.nom)} <small>${esc(x.isins[0] || "")}</small></button></li>`).join("");
    }, 200);
    return;
  }
  const poids = e.target.closest("[data-poids]");
  if (poids) {
    S.portefeuille.lignes[Number(poids.dataset.poids)].poids = Math.max(0, Number(poids.value) || 0);
    S.portefeuille.calc = null;
    programmerEnregistrement();
    const total = S.portefeuille.lignes.reduce((s, l) => s + l.poids, 0);
    const el = document.getElementById("total-poids");
    if (el) { el.textContent = `Total : ${total} %`; el.classList.toggle("baisse", Math.abs(total - 100) > 0.5); }
  }
});

async function ajouterFonds(cible, cle) {
  const entree = annuaireParIsin(cle) || annuaireParCle(cle);
  if (!entree) return;
  const isin = entree.isins.includes(cle) ? cle : entree.isins[0];
  if (cible === "comparer") {
    if (S.comparaisons.some(c => cleEntree(c.entree, c.isin) === cle) || cle === cleEntree(S.fonds.entree, S.fonds.isin)) return;
    if (S.comparaisons.length >= 2) S.comparaisons.shift();
    const item = { entree, isin, enCours: true };
    S.comparaisons.push(item);
    rendrePanneau();
    try { item.A = await chargerAnalyse(entree, isin, { composition: false }); } catch (err) { item.erreur = err.message; }
    item.enCours = false;
    if (S.mode === "comparer") rendrePanneau();
    programmerEnregistrement();
  } else {
    if (S.portefeuille.lignes.length >= 6) return;
    const ligne = { entree, isin, poids: 0, enCours: true };
    S.portefeuille.lignes.push(ligne);
    S.portefeuille.calc = null;
    rendrePanneau();
    try { ligne.A = await chargerAnalyse(entree, isin, { composition: false }); } catch (err) { ligne.erreur = err.message; }
    ligne.enCours = false;
    if (S.mode === "portefeuille") rendrePanneau();
    programmerEnregistrement();
  }
}

// ---------- Panneau « Comparer » ----------

function calculComparaison(A) {
  if (!A.calcComparaison || A.calcComparaison.cle !== JSON.stringify(S.plan) + A.modele.g) {
    const C = calculer(A);
    A.calcComparaison = { cle: JSON.stringify(S.plan) + A.modele.g, C };
  }
  return A.calcComparaison.C;
}

function panneauComparer() {
  const principal = { entree: S.fonds.entree, isin: S.fonds.isin, A: S.fonds };
  const tous = [principal].concat(S.comparaisons);
  const prets = tous.filter(x => x.A);
  prets.forEach((x, i) => { x.couleur = i; x.C = i === 0 ? S.calc : calculComparaison(x.A); });
  const court = n => n.length > 34 ? n.slice(0, 32) + "…" : n;
  const zones = x => {
    const p = profilDuFonds(x.A);
    return [["Amérique du Nord", p.usa], ["Zone euro", p.euro], ["Europe hors euro", p.europe], ["Japon et Asie dév.", p.japon], ["Émergents", p.emergents], ["Obligations", p.obligLongues + p.obligCourtes], ["Monétaire", p.monetaire]]
      .filter(([, v]) => v >= 1).map(([nom, poids]) => ({ nom, poids: Math.round(poids) }));
  };
  const ligneMetrique = (nom, f) => `<div class="cmp-ligne"><span class="cmp-nom">${nom}</span>${prets.map(x => `<span class="cmp-val">${f(x)}</span>`).join("")}</div>`;
  const h = x => x.A.statsH;
  return `<section class="carte">
    <h2>Comparer plusieurs ETF</h2>
    <p class="aide">Mêmes versements et mêmes hypothèses générales pour chaque fonds. <strong>Aucun fonds n'est désigné comme « meilleur »</strong> : à toi de peser rendement, risque, frais et diversification.</p>
    <ul class="legende-perf">${tous.map((x, i) => `<li><span class="pastille-serie serie-${i}"></span><span class="legende-nom">${esc(court(x.entree.nom))}</span>
      ${x.enCours ? `<span class="chargement">chargement…</span>` : x.erreur ? `<small class="baisse">${esc(x.erreur)}</small>` : ""}
      ${i ? `<button type="button" class="retirer" data-retirer-comparaison="${esc(cleEntree(x.entree, x.isin))}" aria-label="Retirer">×</button>` : ""}</li>`).join("")}</ul>
    ${S.comparaisons.length < 2 ? champAjoutFonds("comparer", "Ajouter un fonds à comparer (nom, ISIN, ticker)") : ""}
  </section>
  ${prets.length > 1 ? `
  <section class="carte">
    <h2>Scénario central de chaque fonds</h2>
    <div class="graphique-simu" id="graphique-comparaison" tabindex="0"></div>
    <h3>Projection à 5, 10 et 20 ans</h3>
    ${fourchettesHorizons([5, 10, 20], prets.map(x => ({ nom: x.entree.nom, nomCourt: court(x.entree.nom), couleur: x.couleur, parHorizon: x.C.horizons })))}
  </section>
  <section class="carte">
    <h2>Les différences, point par point</h2>
    <div class="cmp-tableau" style="--colonnes:${prets.length}">
      <div class="cmp-ligne cmp-entete"><span></span>${prets.map(x => `<span class="cmp-val"><span class="pastille-serie serie-${x.couleur}"></span>${esc(court(x.entree.nom))}</span>`).join("")}</div>
      <p class="cmp-groupe">Historique</p>
      ${ligneMetrique("Perf. annualisée 5 ans", x => h(x).perf.a5 === null ? "—" : pctSigne(h(x).perf.a5))}
      ${ligneMetrique("Perf. annualisée 10 ans", x => h(x).perf.a10 === null ? "—" : pctSigne(h(x).perf.a10))}
      ${ligneMetrique(terme("volatilite", "Volatilité"), x => pct(x.A.modele.sigma * 100))}
      ${ligneMetrique(terme("max_drawdown", "Pire baisse"), x => pctSigne(h(x).perteMax.valeur, 0))}
      <p class="cmp-groupe">Coûts et structure</p>
      ${ligneMetrique(terme("frais_courants", "Frais courants"), x => pct(x.A.ter, 2) + (x.A.terSource === "hypothese" ? " *" : ""))}
      ${ligneMetrique("Diversification", x => { const c = x.A.compo; return c && c.inventaire && c.inventaire.nbLignes ? `${c.inventaire.nbLignes} lignes` : `${x.A.expo.length} grande(s) exposition(s)`; })}
      ${ligneMetrique("Rendement attendu retenu (avant frais)", x => pct(x.A.modele.g * 100, 1))}
      <p class="cmp-groupe">Projection (${dureeTexte(S.calc.T)})</p>
      ${ligneMetrique("Défavorable", x => eurosEstimes(x.C.scen.defavorable.total))}
      ${ligneMetrique("Central", x => `<strong>${eurosEstimes(x.C.scen.central.total)}</strong>`)}
      ${ligneMetrique("Favorable", x => eurosEstimes(x.C.scen.favorable.total))}
      ${ligneMetrique("Central après inflation", x => eurosEstimes(x.C.scen.central.valeurReelle))}
      ${ligneMetrique("Coût des frais (central)", x => eurosEstimes(x.C.scen.central.coutFrais))}
      ${ligneMetrique("Risque de perte à l'échéance", x => pct(probabiliteDePerte(x.C.res, x.C.T) * 100, 0))}
    </div>
    ${prets.some(x => x.A.terSource === "hypothese") ? `<p class="aide">* frais non disponibles automatiquement : hypothèse à vérifier dans le DIC.</p>` : ""}
    <h3>Exposition géographique et par classe d'actifs</h3>
    <div class="deux-colonnes cmp-expositions">${prets.map(x => `<div><h4><span class="pastille-serie serie-${x.couleur}"></span> ${esc(court(x.entree.nom))}</h4>${barres(zones(x))}
      ${(() => { const p = profilDuFonds(x.A); return p.secteurs ? `<p class="aide">Principaux secteurs : ${p.secteurs.slice(0, 3).map(s => `${esc(s.nom)} ${pct(s.poids, 0)}`).join(", ")}</p>` : p.tech >= 5 ? `<p class="aide">Technologie américaine ≈ ${Math.round(p.tech)} %</p>` : ""; })()}</div>`).join("")}</div>
  </section>` : `<p class="aide carte">Ajoute un ou deux fonds pour voir les différences.</p>`}`;
}

function majComparaison() {
  const prets = [{ A: S.fonds, entree: S.fonds.entree }].concat(S.comparaisons.filter(c => c.A));
  if (prets.length < 2) return;
  dessinerMedianes(document.getElementById("graphique-comparaison"), prets.map((x, i) => ({ nom: x.entree.nom, ev: i === 0 ? S.calc.ev : x.A.calcComparaison.C.ev, couleur: i })), S.calc.T, S.calc.debut, S.calc.res.verse);
}

// ---------- Panneau « Portefeuille » ----------

function chargerExemplePortefeuille() {
  S.portefeuille.lignes = [];
  S.portefeuille.calc = null;
  for (const [isin, poids] of EXEMPLE_PORTEFEUILLE) {
    const entree = annuaireParIsin(isin);
    if (!entree) continue;
    const ligne = { entree, isin, poids, enCours: true };
    S.portefeuille.lignes.push(ligne);
    chargerAnalyse(entree, isin, { composition: false }).then(A => { ligne.A = A; }).catch(err => { ligne.erreur = err.message; })
      .finally(() => { ligne.enCours = false; if (S.mode === "portefeuille") rendrePanneau(); });
  }
  rendrePanneau();
}

function simulerLePortefeuille() {
  const lignes = S.portefeuille.lignes.filter(l => l.A && l.poids > 0);
  const total = lignes.reduce((s, l) => s + l.poids, 0);
  if (lignes.length < 2 || total <= 0) return;
  const pl = lignes.map(l => ({ comb: l.A.comb, modele: l.A.modele, poids: l.poids / total, A: l.A }));
  const analyse = analysePortefeuille(pl);
  if (analyse.mois.length < 24) { S.portefeuille.calc = { erreur: "pas assez de mois communs à tous ces fonds" }; rendrePanneau(); return; }
  const marche = simulerPortefeuille(pl, analyse);
  // Un pseudo-fonds pour réutiliser les mêmes calculs que la projection
  const statsP = statsHistorique({ mois: analyse.mois, r: analyse.rp, reel: analyse.mois.map(() => true) });
  const Ap = { ...S.fonds, isin: "portefeuille", nom: "Mon portefeuille", comb: { mois: analyse.mois, r: analyse.rp, reel: analyse.mois.map(() => true), nbReels: analyse.mois.length, nbReconstitues: 0 },
    statsH: statsP, ter: pl.reduce((s, l) => s + l.poids * l.A.ter, 0),
    modele: { ...S.fonds.modele, g: croissanceMediane(marche, 20), sigma: analyse.volP, rendDividende: pl.reduce((s, l) => s + l.poids * l.A.modele.rendDividende, 0) },
    marche, cleMarche: null };
  Ap.cleMarche = `portefeuille|${Ap.modele.g.toFixed(6)}|${Ap.modele.sigma.toFixed(6)}`;
  Ap.marche = marche;
  const planSansPasse = { ...S.plan, debut: MOIS_COURANT };
  const C = calculer(Ap, planSansPasse);
  // Expositions pondérées
  const expo = new Map();
  for (const l of pl) for (const x of l.A.expo) expo.set(x.cle, (expo.get(x.cle) || 0) + x.poids * l.poids);
  S.portefeuille.calc = { C, analyse, pl, expo: [...expo.entries()].map(([cle, poids]) => ({ cle, poids })), statsP };
  rendrePanneau();
}

function panneauPortefeuille() {
  const lignes = S.portefeuille.lignes;
  const total = lignes.reduce((s, l) => s + l.poids, 0);
  const pc = S.portefeuille.calc;
  const court = n => n.length > 40 ? n.slice(0, 38) + "…" : n;
  let resultat = "";
  if (pc && pc.erreur) resultat = `<p class="non-dispo">Simulation impossible : ${esc(pc.erreur)}.</p>`;
  else if (pc) {
    const C = pc.C, a = pc.analyse, s = C.scen;
    const zones = new Map();
    const nomZone = { usa: "Amérique du Nord", tech: "Amérique du Nord", euro: "Zone euro", europe: "Europe hors zone euro", japon: "Japon", emergents: "Pays émergents", oblig10: "Obligations euro", oblig3: "Obligations euro", monetaire: "Monétaire" };
    for (const x of pc.expo) zones.set(nomZone[x.cle] || x.cle, (zones.get(nomZone[x.cle] || x.cle) || 0) + x.poids);
    const tech = pc.expo.filter(x => x.cle === "tech").reduce((t, x) => t + x.poids, 0);
    resultat = `
      <div class="chiffres-heros">
        <div class="chiffre-heros"><span>Total versé</span><strong>${euros(C.res.verse[C.T])}</strong></div>
        <div class="chiffre-heros accent"><span>Scénario central</span><strong>${eurosEstimes(s.central.total)}</strong><small>${pctSigne(s.central.perfAnnualisee)} par an</small></div>
        <div class="chiffre-heros"><span>8 chances sur 10</span><strong>${eurosCourt(s.defavorable.total)} – ${eurosCourt(s.favorable.total)}</strong></div>
      </div>
      <ul class="legende-simu"><li><span class="cle-bande large"></span>8 chances sur 10</li><li><span class="cle-bande etroite"></span>5 chances sur 10</li><li><span class="cle-ligne mediane"></span>Scénario central</li><li><span class="cle-ligne verse"></span>Total versé</li></ul>
      <div class="graphique-simu" id="graphique-portefeuille" tabindex="0"></div>
      <div class="horizons">${[1, 5, 10, 20].filter(h => C.horizons[h]).map(h => { const x = C.horizons[h]; return `<div class="carte-horizon"><span class="horizon-titre">${h} an${h > 1 ? "s" : ""}</span><span class="horizon-valeur">${eurosCourt(x.p50)}</span><span class="horizon-fourchette">${eurosCourt(x.p10)} – ${eurosCourt(x.p90)}</span><span class="horizon-verse">versé ${eurosCourt(x.verse)}</span></div>`; }).join("")}</div>
      <div class="deux-colonnes">
        <div><h3>Rendement et risque</h3><dl class="grille-infos">
          <div><dt>Croissance médiane simulée (20 ans)</dt><dd>${pctSigne(C.A.modele.g)} / an avant frais</dd></div>
          <div><dt>${terme("volatilite", "Volatilité")} du portefeuille</dt><dd>${pct(a.volP * 100)} par an</dd></div>
          <div><dt>Volatilité moyenne des fonds</dt><dd>${pct(pc.pl.reduce((t, l, i) => t + l.poids * a.vols[i], 0) * 100)}</dd></div>
          <div><dt>${terme("diversification", "Effet de diversification")}</dt><dd>${a.ratioDiversification > 1.02 ? `risque réduit de ${pct((1 - 1 / a.ratioDiversification) * 100, 0)}` : "quasi nul"}</dd></div>
          <div><dt>Pire baisse historique</dt><dd>${pctSigne(pc.statsP.perteMax.valeur, 0)}</dd></div>
          <div><dt>Baisse en cours de route (simulée)</dt><dd>${pctSigne(C.baisses.mediane, 0)} en médiane, ${pctSigne(C.baisses.unSurDix, 0)} dans 1 cas sur 10</dd></div>
        </dl></div>
        <div><h3>Exposition géographique et par classe d'actifs</h3>${barres([...zones.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 10) / 10 })))}
          ${tech >= 3 ? `<p class="aide">Dont technologie américaine ≈ ${Math.round(tech)} %.</p>` : ""}</div>
      </div>
      <h3>${terme("correlation", "Corrélations")} entre les fonds</h3>
      <p class="aide">1 = les fonds montent et baissent ensemble (peu de diversification) ; proche de 0 ou négatif = ils se compensent. Calculé sur ${a.mois.length} mois communs.</p>
      ${carteCorrelations(pc.pl.map(l => court(l.A.nom)), a.corr)}
      <p class="aide">Portefeuille rééquilibré chaque mois vers les poids choisis. Trajectoires simulées en tirant les mêmes périodes pour tous les fonds, ce qui conserve leurs liens réels.</p>`;
  }
  return `<section class="carte">
    <h2>Mon portefeuille</h2>
    <p class="aide">Combine plusieurs fonds avec des poids (total 100 %) et simule l'ensemble avec ton plan (${euros(S.calc.P.capital)} au départ${S.calc.P.versement ? `, ${euros(S.calc.P.versement)} ${LIBELLE_FREQUENCE[S.calc.P.frequence]}` : ""}, ${dureeTexte(S.calc.T)}).</p>
    ${lignes.length ? `<ul class="lignes-portefeuille">${lignes.map((l, i) => `<li>
      <span class="ligne-nom">${esc(court(l.entree.nom))}<small>${esc(l.isin || "")}${l.enCours ? " · chargement…" : l.erreur ? ` · ${esc(l.erreur)}` : ""}</small></span>
      <label class="ligne-poids"><input type="number" min="0" max="100" step="5" value="${l.poids}" data-poids="${i}" aria-label="Poids de ${esc(l.entree.nom)}"> %</label>
      <button type="button" class="retirer" data-retirer-ligne="${i}" aria-label="Retirer ${esc(l.entree.nom)}">×</button></li>`).join("")}</ul>
      <p id="total-poids" class="${Math.abs(total - 100) > 0.5 ? "baisse" : ""}">Total : ${total} %</p>` : ""}
    <div class="boutons">
      ${lignes.length < 6 ? champAjoutFonds("portefeuille", "Ajouter un fonds (nom, ISIN, ticker)") : ""}
      <button type="button" class="btn btn-secondaire" id="exemple-portefeuille">Exemple : 50 % S&P 500 · 30 % Europe · 20 % émergents</button>
      <button type="button" class="btn" id="simuler-portefeuille"${lignes.filter(l => l.A && l.poids > 0).length < 2 ? " disabled" : ""}>Simuler ce portefeuille</button>
    </div>
    ${resultat}
  </section>`;
}

function majPortefeuilleGraphique() {
  const pc = S.portefeuille.calc;
  if (!pc || pc.erreur) return;
  const C = pc.C;
  dessinerEventail(document.getElementById("graphique-portefeuille"), { T: C.T, debut: C.debut, ev: C.ev, verse: C.res.verse, pas: C.res.pas, reel: false, inflation: C.P.inflation, moisPasses: 0, tensions: null, exemples: null, infoSurvol: t => infoSurvol(C, t) });
}

// ---------- Panneau « Contexte & risques » ----------

function panneauContexte() {
  const A = S.fonds;
  const p = profilDuFonds(A);
  const themes = themesTechnologiques(A, p);
  const geo = risquesGeopolitiques(A, p, themes);
  const tableau = tableauDeBordRisques(A, p, themes, geo);
  const sens = sensibilites(A, p);
  const macro = facteursMacro(A, p);
  const ctx = typeof CONTEXTE !== "undefined" ? CONTEXTE : null;
  const majCtx = ctx ? new Date(ctx.maj) : null;
  const ctxAncien = majCtx && (Date.now() - majCtx) / 864e5 > 3;
  const niveauClasse = n => n === null ? "nd" : ["faible", "modere", "eleve"][n];
  const c = A.compo;
  const titresActu = articles => articles && articles.length ? `<ul class="actus">${articles.slice(0, 3).map(a => `<li><a href="${esc(a.lien)}" target="_blank" rel="noopener">${esc(a.titre)}</a>
      <small>${esc(a.source)} · ${new Date(a.date).toLocaleDateString("fr-FR")}${a.langue === "en" ? " · en anglais" : ""}</small></li>`).join("")}</ul>`
    : `<p class="aide">Aucun titre récent sur ce thème dans nos sources (30 derniers jours).</p>`;
  const fmi = ctx && ctx.fmi;
  const zonesFmi = zonesFmiPertinentes(p);
  return `
  <section class="carte">
    <h2>Tableau de bord des risques</h2>
    <p class="aide">Niveaux calculés à partir de l'exposition du fonds. Ils décrivent des sensibilités, pas des prévisions.</p>
    <div class="tableau-risques">${tableau.map(r => `<article class="risque risque-${niveauClasse(r.niveau)}">
      <header><h3>${esc(r.nom)}</h3><span class="niveau-risque">${r.niveau === null ? "Non évalué" : NIVEAUX_RISQUE[r.niveau]}</span></header>
      <div class="jauge" aria-hidden="true">${[0, 1, 2].map(i => `<span class="${r.niveau !== null && i <= r.niveau ? "plein" : ""}"></span>`).join("")}</div>
      <p>${esc(r.explication)}</p><small>${esc(r.base)}</small></article>`).join("")}</div>
  </section>

  <section class="carte">
    <h2>Composition et sensibilités</h2>
    ${A.compoEnCours ? `<p class="chargement">Lecture de l'inventaire du rapport annuel en cours : la composition détaillée s'affichera ici.</p>` : ""}
    ${sens.length ? `<ul class="sensibilites">${sens.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="aide">Pas de sensibilité particulière détectée.</p>`}
    <div class="deux-colonnes">
      <div><h3>Exposition estimée</h3>${barres([["Amérique du Nord", p.usa], ["Zone euro", p.euro], ["Europe hors euro", p.europe], ["Japon et Asie développée", p.japon], ["Pays émergents", p.emergents], ["Obligations", p.obligLongues + p.obligCourtes], ["Monétaire", p.monetaire]].filter(([, v]) => v >= 0.5).map(([nom, poids]) => ({ nom, poids: Math.round(poids * 10) / 10 })))}</div>
      ${p.secteurs ? `<div><h3>Secteurs</h3>${barres(p.secteurs.slice(0, 8))}</div>` : ""}
      ${c && c.devises && c.devises.length ? `<div><h3>Devises</h3>${barres(c.devises)}${p.couvert ? `<p class="aide">Part couverte contre le risque de change.</p>` : ""}</div>` : ""}
      ${p.lignesDetenues ? `<div><h3>${terme("top10", p.lignesSontDesFonds ? "Principaux fonds détenus" : "10 premières lignes")} <span class="total">(${pct(p.lignesDetenues.reduce((s, l) => s + l.poids, 0))})</span></h3>
        ${(() => { const liens = p.lignesDetenues.map(l => destinationFondsDetenu(l));
          return barres(p.lignesDetenues.map((l, i) => ({ nom: l.nom, poids: l.poids, lien: liens[i] })), null, Math.min(100, Math.ceil(Math.max(...p.lignesDetenues.map(l => l.poids)) / 10) * 10)) + aideLiensFonds(liens); })()}</div>` : ""}
    </div>
    <p class="aide">Taille des entreprises : ${/SMALL|MID CAP|PETITES|MOYENNES/i.test(A.entree.nom) ? "petites et moyennes capitalisations (d'après le nom du fonds)" : /S&P|MSCI|STOXX|NASDAQ|CAC|TOPIX|DAX|FTSE/i.test(A.entree.nom) ? "grandes et moyennes capitalisations (indice suivi)" : "non disponible automatiquement"}.</p>
    <p class="source">${c && c.inventaire && c.inventaire.document ? `Inventaire du ${esc(c.inventaire.document.docTypeLib.toLowerCase())} du ${dateFr(c.inventaire.document.dateEffet)} (AMF – GECO) et analyse` : "Analyse"} des rendements (valeurs liquidatives AMF, taux BCE). Calculs : ce site. <a href="decrypte.html#${esc(cleEntree(A.entree, A.isin))}">Voir la fiche complète →</a></p>
  </section>

  ${themes.length ? `<section class="carte">
    <h2>Technologie et innovation</h2>
    <p class="aide">Tendances auxquelles le fonds est particulièrement exposé. Opportunités et risques sont décrits de façon générale : ce n'est pas une recommandation d'achat ou de vente.</p>
    <div class="themes-techno">${themes.map(t => `<article class="theme-techno">
      <header><h3>${esc(t.nom)}</h3><span class="etiquette">exposition ${esc(t.niveau)}</span></header>
      <p class="aide">Repéré par : ${t.preuves.slice(0, 4).map(esc).join(" ; ")}.</p>
      <div class="opp-risque"><div><h4>Opportunité potentielle</h4><p>${esc(t.opportunite)}</p></div><div><h4>Risque potentiel</h4><p>${esc(t.risque)}</p></div></div>
      ${ctx && ctx.actualites && ctx.actualites[t.cle === "tech" ? "ia" : t.cle] ? `<h4>Actualité récente</h4>${titresActu(ctx.actualites[t.cle === "tech" ? "ia" : t.cle].articles)}` : ""}
    </article>`).join("")}</div>
  </section>` : ""}

  ${(() => { const b = blocMarchesDevises({ usa: p.usa, tech: p.tech, euro: p.euro, europe: p.europe, japon: p.japon, emergents: p.emergents }, { couvert: p.couvert });
    return b ? `<section class="carte"><h2>Marchés et devises du jour</h2><p class="aide">Évolution récente des marchés et des devises auxquels ce fonds est exposé. C'est un constat, pas une prévision.</p>${b}</section>` : ""; })()}
  ${(() => { const b = p.lignesDetenues && !p.lignesSontDesFonds ? blocActusEntreprises(p.lignesDetenues, { titre: "h2" }) : "";
    return b ? `<section class="carte">${b}</section>` : ""; })()}

  <section class="carte">
    <h2>Contexte économique mondial</h2>
    <p>Voici les facteurs actuellement susceptibles d'influencer ce fonds. <strong>Ils ne permettent pas de prédire son évolution</strong> : ils aident à comprendre ce qui peut le faire bouger.</p>
    ${ctx ? `<p class="aide">Dernière mise à jour : ${majCtx.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}${ctxAncien ? " — <strong>mise à jour automatique en retard : certaines données peuvent être anciennes</strong>" : ""}. Chaque chiffre indique sa date et sa source.</p>` : `<p class="non-dispo">Données économiques indisponibles.</p>`}
    <div class="indicateurs">${macro.map(({ ind, pourquoi }) => {
      const variation = ind.unAn !== null ? ind.valeur - ind.unAn : null;
      const unite = ind.unite === "%" ? " pt" : "";
      return `<article class="indicateur">
        <header><h3>${esc(ind.nom)}</h3>${miniCourbe(ind.serie)}</header>
        <p class="indicateur-valeur">${ind.valeur.toLocaleString("fr-FR", { maximumFractionDigits: ind.unite === "%" ? 2 : 4 })}${ind.unite === "%" ? " %" : ""}
          ${variation !== null ? `<small>${variation > 0 ? "+" : variation < 0 ? "−" : ""}${Math.abs(variation).toLocaleString("fr-FR", { maximumFractionDigits: ind.unite === "%" ? 2 : 4 })}${unite} sur un an</small>` : ""}</p>
        ${ind.fourchette ? `<p class="aide">Fourchette cible de la Fed : ${pct(ind.fourchette[0], 2)} – ${pct(ind.fourchette[1], 2)}</p>` : ""}
        <p>${esc(pourquoi)}</p>
        <small>${esc(periodeFr(ind.date))} · <a href="${esc(ind.lien)}" target="_blank" rel="noopener">${esc(ind.source)}</a>${donneeAncienne(ind) ? " · <strong>donnée ancienne</strong>" : ""}</small>
      </article>`;
    }).join("")}</div>
    ${fmi && fmi.croissance ? `<h3>Croissance économique par région (FMI)</h3>
      <p class="aide">${esc(fmi.edition || "World Economic Outlook")} : ${fmi.annees[0]} (estimation), ${fmi.annees[1]} et ${fmi.annees[2]} (prévisions du FMI, pas de ce site).</p>
      <div class="fmi-grille">${zonesFmi.map(z => { const v = fmi.croissance[z] || {}; const d = fmi.dette && fmi.dette[z] ? fmi.dette[z][fmi.annees[1]] : null; return `<div class="fmi-zone"><strong>${esc(fmi.zones[z])}</strong>
        <span>${fmi.annees.map(a => `${a} : ${v[a] === null || v[a] === undefined ? "n.d." : (v[a] > 0 ? "+" : "") + pct(v[a], 1)}`).join(" · ")}</span>${d ? `<small>Dette publique ${fmi.annees[1]} : ${pct(d, 0)} du PIB</small>` : ""}</div>`; }).join("")}</div>
      <p class="source"><a href="${esc(fmi.lien)}" target="_blank" rel="noopener">Source : FMI – DataMapper</a></p>` : ""}
    <p class="aide">Non intégrés faute de source gratuite et fiable exploitable automatiquement : ratios de valorisation des marchés (PER, CAPE) et flux d'investissement mondiaux.</p>
  </section>

  <section class="carte">
    <h2>Géopolitique et politique</h2>
    <p class="aide">Risques susceptibles d'affecter ce fonds, d'après son exposition. Aucun scénario politique n'est inventé : les exemples sont des titres de presse récents, datés et reliés à leur source (sélection automatique par mots-clés, parmi ${ctx && ctx.flux ? ctx.flux.length : 0} flux de médias reconnus et d'institutions).</p>
    <div class="geo">${geo.map(g => `<article class="geo-theme risque-${["faible", "modere", "eleve"][NIVEAUX_RISQUE.indexOf(g.niveau)]}">
      <header><h3>${esc(g.nom)}</h3><span class="niveau-risque">${esc(g.niveau)}</span></header>
      <p>${esc(g.pourquoi)}</p>${titresActu(g.articles)}</article>`).join("")}</div>
  </section>`;
}

// ---------- Réouverture : simulateur.html?sim=<id>#<fonds> ----------

async function ouvrirSimulationEnregistree(id) {
  const sim = await Compte.simulation(id);
  if (!sim) { zoneResultats.innerHTML = `<p class="non-dispo carte">Simulation introuvable (supprimée ?). <a href="compte.html#simulations">Mes simulations</a></p>`; return; }
  const etat = sim.etat || {};
  S.simulation = { id: sim.id, fonds: sim.fonds };
  S.restauration = etat;
  S.plan = { ...PLAN_DEFAUT, ...(etat.plan || {}), debut: MOIS_COURANT };
  S.mode = MODES.some(m => m.cle === etat.mode) ? etat.mode : "projection";
  S.lance = true;
  S.etape = 4;
  if (decodeURIComponent(location.hash.slice(1)) !== sim.fonds) location.hash = sim.fonds;   // déclenche afficherDepuisAdresse
  else await afficherDepuisAdresse();
}

async function restaurerExtras(A) {
  const etat = S.restauration;
  try {
    lancer();
    for (const cle of etat.comparaisons || []) await ajouterFonds("comparer", cle);
    for (const ligne of etat.portefeuille || []) {
      await ajouterFonds("portefeuille", ligne.fonds);
      const l = S.portefeuille.lignes.at(-1);
      if (l) l.poids = Number(ligne.poids) || 0;
    }
    rendrePanneau();
  } finally { S.restauration = null; }
}

// ---------- Démarrage ----------

let minuterieRedimSimu = 0;
window.addEventListener("resize", () => { clearTimeout(minuterieRedimSimu); minuterieRedimSimu = setTimeout(() => { if (S.calc) apresRendu(); }, 150); });
document.addEventListener("click", e => { if (!e.target.closest(".ajout-fonds")) document.querySelectorAll(".ajout-fonds .suggestions").forEach(l => { l.hidden = true; }); });
window.addEventListener("hashchange", afficherDepuisAdresse);
if (!Compte.session()) {
  // Défense en profondeur : sur le site en ligne, le serveur a déjà renvoyé vers abonnement.html
  location.replace("abonnement.html");
} else {
  const simDemandee = new URLSearchParams(location.search).get("sim");
  if (simDemandee) ouvrirSimulationEnregistree(simDemandee).catch(err => { zoneResultats.innerHTML = `<p class="non-dispo carte">${esc(err.message)}</p>`; });
  else afficherDepuisAdresse();
  if (new URLSearchParams(location.search).get("abonnement") === "ok") attendreAbonnement();
}

// Retour de Stripe : le webhook peut arriver quelques secondes après la redirection
async function attendreAbonnement() {
  for (let essai = 0; essai < 10; essai++) {
    try { if ((await Compte.droits()).abonne) { if (etatEnregistrement) etatEnregistrement.textContent = "Merci ! Ton abonnement est actif : simulations illimitées."; return; } } catch (e) { /* réessai */ }
    await new Promise(ok => setTimeout(ok, 2000));
  }
  if (etatEnregistrement) etatEnregistrement.textContent = "Paiement reçu : l'activation peut prendre une minute. Recharge la page si besoin.";
}
const rechercheVenueSimu = rechercheDansAdresse();
if (rechercheVenueSimu && !location.hash) { champSimu.value = rechercheVenueSimu; document.getElementById("form-recherche").requestSubmit(); }

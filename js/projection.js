/*
 * MOTEUR DE PROJECTION — ce que pourrait devenir un investissement dans un fonds.
 *
 * Aucune « prévision » : on produit une distribution de résultats possibles, à partir d'hypothèses affichées.
 *
 *  1. Historique mensuel du fonds. Avant sa création, historique « reconstitué » : son exposition estimée
 *     (analyse des rendements, voir style.js) appliquée à des fonds de référence très anciens de la base GECO
 *     (certains cotent depuis 1990). On retrouve ainsi le comportement probable du fonds pendant les crises passées.
 *  2. Rendement attendu : moyenne pondérée entre
 *       a) une estimation « de marché » fondée sur les taux d'intérêt actuels (BCE) et une prime de risque des actions ;
 *       b) le rendement historique du fonds.
 *     Le poids de l'historique dépend de sa longueur et de sa régularité : un historique court et agité
 *     dit peu de chose de l'avenir (c'est une règle statistique, pas un choix arbitraire).
 *  3. Volatilité : celle de tout l'historique (réel + reconstitué), crises comprises.
 *  4. Monte Carlo : 3 000 trajectoires de 40 ans. Chacune enchaîne des blocs de 12 mois consécutifs tirés
 *     au hasard dans l'historique (ce qui conserve les vrais enchaînements : krachs, rebonds), recalés sur
 *     le rendement et la volatilité retenus.
 *  5. Le plan de l'utilisateur (capital, versements, frais, dividendes, inflation, impôts) est appliqué à
 *     chaque trajectoire. Les scénarios sont des rangs de cette distribution (10 %, 50 %, 90 %).
 */

// ---------- Hypothèses (modifiables dans les options avancées de la page) ----------

const HYPOTHESES_DEFAUT = {
  primeActions: 3.5,      // % par an au-dessus du taux d'État à 10 ans, rendement composé (ordre de grandeur des études de long terme)
  incertitude: 2.0,       // incertitude (%/an) de l'estimation « de marché » : dose le poids de l'historique
  poidsHistoriqueMax: 0.5,
  trajectoires: 3000,
  moisSimules: 480,       // 40 ans : permet de chercher la durée nécessaire pour atteindre un objectif
  bloc: 12,
  graine: 20260927        // tirages reproductibles : mêmes chiffres à chaque visite, pour les mêmes données
};

// Fonds de référence à très long historique (base GECO) : un par grande exposition de l'analyse des rendements
const SERIES_LONGUES = [
  { cle: "usa", isin: "FR0000436438", nom: "AXA Indice USA" },
  { cle: "tech", isin: "FR0000431538", nom: "SG Actions US Techno" },
  { cle: "euro", isin: "FR0000990764", nom: "AXA Indice Euro" },
  { cle: "europe", isin: "FR0000441628", nom: "Covéa Actions Europe hors euro" },
  { cle: "japon", isin: "FR0000435174", nom: "Stratégie Indice Japon" },
  { cle: "emergents", isin: "FR0007492749", nom: "Allianz Actions Émergentes" },
  { cle: "oblig10", isin: "FR0000939951", nom: "Covéa Euro Souverain" },
  { cle: "oblig3", isin: "FR0007457114", nom: "Sienna Souverains 3-5" },
  { cle: "monetaire", isin: "FR0000293698", nom: "Ecofi Trésorerie" }
];
const SERIE_DOLLAR = "EXR/M.USD.EUR.SP00.E";

// Classe d'actifs de chaque exposition
const CLASSE_EXPOSITION = { usa: "actions", tech: "actions", euro: "actions", europe: "actions", japon: "actions", emergents: "actions",
  oblig10: "oblig10", oblig3: "oblig3", monetaire: "monetaire" };

// Rendement des dividendes (ou coupons) par exposition : ordre de grandeur, seulement pour séparer revenus et hausse des prix.
// Il ne change pas la performance totale attendue ; il sert à l'option « dividendes non réinvestis ».
const DIVIDENDES_PAR_EXPOSITION = { usa: 1.3, tech: 0.7, euro: 3.0, europe: 3.2, japon: 2.2, emergents: 2.8 };

// Profils types quand le fonds n'a ni historique ni analyse des rendements (d'après sa classification AMF)
function expositionsParDefaut(e) {
  const k = (e && e.classification) || "";
  const n = (e && e.nom || "").toUpperCase();
  if (/mon[ée]taire/i.test(k)) return [{ cle: "monetaire", poids: 100 }];
  if (/Obligations/i.test(k)) return [{ cle: "oblig10", poids: 50 }, { cle: "oblig3", poids: 50 }];
  if (/mixte/i.test(k)) return [{ cle: "usa", poids: 25 }, { cle: "euro", poids: 20 }, { cle: "oblig10", poids: 30 }, { cle: "oblig3", poids: 25 }];
  if (/françaises|zone euro|Union Europ/i.test(k) || /EURO\s?STOXX|CAC|MSCI EMU|DAX/.test(n)) return [{ cle: "euro", poids: 100 }];
  if (/NASDAQ/.test(n)) return [{ cle: "tech", poids: 100 }];
  if (/S&P|\bUSA?\b/.test(n)) return [{ cle: "usa", poids: 100 }];
  if (/EMERG/.test(n)) return [{ cle: "emergents", poids: 100 }];
  if (/JAPAN|JAPON|TOPIX/.test(n)) return [{ cle: "japon", poids: 100 }];
  if (/EUROPE/.test(n)) return [{ cle: "euro", poids: 65 }, { cle: "europe", poids: 35 }];
  // actions monde par défaut (poids proches de ceux d'un indice mondial)
  return [{ cle: "usa", poids: 62 }, { cle: "euro", poids: 10 }, { cle: "europe", poids: 10 }, { cle: "japon", poids: 6 }, { cle: "emergents", poids: 12 }];
}

// ---------- Séries mensuelles ----------

function moisDe(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function moisSuivant(m) { const [a, mm] = m.split("-").map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`; }
function ecartMois(a, b) { const [a1, m1] = a.split("-").map(Number), [a2, m2] = b.split("-").map(Number); return (a2 - a1) * 12 + (m2 - m1); }

// Dernière valeur de chaque mois (le mois en cours, incomplet, est écarté)
function niveauxMensuels(h) {
  const res = new Map();
  for (let i = 0; i < h.dates.length; i++) res.set(moisDe(h.dates[i]), h.valeurs[i]);
  res.delete(moisDe(new Date()));
  return res;
}

// Rendements mensuels. Un trou de 1 ou 2 mois dans les valeurs publiées (ça arrive dans GECO) est comblé en
// répartissant la variation sur les mois manquants ; au-delà, la série est coupée.
function rendementsMensuels(niveaux) {
  const mois = [...niveaux.keys()].sort();
  const r = new Map();
  for (let i = 1; i < mois.length; i++) {
    const ecart = ecartMois(mois[i - 1], mois[i]);
    if (ecart < 1 || ecart > 3) continue;
    const a = niveaux.get(mois[i - 1]), b = niveaux.get(mois[i]);
    if (!(a > 0 && b > 0)) continue;
    const parMois = Math.pow(b / a, 1 / ecart) - 1;
    let m = mois[i - 1];
    for (let k = 0; k < ecart; k++) { m = moisSuivant(m); r.set(m, parMois); }
  }
  return r;
}

// Plus longue suite de mois consécutifs se terminant au dernier mois disponible
function suiteContinue(rMap) {
  const mois = [...rMap.keys()].sort();
  let debut = mois.length - 1;
  while (debut > 0 && ecartMois(mois[debut - 1], mois[debut]) === 1) debut--;
  return mois.slice(debut);
}

// ---------- Chargement (avec cache local d'une semaine) ----------

const _longues = new Map();

function lireCacheLong(cle) {
  try {
    const c = JSON.parse(localStorage.getItem("longue-v1-" + cle) || "null");
    if (c && Date.now() - c.quand < 7 * 864e5) return new Map(c.r);
  } catch (e) { /* ignoré */ }
  return null;
}
function ecrireCacheLong(cle, rMap) {
  try { localStorage.setItem("longue-v1-" + cle, JSON.stringify({ quand: Date.now(), r: [...rMap.entries()].map(([m, v]) => [m, Math.round(v * 1e6) / 1e6]) })); } catch (e) { /* stockage plein */ }
}

async function historiqueCompletGeco(entree, isin) {
  const parts = await gecoJson(`/funds/compartment/c${entree.cmpId}/shares`);
  const part = parts.find(p => p.isin === isin) || parts.find(p => p.isin === entree.isins[0]) || parts[0];
  if (!part) throw new Error("aucune part dans GECO");
  const h = historiqueDepuisGeco(await gecoJson(`/funds/chart/${part.idInterne}?startDate=1990-01-01`));
  return { part, parts, historique: h };
}

// Séries préparées chaque jour par le site (data/references.js), valables 45 jours
function serieLongueDeReference(cle) {
  const d = typeof DONNEES_REFERENCES !== "undefined" && DONNEES_REFERENCES && DONNEES_REFERENCES.longues && DONNEES_REFERENCES.longues[cle];
  if (!d || (Date.now() - new Date(DONNEES_REFERENCES.maj)) / 864e5 > 45) return null;
  const r = new Map();
  let m = d.mois0;
  for (const x of d.r) { r.set(m, x); m = moisSuivant(m); }
  return r;
}

async function serieLongue(ref) {
  if (_longues.has(ref.cle)) return _longues.get(ref.cle);
  const pre = serieLongueDeReference(ref.cle);
  if (pre) { _longues.set(ref.cle, Promise.resolve(pre)); return pre; }
  const promesse = (async () => {
    const cache = lireCacheLong(ref.cle);
    if (cache) return cache;
    const e = annuaireParIsin(ref.isin);
    if (!e) throw new Error("référence absente de l'annuaire");
    const { historique } = await historiqueCompletGeco(e, ref.isin);
    const r = rendementsMensuels(niveauxMensuels(historique));
    ecrireCacheLong(ref.cle, r);
    return r;
  })();
  _longues.set(ref.cle, promesse);
  promesse.catch(() => _longues.delete(ref.cle));
  return promesse;
}

async function serieDollarMensuelle() {
  if (_longues.has("dollar")) return _longues.get("dollar");
  const pre = serieLongueDeReference("dollar");
  if (pre) { _longues.set("dollar", Promise.resolve(pre)); return pre; }
  const promesse = (async () => {
    const cache = lireCacheLong("dollar");
    if (cache) return cache;
    const texte = await (await fetch(`${BCE_API}${SERIE_DOLLAR}?format=csvdata&detail=dataonly&startPeriod=1999-01`)).text();
    const lignes = texte.trim().split(/\r?\n/);
    const entete = lignes[0].split(",");
    const iD = entete.indexOf("TIME_PERIOD"), iV = entete.indexOf("OBS_VALUE");
    const niveaux = new Map();
    // 1 dollar exprimé en euros = 1 / (dollars pour 1 euro)
    for (const l of lignes.slice(1)) { const c = l.split(","); const v = parseFloat(c[iV]); if (v > 0) niveaux.set(c[iD], 1 / v); }
    const r = rendementsMensuels(niveaux);
    if (r.size > 100) ecrireCacheLong("dollar", r);
    return r;
  })();
  _longues.set("dollar", promesse);
  promesse.catch(() => _longues.delete("dollar"));
  return promesse;
}

async function chargerSeriesLongues(cles) {
  const res = {};
  await Promise.all(SERIES_LONGUES.filter(s => cles.includes(s.cle)).map(async s => {
    try { res[s.cle] = await serieLongue(s); } catch (e) { /* référence indisponible */ }
  }));
  return res;
}

// ---------- Historique reconstitué ----------

// Rendement mensuel « comme si » : exposition estimée × rendements des fonds de référence
function reconstituer(expositions, couchesDollar, longues, dollar) {
  const utiles = expositions.filter(x => x.poids > 0);
  if (!utiles.length || utiles.some(x => !longues[x.cle])) return null;
  const tous = new Set();
  for (const x of utiles) for (const m of longues[x.cle].keys()) tous.add(m);
  const res = new Map();
  const somme = utiles.reduce((s, x) => s + x.poids, 0) || 100;
  for (const m of [...tous].sort()) {
    let r = 0, ok = true;
    for (const x of utiles) {
      const v = longues[x.cle].get(m);
      if (v === undefined) { ok = false; break; }
      r += x.poids / somme * v;
    }
    if (!ok) continue;
    if (couchesDollar && dollar) {
      const d = dollar.get(m);
      if (d === undefined) continue;
      r += couchesDollar / 100 * d;
    }
    res.set(m, r);
  }
  return res;
}

// Assemble l'historique réel et, avant lui, l'historique reconstitué
function historiqueCombine(reel, proxy) {
  const moisReels = reel && reel.size ? suiteContinue(reel) : [];
  const res = { mois: [], r: [], reel: [] };
  if (proxy && proxy.size) {
    const premierReel = moisReels[0] || "9999-99";
    const avant = new Map([...proxy.entries()].filter(([m]) => m < premierReel));
    // on ne garde que la partie qui rejoint l'historique réel sans trou
    const suite = avant.size ? suiteContinue(avant) : [];
    const raccord = !moisReels.length || (suite.length && ecartMois(suite[suite.length - 1], premierReel) === 1);
    if (raccord) for (const m of suite) { res.mois.push(m); res.r.push(avant.get(m)); res.reel.push(false); }
  }
  for (const m of moisReels) { res.mois.push(m); res.r.push(reel.get(m)); res.reel.push(true); }
  res.nbReels = moisReels.length;
  res.nbReconstitues = res.mois.length - moisReels.length;
  return res;
}

// ---------- Statistiques d'un historique mensuel ----------

function moyenne(t) { return t.reduce((s, x) => s + x, 0) / (t.length || 1); }
function ecartType(t) { const m = moyenne(t); return Math.sqrt(t.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, t.length - 1)); }

function statsHistorique(comb) {
  const r = comb.r, n = r.length;
  if (n < 12) return null;
  const logs = r.map(x => Math.log(1 + x));
  const annees = n / 12;
  const rendAnnuel = Math.exp(moyenne(logs) * 12) - 1;
  const vol = ecartType(logs) * Math.sqrt(12);
  // Perte maximale (de mois en mois) et temps de récupération
  let niveau = 1, sommet = 1, iSommet = -1, pire = 0, pireSommet = -1, pireCreux = 0;
  const niveaux = [1];
  for (let i = 0; i < n; i++) {
    niveau *= 1 + r[i]; niveaux.push(niveau);
    if (niveau > sommet) { sommet = niveau; iSommet = i; }
    if (niveau / sommet - 1 < pire) { pire = niveau / sommet - 1; pireSommet = iSommet; pireCreux = i; }
  }
  let recup = null;
  const niveauSommet = niveaux[pireSommet + 1];
  for (let i = pireCreux + 1; i < n; i++) if (niveaux[i + 1] >= niveauSommet) { recup = i; break; }
  // Rendements sur 12 mois et 5 ans glissants
  const glissant = k => { const res = []; for (let i = k; i <= n; i++) res.push(niveaux[i] / niveaux[i - k] - 1); return res; };
  const g12 = glissant(12), g60 = n >= 60 ? glissant(60) : [];
  // Performance annualisée sur les dernières périodes
  const sur = k => n >= k ? Math.pow(niveaux[n] / niveaux[n - k], 12 / k) - 1 : null;
  return {
    debut: comb.mois[0], fin: comb.mois[n - 1], annees, rendAnnuel, vol,
    perteMax: { valeur: pire, debut: pireSommet >= 0 ? comb.mois[pireSommet] : comb.mois[0], creux: comb.mois[pireCreux], recuperation: recup === null ? null : comb.mois[recup],
      moisRecuperation: recup === null ? null : recup - pireCreux },
    meilleur12: Math.max(...g12), pire12: Math.min(...g12),
    part12Positifs: g12.filter(x => x > 0).length / g12.length,
    part60Positifs: g60.length ? g60.filter(x => x > 0).length / g60.length : null,
    perf: { a1: sur(12), a3: sur(36), a5: sur(60), a10: sur(120), a20: sur(240) },
    niveaux
  };
}

// Comportement selon l'état du marché actions mondial (mois de hausse / mois de baisse)
function comportementMarche(comb, marche) {
  const haut = [], bas = [], mh = [], mb = [];
  comb.mois.forEach((m, i) => {
    const v = marche.get(m);
    if (v === undefined) return;
    if (v >= 0) { haut.push(comb.r[i]); mh.push(v); } else { bas.push(comb.r[i]); mb.push(v); }
  });
  if (haut.length < 12 || bas.length < 12) return null;
  return {
    moisHausse: haut.length, moisBaisse: bas.length,
    fondsHausse: moyenne(haut), fondsBaisse: moyenne(bas), marcheHausse: moyenne(mh), marcheBaisse: moyenne(mb),
    captureHausse: moyenne(haut) / moyenne(mh), captureBaisse: moyenne(bas) / moyenne(mb)
  };
}

// Marché actions mondial reconstitué (poids proches d'un indice mondial) : sert de repère
function marcheMondial(longues) {
  return reconstituer([{ cle: "usa", poids: 62 }, { cle: "euro", poids: 10 }, { cle: "europe", poids: 10 }, { cle: "japon", poids: 6 }, { cle: "emergents", poids: 12 }], 0, longues, null);
}

// ---------- Rendement et volatilité retenus ----------

function poidsParClasse(expositions) {
  const p = { actions: 0, oblig10: 0, oblig3: 0, monetaire: 0 };
  const total = expositions.reduce((s, x) => s + x.poids, 0) || 1;
  for (const x of expositions) p[CLASSE_EXPOSITION[x.cle] || "actions"] += x.poids / total;
  return p;
}

function modeleDeRendement({ comb, expositions, taux, ter, hyp = HYPOTHESES_DEFAUT }) {
  const classes = poidsParClasse(expositions);
  const t10 = taux.taux10 / 100, t3 = taux.taux3 / 100, cm = taux.estr / 100;
  const composantes = {
    actions: t10 + hyp.primeActions / 100, oblig10: t10, oblig3: t3, monetaire: cm
  };
  const gMarche = Object.keys(classes).reduce((s, k) => s + classes[k] * composantes[k], 0);

  const logs = comb.r.map(x => Math.log(1 + x));
  const annees = logs.length / 12;
  const sigma = ecartType(logs) * Math.sqrt(12);
  const gHistNet = Math.exp(moyenne(logs) * 12) - 1;
  const gHist = gHistNet + ter / 100;                         // l'historique est net de frais : on les rajoute
  const erreur = sigma / Math.sqrt(Math.max(annees, 0.5));      // précision de la moyenne historique
  const tau = hyp.incertitude / 100;
  const poidsHist = Math.min(hyp.poidsHistoriqueMax, tau * tau / (tau * tau + erreur * erreur));
  const g = poidsHist * gHist + (1 - poidsHist) * gMarche;
  const rendDividende = expositions.reduce((s, x) => {
    const c = CLASSE_EXPOSITION[x.cle];
    const d = c === "actions" ? DIVIDENDES_PAR_EXPOSITION[x.cle] / 100 : composantes[c];
    return s + x.poids / 100 * (d || 0);
  }, 0);
  return { g, sigma, gMarche, gHist, gHistNet, poidsHist, erreur, annees, classes, composantes, rendDividende: Math.max(0, Math.min(rendDividende, g + 0.02)) };
}

// ---------- Monte Carlo ----------

function generateur(graine) { // mulberry32 : tirages pseudo-aléatoires reproductibles
  let a = graine >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function normaleStandard(alea) {
  let u = 0; while (u === 0) u = alea();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * alea());
}

// Trajectoires de marché : indice de valeur (1 au départ) de chaque trajectoire, mois par mois
function simulerMarches({ r, g, sigma, mois = HYPOTHESES_DEFAUT.moisSimules, n = HYPOTHESES_DEFAUT.trajectoires, bloc = HYPOTHESES_DEFAUT.bloc, graine = HYPOTHESES_DEFAUT.graine }) {
  const alea = generateur(graine);
  const logs = r.map(x => Math.log(1 + x));
  const m = moyenne(logs), s = ecartType(logs) || 1;
  const z = logs.map(x => (x - m) / s);
  const T = z.length;
  const muM = Math.log(1 + g) / 12, sigM = sigma / Math.sqrt(12);
  const I = new Float32Array(n * (mois + 1));
  const parBlocs = T >= 24;
  for (let i = 0; i < n; i++) {
    const base = i * (mois + 1);
    I[base] = 1;
    let log = 0, t = 0;
    while (t < mois) {
      const debut = Math.floor(alea() * T);
      for (let k = 0; k < bloc && t < mois; k++) {
        const zz = parBlocs ? z[(debut + k) % T] : normaleStandard(alea); // bootstrap circulaire par blocs
        log += muM + sigM * zz;
        t++;
        I[base + t] = Math.exp(log);
      }
    }
  }
  return { n, mois, I };
}

// Une seule trajectoire donnée mois par mois (crise rejouée, scénario de tensions)
function marcheDeterministe(rendements) {
  const mois = rendements.length;
  const I = new Float32Array(mois + 1);
  I[0] = 1;
  for (let t = 0; t < mois; t++) I[t + 1] = I[t] * (1 + rendements[t]);
  return { n: 1, mois, I };
}

// Date de départ dans le passé : les premiers mois suivent l'historique réel du fonds, les suivants sont simulés
function marcheAvecPasse(marche, passe) {
  const k = passe.length;
  if (!k) return marche;
  // la trajectoire simulée commence après les k mois réels : la durée totale s'allonge d'autant
  const n = marche.n, M0 = marche.mois + 1, mois = marche.mois + k, M = mois + 1, I = new Float32Array(n * M);
  const base = [1];
  for (const r of passe) base.push(base[base.length - 1] * (1 + r));
  for (let i = 0; i < n; i++) for (let t = 0; t <= mois; t++) I[i * M + t] = t <= k ? base[t] : base[k] * marche.I[i * M0 + t - k];
  return { n, mois, I, moisPasses: k };
}

// Scénario de tensions : le rythme central, puis une forte baisse pendant les 12 derniers mois avant l'échéance
// (le pire moment : la baisse n'a pas le temps d'être rattrapée), puis de nouveau le rythme central
function marcheTensions(baisse, g, mois, echeance) {
  const r = [];
  const parMois = Math.pow(1 - baisse, 1 / 12) - 1, central = Math.pow(1 + g, 1 / 12) - 1;
  const debut = Math.max(0, echeance - 12);
  for (let t = 0; t < mois; t++) r.push(t >= debut && t < echeance ? parMois : central);
  return marcheDeterministe(r);
}

// ---------- Fiscalité française (simplifiée, retrait total à la fin) ----------

const FISCALITE_FR = {
  maj: "2026-04-15",
  source: "service-public.gouv.fr",
  liens: {
    pfu: "https://www.service-public.gouv.fr/particuliers/vosdroits/F34913",
    av: "https://www.service-public.gouv.fr/particuliers/vosdroits/F22414",
    pea: "https://www.service-public.gouv.fr/particuliers/vosdroits/F2385"
  },
  pfu: { ir: 12.8, ps: 18.6 },                   // prélèvement forfaitaire unique 2026 : 31,4 %
  pea: { ans: 5, ps: 18.6 },
  av: { ans: 8, ps: 17.2, irAvant: 12.8, irApres: 7.5, irAuDela: 12.8, seuilPrimes: 150000, abattement: 4600, abattementCouple: 9200 }
};

function impotALaSortie(fisc, valeur, verse, annees) {
  if (!fisc) return 0;
  const gain = valeur - verse;
  if (gain <= 0) return 0;
  const F = FISCALITE_FR;
  if (fisc.enveloppe === "cto") return gain * (F.pfu.ir + F.pfu.ps) / 100;
  if (fisc.enveloppe === "pea") return gain * (annees >= F.pea.ans ? F.pea.ps : F.pfu.ir + F.pfu.ps) / 100;
  if (fisc.enveloppe === "av") {
    if (annees < F.av.ans) return gain * (F.av.irAvant + F.av.ps) / 100;
    const imposable = Math.max(0, gain - (fisc.couple ? F.av.abattementCouple : F.av.abattement));
    const partBasse = Math.min(1, F.av.seuilPrimes / Math.max(verse, 1));
    return gain * F.av.ps / 100 + imposable * (partBasse * F.av.irApres + (1 - partBasse) * F.av.irAuDela) / 100;
  }
  return 0;
}

// ---------- Application du plan d'investissement ----------

// Montant versé au mois t (hors capital initial), avec l'augmentation annuelle éventuelle
function versementDuMois(plan, t) {
  if (!plan.versement || t < 1 || t % plan.frequence !== 0) return 0;
  return plan.versement * Math.pow(1 + (plan.augmentation || 0) / 100, Math.floor((t - 1) / 12));
}

/*
 * plan = { capital, versement, frequence (1, 3 ou 12 mois), augmentation (%/an), mois,
 *          frais: { courants, garde (%/an), entree, change (% de chaque versement), courtageFixe (€/ordre), courtagePct (%) },
 *          dividendes: { rendement (%/an), reinvestis }, inflation (%/an),
 *          fiscalite: null | { enveloppe: "cto"|"pea"|"av", couple, partDistribuante } }
 * options = { moisCalcul (par défaut plan.mois), garderMensuel (valeurs mois par mois de chaque trajectoire), transactionsForcees }
 */
function appliquerPlan(marche, plan, options = {}) {
  const T = Math.min(options.moisCalcul || plan.mois, marche.mois);
  const n = marche.n, M = marche.mois + 1, I = marche.I;
  const fr = plan.frais || {};
  const tauxFraisTotal = ((fr.courants || 0) + (fr.garde || 0)) / 100 / 12;
  const q = ((plan.dividendes && plan.dividendes.rendement) || 0) / 100 / 12;
  const reinvestis = !plan.dividendes || plan.dividendes.reinvestis !== false;
  const fisc = plan.fiscalite;
  const pfu = (FISCALITE_FR.pfu.ir + FISCALITE_FR.pfu.ps) / 100;
  // Dividendes imposés chaque année : compte-titres et part distribuante (ou dividendes versés)
  const impotDividendes = fisc && fisc.enveloppe === "cto" && (fisc.partDistribuante || !reinvestis) ? pfu : 0;
  const netAchat = montant => montant <= 0 && !options.transactionsForcees ? 0
    : montant * (1 - ((fr.entree || 0) + (fr.change || 0) + (fr.courtagePct || 0)) / 100) - (fr.courtageFixe || 0);
  const coutAchat = montant => montant <= 0 && !options.transactionsForcees ? 0 : montant - netAchat(montant);

  // Points de contrôle : chaque année, ou chaque mois pour les durées courtes
  const pas = options.pas || (T <= 24 ? 1 : 12);
  const nbPoints = Math.floor(T / pas) + 1;
  const annees = Math.floor(T / 12);
  const verse = new Float64Array(T + 1);      // cumul versé (identique pour toutes les trajectoires)
  verse[0] = plan.capital;
  for (let t = 1; t <= T; t++) verse[t] = verse[t - 1] + versementDuMois(plan, t);

  const V = options.garderMensuel ? new Float32Array(n * (T + 1)) : null;
  const parAn = { V: new Float64Array(n * nbPoints), V0: new Float64Array(n * nbPoints), D: new Float64Array(n * nbPoints),
    F: new Float64Array(n * nbPoints), DI: new Float64Array(n * nbPoints) };
  const finale = { V: new Float64Array(n), V0: new Float64Array(n), D: new Float64Array(n), F: new Float64Array(n), DI: new Float64Array(n), perteMax: new Float64Array(n) };

  for (let i = 0; i < n; i++) {
    const b = i * M;
    let v = netAchat(plan.capital), v0 = plan.capital, d = 0, f = coutAchat(plan.capital), di = 0;
    let sommet = I[b], pmax = 0;
    if (V) V[i * (T + 1)] = v;
    parAn.V[i * nbPoints] = v; parAn.V0[i * nbPoints] = v0; parAn.F[i * nbPoints] = f;
    for (let t = 1; t <= T; t++) {
      // mois passés : valeurs liquidatives réelles, frais du fonds déjà déduits (seuls les droits de garde s'appliquent)
      const tauxFrais = t <= (marche.moisPasses || 0) ? (fr.garde || 0) / 100 / 12 : tauxFraisTotal;
      const R = I[b + t] / I[b + t - 1];            // performance totale du mois (revenus compris)
      const div = v * q, div0 = v0 * q;
      if (reinvestis) {
        const netDiv = div * (1 - impotDividendes);
        v = v * R * (1 - tauxFrais) - div * impotDividendes;
        v0 = v0 * R - div0 * impotDividendes;
        d += netDiv; di += div * impotDividendes;
      } else {
        v = v * (R - q) * (1 - tauxFrais);            // les revenus sortent du fonds…
        v0 = v0 * (R - q);
        d += div * (1 - impotDividendes); di += div * impotDividendes;  // … et sont encaissés (sans intérêts)
      }
      f += v / (1 - tauxFrais) * tauxFrais;
      const c = versementDuMois(plan, t);
      if (c > 0 || (options.transactionsForcees && t % plan.frequence === 0)) { v += netAchat(c); v0 += c; f += coutAchat(c); }
      if (I[b + t] > sommet) sommet = I[b + t];
      const baisse = I[b + t] / sommet - 1;
      if (baisse < pmax) pmax = baisse;
      if (V) V[i * (T + 1) + t] = v;
      if (t % pas === 0) {
        const k = i * nbPoints + t / pas;
        parAn.V[k] = v; parAn.V0[k] = v0; parAn.D[k] = d; parAn.F[k] = f; parAn.DI[k] = di;
      }
    }
    finale.V[i] = v; finale.V0[i] = v0; finale.D[i] = d; finale.F[i] = f; finale.DI[i] = di; finale.perteMax[i] = pmax;
  }
  return { n, T, annees, pas, nbPoints, verse, V, parAn, finale, reinvestis, plan };
}

// ---------- Lecture des résultats ----------

function quantileTrie(t, p) {
  if (!t.length) return NaN;
  const x = (t.length - 1) * p, i = Math.floor(x), f = x - i;
  return i + 1 < t.length ? t[i] * (1 - f) + t[i + 1] * f : t[i];
}

const RANGS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

// Rangs de la valeur du portefeuille, mois par mois (pour le graphique en éventail)
function eventail(res) {
  const n = res.n, T = res.T, col = new Float64Array(n);
  const sortie = RANGS.map(() => new Float64Array(T + 1));
  for (let t = 0; t <= T; t++) {
    for (let i = 0; i < n; i++) col[i] = res.V[i * (T + 1) + t];
    col.sort();
    RANGS.forEach((p, k) => { sortie[k][t] = quantileTrie(col, p); });
  }
  const r = {};
  RANGS.forEach((p, k) => { r["p" + Math.round(p * 100)] = sortie[k]; });
  return r;
}

// Valeurs de toutes les trajectoires au mois t (t doit être un point de contrôle : multiple de res.pas)
function colonne(res, cle, t) {
  const n = res.n, P = res.nbPoints, k = Math.round(t / res.pas), c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = res.parAn[cle][i * P + k];
  return c;
}
// Patrimoine total : valeur du portefeuille + dividendes encaissés s'ils ne sont pas réinvestis
function colonnePatrimoine(res, t) {
  const c = colonne(res, "V", t);
  if (!res.reinvestis) { const d = colonne(res, "D", t); for (let i = 0; i < c.length; i++) c[i] += d[i]; }
  return c;
}
function medianeColonne(res, cle, t) { return quantileTrie(colonne(res, cle, t).sort(), 0.5); }

// Taux de rendement annuel équivalent (TRI) de flux mensuels : capital au départ, versements, valeur finale
function tri(plan, T, valeurFinale) {
  const flux = [];
  flux.push([0, plan.capital]);
  for (let t = 1; t <= T; t++) { const c = versementDuMois(plan, t); if (c) flux.push([t, c]); }
  const valeurAvec = r => flux.reduce((s, [t, c]) => s + c * Math.pow(1 + r, (T - t) / 12), 0);
  if (valeurFinale <= 0) return -1;
  let bas = -0.99, haut = 1;
  for (let k = 0; k < 80; k++) { const m = (bas + haut) / 2; if (valeurAvec(m) > valeurFinale) haut = m; else bas = m; }
  return (bas + haut) / 2;
}

/*
 * Scénario à un rang donné (0,1 = défavorable, 0,5 = central, 0,9 = favorable) :
 * on fait la moyenne des trajectoires classées autour de ce rang, pour que valeur, dividendes et frais restent cohérents.
 */
function scenario(res, p, t) {
  const n = res.n, P = res.nbPoints, k = Math.round(t / res.pas);
  const tot = colonnePatrimoine(res, t);
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => tot[a] - tot[b]);
  const largeur = Math.max(5, Math.round(n * 0.02));
  const centre = Math.round((n - 1) * p);
  const choisis = idx.slice(Math.max(0, centre - largeur), Math.min(n, centre + largeur + 1));
  const moy = cle => choisis.reduce((s, i) => s + res.parAn[cle][i * P + k], 0) / choisis.length;
  // valeur au rang exact ; dividendes, frais et valeur sans frais : moyenne des trajectoires voisines (cohérentes entre elles)
  const D = moy("D"), total = quantileTrie(idx.map(i => tot[i]), p);
  return construireScenario(res, t, { V: res.reinvestis ? total : total - D, V0: moy("V0"), D, F: moy("F"), DI: moy("DI") });
}

function construireScenario(res, t, x) {
  const plan = res.plan, annees = t / 12;
  const verse = res.verse[t];
  const inflation = Math.pow(1 + (plan.inflation || 0) / 100, annees);
  const encaisse = res.reinvestis ? 0 : x.D;                 // dividendes versés (non réinvestis)
  const total = x.V + encaisse;
  // Compte-titres : les dividendes déjà imposés chaque année ne le sont pas une seconde fois à la sortie.
  // PEA et assurance-vie : les dividendes restent dans l'enveloppe et sont imposés avec les gains, au retrait.
  const cto = plan.fiscalite && plan.fiscalite.enveloppe === "cto";
  const baseFiscale = verse + (cto && res.reinvestis && x.DI > 0 ? x.D : 0);
  const impot = impotALaSortie(plan.fiscalite, cto ? x.V : total, baseFiscale, annees);
  return {
    mois: t, annees, verse, valeur: x.V, valeurSansFrais: x.V0 + (res.reinvestis ? 0 : x.D), dividendes: x.D, dividendesReinvestis: res.reinvestis, dividendesEncaisses: encaisse,
    impotDividendes: x.DI, frais: x.F, coutFrais: x.V0 - x.V, gain: total - verse, perfCumulee: (total - verse) / verse,
    perfAnnualisee: tri(plan, t, total), inflationCumulee: inflation - 1, total, valeurReelle: total / inflation,
    impot, valeurNette: total - impot, valeurNetteReelle: (total - impot) / inflation
  };
}

// Scénario d'une trajectoire unique (tensions, crise rejouée)
function scenarioUnique(res, t) {
  const k = Math.round(t / res.pas), g = c => res.parAn[c][k];
  return construireScenario(res, t, { V: g("V"), V0: g("V0"), D: g("D"), F: g("F"), DI: g("DI") });
}

function probabiliteDePerte(res, t) {
  const col = colonnePatrimoine(res, t), verse = res.verse[t];
  let k = 0;
  for (let i = 0; i < col.length; i++) if (col[i] < verse) k++;
  return k / col.length;
}

// Baisse maximale en cours de route (sur la trajectoire du marché), rangs
function baissesEnCoursDeRoute(res) {
  const t = Float64Array.from(res.finale.perteMax).sort();
  return { mediane: quantileTrie(t, 0.5), unSurDix: quantileTrie(t, 0.1), probaAuDela: seuil => t.filter(x => x <= -seuil).length / t.length };
}

// Trajectoire d'exemple : celle dont la valeur finale est la plus proche de la médiane, avec ses performances année par année
// Trajectoire d'exemple : celle dont la valeur finale est la plus proche de la médiane, avec ses performances année par année
function trajectoireExemple(marche, res, annees) {
  const n = res.n, T = annees * 12;
  const col = colonnePatrimoine(res, T);
  const med = quantileTrie(Float64Array.from(col).sort(), 0.5);
  let meilleur = 0, ecart = Infinity;
  for (let i = 0; i < Math.min(n, 400); i++) { const e = Math.abs(col[i] - med); if (e < ecart) { ecart = e; meilleur = i; } }
  const M = marche.mois + 1, b = meilleur * M;
  const perfs = [];
  for (let a = 1; a <= annees; a++) perfs.push(marche.I[b + a * 12] / marche.I[b + (a - 1) * 12] - 1);
  return { indice: meilleur, perfs };
}

// ---------- Objectif ----------

// Valeur finale de chaque trajectoire = capital × A + versement × B + E (E = effet des frais fixes par ordre)
function coefficientsObjectif(marche, plan, T) {
  const base = { ...plan, mois: T };
  const sansFixe = { ...base.frais, courtageFixe: 0 };
  const a = colonnePatrimoine(appliquerPlan(marche, { ...base, capital: 1, versement: 0, frais: sansFixe }), T);
  const b = colonnePatrimoine(appliquerPlan(marche, { ...base, capital: 0, versement: 1, frais: sansFixe }), T);
  const e = (base.frais && base.frais.courtageFixe) ? colonnePatrimoine(appliquerPlan(marche, { ...base, capital: 0, versement: 0 }, { transactionsForcees: true }), T) : new Float64Array(marche.n);
  return { a, b, e };
}

function analyseObjectif(marche, plan, objectif, enEurosDuJour) {
  const annees = plan.mois / 12;
  const cible = an => enEurosDuJour ? objectif * Math.pow(1 + (plan.inflation || 0) / 100, an) : objectif;
  const { a, b, e } = coefficientsObjectif(marche, plan, plan.mois);
  const n = a.length;
  const k = cible(annees);
  let atteint = 0;
  const besoinVersement = new Float64Array(n), besoinCapital = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = plan.capital * a[i] + plan.versement * b[i] + e[i];
    if (v >= k) atteint++;
    besoinVersement[i] = b[i] > 0 ? Math.max(0, (k - plan.capital * a[i] - e[i]) / b[i]) : Infinity;
    besoinCapital[i] = Math.max(0, (k - plan.versement * b[i] - e[i]) / a[i]);
  }
  besoinVersement.sort(); besoinCapital.sort();
  const chances = [0.5, 0.75, 0.9];
  // Durée nécessaire : première année où le rang voulu dépasse l'objectif (jusqu'à 40 ans), en gardant le même rythme de versements
  const long = appliquerPlan(marche, { ...plan, mois: Math.min(marche.mois, 480) }, { pas: 12 });
  const duree = {};
  const rangs = [];
  for (let an = 1; an <= long.annees; an++) rangs.push(colonnePatrimoine(long, an * 12).sort());
  for (const p of chances) {
    duree[p] = null;
    for (let an = 1; an <= long.annees; an++) if (quantileTrie(rangs[an - 1], 1 - p) >= cible(an)) { duree[p] = an; break; }
  }
  // Trajectoires du patrimoine (rangs 10 %, 50 %, 90 %) année par année, pour le graphique
  const trajectoires = { p10: [], p50: [], p90: [] };
  const col0 = colonnePatrimoine(long, 0).sort();
  for (const [cle, p] of [["p10", 0.1], ["p50", 0.5], ["p90", 0.9]]) {
    trajectoires[cle].push(quantileTrie(col0, p));
    for (let an = 1; an <= long.annees; an++) trajectoires[cle].push(quantileTrie(rangs[an - 1], p));
  }
  return {
    cible: k, probabilite: atteint / n,
    versement: Object.fromEntries(chances.map(p => [p, quantileTrie(besoinVersement, p)])),
    capital: Object.fromEntries(chances.map(p => [p, quantileTrie(besoinCapital, p)])),
    duree, trajectoires, verseParAn: Array.from({ length: long.annees + 1 }, (_, an) => long.verse[an * 12]),
    cibleParAn: Array.from({ length: long.annees + 1 }, (_, an) => cible(an))
  };
}

// ---------- Crises ----------

const CRISES_HISTORIQUES = [
  { cle: "tech2000", nom: "Krach des valeurs technologiques", periode: "2000 – 2003", debut: "2000-04", finCrise: "2003-03",
    texte: "Après l'euphorie Internet, les valeurs technologiques s'effondrent pendant près de trois ans. Le Nasdaq perd près de 80 % de son point haut." },
  { cle: "fin2008", nom: "Crise financière (subprimes, faillite de Lehman Brothers)", periode: "2007 – 2009", debut: "2007-11", finCrise: "2009-02",
    texte: "La crise des crédits immobiliers américains devient une crise bancaire mondiale, puis une récession." },
  { cle: "dette2011", nom: "Crise des dettes publiques européennes", periode: "2011", debut: "2011-05", finCrise: "2011-09",
    texte: "Les inquiétudes sur la Grèce, l'Italie et l'Espagne font chuter les marchés européens." },
  { cle: "covid2020", nom: "Krach du Covid-19", periode: "2020", debut: "2020-02", finCrise: "2020-03",
    texte: "Les confinements provoquent la chute la plus rapide de l'histoire des marchés, suivie d'un rebond très rapide." },
  { cle: "ukraine2022", nom: "Crise géopolitique : invasion de l'Ukraine", periode: "2022", debut: "2022-02", finCrise: "2022-03",
    texte: "L'invasion de l'Ukraine par la Russie provoque une flambée de l'énergie et une forte incertitude." },
  { cle: "taux2022", nom: "Forte inflation et hausse rapide des taux", periode: "2022", debut: "2022-01", finCrise: "2022-10",
    texte: "L'inflation dépasse 10 % en zone euro ; les banques centrales relèvent leurs taux très vite. Actions et obligations baissent en même temps." }
];

// Hypothèses illustratives (chocs appliqués à chaque exposition sur la durée indiquée, puis retour au rythme central)
const CRISES_HYPOTHETIQUES = [
  { cle: "baisse20", nom: "Baisse de 20 % des marchés actions", mois: 6,
    chocs: { actions: -0.20, oblig10: 0.02, oblig3: 0.01, monetaire: 0.01 },
    texte: "Une correction marquée, comme les marchés en connaissent en moyenne tous les quelques années." },
  { cle: "baisse40", nom: "Baisse de 40 % des marchés actions", mois: 12,
    chocs: { actions: -0.40, emergents: -0.45, oblig10: 0.04, oblig3: 0.02, monetaire: 0.02 },
    texte: "Un krach de grande ampleur, de l'ordre de ceux de 2000-2003 ou 2008-2009 pour les actions mondiales." },
  { cle: "recession", nom: "Récession mondiale", mois: 12,
    chocs: { actions: -0.30, tech: -0.35, emergents: -0.35, oblig10: 0.06, oblig3: 0.03, monetaire: 0.02 },
    texte: "Les bénéfices des entreprises reculent ; les banques centrales baissent leurs taux, ce qui soutient les obligations d'État." },
  { cle: "taux", nom: "Forte hausse des taux (+3 points)", mois: 12,
    chocs: { actions: -0.15, tech: -0.25, oblig10: -0.20, oblig3: -0.06, monetaire: 0.03 },
    texte: "Les obligations existantes perdent de la valeur (d'autant plus que leur échéance est lointaine) ; les actions de croissance souffrent." },
  { cle: "inflation", nom: "Forte inflation (8 % par an pendant 2 ans)", mois: 24, inflation: 8,
    chocs: { actions: -0.10, oblig10: -0.15, oblig3: -0.05, monetaire: 0.05 },
    texte: "Les prix montent vite : même sans baisse en euros, le pouvoir d'achat de l'épargne recule fortement." },
  { cle: "krachtech", nom: "Krach technologique", mois: 18,
    chocs: { actions: -0.15, usa: -0.25, tech: -0.50, oblig10: 0.03, oblig3: 0.02, monetaire: 0.02 },
    texte: "Les grandes valeurs technologiques chutent fortement, entraînant les indices où elles pèsent lourd." },
  { cle: "geopolitique", nom: "Crise géopolitique majeure", mois: 3,
    chocs: { actions: -0.15, euro: -0.18, emergents: -0.25, oblig10: 0.03, oblig3: 0.01, monetaire: 0.005 },
    texte: "Un conflit ou une rupture entre grandes puissances : fuite vers les placements jugés sûrs." }
];

// Choc total d'un fonds pour une crise hypothétique, d'après son exposition
function chocDuFonds(crise, expositions) {
  const total = expositions.reduce((s, x) => s + x.poids, 0) || 1;
  return expositions.reduce((s, x) => {
    const c = CLASSE_EXPOSITION[x.cle] || "actions";
    const choc = crise.chocs[x.cle] !== undefined ? crise.chocs[x.cle] : crise.chocs[c] || 0;
    return s + x.poids / total * choc;
  }, 0);
}

// Rejoue une crise historique sur l'historique (réel ou reconstitué) du fonds, puis les années qui suivent
function rejouerCriseHistorique(comb, crise, plan, moisApres = 60) {
  const i0 = comb.mois.indexOf(crise.debut);
  if (i0 < 0) return null;
  const iFinCrise = comb.mois.indexOf(crise.finCrise);
  const n = Math.min(comb.r.length - i0, ecartMois(crise.debut, crise.finCrise) + 1 + moisApres);
  if (n < 3) return null;
  const r = comb.r.slice(i0, i0 + n);
  const reel = comb.reel.slice(i0, i0 + n);
  return { ...resumerCrise(marcheDeterministe(r), plan, n, iFinCrise >= 0 ? iFinCrise - i0 + 1 : null), reel: reel.every(Boolean) ? "reel" : reel.some(Boolean) ? "mixte" : "reconstitue", debut: crise.debut };
}

function rejouerCriseHypothetique(crise, expositions, g, plan, moisApres = 60) {
  const choc = chocDuFonds(crise, expositions);
  const parMois = Math.pow(1 + choc, 1 / crise.mois) - 1, central = Math.pow(1 + g, 1 / 12) - 1;
  const r = [];
  for (let t = 0; t < crise.mois + moisApres; t++) r.push(t < crise.mois ? parMois : central);
  return { ...resumerCrise(marcheDeterministe(r), { ...plan, inflation: plan.inflation }, r.length, crise.mois, crise.inflation), choc };
}

function resumerCrise(marche, plan, n, moisCrise, inflationCrise) {
  const p = { ...plan, frais: { ...plan.frais, courants: 0 }, mois: n };   // rendements historiques : frais du fonds déjà déduits
  const res = appliquerPlan(marche, p, { garderMensuel: true, moisCalcul: n });
  const valeurs = Array.from(res.V), verse = Array.from(res.verse);
  // Valeur réelle (pouvoir d'achat) : inflation de crise pendant la crise si précisée, puis l'hypothèse générale
  const reelles = valeurs.map((v, t) => {
    const infl = inflationCrise ? Math.pow(1 + inflationCrise / 100, Math.min(t, moisCrise || 0) / 12) * Math.pow(1 + (plan.inflation || 0) / 100, Math.max(0, t - (moisCrise || 0)) / 12)
      : Math.pow(1 + (plan.inflation || 0) / 100, t / 12);
    return v / infl;
  });
  let pire = 0, tPire = 0, sommet = marche.I[0];
  for (let t = 0; t <= n; t++) { if (marche.I[t] > sommet) sommet = marche.I[t]; const b = marche.I[t] / sommet - 1; if (b < pire) { pire = b; tPire = t; } }
  let pireEcart = 0, tPireEcart = 0;
  valeurs.forEach((v, t) => { const e = v - verse[t]; if (e < pireEcart) { pireEcart = e; tPireEcart = t; } });
  let retour = null;
  if (pireEcart < 0) for (let t = tPireEcart; t <= n; t++) if (valeurs[t] >= verse[t]) { retour = t; break; }
  return { valeurs, verse, reelles, baisseMarche: pire, moisPire: tPire, pireEcart, moisPireEcart: tPireEcart, moisRetour: retour, moisCrise, n,
    valeurFinale: valeurs[n], verseFinal: verse[n] };
}

// ---------- Portefeuille de plusieurs fonds ----------

function correlation(a, b) {
  const ma = moyenne(a), mb = moyenne(b);
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb || 1);
}

// Mois communs à tous les fonds (suite continue la plus récente)
function moisCommuns(combs) {
  const ensembles = combs.map(c => new Set(c.mois));
  const communs = combs[0].mois.filter(m => ensembles.every(s => s.has(m)));
  const carte = new Map(communs.map(m => [m, 0]));
  return suiteContinue(carte);
}

function analysePortefeuille(lignes) { // lignes : [{ comb, modele, poids (0-1) }]
  const mois = moisCommuns(lignes.map(l => l.comb));
  const series = lignes.map(l => { const idx = new Map(l.comb.mois.map((m, i) => [m, l.comb.r[i]])); return mois.map(m => idx.get(m)); });
  const k = lignes.length;
  const corr = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => i === j ? 1 : correlation(series[i], series[j])));
  const rp = mois.map((_, t) => lignes.reduce((s, l, i) => s + l.poids * series[i][t], 0));
  const vols = series.map(s => ecartType(s.map(x => Math.log(1 + x))) * Math.sqrt(12));
  const volP = ecartType(rp.map(x => Math.log(1 + x))) * Math.sqrt(12);
  const ratioDiversification = lignes.reduce((s, l, i) => s + l.poids * vols[i], 0) / (volP || 1);
  return { mois, series, corr, rp, vols, volP, ratioDiversification, nbEffectif: 1 / lignes.reduce((s, l) => s + l.poids ** 2, 0) };
}

// Trajectoires jointes : les mêmes blocs de mois sont tirés pour tous les fonds (leurs liens sont conservés),
// puis le portefeuille est rééquilibré chaque mois vers les poids choisis
function simulerPortefeuille(lignes, analyse, { mois = HYPOTHESES_DEFAUT.moisSimules, n = HYPOTHESES_DEFAUT.trajectoires, bloc = HYPOTHESES_DEFAUT.bloc, graine = HYPOTHESES_DEFAUT.graine } = {}) {
  const alea = generateur(graine);
  const T = analyse.mois.length;
  const params = lignes.map((l, j) => {
    const logs = analyse.series[j].map(x => Math.log(1 + x));
    const m = moyenne(logs), s = ecartType(logs) || 1;
    return { z: logs.map(x => (x - m) / s), mu: Math.log(1 + l.modele.g) / 12, sig: l.modele.sigma / Math.sqrt(12), poids: l.poids };
  });
  const I = new Float32Array(n * (mois + 1));
  for (let i = 0; i < n; i++) {
    const base = i * (mois + 1);
    I[base] = 1;
    let niveau = 1, t = 0;
    while (t < mois) {
      const debut = Math.floor(alea() * T);
      for (let k = 0; k < bloc && t < mois; k++) {
        const idx = (debut + k) % T;
        let r = 0;
        for (const p of params) r += p.poids * (Math.exp(p.mu + p.sig * p.z[idx]) - 1);
        niveau *= 1 + r;
        t++;
        I[base + t] = niveau;
      }
    }
  }
  return { n, mois, I };
}

// Rendement médian implicite d'un ensemble de trajectoires (pour décrire un portefeuille)
function croissanceMediane(marche, annees) {
  const M = marche.mois + 1, t = new Float64Array(marche.n);
  for (let i = 0; i < marche.n; i++) t[i] = marche.I[i * M + annees * 12];
  t.sort();
  return Math.pow(quantileTrie(t, 0.5), 1 / annees) - 1;
}

/*
 * MOTEUR 2 — Exposition réelle estimée par l'analyse des rendements
 *
 * Idée : si un fonds monte et baisse exactement comme un mélange « 60 % actions américaines + 40 % obligations euro »,
 * c'est que son argent est (économiquement) investi ainsi — quoi qu'il détienne sur le papier.
 * C'est la méthode dite « d'analyse de style » (W. Sharpe, 1992), que l'on applique nous-mêmes :
 *
 *   rendement du fonds ≈ Σ poids_i × rendement de la référence i     avec poids ≥ 0 et Σ poids = 100 %
 *
 * On cherche les poids qui reproduisent le mieux les rendements hebdomadaires des 3 dernières années.
 * Le R² indique la qualité de la reproduction (100 % = parfaite).
 *
 * Références utilisées (données brutes gratuites, lues en direct) :
 *   - valeurs liquidatives de fonds indiciels français (base GECO de l'AMF)
 *   - courbe des taux des emprunts d'État de la zone euro, €STR et cours dollar/euro (Banque centrale européenne)
 * Une « couche devise » (dollar) permet de repérer une couverture de change : elle peut être positive ou négative
 * et n'entre pas dans le total de 100 %.
 */

const BCE_API = "https://data-api.ecb.europa.eu/service/data/";

const FACTEURS = [
  { cle: "usa", nom: "Actions États-Unis (S&P 500)", isins: ["FR0011871128"], classe: "Actions", zone: "Amérique du Nord", pays: "États-Unis", devise: "USD" },
  { cle: "tech", nom: "Actions tech US (Nasdaq-100)", isins: ["FR0011871110", "FR001400ZGR7"], classe: "Actions", zone: "Amérique du Nord", pays: "États-Unis", devise: "USD", secteur: "Technologie" },
  { cle: "euro", nom: "Actions zone euro (Euro Stoxx 50)", isins: ["FR0012739431"], classe: "Actions", zone: "Zone euro", devise: "EUR" },
  { cle: "europe", nom: "Actions Europe hors zone euro", isins: ["FR0010821819"], classe: "Actions", zone: "Europe hors zone euro", devise: "GBP, CHF…" },
  { cle: "japon", nom: "Actions Japon (Topix)", isins: ["FR0010245514"], classe: "Actions", zone: "Asie-Pacifique développée", pays: "Japon", devise: "JPY" },
  { cle: "emergents", nom: "Actions pays émergents", isins: ["FR0010429068"], classe: "Actions", zone: "Pays émergents", devise: "Devises émergentes" },
  { cle: "oblig10", nom: "Emprunts d'État euro ~10 ans", bce: "YC/B.U2.EUR.4F.G_N_C.SV_C_YM.SR_10Y", maturite: 10, classe: "Obligations", zone: "Zone euro", devise: "EUR" },
  { cle: "oblig3", nom: "Emprunts d'État euro ~3 ans", bce: "YC/B.U2.EUR.4F.G_N_C.SV_C_YM.SR_3Y", maturite: 3, classe: "Obligations", zone: "Zone euro", devise: "EUR" },
  { cle: "monetaire", nom: "Monétaire euro (€STR)", bce: "EST/B.EU000A2X2A25.WT", taux: true, classe: "Monétaire", zone: "Zone euro", devise: "EUR" }
];
const COUCHE_DOLLAR = { cle: "dollar", nom: "Dollar US face à l'euro", bce: "EXR/D.USD.EUR.SP00.A", change: true };

const ANNEES_STYLE = 3;

// ---------- Chargement des séries de référence (avec cache) ----------

const _series = {};
function lireCache(cle) {
  try {
    const c = JSON.parse(localStorage.getItem("serie-" + cle) || "null");
    if (c && c.jour === new Date().toISOString().slice(0, 10)) return { dates: c.dates.map(d => new Date(d)), valeurs: c.valeurs };
  } catch (e) { /* ignoré */ }
  return null;
}
function ecrireCache(cle, s) {
  try {
    localStorage.setItem("serie-" + cle, JSON.stringify({ jour: new Date().toISOString().slice(0, 10), dates: s.dates.map(d => d.toISOString().slice(0, 10)), valeurs: s.valeurs }));
  } catch (e) { /* stockage plein ou indisponible */ }
}

async function serieGeco(isins) {
  for (const isin of isins) {
    const e = annuaireParIsin(isin);
    if (!e) continue;
    const parts = await gecoJson(`/funds/compartment/c${e.cmpId}/shares`);
    const part = parts.find(p => p.isin === isin);
    if (!part) continue;
    const h = await gecoJson(`/funds/chart/${part.idInterne}?startDate=${dateIso(ilYa(ANNEES_STYLE + 0.5))}`);
    if (h.x && h.x.length > 200) {
      return historiqueDepuisGeco(h);
    }
  }
  throw new Error("série indisponible");
}

async function serieBce(cle) {
  const url = `${BCE_API}${cle}?format=csvdata&detail=dataonly&startPeriod=${dateIso(ilYa(ANNEES_STYLE + 0.5))}`;
  const texte = await (await fetch(url)).text();
  const lignes = texte.trim().split(/\r?\n/);
  const entete = lignes[0].split(",");
  const iDate = entete.indexOf("TIME_PERIOD"), iVal = entete.indexOf("OBS_VALUE");
  const dates = [], valeurs = [];
  for (const l of lignes.slice(1)) {
    const c = l.split(",");
    const v = parseFloat(c[iVal]);
    if (!isNaN(v)) { dates.push(new Date(c[iDate] + "T00:00:00")); valeurs.push(v); }
  }
  return { dates, valeurs };
}

// Séries préparées chaque jour par le site (data/references.js) : évite de les relire dans GECO à chaque visite
function serieDeReference(cle) {
  if (typeof DONNEES_REFERENCES === "undefined" || !DONNEES_REFERENCES || !DONNEES_REFERENCES.style || !DONNEES_REFERENCES.style[cle]) return null;
  if ((Date.now() - new Date(DONNEES_REFERENCES.maj)) / 864e5 > 4) return null;   // trop ancienne : on relit GECO
  const s = DONNEES_REFERENCES.style[cle];
  const [a, m, j] = s.d0.split("-").map(Number);
  return { dates: s.j.map(k => new Date(a, m - 1, j + k)), valeurs: s.v };
}

async function chargerSerie(f) {
  if (_series[f.cle]) return _series[f.cle];
  const pre = f.bce ? null : serieDeReference(f.cle);
  if (pre) return (_series[f.cle] = pre);
  const cache = lireCache(f.cle);
  if (cache) return (_series[f.cle] = cache);
  const s = f.bce ? await serieBce(f.bce) : await serieGeco(f.isins);
  if (s.valeurs.length < 100) throw new Error("série trop courte");
  ecrireCache(f.cle, s);
  return (_series[f.cle] = s);
}

// ---------- Rendements hebdomadaires sur une grille commune (les vendredis) ----------

function valeurAu(serie, date, curseur) {
  // dernière valeur connue à cette date (au plus 7 jours avant)
  let i = curseur.i;
  while (i + 1 < serie.dates.length && serie.dates[i + 1] <= date) i++;
  curseur.i = i;
  if (serie.dates[i] > date || (date - serie.dates[i]) / 864e5 > 7) return null;
  return serie.valeurs[i];
}

function grilleVendredis(debut, fin) {
  const d = new Date(debut);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  const res = [];
  for (; d <= fin; d.setDate(d.getDate() + 7)) res.push(new Date(d));
  return res;
}

function rendements(serie, grille, f) {
  const cur = { i: 0 };
  const niveaux = grille.map(d => valeurAu(serie, d, cur));
  const r = [];
  for (let t = 1; t < grille.length; t++) {
    const a = niveaux[t - 1], b = niveaux[t];
    if (a === null || b === null) { r.push(null); continue; }
    const dt = (grille[t] - grille[t - 1]) / 864e5 / 365.25;
    if (f && f.maturite) r.push(Math.exp(a / 100 * f.maturite - b / 100 * (f.maturite - dt)) - 1); // obligation zéro-coupon à maturité constante
    else if (f && f.taux) r.push(a / 100 * dt * 365.25 / 360);                                     // placement au jour le jour
    else if (f && f.change) r.push(a / b - 1);                                                     // 1 $ exprimé en euros
    else r.push(b / a - 1);
  }
  return r;
}

// ---------- Régression sous contraintes (poids ≥ 0, somme = 1) ----------

function projeterSimplexe(v) {
  // projection euclidienne sur { w ≥ 0, Σw = 1 }
  const u = [...v].sort((a, b) => b - a);
  let cumul = 0, theta = 0;
  for (let i = 0; i < u.length; i++) {
    cumul += u[i];
    const t = (cumul - 1) / (i + 1);
    if (u[i] - t > 0) theta = t;
  }
  return v.map(x => Math.max(0, x - theta));
}

function regressionStyle(y, X, z) {
  const n = y.length, k = X[0].length;
  const col = (j) => j < k ? X.map(l => l[j]) : z;
  const m = k + (z ? 1 : 0);
  // matrice G = AᵀA et vecteur b = Aᵀy
  const G = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  const cols = Array.from({ length: m }, (_, j) => col(j));
  for (let i = 0; i < m; i++) {
    for (let t = 0; t < n; t++) b[i] += cols[i][t] * y[t];
    for (let j = i; j < m; j++) { let s = 0; for (let t = 0; t < n; t++) s += cols[i][t] * cols[j][t]; G[i][j] = G[j][i] = s; }
  }
  // pas = 1 / plus grande valeur propre (méthode de la puissance)
  let v = new Array(m).fill(1), L = 1;
  for (let it = 0; it < 50; it++) {
    const w = G.map(l => l.reduce((s, x, j) => s + x * v[j], 0));
    L = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
    v = w.map(x => x / L);
  }
  // descente de gradient projetée accélérée (Nesterov)
  let x = new Array(m).fill(0).map((_, j) => j < k ? 1 / k : 0), yk = [...x], tk = 1;
  const projeter = p => { const w = projeterSimplexe(p.slice(0, k)); return z ? w.concat([Math.max(-1.5, Math.min(1.5, p[k]))]) : w; };
  for (let it = 0; it < 4000; it++) {
    const grad = G.map((l, i) => l.reduce((s, g, j) => s + g * yk[j], 0) - b[i]);
    const xn = projeter(yk.map((val, i) => val - grad[i] / L));
    const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    yk = xn.map((val, i) => val + ((tk - 1) / tn) * (val - x[i]));
    x = xn; tk = tn;
  }
  // qualité
  const pred = y.map((_, t) => cols.reduce((s, c, j) => s + c[t] * x[j], 0));
  const moy = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - moy) ** 2, 0);
  const ssr = y.reduce((s, v, t) => s + (v - pred[t]) ** 2, 0);
  const residus = y.map((v, t) => v - pred[t]);
  const mr = residus.reduce((s, v) => s + v, 0) / n;
  const ecartSuivi = Math.sqrt(residus.reduce((s, v) => s + (v - mr) ** 2, 0) / (n - 1) * 52) * 100;
  return { poids: x.slice(0, k), dollar: z ? x[k] : 0, r2: 1 - ssr / sst, ecartSuivi, n };
}

// ---------- Point d'entrée ----------

async function analyserStyle(historique) {
  if (!historique || historique.valeurs.length < 60) return null;
  const refs = await Promise.all(FACTEURS.concat([COUCHE_DOLLAR]).map(f => chargerSerie(f).catch(() => null)));
  const dispo = FACTEURS.map((f, i) => ({ f, s: refs[i] })).filter(x => x.s);
  const dollar = refs[refs.length - 1];
  if (dispo.length < 5) return null;

  const fin = new Date(Math.min(historique.dates[historique.dates.length - 1], ...dispo.map(x => x.s.dates[x.s.dates.length - 1])));
  const debut = new Date(Math.max(ilYa(ANNEES_STYLE), historique.dates[0]));
  const grille = grilleVendredis(debut, fin);
  const ry = rendements(historique, grille);
  const rx = dispo.map(x => rendements(x.s, grille, x.f));
  const rz = dollar ? rendements(dollar, grille, COUCHE_DOLLAR) : null;

  // on garde les semaines où toutes les données existent
  const y = [], X = [], z = [];
  for (let t = 0; t < ry.length; t++) {
    if (ry[t] === null || rx.some(r => r[t] === null) || (rz && rz[t] === null)) continue;
    if (Math.abs(ry[t]) > 0.4) continue; // saut aberrant (division de parts, erreur de saisie)
    y.push(ry[t]); X.push(rx.map(r => r[t])); if (rz) z.push(rz[t]);
  }
  if (y.length < 52) return null;
  const res = regressionStyle(y, X, rz ? z : null);

  const expositions = dispo.map((x, i) => ({ ...x.f, poids: res.poids[i] * 100 })).filter(e => e.poids >= 0.5).sort((a, b) => b.poids - a.poids);
  const somme = (cle) => {
    const m = new Map();
    for (const e of expositions) if (e[cle]) m.set(e[cle], (m.get(e[cle]) || 0) + e.poids);
    return [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 10) / 10 })).sort((a, b) => b.poids - a.poids);
  };
  const actionsUsd = expositions.filter(e => e.devise === "USD").reduce((s, e) => s + e.poids, 0);
  const usdNet = actionsUsd + res.dollar * 100;
  return {
    source: "style",
    semaines: y.length, debut: grille[0], fin,
    r2: res.r2, ecartSuivi: res.ecartSuivi,
    expositions: expositions.map(e => ({ nom: e.nom, cle: e.cle, poids: Math.round(e.poids * 10) / 10 })),
    classes: somme("classe"), zones: somme("zone"),
    pays: somme("pays"),                 // seuls les pays identifiables (États-Unis, Japon)
    techUs: expositions.filter(e => e.cle === "tech").reduce((s, e) => s + e.poids, 0),
    dollar: { actions: Math.round(actionsUsd), couche: Math.round(res.dollar * 100), net: Math.round(usdNet) },
    couvertureProbable: actionsUsd > 15 && usdNet < actionsUsd * 0.4,
    // zones de la seule partie actions (pour juger la concentration géographique)
    zonesActions: (() => {
      const act = expositions.filter(e => e.classe === "Actions");
      const tot = act.reduce((s, e) => s + e.poids, 0);
      const m = new Map();
      for (const e of act) m.set(e.zone, (m.get(e.zone) || 0) + e.poids);
      return { total: Math.round(tot), zones: [...m.entries()].map(([nom, p]) => ({ nom, poids: Math.round(p / (tot || 1) * 1000) / 10 })).sort((a, b) => b.poids - a.poids) };
    })()
  };
}

// ---------- Fonds « jumeau » pour les fonds sans historique (ETF étrangers) ----------

const INDICES_CONNUS = [
  ["S&P 500", /S&P\s?500/i], ["Nasdaq-100", /NASDAQ[\s-]?100/i], ["MSCI World", /MSCI\s+WORLD(?!\s+EX)/i], ["MSCI ACWI", /ACWI|ALL COUNTRY WORLD/i],
  ["MSCI Emerging Markets", /MSCI\s+EM(ERGING)?(\s+MARKETS)?\b(?!\s+(ASIA|LATIN|EMEA))/i], ["Euro Stoxx 50", /EURO\s?STOXX\s?50/i],
  ["Stoxx Europe 600", /STOXX\s+EUROPE\s+600/i], ["MSCI Europe", /MSCI\s+EUROPE(?!\s+EX)/i], ["MSCI EMU", /MSCI\s+EMU/i],
  ["CAC 40", /CAC\s?40/i], ["Topix", /TOPIX/i], ["MSCI Japan", /MSCI\s+JAPAN/i], ["MSCI USA", /MSCI\s+USA/i],
  ["MSCI China", /MSCI\s+CHINA/i], ["MSCI India", /MSCI\s+INDIA/i], ["DAX", /\bDAX\b/i]
];

function indiceDuNom(nom) {
  const t = nom.toUpperCase();
  for (const [indice, re] of INDICES_CONNUS) if (re.test(t)) return indice;
  return null;
}

// Cherche un fonds français (dans GECO) qui suit le même indice : on analysera ses rendements à la place
// preferePhysique = true pour la composition (l'inventaire d'un fonds physique montre les vrais titres de l'indice) ;
// false pour les performances (on veut surtout l'indice standard, pas une variante ESG ou climat).
function trouverJumeau(nom, preferePhysique = true) {
  const indice = indiceDuNom(nom);
  if (!indice) return null;
  const re = INDICES_CONNUS.find(i => i[0] === indice)[1];
  const exclus = /DAILY|LEVERAGED|INVERSE|\(-?\dX\)|\b[23]X\b|SHORT|HEDGED|COUVERT|BUFFER|PROTECT|EQUAL|EQUIPOND|MINIMUM|MOMENTUM|VALUE|GROWTH|QUALITY|DIVIDEND|SMALL|MID CAP/i;
  const candidats = ANNUAIRE.filter(l => l[0] === "G" && l[14] === 1 && l[7] && re.test(l[3]) && !exclus.test(l[3])).map(lireEntree);
  if (!candidats.length) return null;
  // on préfère un fonds à réplication physique (son inventaire montre la vraie composition de l'indice)
  const synthetique = e => /SWAP/i.test(e.nom) || (/\bPEA\b/i.test(e.nom) && !/EUROPE|EURO|CAC|FRANCE|DAX|EMU/i.test(e.nom));
  const variante = e => /ESG|SRI|SCREENED|CLIMATE|PAB|CTB|SELECTION|PARIS/i.test(e.nom);
  const rang = preferePhysique
    ? e => (synthetique(e) ? 3 : 0) + (e.etf ? 0 : 2) + (variante(e) ? 1 : 0)
    : e => (variante(e) ? 4 : 0) + (e.etf ? 0 : 2);
  candidats.sort((a, b) => rang(a) - rang(b) || (a.dateCreation || "9").localeCompare(b.dateCreation || "9"));
  return { indice, fonds: candidats[0] };
}

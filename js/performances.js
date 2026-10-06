/*
 * Page « Performances » : un graphique interactif de l'évolution d'un fonds.
 *
 * Même base que « Décrypte ton fonds » : l'annuaire (data/annuaire.js) et l'historique des valeurs liquidatives
 * publié par l'AMF (GECO). Pour un ETF étranger sans historique public, on affiche un fonds français qui suit
 * le même indice (« fonds jumeau »), en le signalant.
 *
 * Le fonds affiché est dans l'adresse (#ISIN), ce qui permet de passer d'un onglet à l'autre sans le perdre.
 */

const PERIODES = [
  { cle: "1m", nom: "1 mois", mois: 1 }, { cle: "6m", nom: "6 mois", mois: 6 }, { cle: "ytd", nom: "Cette année" },
  { cle: "1a", nom: "1 an", mois: 12 }, { cle: "3a", nom: "3 ans", mois: 36 }, { cle: "5a", nom: "5 ans", mois: 60 },
  { cle: "10a", nom: "10 ans", mois: 120 }, { cle: "max", nom: "Max" }
];

// Références de marché proposées en comparaison (données brutes : GECO et Banque centrale européenne)
const REFERENCES = [
  { cle: "ref-monde", nom: "Actions monde (MSCI World)", isin: "FR0010315770" },
  { cle: "ref-usa", nom: "Actions États-Unis (S&P 500)", isin: "FR0011871128" },
  { cle: "ref-euro", nom: "Actions zone euro (Euro Stoxx 50)", isin: "FR0012739431" },
  { cle: "ref-monetaire", nom: "Placement monétaire (€STR)", bce: "EST/B.EU000A2X2A25.WT" },
  { cle: "ref-livrets", nom: "Livrets d'épargne (taux moyen, France)", bce: "MIR/M.FR.B.L23.D.R.A.2250.EUR.N" }
];
const MAX_COMPARAISONS = 2;

const ETAT_PERF = { principal: null, comparaisons: [], periode: "5a", survol: null };
const cacheSeries = new Map();
let numeroAffichage = 0;

const zonePerf = document.getElementById("resultat");
const ICONE_SIMULER = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 20h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 16l4-4 3 2 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 8l4-3M16 8l4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.5 2.5"/></svg>`;
const champPerf = document.getElementById("champ-recherche");

// ---------- Chargement des séries ----------

// Historique complet d'une part (GECO), mis en cache pendant la visite
function historiquePart(entree, isin) {
  const cle = "part-" + (isin || entree.cmpId);
  if (!cacheSeries.has(cle)) {
    cacheSeries.set(cle, (async () => {
      const parts = await gecoJson(`/funds/compartment/c${entree.cmpId}/shares`);
      const part = parts.find(p => p.isin === isin) || parts.find(p => p.isin === entree.isins[0]) || parts[0];
      if (!part) throw new Error("aucune part dans GECO");
      const h = historiqueDepuisGeco(await gecoJson(`/funds/chart/${part.idInterne}?startDate=1990-01-01`));
      return { part, parts, dates: h.dates, valeurs: h.valeurs, corrections: h.corrections };
    })().catch(err => { cacheSeries.delete(cle); throw err; }));
  }
  return cacheSeries.get(cle);
}

// Série d'une référence de marché
function serieReference(ref) {
  if (!cacheSeries.has(ref.cle)) {
    cacheSeries.set(ref.cle, (async () => {
      if (ref.isin) {
        const e = annuaireParIsin(ref.isin);
        const h = await historiquePart(e, ref.isin);
        return { dates: h.dates, valeurs: h.valeurs };
      }
      // Référence BCE (€STR, livrets) : on reconstitue la valeur d'un placement rémunéré à ce taux (base 100)
      const texte = await (await fetch(`${BCE_API}${ref.bce}?format=csvdata&detail=dataonly&startPeriod=2019-10-01`)).text();
      return serieDepuisCsvBce(texte);
    })().catch(err => { cacheSeries.delete(ref.cle); throw err; }));
  }
  return cacheSeries.get(ref.cle);
}

// Série d'un fonds de l'annuaire : son propre historique, ou celui de son « jumeau » français
async function serieFonds(entree, isin) {
  if (entree.source === "G") {
    const h = await historiquePart(entree, isin);
    if (h.valeurs.length < 2) throw new Error("historique vide");
    return { ...h, nom: entree.nom, entree, isin: h.part.isin, jumeau: null };
  }
  const jumeau = trouverJumeau(entree.nom, false);
  if (!jumeau) throw new Error("aucune donnée publique pour ce fonds");
  const h = await historiquePart(jumeau.fonds, jumeau.fonds.isins[0]);
  return { ...h, nom: entree.nom, entree, isin, jumeau };
}

// ---------- Calculs sur la période ----------

// Indice du dernier point à cette date ou avant (recherche dichotomique)
function indiceAvant(dates, d) {
  let bas = 0, haut = dates.length - 1, res = -1;
  while (bas <= haut) { const m = (bas + haut) >> 1; if (dates[m] <= d) { res = m; bas = m + 1; } else haut = m - 1; }
  return res;
}

function debutPeriode(periode, fin, premiereDate) {
  if (periode === "max") return premiereDate;
  if (periode === "ytd") return new Date(fin.getFullYear() - 1, 11, 31);
  const p = PERIODES.find(x => x.cle === periode);
  const d = new Date(fin); d.setMonth(d.getMonth() - p.mois);
  return d;
}

// Points d'une série sur la fenêtre, en % depuis le début de la période
function pointsSurPeriode(serie, debut, fin) {
  let i0 = indiceAvant(serie.dates, debut);
  let tardive = false;
  if (i0 < 0) { i0 = 0; tardive = true; }          // la série commence après le début de la période
  const i1 = indiceAvant(serie.dates, fin);
  if (i1 <= i0) return null;
  const base = serie.valeurs[i0];
  const pts = [];
  for (let i = i0; i <= i1; i++) pts.push({ d: serie.dates[i], v: (serie.valeurs[i] / base - 1) * 100, vl: serie.valeurs[i] });
  return { pts, dates: pts.map(q => q.d), depuis: serie.dates[i0], tardiveReelle: tardive };
}

function chiffresCles(pts) {
  const n = pts.length;
  const annees = (pts[n - 1].d - pts[0].d) / (365.25 * 864e5);
  const total = pts[n - 1].v;
  const annualisee = annees >= 1 ? (Math.pow(1 + total / 100, 1 / annees) - 1) * 100 : null;
  let vol = null;
  if (n > 20 && annees > 0.08) {
    const r = [];
    for (let i = 1; i < n; i++) r.push(Math.log((1 + pts[i].v / 100) / (1 + pts[i - 1].v / 100)));
    const moy = r.reduce((s, x) => s + x, 0) / r.length;
    const variance = r.reduce((s, x) => s + (x - moy) ** 2, 0) / (r.length - 1);
    vol = Math.sqrt(variance * (r.length / annees)) * 100;
  }
  let sommet = -Infinity, pire = 0;
  for (const p of pts) { const niv = 1 + p.v / 100; sommet = Math.max(sommet, niv); pire = Math.min(pire, niv / sommet - 1); }
  return { total, annualisee, vol, perteMax: pire * 100, annees };
}

function performancesAnnuelles(serie) {
  const res = [];
  const derniere = serie.dates[serie.dates.length - 1];
  for (let a = derniere.getFullYear(); a >= serie.dates[0].getFullYear() && res.length < 12; a--) {
    const iFinPrec = indiceAvant(serie.dates, new Date(a - 1, 11, 31, 23));
    const iFin = indiceAvant(serie.dates, new Date(a, 11, 31, 23));
    if (iFin < 0) continue;
    const partielle = iFinPrec < 0;
    const iBase = partielle ? serie.dates.findIndex(d => d.getFullYear() === a) : iFinPrec;
    if (iBase < 0 || iBase >= iFin) continue;
    res.push({ annee: a, perf: (serie.valeurs[iFin] / serie.valeurs[iBase] - 1) * 100, partielle, enCours: a === derniere.getFullYear() && derniere.getMonth() < 11 });
  }
  return res;
}

// ---------- Mise en forme ----------

const signe = v => (v > 0 ? "+" : "") + v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const dateLongue = d => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function graduationsDates(debut, fin, largeur) {
  const nb = Math.max(2, Math.min(7, Math.floor(largeur / 90)));
  const jours = (fin - debut) / 864e5;
  const res = [];
  if (jours > 730) {                                   // en années
    const pasAnnees = Math.max(1, Math.ceil(jours / 365.25 / nb));
    for (let a = debut.getFullYear() + 1; a <= fin.getFullYear(); a += pasAnnees) res.push({ d: new Date(a, 0, 1), texte: String(a) });
  } else {                                             // en mois
    const pasMois = Math.max(1, Math.ceil(jours / 30.44 / nb));
    const d = new Date(debut.getFullYear(), debut.getMonth() + 1, 1);
    for (; d <= fin; d.setMonth(d.getMonth() + pasMois)) res.push({ d: new Date(d), texte: d.toLocaleDateString("fr-FR", { month: "short", year: jours > 200 ? "2-digit" : undefined }) });
  }
  return res;
}

// ---------- Graphique ----------

function seriesVisibles() {
  const p = ETAT_PERF.principal;
  return [{ ...p, couleur: 0 }].concat(ETAT_PERF.comparaisons.map(c => ({ ...c })));
}

function dessinerGraphique() {
  const conteneur = document.getElementById("graphique");
  if (!conteneur || !ETAT_PERF.principal) return;
  const p = ETAT_PERF.principal;
  const fin = p.dates[p.dates.length - 1];
  let debut = debutPeriode(ETAT_PERF.periode, fin, p.dates[0]);
  // « Max » avec des comparaisons : toutes les courbes partent de la première date commune, pour être comparables
  if (ETAT_PERF.periode === "max" && ETAT_PERF.comparaisons.length) {
    debut = new Date(Math.max(...seriesVisibles().map(s => s.dates[0])));
  }
  const legendeMax = document.getElementById("periode-commune");
  if (legendeMax) legendeMax.textContent = ETAT_PERF.periode === "max" && ETAT_PERF.comparaisons.length
    ? `Période commune à toutes les courbes : depuis le ${debut.toLocaleDateString("fr-FR")}.` : "";
  const series = seriesVisibles().map(s => ({ ...s, periode: pointsSurPeriode(s, debut, fin) })).filter(s => s.periode);
  ETAT_PERF.affichees = series;
  if (!series.length) { conteneur.innerHTML = `<p class="vide">Pas de données sur cette période.</p>`; return; }

  const L = Math.max(280, conteneur.clientWidth), H = L < 560 ? 250 : 340;
  const m = { g: 52, d: 12, h: 12, b: 28 };
  const xDebut = series[0].periode.pts[0].d, xFin = fin;
  let yMin = 0, yMax = 0;
  for (const s of series) for (const pt of s.periode.pts) { if (pt.v < yMin) yMin = pt.v; if (pt.v > yMax) yMax = pt.v; }
  const marge = (yMax - yMin) * 0.06 || 1;
  yMin -= marge; yMax += marge;
  const ticks = graduations(yMin, yMax, L < 560 ? 4 : 6);
  yMin = Math.min(yMin, ticks[0]); yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const X = d => m.g + (d - xDebut) / (xFin - xDebut || 1) * (L - m.g - m.d);
  const Y = v => m.h + (yMax - v) / (yMax - yMin || 1) * (H - m.h - m.b);
  ETAT_PERF.echelle = { X, Y, L, H, m, xDebut, xFin };

  const grille = ticks.map(t => `<line class="grille${t === 0 ? " zero" : ""}" x1="${m.g}" x2="${L - m.d}" y1="${Y(t)}" y2="${Y(t)}"/>
    <text class="axe" x="${m.g - 6}" y="${Y(t) + 4}" text-anchor="end">${t > 0 ? "+" : ""}${t.toLocaleString("fr-FR")} %</text>`).join("");
  const axeX = graduationsDates(xDebut, xFin, L).filter(g => g.d >= xDebut && g.d <= xFin)
    .map(g => `<text class="axe" x="${X(g.d)}" y="${H - 8}" text-anchor="middle">${esc(g.texte)}</text>`).join("");

  const chemins = series.map(s => {
    const pts = s.periode.pts;
    const pas = Math.max(1, Math.floor(pts.length / (L * 1.5)));
    let d = "";
    for (let i = 0; i < pts.length; i += pas) d += (d ? "L" : "M") + X(pts[i].d).toFixed(1) + " " + Y(pts[i].v).toFixed(1);
    const der = pts[pts.length - 1];
    d += "L" + X(der.d).toFixed(1) + " " + Y(der.v).toFixed(1);
    const aire = series.length === 1 ? `<path class="aire serie-${s.couleur}" d="${d}L${X(der.d).toFixed(1)} ${Y(0)}L${X(pts[0].d).toFixed(1)} ${Y(0)}Z"/>` : "";
    return aire + `<path class="ligne serie-${s.couleur}" d="${d}"/>`;
  }).join("");

  conteneur.innerHTML = `
    <svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img"
      aria-label="Évolution de ${esc(p.nom)} du ${dateLongue(xDebut)} au ${dateLongue(xFin)} : ${signe(series[0].periode.pts[series[0].periode.pts.length - 1].v)}">
      ${grille}${axeX}${chemins}
      <g class="survol" visibility="hidden">
        <line class="curseur" y1="${m.h}" y2="${H - m.b}"/>
        ${series.map(s => `<circle class="point serie-${s.couleur}" r="4.5"/>`).join("")}
      </g>
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg>
    <div class="bulle-perf" hidden></div>`;

  const zone = conteneur.querySelector(".zone-survol");
  const suivre = ev => {
    const r = conteneur.querySelector("svg").getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const d = new Date(xDebut.getTime() + (x - m.g) / (L - m.g - m.d) * (xFin - xDebut));
    const pts = series[0].periode.pts;
    ETAT_PERF.survol = Math.max(0, Math.min(pts.length - 1, indiceAvant(series[0].periode.dates, d)));
    majSurvol();
  };
  zone.addEventListener("pointermove", suivre);
  zone.addEventListener("pointerdown", suivre);
  zone.addEventListener("pointerleave", () => { ETAT_PERF.survol = null; majSurvol(); });
  if (ETAT_PERF.survol !== null) majSurvol();
}

function majSurvol() {
  const conteneur = document.getElementById("graphique");
  const series = ETAT_PERF.affichees;
  if (!conteneur || !series || !ETAT_PERF.echelle) return;
  const g = conteneur.querySelector(".survol"), bulle = conteneur.querySelector(".bulle-perf");
  if (!g) return;
  const { X, Y, L } = ETAT_PERF.echelle;
  const i = ETAT_PERF.survol;
  if (i === null || i === undefined) { g.setAttribute("visibility", "hidden"); bulle.hidden = true; return; }
  const ref = series[0].periode.pts[Math.min(i, series[0].periode.pts.length - 1)];
  const x = X(ref.d);
  g.setAttribute("visibility", "visible");
  g.querySelector(".curseur").setAttribute("x1", x);
  g.querySelector(".curseur").setAttribute("x2", x);
  const lignes = [];
  series.forEach((s, k) => {
    const pts = s.periode.pts;
    const j = indiceAvant(s.periode.dates, ref.d);
    const cercle = g.querySelectorAll(".point")[k];
    if (j < 0) { cercle.setAttribute("visibility", "hidden"); return; }
    cercle.setAttribute("visibility", "visible");
    cercle.setAttribute("cx", X(pts[j].d)); cercle.setAttribute("cy", Y(pts[j].v));
    lignes.push(`<div class="bulle-ligne"><span class="pastille-serie serie-${s.couleur}"></span><span class="bulle-nom">${esc(s.nomCourt || s.nom)}</span><strong>${signe(pts[j].v)}</strong></div>`);
  });
  bulle.innerHTML = `<div class="bulle-date">${dateLongue(ref.d)}</div>${lignes.join("")}
    <div class="bulle-valeur">Valeur liquidative${ETAT_PERF.principal.jumeau ? " (fonds jumeau)" : ""} : ${ref.vl.toLocaleString("fr-FR")} ${esc(ETAT_PERF.principal.part && ETAT_PERF.principal.part.parRefDevCode || "")}</div>`;
  bulle.hidden = false;
  const largeur = bulle.offsetWidth;
  bulle.style.left = Math.min(Math.max(0, x + 14), L - largeur) + "px";
  if (x + 14 + largeur > L) bulle.style.left = Math.max(0, x - largeur - 14) + "px";
}

// ---------- Rendu de la page ----------

// Suite de la mention « Données brutes : … (base GECO) » : une source BCE par référence comparée
function sourcesBce(comparaisons) {
  const compare = cle => comparaisons.some(c => c.cle === cle);
  return (compare("ref-monetaire") ? " et €STR de la Banque centrale européenne" : "")
    + (compare("ref-livrets") ? " et taux moyen des livrets (BCE, données de la Banque de France)" : "");
}

function majLegendeEtChiffres() {
  const series = ETAT_PERF.affichees || [];
  const leg = document.getElementById("legende-perf");
  if (leg) leg.innerHTML = series.map((s, k) => {
    const pts = s.periode.pts, der = pts[pts.length - 1];
    return `<li><span class="pastille-serie serie-${s.couleur}"></span>
      <span class="legende-nom">${esc(s.nomCourt || s.nom)}${s.periode.tardiveReelle ? ` <small>(depuis le ${s.periode.depuis.toLocaleDateString("fr-FR")})</small>` : ""}</span>
      <strong class="${der.v >= 0 ? "hausse" : "baisse"}">${signe(der.v)}</strong>
      ${k > 0 ? `<button type="button" class="retirer" data-retirer="${esc(s.cle)}" aria-label="Retirer ${esc(s.nom)} de la comparaison">×</button>` : ""}</li>`;
  }).join("");

  const chiffres = document.getElementById("chiffres-cles");
  if (chiffres && series[0]) {
    const c = chiffresCles(series[0].periode.pts);
    const tuile = (lib, val, cle) => `<div class="tuile"><span>${cle ? terme(cle, lib) : lib}</span><strong>${val}</strong></div>`;
    chiffres.innerHTML = tuile("Performance sur la période", signe(c.total))
      + tuile("Par an en moyenne", c.annualisee === null ? "—" : signe(c.annualisee), "performance_annualisee")
      + tuile("Volatilité", c.vol === null ? "—" : pct(c.vol), "volatilite")
      + tuile("Perte maximale", pct(c.perteMax), "max_drawdown");
  }
  const sources = document.getElementById("sources-bce");
  if (sources) sources.textContent = sourcesBce(ETAT_PERF.comparaisons);
  document.querySelectorAll(".periodes button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.periode === ETAT_PERF.periode)));
  document.querySelectorAll("[data-reference]").forEach(b => b.setAttribute("aria-pressed", String(ETAT_PERF.comparaisons.some(c => c.cle === b.dataset.reference))));
}

function majTableauAnnuel() {
  const t = document.getElementById("tableau-annuel");
  if (!t) return;
  const series = [ETAT_PERF.principal].concat(ETAT_PERF.comparaisons);
  const annuel = series.map(s => performancesAnnuelles(s));
  const annees = annuel[0].map(a => a.annee);
  t.innerHTML = `<table>
    <thead><tr><th>Année</th>${series.map(s => `<th>${esc(s.nomCourt || s.nom)}</th>`).join("")}</tr></thead>
    <tbody>${annees.map(a => `<tr><th>${a}${annuel[0].find(x => x.annee === a).enCours ? " <small>(en cours)</small>" : ""}</th>${annuel.map(liste => {
      const x = liste.find(y => y.annee === a);
      return `<td class="${x ? (x.perf >= 0 ? "hausse" : "baisse") : ""}">${x ? signe(x.perf) + (x.partielle ? "*" : "") : "—"}</td>`;
    }).join("")}</tr>`).join("")}</tbody>
  </table>
  <p class="aide">* année incomplète (le fonds ou la référence a démarré en cours d'année).</p>`;
}

function toutMettreAJour() {
  dessinerGraphique();
  majLegendeEtChiffres();
  majTableauAnnuel();
}

function afficherSquelette(entree, isin, principal) {
  const cle = cleEntree(entree, isin);
  const part = principal.part;
  const distribuante = part && /distrib/i.test(part.parAffctnRevnuLib || "");
  const choixParts = principal.parts && principal.parts.length > 1 && !principal.jumeau
    ? `<label class="choix-part">Part : <select id="choix-part">${principal.parts.map(pa => `<option value="${esc(pa.isin)}"${pa.isin === part.isin ? " selected" : ""}>${esc(pa.parNom)} — ${esc(pa.isin)}${pa.parRefDevCode ? " (" + esc(pa.parRefDevCode) + ")" : ""}</option>`).join("")}</select></label>` : "";
  zonePerf.innerHTML = `
  <article class="fiche perf">
    <header class="fiche-entete">
      <h1>${esc(entree.nom)}</h1>
      <p>${esc(isin || "ISIN non publié")}${part && !principal.jumeau ? ` · part « ${esc(part.parNom)} »` : ""}${entree.gestionnaire ? ` · ${esc(entree.gestionnaire)}` : ""}</p>
      <div class="actions-fiche">
        <a class="btn btn-simuler" href="simulateur.html#${esc(cle)}">${ICONE_SIMULER} Simuler mon investissement</a>
        <a class="btn-onglet" href="decrypte.html#${esc(cle)}">Décrypter ce fonds →</a>
        ${choixParts}
      </div>
    </header>
    ${principal.jumeau ? `<p class="note">Pas d'historique de cours public et gratuit pour cet ETF. Le graphique montre un fonds français qui suit le
      <strong>même indice (${esc(principal.jumeau.indice)})</strong> : <a href="#${esc(principal.jumeau.fonds.isins[0])}">${esc(principal.jumeau.fonds.nom)}</a>.
      L'évolution est très proche, mais pas identique (frais, devise, méthode de réplication).</p>` : ""}
    <section class="carte carte-graphique">
      <div class="periodes" role="group" aria-label="Période affichée">
        ${PERIODES.map(p => `<button type="button" data-periode="${p.cle}" aria-pressed="false">${p.nom}</button>`).join("")}
      </div>
      <div class="comparer">
        <span class="comparer-titre">Comparer avec :</span>
        ${REFERENCES.map(r => `<button type="button" class="chip-comparer" data-reference="${r.cle}" aria-pressed="false">${esc(r.nom)}</button>`).join("")}
        <div class="comparer-fonds">
          <label for="champ-comparer" class="sr-only">Comparer avec un autre fonds</label>
          <input id="champ-comparer" type="search" placeholder="… ou un autre fonds (nom, ISIN)" autocomplete="off">
          <ul id="suggestions-comparer" class="suggestions" hidden></ul>
        </div>
      </div>
      <p class="aide" id="periode-commune"></p>
      <ul class="legende-perf" id="legende-perf"></ul>
      <div class="graphique-perf" id="graphique" tabindex="0"
        aria-label="Graphique interactif : utilisez les flèches gauche et droite pour parcourir les dates"></div>
      <div class="chiffres-cles" id="chiffres-cles"></div>
      <details class="details-annuel">
        <summary>Performances par année civile (tableau)</summary>
        <div id="tableau-annuel"></div>
      </details>
      <p class="note">Performances calculées sur la ${terme("valeur_liquidative", "valeur liquidative")}, frais de gestion déduits.
        ${distribuante ? "<strong>Part distribuante :</strong> les revenus versés ne sont pas inclus, la performance réelle est donc un peu supérieure." : ""}
        Les performances passées ne préjugent pas des performances futures.</p>
      ${principal.corrections && principal.corrections.length ? `<p class="aide">Historique corrigé par ce site : ${principal.corrections.map(c => `${esc(c.type)} le ${c.date.toLocaleDateString("fr-FR")}`).join(", ")} (les valeurs publiées ne sont pas ajustées).</p>` : ""}
      <p class="source">Données brutes : valeurs liquidatives publiées par l'AMF (base GECO)<span id="sources-bce">${sourcesBce(ETAT_PERF.comparaisons)}</span>. Calculs : ce site.</p>
    </section>
  </article>`;
  brancherEvenements();
}

function brancherEvenements() {
  document.querySelectorAll(".periodes button").forEach(b => b.addEventListener("click", () => {
    ETAT_PERF.periode = b.dataset.periode; ETAT_PERF.survol = null; toutMettreAJour();
  }));
  document.querySelectorAll("[data-reference]").forEach(b => b.addEventListener("click", () => basculerReference(b.dataset.reference)));
  document.getElementById("legende-perf").addEventListener("click", e => {
    const cle = e.target.dataset && e.target.dataset.retirer;
    if (cle) { ETAT_PERF.comparaisons = ETAT_PERF.comparaisons.filter(c => c.cle !== cle); toutMettreAJour(); }
  });
  const choix = document.getElementById("choix-part");
  if (choix) choix.addEventListener("change", () => { location.hash = choix.value; });

  // Clavier : flèches pour parcourir le graphique
  const g = document.getElementById("graphique");
  g.addEventListener("keydown", e => {
    const pts = ETAT_PERF.affichees && ETAT_PERF.affichees[0] && ETAT_PERF.affichees[0].periode.pts;
    if (!pts) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const pas = Math.max(1, Math.round(pts.length / 60));
      const i = ETAT_PERF.survol === null ? pts.length - 1 : ETAT_PERF.survol + (e.key === "ArrowRight" ? pas : -pas);
      ETAT_PERF.survol = Math.max(0, Math.min(pts.length - 1, i));
      majSurvol();
    } else if (e.key === "Escape") { ETAT_PERF.survol = null; majSurvol(); }
  });
  g.addEventListener("blur", () => { ETAT_PERF.survol = null; majSurvol(); });

  // Comparaison avec un autre fonds de l'annuaire
  const champ = document.getElementById("champ-comparer"), liste = document.getElementById("suggestions-comparer");
  let minuterie = 0;
  champ.addEventListener("input", () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      const q = champ.value.trim();
      const res = q.length < 2 ? [] : rechercherAnnuaire(q, 8).filter(e => e.isins.length || e.source !== "G");
      liste.hidden = !res.length;
      liste.innerHTML = res.map(e => `<li><button type="button" data-ajouter="${esc(cleEntree(e))}">${esc(e.nom)} <small>${esc(e.isins[0] || "")}</small></button></li>`).join("");
    }, 200);
  });
  liste.addEventListener("click", async e => {
    const b = e.target.closest("[data-ajouter]");
    if (!b) return;
    liste.hidden = true; champ.value = "";
    const entree = annuaireParIsin(b.dataset.ajouter) || annuaireParCle(b.dataset.ajouter);
    if (entree) await ajouterComparaison("fonds-" + b.dataset.ajouter, entree.nom, () => serieFonds(entree, b.dataset.ajouter));
  });
  document.addEventListener("click", e => { if (!e.target.closest(".comparer-fonds")) liste.hidden = true; });
}

function couleurLibre() {
  const prises = ETAT_PERF.comparaisons.map(c => c.couleur);
  return [1, 2].find(c => !prises.includes(c)) || 1;
}

async function basculerReference(cle) {
  if (ETAT_PERF.comparaisons.some(c => c.cle === cle)) {
    ETAT_PERF.comparaisons = ETAT_PERF.comparaisons.filter(c => c.cle !== cle);
    toutMettreAJour();
    return;
  }
  const ref = REFERENCES.find(r => r.cle === cle);
  await ajouterComparaison(cle, ref.nom, () => serieReference(ref));
}

async function ajouterComparaison(cle, nom, charger) {
  if (ETAT_PERF.comparaisons.some(c => c.cle === cle)) return;
  if (ETAT_PERF.comparaisons.length >= MAX_COMPARAISONS) ETAT_PERF.comparaisons.shift(); // on garde le graphique lisible
  const leg = document.getElementById("legende-perf");
  const attente = document.createElement("li");
  attente.className = "chargement";
  attente.textContent = `Chargement de ${nom}…`;
  if (leg) leg.appendChild(attente);
  try {
    const s = await charger();
    ETAT_PERF.comparaisons.push({ cle, nom, nomCourt: nom.length > 38 ? nom.slice(0, 36) + "…" : nom, dates: s.dates, valeurs: s.valeurs, couleur: couleurLibre() });
  } catch (err) {
    alert(`Impossible de charger « ${nom} » : ${err.message}`);
  }
  toutMettreAJour();
}

// ---------- Navigation (#ISIN dans l'adresse) ----------

async function afficherPerformances() {
  const cle = decodeURIComponent(location.hash.slice(1));
  const numero = ++numeroAffichage;
  document.title = "Performances · Décrypte ton fonds";
  if (!cle) { zonePerf.innerHTML = ""; return; }

  const entree = annuaireParIsin(cle) || annuaireParCle(cle);
  if (!entree) { zonePerf.innerHTML = listePerf([], cle); return; }
  const isin = entree.isins.includes(cle) ? cle : entree.isins[0];
  document.title = `${entree.nom} · Performances`;
  zonePerf.innerHTML = `<div class="carte"><h1 class="titre-chargement">${esc(entree.nom)}</h1><p class="chargement">Chargement de l'historique des valeurs liquidatives…</p></div>`;
  zonePerf.scrollIntoView({ behavior: "smooth", block: "start" });

  let principal;
  try {
    principal = await serieFonds(entree, isin);
  } catch (err) {
    if (numero !== numeroAffichage) return;
    zonePerf.innerHTML = `<div class="carte"><h1 class="titre-chargement">${esc(entree.nom)}</h1>
      <p class="non-dispo">Pas d'historique de performances disponible pour ce fonds (${esc(err.message)}).</p>
      <p><a class="btn-onglet" href="decrypte.html#${esc(cleEntree(entree, isin))}">Décrypter ce fonds →</a></p></div>`;
    return;
  }
  if (numero !== numeroAffichage) return;
  const garder = ETAT_PERF.principal && ETAT_PERF.principal.entree === entree ? ETAT_PERF.comparaisons : [];
  const court = n => n.length > 38 ? n.slice(0, 36) + "…" : n;
  ETAT_PERF.principal = { ...principal, cle: "principal",
    nomCourt: principal.jumeau ? `${court(entree.nom)} (via ${court(principal.jumeau.fonds.nom)})` : court(entree.nom) };
  ETAT_PERF.comparaisons = garder;
  const annees = (principal.dates[principal.dates.length - 1] - principal.dates[0]) / (365.25 * 864e5);
  if (!garder.length) ETAT_PERF.periode = annees >= 5 ? "5a" : "max";
  ETAT_PERF.survol = null;
  afficherSquelette(entree, isin, ETAT_PERF.principal);
  toutMettreAJour();
}

function listePerf(resultats, requete) {
  if (!resultats.length) return `<div class="carte"><p>Aucun fonds trouvé pour « ${esc(requete)} ».</p></div>`;
  return `<div class="carte"><h2>${resultats.length >= 50 ? "Plus de 50" : resultats.length} fonds trouvés</h2>
    <ul class="similaires resultats">${resultats.map(e => `<li><a href="#${esc(cleEntree(e))}">${esc(e.nom)}</a>
      <small>${esc(e.isins[0] || "ISIN non publié")}${e.gestionnaire ? " · " + esc(e.gestionnaire) : ""}${e.source !== "G" ? (trouverJumeau(e.nom, false) ? " · via un fonds qui suit le même indice" : " · pas d'historique public") : ""}</small></li>`).join("")}</ul></div>`;
}

function lancerRecherchePerf(texte) {
  const reels = rechercherAnnuaire(texte);
  if (reels.length === 1) location.hash = cleEntree(reels[0], reels[0].isins.includes(texte.trim().toUpperCase()) ? texte.trim().toUpperCase() : null);
  else zonePerf.innerHTML = listePerf(reels, texte);
}

document.getElementById("form-recherche").addEventListener("submit", e => { e.preventDefault(); lancerRecherchePerf(champPerf.value); });

document.getElementById("exemples").innerHTML = "<span>Exemples :</span> " + [
  ["FR0010135103", "Carmignac Patrimoine"], ["FR0011871128", "Amundi PEA S&P 500"], ["LU1681043599", "Amundi MSCI World (CW8)"], ["FR0010250100", "CD Euro Capital"]
].filter(([i]) => annuaireParIsin(i)).map(([i, n]) => `<a href="#${i}" class="chip">${esc(n)}</a>`).join(" ");

let minuterieRedim = 0;
window.addEventListener("resize", () => { clearTimeout(minuterieRedim); minuterieRedim = setTimeout(dessinerGraphique, 150); });
window.addEventListener("hashchange", afficherPerformances);
afficherPerformances();
const rechercheVenue = rechercheDansAdresse();
if (rechercheVenue && !location.hash) { champPerf.value = rechercheVenue; lancerRecherchePerf(rechercheVenue); }

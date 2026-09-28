/*
 * Graphiques du simulateur (SVG dessiné à la main, sans bibliothèque) :
 *   - éventail des trajectoires possibles (rangs 10-90 % et 25-75 %, médiane, total versé, tensions, exemples)
 *   - répartition des résultats (histogramme Monte Carlo)
 *   - crise rejouée, objectif, comparaison de fonds, corrélations, mini-courbes des indicateurs
 * Chaque graphique a une info au survol (souris, doigt, flèches du clavier).
 */

// ---------- Mise en forme ----------

function eurosCourt(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€";
  if (a >= 1e4) return Math.round(v / 1e3).toLocaleString("fr-FR") + " k€";
  if (a >= 1e3) return (v / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k€";
  return Math.round(v).toLocaleString("fr-FR") + " €";
}
function pctSigne(x, dec = 1) { // x en fraction (0,052 → « +5,2 % »)
  if (x === null || x === undefined || isNaN(x)) return "n.d.";
  const v = x * 100;
  return (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " %";
}
// Les estimations sont arrondies : afficher « 64 021 € » donnerait une fausse impression de précision
function eurosEstimes(v) {
  const a = Math.abs(v);
  const pas = a >= 1e6 ? 10000 : a >= 1e5 ? 1000 : a >= 1e4 ? 100 : a >= 1e3 ? 10 : 1;
  return euros(Math.round(v / pas) * pas);
}
function eurosSigne(v) { return (v > 0.5 ? "+" : v < -0.5 ? "−" : "") + eurosEstimes(Math.abs(v)); }
function dateDuMois(debut, t) { const [a, m] = debut.split("-").map(Number); return new Date(a, m - 1 + t, 1); }
function moisAnnee(d) { return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }); }
function dureeTexte(mois) {
  if (mois < 12) return `${mois} mois`;
  const a = Math.floor(mois / 12), m = mois % 12;
  return `${a} an${a > 1 ? "s" : ""}${m ? ` et ${m} mois` : ""}`;
}

function echelleValeurs(max, min = 0, cible = 5) {
  const ticks = graduations(min, max, cible);
  return { ticks, min: Math.min(min, ticks[0]), max: Math.max(max, ticks[ticks.length - 1]) };
}

function positionnerBulle(bulle, x, largeurTotale, y) {
  bulle.hidden = false;
  const l = bulle.offsetWidth;
  let gauche = x + 14;
  if (gauche + l > largeurTotale) gauche = Math.max(0, x - l - 14);
  bulle.style.left = gauche + "px";
  if (y !== undefined) bulle.style.top = Math.max(0, y) + "px";
}

// Brancher le survol (souris, doigt, clavier) sur une zone : appelle `montrer(i)` avec l'indice du point le plus proche
function brancherSurvol(conteneur, zone, xs, montrer, cacher) {
  let courant = null;
  const choisir = ev => {
    const r = zone.getBoundingClientRect();
    const svg = conteneur.querySelector("svg").getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - svg.left;
    let meilleur = 0, ecart = Infinity;
    xs.forEach((xx, i) => { const e = Math.abs(xx - x); if (e < ecart) { ecart = e; meilleur = i; } });
    courant = meilleur; montrer(meilleur);
  };
  zone.addEventListener("pointermove", choisir);
  zone.addEventListener("pointerdown", choisir);
  zone.addEventListener("pointerleave", () => { courant = null; cacher(); });
  conteneur.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      courant = courant === null ? xs.length - 1 : Math.max(0, Math.min(xs.length - 1, courant + (e.key === "ArrowRight" ? 1 : -1)));
      montrer(courant);
    } else if (e.key === "Escape") { courant = null; cacher(); }
  });
  conteneur.addEventListener("blur", () => { courant = null; cacher(); });
}

function cheminLigne(points) { return points.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(""); }
function cheminBande(haut, bas) { return cheminLigne(haut) + bas.slice().reverse().map(p => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("") + "Z"; }

// ---------- Éventail des trajectoires ----------

/*
 * o = { T, debut ("AAAA-MM"), ev (rangs mois par mois), verse, pas (points de survol), reel (bool), inflation (%),
 *       tensions (valeurs mois par mois) | null, exemples ([valeurs mois par mois]) | null, objectif (nombre) | null,
 *       moisPasses, infoSurvol(t) → html }
 */
function dessinerEventail(conteneur, o) {
  if (!conteneur) return;
  const L = Math.max(300, conteneur.clientWidth), etroit = L < 600;
  const H = etroit ? 280 : 380;
  const m = { g: etroit ? 46 : 58, d: etroit ? 10 : 118, h: 14, b: 30 };
  const deflate = t => o.reel ? Math.pow(1 + (o.inflation || 0) / 100, t / 12) : 1;
  const v = (serie, t) => serie[t] / deflate(t);
  let max = 0;
  for (let t = 0; t <= o.T; t++) max = Math.max(max, v(o.ev.p90, t), o.verse[t], o.tensions ? v(o.tensions, t) : 0);
  if (o.objectif) max = Math.max(max, o.objectif);
  const ech = echelleValeurs(max * 1.04, 0, etroit ? 4 : 6);
  const X = t => m.g + t / o.T * (L - m.g - m.d);
  const Y = val => m.h + (ech.max - val) / (ech.max - ech.min || 1) * (H - m.h - m.b);
  const pts = serie => { const r = []; for (let t = 0; t <= o.T; t++) r.push([X(t), Y(v(serie, t))]); return r; };
  const ptsBruts = serie => { const r = []; for (let t = 0; t <= o.T; t++) r.push([X(t), Y(serie[t])]); return r; };

  const grille = ech.ticks.map(t => `<line class="grille" x1="${m.g}" x2="${L - m.d}" y1="${Y(t)}" y2="${Y(t)}"/>
    <text class="axe" x="${m.g - 6}" y="${Y(t) + 4}" text-anchor="end">${eurosCourt(t)}</text>`).join("");
  // Axe des dates : années (ou mois pour les durées courtes)
  const reperes = [];
  const pasRepere = o.T <= 24 ? (o.T <= 12 ? 2 : 3) : Math.max(12, Math.ceil(o.T / 12 / (etroit ? 4 : 8)) * 12);
  for (let t = 0; t <= o.T; t += pasRepere) reperes.push(t);
  const axeX = reperes.map(t => `<text class="axe" x="${X(t)}" y="${H - 9}" text-anchor="middle">${o.T <= 24 ? esc(moisAnnee(dateDuMois(o.debut, t))) : dateDuMois(o.debut, t).getFullYear()}</text>`).join("");

  const bandeLarge = `<path class="bande bande-large" d="${cheminBande(pts(o.ev.p10), pts(o.ev.p90))}"/>`;
  const bandeEtroite = `<path class="bande bande-etroite" d="${cheminBande(pts(o.ev.p25), pts(o.ev.p75))}"/>`;
  const exemples = (o.exemples || []).map(s => `<path class="ligne-exemple" d="${cheminLigne(pts(s))}"/>`).join("");
  const verse = `<path class="ligne-verse" d="${cheminLigne(ptsBruts(o.verse))}"/>`;
  const tensions = o.tensions ? `<path class="ligne-tensions" d="${cheminLigne(pts(o.tensions))}"/>` : "";
  const mediane = `<path class="ligne-mediane" d="${cheminLigne(pts(o.ev.p50))}"/>`;
  const objectif = o.objectif ? `<line class="ligne-objectif" x1="${m.g}" x2="${L - m.d}" y1="${Y(o.objectif)}" y2="${Y(o.objectif)}"/>` : "";
  const aujourdhui = o.moisPasses > 0 && o.moisPasses < o.T ? `<line class="ligne-aujourdhui" x1="${X(o.moisPasses)}" x2="${X(o.moisPasses)}" y1="${m.h}" y2="${H - m.b}"/>
    <text class="axe" x="${X(o.moisPasses) + 4}" y="${m.h + 10}">aujourd'hui</text>` : "";
  // Étiquettes directes en bout de courbe (écran large)
  const etiquettes = etroit ? "" : [
    [v(o.ev.p90, o.T), "favorable", "10 % au-dessus"], [v(o.ev.p50, o.T), "mediane", "médiane"], [v(o.ev.p10, o.T), "defavorable", "10 % en dessous"], [o.verse[o.T], "verse", "versé"]
  ].sort((a, b) => b[0] - a[0]).reduce((acc, e) => {
    let y = Y(e[0]) + 4;
    if (acc.length && y - acc[acc.length - 1].y < 30) y = acc[acc.length - 1].y + 30;
    acc.push({ y, e }); return acc;
  }, []).map(({ y, e }) => `<text class="etiquette-fin etiquette-${e[1]}" x="${L - m.d + 8}" y="${y}"><tspan class="etiquette-valeur">${eurosCourt(e[0])}</tspan><tspan x="${L - m.d + 8}" dy="12">${e[2]}</tspan></text>`).join("");

  conteneur.innerHTML = `
    <svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Éventail des valeurs possibles de ton investissement sur ${dureeTexte(o.T)}">
      ${grille}${axeX}${bandeLarge}${bandeEtroite}${exemples}${verse}${tensions}${objectif}${mediane}${aujourdhui}${etiquettes}
      <g class="survol" visibility="hidden">
        <line class="curseur" y1="${m.h}" y2="${H - m.b}"/>
        <circle class="point point-mediane" r="5"/>
        <circle class="point point-verse" r="4"/>
      </g>
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg>
    <div class="bulle-simu" hidden></div>`;

  const points = [];
  for (let t = 0; t <= o.T; t += o.pas) points.push(t);
  if (points[points.length - 1] !== o.T) points.push(o.T);
  const g = conteneur.querySelector(".survol"), bulle = conteneur.querySelector(".bulle-simu");
  brancherSurvol(conteneur, conteneur.querySelector(".zone-survol"), points.map(X), i => {
    const t = points[i], x = X(t);
    g.setAttribute("visibility", "visible");
    g.querySelector(".curseur").setAttribute("x1", x); g.querySelector(".curseur").setAttribute("x2", x);
    const pm = g.querySelector(".point-mediane"); pm.setAttribute("cx", x); pm.setAttribute("cy", Y(v(o.ev.p50, t)));
    const pv = g.querySelector(".point-verse"); pv.setAttribute("cx", x); pv.setAttribute("cy", Y(o.verse[t]));
    bulle.innerHTML = o.infoSurvol(t);
    positionnerBulle(bulle, x, L, 0);
  }, () => { g.setAttribute("visibility", "hidden"); bulle.hidden = true; });
}

// ---------- Répartition des résultats (histogramme) ----------

function dessinerHistogramme(conteneur, valeurs, reperes) {
  if (!conteneur) return;
  const tri = Float64Array.from(valeurs).sort();
  const bas = quantileTrie(tri, 0.01), haut = quantileTrie(tri, 0.99);
  const nb = 32, largeurClasse = (haut - bas) / nb || 1;
  const classes = new Array(nb).fill(0);
  for (const x of tri) { if (x < bas || x > haut) continue; classes[Math.min(nb - 1, Math.floor((x - bas) / largeurClasse))]++; }
  const L = Math.max(300, conteneur.clientWidth), H = 210, m = { g: 12, d: 12, h: 40, b: 28 };
  const X = val => m.g + (val - bas) / (haut - bas || 1) * (L - m.g - m.d);
  const maxC = Math.max(...classes);
  const Y = c => m.h + (1 - c / maxC) * (H - m.h - m.b);
  const lb = (L - m.g - m.d) / nb;
  const barres = classes.map((c, i) => `<rect class="histo-barre" x="${(m.g + i * lb + 1).toFixed(1)}" y="${Y(c).toFixed(1)}" width="${Math.max(1, lb - 2).toFixed(1)}" height="${(H - m.b - Y(c)).toFixed(1)}" rx="2"/>`).join("");
  const marques = reperes.filter(r => r.valeur >= bas && r.valeur <= haut).sort((x, y) => x.valeur - y.valeur).map((r, k) => `
    <line class="histo-repere histo-${r.classe}" x1="${X(r.valeur)}" x2="${X(r.valeur)}" y1="${m.h - 6}" y2="${H - m.b}"/>
    <text class="axe histo-texte" x="${X(r.valeur)}" y="${k % 2 ? m.h - 20 : m.h - 8}" text-anchor="middle">${esc(r.nom)}</text>`).join("");
  const axe = graduations(bas, haut, L < 600 ? 3 : 6).filter(t => t >= bas && t <= haut)
    .map(t => `<text class="axe" x="${X(t)}" y="${H - 8}" text-anchor="middle">${eurosCourt(t)}</text>`).join("");
  conteneur.innerHTML = `<svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Répartition des valeurs finales des simulations">
      <line class="grille" x1="${m.g}" x2="${L - m.d}" y1="${H - m.b}" y2="${H - m.b}"/>${barres}${marques}${axe}
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg><div class="bulle-simu" hidden></div>`;
  const bulle = conteneur.querySelector(".bulle-simu");
  const xs = classes.map((_, i) => m.g + (i + 0.5) * lb);
  brancherSurvol(conteneur, conteneur.querySelector(".zone-survol"), xs, i => {
    conteneur.querySelectorAll(".histo-barre").forEach((b, k) => b.classList.toggle("active", k === i));
    bulle.innerHTML = `<strong>${pct(classes[i] / tri.length * 100, 1)}</strong> des simulations<br>entre ${eurosEstimes(bas + i * largeurClasse)} et ${eurosEstimes(bas + (i + 1) * largeurClasse)}`;
    positionnerBulle(bulle, xs[i], L, 0);
  }, () => { bulle.hidden = true; conteneur.querySelectorAll(".histo-barre.active").forEach(b => b.classList.remove("active")); });
}

// ---------- Barres année par année (trajectoire d'exemple) ----------

function barresAnnuelles(perfs, debutAnnee) {
  if (!perfs.length) return "";
  const max = Math.max(...perfs.map(Math.abs), 0.05);
  const etiquettes = perfs.length <= 12;
  return `<div class="barres-annees" role="img" aria-label="Performances année par année d'une trajectoire simulée : ${perfs.map(p => pctSigne(p, 0)).join(", ")}">
    ${perfs.map((p, i) => `<div class="barre-annee" title="Année ${debutAnnee + i} : ${pctSigne(p)}">
      <span class="barre-annee-haut">${p >= 0 ? `<span class="barre-annee-val">${etiquettes ? pctSigne(p, 0) : ""}</span><span class="barre-annee-plein hausse-fond" style="height:${(p / max * 100).toFixed(1)}%"></span>` : ""}</span>
      <span class="barre-annee-bas">${p < 0 ? `<span class="barre-annee-plein baisse-fond" style="height:${(-p / max * 100).toFixed(1)}%"></span><span class="barre-annee-val">${etiquettes ? pctSigne(p, 0) : ""}</span>` : ""}</span>
      <span class="barre-annee-an">${perfs.length <= 12 ? "an " + (i + 1) : (i + 1) % 5 === 0 ? i + 1 : ""}</span>
    </div>`).join("")}
  </div>`;
}

// ---------- Crise rejouée ----------

function dessinerCrise(conteneur, c, debut, avecReel) {
  if (!conteneur) return;
  const L = Math.max(300, conteneur.clientWidth), etroit = L < 600, H = etroit ? 240 : 300;
  const m = { g: etroit ? 46 : 58, d: 12, h: 12, b: 30 };
  const n = c.n;
  const max = Math.max(...c.valeurs, ...c.verse) * 1.05, min = Math.min(...c.valeurs, ...(avecReel ? c.reelles : []), 0);
  const ech = echelleValeurs(max, min > 0 ? 0 : min, etroit ? 4 : 5);
  const X = t => m.g + t / n * (L - m.g - m.d);
  const Y = v => m.h + (ech.max - v) / (ech.max - ech.min || 1) * (H - m.h - m.b);
  const ligne = s => cheminLigne(s.map((v, t) => [X(t), Y(v)]));
  const grille = ech.ticks.map(t => `<line class="grille" x1="${m.g}" x2="${L - m.d}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axe" x="${m.g - 6}" y="${Y(t) + 4}" text-anchor="end">${eurosCourt(t)}</text>`).join("");
  const pasRepere = n <= 36 ? 6 : 12;
  const axeX = [];
  for (let t = 0; t <= n; t += pasRepere) axeX.push(`<text class="axe" x="${X(t)}" y="${H - 9}" text-anchor="middle">${debut ? esc(moisAnnee(dateDuMois(debut, t))) : (t === 0 ? "départ" : "+" + dureeTexte(t))}</text>`);
  const zoneCrise = c.moisCrise ? `<rect class="zone-crise" x="${X(0)}" y="${m.h}" width="${X(c.moisCrise) - X(0)}" height="${H - m.h - m.b}"/>
    <text class="axe" x="${X(0) + 6}" y="${m.h + 14}">crise</text>` : "";
  conteneur.innerHTML = `<svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Évolution simulée de ton investissement pendant la crise">
      ${zoneCrise}${grille}${axeX.join("")}
      <path class="ligne-verse" d="${ligne(c.verse)}"/>
      ${avecReel ? `<path class="ligne-reelle" d="${ligne(c.reelles)}"/>` : ""}
      <path class="ligne-mediane" d="${ligne(c.valeurs)}"/>
      <g class="survol" visibility="hidden"><line class="curseur" y1="${m.h}" y2="${H - m.b}"/><circle class="point point-mediane" r="5"/></g>
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg><div class="bulle-simu" hidden></div>`;
  const g = conteneur.querySelector(".survol"), bulle = conteneur.querySelector(".bulle-simu");
  const xs = c.valeurs.map((_, t) => X(t));
  brancherSurvol(conteneur, conteneur.querySelector(".zone-survol"), xs, t => {
    g.setAttribute("visibility", "visible");
    g.querySelector(".curseur").setAttribute("x1", xs[t]); g.querySelector(".curseur").setAttribute("x2", xs[t]);
    const p = g.querySelector(".point-mediane"); p.setAttribute("cx", xs[t]); p.setAttribute("cy", Y(c.valeurs[t]));
    bulle.innerHTML = `<div class="bulle-date">${debut ? esc(moisAnnee(dateDuMois(debut, t))) : t === 0 ? "Départ" : "Après " + dureeTexte(t)}</div>
      <div class="bulle-ligne"><span>Valeur</span><strong>${eurosEstimes(c.valeurs[t])}</strong></div>
      <div class="bulle-ligne"><span>Total versé</span><strong>${euros(c.verse[t])}</strong></div>
      <div class="bulle-ligne"><span>Écart</span><strong class="${c.valeurs[t] >= c.verse[t] ? "hausse" : "baisse"}">${eurosSigne(c.valeurs[t] - c.verse[t])}</strong></div>
      ${avecReel ? `<div class="bulle-ligne"><span>En euros d'aujourd'hui</span><strong>${eurosEstimes(c.reelles[t])}</strong></div>` : ""}`;
    positionnerBulle(bulle, xs[t], L, 0);
  }, () => { g.setAttribute("visibility", "hidden"); bulle.hidden = true; });
}

// ---------- Objectif : rangs par année + objectif ----------

function dessinerObjectif(conteneur, o) { // o = { annees, p10, p50, p90, verse, cible (par an), debut }
  if (!conteneur) return;
  const L = Math.max(300, conteneur.clientWidth), etroit = L < 600, H = etroit ? 240 : 300;
  const m = { g: etroit ? 46 : 58, d: 12, h: 12, b: 30 };
  const N = o.annees;
  const max = Math.max(o.p90[N], o.cible[N], o.verse[N]) * 1.05;
  const ech = echelleValeurs(max, 0, etroit ? 4 : 5);
  const X = a => m.g + a / N * (L - m.g - m.d);
  const Y = v => m.h + (ech.max - Math.min(v, ech.max)) / (ech.max - ech.min || 1) * (H - m.h - m.b);
  const pts = s => s.slice(0, N + 1).map((v, a) => [X(a), Y(v)]);
  const grille = ech.ticks.map(t => `<line class="grille" x1="${m.g}" x2="${L - m.d}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axe" x="${m.g - 6}" y="${Y(t) + 4}" text-anchor="end">${eurosCourt(t)}</text>`).join("");
  const pasA = Math.max(1, Math.ceil(N / (etroit ? 4 : 8)));
  const axeX = [];
  for (let a = 0; a <= N; a += pasA) axeX.push(`<text class="axe" x="${X(a)}" y="${H - 9}" text-anchor="middle">${dateDuMois(o.debut, a * 12).getFullYear()}</text>`);
  conteneur.innerHTML = `<svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Trajectoires possibles par rapport à ton objectif">
      ${grille}${axeX.join("")}
      <path class="bande bande-large" d="${cheminBande(pts(o.p10), pts(o.p90))}"/>
      <path class="ligne-verse" d="${cheminLigne(pts(o.verse))}"/>
      <path class="ligne-objectif-courbe" d="${cheminLigne(pts(o.cible))}"/>
      <path class="ligne-mediane" d="${cheminLigne(pts(o.p50))}"/>
      <g class="survol" visibility="hidden"><line class="curseur" y1="${m.h}" y2="${H - m.b}"/><circle class="point point-mediane" r="5"/></g>
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg><div class="bulle-simu" hidden></div>`;
  const g = conteneur.querySelector(".survol"), bulle = conteneur.querySelector(".bulle-simu");
  const xs = Array.from({ length: N + 1 }, (_, a) => X(a));
  brancherSurvol(conteneur, conteneur.querySelector(".zone-survol"), xs, a => {
    g.setAttribute("visibility", "visible");
    g.querySelector(".curseur").setAttribute("x1", xs[a]); g.querySelector(".curseur").setAttribute("x2", xs[a]);
    const p = g.querySelector(".point-mediane"); p.setAttribute("cx", xs[a]); p.setAttribute("cy", Y(o.p50[a]));
    bulle.innerHTML = `<div class="bulle-date">${a === 0 ? "Départ" : `Dans ${a} an${a > 1 ? "s" : ""} (${dateDuMois(o.debut, a * 12).getFullYear()})`}</div>
      <div class="bulle-ligne"><span>Objectif</span><strong>${euros(o.cible[a])}</strong></div>
      <div class="bulle-ligne"><span>Scénario central</span><strong>${eurosEstimes(o.p50[a])}</strong></div>
      <div class="bulle-ligne"><span>8 chances sur 10</span><strong>${eurosCourt(o.p10[a])} – ${eurosCourt(o.p90[a])}</strong></div>
      <div class="bulle-ligne"><span>Total versé</span><strong>${euros(o.verse[a])}</strong></div>`;
    positionnerBulle(bulle, xs[a], L, 0);
  }, () => { g.setAttribute("visibility", "hidden"); bulle.hidden = true; });
}

// ---------- Comparaison : médianes de plusieurs fonds ----------

// options.passe : courbes du passé (dates réelles dans l'info-bulle, « montant investi » au lieu de « total versé »)
function dessinerMedianes(conteneur, series, T, debut, verse, options = {}) { // series = [{ nom, ev, couleur }]
  if (!conteneur) return;
  const L = Math.max(300, conteneur.clientWidth), etroit = L < 600, H = etroit ? 240 : 300;
  const m = { g: etroit ? 46 : 58, d: 12, h: 12, b: 30 };
  let max = verse[T];
  for (const s of series) for (let t = 0; t <= T; t++) max = Math.max(max, s.ev.p50[t]);
  const ech = echelleValeurs(max * 1.05, 0, etroit ? 4 : 5);
  const X = t => m.g + t / T * (L - m.g - m.d);
  const Y = v => m.h + (ech.max - v) / (ech.max - ech.min || 1) * (H - m.h - m.b);
  const pts = s => { const r = []; for (let t = 0; t <= T; t++) r.push([X(t), Y(s[t])]); return r; };
  const grille = ech.ticks.map(t => `<line class="grille" x1="${m.g}" x2="${L - m.d}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axe" x="${m.g - 6}" y="${Y(t) + 4}" text-anchor="end">${eurosCourt(t)}</text>`).join("");
  const pasRepere = T <= 24 ? 3 : Math.max(12, Math.ceil(T / 12 / (etroit ? 4 : 8)) * 12);
  const axeX = [];
  for (let t = 0; t <= T; t += pasRepere) axeX.push(`<text class="axe" x="${X(t)}" y="${H - 9}" text-anchor="middle">${T <= 24 ? esc(moisAnnee(dateDuMois(debut, t))) : dateDuMois(debut, t).getFullYear()}</text>`);
  conteneur.innerHTML = `<svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Scénario central de chaque fonds">
      ${grille}${axeX.join("")}
      <path class="ligne-verse" d="${cheminLigne(pts(verse))}"/>
      ${series.map(s => `<path class="ligne serie-${s.couleur}" d="${cheminLigne(pts(s.ev.p50))}"/>`).join("")}
      <g class="survol" visibility="hidden"><line class="curseur" y1="${m.h}" y2="${H - m.b}"/>${series.map(s => `<circle class="point serie-${s.couleur}" r="4.5"/>`).join("")}</g>
      <rect class="zone-survol" x="${m.g}" y="${m.h}" width="${L - m.g - m.d}" height="${H - m.h - m.b}"/>
    </svg><div class="bulle-simu" hidden></div>`;
  const g = conteneur.querySelector(".survol"), bulle = conteneur.querySelector(".bulle-simu");
  const points = []; for (let t = 0; t <= T; t += T <= 24 || options.passe ? 1 : 12) points.push(t);
  brancherSurvol(conteneur, conteneur.querySelector(".zone-survol"), points.map(X), i => {
    const t = points[i];
    g.setAttribute("visibility", "visible");
    g.querySelector(".curseur").setAttribute("x1", X(t)); g.querySelector(".curseur").setAttribute("x2", X(t));
    g.querySelectorAll(".point").forEach((c, k) => { c.setAttribute("cx", X(t)); c.setAttribute("cy", Y(series[k].ev.p50[t])); });
    bulle.innerHTML = `<div class="bulle-date">${options.passe ? esc(moisAnnee(dateDuMois(debut, t))) : t === 0 ? "Départ" : "Dans " + dureeTexte(t)}</div>
      ${series.map(s => `<div class="bulle-ligne"><span class="pastille-serie serie-${s.couleur}"></span><span class="bulle-nom">${esc(s.nom)}</span><strong>${options.passe ? euros(s.ev.p50[t]) : eurosEstimes(s.ev.p50[t])}</strong></div>`).join("")}
      <div class="bulle-valeur">${options.passe ? "Montant investi" : "Total versé"} : ${euros(verse[t])}</div>`;
    positionnerBulle(bulle, X(t), L, 0);
  }, () => { g.setAttribute("visibility", "hidden"); bulle.hidden = true; });
}

// Fourchettes (rang 10 % – rang 90 %) et médiane par horizon, pour chaque fonds
function fourchettesHorizons(horizons, series) { // series = [{ nom, couleur, parHorizon: { h: { p10, p50, p90, verse } } }]
  let max = 0;
  for (const s of series) for (const h of horizons) if (s.parHorizon[h]) max = Math.max(max, s.parHorizon[h].p90);
  return `<div class="fourchettes">${horizons.map(h => `
    <div class="fourchette-groupe"><div class="fourchette-titre">${h} an${h > 1 ? "s" : ""}</div>
      ${series.map(s => { const x = s.parHorizon[h]; if (!x) return ""; return `
        <div class="fourchette-ligne" title="${esc(s.nom)} à ${h} ans : entre ${eurosEstimes(x.p10)} et ${eurosEstimes(x.p90)}, médiane ${eurosEstimes(x.p50)}">
          <span class="fourchette-nom"><span class="pastille-serie serie-${s.couleur}"></span>${esc(s.nomCourt || s.nom)}</span>
          <span class="fourchette-piste">
            <span class="fourchette-verse" style="left:${(x.verse / max * 100).toFixed(1)}%"></span>
            <span class="fourchette-barre serie-fond-${s.couleur}" style="left:${(x.p10 / max * 100).toFixed(1)}%;width:${((x.p90 - x.p10) / max * 100).toFixed(1)}%"></span>
            <span class="fourchette-mediane" style="left:${(x.p50 / max * 100).toFixed(1)}%"></span>
          </span>
          <span class="fourchette-valeur">${eurosCourt(x.p50)}</span>
        </div>`; }).join("")}
    </div>`).join("")}
    <p class="legende-seuil"><span class="repere" aria-hidden="true"></span> trait fin : total versé · barre : 8 chances sur 10 · point : scénario central</p>
  </div>`;
}

// ---------- Corrélations ----------

function carteCorrelations(noms, corr) {
  const n = noms.length;
  return `<div class="correlations" style="grid-template-columns: minmax(90px, 1.4fr) repeat(${n}, minmax(48px, 1fr))">
    <span></span>${noms.map((x, j) => `<span class="corr-entete" title="${esc(x)}">${j + 1}</span>`).join("")}
    ${noms.map((x, i) => `<span class="corr-nom" title="${esc(x)}">${i + 1}. ${esc(x)}</span>${corr[i].map((c, j) => {
      const intensite = Math.min(1, Math.abs(c));
      return `<span class="corr-case${i === j ? " corr-diag" : ""}" style="--intensite:${intensite.toFixed(2)}" title="Corrélation ${esc(noms[i])} / ${esc(noms[j])} : ${c.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}">${c.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
    }).join("")}`).join("")}
  </div>`;
}

// ---------- Mini-courbe d'un indicateur ----------

function miniCourbe(serie) {
  if (!serie || serie.length < 3) return "";
  const vals = serie.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const L = 96, H = 28;
  const pts = vals.map((v, i) => [2 + i / (vals.length - 1) * (L - 6), 3 + (max - v) / (max - min || 1) * (H - 6)]);
  const der = pts[pts.length - 1];
  return `<svg class="mini-courbe" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" aria-hidden="true"><path d="${cheminLigne(pts)}"/><circle cx="${der[0]}" cy="${der[1]}" r="3"/></svg>`;
}

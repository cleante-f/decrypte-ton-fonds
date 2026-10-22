/*
 * Pages fixes des fonds, pour que Google les trouve : fonds/<nom>-<ISIN>.html, classements/*.html, sitemap.xml et sitemap-N.xml.
 *
 * Chaque page de fonds est faite à partir de decrypte.html (lu à chaque lancement) : même mise en page, mêmes scripts (chemins
 * en « ../ »), plus un résumé fixe (identité et chiffres du DIC, data/resumes.js) et le réglage FICHE_FIXE qui ouvre ce fonds
 * sans « # ». Les fonds qui ont une page et leur adresse viennent de js/adresses.js, chargé avec node:vm comme le fait le site.
 *
 * Une page n'est réécrite que si son contenu change ; les pages des fonds sortis de l'annuaire sont supprimées.
 * data/resumes.js peut manquer : les pages n'ont alors que l'identité des fonds.
 *
 * Usage : node scripts/construire_pages.mjs
 */
import vm from "node:vm";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASE = "https://cleante-f.github.io/decrypte-ton-fonds/";
const MAX_SITEMAP = 50000;
// Pages principales du site déclarées dans le plan du site ("" = accueil)
const PAGES_PRINCIPALES = ["", "decrypte.html", "performances.html", "simulateur.html", "confidentialite.html", "mentions-legales.html"];
const SOURCE_DIC = "AMF – DIC (base GECO)";

// ---------- Code du site : PAYS (js/geco.js), indiceDuNom (js/style.js), fonds qui ont une page et leurs adresses (js/adresses.js) ----------
const site = vm.createContext({ console });
for (const f of ["js/geco.js", "js/style.js", "js/adresses.js"]) vm.runInContext(readFileSync(join(RACINE, f), "utf8"), site, { filename: f });
const [PAYS, indiceDuNom, slugFonds, adresseFonds, fondsDesPagesSite] =
  ["PAYS", "indiceDuNom", "slugFonds", "adresseFonds", "fondsDesPages"].map(n => vm.runInContext(n, site));

// ---------- Outils de texte ----------
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateFr = iso => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const pctFr = x => `${String(Math.round(x * 100) / 100).replace(".", ",")} %`;
const aDesFrais = x => typeof x === "number" && isFinite(x);
const aUnSri = x => Number.isInteger(x) && x >= 1 && x <= 7;
const lettreDe = nom => { const c = slugFonds(nom)[0]; return /[a-z]/.test(c) ? c : "0-9"; };
const cheminIndice = indice => `classements/indice-${slugFonds(indice)}.html`;
const cheminCategorie = cat => `classements/categorie-${slugFonds(cat)}.html`;
const cheminLettre = lettre => `classements/lettre-${lettre}.html`;
const CHEMIN_PEA = "classements/etf-pea.html";
const estPea = e => /\bPEA\b/i.test(e.nom);

// Fonds qui ont une page : une seule par ISIN (celui de la première part), celle de la ligne que le site ouvre pour cet ISIN
// (même règle que le navigateur : fondsDesPages de js/adresses.js)
export function fondsDesPages(annuaire) {
  return [...fondsDesPagesSite(annuaire)];
}

// Nom affiché par page (titre, h1) : ISIN de la première part → nom. Un nom porté par plusieurs pages (à la casse près : noms
// génériques du registre FIRDS, fonds homonymes) est suivi de « (ISIN) », pour que chaque page ait un titre différent.
export function nomsDesPages(fonds) {
  const cle = e => e.nom.trim().toLowerCase();
  const nb = new Map();
  for (const e of fonds) nb.set(cle(e), (nb.get(cle(e)) || 0) + 1);
  return new Map(fonds.map(e => [e.isins[0], nb.get(cle(e)) > 1 ? `${e.nom} (${e.isins[0]})` : e.nom]));
}

// Frais des fonds indiciels (data/alternatives.js) : ISIN → { frais, dateDic, releve }
export function fraisAlternatives(alternatives) {
  const res = {};
  for (const lignes of Object.values((alternatives && alternatives.indices) || {}))
    for (const [, isin, , frais, , , dateDic] of lignes)
      if (aDesFrais(frais) && !res[isin]) res[isin] = { frais, dateDic: dateDic || "", releve: alternatives.maj || "" };
  return res;
}

// Chiffres d'un fonds : résumé du DIC (data/resumes.js : [frais, sri, durée, objectif, dateDic, dateLecture]) sinon frais des alternatives
function chiffres(resume, alternative) {
  const r = Array.isArray(resume) ? resume : [];
  const c = { frais: aDesFrais(r[0]) ? r[0] : null, sri: aUnSri(r[1]) ? r[1] : null, duree: r[2] || "", objectif: r[3] || "",
    sources: [] };
  if (c.frais !== null || c.sri !== null || c.duree || c.objectif) c.sources.push({ releve: r[5] || "", dateDic: r[4] || "" });
  if (c.frais === null && alternative && aDesFrais(alternative.frais)) {
    c.frais = alternative.frais;
    c.sources.push({ releve: alternative.releve || "", dateDic: alternative.dateDic || "", fraisSeuls: c.sources.length > 0 });
  }
  return c;
}

const texteSource = s => `Source : ${SOURCE_DIC}${s.releve ? `, relevé du ${dateFr(s.releve)}` : ""}${s.dateDic ? ` (DIC du ${dateFr(s.dateDic)})` : ""}${s.fraisSeuls ? " pour les frais" : ""}.`;

// Titre : « <Nom> : frais X %, risque N/7 · Décrypte ton fonds », parties absentes omises (texte brut, échappé ensuite)
function titreFonds(nom, c) {
  const parties = [c.frais !== null ? `frais ${pctFr(c.frais)}` : "", c.sri !== null ? `risque ${c.sri}/7` : ""].filter(Boolean);
  return `${nom}${parties.length ? ` : ${parties.join(", ")}` : ""} · Décrypte ton fonds`;
}

function descriptionFonds(e, c) {
  const type = e.etf ? "ETF" : "Fonds";
  const qui = [e.source === "G" && e.classification ? `de la catégorie AMF « ${e.classification} »` : "",
    e.gestionnaire ? `géré par ${e.gestionnaire}` : ""].filter(Boolean).join(", ");
  const chiffresTexte = [c.frais !== null ? `frais courants ${pctFr(c.frais)}` : "", c.sri !== null ? `risque ${c.sri}/7` : "",
    c.duree ? `durée conseillée ${c.duree}` : ""].filter(Boolean).join(", ");
  return `${e.nom} (${e.isins[0]}) : ${type.toLowerCase()}${qui ? ` ${qui}` : ""}.${chiffresTexte ? ` ${chiffresTexte[0].toUpperCase()}${chiffresTexte.slice(1)}.` : ""}`
    + " Résumé du DIC et analyse gratuite : où est investi le fonds, ses risques et ses frais.";
}

// Classements utiles pour un fonds : [chemin, texte]
function classementsDuFonds(e) {
  const indice = indiceDuNom(e.nom);
  const lettre = lettreDe(e.nom);
  return [
    e.etf && estPea(e) ? [CHEMIN_PEA, "ETF éligibles au PEA, par frais"] : null,
    indice ? [cheminIndice(indice), `Fonds qui suivent l'indice ${indice}`] : null,
    e.source === "G" && e.classification ? [cheminCategorie(e.classification), `Catégorie AMF « ${e.classification} »`] : null,
    [cheminLettre(lettre), `Fonds de ${lettre === "0-9" ? "0 à 9" : lettre.toUpperCase()}`]
  ].filter(Boolean);
}

// ---------- Gabarit : decrypte.html ----------
const lireGabarit = () => readFileSync(join(RACINE, "decrypte.html"), "utf8");

// Chemins relatifs des balises (src, href, data-page) précédés de « ../ » : la page est rangée un dossier plus bas.
// Les adresses absolues, les ancres (#…) et les chemins déjà remontés ne bougent pas. Guillemets doubles ou simples acceptés.
function remonter(html) {
  return html.replace(/<[^>]+>/g, balise => balise.replace(/\b(src|href|data-page)=(["'])(.*?)\2/g, (m, attr, q, val) =>
    (!val || /^(#|\/|\.\.\/|[a-z][a-z0-9+.-]*:)/i.test(val) ? m : `${attr}=${q}../${val}${q}`)));
}

// Remplace le titre et la description, ajoute l'adresse canonique
function entete(html, titre, description, canonique) {
  // Remplacements par des fonctions : un « $& » ou « $' » dans un nom de fonds ne doit pas être interprété par String.replace
  let h = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(titre)}</title>`);
  h = h.replace(/<meta name="description" content="[^"]*">/,
    () => `<meta name="description" content="${esc(description)}">\n  <link rel="canonical" href="${esc(canonique)}">`);
  return h;
}

// Remplacement littéral (sans motifs « $ » dans le texte inséré)
const remplacer = (texte, cherche, par) => {
  const i = texte.indexOf(cherche);
  if (i < 0) throw new Error(`gabarit : « ${cherche} » introuvable dans decrypte.html`);
  return texte.slice(0, i) + par + texte.slice(i + cherche.length);
};

function resumeFixe(e, c, nomPage) {
  const indice = indiceDuNom(e.nom);
  const infos = [
    ["ISIN", e.isins[0]],
    ["Société de gestion", e.gestionnaire],
    ["Catégorie AMF", e.source === "G" ? e.classification : ""],
    ["Type", e.etf ? "ETF (fonds indiciel coté)" : "Fonds"],
    ["Indice suivi (d'après le nom)", indice || ""],
    ["Pays", e.pays ? PAYS[e.pays] || e.pays : ""],
    ["Création", dateFr(e.dateCreation)],
    ["PEA", estPea(e) ? "Éligible au PEA (d'après le nom)" : ""],
    ["Frais courants", c.frais !== null ? `${pctFr(c.frais)} par an` : ""],
    ["Risque (SRI)", c.sri !== null ? `${c.sri}/7` : ""],
    ["Durée de détention conseillée", c.duree]
  ].filter(([, v]) => v);
  const liens = classementsDuFonds(e).map(([chemin, texte]) => `<li><a href="../${esc(chemin)}">${esc(texte)}</a></li>`).join("");
  return `<section class="fiche-entete resume-fixe" aria-label="Résumé du fonds">
      <h1>${esc(nomPage)}</h1>
      <dl class="grille-infos">${infos.map(([t, v]) => `<div><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
${c.objectif ? `      <p><strong>Objectif (extrait du DIC) :</strong> ${esc(c.objectif)}</p>\n` : ""}${c.sources.map(s => `      <p class="source">${esc(texteSource(s))}</p>\n`).join("")}      <p><strong>Classements :</strong></p>
      <ul>${liens}</ul>
    </section>

    `;
}

// Page d'un fonds. extras : { gabarit (decrypte.html), base, alternative ({ frais, dateDic, releve } de data/alternatives.js),
// nomPage (nom du titre et du h1, nomsDesPages : e.nom suivi de « (ISIN) » s'il n'est pas unique) }
export function pageFonds(e, resume, extras = {}) {
  const { gabarit = lireGabarit(), base = BASE, alternative = null, nomPage = e.nom } = extras;
  const c = chiffres(resume, alternative);
  let html = entete(remonter(gabarit), titreFonds(nomPage, c), descriptionFonds(e, c), base + adresseFonds(e));
  // Un seul titre principal : le nom du fonds ; la recherche passe en sous-titre
  html = html.replace(/<h1>([^<]*)<\/h1>/, (m, texte) => `<h2>${texte}</h2>`);
  html = remplacer(html, '<div id="resultat"', resumeFixe(e, c, nomPage) + '<div id="resultat"');
  html = remplacer(html, '<script src="../js/app.js"></script>',
    `<script>var FICHE_FIXE = ${JSON.stringify(e.isins[0])};</script>\n  <script src="../js/app.js"></script>`);
  return html;
}

// Pages de tous les fonds, une à une (pour ne pas garder 13 000 pages en mémoire) : { e, chemin, html, resume }.
// resumes : RESUMES (data/resumes.js) ou null ; alternatives : fraisAlternatives(…)
export function* pagesDesFonds(fonds, resumes, alternatives, { gabarit = lireGabarit(), base = BASE } = {}) {
  const noms = nomsDesPages(fonds);
  for (const e of fonds) {
    const isin = e.isins[0];
    const resume = resumes && resumes.fonds && resumes.fonds[isin];
    yield { e, chemin: adresseFonds(e), resume,
      html: pageFonds(e, resume, { gabarit, base, alternative: alternatives && alternatives[isin], nomPage: noms.get(isin) }) };
  }
}

// ---------- Classements ----------

// Page simple : en-tête, pied de page et scripts de navigation de decrypte.html, contenu donné
function pageSimple(gabarit, base, chemin, titre, description, contenu) {
  const g = remonter(gabarit);
  const tete = g.slice(0, g.indexOf("<body>"));
  const header = g.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].replace(/ aria-current="page"/g, "");
  const footer = g.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  const scripts = ["outils", "config-compte", "compte", "nav", "createur"].map(s => `  <script src="../js/${s}.js"></script>`).join("\n");
  return `${entete(tete, titre, description, base + chemin)}<body>
  ${header}

  <main class="page-texte classement">
    ${contenu}
  </main>

  ${footer}

${scripts}
</body>
</html>
`;
}

const parFrais = (a, b) => (a.c.frais === null) - (b.c.frais === null) || (a.c.frais ?? 0) - (b.c.frais ?? 0) || a.e.nom.localeCompare(b.e.nom, "fr");
const parNom = (a, b) => a.e.nom.localeCompare(b.e.nom, "fr") || a.e.isins[0].localeCompare(b.e.isins[0]);

function tableau(liste) {
  const lignes = liste.map(({ e, c }) => `<tr><td><a href="../${esc(adresseFonds(e))}">${esc(e.nom)}</a></td><td>${esc(e.isins[0])}</td>`
    + `<td>${c.frais !== null ? esc(pctFr(c.frais)) : "n.d."}</td><td>${c.sri !== null ? `${c.sri}/7` : "n.d."}</td></tr>`).join("\n");
  return `<table class="tableau-texte"><thead><tr><th scope="col">Fonds</th><th scope="col">ISIN</th><th scope="col">Frais courants</th>`
    + `<th scope="col">Risque (SRI)</th></tr></thead>\n<tbody>\n${lignes}\n</tbody></table>`;
}

// maj : date de relevé des chiffres (RESUMES.maj), omise si inconnue
const avertissement = maj => `<p class="note">Classement d'après les frais courants publiés dans les DIC (${SOURCE_DIC})${dateFr(maj) ? `, chiffres relevés au ${dateFr(maj)}` : ""}. Ce n'est ni un conseil, ni une recommandation : vérifie le DIC avant d'investir. « n.d. » : chiffre non disponible dans nos sources.</p>`;

// Toutes les pages de classement : { chemin: html }. fonds : entrées (fondsDesPages) ; resumes : RESUMES ; alternatives : fraisAlternatives(…)
export function pagesClassement(fonds, resumes, alternatives, { gabarit = lireGabarit(), base = BASE } = {}) {
  const tous = fonds.map(e => ({ e, c: chiffres(resumes && resumes.fonds && resumes.fonds[e.isins[0]], alternatives && alternatives[e.isins[0]]) }));
  const pages = {};
  const AVERTISSEMENT = avertissement(resumes && resumes.maj);
  const page = (chemin, titre, description, contenu) => {
    pages[chemin] = pageSimple(gabarit, base, chemin, `${titre} · Décrypte ton fonds`, description,
      `<p><a href="index.html">Tous les classements</a></p>\n    <h1>${esc(titre)}</h1>\n    ${contenu}`);
  };
  const grouper = (liste, cle) => {
    const g = new Map();
    for (const x of liste) { const k = cle(x); if (k) { if (!g.has(k)) g.set(k, []); g.get(k).push(x); } }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b, "fr"));
  };

  // (1) ETF éligibles au PEA, par indice puis par frais
  const pea = tous.filter(x => x.e.etf && estPea(x.e));
  const peaParIndice = grouper(pea, x => indiceDuNom(x.e.nom) || "Autres indices")
    .sort(([a], [b]) => (a === "Autres indices") - (b === "Autres indices") || a.localeCompare(b, "fr"));
  if (pea.length) page(CHEMIN_PEA, "ETF éligibles au PEA, classés par frais", "ETF éligibles au PEA (d'après leur nom), regroupés par indice et classés par frais courants.",
    `${AVERTISSEMENT}\n${peaParIndice.map(([indice, l]) => `<h2>${esc(indice)}</h2>\n${tableau(l.sort(parFrais))}`).join("\n")}`);

  // (2) Une page par indice
  const indices = grouper(tous, x => indiceDuNom(x.e.nom));
  for (const [indice, l] of indices)
    page(cheminIndice(indice), `Fonds qui suivent l'indice ${indice}`, `Fonds et ETF qui suivent l'indice ${indice} (d'après leur nom), classés par frais courants.`,
      `${AVERTISSEMENT}\n${tableau(l.sort(parFrais))}`);

  // (3) Une page par catégorie AMF (fonds français)
  const categories = grouper(tous.filter(x => x.e.source === "G"), x => x.e.classification);
  for (const [cat, l] of categories)
    page(cheminCategorie(cat), `Catégorie AMF « ${cat} »`, `Fonds de la catégorie AMF « ${cat} » ouverts à tous, classés par frais courants, avec leur niveau de risque.`,
      `${AVERTISSEMENT}\n${tableau(l.sort(parFrais))}`);

  // (4) Index de A à Z
  const lettres = grouper(tous, x => lettreDe(x.e.nom));
  for (const [lettre, l] of lettres) {
    const nomLettre = lettre === "0-9" ? "0 à 9" : lettre.toUpperCase();
    page(cheminLettre(lettre), `Fonds de ${nomLettre}`, `Tous les fonds dont le nom commence par ${nomLettre}.`,
      `<ul>\n${l.sort(parNom).map(({ e }) => `<li><a href="../${esc(adresseFonds(e))}">${esc(e.nom)}</a> (${esc(e.isins[0])})</li>`).join("\n")}\n</ul>`);
  }

  // Sommaire
  const lien = (chemin, texte) => `<li><a href="${esc(chemin.replace("classements/", ""))}">${esc(texte)}</a></li>`;
  pages["classements/index.html"] = pageSimple(gabarit, base, "classements/index.html", "Classements des fonds · Décrypte ton fonds",
    "Classements des fonds et ETF : ETF éligibles au PEA par frais, fonds par indice, par catégorie AMF et de A à Z.",
    `<h1>Classements des fonds</h1>
    ${pea.length ? `<h2>ETF éligibles au PEA</h2>\n    <ul>${lien(CHEMIN_PEA, "ETF éligibles au PEA, classés par frais")}</ul>` : ""}
    <h2>Par indice</h2>
    <ul>${indices.map(([i]) => lien(cheminIndice(i), i)).join("")}</ul>
    <h2>Par catégorie AMF</h2>
    <ul>${categories.map(([cat]) => lien(cheminCategorie(cat), cat)).join("")}</ul>
    <h2>De A à Z</h2>
    <ul>${lettres.map(([l]) => lien(cheminLettre(l), l === "0-9" ? "0 à 9" : l.toUpperCase())).join("")}</ul>`);
  return pages;
}

// ---------- Plan du site ----------

// adresses : chemins relatifs à la racine ("" = accueil) ou { chemin, lastmod }. Retourne { "sitemap.xml": index, "sitemap-N.xml": … }
export function sitemaps(adresses, base = BASE, max = MAX_SITEMAP) {
  const xml = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const liste = adresses.map(a => (typeof a === "string" ? { chemin: a } : a));
  const res = {}, fichiers = [];
  for (let i = 0; i < Math.max(1, Math.ceil(liste.length / max)); i++) {
    const morceau = liste.slice(i * max, (i + 1) * max);
    const nom = `sitemap-${i + 1}.xml`;
    res[nom] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + morceau.map(a => `<url><loc>${xml(base + a.chemin)}</loc>${a.lastmod ? `<lastmod>${xml(a.lastmod)}</lastmod>` : ""}</url>\n`).join("")
      + "</urlset>\n";
    const dates = morceau.map(a => a.lastmod).filter(Boolean).sort();
    fichiers.push({ nom, lastmod: dates[dates.length - 1] });
  }
  res["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + fichiers.map(f => `<sitemap><loc>${xml(base + f.nom)}</loc>${f.lastmod ? `<lastmod>${xml(f.lastmod)}</lastmod>` : ""}</sitemap>\n`).join("")
    + "</sitemapindex>\n";
  return res;
}

// ---------- Fichiers ----------

// Écrit le fichier seulement si son contenu change (dossiers créés au besoin). Retourne vrai s'il a été écrit.
export function ecrireSiChange(chemin, contenu) {
  if (existsSync(chemin) && readFileSync(chemin, "utf8") === contenu) return false;
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu);
  return true;
}

// Supprime les fichiers du dossier qui correspondent au motif et ne sont pas gardés (noms de fichiers). Retourne les noms supprimés.
export function supprimerDisparues(dossier, gardees, motif = /\.html$/) {
  if (!existsSync(dossier)) return [];
  const supprimees = readdirSync(dossier).filter(n => motif.test(n) && !gardees.has(n)).sort();
  for (const n of supprimees) unlinkSync(join(dossier, n));
  return supprimees;
}

function lireConstante(fichier, nom) {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(fichier, "utf8"), ctx, { filename: fichier });
  return vm.runInContext(nom, ctx);
}

function principal() {
  const annuaire = lireConstante(join(RACINE, "data/annuaire.js"), "ANNUAIRE");
  const dateAnnuaire = lireConstante(join(RACINE, "data/annuaire.js"), "ANNUAIRE_DATE");
  const fichierResumes = join(RACINE, "data/resumes.js");
  const resumes = existsSync(fichierResumes) ? lireConstante(fichierResumes, "RESUMES") : null;
  if (!resumes) console.log("::warning::data/resumes.js absent : les pages n'ont que l'identité des fonds");
  const alternatives = fraisAlternatives(lireConstante(join(RACINE, "data/alternatives.js"), "ALTERNATIVES"));
  const gabarit = lireGabarit();

  const fonds = fondsDesPages(annuaire);
  let ecrites = 0;
  const gardees = new Set(), adresses = PAGES_PRINCIPALES.map(chemin => ({ chemin, lastmod: dateAnnuaire }));
  for (const { chemin, html, resume } of pagesDesFonds(fonds, resumes, alternatives, { gabarit })) {
    if (ecrireSiChange(join(RACINE, chemin), html)) ecrites++;
    gardees.add(chemin.slice("fonds/".length));
    adresses.push({ chemin, lastmod: [dateAnnuaire, resume && resume[5]].filter(Boolean).sort().pop() });
  }
  const supprimees = supprimerDisparues(join(RACINE, "fonds"), gardees);

  const classements = pagesClassement(fonds, resumes, alternatives, { gabarit });
  let ecritsClassements = 0;
  for (const [chemin, html] of Object.entries(classements)) {
    if (ecrireSiChange(join(RACINE, chemin), html)) ecritsClassements++;
    adresses.push({ chemin, lastmod: (resumes && resumes.maj) || dateAnnuaire });
  }
  const classementsSupprimes = supprimerDisparues(join(RACINE, "classements"),
    new Set(Object.keys(classements).map(c => c.slice("classements/".length))));

  const plans = sitemaps(adresses);
  for (const [nom, xml] of Object.entries(plans)) ecrireSiChange(join(RACINE, nom), xml);
  supprimerDisparues(RACINE, new Set(Object.keys(plans)), /^sitemap-\d+\.xml$/);

  console.log(`${fonds.length} pages de fonds (${ecrites} écrites, ${supprimees.length} supprimées), `
    + `${Object.keys(classements).length} classements (${ecritsClassements} écrits, ${classementsSupprimes.length} supprimés), `
    + `${Object.keys(plans).length} fichiers sitemap`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { principal(); } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
}

/*
 * Frais des fonds indiciels de droit français (base GECO de l'AMF) → data/alternatives.js, pour la section
 * « Alternative moins chère » de la fiche (js/alternatives.js). Lancé chaque mois par .github/workflows/alternatives.yml.
 *
 * Script Node (et non Python) : il lit les DIC (PDF) avec pdf.js, déjà hébergé avec le site (js/vendor/pdfjs), et réutilise
 * extraireDic de js/geco.js et indiceDuNom de js/style.js : un seul code d'extraction pour le site et pour ce script.
 * Aucune dépendance à installer : modules intégrés de Node et pdf.js du site.
 *
 * Candidats : lignes « G » de data/annuaire.js ouvertes à tous, avec un ISIN, dont le nom désigne un indice connu, sans levier,
 * inverse, couverture… (mêmes exclusions que trouverJumeau), sans les fonds HSBC (données interdites sans accord écrit).
 * Pour chacun : liste des documents GECO, DIC le plus récent. Beaucoup de sociétés (Amundi, BNP Paribas…) ne publient pas le DIC
 * à part sur GECO mais en tête du prospectus, un DIC par part : on lit alors celui de la part de référence (premier ISIN).
 *
 * Usage : node scripts/construire_alternatives.mjs
 */
import vm from "node:vm";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const GECO_API = "https://geco.amf-france.org/back-office";
const UA = "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)";
const PAUSE_MS = 500;            // politesse envers GECO, entre deux fonds
const PAGES_MAX = 40;            // pages lues au plus dans un prospectus (les DIC sont au début)
const PAGES_DIC = 4;             // un DIC tient en 3 pages (4 au plus)
const ENTETE = "/* Généré par scripts/construire_alternatives.mjs — ne pas modifier à la main.\n * Source : AMF – DIC (base GECO). */\n";

// ---------- Code du site : extraireDic (js/geco.js), indiceDuNom et exclusions de trouverJumeau (js/style.js) ----------

const site = vm.createContext({ console });
for (const f of ["js/geco.js", "js/style.js"]) vm.runInContext(readFileSync(join(RACINE, f), "utf8"), site, { filename: f });
const indiceDuNom = vm.runInContext("indiceDuNom", site);
const extraireDicSite = vm.runInContext("extraireDic", site);
// La liste des exclusions est écrite dans trouverJumeau : on la relit dans js/style.js plutôt que de la recopier
const sourceExclus = readFileSync(join(RACINE, "js/style.js"), "utf8").match(/const exclus = (\/.+\/i);/);
if (!sourceExclus) throw new Error("exclusions de trouverJumeau introuvables dans js/style.js");
const EXCLUS = vm.runInContext(sourceExclus[1], site);

export function extraireDic(texte) { return extraireDicSite(texte); }

// ---------- Fonctions pures ----------

// Lignes de l'annuaire : [source, cmpId, prdId, nom, gestionnaire, classification, nature, isins, date, pays, tickers, marchés, devise, etf, public]
export function candidats(annuaire) {
  const res = [];
  for (const l of annuaire) {
    // FCPE : épargne salariale, réservée aux salariés des entreprises adhérentes
    if (l[0] !== "G" || l[14] !== 1 || !l[7] || /FCPE/i.test(l[6])) continue;
    const indice = indiceDuNom(l[3]);
    if (!indice || EXCLUS.test(l[3]) || /HSBC/i.test(l[4])) continue;
    const isin = l[7].split(" ")[0];
    res.push({ cle: isin, isin, nom: l[3], indice, cmpId: l[1], prdId: l[2], pea: /\bPEA\b/.test(l[3]) ? 1 : 0, etf: l[13] === 1 ? 1 : 0 });
  }
  return res;
}

// Frais courants (% par an) = frais de gestion + coûts de transaction, comme sur la fiche (js/fiche-auto.js)
export function fraisCourants(dic) {
  if (!dic || dic.gestion === null || dic.gestion === undefined) return null;
  return Math.round((dic.gestion + (dic.transaction || 0)) * 10000) / 10000;
}

// Document à lire : DIC le plus récent (celui dont le nom porte l'ISIN de la part d'abord), sinon le prospectus le plus récent
export function choisirDocument(documents, isin) {
  const recents = [...documents].sort((a, b) => (b.dateEffet || "").localeCompare(a.dateEffet || ""));
  // « DIC », « DICI », « KID », « KIID » comme mots (pas « indice », « periodic »…) ; « _ » et les chiffres séparent les mots
  const dics = recents.filter(d => /(?:^|[^a-z])(?:DICI?|KIID?)(?![a-z])/i.test(d.docTypeLib + " " + d.docName));
  return dics.find(d => (d.docName || "").includes(isin)) || dics[0] || recents.find(d => /prospectus/i.test(d.docTypeLib)) || null;
}

// Texte du DIC d'une part, à partir du texte des pages d'un PDF (un DIC seul, ou un prospectus qui en regroupe plusieurs).
// Un DIC commence par sa phrase réglementaire d'introduction en haut de page (le titre « Document d'informations clés » ne suffit
// pas : certains le répètent en haut de chaque page). On garde celui qui cite l'ISIN de la part, sinon rien (pas les frais d'une autre part).
const DEBUT_DIC = /(?:Le pr[ée]sent|Ce) document (?:vous )?(?:contient|fournit) des informations essentielles|This document provides you with key information/i;
export function sectionDic(pages, isin) {
  const debuts = pages.map((p, i) => DEBUT_DIC.test(p.trim().slice(0, 600)) ? i : -1).filter(i => i >= 0);
  const sections = debuts.map((d, k) => pages.slice(d, Math.min(debuts[k + 1] ?? pages.length, d + PAGES_DIC)).map(p => p + "\n").join(""));
  return sections.find(s => s.includes(isin)) || null;
}

// lireDic(candidat) → { texte, date } ou null. Une entrée par fonds (clé = ISIN de la première part), triée par frais croissants.
// HTTP 418 (maintenance de GECO) : tout s'arrête ; une autre erreur écarte seulement le fonds.
export async function construire(annuaire, lireDic) {
  const indices = {}, vus = new Set();
  for (const c of candidats(annuaire)) {
    if (vus.has(c.cle)) continue;
    vus.add(c.cle);
    let lu;
    try { lu = await lireDic(c); } catch (e) {
      if (e.maintenance) throw e;
      console.warn(`${c.nom} (${c.cle}) : ${e.message}`);
      continue;
    }
    const frais = lu ? fraisCourants(extraireDic(lu.texte)) : null;
    if (frais === null) { console.warn(`${c.nom} (${c.cle}) : frais non lus`); continue; }
    (indices[c.indice] ||= []).push([c.cle, c.isin, c.nom, frais, c.pea, c.etf, lu.date || ""]);
  }
  for (const liste of Object.values(indices)) liste.sort((a, b) => a[3] - b[3] || a[2].localeCompare(b[2]));
  return { indices };
}

// Écrit alternatives.js dans le dossier donné (data/ du site) : un fonds par ligne, pour des différences lisibles
export function ecrire(contenu, dossier) {
  const blocs = Object.entries(contenu.indices).map(([indice, liste]) =>
    `    ${JSON.stringify(indice)}: [\n${liste.map(l => "      " + JSON.stringify(l)).join(",\n")}\n    ]`);
  const texte = `${ENTETE}const ALTERNATIVES = {\n  "maj": ${JSON.stringify(contenu.maj)},\n  "indices": {\n${blocs.join(",\n")}\n  }\n};\n`;
  writeFileSync(join(dossier, "alternatives.js"), texte);
}

// ---------- Réseau (GECO) et PDF (pdf.js) ----------

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

async function gecoFetch(chemin) {
  for (let essai = 0; ; essai++) {
    const r = await fetch(GECO_API + chemin, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (r.ok) return r;
    // 418 : le code que GECO renvoie pendant ses opérations de maintenance (ce n'est pas un blocage)
    if (r.status === 418) throw Object.assign(new Error("la base GECO de l'AMF est en maintenance (HTTP 418)"), { maintenance: true });
    if (essai >= 1 || ![429, 502, 503].includes(r.status)) throw new Error(`GECO a répondu ${r.status} pour ${chemin}`);
    await attendre(2500);
  }
}

let pdfjs = null;
function chargerPdfJs() {
  if (pdfjs) return pdfjs;
  // pdf.min.js crée globalThis.pdfjsLib ; pdf.worker.min.js crée globalThis.pdfjsWorker, que pdf.js utilise sans vrai « worker »
  for (const f of ["pdf.min.js", "pdf.worker.min.js"])
    vm.runInThisContext(readFileSync(join(RACINE, "js/vendor/pdfjs", f), "utf8"), { filename: f });
  pdfjs = globalThis.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = join(RACINE, "js/vendor/pdfjs/pdf.worker.min.js");
  return pdfjs;
}

// Texte de chaque page, comme texteDuPdf sur le site (morceaux de texte séparés par une espace)
async function pagesDuPdf(donnees) {
  // isEvalSupported: false : pdf.js ne compile aucun code venu du PDF (faille CVE-2024-4367 des versions anciennes)
  const pdf = await chargerPdfJs().getDocument({ data: new Uint8Array(donnees), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, PAGES_MAX); p++)
    pages.push((await (await pdf.getPage(p)).getTextContent()).items.map(i => i.str).join(" "));
  await pdf.destroy();
  return pages;
}

async function lireDicGeco(c) {
  try {
    const documents = await (await gecoFetch(`/document/byCompartAndProduct?compartCode=c${c.cmpId}&prdCode=p${c.prdId}`)).json();
    const doc = choisirDocument(documents, c.cle);
    if (!doc) return null;
    const pages = await pagesDuPdf(await (await gecoFetch(`/document/download/${doc.idInterne}`)).arrayBuffer());
    const texte = sectionDic(pages, c.cle);
    return texte ? { texte, date: doc.dateEffet || "" } : null;
  } finally { await attendre(PAUSE_MS); }
}

function lireAnnuaire() {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(RACINE, "data/annuaire.js"), "utf8"), ctx, { filename: "data/annuaire.js" });
  return vm.runInContext("ANNUAIRE", ctx);
}

async function principal() {
  const annuaire = lireAnnuaire();
  const liste = candidats(annuaire);
  console.log(`${liste.length} fonds indiciels candidats dans l'annuaire`);
  let indices;
  try { ({ indices } = await construire(annuaire, lireDicGeco)); } catch (e) {
    console.log(`::warning::${e.message} : data/alternatives.js n'est pas modifié`);
    return;
  }
  const lus = Object.values(indices).reduce((n, l) => n + l.length, 0);
  for (const [indice, l] of Object.entries(indices)) console.log(`  ${indice} : ${l.length} fonds`);
  // Fichier anormalement court (GECO en panne, format des documents changé…) : on garde l'ancien
  if (lus < Math.ceil(liste.length / 2)) {
    console.log(`::warning::frais lus pour ${lus} fonds sur ${liste.length} seulement : data/alternatives.js n'est pas modifié`);
    return;
  }
  ecrire({ maj: new Date().toISOString().slice(0, 10), indices }, join(RACINE, "data"));
  console.log(`data/alternatives.js écrit : ${lus} fonds`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();

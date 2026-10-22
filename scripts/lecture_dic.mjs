/*
 * Lecture des DIC (documents d'informations clés) de la base GECO de l'AMF, partagée par
 * scripts/construire_alternatives.mjs et le script des pages de fonds.
 *
 * Script Node sans dépendance : modules intégrés et pdf.js hébergé avec le site (js/vendor/pdfjs).
 * extraireDic vient de js/geco.js, chargé dans un contexte vm : un seul code d'extraction pour le site et pour les scripts.
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const GECO_API = "https://geco.amf-france.org/back-office";
const UA = "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)";
const PAUSE_MS = 500;            // politesse envers GECO, entre deux fonds
const PAGES_MAX = 40;            // pages lues au plus dans un prospectus (les DIC sont au début)
const PAGES_DIC = 4;             // un DIC tient en 3 pages (4 au plus)
const OBJECTIF_MAX = 300;        // longueur maximale de l'objectif dans le résumé

const site = vm.createContext({ console });
vm.runInContext(readFileSync(join(RACINE, "js/geco.js"), "utf8"), site, { filename: "js/geco.js" });
const extraireDicSite = vm.runInContext("extraireDic", site);

export function extraireDic(texte) { return extraireDicSite(texte); }

// Frais courants (% par an) = frais de gestion + coûts de transaction, comme sur la fiche (js/fiche-auto.js)
export function fraisCourants(dic) {
  if (!dic || dic.gestion === null || dic.gestion === undefined) return null;
  return Math.round((dic.gestion + (dic.transaction || 0)) * 10000) / 10000;
}

// « DIC », « DICI », « KID », « KIID » comme mots (pas « indice », « periodic »…) ; « _ » et les chiffres séparent les mots
const estDic = d => /(?:^|[^a-z])(?:DICI?|KIID?)(?![a-z])/i.test(d.docTypeLib + " " + d.docName);

// Document à lire : DIC le plus récent (celui dont le nom porte l'ISIN de la part d'abord), sinon le prospectus le plus récent
export function choisirDocument(documents, isin) {
  const recents = [...documents].sort((a, b) => (b.dateEffet || "").localeCompare(a.dateEffet || ""));
  const dics = recents.filter(estDic);
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

// ---------- Réseau (GECO) et PDF (pdf.js) ----------

const attendre = ms => new Promise(ok => setTimeout(ok, ms));

export async function gecoFetch(chemin) {
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

// Texte du DIC d'une part et date du document, ou null quand GECO n'a pas de DIC pour cette part (aucun document, ni DIC ni prospectus,
// ou pas de section pour cet ISIN : cas normal, « sans DIC »). Une erreur (HTTP, PDF invalide, délai) lève une exception. Une pause suit chaque lecture (politesse envers GECO).
// `options.parts` : réponse de /funds/compartment/c<cmpId>/shares déjà lue par l'appelant (scripts/alertes.mjs), pour ne pas la
// demander deux fois à GECO ; sans elle (scripts des alternatives et des résumés), elle est lue ici.
export async function lireDicGeco({ cmpId, prdId, isin }, options = {}) {
  try {
    // Comme la fiche du site : le DIC de la part (documents des parts du compartiment) d'abord, sinon les documents du fonds
    const parts = options.parts !== undefined ? options.parts : await (await gecoFetch(`/funds/compartment/c${cmpId}/shares`)).json();
    const part = (Array.isArray(parts) ? parts : []).find(p => p.isin === isin);
    const dicPart = ((part && part.documentEsEntities) || []).filter(estDic);
    let doc = dicPart.length ? choisirDocument(dicPart, isin) : null;
    if (!doc) {
      const documents = await (await gecoFetch(`/document/byCompartAndProduct?compartCode=c${cmpId}&prdCode=p${prdId}`)).json();
      doc = choisirDocument(documents, isin);
    }
    if (!doc) return null;
    const pages = await pagesDuPdf(await (await gecoFetch(`/document/download/${doc.idInterne}`)).arrayBuffer());
    const texte = sectionDic(pages, isin);
    return texte ? { texte, date: doc.dateEffet || "" } : null;
  } finally { await attendre(PAUSE_MS); }
}

// Résumé d'un DIC lu par extraireDic, pour une page de fonds : { frais, sri, duree, objectif }, null pour ce qui manque.
// L'objectif tient en 300 caractères au plus : coupé à la fin d'une phrase si possible, sinon d'un mot, suivi de « … ».
export function resumeDic(dic) {
  const d = dic || {};
  const nombre = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const texte = typeof d.objectif === "string" ? d.objectif.replace(/\s+/g, " ").trim() : "";
  let objectif = texte || null;
  if (texte.length > OBJECTIF_MAX) {
    const tete = texte.slice(0, OBJECTIF_MAX - 1);   // une place pour « … »
    const phrases = [...tete.matchAll(/[.!?](?=\s|$)/g)];
    // fin de phrase si elle laisse un texte utile (au moins 40 caractères), sinon fin de mot
    const finPhrase = phrases.length ? phrases[phrases.length - 1].index + 1 : 0;
    // le texte coupé tombe-t-il pile entre deux mots ? alors tout « tete » est gardé, sinon on retire le mot entamé
    const coupe = /\s/.test(texte[OBJECTIF_MAX - 1]) ? tete : tete.replace(/\s*\S*$/, "");
    objectif = (finPhrase >= 40 ? tete.slice(0, finPhrase) : coupe).trimEnd() + "…";
  }
  return { frais: fraisCourants(dic), sri: nombre(d.sri), duree: d.duree || null, objectif };
}

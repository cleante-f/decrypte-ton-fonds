/*
 * Frais des fonds indiciels de droit français (base GECO de l'AMF) → data/alternatives.js, pour la section
 * « Alternative moins chère » de la fiche (js/alternatives.js). Lancé chaque mois par .github/workflows/alternatives.yml.
 *
 * Script Node (et non Python) : il lit les DIC (PDF) avec pdf.js, déjà hébergé avec le site (js/vendor/pdfjs), et réutilise
 * extraireDic (scripts/lecture_dic.mjs, d'après js/geco.js) et indiceDuNom de js/style.js : un seul code d'extraction pour le site et pour ce script.
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
import { extraireDic, fraisCourants, choisirDocument, sectionDic, lireDicGeco } from "./lecture_dic.mjs";

// Ces fonctions vivent dans scripts/lecture_dic.mjs ; on les réexporte pour les tests existants
export { extraireDic, fraisCourants, choisirDocument, sectionDic };

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTETE = "/* Généré par scripts/construire_alternatives.mjs — ne pas modifier à la main.\n * Source : AMF – DIC (base GECO). */\n";

// ---------- Code du site : extraireDic (js/geco.js), indiceDuNom et exclusions de trouverJumeau (js/style.js) ----------

const site = vm.createContext({ console });
for (const f of ["js/geco.js", "js/style.js"]) vm.runInContext(readFileSync(join(RACINE, f), "utf8"), site, { filename: f });
const indiceDuNom = vm.runInContext("indiceDuNom", site);
// La liste des exclusions est écrite dans trouverJumeau : on la relit dans js/style.js plutôt que de la recopier
const sourceExclus = readFileSync(join(RACINE, "js/style.js"), "utf8").match(/const exclus = (\/.+\/i);/);
if (!sourceExclus) throw new Error("exclusions de trouverJumeau introuvables dans js/style.js");
const EXCLUS = vm.runInContext(sourceExclus[1], site);

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

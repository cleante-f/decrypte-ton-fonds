/*
 * Résumés des DIC (frais, risque, durée, objectif) → data/resumes.js, pour les pages de fonds indexables.
 * Lu par morceaux : au plus --max fonds par lancement (2 500 par défaut), les jamais lus d'abord puis les plus anciennement lus.
 * Les valeurs des fonds non relus sont conservées d'un lancement à l'autre.
 *
 * Garde-fous : HTTP 418 (maintenance de GECO) ou moins de la moitié des fonds tentés lus → fichier inchangé, avec un ::warning::.
 *
 * Usage : node scripts/construire_resumes.mjs [--max N]
 */
import vm from "node:vm";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extraireDic, resumeDic, lireDicGeco } from "./lecture_dic.mjs";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTETE = "/* Généré par scripts/construire_resumes.mjs — ne pas modifier à la main.\n * Source : AMF – DIC (base GECO). */\n";
const MAX_DEFAUT = 2500;
const PAUSE_MS = 500;

// Lignes de l'annuaire : [source, cmpId, prdId, nom, gestionnaire, classification, nature, isins, date, pays, tickers, marchés, devise, etf, public]
// Fonds G ouverts à tous, avec un ISIN, hors FCPE et hors HSBC (données interdites sans accord écrit). Clé = ISIN de la première part.
export function candidatsResumes(annuaire) {
  const res = [], vus = new Set();
  for (const l of annuaire) {
    if (l[0] !== "G" || l[14] !== 1 || !l[7] || /FCPE/i.test(l[6]) || /HSBC/i.test(l[4])) continue;
    const isin = l[7].split(" ")[0];
    if (vus.has(isin)) continue;
    vus.add(isin);
    res.push({ isin, nom: l[3], cmpId: l[1], prdId: l[2] });
  }
  return res;
}

// Les jamais lus d'abord (dans l'ordre de l'annuaire), puis par date de lecture croissante ; au plus `max` fonds
export function aLire(candidats, resumes, max = MAX_DEFAUT) {
  const fonds = (resumes && resumes.fonds) || {};
  const date = c => (fonds[c.isin] ? String(fonds[c.isin][5] || "") : "");
  const jamais = candidats.filter(c => !fonds[c.isin]);
  const lus = candidats.filter(c => fonds[c.isin]).sort((a, b) => date(a).localeCompare(date(b)));
  return [...jamais, ...lus].slice(0, max);
}

const attendre = ms => new Promise(r => setTimeout(r, ms));

// lireDic(candidat) → { texte, date } ou null. Retourne { tentes, lus: { isin: [frais, sri, durée, objectif, dateDic, dateLecture] } }.
// HTTP 418 (maintenance, e.maintenance) : tout s'arrête ; une autre erreur ou un DIC illisible écarte seulement le fonds.
export async function lireMorceau(liste, lireDic, { pause = PAUSE_MS, aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const lus = {};
  let tentes = 0;
  for (const c of liste) {
    tentes++;
    try {
      const dic = await lireDic(c);
      if (dic) {
        const r = resumeDic(extraireDic(dic.texte));
        if (r.frais !== null || r.sri !== null || r.duree || r.objectif)
          lus[c.isin] = [r.frais, r.sri, r.duree || "", r.objectif || "", dic.date || "", aujourdhui];
      }
    } catch (e) {
      if (e.maintenance) throw e;
      console.warn(`${c.nom} (${c.isin}) : ${e.message}`);
    }
    if (pause) await attendre(pause);
  }
  return { tentes, lus };
}

// Garde : au moins la moitié des fonds tentés doivent être lus
export function garde(tentes, lus) { return tentes > 0 && lus * 2 >= tentes; }

// Valeurs relues par-dessus les anciennes ; les fonds qui ne sont plus dans l'annuaire (isinsActuels) sont retirés
export function fusionner(ancien, nouveaux, maj, isinsActuels) {
  const fonds = { ...((ancien && ancien.fonds) || {}), ...nouveaux };
  if (isinsActuels) {
    const actuels = new Set(isinsActuels);
    for (const isin of Object.keys(fonds)) if (!actuels.has(isin)) delete fonds[isin];
  }
  return { maj, fonds };
}

// Écrit resumes.js dans le dossier donné (data/ du site) : un fonds par ligne, pour des différences lisibles
export function ecrire(contenu, dossier) {
  const lignes = Object.entries(contenu.fonds).sort(([a], [b]) => a.localeCompare(b))
    .map(([isin, v]) => `    ${JSON.stringify(isin)}: ${JSON.stringify(v)}`);
  const texte = `${ENTETE}const RESUMES = {\n  "maj": ${JSON.stringify(contenu.maj)},\n  "fonds": {\n${lignes.join(",\n")}\n  }\n};\n`;
  writeFileSync(join(dossier, "resumes.js"), texte);
}

function lireConstante(fichier, nom) {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(fichier, "utf8"), ctx, { filename: fichier });
  return vm.runInContext(nom, ctx);
}

async function principal() {
  const i = process.argv.indexOf("--max");
  const max = i > 0 ? parseInt(process.argv[i + 1], 10) : MAX_DEFAUT;
  if (!(max > 0)) throw new Error("--max attend un nombre entier positif");
  const candidats = candidatsResumes(lireConstante(join(RACINE, "data/annuaire.js"), "ANNUAIRE"));
  const fichier = join(RACINE, "data/resumes.js");
  const ancien = existsSync(fichier) ? lireConstante(fichier, "RESUMES") : null;
  const liste = aLire(candidats, ancien, max);
  console.log(`${candidats.length} fonds candidats, ${liste.length} à lire`);
  let r;
  try { r = await lireMorceau(liste, lireDicGeco); } catch (e) {
    console.log(`::warning::${e.message} : data/resumes.js n'est pas modifié`);
    return;
  }
  const nb = Object.keys(r.lus).length;
  if (!garde(r.tentes, nb)) {
    console.log(`::warning::DIC lus pour ${nb} fonds sur ${r.tentes} seulement : data/resumes.js n'est pas modifié`);
    return;
  }
  ecrire(fusionner(ancien, r.lus, new Date().toISOString().slice(0, 10), candidats.map(c => c.isin)), join(RACINE, "data"));
  console.log(`data/resumes.js écrit : ${nb} fonds relus sur ${r.tentes}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();

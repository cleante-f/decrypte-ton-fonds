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

// Règle des fonds avec une page (js/adresses.js) et lecture des lignes de l'annuaire (lireEntree, js/geco.js) : le code du site,
// chargé avec node:vm, pour que les résumés et les pages suivent la même règle
const site = vm.createContext({});
for (const f of ["js/geco.js", "js/adresses.js"]) vm.runInContext(readFileSync(join(RACINE, f), "utf8"), site, { filename: f });
const lireEntree = vm.runInContext("lireEntree", site);
const fondsAvecPage = vm.runInContext("fondsAvecPage", site);

// Lignes de l'annuaire : [source, cmpId, prdId, nom, gestionnaire, classification, nature, isins, date, pays, tickers, marchés, devise, etf, public]
// Fonds G qui ont une page (ouverts à tous, avec un ISIN valide, hors FCPE et hors HSBC). Clé = ISIN de la première part.
export function candidatsResumes(annuaire) {
  const res = [], vus = new Set();
  for (const l of annuaire) {
    const e = lireEntree(l);
    if (e.source !== "G" || !fondsAvecPage(e)) continue;
    const isin = e.isins[0];
    if (vus.has(isin)) continue;
    vus.add(isin);
    res.push({ isin, nom: e.nom, cmpId: e.cmpId, prdId: e.prdId });
  }
  return res;
}

// Les jamais tentés d'abord (dans l'ordre de l'annuaire), puis par date croissante : la plus récente entre la lecture
// et le dernier essai raté (date du dernier passage sur le fonds) (resumes.essais), pour qu'un DIC illisible ne monopolise pas le plafond à chaque lancement.
export function aLire(candidats, resumes, max = MAX_DEFAUT) {
  const fonds = (resumes && resumes.fonds) || {};
  const essais = (resumes && resumes.essais) || {};
  const date = c => [fonds[c.isin] && String(fonds[c.isin][5] || ""), essais[c.isin]].filter(Boolean).sort().pop() || "";
  const connu = c => fonds[c.isin] || essais[c.isin];
  const jamais = candidats.filter(c => !connu(c));
  const vus = candidats.filter(connu).sort((a, b) => date(a).localeCompare(date(b)));
  return [...jamais, ...vus].slice(0, max);
}

const attendre = ms => new Promise(r => setTimeout(r, ms));

// lireDic(candidat) → { texte, date } ou null. Retourne { tentes, echecs: [isin], lus: { isin: [frais, sri, durée, objectif, dateDic, dateLecture] } }.
// HTTP 418 (maintenance, e.maintenance) : tout s'arrête ; une autre erreur ou un DIC illisible écarte seulement le fonds.
export async function lireMorceau(liste, lireDic, { pause = PAUSE_MS, aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const lus = {}, echecs = [];
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
    if (!lus[c.isin]) echecs.push(c.isin);
    if (pause) await attendre(pause);
  }
  return { tentes, lus, echecs };
}

// Garde : au moins la moitié des fonds tentés doivent être lus
export function garde(tentes, lus) { return tentes > 0 && lus * 2 >= tentes; }

// Valeurs relues par-dessus les anciennes ; les fonds qui ne sont plus dans l'annuaire (isinsActuels) sont retirés
// `echecs` : ISIN tentés sans succès, notés dans `essais` à la date `maj` ; un fonds lu sort de `essais`.
export function fusionner(ancien, nouveaux, maj, isinsActuels, echecs = []) {
  const fonds = { ...((ancien && ancien.fonds) || {}), ...nouveaux };
  const essais = { ...((ancien && ancien.essais) || {}) };
  for (const isin of echecs) if (!nouveaux[isin]) essais[isin] = maj;
  for (const isin of Object.keys(nouveaux)) delete essais[isin];
  if (isinsActuels) {
    const actuels = new Set(isinsActuels);
    for (const t of [fonds, essais]) for (const isin of Object.keys(t)) if (!actuels.has(isin)) delete t[isin];
  }
  return { maj, fonds, essais };
}

// Écrit resumes.js dans le dossier donné (data/ du site) : un fonds par ligne, pour des différences lisibles
export function ecrire(contenu, dossier) {
  const lignes = Object.entries(contenu.fonds).sort(([a], [b]) => a.localeCompare(b))
    .map(([isin, v]) => `    ${JSON.stringify(isin)}: ${JSON.stringify(v)}`);
  const essais = Object.entries(contenu.essais || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([isin, d]) => `    ${JSON.stringify(isin)}: ${JSON.stringify(d)}`);
  const texte = `${ENTETE}const RESUMES = {\n  "maj": ${JSON.stringify(contenu.maj)},\n  "fonds": {\n${lignes.join(",\n")}\n  },\n  "essais": {\n${essais.join(",\n")}\n  }\n};\n`;
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
  ecrire(fusionner(ancien, r.lus, new Date().toISOString().slice(0, 10), candidats.map(c => c.isin), r.echecs), join(RACINE, "data"));
  console.log(`data/resumes.js écrit : ${nb} fonds relus sur ${r.tentes}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await principal(); } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
}

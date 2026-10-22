/*
 * Résumés des DIC (frais, risque, durée, objectif) → data/resumes.js, pour les pages de fonds indexables.
 * Lu par morceaux : au plus --max fonds par lancement (2 500 par défaut), les jamais lus d'abord puis les plus anciennement lus.
 * Les valeurs des fonds non relus sont conservées d'un lancement à l'autre.
 *
 * Trois issues par fonds : « lu », « sans DIC » (aucun document, ou pas de DIC pour cet ISIN : cas normal et durable) et
 * « erreur » (réseau, HTTP autre que 418, PDF invalide, délai dépassé). Les fonds non lus sont notés dans `essais` pour tourner.
 * Garde-fous : HTTP 418 (maintenance de GECO) ou erreurs sur plus de la moitié des fonds tentés → fichier inchangé, avec un ::warning::.
 * Budget de temps (--minutes, 110 par défaut) : une fois dépassé, la lecture s'arrête et ce qui a été lu est écrit (après la garde),
 * pour que la tâche hebdomadaire finisse bien avant sa limite (150 minutes) au lieu de tout perdre.
 *
 * Usage : node scripts/construire_resumes.mjs [--max N] [--minutes N]
 */
import vm from "node:vm";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extraireDic, resumeDic, lireDicGeco } from "./lecture_dic.mjs";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTETE = "/* Généré par scripts/construire_resumes.mjs — ne pas modifier à la main.\n * Source : AMF – DIC (base GECO). */\n";
const MAX_DEFAUT = 2500;
const MINUTES_DEFAUT = 110;
const PAUSE_MS = 500;

// Règle des fonds avec une page (js/adresses.js) et lecture des lignes de l'annuaire (lireEntree, js/geco.js) : le code du site,
// chargé avec node:vm, pour que les résumés et les pages suivent la même règle
const site = vm.createContext({});
for (const f of ["js/geco.js", "js/adresses.js"]) vm.runInContext(readFileSync(join(RACINE, f), "utf8"), site, { filename: f });
const fondsDesPages = vm.runInContext("fondsDesPages", site);

// Lignes de l'annuaire : [source, cmpId, prdId, nom, gestionnaire, classification, nature, isins, date, pays, tickers, marchés, devise, etf, public]
// Fonds G qui ont une page (ouverts à tous, avec un ISIN valide, hors FCPE et hors HSBC), avec le même propriétaire que la page :
// la ligne que le site ouvre pour l'ISIN (fondsDesPages, js/adresses.js). Clé = ISIN de la première part.
export function candidatsResumes(annuaire) {
  return [...fondsDesPages(annuaire)].filter(e => e.source === "G")
    .map(e => ({ isin: e.isins[0], nom: e.nom, cmpId: e.cmpId, prdId: e.prdId }));
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

// lireDic(candidat) → { texte, date } (DIC trouvé) ou null (pas de DIC pour ce fonds) ; une exception = erreur de lecture.
// Retourne { tentes, lus: { isin: [frais, sri, durée, objectif, dateDic, dateLecture] }, sansDic: [isin], erreurs: [isin], echecs: [isin non lus] }.
// HTTP 418 (maintenance, e.maintenance) : tout s'arrête ; une autre erreur écarte seulement le fonds.
// finAvant : heure limite (en ms, selon horloge) ; une fois atteinte, plus aucun fonds n'est lu et `interrompu` vaut vrai.
export async function lireMorceau(liste, lireDic,
  { pause = PAUSE_MS, aujourdhui = new Date().toISOString().slice(0, 10), horloge = Date.now, finAvant = Infinity } = {}) {
  const lus = {}, sansDic = [], erreurs = [];
  let tentes = 0, interrompu = false;
  for (const c of liste) {
    if (horloge() >= finAvant) { interrompu = true; break; }
    tentes++;
    try {
      const dic = await lireDic(c);
      const r = dic ? resumeDic(extraireDic(dic.texte)) : null;
      if (r && (r.frais !== null || r.sri !== null || r.duree || r.objectif))
        lus[c.isin] = [r.frais, r.sri, r.duree || "", r.objectif || "", dic.date || "", aujourdhui];
      else sansDic.push(c.isin);
    } catch (e) {
      if (e.maintenance) throw e;
      console.warn(`${c.nom} (${c.isin}) : ${e.message}`);
      erreurs.push(c.isin);
    }
    if (pause) await attendre(pause);
  }
  const echecs = [...sansDic, ...erreurs].sort();
  return { tentes, lus, sansDic, erreurs, echecs, interrompu };
}

// Garde : le fichier n'est écrit que si les erreurs ne dépassent pas la moitié des fonds tentés.
// Les fonds « sans DIC » ne comptent pas : GECO n'a souvent aucun document pour eux, ce n'est pas une panne.
export function garde(tentes, erreurs) { return tentes > 0 && erreurs * 2 <= tentes; }

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
  const j = process.argv.indexOf("--minutes");
  const minutes = j > 0 ? Number(process.argv[j + 1]) : MINUTES_DEFAUT;
  if (!(minutes > 0)) throw new Error("--minutes attend un nombre positif");
  const candidats = candidatsResumes(lireConstante(join(RACINE, "data/annuaire.js"), "ANNUAIRE"));
  const fichier = join(RACINE, "data/resumes.js");
  const ancien = existsSync(fichier) ? lireConstante(fichier, "RESUMES") : null;
  const liste = aLire(candidats, ancien, max);
  console.log(`${candidats.length} fonds candidats, ${liste.length} à lire`);
  await traiterMorceau(liste, ancien, lireDicGeco, join(RACINE, "data"), { tous: candidats.map(c => c.isin), minutes });
}

// Lit un morceau, applique la garde, écrit resumes.js dans `dossier` et affiche le bilan : lus / sans DIC / erreurs
// minutes : budget de temps de la lecture (horloge : Date.now, remplaçable dans les tests)
export async function traiterMorceau(liste, ancien, lireDic, dossier,
  { pause = PAUSE_MS, aujourdhui = new Date().toISOString().slice(0, 10), tous, minutes = Infinity, horloge = Date.now } = {}) {
  let r;
  const finAvant = horloge() + minutes * 60_000;
  try { r = await lireMorceau(liste, lireDic, { pause, aujourdhui, horloge, finAvant }); } catch (e) {
    console.log(`::warning::${e.message} : data/resumes.js n'est pas modifié`);
    return;
  }
  const nb = Object.keys(r.lus).length;
  if (r.interrompu) console.log(`::warning::budget de temps (${minutes} minutes) dépassé : lecture arrêtée après ${r.tentes} fonds sur ${liste.length}`);
  console.log(`${r.tentes} fonds tentés : ${nb} lus, ${r.sansDic.length} sans DIC, ${r.erreurs.length} erreurs`);
  if (!garde(r.tentes, r.erreurs.length)) {
    console.log(`::warning::${r.erreurs.length} erreurs de lecture sur ${r.tentes} fonds tentés (plus de la moitié) : data/resumes.js n'est pas modifié`);
    return;
  }
  ecrire(fusionner(ancien, r.lus, aujourdhui, tous, r.echecs), dossier);
  console.log(`data/resumes.js écrit : ${nb} fonds relus, ${r.echecs.length} notés dans les essais`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await principal(); } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
}

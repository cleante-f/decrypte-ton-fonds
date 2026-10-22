/*
 * Alertes par e-mail sur les fonds suivis : tâche quotidienne (.github/workflows/alertes.yml).
 *
 *  1. lit les fonds suivis et les préférences d'alertes (clé « service » de Supabase), puis l'état précédent des fonds
 *     (table etat_fonds_suivis, que seule cette tâche lit et écrit) ;
 *  2. pour chaque fonds distinct : DIC (scripts/lecture_dic.mjs, DIC de la part d'abord ; fonds français seulement) et valeurs
 *     récentes (VL GECO pour un fonds français, data/cours pour un fonds coté à Francfort/Xetra, rendements mensuels de la SEC
 *     pour un fonds américain) ;
 *  3. détecte les changements : nouveau DIC (date différente), frais courants en hausse, SRI modifié, baisse sur un mois
 *     au-delà du seuil choisi (5, 10 ou 20 %) ;
 *  4. lit l'adresse e-mail des seules personnes qui ont une alerte, puis leur envoie au plus un e-mail chacune (API Brevo),
 *     qui regroupe leurs alertes, avec un lien de désinscription ;
 *  5. écrit le nouvel état seulement après des envois réussis, et retire l'état des fonds que plus personne ne suit.
 *     GECO en maintenance (HTTP 418), quota Brevo dépassé ou erreur générale d'envoi : rien n'est envoyé (ou l'envoi
 *     s'arrête), l'état reste inchangé, avec un ::warning:: ; les alertes repartent au passage suivant.
 *
 * Premier passage d'un fonds (pas d'état précédent) : aucune alerte, seul l'état est enregistré.
 * Fonds d'une société de gestion HSBC : ignorés (données de HSBC Asset Management interdites sans accord écrit).
 *
 * Toutes les entrées et sorties passent par des fonctions injectées dans `principal` : les tests n'appellent aucun service.
 * Script Node sans dépendance : modules intégrés, code du site chargé avec node:vm et pdf.js hébergé avec le site.
 *
 * Usage : SUPABASE_SERVICE_ROLE_KEY=… BREVO_API_KEY=… ALERTES_SECRET=… node scripts/alertes.mjs
 * (l'adresse du projet Supabase est lue dans js/config-compte.js, ou dans SUPABASE_URL si elle est fournie)
 */
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extraireDic, resumeDic, lireDicGeco, gecoFetch } from "./lecture_dic.mjs";
import { entetesService } from "../supabase/functions/_partage/outils.js";

const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));

// Adresse du site dans les liens des e-mails. Les comptes (et donc les alertes) n'existent pour l'instant que sur l'aperçu
// Cloudflare (mode comptes) ; les pages des fonds et la fiche (decrypte.html#<clé>) s'ouvrent aussi sur GitHub Pages.
// À remplacer par l'adresse du site en mode comptes au moment de la bascule (domaine decrypte-ton-fonds.fr).
export const BASE_SITE = "https://cleante-f.github.io/decrypte-ton-fonds/";
const EXPEDITEUR = { email: "contact@decrypte-ton-fonds.fr", name: "Décrypte ton fonds" };
const SEUILS_BAISSE = [5, 10, 20];
const JOURS_MOIS = 30;            // baisse sur un mois : valeur la plus récente contre la dernière valeur au moins 30 jours avant
const JOURS_HISTORIQUE = 45;      // historique gardé dans l'état (fonds à valeurs quotidiennes)
const POINTS_MENSUELS = 3;        // historique gardé dans l'état (fonds américains : une valeur par mois)
const JOURS_VL_GECO = 60;         // historique des VL demandé à GECO
const PAGE_SUPABASE = 1000;       // lignes lues par requête (limite par défaut de l'API REST de Supabase)

// ---------- Outils de texte ----------

const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateFr = iso => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(iso || ""));
const nombreFr = (x, decimales) => String(Math.round(x * 10 ** decimales) / 10 ** decimales).replace(".", ",");
const nombre = v => typeof v === "number" && Number.isFinite(v);
const jour = iso => Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") / 864e5;   // numéro du jour (UTC)
const isoDuJour = d => d.toISOString().slice(0, 10);

// ---------- Détection ----------

// Variation (en %) de la valeur la plus récente d'une série [[« AAAA-MM-JJ », valeur]…] (dans l'ordre des dates) :
// contre la dernière valeur datée d'au moins 30 jours plus tôt ; pour une série mensuelle (fonds américains, une valeur
// par fin de mois), contre la valeur précédente. null si la série ne couvre pas un mois.
export function variationSurUnMois(points, { mensuel = false } = {}) {
  const pts = (points || []).filter(p => Array.isArray(p) && nombre(p[1]) && p[1] > 0);
  if (pts.length < 2) return null;
  const [dateFin, fin] = pts[pts.length - 1];
  let ref = null;
  if (mensuel) ref = pts[pts.length - 2];
  else for (let i = pts.length - 2; i >= 0; i--) if (jour(dateFin) - jour(pts[i][0]) >= JOURS_MOIS) { ref = pts[i]; break; }
  if (!ref) return null;
  return Math.round((fin / ref[1] - 1) * 100 * 10000) / 10000;
}

// Toutes les alertes possibles d'un fonds, sans tenir compte des préférences (la baisse porte sa variation, que chacun
// compare à son seuil). Rien au premier passage.
function alertesBrutes(ancien, nouveau) {
  if (!ancien || !nouveau) return [];
  const res = [];
  // Nouveau DIC : une date connue avant et une autre date maintenant. Un fonds qui n'avait pas de DIC lu (date null) n'en
  // déclenche pas : on ne sait pas si le document est nouveau ou s'il n'avait simplement pas pu être lu.
  const nouveauDic = !!ancien.date_dic && !!nouveau.date_dic && nouveau.date_dic !== ancien.date_dic;
  if (nouveauDic) res.push({ type: "nouveau_dic", date: nouveau.date_dic });
  // Frais et SRI : seulement avec un nouveau DIC. Un changement de valeur sur le même document vient de la lecture
  // (extraireDic amélioré, autre section du PDF), pas du fonds : il met l'état à jour sans alerte.
  if (nouveauDic && nombre(ancien.frais) && nombre(nouveau.frais) && nouveau.frais > ancien.frais + 1e-9)
    res.push({ type: "frais", avant: ancien.frais, apres: nouveau.frais });
  if (nouveauDic && Number.isInteger(ancien.sri) && Number.isInteger(nouveau.sri) && nouveau.sri !== ancien.sri)
    res.push({ type: "risque", avant: ancien.sri, apres: nouveau.sri });
  // Baisse : seulement sur une nouvelle valeur. La variation « avant » est calculée sur la même série (même échelle, après
  // correction des divisions de parts), arrêtée à la date de l'état précédent : une baisse déjà signalée ne l'est pas chaque jour.
  if (nouveau.date_valeur && ancien.date_valeur && nouveau.date_valeur > ancien.date_valeur) {
    const pts = nouveau.historique || [];
    const variation = variationSurUnMois(pts, { mensuel: !!nouveau.mensuel });
    if (variation !== null && variation < 0) {
      const variationAvant = variationSurUnMois(pts.filter(p => p[0] <= ancien.date_valeur), { mensuel: !!nouveau.mensuel });
      res.push({ type: "baisse", variation, variationAvant, date: nouveau.date_valeur });
    }
  }
  return res;
}

// Une alerte compte-t-elle pour ces préférences ? (préférences absentes = valeurs par défaut du site : tout coché, sans baisse)
function garder(alerte, prefs) {
  const p = prefs || {};
  if (p.actives === false) return false;
  if (alerte.type === "baisse") {
    const seuil = Number(p.seuil_baisse);
    if (!SEUILS_BAISSE.includes(seuil)) return false;
    return alerte.variation <= -seuil && !(nombre(alerte.variationAvant) && alerte.variationAvant <= -seuil);
  }
  return p[alerte.type] !== false;
}

// Alertes d'un fonds pour une personne : [{ type: "nouveau_dic", date } | { type: "frais", avant, apres }
// | { type: "risque", avant, apres } | { type: "baisse", variation, variationAvant, date }]
export function detecter(ancien, nouveau, prefs) {
  return alertesBrutes(ancien, nouveau).filter(a => garder(a, prefs));
}

// alertesParFonds : { <clé>: { fonds: { cle, nom, lien }, alertes: [alertes brutes] } } ;
// abonnes : [{ user_id, prefs, fonds: [clés] }]. Un message par personne qui a au moins une alerte :
// [{ user_id, alertes: [{ cle, nom, lien, type, … }] }], dans l'ordre de ses fonds. L'adresse e-mail n'est lue qu'ensuite,
// pour ces seules personnes (principal, lireEmail).
export function regrouper(alertesParFonds, abonnes) {
  const res = [];
  for (const a of abonnes || []) {
    if (!a || (a.prefs && a.prefs.actives === false)) continue;
    const alertes = [];
    for (const cle of a.fonds || []) {
      const f = alertesParFonds[cle];
      if (!f) continue;
      for (const al of f.alertes) if (garder(al, a.prefs)) alertes.push({ cle, nom: f.fonds.nom, lien: f.fonds.lien, ...al });
    }
    if (alertes.length) res.push({ user_id: a.user_id, alertes });
  }
  return res;
}

// ---------- Contenu de l'e-mail ----------

function texteAlerte(a) {
  switch (a.type) {
    case "nouveau_dic": return `Nouveau document d'informations clés (DIC) publié, daté du ${dateFr(a.date)}.`;
    case "frais": return `Frais courants en hausse : ${nombreFr(a.avant, 4)} % → ${nombreFr(a.apres, 4)} % par an.`;
    case "risque": return `Niveau de risque (SRI) modifié : ${a.avant} → ${a.apres} sur 7.`;
    case "baisse": return `Baisse de ${nombreFr(Math.abs(a.variation), 1)} % sur un mois (dernière valeur connue : ${dateFr(a.date)}).`;
    default: return "";
  }
}

// { sujet, texte, html } : les alertes regroupées sous chaque fonds, avec le lien vers sa page et le lien de désinscription.
// Tout ce qui vient des données (noms, liens) est échappé dans le HTML.
export function courriel(destinataire, alertes, lienDesinscription) {
  const parFonds = new Map();
  for (const a of alertes) {
    if (!parFonds.has(a.cle)) parFonds.set(a.cle, { nom: a.nom, lien: a.lien, lignes: [] });
    parFonds.get(a.cle).lignes.push(texteAlerte(a));
  }
  const n = alertes.length;
  const sujet = `${n} alerte${n > 1 ? "s" : ""} sur tes fonds suivis — Décrypte ton fonds`;
  const intro = "Bonjour,\n\nDu nouveau sur les fonds que tu suis sur Décrypte ton fonds :";
  const pied = "Tu reçois cet e-mail parce que tu as activé les alertes sur tes fonds suivis (au plus un e-mail par jour).\n"
    + "Ces informations ne sont pas un conseil en investissement.";
  const blocs = [...parFonds.values()];
  const texte = [intro, "",
    ...blocs.map(b => [`• ${b.nom}`, ...b.lignes.map(l => `  - ${l}`), `  Voir le fonds : ${b.lien}`, ""].join("\n")),
    pied, `Ne plus recevoir ces alertes : ${lienDesinscription}`, ""].join("\n");
  const html = `<p>Bonjour,</p><p>Du nouveau sur les fonds que tu suis sur Décrypte ton fonds :</p>`
    + blocs.map(b => `<h3 style="margin:16px 0 4px">${esc(b.nom)}</h3><ul>${b.lignes.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`
      + `<p><a href="${esc(b.lien)}">Voir le fonds</a></p>`).join("")
    + `<p style="color:#555;font-size:13px">${esc(pied).replace("\n", "<br>")}<br>`
    + `<a href="${esc(lienDesinscription)}">Ne plus recevoir ces alertes</a></p>`;
  return { sujet, texte, html, destinataire };
}

// ---------- Jeton de désinscription ----------

// Format du jeton (vérifié par la fonction Supabase alertes-desinscription, tâche 4, avec le même secret ALERTES_SECRET) :
//   « <userId>.<date>.<signature> »
//   - userId : identifiant (uuid) du compte, tel quel ;
//   - date : jour d'envoi « AAAA-MM-JJ » (UTC) ; la fonction refuse les jetons trop anciens ;
//   - signature : HMAC-SHA256, clé = le secret (texte UTF-8), message = « <userId>.<date> » (UTF-8), encodée en base64url
//     (alphabet « - _ », sans « = » final).
// Aucune des trois parties ne contient de point. Le jeton ne permet que de désactiver les alertes de ce compte.
export function jetonDesinscription(userId, secret, date) {
  if (!secret) throw new Error("secret des alertes manquant");
  if (!userId || String(userId).includes(".") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("jeton : paramètres invalides");
  const signature = createHmac("sha256", secret).update(`${userId}.${date}`).digest("base64url");
  return `${userId}.${date}.${signature}`;
}

// ---------- Envoi (API Brevo, comme supabase/functions/_partage/comptes.js) ----------

// Seul le code HTTP de la réponse est lu :
//  - 429 (trop de requêtes) ou 402 (crédits d'envoi épuisés) : quota dépassé, l'erreur porte `quota: true` ;
//  - autre 4xx, hors 401 et 403 (clé refusée : rien ne passera) : refus propre à ce destinataire (adresse invalide…),
//    l'erreur porte `destinataire: true` ;
//  - 401, 403, 5xx, réseau, délai : erreur générale.
export async function envoyerBrevo({ email, sujet, texte, html }, cleApi, fetchImpl = fetch) {
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": cleApi, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: EXPEDITEUR, to: [{ email }], subject: sujet, htmlContent: html, textContent: texte }),
    signal: AbortSignal.timeout(30000)
  });
  if (r.ok) return;
  if (r.status === 429 || r.status === 402) throw Object.assign(new Error(`quota Brevo dépassé (HTTP ${r.status})`), { quota: true });
  if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403)
    throw Object.assign(new Error(`Brevo ${r.status}`), { destinataire: true });
  throw new Error(`Brevo ${r.status}`);
}

// ---------- Déroulé ----------

// Dernières valeurs gardées dans l'état : 45 jours (valeurs quotidiennes) ou 3 mois (valeurs mensuelles)
function historiqueRecent(points, mensuel) {
  if (mensuel) return points.slice(-POINTS_MENSUELS);
  const fin = jour(points[points.length - 1][0]);
  return points.filter(p => fin - jour(p[0]) <= JOURS_HISTORIQUE);
}

// Nouvel état d'un fonds : ce qui a été lu, et l'état précédent pour ce qui manque cette fois (DIC introuvable, pas de valeur)
function nouvelEtat(ancien, lu) {
  const a = ancien || {};
  const h = Array.isArray(lu.historique) ? lu.historique.filter(p => Array.isArray(p) && nombre(p[1])) : [];
  const dernier = h.length ? h[h.length - 1] : null;
  return {
    date_dic: lu.date_dic || a.date_dic || null,
    frais: nombre(lu.frais) ? lu.frais : (a.frais ?? null),
    sri: Number.isInteger(lu.sri) ? lu.sri : (a.sri ?? null),
    valeur: dernier ? dernier[1] : (a.valeur ?? null),
    date_valeur: dernier ? dernier[0] : (a.date_valeur ?? null),
    historique: dernier ? historiqueRecent(h, !!lu.mensuel) : (a.historique ?? null),
    mensuel: !!lu.mensuel
  };
}

/*
 * Dépendances :
 *   lireSuivis() → [{ user_id, prefs, fonds: [clés] }]   (sans adresse e-mail)
 *   lireEtat() → { <clé>: { date_dic, frais, sri, valeur, date_valeur, historique } }   (tout l'état enregistré)
 *   lireFonds(clé) → { nom, adresse (chemin de la page ou null), date_dic, frais, sri, historique: [[date, valeur]…], mensuel }
 *                    ou null (fonds introuvable ou ignoré) ; lève une erreur `maintenance: true` si GECO est en maintenance
 *   lireEmail(userId) → adresse e-mail, ou null (compte supprimé) : appelée seulement pour les personnes qui ont un message
 *   envoyer({ email, sujet, texte, html }) ; erreur `quota: true` (quota dépassé), `destinataire: true` (refus propre à
 *                    ce destinataire) ou autre (erreur générale)
 *   ecrireEtat([{ cle_fonds, date_dic, frais, sri, valeur, date_valeur, historique, maj }])
 *   effacerEtat([clés]) : retire l'état des fonds que plus personne ne suit
 *   lienDesinscription(userId, maintenant) → adresse du lien
 *   avertir(texte) → ::warning:: dans le journal de GitHub Actions (jamais d'adresse e-mail dedans)
 * Renvoie { envoyes, alertes, ignores, erreurs, etatEcrit, raison } (raison : "maintenance", "quota", "envoi" ou null).
 *
 * Arrêt sans écrire l'état (les alertes repartent au prochain passage) : GECO en maintenance (avant tout envoi), quota Brevo
 * dépassé, erreur générale d'envoi (clé refusée, 5xx, réseau). Les personnes déjà servies avant l'arrêt recevront donc
 * le même message au passage suivant. Un refus propre à un destinataire (4xx) : cette personne est sautée, avec un
 * avertissement, et l'état est écrit (sinon une adresse invalide bloquerait les alertes de tout le monde chaque jour).
 */
export async function principal({ lireSuivis, lireEtat, lireFonds, lireEmail, envoyer, ecrireEtat, effacerEtat, lienDesinscription,
  avertir = t => console.log(`::warning::${t}`), maintenant = new Date() }) {
  const abonnes = await lireSuivis();
  const cles = [...new Set(abonnes.flatMap(a => a.fonds || []))].sort();
  const etat = (await lireEtat()) || {};
  const lignes = [], alertesParFonds = {}, erreurs = [];
  const arret = (raison, envoyes = 0, alertes = 0) => ({ envoyes, alertes, ignores: 0, erreurs: erreurs.length, etatEcrit: false, raison });

  for (const cle of cles) {
    let lu;
    try { lu = await lireFonds(cle); }
    catch (e) {
      if (e && e.maintenance) {
        avertir(`${e.message} : aucune alerte envoyée aujourd'hui, état inchangé`);
        return arret("maintenance");
      }
      erreurs.push(`${cle} : ${e && e.message}`);
      continue;
    }
    if (!lu) continue;
    const ancien = etat[cle] || null;
    const nouveau = nouvelEtat(ancien, lu);
    const lien = BASE_SITE + (lu.adresse || `decrypte.html#${encodeURIComponent(cle)}`);
    alertesParFonds[cle] = { fonds: { cle, nom: lu.nom || cle, lien }, alertes: alertesBrutes(ancien, nouveau) };
    const { mensuel, ...colonnes } = nouveau;
    lignes.push({ cle_fonds: cle, ...colonnes, maj: maintenant.toISOString() });
  }
  if (erreurs.length) avertir(`${erreurs.length} fonds non lus (état inchangé pour eux) : ${erreurs.slice(0, 5).join(" ; ")}`);

  // Adresses lues avant tout envoi (une erreur arrête tout sans avoir rien envoyé), pour les seules personnes qui ont un message
  const messages = [];
  let sansAdresse = 0;
  for (const m of regrouper(alertesParFonds, abonnes)) {
    const email = await lireEmail(m.user_id);
    if (email) messages.push({ ...m, email }); else sansAdresse++;
  }

  let envoyes = 0, ignores = 0;
  for (const m of messages) {
    const c = courriel(m.email, m.alertes, lienDesinscription(m.user_id, maintenant));
    try { await envoyer({ email: m.email, sujet: c.sujet, texte: c.texte, html: c.html }); envoyes++; }
    catch (e) {
      if (e && e.destinataire) { ignores++; continue; }
      const quota = !!(e && e.quota);
      avertir(`${quota ? "quota Brevo dépassé" : "échec de l'envoi"} (${e && e.message}) après ${envoyes} e-mail(s) : `
        + "envoi arrêté, état inchangé (les alertes repartiront au prochain passage)");
      return arret(quota ? "quota" : "envoi", envoyes, messages.length);
    }
  }
  if (ignores) avertir(`${ignores} e-mail(s) refusé(s) par Brevo pour leur destinataire : ces personnes sont sautées`);
  if (lignes.length) await ecrireEtat(lignes);
  const suivis = new Set(cles);
  const plusSuivis = Object.keys(etat).filter(c => !suivis.has(c));
  if (plusSuivis.length) await effacerEtat(plusSuivis);
  return { envoyes, alertes: messages.length, ignores: ignores + sansAdresse, erreurs: erreurs.length, etatEcrit: true, raison: null };
}

// ---------- Sources réelles (Supabase, GECO, fichiers du site) ----------

const PREFERENCES_PAR_DEFAUT = { actives: true, nouveau_dic: true, frais: true, risque: true, seuil_baisse: null };

// Code du site chargé avec node:vm (lireEntree, cleEntree, entreeParCle, adresseFonds, historiqueDepuisGeco, fragmentCours,
// partSec, serieEurosDepuisRendements…) et données de l'annuaire, chargés au premier besoin
let _site = null;
function site(racine) {
  if (_site) return _site;
  const ctx = vm.createContext({ console });
  for (const f of ["js/outils.js", "js/geco.js", "js/zones.js", "js/adresses.js", "js/cours.js", "js/etats-unis.js", "data/annuaire.js"])
    vm.runInContext(readFileSync(join(racine, f), "utf8"), ctx, { filename: f });
  const charges = new Set();
  const charger = f => { if (!charges.has(f)) { vm.runInContext(readFileSync(join(racine, f), "utf8"), ctx, { filename: f }); charges.add(f); } };
  _site = { ctx, charger, appel: nom => vm.runInContext(nom, ctx) };
  return _site;
}

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pointsDe = h => (h && h.dates ? h.dates.map((d, i) => [isoLocal(d), h.valeurs[i]]).filter(p => nombre(p[1])) : []);

// Cours relevés par scripts/actualiser_cours.py (data/cours/index.json et data/cours/<année>/<NN>.json), comme js/cours.js
function coursDe(racine, isin, fragmentCours) {
  const fIndex = join(racine, "data/cours/index.json");
  if (!isin || !existsSync(fIndex)) return [];
  const index = JSON.parse(readFileSync(fIndex, "utf8"));
  const points = [];
  for (const a of index.annees || []) {
    const fichier = join(racine, `data/cours/${a}/${fragmentCours(isin)}.json`);
    if (!existsSync(fichier)) continue;
    const f = JSON.parse(readFileSync(fichier, "utf8"));
    if (!f.c || !f.c[isin]) continue;
    f.c[isin].forEach((v, k) => { if (v !== null) points.push([f.jours[k], v]); });
  }
  return points.sort((x, y) => x[0].localeCompare(y[0]));
}

export function lireFondsReel(racine = RACINE, maintenant = () => new Date()) {
  return async cle => {
    const s = site(racine);
    if (/^R\d+$/.test(cle)) s.charger("data/annuaire-registres-ue.js");
    if (/^S\d{9}$/.test(cle)) s.charger("data/annuaire-etats-unis.js");
    const e = await s.appel("entreeParCle")(cle);
    if (!e) return null;
    if (/HSBC/i.test(e.gestionnaire || "")) return null;   // données de HSBC AM : interdites sans accord écrit
    const res = { nom: e.nom, adresse: s.appel("adresseFonds")(e), date_dic: null, frais: null, sri: null, historique: [], mensuel: false };
    const isin = e.isins.includes(cle) ? cle : e.isins[0];

    if (e.source === "S") {
      // Fonds américain : rendements mensuels en euros de la part principale (data/etats-unis/NN.js), comme la fiche
      const serie = s.appel("cleEntree")(e);
      s.charger(`data/etats-unis/${String(Number(serie.slice(1)) % 64).padStart(2, "0")}.js`);
      const detail = await s.appel("chargerDetailSec")(serie);
      const part = s.appel("partSec")(detail, e);
      const h = part ? s.appel("serieEurosDepuisRendements")(part.debut, part.rendements) : null;
      return { ...res, historique: pointsDe(h), mensuel: true };
    }
    if (e.source === "G") {
      // Fonds français : DIC de la part (GECO) puis VL des 60 derniers jours (/funds/chart/<idInterne de la part>), comme la fiche
      // Parts du compartiment lues une seule fois : pour le DIC de la part et pour l'idInterne de ses VL
      const parts = await (await gecoFetch(`/funds/compartment/c${e.cmpId}/shares`)).json();
      const dic = await lireDicGeco({ cmpId: e.cmpId, prdId: e.prdId, isin }, { parts });
      if (dic) {
        const r = resumeDic(extraireDic(dic.texte));
        Object.assign(res, { date_dic: dic.date || null, frais: r.frais, sri: r.sri });
      }
      const part = (Array.isArray(parts) ? parts : []).find(p => p.isin === isin);
      if (part) {
        const debut = isoDuJour(new Date(maintenant().getTime() - JOURS_VL_GECO * 864e5));
        const h = await (await gecoFetch(`/funds/chart/${part.idInterne}?startDate=${debut}`)).json();
        if (h && Array.isArray(h.x) && h.x.length) res.historique = pointsDe(s.appel("historiqueDepuisGeco")(h));
      }
      return res;
    }
    // Fonds européen coté (ETF, registre de l'ESMA…) : cours de Deutsche Börse, s'il y en a
    return { ...res, historique: coursDe(racine, isin, s.appel("fragmentCours")) };
  };
}

function supabase(url, env, fetchImpl) {
  const entetes = entetesService(env);
  // Lecture complète d'une table, par pages de 1 000 lignes (ordre stable : `ordre`)
  const toutLire = async (chemin, ordre) => {
    const res = [];
    for (let offset = 0; ; offset += PAGE_SUPABASE) {
      const r = await fetchImpl(`${url}/rest/v1/${chemin}&order=${ordre}&limit=${PAGE_SUPABASE}&offset=${offset}`, { headers: entetes });
      if (!r.ok) throw new Error(`${chemin.split("?")[0]} ${r.status}`);
      const page = await r.json();
      res.push(...page);
      if (page.length < PAGE_SUPABASE) return res;
    }
  };
  return {
    async lireSuivis() {
      const suivis = await toutLire("fonds_suivis?select=user_id,cle_fonds", "user_id,cle_fonds");
      const prefs = new Map((await toutLire("preferences_alertes?select=user_id,actives,nouveau_dic,frais,risque,seuil_baisse", "user_id"))
        .map(p => [p.user_id, { ...PREFERENCES_PAR_DEFAUT, ...p }]));
      const parPersonne = new Map();
      for (const s of suivis) {
        if (!parPersonne.has(s.user_id)) parPersonne.set(s.user_id, []);
        parPersonne.get(s.user_id).push(s.cle_fonds);
      }
      const abonnes = [];
      for (const [user_id, fonds] of parPersonne) {
        const p = prefs.get(user_id) || { ...PREFERENCES_PAR_DEFAUT };
        if (p.actives) abonnes.push({ user_id, prefs: p, fonds });
      }
      return abonnes;
    },
    // Adresse e-mail d'un compte : API d'administration de Supabase (clé service), comme supabase/functions/_partage/comptes.js.
    // null pour un compte supprimé entre-temps (404).
    async lireEmail(user_id) {
      const r = await fetchImpl(`${url}/auth/v1/admin/users/${encodeURIComponent(user_id)}`, { headers: entetes });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`compte ${r.status}`);
      const u = await r.json();
      return (u && u.email) || null;
    },
    async lireEtat() {
      const lignes = await toutLire("etat_fonds_suivis?select=cle_fonds,date_dic,frais,sri,valeur,date_valeur,historique", "cle_fonds");
      return Object.fromEntries(lignes.map(l => [l.cle_fonds, { ...l, frais: l.frais === null ? null : Number(l.frais),
        valeur: l.valeur === null ? null : Number(l.valeur) }]));
    },
    async ecrireEtat(lignes) {
      for (let i = 0; i < lignes.length; i += 500) {
        const r = await fetchImpl(`${url}/rest/v1/etat_fonds_suivis`, { method: "POST",
          headers: { ...entetes, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(lignes.slice(i, i + 500)) });
        if (!r.ok) throw new Error(`etat_fonds_suivis ${r.status}`);
      }
    },
    // Clés entre guillemets dans le filtre « in » (elles ne contiennent que [A-Z0-9._-], vérifié par la table fonds_suivis)
    async effacerEtat(cles) {
      for (let i = 0; i < cles.length; i += 100) {
        const liste = cles.slice(i, i + 100).map(c => `"${c}"`).join(",");
        const r = await fetchImpl(`${url}/rest/v1/etat_fonds_suivis?cle_fonds=in.(${encodeURIComponent(liste)})`, { method: "DELETE",
          headers: { ...entetes, Prefer: "return=minimal" } });
        if (!r.ok) throw new Error(`etat_fonds_suivis ${r.status}`);
      }
    }
  };
}

// Adresse du projet Supabase : variable SUPABASE_URL, sinon js/config-compte.js (réglage public du site)
function adresseSupabase(env, racine) {
  if (env.SUPABASE_URL) return env.SUPABASE_URL.replace(/\/+$/, "");
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(racine, "js/config-compte.js"), "utf8"), ctx, { filename: "js/config-compte.js" });
  return vm.runInContext("CONFIG_COMPTE", ctx).supabaseUrl.replace(/\/+$/, "");
}

export function dependancesReelles(env, { racine = RACINE, fetchImpl = fetch } = {}) {
  const url = adresseSupabase(env, racine);
  const base = supabase(url, env, fetchImpl);
  return {
    ...base,
    lireFonds: lireFondsReel(racine),
    envoyer: m => envoyerBrevo(m, env.BREVO_API_KEY, fetchImpl),
    lienDesinscription: (userId, maintenant) =>
      `${url}/functions/v1/alertes-desinscription?jeton=${encodeURIComponent(jetonDesinscription(userId, env.ALERTES_SECRET, isoDuJour(maintenant)))}`,
    maintenant: new Date()
  };
}

async function executer() {
  const env = process.env;
  const manquants = ["SUPABASE_SERVICE_ROLE_KEY", "BREVO_API_KEY", "ALERTES_SECRET"].filter(n => !env[n]);
  if (manquants.length) {
    console.log(`::warning::secrets absents (${manquants.join(", ")}) : aucune alerte vérifiée`);
    return;
  }
  const r = await principal(dependancesReelles(env));
  console.log(`Alertes : ${r.envoyes} e-mail(s) envoyé(s) sur ${r.alertes}, ${r.erreurs} fonds non lu(s), état ${r.etatEcrit ? "mis à jour" : "inchangé"}.`);
  if (r.raison === "envoi") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  executer().catch(e => { console.log(`::error::${e.message}`); process.exitCode = 1; });
}

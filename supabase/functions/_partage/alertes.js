// Désinscription des alertes en un clic (lien de chaque e-mail d'alerte), en JavaScript standard pour être testée avec Node.
// Jeton produit par scripts/alertes.mjs (jetonDesinscription) : "<uuid>.<AAAA-MM-JJ>.<signature>", signature = HMAC-SHA256
// (clé : ALERTES_SECRET) de "<uuid>.<AAAA-MM-JJ>", en base64url sans remplissage ; la date est le jour (UTC) de l'envoi.
import { entetesService, siteDe } from "./outils.js";

const JOUR = 86400000;
const DUREE_VALIDITE_JOURS = 60;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_SIGNATURE = /^[A-Za-z0-9_-]{43}$/;   // 32 octets en base64url sans remplissage

// Jour (minuit UTC, en millisecondes) d'une date AAAA-MM-JJ réelle, sinon null (30 février, mois 13…).
function jourUtc(texte) {
  const m = RE_DATE.exec(texte);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}

// Décodage strict : les octets réencodés doivent redonner exactement le texte reçu. Sinon (bits de fin non nuls), null :
// une seule écriture de la signature est acceptée.
function octetsBase64url(texte) {
  const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const reencode = btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return reencode === texte ? Uint8Array.from(binaire, c => c.charCodeAt(0)) : null;
}

// Renvoie l'identifiant de l'utilisateur si le jeton est authentique et encore valable, sinon null (sans dire pourquoi).
// La signature est vérifiée par crypto.subtle.verify : comparaison en temps constant.
export async function verifierJeton(jeton, secret, maintenant = new Date()) {
  if (!secret || typeof jeton !== "string") return null;
  const parties = jeton.split(".");
  if (parties.length !== 3) return null;
  const [id, date, signature] = parties;
  if (!RE_UUID.test(id) || !RE_SIGNATURE.test(signature)) return null;
  const jour = jourUtc(date);
  if (jour === null) return null;
  const aujourdhui = Math.floor(maintenant.getTime() / JOUR) * JOUR;
  const age = (aujourdhui - jour) / JOUR;
  if (age < -1 || age > DUREE_VALIDITE_JOURS) return null;   // un jour d'avance toléré (décalage d'horloge)
  try {
    const encodeur = new TextEncoder();
    const octets = octetsBase64url(signature);
    if (!octets) return null;
    const cle = await crypto.subtle.importKey("raw", encodeur.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valide = await crypto.subtle.verify("HMAC", cle, octets, encodeur.encode(`${id}.${date}`));
    return valide ? id : null;
  } catch {
    return null;
  }
}

// Les fonctions Supabase (*.supabase.co) servent le HTML en text/plain : le résultat est montré par une page du site,
// alertes-desactivees.html, vers laquelle on redirige (303). L'adresse de redirection ne contient jamais le jeton.
const ENTETES = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const MESSAGES = {
  succes: "Alertes par e-mail désactivées. Tu ne recevras plus d'e-mail d'alerte. Tu peux les réactiver dans Mon compte.",
  invalide: "Ce lien de désinscription n'est pas valide ou a expiré (60 jours). Tu peux couper les alertes dans Mon compte.",
  erreur: "Une erreur est survenue, réessaie plus tard ou coupe les alertes dans Mon compte."
};
const texteBrut = (statut, message, entetes = {}) =>
  new Response(message + "\n", { status: statut, headers: { "Content-Type": "text/plain; charset=utf-8", ...ENTETES, ...entetes } });

function resultat(req, env, etat) {
  const site = siteDe(req, env);
  // Adresse du site inconnue (ORIGINES vide) : message en texte brut plutôt qu'une redirection vers une adresse incertaine.
  if (!site) return texteBrut(etat === "succes" ? 200 : etat === "invalide" ? 400 : 500, MESSAGES[etat]);
  const cible = `${site}/alertes-desactivees.html${etat === "succes" ? "" : "?etat=" + etat}`;
  return new Response(null, { status: 303, headers: { Location: cible, ...ENTETES } });
}

// GET ?jeton=… : désactive les alertes (seul le champ preferences_alertes.actives est écrit, à false).
export async function desinscrire(req, env, fetchImpl = fetch, maintenant = new Date()) {
  if (req.method !== "GET") return texteBrut(405, "Méthode non autorisée : ouvre le lien reçu par e-mail.", { Allow: "GET" });
  if (!env.ALERTES_SECRET) return resultat(req, env, "erreur");
  const id = await verifierJeton(new URL(req.url).searchParams.get("jeton"), env.ALERTES_SECRET, maintenant);
  if (!id) return resultat(req, env, "invalide");
  try {
    // Pas de ligne = réglages par défaut (alertes actives) : on la crée, sinon on ne change que « actives ».
    const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/preferences_alertes?on_conflict=user_id`, {
      method: "POST", headers: { ...entetesService(env), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: id, actives: false })
    });
    // 409 : compte supprimé entre-temps (clé étrangère) ; il n'y a plus d'alerte à envoyer.
    if (!r.ok && r.status !== 409) return resultat(req, env, "erreur");
  } catch {
    return resultat(req, env, "erreur");
  }
  return resultat(req, env, "succes");
}

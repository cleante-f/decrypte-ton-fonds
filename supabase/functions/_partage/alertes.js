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

function octetsBase64url(texte) {
  const binaire = atob(texte.replace(/-/g, "+").replace(/_/g, "/") + "=");
  return Uint8Array.from(binaire, c => c.charCodeAt(0));
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
    const cle = await crypto.subtle.importKey("raw", encodeur.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valide = await crypto.subtle.verify("HMAC", cle, octetsBase64url(signature), encodeur.encode(`${id}.${date}`));
    return valide ? id : null;
  } catch {
    return null;
  }
}

const echapper = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Petite page autonome (aucune ressource externe). Ne contient jamais le jeton ni l'identifiant de l'utilisateur.
function page(statut, titre, message, entetes = {}) {
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${echapper(titre)} · Décrypte ton fonds</title>
<style>
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f5f0; color: #1d2b24; line-height: 1.5; }
main { max-width: 32rem; margin: 15vh auto 0; padding: 0 16px; }
h1 { font-size: 1.5rem; color: #1f4d3a; }
a { color: #1f4d3a; }
</style>
</head>
<body>
<main>
<h1>${echapper(titre)}</h1>
${message}
</main>
</body>
</html>
`;
  return new Response(html, { status: statut, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", ...entetes } });
}

const pageSucces = (req, env) => {
  const site = siteDe(req, env);
  const lien = site ? `<a href="${echapper(site + "/compte.html")}">Mon compte</a>` : "Mon compte";
  return page(200, "Alertes désactivées", `<p>Vous ne recevrez plus d'e-mails d'alerte sur vos fonds suivis.</p>
<p>Vous pouvez les réactiver à tout moment depuis ${lien}.</p>`);
};
const pageInvalide = () => page(400, "Lien invalide ou expiré",
  "<p>Ce lien de désinscription n'est pas valable ou a expiré. Vous pouvez désactiver les alertes depuis Mon compte, sur le site.</p>");
const pageErreur = () => page(500, "Erreur", "<p>Une erreur est survenue. Réessayez plus tard.</p>");

// GET ?jeton=… : désactive les alertes (seul le champ preferences_alertes.actives est écrit, à false).
export async function desinscrire(req, env, fetchImpl = fetch, maintenant = new Date()) {
  if (req.method !== "GET") return page(405, "Méthode non autorisée", "<p>Ouvrez le lien reçu par e-mail.</p>", { Allow: "GET" });
  if (!env.ALERTES_SECRET) return pageErreur();
  const id = await verifierJeton(new URL(req.url).searchParams.get("jeton"), env.ALERTES_SECRET, maintenant);
  if (!id) return pageInvalide();
  try {
    // Pas de ligne = réglages par défaut (alertes actives) : on la crée, sinon on ne change que « actives ».
    const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/preferences_alertes?on_conflict=user_id`, {
      method: "POST", headers: { ...entetesService(env), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: id, actives: false })
    });
    // 409 : compte supprimé entre-temps (clé étrangère) ; il n'y a plus d'alerte à envoyer.
    if (!r.ok && r.status !== 409) return pageErreur();
  } catch {
    return pageErreur();
  }
  return pageSucces(req, env);
}

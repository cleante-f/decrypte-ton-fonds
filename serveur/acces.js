/*
 * Contrôle d'accès au simulateur (Cloudflare Pages Functions).
 * _routes.json fait passer ici toutes les adresses, sauf des fichiers publics nommés exactement : le filtre de Cloudflare
 * compare l'adresse telle qu'elle est écrite, alors que le serveur de fichiers la décode (« /js/%73imulateur.js » sert
 * « /js/simulateur.js »). L'adresse est donc décodée avant d'être comparée aux chemins protégés.
 * Le cookie « dtf_session » contient le jeton d'accès Supabase ; c'est Supabase qui vérifie sa signature en exécutant
 * droit_acces() avec ce jeton (un jeton faux, expiré ou révoqué est refusé). Décision gardée 60 s par jeton.
 * Adresse et clé publique de Supabase : variables de Cloudflare si elles existent, sinon celles de js/config-compte.js.
 */
export const CHEMINS_PROTEGES = ["/simulateur", "/simulateur.html", "/js/simulateur.js", "/js/projection.js", "/js/graphiques-simu.js",
  "/js/contexte-fonds.js", "/data/contexte.js"];
const PROTEGES = new Set(CHEMINS_PROTEGES.map(c => c.toLowerCase()));
const DUREE_DECISION = 60;

// Forme comparable d'une adresse : décodée (plusieurs fois au besoin), « \ » lu comme « / », sans « . », « .. »,
// « // » ni « / » final, en minuscules. null si elle est mal encodée.
export function cheminCanonique(chemin) {
  let d = chemin;
  for (let i = 0; i < 3 && d.includes("%"); i++) {
    try { d = decodeURIComponent(d); } catch (e) { return null; }
  }
  const morceaux = [];
  for (const m of d.replace(/\\/g, "/").split("/")) {
    if (m === "" || m === ".") continue;
    if (m === "..") morceaux.pop(); else morceaux.push(m);
  }
  return ("/" + morceaux.join("/")).toLowerCase();
}

export const estProtege = chemin => { const c = cheminCanonique(chemin); return c === null || PROTEGES.has(c); };
const reglage = (env, nom, champ) => (env && env[nom]) || globalThis.CONFIG_COMPTE?.[champ];

export function lireCookie(entete, nom) {
  for (const morceau of (entete || "").split(";")) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i).trim() === nom) return morceau.slice(i + 1).trim();
  }
  return "";
}

async function empreinte(texte) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
  return [...h].map(o => o.toString(16).padStart(2, "0")).join("");
}

async function droits(jeton, env, fetchImpl, cache) {
  const cle = cache && new Request(`https://cache.interne/droits/${await empreinte(jeton)}`);
  if (cache) {
    const garde = await cache.match(cle);
    if (garde) return garde.json();
  }
  const r = await fetchImpl(`${reglage(env, "SUPABASE_URL", "supabaseUrl")}/rest/v1/rpc/droit_acces`, {
    method: "POST", body: "{}",
    headers: { apikey: reglage(env, "SUPABASE_PUBLISHABLE_KEY", "supabaseCle"), Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const d = await r.json();
  if (cache) await cache.put(cle, new Response(JSON.stringify(d), { headers: { "Cache-Control": `max-age=${DUREE_DECISION}` } }));
  return d;
}

const texte = (corps, statut, entetes = {}) =>
  new Response(corps, { status: statut, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...entetes } });
const vers = (url, chemin) => new Response(null, { status: 302, headers: { Location: new URL(chemin, url).href, "Cache-Control": "no-store" } });

export async function controlerAcces(requete, env, suivant, { fetchImpl = fetch, cache = null } = {}) {
  const url = new URL(requete.url);
  const chemin = cheminCanonique(url.pathname);
  if (chemin === null) return texte("Adresse invalide.", 400);
  if (!PROTEGES.has(chemin)) return suivant();
  const estPage = chemin === "/simulateur" || chemin.endsWith(".html");
  const jeton = lireCookie(requete.headers.get("Cookie"), "dtf_session");
  let d = null;
  if (jeton) {
    try { d = await droits(jeton, env, fetchImpl, cache); } catch (e) {
      return texte("Le service de comptes ne répond pas. Réessaie dans un instant.", 503, { "Retry-After": "30" });
    }
  }
  if (d && d.acces) {
    const fichier = await suivant();
    const r = new Response(fichier.body, fichier);
    r.headers.set("Cache-Control", "private, no-store");
    r.headers.set("Vary", "Cookie");
    return r;
  }
  if (!estPage) return texte("Accès réservé aux comptes.", 403);
  if (jeton && !d) return vers(url, `/connexion.html?vue=connexion&retour=${encodeURIComponent(url.pathname + url.search)}`);
  return vers(url, "/abonnement.html");
}

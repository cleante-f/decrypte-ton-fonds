// Outils communs des fonctions serveur Supabase (Deno), en JavaScript standard pour être testés avec Node.

export const json = (corps, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", ...entetes } });

const origines = env => (env.ORIGINES || "").split(",").map(s => s.trim()).filter(Boolean);
export const siteDe = (req, env) => { const o = req.headers.get("Origin"); return origines(env).includes(o) ? o : origines(env)[0]; };
export const entetesCors = (req, env) => ({ "Access-Control-Allow-Origin": siteDe(req, env) || "", Vary: "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });

export function entetesService(env) {
  const cle = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: cle, "Content-Type": "application/json" };
  if (cle && cle.split(".").length === 3) h.Authorization = `Bearer ${cle}`;   // ancienne clé au format JWT
  return h;
}

export async function utilisateurDepuisRequete(req, env, fetchImpl = fetch) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: auth } });
  return r.ok ? r.json() : null;
}

export async function lireProfil(env, id, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/profils?id=eq.${encodeURIComponent(id)}&select=*`, { headers: entetesService(env) });
  if (!r.ok) throw new Error(`profil ${r.status}`);
  return (await r.json())[0] || null;
}
export async function profilParClient(env, client, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/profils?stripe_client=eq.${encodeURIComponent(client)}&select=*`, { headers: entetesService(env) });
  if (!r.ok) throw new Error(`profil ${r.status}`);
  return (await r.json())[0] || null;
}
export async function majProfil(env, id, champs, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/profils?id=eq.${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { ...entetesService(env), Prefer: "return=minimal" }, body: JSON.stringify(champs) });
  if (!r.ok) throw new Error(`mise à jour du profil ${r.status}`);
}

export const estAbonne = p => !!p && ["actif", "resilie_fin_periode"].includes(p.abonnement_statut) && !!p.abonnement_fin && new Date(p.abonnement_fin) > new Date();

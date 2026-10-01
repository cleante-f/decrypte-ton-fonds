// Suppression d'un compte (à la demande, ou après 2 ans d'inactivité) et entretien quotidien.
import { json, entetesCors, entetesService, utilisateurDepuisRequete, lireProfil, majProfil, siteDe } from "./outils.js";
import { appelStripe } from "./stripe.js";

const egaux = (a, b) => { a = String(a || ""); b = String(b || ""); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Arrête un abonnement en cours (sans remboursement automatique), puis efface le compte : profil et simulations suivent (cascade).
// Le client Stripe et ses factures restent chez Stripe (obligation comptable de 10 ans).
export async function effacerUtilisateur(env, id, profil, fetchImpl = fetch) {
  if (profil && profil.stripe_abonnement && !["termine", "aucun"].includes(profil.abonnement_statut)) {
    try { await appelStripe(env, `/v1/subscriptions/${profil.stripe_abonnement}`, {}, { methode: "DELETE", fetchImpl }); }
    catch (e) { if (!/404/.test(e.message)) throw e; }
  }
  const r = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: entetesService(env) });
  if (!r.ok) throw new Error(`suppression du compte ${r.status}`);
}

export async function supprimerCompte(req, env, fetchImpl = fetch) {
  const cors = entetesCors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const u = await utilisateurDepuisRequete(req, env, fetchImpl);
  if (!u) return json({ erreur: "non_connecte" }, 401, cors);
  await effacerUtilisateur(env, u.id, await lireProfil(env, u.id, fetchImpl), fetchImpl);
  return json({ supprime: true }, 200, cors);
}

async function avertir(env, email, fetchImpl) {
  const site = (env.ORIGINES || "").split(",")[0].trim();
  const r = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.EMAIL_EXPEDITEUR, name: "Décrypte ton fonds" }, to: [{ email }],
      subject: "Ton compte Décrypte ton fonds sera supprimé dans 30 jours",
      htmlContent: `<p>Bonjour,</p><p>Tu ne t'es pas connecté à Décrypte ton fonds depuis près de 2 ans. Pour protéger tes données,
        ton compte et tes simulations seront <strong>supprimés dans 30 jours</strong>.</p>
        <p>Pour garder ton compte, il suffit de te connecter : <a href="${site}/connexion.html?vue=connexion">${site}/connexion.html</a>.</p>
        <p>Sinon, tu n'as rien à faire.</p>` })
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}`);
}

export async function entretenir(req, env, fetchImpl = fetch) {
  if (!env.ENTRETIEN_SECRET || !egaux(req.headers.get("x-entretien"), env.ENTRETIEN_SECRET)) return json({ erreur: "refuse" }, 401);
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/comptes_a_entretenir`, { method: "POST", headers: entetesService(env), body: "{}" });
  if (!r.ok) throw new Error(`comptes_a_entretenir ${r.status}`);
  let avertis = 0, supprimes = 0;
  for (const c of await r.json()) {
    if (c.action === "avertir") {
      await avertir(env, c.email, fetchImpl);
      await majProfil(env, c.id, { avertissement_inactivite_le: new Date().toISOString() }, fetchImpl);
      avertis++;
    } else if (c.action === "supprimer") {
      await effacerUtilisateur(env, c.id, await lireProfil(env, c.id, fetchImpl), fetchImpl);
      supprimes++;
    }
  }
  return json({ avertis, supprimes });
}

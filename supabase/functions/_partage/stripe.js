// Stripe sans SDK : API REST (formulaires encodés) et vérification de signature des webhooks (HMAC-SHA256, WebCrypto).
import { json, entetesCors, siteDe, utilisateurDepuisRequete, lireProfil, profilParClient, majProfil, estAbonne } from "./outils.js";

export function encoderFormulaire(objet, prefixe = "") {
  const morceaux = [];
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === undefined || valeur === null) continue;
    const nom = prefixe ? `${prefixe}[${cle}]` : cle;
    if (typeof valeur === "object") morceaux.push(encoderFormulaire(valeur, nom));
    else morceaux.push(`${encodeURIComponent(nom)}=${encodeURIComponent(String(valeur))}`);
  }
  return morceaux.filter(Boolean).join("&");
}

export async function appelStripe(env, chemin, params = {}, { methode = "POST", idempotence, fetchImpl = fetch } = {}) {
  const h = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotence) h["Idempotency-Key"] = idempotence;
  const r = await fetchImpl(`https://api.stripe.com${chemin}`, { method: methode, headers: h, body: methode === "GET" ? undefined : encoderFormulaire(params) });
  const d = await r.json();
  if (!r.ok) throw new Error(`Stripe ${r.status} : ${(d.error && d.error.message) || "erreur"}`);
  return d;
}

const egaux = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function verifierSignature(corps, entete, secret, maintenant = Math.floor(Date.now() / 1000), tolerance = 300) {
  let t = 0;
  const signatures = [];
  for (const partie of (entete || "").split(",")) {
    const [cle, valeur] = partie.split("=");
    if (cle === "t") t = Number(valeur); else if (cle === "v1" && valeur) signatures.push(valeur);
  }
  if (!t || !signatures.length || Math.abs(maintenant - t) > tolerance) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(`${t}.${corps}`)));
  const attendu = [...mac].map(o => o.toString(16).padStart(2, "0")).join("");
  return signatures.some(s => egaux(s, attendu));
}

export function statutDepuisAbonnement(sub, type) {
  if (type === "customer.subscription.deleted") return "termine";
  switch (sub.status) {
    case "active": case "trialing": return sub.cancel_at_period_end || sub.cancel_at ? "resilie_fin_periode" : "actif";
    case "past_due": case "unpaid": return "impaye";
    case "canceled": case "incomplete_expired": return "termine";
    default: return "aucun";
  }
}

export function finDePeriode(sub) {
  const s = sub.current_period_end ?? (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) ?? null;
  return s ? new Date(s * 1000).toISOString() : null;
}

export async function traiterEvenement(evt, env, fetchImpl = fetch) {
  const objet = evt.data && evt.data.object;
  if (evt.type === "checkout.session.completed") {
    if (objet.client_reference_id && objet.customer) await majProfil(env, objet.client_reference_id, { stripe_client: objet.customer }, fetchImpl);
    return "lie";
  }
  if (!/^customer\.subscription\.(created|updated|deleted)$/.test(evt.type)) return "ignore";
  const idMeta = objet.metadata && objet.metadata.user_id;
  const profil = (idMeta && await lireProfil(env, idMeta, fetchImpl)) || await profilParClient(env, objet.customer, fetchImpl);
  if (!profil) return "inconnu";
  const date = new Date(evt.created * 1000).toISOString();
  const statut = statutDepuisAbonnement(objet, evt.type);
  if (profil.abonnement_evenement) {
    const dernier = new Date(profil.abonnement_evenement).getTime(), courant = new Date(date).getTime();
    if (courant < dernier || (courant === dernier && statut === "aucun")) return "ancien";
  }
  await majProfil(env, profil.id, { abonnement_statut: statut, abonnement_fin: finDePeriode(objet), stripe_abonnement: objet.id,
    stripe_client: objet.customer, abonnement_evenement: date }, fetchImpl);
  return "maj";
}

export async function creerPaiement(req, env, fetchImpl = fetch) {
  const cors = entetesCors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const u = await utilisateurDepuisRequete(req, env, fetchImpl);
  if (!u) return json({ erreur: "non_connecte" }, 401, cors);
  const p = await lireProfil(env, u.id, fetchImpl);
  if (!p) return json({ erreur: "profil_absent" }, 404, cors);
  if (estAbonne(p)) return json({ erreur: "deja_abonne" }, 409, cors);
  if (!p.execution_immediate_demandee_le) return json({ erreur: "execution_immediate_requise" }, 400, cors);
  let client = p.stripe_client;
  if (!client) {
    client = (await appelStripe(env, "/v1/customers", { email: u.email, metadata: { user_id: u.id } }, { idempotence: `client-${u.id}`, fetchImpl })).id;
    await majProfil(env, u.id, { stripe_client: client }, fetchImpl);
  }
  const site = siteDe(req, env);
  const session = await appelStripe(env, "/v1/checkout/sessions", {
    mode: "subscription", customer: client, client_reference_id: u.id, locale: "fr",
    line_items: [{ price: env.STRIPE_PRIX, quantity: 1 }],
    subscription_data: { metadata: { user_id: u.id } },
    success_url: `${site}/simulateur.html?abonnement=ok`, cancel_url: `${site}/abonnement.html`
  }, { fetchImpl });
  return json({ url: session.url }, 200, cors);
}

export async function creerPortail(req, env, fetchImpl = fetch) {
  const cors = entetesCors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const u = await utilisateurDepuisRequete(req, env, fetchImpl);
  if (!u) return json({ erreur: "non_connecte" }, 401, cors);
  const p = await lireProfil(env, u.id, fetchImpl);
  if (!p || !p.stripe_client) return json({ erreur: "aucun_abonnement" }, 404, cors);
  const s = await appelStripe(env, "/v1/billing_portal/sessions", { customer: p.stripe_client, return_url: `${siteDe(req, env)}/compte.html` }, { fetchImpl });
  return json({ url: s.url }, 200, cors);
}

export async function recevoirWebhook(req, env, fetchImpl = fetch) {
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });
  const corps = await req.text();
  if (!(await verifierSignature(corps, req.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return new Response("Signature invalide", { status: 400 });
  const evt = JSON.parse(corps);
  console.log("événement Stripe", evt.type, JSON.stringify(Object.keys((evt.data && evt.data.object) || {})));   // champs réels, sans données personnelles
  return json({ recu: true, resultat: await traiterEvenement(evt, env, fetchImpl) });
}

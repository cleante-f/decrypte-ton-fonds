import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { encoderFormulaire, verifierSignature, statutDepuisAbonnement, finDePeriode, traiterEvenement, creerPaiement } from "../supabase/functions/_partage/stripe.js";

const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_PRIX: "price_1", ORIGINES: "https://site.pages.dev,http://localhost:8770" };

// Faux réseau : chaque appel est noté ; les réponses sont choisies selon l'adresse
function reseau(routes) {
  const appels = [];
  const f = async (url, options = {}) => {
    appels.push({ url, options });
    for (const [motif, reponse] of routes) if (url.includes(motif)) {
      const r = typeof reponse === "function" ? reponse(url, options) : reponse;
      return new Response(r.corps === undefined ? null : JSON.stringify(r.corps), { status: r.statut || 200 });
    }
    throw new Error("appel inattendu : " + url);
  };
  return { f, appels };
}

test("encoderFormulaire : tableaux et objets imbriqués au format Stripe", () => {
  assert.equal(encoderFormulaire({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { user_id: "u 1" } }),
    "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buser_id%5D=u%201");
});

test("signature : valide, falsifiée, trop ancienne", async () => {
  const corps = '{"id":"evt_1"}', t = 1700000000;
  const sig = createHmac("sha256", "whsec_test").update(`${t}.${corps}`).digest("hex");
  assert.equal(await verifierSignature(corps, `t=${t},v1=${sig}`, "whsec_test", t + 10), true);
  assert.equal(await verifierSignature(corps, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, "whsec_test", t + 10), true);
  assert.equal(await verifierSignature(corps + " ", `t=${t},v1=${sig}`, "whsec_test", t + 10), false);
  assert.equal(await verifierSignature(corps, `t=${t},v1=${sig}`, "whsec_test", t + 400), false);
  assert.equal(await verifierSignature(corps, null, "whsec_test", t), false);
});

test("statut : correspondance avec les états Stripe", () => {
  assert.equal(statutDepuisAbonnement({ status: "active", cancel_at_period_end: false }), "actif");
  assert.equal(statutDepuisAbonnement({ status: "active", cancel_at_period_end: true }), "resilie_fin_periode");
  assert.equal(statutDepuisAbonnement({ status: "active", cancel_at_period_end: false, cancel_at: 1800000000 }), "resilie_fin_periode");
  assert.equal(statutDepuisAbonnement({ status: "past_due" }), "impaye");
  assert.equal(statutDepuisAbonnement({ status: "canceled" }), "termine");
  assert.equal(statutDepuisAbonnement({ status: "active" }, "customer.subscription.deleted"), "termine");
  assert.equal(statutDepuisAbonnement({ status: "incomplete" }), "aucun");
});

test("fin de période : ancien et nouveau format de l'API", () => {
  assert.equal(finDePeriode({ current_period_end: 1800000000 }), "2027-01-15T08:00:00.000Z");
  assert.equal(finDePeriode({ items: { data: [{ current_period_end: 1800000000 }] } }), "2027-01-15T08:00:00.000Z");
  assert.equal(finDePeriode({}), null);
});

test("webhook : un événement plus ancien que le dernier appliqué est ignoré", async () => {
  const { f, appels } = reseau([["/rest/v1/profils?id=eq.u1", { corps: [{ id: "u1", abonnement_evenement: "2026-10-02T10:00:00.000Z" }] }]]);
  const evt = { type: "customer.subscription.updated", created: Date.parse("2026-10-02T09:00:00Z") / 1000,
    data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { user_id: "u1" } } } };
  assert.equal(await traiterEvenement(evt, env, f), "ancien");
  assert.equal(appels.filter(a => a.options.method === "PATCH").length, 0);
});

test("webhook : abonnement actif appliqué au bon profil", async () => {
  let maj = null;
  const { f } = reseau([["/rest/v1/profils?id=eq.u1", (url, o) => (o.method === "PATCH" ? (maj = JSON.parse(o.body), { statut: 204 }) : { corps: [{ id: "u1", abonnement_evenement: null }] })]]);
  const evt = { type: "customer.subscription.created", created: 1800000000,
    data: { object: { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: { user_id: "u1" }, items: { data: [{ current_period_end: 1802592000 }] } } } };
  assert.equal(await traiterEvenement(evt, env, f), "maj");
  assert.deepEqual(maj, { abonnement_statut: "actif", abonnement_fin: "2027-02-14T08:00:00.000Z", stripe_abonnement: "sub_1", stripe_client: "cus_1", abonnement_evenement: "2027-01-15T08:00:00.000Z" });
});

const requeteNavigateur = () => new Request("https://p.supabase.co/functions/v1/paiement", { method: "POST", headers: { Authorization: "Bearer jeton", Origin: "http://localhost:8770" }, body: "{}" });

test("paiement : refusé pour un abonné (pas de second abonnement)", async () => {
  const { f, appels } = reseau([
    ["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }],
    ["/rest/v1/profils?id=eq.u1", { corps: [{ id: "u1", abonnement_statut: "actif", abonnement_fin: "2999-01-01T00:00:00Z", execution_immediate_demandee_le: "2026-10-01T00:00:00Z" }] }]]);
  const r = await creerPaiement(requeteNavigateur(), env, f);
  assert.equal(r.status, 409);
  assert.equal(appels.some(a => a.url.includes("api.stripe.com")), false);
});

test("paiement : client créé une seule fois (idempotence), puis session Checkout", async () => {
  const { f, appels } = reseau([
    ["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }],
    ["/rest/v1/profils?id=eq.u1", (url, o) => (o.method === "PATCH" ? { statut: 204 } : { corps: [{ id: "u1", abonnement_statut: "aucun", stripe_client: null, execution_immediate_demandee_le: "2026-10-01T00:00:00Z" }] })],
    ["api.stripe.com/v1/customers", { corps: { id: "cus_9" } }],
    ["api.stripe.com/v1/checkout/sessions", { corps: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } }]]);
  const r = await creerPaiement(requeteNavigateur(), env, f);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  const client = appels.find(a => a.url.endsWith("/v1/customers"));
  assert.equal(client.options.headers["Idempotency-Key"], "client-u1");
  const session = decodeURIComponent(appels.find(a => a.url.endsWith("/v1/checkout/sessions")).options.body);
  assert.match(session, /customer=cus_9/);
  assert.match(session, /success_url=http:\/\/localhost:8770\/simulateur\.html\?abonnement=ok/);
  assert.match(session, /subscription_data\[metadata\]\[user_id\]=u1/);
});

test("paiement : l'exécution immédiate doit avoir été demandée", async () => {
  const { f } = reseau([
    ["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }],
    ["/rest/v1/profils?id=eq.u1", { corps: [{ id: "u1", abonnement_statut: "aucun", execution_immediate_demandee_le: null }] }]]);
  const r = await creerPaiement(requeteNavigateur(), env, f);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { erreur: "execution_immediate_requise" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { supprimerCompte, entretenir } from "../supabase/functions/_partage/comptes.js";

const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", STRIPE_SECRET_KEY: "sk_test_x",
  ORIGINES: "https://site.pages.dev", BREVO_API_KEY: "xkeysib-test", EMAIL_EXPEDITEUR: "contact@exemple.fr", ENTRETIEN_SECRET: "s3cret" };
function reseau(routes) {
  const appels = [];
  const f = async (url, options = {}) => {
    appels.push({ url, options });
    for (const [motif, r] of routes) if (url.includes(motif) && (!r.methode || r.methode === (options.method || "GET")))
      return new Response(r.corps === undefined ? null : JSON.stringify(r.corps), { status: r.statut || 200 });
    throw new Error("appel inattendu : " + (options.method || "GET") + " " + url);
  };
  return { f, appels };
}
const req = (entetes = {}) => new Request("https://p.supabase.co/functions/v1/x", { method: "POST", headers: { Origin: "https://site.pages.dev", ...entetes }, body: "{}" });

test("suppression : abonnement Stripe arrêté puis compte effacé", async () => {
  const { f, appels } = reseau([
    ["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }],
    ["/rest/v1/profils?id=eq.u1", { corps: [{ id: "u1", stripe_abonnement: "sub_1", abonnement_statut: "actif", abonnement_fin: "2999-01-01T00:00:00Z" }] }],
    ["api.stripe.com/v1/subscriptions/sub_1", { methode: "DELETE", corps: { id: "sub_1", status: "canceled" } }],
    ["/auth/v1/admin/users/u1", { methode: "DELETE", corps: {} }]]);
  const r = await supprimerCompte(req({ Authorization: "Bearer jeton" }), env, f);
  assert.equal(r.status, 200);
  const ordre = appels.map(a => `${a.options.method || "GET"} ${new URL(a.url).pathname}`);
  assert.ok(ordre.indexOf("DELETE /v1/subscriptions/sub_1") < ordre.indexOf("DELETE /auth/v1/admin/users/u1"));
});

test("suppression : sans abonnement, pas d'appel à Stripe", async () => {
  const { f, appels } = reseau([
    ["/auth/v1/user", { corps: { id: "u2", email: "c@d.fr" } }],
    ["/rest/v1/profils?id=eq.u2", { corps: [{ id: "u2", stripe_abonnement: null, abonnement_statut: "aucun" }] }],
    ["/auth/v1/admin/users/u2", { methode: "DELETE", corps: {} }]]);
  assert.equal((await supprimerCompte(req({ Authorization: "Bearer j" }), env, f)).status, 200);
  assert.equal(appels.some(a => a.url.includes("stripe")), false);
});

test("entretien : refusé sans le bon secret", async () => {
  const { f } = reseau([]);
  assert.equal((await entretenir(req({ "x-entretien": "mauvais" }), env, f)).status, 401);
});

test("entretien : avertit par e-mail puis supprime après le délai", async () => {
  const { f, appels } = reseau([
    ["/rest/v1/rpc/comptes_a_entretenir", { corps: [{ id: "u3", email: "e@f.fr", action: "avertir" }, { id: "u4", email: "g@h.fr", action: "supprimer" }] }],
    ["api.brevo.com/v3/smtp/email", { methode: "POST", statut: 201, corps: { messageId: "m1" } }],
    ["/rest/v1/profils?id=eq.u3", { methode: "PATCH", statut: 204 }],
    ["/rest/v1/profils?id=eq.u4", { corps: [{ id: "u4", stripe_abonnement: null, abonnement_statut: "termine" }] }],
    ["/auth/v1/admin/users/u4", { methode: "DELETE", corps: {} }]]);
  const r = await entretenir(req({ "x-entretien": "s3cret" }), env, f);
  assert.deepEqual(await r.json(), { avertis: 1, supprimes: 1 });
  const mail = JSON.parse(appels.find(a => a.url.includes("brevo")).options.body);
  assert.equal(mail.to[0].email, "e@f.fr");
  assert.equal(appels.find(a => a.url.includes("brevo")).options.headers["api-key"], "xkeysib-test");
});

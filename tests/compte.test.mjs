// Tests de js/compte.js (script classique) chargé dans un contexte Node isolé avec un faux navigateur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../js/compte.js", import.meta.url), "utf8") + "\n;globalThis.Compte = Compte;";

function navigateur(reponses) {
  const stockage = new Map(), cookies = [], appels = [];
  const ctx = {
    CONFIG_COMPTE: { supabaseUrl: "https://projet.supabase.co", supabaseCle: "sb_publishable_test", versionCgv: "2026-10", simulationsOffertes: 3 },
    localStorage: { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: k => stockage.delete(k) },
    document: { set cookie(v) { cookies.push(v); }, get cookie() { return ""; }, getElementById: () => null },
    location: { href: "http://localhost:8770/connexion.html", hash: "", pathname: "/connexion.html", search: "" },
    history: { replaceState() {} },
    URL, URLSearchParams, JSON, Date, Math, Promise, Error,
    fetch: async (url, options = {}) => {
      appels.push({ url, options });
      const r = reponses.shift();
      if (!r) throw new Error("appel inattendu : " + url);
      return { ok: r.statut >= 200 && r.statut < 300, status: r.statut, text: async () => (r.corps === undefined ? "" : JSON.stringify(r.corps)) };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { Compte: ctx.Compte, stockage, cookies, appels, ctx };
}
const maintenant = () => Math.floor(Date.now() / 1000);
const jetonRep = (exp = 3600) => ({ statut: 200, corps: { access_token: "jeton-1", refresh_token: "rafraichi-1", expires_in: exp, expires_at: maintenant() + exp, user: { id: "u1", email: "a@b.fr" } } });

test("connecter : e-mail nettoyé, session gardée et cookie posé", async () => {
  const n = navigateur([jetonRep()]);
  await n.Compte.connecter("  A@B.FR ", "motdepasse123", "captcha");
  const corps = JSON.parse(n.appels[0].options.body);
  assert.equal(corps.email, "a@b.fr");
  assert.equal(corps.gotrue_meta_security.captcha_token, "captcha");
  assert.match(n.appels[0].url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(n.Compte.session().user.email, "a@b.fr");
  assert.match(n.cookies.at(-1), /^dtf_session=jeton-1; Path=\/; Max-Age=3\d{3}; Secure; SameSite=Lax$/);
});

test("erreur d'identifiants traduite en français", async () => {
  const n = navigateur([{ statut: 400, corps: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" } }]);
  await assert.rejects(n.Compte.connecter("a@b.fr", "x", "c"), e => e.code === "invalid_credentials" && /incorrect/.test(e.message));
});

test("jeton bientôt expiré : rafraîchi avant l'appel, cookie mis à jour", async () => {
  const n = navigateur([jetonRep(30), { statut: 200, corps: { access_token: "jeton-2", refresh_token: "rafraichi-2", expires_in: 3600, user: { id: "u1", email: "a@b.fr" } } }, { statut: 200, corps: { acces: true } }]);
  await n.Compte.connecter("a@b.fr", "x", "c");
  await n.Compte.droits();
  assert.match(n.appels[1].url, /grant_type=refresh_token$/);
  assert.equal(n.appels[2].options.headers.Authorization, "Bearer jeton-2");
  assert.match(n.cookies.at(-1), /^dtf_session=jeton-2;/);
});

test("401 pendant un appel : un rafraîchissement puis un nouvel essai", async () => {
  const n = navigateur([jetonRep(), { statut: 401, corps: { message: "JWT expired" } },
    { statut: 200, corps: { access_token: "jeton-3", refresh_token: "r3", expires_in: 3600, user: { id: "u1", email: "a@b.fr" } } },
    { statut: 204 }]);
  await n.Compte.connecter("a@b.fr", "x", "c");
  await n.Compte.enregistrerSimulation("s1", { plan: { capital: 1000 } });
  assert.equal(n.appels.length, 4);
  assert.equal(n.appels[3].options.headers.Authorization, "Bearer jeton-3");
});

test("rafraîchissement refusé : session effacée et erreur non_connecte", async () => {
  const n = navigateur([jetonRep(10), { statut: 400, corps: { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" } }]);
  await n.Compte.connecter("a@b.fr", "x", "c");
  await assert.rejects(n.Compte.droits(), e => e.code === "non_connecte");
  assert.equal(n.Compte.session(), null);
  assert.match(n.cookies.at(-1), /^dtf_session=; Path=\/; Max-Age=0/);
});

test("quota atteint : le code vient du message de la fonction SQL", async () => {
  const n = navigateur([jetonRep(), { statut: 400, corps: { code: "P0001", message: "quota_atteint", details: null, hint: null } }]);
  await n.Compte.connecter("a@b.fr", "x", "c");
  await assert.rejects(n.Compte.demarrerSimulation("FR0011871128", "Essai"), e => e.code === "quota_atteint" && /3 simulations offertes/.test(e.message));
});

test("retour d'un lien d'e-mail : session lue dans l'adresse", async () => {
  const n = navigateur([{ statut: 200, corps: { id: "u1", email: "a@b.fr" } }]);
  n.ctx.location.hash = `#access_token=jeton-mail&expires_in=3600&refresh_token=r-mail&token_type=bearer&type=signup`;
  const r = await n.Compte.lireRetourEmail();
  assert.equal(r.type, "signup");
  assert.equal(n.Compte.session().access_token, "jeton-mail");
  assert.equal(n.Compte.session().user.email, "a@b.fr");
});

test("lien d'e-mail expiré : erreur lisible", async () => {
  const n = navigateur([]);
  n.ctx.location.hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  const r = await n.Compte.lireRetourEmail();
  assert.match(r.erreur, /expiré/);
});

test("déconnexion : session et cookie effacés même si le réseau échoue", async () => {
  const n = navigateur([jetonRep()]);
  await n.Compte.connecter("a@b.fr", "x", "c");
  await n.Compte.deconnecter();   // le fetch suivant lève « appel inattendu » : ignoré
  assert.equal(n.Compte.session(), null);
  assert.match(n.cookies.at(-1), /Max-Age=0/);
});

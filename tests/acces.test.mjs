import { test } from "node:test";
import assert from "node:assert/strict";
import { controlerAcces, lireCookie, CHEMINS_PROTEGES } from "../serveur/acces.js";

const env = { SUPABASE_URL: "https://projet.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const requete = (chemin, cookie) => new Request("https://site.pages.dev" + chemin, { headers: cookie ? { Cookie: cookie } : {} });
const fichier = () => Promise.resolve(new Response("contenu du simulateur", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=14400" } }));
const supabase = (statut, corps, compteur = { n: 0 }) => async (url, options) => {
  compteur.n++;
  assert.equal(url, "https://projet.supabase.co/rest/v1/rpc/droit_acces");
  assert.equal(options.headers.apikey, "sb_publishable_test");
  return new Response(JSON.stringify(corps), { status: statut });
};

test("lireCookie : plusieurs cookies et valeur avec des =", () => {
  assert.equal(lireCookie("a=1; dtf_session=abc.def=; b=2", "dtf_session"), "abc.def=");
  assert.equal(lireCookie("", "dtf_session"), "");
  assert.equal(lireCookie(null, "dtf_session"), "");
});

test("chemins protégés : page et scripts du simulateur", () => {
  for (const c of ["/simulateur.html", "/simulateur", "/js/simulateur.js", "/js/projection.js", "/js/graphiques-simu.js", "/js/contexte-fonds.js", "/data/contexte.js"])
    assert.ok(CHEMINS_PROTEGES.includes(c), c);
});

test("sans cookie : page de présentation, et 403 pour un script", async () => {
  const r = await controlerAcces(requete("/simulateur.html"), env, fichier, { fetchImpl: supabase(200, {}) });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://site.pages.dev/abonnement.html");
  const js = await controlerAcces(requete("/js/simulateur.js"), env, fichier, { fetchImpl: supabase(200, {}) });
  assert.equal(js.status, 403);
});

test("jeton refusé par Supabase : connexion avec retour", async () => {
  const r = await controlerAcces(requete("/simulateur?sim=abc", "dtf_session=faux"), env, fichier, { fetchImpl: supabase(401, { message: "JWT expired" }) });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://site.pages.dev/connexion.html?vue=connexion&retour=%2Fsimulateur%3Fsim%3Dabc");
});

test("droit d'accès : fichier envoyé, jamais mis en cache public", async () => {
  const r = await controlerAcces(requete("/js/simulateur.js", "dtf_session=bon"), env, fichier, { fetchImpl: supabase(200, { acces: true }) });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "contenu du simulateur");
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.equal(r.headers.get("Vary"), "Cookie");
});

test("connecté sans droit : page d'abonnement", async () => {
  const r = await controlerAcces(requete("/simulateur.html", "dtf_session=bon"), env, fichier, { fetchImpl: supabase(200, { acces: false }) });
  assert.equal(r.headers.get("Location"), "https://site.pages.dev/abonnement.html");
});

test("Supabase en panne : 503 explicite", async () => {
  const r = await controlerAcces(requete("/simulateur.html", "dtf_session=bon"), env, fichier, { fetchImpl: supabase(500, {}) });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("décision gardée 60 s : un seul appel à Supabase par jeton", async () => {
  const memoire = new Map(), compteur = { n: 0 };
  const cache = { match: async cle => memoire.get(cle.url || cle)?.clone(), put: async (cle, rep) => { memoire.set(cle.url || cle, rep.clone()); } };
  const f = supabase(200, { acces: true }, compteur);
  await controlerAcces(requete("/simulateur.html", "dtf_session=bon"), env, fichier, { fetchImpl: f, cache });
  await controlerAcces(requete("/js/simulateur.js", "dtf_session=bon"), env, fichier, { fetchImpl: f, cache });
  assert.equal(compteur.n, 1);
});

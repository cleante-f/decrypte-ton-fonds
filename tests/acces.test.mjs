import { test } from "node:test";
import assert from "node:assert/strict";
import { controlerAcces, lireCookie, CHEMINS_PROTEGES } from "../serveur/acces.js";

const env = { SUPABASE_URL: "https://projet.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const requete = (chemin, cookie) => new Request("https://comptes.decrypte-ton-fonds.pages.dev" + chemin, { headers: cookie ? { Cookie: cookie } : {} });
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
  assert.equal(r.headers.get("Location"), "https://comptes.decrypte-ton-fonds.pages.dev/abonnement.html");
  const js = await controlerAcces(requete("/js/simulateur.js"), env, fichier, { fetchImpl: supabase(200, {}) });
  assert.equal(js.status, 403);
});

test("mode gratuit : tout passe sans cookie", async () => {
  for (const hote of ["decrypte-ton-fonds.pages.dev", "cleante-f.github.io"]) {
    for (const chemin of ["/simulateur.html", "/js/simulateur.js"]) {
      const compteur = { n: 0 };
      const r = await controlerAcces(new Request(`https://${hote}${chemin}`), env, fichier, { fetchImpl: supabase(200, {}, compteur) });
      assert.equal(r.status, 200, hote + chemin);
      assert.equal(await r.text(), "contenu du simulateur", hote + chemin);
      assert.equal(compteur.n, 0, `${hote}${chemin} : Supabase ne doit pas être appelé`);
    }
  }
});

test("hôte écrit avec un point final : toujours en mode comptes, donc protégé", async () => {
  const r = await controlerAcces(new Request("https://comptes.decrypte-ton-fonds.pages.dev./simulateur.html"), env, fichier, { fetchImpl: supabase(200, {}) });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get("Location")).pathname, "/abonnement.html");
});

test("jeton refusé par Supabase : connexion avec retour", async () => {
  const r = await controlerAcces(requete("/simulateur?sim=abc", "dtf_session=faux"), env, fichier, { fetchImpl: supabase(401, { message: "JWT expired" }) });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://comptes.decrypte-ton-fonds.pages.dev/connexion.html?vue=connexion&retour=%2Fsimulateur%3Fsim%3Dabc");
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
  assert.equal(r.headers.get("Location"), "https://comptes.decrypte-ton-fonds.pages.dev/abonnement.html");
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

// ---- Adresses déguisées : le serveur de fichiers décode l'adresse, le contrôle doit la décoder aussi ----
const { readFileSync, existsSync } = await import("node:fs");
const { estProtege } = await import("../serveur/acces.js");
const sansSupabase = async () => { throw new Error("Supabase ne doit pas être appelé"); };

test("adresses déguisées du simulateur : reconnues comme protégées", () => {
  for (const c of ["/js/%73imulateur.js", "/%6As/simulateur.js", "/js%2Fsimulateur.js", "/js//simulateur.js", "/SIMULATEUR.HTML",
    "/Js/Simulateur.js", "/simulateur/", "/simulateur.html/", "/data/contexte.js/", "/js/%2e/simulateur.js", "/js/x/%2e%2e/simulateur.js",
    "/data%5Ccontexte.js"])
    assert.ok(estProtege(c), c);
  for (const c of ["/", "/index.html", "/decrypte.html", "/decrypte", "/js/compte.js", "/js/simulateur-aide.js", "/data/contexte.json"])
    assert.ok(!estProtege(c), c);
});

test("adresse déguisée sans cookie : refusée comme l'adresse normale", async () => {
  let servi = false;
  const r = await controlerAcces(requete("/js/%73imulateur.js"), env, () => { servi = true; return fichier(); }, { fetchImpl: sansSupabase });
  assert.equal(r.status, 403);
  assert.equal(servi, false);
});

test("adresse mal encodée : refusée (400), jamais servie", async () => {
  const r = await controlerAcces(requete("/js/%E0%A4%A.js"), env, fichier, { fetchImpl: sansSupabase });
  assert.equal(r.status, 400);
});

test("page publique : envoyée telle quelle, sans appel à Supabase, même avec un cookie", async () => {
  for (const c of ["/decrypte.html", "/js/compte.js", "/"]) {
    const r = await controlerAcces(requete(c, "dtf_session=bon"), env, fichier, { fetchImpl: sansSupabase });
    assert.equal(r.status, 200, c);
    assert.equal(r.headers.get("Cache-Control"), "public, max-age=14400", c);
  }
});

test("réglages par défaut : adresse et clé publique lues dans js/config-compte.js", async () => {
  await import("../js/config-compte.js");
  const C = globalThis.CONFIG_COMPTE;
  assert.ok(C && C.supabaseUrl.startsWith("https://") && C.supabaseCle);
  const f = async (url, options) => {
    assert.equal(url, `${C.supabaseUrl}/rest/v1/rpc/droit_acces`);
    assert.equal(options.headers.apikey, C.supabaseCle);
    return new Response(JSON.stringify({ acces: true }));
  };
  const r = await controlerAcces(requete("/js/simulateur.js", "dtf_session=bon"), {}, fichier, { fetchImpl: f });
  assert.equal(r.status, 200);
});

test("_routes.json : tout passe par le contrôle, sauf des fichiers publics nommés exactement", () => {
  const routes = JSON.parse(readFileSync(new URL("../_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes.include, ["/*"]);
  assert.ok(routes.include.length + routes.exclude.length <= 100);
  for (const c of routes.exclude) {
    assert.ok(!c.includes("*"), `${c} : pas de joker dans les exclusions (une adresse déguisée pourrait s'y glisser)`);
    assert.ok(existsSync(new URL(".." + c, import.meta.url)), `${c} : fichier introuvable`);
    assert.ok(!estProtege(c), `${c} : fichier protégé exclu du contrôle`);
  }
});

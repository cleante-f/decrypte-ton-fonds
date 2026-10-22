import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jetonDesinscription } from "../scripts/alertes.mjs";
import { verifierJeton, desinscrire } from "../supabase/functions/_partage/alertes.js";

const SECRET = "secret-de-test-des-alertes";
const U1 = "11111111-2222-4333-8444-555555555555";
const U2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MAINTENANT = new Date("2026-10-22T10:00:00Z");
const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", ALERTES_SECRET: SECRET,
  ORIGINES: "https://comptes.exemple.pages.dev,http://localhost:8770" };

function reseau(statut = 201) {
  const appels = [];
  const f = async (url, options = {}) => { appels.push({ url, options }); return new Response(null, { status: statut }); };
  return { f, appels };
}
const requete = (jeton, method = "GET") =>
  new Request(`https://p.supabase.co/functions/v1/alertes-desinscription${jeton === undefined ? "" : "?jeton=" + encodeURIComponent(jeton)}`, { method });

test("jeton : valide (produit par scripts/alertes.mjs) → identifiant de l'utilisateur", async () => {
  assert.equal(await verifierJeton(jetonDesinscription(U1, SECRET, "2026-10-22"), SECRET, MAINTENANT), U1);
  assert.equal(await verifierJeton(jetonDesinscription(U1, SECRET, "2026-08-23"), SECRET, MAINTENANT), U1);   // 60 jours
  assert.equal(await verifierJeton(jetonDesinscription(U1, SECRET, "2026-10-23"), SECRET, MAINTENANT), U1);   // décalage d'horloge d'un jour
});

test("jeton : falsifié, d'un autre utilisateur, mal formé, futur ou trop ancien → refusé", async () => {
  const bon = jetonDesinscription(U1, SECRET, "2026-10-20");
  const [, date, sig] = bon.split(".");
  const sigModifiee = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  const refuses = [
    `${U1}.${date}.${sigModifiee}`,                                   // signature falsifiée
    `${U2}.${date}.${sig}`,                                           // autre utilisateur, même signature
    `${U1}.2026-10-21.${sig}`,                                        // autre date, même signature
    jetonDesinscription(U1, "autre-secret", "2026-10-20"),           // mauvais secret
    jetonDesinscription(U1, SECRET, "2026-10-25"),                   // dans le futur
    jetonDesinscription(U1, SECRET, "2026-08-22"),                   // plus de 60 jours
    jetonDesinscription("pas-un-uuid", SECRET, "2026-10-20"),        // identifiant invalide
    jetonDesinscription(U1, SECRET, "2026-02-30"),                   // date impossible
    `${U1}.${date}`, `${bon}.x`, "", "a.b.c", `${U1}.${date}.${sig}=`, `${U1}.${date}.${sig.slice(0, -1)}`,
    `${U1}.${date}.${sig}+`, null, undefined, 42
  ];
  for (const j of refuses) assert.equal(await verifierJeton(j, SECRET, MAINTENANT), null, String(j));
  assert.equal(await verifierJeton(bon, "", MAINTENANT), null);
  assert.equal(await verifierJeton(bon, undefined, MAINTENANT), null);
});

test("jeton : comparaison en temps constant (crypto.subtle.verify), jamais ===", () => {
  const source = readFileSync(new URL("../supabase/functions/_partage/alertes.js", import.meta.url), "utf8");
  assert.match(source, /crypto\.subtle\.verify\(/);
  assert.doesNotMatch(source, /sig\w*\s*===|===\s*sig/i);
});

test("désinscription : méthode autre que GET → 405, rien modifié", async () => {
  const { f, appels } = reseau();
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await desinscrire(requete(jetonDesinscription(U1, SECRET, "2026-10-22"), m), env, f, MAINTENANT);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("Allow"), "GET");
  }
  assert.equal(appels.length, 0);
});

test("désinscription : jeton valide → seul actives=false écrit pour cet utilisateur", async () => {
  const { f, appels } = reseau();
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  const r = await desinscrire(requete(jeton), env, f, MAINTENANT);
  assert.equal(r.status, 200);
  assert.equal(appels.length, 1);
  const { url, options } = appels[0];
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://p.supabase.co/rest/v1/preferences_alertes");
  assert.equal(u.searchParams.get("on_conflict"), "user_id");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), { user_id: U1, actives: false });
  assert.match(options.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(options.headers.apikey, "sb_secret_x");
  const page = await r.text();
  assert.match(page, /Alertes désactivées/);
  assert.match(page, /https:\/\/comptes\.exemple\.pages\.dev\/compte\.html/);
  assert.ok(!page.includes(U1) && !page.includes(jeton.split(".")[2]));
  assert.equal(r.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
});

test("désinscription : jeton refusé → 400 générique, rien modifié, rien répété", async () => {
  const { f, appels } = reseau();
  const bon = jetonDesinscription(U1, SECRET, "2026-10-22");
  const faux = [`${U2}.${bon.split(".").slice(1).join(".")}`, jetonDesinscription(U1, SECRET, "2026-07-01"), "n'importe<quoi>", undefined];
  const pages = [];
  for (const j of faux) {
    const r = await desinscrire(requete(j), env, f, MAINTENANT);
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
    const page = await r.text();
    assert.match(page, /Lien invalide ou expiré/);
    assert.ok(!page.includes(U1) && !page.includes(U2) && !page.includes("quoi"));
    pages.push(page);
  }
  assert.equal(new Set(pages).size, 1);   // aucune indication sur la raison du refus
  assert.equal(appels.length, 0);
});

test("désinscription : secret absent → 500 générique, rien modifié", async () => {
  const { f, appels } = reseau();
  const r = await desinscrire(requete(jetonDesinscription(U1, SECRET, "2026-10-22")), { ...env, ALERTES_SECRET: "" }, f, MAINTENANT);
  assert.equal(r.status, 500);
  assert.equal(appels.length, 0);
  assert.ok(!(await r.text()).includes(U1));
});

test("désinscription : base indisponible → 500 générique ; compte déjà supprimé (409) → page de succès", async () => {
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  const r500 = await desinscrire(requete(jeton), env, reseau(503).f, MAINTENANT);
  assert.equal(r500.status, 500);
  assert.ok(!(await r500.text()).includes(U1));
  const panne = async () => { throw new Error("réseau"); };
  assert.equal((await desinscrire(requete(jeton), env, panne, MAINTENANT)).status, 500);
  const r409 = await desinscrire(requete(jeton), env, reseau(409).f, MAINTENANT);
  assert.equal(r409.status, 200);
  assert.match(await r409.text(), /Alertes désactivées/);
});

test("fonction déployée sans JWT (lien ouvert depuis un e-mail) et secret transmis par le workflow", () => {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.alertes-desinscription\]\s*\nverify_jwt = false/);
  const index = readFileSync(new URL("../supabase/functions/alertes-desinscription/index.ts", import.meta.url), "utf8");
  assert.match(index, /desinscrire/);
  const workflow = readFileSync(new URL("../.github/workflows/supabase.yml", import.meta.url), "utf8");
  assert.match(workflow, /ALERTES_SECRET: \$\{\{ secrets\.ALERTES_SECRET \}\}/);
});

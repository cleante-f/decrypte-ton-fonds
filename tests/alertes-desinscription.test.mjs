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

const PAGE = "https://comptes.exemple.pages.dev/alertes-desactivees.html";
function verifierRedirection(r, cible, jeton) {
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), cible);
  if (jeton) for (const partie of jeton.split(".")) assert.ok(!r.headers.get("Location").includes(partie), "jeton dans Location");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
}

test("jeton : signature non canonique (bits de fin modifiés) → refusée", async () => {
  // 43 caractères base64url = 32 octets + 2 bits inutilisés : trois variantes du dernier caractère décodent les mêmes octets.
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bon = jetonDesinscription(U1, SECRET, "2026-10-20");
  const [id, date, sig] = bon.split(".");
  const i = ALPHABET.indexOf(sig.at(-1));
  const variantes = [1, 2, 3].map(k => `${id}.${date}.${sig.slice(0, -1)}${ALPHABET[(i & ~3) | ((i + k) & 3)]}`);
  assert.equal(new Set(variantes).size, 3);
  for (const v of variantes) assert.equal(await verifierJeton(v, SECRET, MAINTENANT), null, v);
  assert.equal(await verifierJeton(bon, SECRET, MAINTENANT), U1);
});

test("désinscription : méthode autre que GET → 405 en texte brut, rien modifié", async () => {
  const { f, appels } = reseau();
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await desinscrire(requete(jetonDesinscription(U1, SECRET, "2026-10-22"), m), env, f, MAINTENANT);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("Allow"), "GET");
    assert.equal(r.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
  }
  assert.equal(appels.length, 0);
});

test("désinscription : jeton valide → seul actives=false écrit, redirection vers la page du site", async () => {
  const { f, appels } = reseau();
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  const r = await desinscrire(requete(jeton), env, f, MAINTENANT);
  verifierRedirection(r, PAGE, jeton);
  assert.equal(appels.length, 1);
  const { url, options } = appels[0];
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://p.supabase.co/rest/v1/preferences_alertes");
  assert.equal(u.searchParams.get("on_conflict"), "user_id");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), { user_id: U1, actives: false });
  assert.match(options.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(options.headers.apikey, "sb_secret_x");
  const corps = await r.text();
  assert.ok(!corps.includes(U1) && !corps.includes(jeton.split(".")[2]));
});

test("désinscription : jeton refusé → redirection « invalide », rien modifié, aucune raison donnée", async () => {
  const { f, appels } = reseau();
  const bon = jetonDesinscription(U1, SECRET, "2026-10-22");
  const faux = [`${U2}.${bon.split(".").slice(1).join(".")}`, jetonDesinscription(U1, SECRET, "2026-07-01"), "n'importe<quoi>", undefined];
  for (const j of faux) {
    const r = await desinscrire(requete(j), env, f, MAINTENANT);
    verifierRedirection(r, PAGE + "?etat=invalide", typeof j === "string" && j.includes(".") ? j : null);
    const corps = await r.text();
    assert.ok(!corps.includes(U1) && !corps.includes(U2) && !corps.includes("quoi"));
  }
  assert.equal(appels.length, 0);
});

test("désinscription : secret absent → redirection « erreur », rien modifié", async () => {
  const { f, appels } = reseau();
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  const r = await desinscrire(requete(jeton), { ...env, ALERTES_SECRET: "" }, f, MAINTENANT);
  verifierRedirection(r, PAGE + "?etat=erreur", jeton);
  assert.equal(appels.length, 0);
});

test("désinscription : base indisponible → « erreur » ; compte déjà supprimé (409) → succès", async () => {
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  verifierRedirection(await desinscrire(requete(jeton), env, reseau(503).f, MAINTENANT), PAGE + "?etat=erreur", jeton);
  const panne = async () => { throw new Error("réseau"); };
  verifierRedirection(await desinscrire(requete(jeton), env, panne, MAINTENANT), PAGE + "?etat=erreur", jeton);
  verifierRedirection(await desinscrire(requete(jeton), env, reseau(409).f, MAINTENANT), PAGE, jeton);
});

test("désinscription : sans adresse du site (ORIGINES vide) → texte brut, jamais de redirection ailleurs", async () => {
  const jeton = jetonDesinscription(U1, SECRET, "2026-10-22");
  const r = await desinscrire(requete(jeton), { ...env, ORIGINES: "" }, reseau().f, MAINTENANT);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Location"), null);
  assert.equal(r.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.match(await r.text(), /Alertes par e-mail désactivées/);
});

test("page du site alertes-desactivees.html : trois messages, lien vers Mon compte, jamais indexée, aucun stockage", () => {
  const html = readFileSync(new URL("../alertes-desactivees.html", import.meta.url), "utf8");
  const texte = html.replace(/\s+/g, " ");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.ok(texte.includes("Alertes par e-mail désactivées."));
  assert.ok(texte.includes("Tu ne recevras plus d'e-mail d'alerte."));
  assert.ok(texte.includes("Ce lien de désinscription n'est pas valide ou a expiré (60 jours)."));
  assert.ok(texte.includes("Une erreur est survenue, réessaie plus tard ou coupe les alertes dans"));
  assert.ok(html.includes('href="compte.html"'));
  assert.doesNotMatch(html, /<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>/, "pas de script en ligne");
  assert.match(html, /<script src="js\/alertes-desactivees\.js"><\/script>/);
  const script = readFileSync(new URL("../js/alertes-desactivees.js", import.meta.url), "utf8");
  assert.doesNotMatch(script, /localStorage|sessionStorage|cookie|fetch\(/);
  const sitemap = readFileSync(new URL("../scripts/construire_pages.mjs", import.meta.url), "utf8");
  assert.ok(!sitemap.includes("alertes-desactivees"), "absente du plan du site");
});

test("fonction déployée sans JWT (lien ouvert depuis un e-mail) et secret transmis par le workflow", () => {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.alertes-desinscription\]\s*\nverify_jwt = false/);
  const index = readFileSync(new URL("../supabase/functions/alertes-desinscription/index.ts", import.meta.url), "utf8");
  assert.match(index, /desinscrire/);
  const workflow = readFileSync(new URL("../.github/workflows/supabase.yml", import.meta.url), "utf8");
  assert.match(workflow, /ALERTES_SECRET: \$\{\{ secrets\.ALERTES_SECRET \}\}/);
});

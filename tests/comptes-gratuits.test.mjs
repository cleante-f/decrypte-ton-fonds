// Comptes gratuits sur decrypte-ton-fonds.fr (plan du 23/10/2026) : le domaine est en mode comptes, et quand le paiement est coupé
// (CONFIG_COMPTE.paiementActif = false, ou paiement_actif = false dans la réponse de droit_acces), aucun texte payant n'est visible,
// abonnement.html et cgv.html renvoient vers « Mon compte », et le simulateur renvoie vers la connexion au lieu de l'abonnement.
// Le comportement avec le paiement actif est vérifié par les autres tests (acces, pages, pages-compte, stripe…), restés inchangés.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { controlerAcces } from "../serveur/acces.js";
import { creerPaiement } from "../supabase/functions/_partage/stripe.js";
import { PAGES_PRINCIPALES } from "../scripts/construire_pages.mjs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
function charger(fichiers, globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}

// ---------- Adresse : le domaine est en mode comptes ----------

test("decrypte-ton-fonds.fr et www : mode comptes (casse, point final, espaces), hébergeur Cloudflare", () => {
  const { modeSite, hebergeurSite } = charger(["js/mode-site.js"]);
  for (const h of ["decrypte-ton-fonds.fr", "www.decrypte-ton-fonds.fr", "DECRYPTE-TON-FONDS.FR", "Www.Decrypte-Ton-Fonds.fr",
    "decrypte-ton-fonds.fr.", "www.decrypte-ton-fonds.fr.", " decrypte-ton-fonds.fr "]) {
    assert.equal(modeSite(h), "comptes", h);
    assert.equal(hebergeurSite(h), "cloudflare", h);
  }
  // Adresses qui ressemblent : toujours gratuites
  for (const h of ["decrypte-ton-fonds.fr.exemple.org", "xdecrypte-ton-fonds.fr", "faux.decrypte-ton-fonds.fr", "decrypte-ton-fonds.fr..", "decrypte-ton-fonds.com"])
    assert.equal(modeSite(h), "gratuit", h);
});

test("réglage du site : paiement coupé dans js/config-compte.js", async () => {
  const { CONFIG_COMPTE } = charger(["js/config-compte.js"]);
  assert.equal(CONFIG_COMPTE.paiementActif, false);
});

test("paiementActif : réglage du site, puis réponse de droit_acces ; actif par défaut (réglage absent)", () => {
  const avec = config => charger(["js/mode-site.js"], config === undefined ? {} : { CONFIG_COMPTE: config }).paiementActif;
  assert.equal(avec(undefined)(), true);
  assert.equal(avec({})(), true);
  assert.equal(avec({ paiementActif: true })(), true);
  assert.equal(avec({ paiementActif: true })({ paiement_actif: true }), true);
  assert.equal(avec({ paiementActif: true })({ paiement_actif: false }), false);
  assert.equal(avec({ paiementActif: false })(), false);
  assert.equal(avec({ paiementActif: false })({ paiement_actif: true }), false);
});

// ---------- Navigateur simulé : renvoi des pages payantes, éléments cachés ----------

// Faux document : éléments [data-seulement], [data-si-paiement] et liens (pied de page, page) ; fausse adresse qui note les renvois
function naviguer(hostname, pathname, config) {
  const ecouteurs = {}, renvois = [];
  const element = (attributs, parent = null) => {
    const e = { attributs, parentElement: parent, hidden: false,
      getAttribute: n => (n in attributs ? attributs[n] : null), hasAttribute: n => n in attributs,
      closest: sel => {
        assert.equal(sel, ".liens-pied", `closest non simulé : ${sel}`);
        for (let x = e; x; x = x.parentElement) if (x.attributs.class === "liens-pied") return x;
        return null;
      } };
    return e;
  };
  const pied = element({ class: "liens-pied" });
  const spanCgv = element({ "data-seulement": "comptes" }, pied);
  const elements = {
    spanCgv,
    lienCgvPied: element({ href: "cgv.html" }, spanCgv),
    lienConfidentialite: element({ href: "confidentialite.html" }, pied),
    lienCgvTexte: element({ href: "cgv.html" }),
    actif: element({ "data-si-paiement": "actif" }),
    coupe: element({ "data-si-paiement": "coupe" })
  };
  const document = {
    documentElement: { dataset: {} }, readyState: "loading",
    addEventListener: (type, fn) => { ecouteurs[type] = fn; },
    querySelectorAll: selecteurs => {
      const liste = selecteurs.split(",").map(s => s.trim());
      return Object.values(elements).filter(e => liste.some(s => {
        if (s === "a[href]") return "href" in e.attributs;
        const m = s.match(/^\[([\w-]+)\]$/);
        assert.ok(m, `sélecteur non simulé : ${s}`);
        return m[1] in e.attributs;
      }));
    }
  };
  charger(["js/mode-site.js"], { document, location: { hostname, pathname, replace: u => renvois.push(u) }, ...(config ? { CONFIG_COMPTE: config } : {}) });
  ecouteurs.DOMContentLoaded();
  const masques = Object.keys(elements).filter(nom => elements[nom].hidden);
  return { document, renvois, masques };
}

test("paiement coupé, domaine : abonnement et CGV renvoyés vers Mon compte (avec ou sans .html)", () => {
  for (const chemin of ["/abonnement.html", "/abonnement", "/cgv.html", "/CGV", "/cgv"]) {
    const page = naviguer("decrypte-ton-fonds.fr", chemin, { paiementActif: false });
    assert.deepEqual(page.renvois, ["compte.html"], chemin);
  }
  for (const chemin of ["/compte.html", "/connexion.html", "/index.html", "/", "/simulateur.html"])
    assert.deepEqual(naviguer("decrypte-ton-fonds.fr", chemin, { paiementActif: false }).renvois, [], chemin);
});

test("paiement actif : abonnement et CGV restent ouverts, rien de caché en plus", () => {
  for (const chemin of ["/abonnement.html", "/cgv"]) {
    const page = naviguer("comptes.decrypte-ton-fonds.pages.dev", chemin, { paiementActif: true });
    assert.deepEqual(page.renvois, [], chemin);
    assert.equal(page.document.documentElement.dataset.paiement, "actif");
    assert.deepEqual(page.masques, ["coupe"]);
  }
});

test("paiement coupé : <html data-paiement=\"coupe\">, éléments payants et lien CGV du pied de page cachés", () => {
  const page = naviguer("www.decrypte-ton-fonds.fr", "/index.html", { paiementActif: false });
  assert.equal(page.document.documentElement.dataset.site, "comptes");
  assert.equal(page.document.documentElement.dataset.paiement, "coupe");
  // Le lien CGV hors du pied de page n'est pas touché ici (ses pages le cachent elles-mêmes) ; « Confidentialité » reste
  assert.deepEqual(page.masques.sort(), ["actif", "spanCgv"]);
});

test("mode gratuit, paiement coupé : les pages de compte vont toujours vers l'accueil", () => {
  const page = naviguer("cleante-f.github.io", "/decrypte-ton-fonds/abonnement.html", { paiementActif: false });
  assert.deepEqual(page.renvois, ["index.html"]);
});

test("CSS : versions payante / gratuite cachées tant que le paiement n'est pas connu, lien CGV du pied caché sauf paiement actif", () => {
  const css = lire("css/style.css");
  for (const selecteur of ['html:not([data-paiement="actif"]) [data-si-paiement="actif"]', 'html:not([data-paiement="coupe"]) [data-si-paiement="coupe"]',
    'html:not([data-paiement="actif"]) .liens-pied [data-seulement="comptes"]:has(> a[href$="cgv.html"])']) {
    const i = css.indexOf(selecteur);
    assert.ok(i >= 0, `règle absente : ${selecteur}`);
    assert.match(css.slice(i).match(/\{[^}]*\}/)[0], /display:\s*none\s*!important/, selecteur);
  }
});

// ---------- Contrôle d'accès (Cloudflare) ----------

const env = { SUPABASE_URL: "https://projet.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const fichier = () => Promise.resolve(new Response("contenu", { headers: { "Cache-Control": "public, max-age=14400" } }));
const supabase = (statut, corps) => async () => new Response(JSON.stringify(corps), { status: statut });
const sansSupabase = async () => { throw new Error("Supabase ne doit pas être appelé"); };
const sur = (chemin, cookie, hote = "decrypte-ton-fonds.fr") => new Request(`https://${hote}${chemin}`, { headers: cookie ? { Cookie: cookie } : {} });

test("domaine, paiement coupé, sans cookie : simulateur → création de compte avec retour ; script → 403", async () => {
  for (const hote of ["decrypte-ton-fonds.fr", "www.decrypte-ton-fonds.fr", "Decrypte-Ton-Fonds.fr."]) {
    const r = await controlerAcces(sur("/simulateur.html", null, hote), env, fichier, { fetchImpl: sansSupabase, paiementActif: false });
    assert.equal(r.status, 302, hote);
    const loc = new URL(r.headers.get("Location"));
    assert.equal(loc.pathname, "/connexion.html", hote);
    assert.equal(loc.searchParams.get("vue"), "inscription", hote);
    assert.equal(loc.searchParams.get("retour"), "/simulateur.html", hote);
  }
  const js = await controlerAcces(sur("/js/simulateur.js"), env, fichier, { fetchImpl: sansSupabase, paiementActif: false });
  assert.equal(js.status, 403);
});

test("domaine, paiement coupé : jeton refusé → connexion avec retour ; connecté → accès", async () => {
  const refuse = await controlerAcces(sur("/simulateur?sim=abc", "dtf_session=faux"), env, fichier, { fetchImpl: supabase(401, {}), paiementActif: false });
  assert.equal(refuse.headers.get("Location"), "https://decrypte-ton-fonds.fr/connexion.html?vue=connexion&retour=%2Fsimulateur%3Fsim%3Dabc");
  const ok = await controlerAcces(sur("/simulateur.html", "dtf_session=bon"), env, fichier,
    { fetchImpl: supabase(200, { acces: true, paiement_actif: false }), paiementActif: false });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "contenu");
});

test("paiement coupé : connecté sans accès → Mon compte (jamais l'abonnement, jamais de boucle vers la connexion)", async () => {
  for (const [config, droits] of [[false, { acces: false, paiement_actif: true }], [true, { acces: false, paiement_actif: false }]]) {
    const r = await controlerAcces(sur("/simulateur.html", "dtf_session=bon"), env, fichier, { fetchImpl: supabase(200, droits), paiementActif: config });
    assert.equal(r.headers.get("Location"), "https://decrypte-ton-fonds.fr/compte.html", JSON.stringify(droits));
  }
});

test("paiement coupé : abonnement et CGV renvoyés vers Mon compte par le serveur (adresses déguisées comprises)", async () => {
  for (const chemin of ["/abonnement.html", "/abonnement", "/cgv", "/CGV.html", "/%63gv.html", "/abonnement/"]) {
    const r = await controlerAcces(sur(chemin), env, fichier, { fetchImpl: sansSupabase, paiementActif: false });
    assert.equal(r.status, 302, chemin);
    assert.equal(r.headers.get("Location"), "https://decrypte-ton-fonds.fr/compte.html", chemin);
  }
});

test("paiement actif : abonnement et CGV servis, sans cookie le simulateur mène à l'abonnement (comme aujourd'hui)", async () => {
  for (const chemin of ["/abonnement.html", "/cgv.html"]) {
    const r = await controlerAcces(sur(chemin), env, fichier, { fetchImpl: sansSupabase, paiementActif: true });
    assert.equal(r.status, 200, chemin);
  }
  const r = await controlerAcces(sur("/simulateur.html"), env, fichier, { fetchImpl: sansSupabase, paiementActif: true });
  assert.equal(r.headers.get("Location"), "https://decrypte-ton-fonds.fr/abonnement.html");
});

test("mode gratuit : abonnement.html non renvoyé par le serveur (la page le fait), simulateur libre", async () => {
  for (const chemin of ["/abonnement.html", "/simulateur.html"]) {
    const r = await controlerAcces(sur(chemin, null, "decrypte-ton-fonds.pages.dev"), env, fichier, { fetchImpl: sansSupabase, paiementActif: false });
    assert.equal(r.status, 200, chemin);
  }
});

// ---------- Fonction serveur « paiement » (Stripe Checkout) ----------

const envStripe = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRIX: "price_1", ORIGINES: "https://decrypte-ton-fonds.fr" };
function reseau(routes) {
  const appels = [];
  const f = async (url, options = {}) => {
    appels.push({ url, options });
    for (const [motif, reponse] of routes) if (url.includes(motif))
      return new Response(JSON.stringify(reponse.corps), { status: reponse.statut || 200 });
    throw new Error("appel inattendu : " + url);
  };
  return { f, appels };
}
const requetePaiement = () => new Request("https://p.supabase.co/functions/v1/paiement",
  { method: "POST", headers: { Authorization: "Bearer jeton", Origin: "https://decrypte-ton-fonds.fr" }, body: "{}" });
const profilPret = { corps: [{ id: "u1", abonnement_statut: "aucun", stripe_client: "cus_1", execution_immediate_demandee_le: "2026-10-01T00:00:00Z" }] };

test("paiement coupé (reglages_site) : 403 « paiement_coupe », aucun appel à Stripe", async () => {
  const { f, appels } = reseau([["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }],
    ["/rest/v1/reglages_site", { corps: [{ paiement_actif: false }] }], ["/rest/v1/profils", profilPret]]);
  const r = await creerPaiement(requetePaiement(), envStripe, f);
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { erreur: "paiement_coupe" });
  assert.equal(appels.some(a => a.url.includes("api.stripe.com")), false);
  const lecture = appels.find(a => a.url.includes("/rest/v1/reglages_site"));
  assert.equal(lecture.url, "https://p.supabase.co/rest/v1/reglages_site?id=eq.true&select=paiement_actif");
  assert.equal(lecture.options.headers.apikey, "sb_secret_x", "lu avec la clé service (la table est fermée au navigateur)");
});

test("paiement : réglage illisible → erreur (jamais de paiement par défaut) ; ligne absente → actif, comme paiement_actif() en SQL", async () => {
  const panne = reseau([["/auth/v1/user", { corps: { id: "u1" } }], ["/rest/v1/reglages_site", { statut: 500, corps: {} }]]);
  await assert.rejects(creerPaiement(requetePaiement(), envStripe, panne.f));
  assert.equal(panne.appels.some(a => a.url.includes("api.stripe.com")), false);
  const sansLigne = reseau([["/auth/v1/user", { corps: { id: "u1", email: "a@b.fr" } }], ["/rest/v1/reglages_site", { corps: [] }], ["/rest/v1/profils", profilPret],
    ["api.stripe.com/v1/checkout/sessions", { corps: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } }]]);
  assert.equal((await creerPaiement(requetePaiement(), envStripe, sansLigne.f)).status, 200);
});

test("paiement : non connecté → 401 avant toute lecture du réglage", async () => {
  const { f, appels } = reseau([["/auth/v1/user", { statut: 401, corps: {} }]]);
  const r = await creerPaiement(requetePaiement(), envStripe, f);
  assert.equal(r.status, 401);
  assert.equal(appels.length, 1);
});

// connexion.js avec un faux formulaire : la case CGV est retirée quand le paiement est coupé, gardée sinon
function connexionAvec(config) {
  const retirees = [];
  const label = { remove: () => retirees.push("label-cgv") };
  const caseCgv = { closest: sel => (sel === "label" ? label : null) };
  const element = () => ({ addEventListener() {}, querySelector: element, querySelectorAll: () => [], hidden: false, dataset: {} });
  const ctx = vm.createContext({
    console, URLSearchParams, setTimeout, modeSite: () => "gratuit", Compte: {}, history: { replaceState() {} }, window: {},
    location: { hostname: "cleante-f.github.io", search: "" }, CONFIG_COMPTE: config,
    document: { getElementById: element, querySelector: sel => (sel === "#form-inscription [name=cgv]" ? caseCgv : element()), querySelectorAll: () => [],
      addEventListener() {}, createElement: () => ({}), head: { appendChild() {} } }
  });
  vm.runInContext(lire("js/connexion.js"), ctx, { filename: "js/connexion.js" });
  return retirees;
}

test("connexion.js : case CGV retirée seulement quand le paiement est coupé", () => {
  assert.deepEqual(connexionAvec({ paiementActif: false, turnstileCle: "x" }), ["label-cgv"]);
  assert.deepEqual(connexionAvec({ paiementActif: true, turnstileCle: "x" }), []);
  assert.deepEqual(connexionAvec({ turnstileCle: "x" }), []);
});

// compte.js : l'inscription n'enregistre l'acceptation des CGV que si le paiement est actif ; la majorité toujours
function inscriptionAvec(paiementActif) {
  const appels = [];
  const ctx = vm.createContext({
    CONFIG_COMPTE: { supabaseUrl: "https://projet.supabase.co", supabaseCle: "sb_publishable_test", versionCgv: "2026-10", paiementActif },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { set cookie(v) {}, get cookie() { return ""; }, getElementById: () => null },
    location: { href: "http://localhost:8770/connexion.html", hash: "", pathname: "/connexion.html", search: "" }, history: { replaceState() {} },
    URL, URLSearchParams, JSON, Date, Math, Promise, Error,
    fetch: async (url, options = {}) => { appels.push(JSON.parse(options.body)); return { ok: true, status: 200, text: async () => "{}" }; }
  });
  vm.runInContext(lire("js/compte.js") + "\n;globalThis.Compte = Compte;", ctx);
  return ctx.Compte.inscrire("A@B.fr", "motdepasse12", "jeton").then(() => appels[0].data);
}

test("inscription : cgv_version envoyée seulement si le paiement est actif, majeur toujours", async () => {
  assert.deepEqual(await inscriptionAvec(false), { majeur: true });
  assert.deepEqual(await inscriptionAvec(true), { majeur: true, cgv_version: "2026-10" });
  assert.deepEqual(await inscriptionAvec(undefined), { majeur: true, cgv_version: "2026-10" });
});

test("compte.js : message français pour le refus « paiement_coupe »", () => {
  assert.match(lire("js/compte.js"), /paiement_coupe: "[^"]+"/);
});

const PAYANT = /abonn|\bcgv\b|conditions générales de vente|offerte|stripe|\[\[PRIX\]\]|€ par mois|3 simulations/i;

// espace-compte.js : bloc « accès » de Mon compte
function espaceCompte(config, url = "") {
  const element = () => ({ addEventListener() {}, querySelector: element, hidden: false, textContent: "", className: "", innerHTML: "", value: "" });
  const ctx = vm.createContext({ document: { getElementById: element, querySelector: element, addEventListener() {} },
    location: { hostname: "cleante-f.github.io", search: url, replace() {} }, modeSite: () => "gratuit", Compte: {},
    CONFIG_COMPTE: config, esc: s => String(s), URLSearchParams });
  vm.runInContext(lire("js/espace-compte.js"), ctx);
  return ctx;
}

test("Mon compte, paiement coupé : simulateur ouvert, ni offertes, ni abonnement", () => {
  const sansMot = (html, quoi) => assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), PAYANT, quoi) || assert.doesNotMatch(html, /abonnement\.html|cgv\.html/, quoi);
  const ctx = espaceCompte({ simulationsOffertes: 3, paiementActif: false });
  for (const d of [{ abonne: false, abonnement_statut: "aucun", offertes_restantes: 3, paiement_actif: false },
    { abonne: false, abonnement_statut: "aucun", offertes_restantes: 0, paiement_actif: false }]) {
    const html = ctx.blocAcces(d);
    sansMot(html, JSON.stringify(d));
    assert.ok(html.includes('href="simulateur.html"'), "lien vers le simulateur");
  }
  // Réglage du site actif mais base coupée : la base l'emporte (aucune offre à acheter)
  sansMot(espaceCompte({ simulationsOffertes: 3, paiementActif: true }).blocAcces({ abonne: false, offertes_restantes: 0, paiement_actif: false }), "base coupée");
  // Une simulation ancienne marquée « offerte » n'affiche plus la mention
  assert.doesNotMatch(ctx.ligneSimulation({ id: "1", nom: "A", fonds: "FR1", maj_le: "2026-10-01", offerte: true }), /offerte/);
});

test("Mon compte, paiement coupé : pas de portail Stripe, même pour un ancien abonné (Stripe absent de la page Confidentialité)", () => {
  for (const [config, d] of [[{ paiementActif: false }, { abonne: true, abonnement_statut: "actif", paiement_actif: false }],
    [{ paiementActif: false }, { abonne: true, abonnement_statut: "resilie_fin_periode", paiement_actif: true }],
    [{ paiementActif: true }, { abonne: true, abonnement_statut: "actif", paiement_actif: false }]]) {
    const html = espaceCompte({ simulationsOffertes: 3, ...config }).blocAcces(d);
    assert.doesNotMatch(html, /portail|abonnement/i, JSON.stringify([config, d]));
    assert.ok(html.includes('href="simulateur.html"'));
  }
  // Paiement actif : l'abonné garde son bouton « Gérer ou résilier »
  assert.match(espaceCompte({ simulationsOffertes: 3, paiementActif: true }).blocAcces({ abonne: true, abonnement_statut: "actif", paiement_actif: true }), /id="portail"/);
});

test("Mon compte, paiement actif : bloc d'aujourd'hui (offertes, lien vers l'abonnement)", () => {
  const ctx = espaceCompte({ simulationsOffertes: 3, paiementActif: true });
  const html = ctx.blocAcces({ abonne: false, offertes_restantes: 2, paiement_actif: true });
  assert.ok(html.includes("simulations offertes") && html.includes('href="abonnement.html"'));
  assert.match(ctx.ligneSimulation({ id: "1", nom: "A", fonds: "FR1", maj_le: "2026-10-01", offerte: true }), /· offerte/);
});

test("abonnement.js : l'offre n'est jamais affichée quand le paiement est coupé", () => {
  const js = lire("js/abonnement.js");
  assert.match(js, /if \(CONFIG_COMPTE\.paiementActif !== false\) afficherOffre\(\);/);
});

test("simulateur.js : sans session et paiement coupé, renvoi vers la création de compte (retour au simulateur) ; Stripe seulement si actif", () => {
  const js = lire("js/simulateur.js");
  assert.ok(js.includes('location.replace(CONFIG_COMPTE.paiementActif === false\n    ? `connexion.html?vue=inscription&retour=${encodeURIComponent("simulateur.html" + location.search + location.hash)}`\n    : "abonnement.html");'));
  assert.match(js, /CONFIG_COMPTE\.paiementActif !== false && new URLSearchParams\(location\.search\)\.get\("abonnement"\) === "ok"/);
});

// ---------- Plan du site : le simulateur, réservé aux comptes sur le domaine, n'y figure plus ----------

test("plan du site : simulateur.html retiré des pages principales", () => {
  assert.ok(!PAGES_PRINCIPALES.includes("simulateur.html"));
  assert.deepEqual(PAGES_PRINCIPALES, ["", "decrypte.html", "performances.html", "confidentialite.html", "mentions-legales.html"]);
});

// confidentialite.html : blocs d'une version (data-seulement="…"), div équilibrées
function blocsVersion(html, version) {
  const blocs = [], ouverture = `<div data-seulement="${version}">`;
  for (let i = html.indexOf(ouverture); i >= 0; i = html.indexOf(ouverture, i + 1)) {
    let profondeur = 0, j = i;
    for (const balise = /<\/?div\b/g; ; ) {
      balise.lastIndex = j;
      const m = balise.exec(html);
      if (!m) break;
      profondeur += m[0] === "<div" ? 1 : -1;
      j = m.index + m[0].length;
      if (profondeur === 0) break;
    }
    blocs.push(html.slice(i, j));
  }
  return blocs;
}

test("confidentialité : Supabase contacté aussi à l'inscription et à la connexion ; date de dernière activité déclarée", () => {
  const html = lire("confidentialite.html");
  const comptes = blocsVersion(html, "comptes").join("\n");
  assert.ok(comptes.includes("<td>Quand tu crées ton compte, te connectes ou es connecté, ou quand tu cliques sur le lien de désinscription d'un e-mail d'alerte</td>"));
  assert.match(comptes, /date d'inscription, date de dernière activité/);
});

test("confidentialité, version gratuite : pas de decrypte-ton-fonds.fr (adresse en mode comptes) ; commentaire des versions à jour", () => {
  const html = lire("confidentialite.html");
  const gratuit = blocsVersion(html, "gratuit");
  assert.ok(gratuit.length >= 3);
  for (const bloc of gratuit) assert.doesNotMatch(bloc, /decrypte-ton-fonds\.fr/);
  assert.match(html, /<!-- Deux versions : data-seulement="comptes" \(decrypte-ton-fonds\.fr et www, aperçu des comptes, localhost\b/);
});

// Liste de suivi et préférences d'alertes (mode comptes) : client de js/compte.js, bouton de la fiche (js/fiche-auto.js),
// page Mon compte (js/espace-compte.js) et réglages des alertes enregistrés dans le compte (js/config.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const { modeSite } = (() => { const c = vm.createContext({}); vm.runInContext(lire("js/mode-site.js"), c); return c; })();
const LIMITE = "Tu suis déjà 30 fonds : retires-en un pour en ajouter.";

// ---------- js/compte.js ----------

function navigateur(reponses) {
  const appels = [];
  const stockage = new Map([["compte-session-v1", JSON.stringify({ access_token: "jeton", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "u1", email: "a@b.fr" } })]]);
  const ctx = vm.createContext({
    CONFIG_COMPTE: { supabaseUrl: "https://projet.supabase.co", supabaseCle: "sb_publishable_test" },
    localStorage: { getItem: k => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: k => stockage.delete(k) },
    document: { set cookie(v) {}, get cookie() { return ""; }, getElementById: () => null },
    location: { href: "http://localhost/decrypte.html", hash: "", pathname: "/decrypte.html", search: "" },
    URL, URLSearchParams, JSON, Date, Math, Promise, Error,
    fetch: async (url, options = {}) => {
      appels.push({ url, options, corps: options.body ? JSON.parse(options.body) : undefined });
      const r = reponses.shift();
      if (!r) throw new Error("appel inattendu : " + url);
      return { ok: r.statut >= 200 && r.statut < 300, status: r.statut, text: async () => (r.corps === undefined ? "" : JSON.stringify(r.corps)) };
    }
  });
  vm.runInContext(lire("js/compte.js") + "\n;globalThis.Compte = Compte;", ctx);
  return { Compte: ctx.Compte, appels };
}

test("suivreFonds : ajout « ignore les doublons », clé en majuscules, au nom de la personne connectée", async () => {
  const n = navigateur([{ statut: 201 }]);
  await n.Compte.suivreFonds(" fr0011871128 ");
  const a = n.appels[0];
  assert.equal(a.url, "https://projet.supabase.co/rest/v1/fonds_suivis");
  assert.equal(a.options.method, "POST");
  assert.deepEqual(a.corps, { user_id: "u1", cle_fonds: "FR0011871128" });
  assert.equal(a.options.headers.Prefer, "return=minimal,resolution=ignore-duplicates");
  assert.equal(a.options.headers.Authorization, "Bearer jeton");
});

test("suivreFonds : 31e fonds refusé avec un message clair", async () => {
  const n = navigateur([{ statut: 400, corps: { code: "P0001", message: "limite_fonds_suivis", details: null, hint: null } }]);
  await assert.rejects(n.Compte.suivreFonds("LU1681043599"), e => e.code === "limite_fonds_suivis" && e.message === LIMITE);
});

test("fondsSuivis et nePlusSuivre", async () => {
  const n = navigateur([{ statut: 200, corps: [{ cle_fonds: "FR0011871128" }, { cle_fonds: "S000002839" }] }, { statut: 204 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(await n.Compte.fondsSuivis())), ["FR0011871128", "S000002839"]);
  assert.match(n.appels[0].url, /\/rest\/v1\/fonds_suivis\?select=cle_fonds&order=ajoute_le\.asc$/);
  await n.Compte.nePlusSuivre("s000002839");
  assert.match(n.appels[1].url, /\/rest\/v1\/fonds_suivis\?cle_fonds=eq\.S000002839$/);
  assert.equal(n.appels[1].options.method, "DELETE");
});

test("preferencesAlertes : valeurs par défaut de la base sans ligne enregistrée", async () => {
  const n = navigateur([{ statut: 200, corps: [] }, { statut: 200, corps: [{ actives: false, nouveau_dic: true, frais: false, risque: true, seuil_baisse: 10, reglages_fiche: { pays: { orange: 30, rouge: 45 } } }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(await n.Compte.preferencesAlertes())),
    { actives: true, nouveau_dic: true, frais: true, risque: true, seuil_baisse: null, reglages_fiche: {} });
  assert.match(n.appels[0].url, /\/rest\/v1\/preferences_alertes\?select=actives,nouveau_dic,frais,risque,seuil_baisse,reglages_fiche$/);
  const p = await n.Compte.preferencesAlertes();
  assert.equal(p.seuil_baisse, 10);
  assert.equal(p.actives, false);
});

test("enregistrerPreferences : seuil 5/10/20 ou aucun, champs connus seulement, fusion avec la ligne existante", async () => {
  const n = navigateur([{ statut: 201 }, { statut: 200 }, { statut: 200 }, { statut: 200 }, { statut: 200 }]);
  await n.Compte.enregistrerPreferences({ actives: true, nouveau_dic: false, frais: 1, risque: "", seuil_baisse: "10", user_id: "pirate", autre: 1 });
  assert.deepEqual(n.appels[0].corps, { user_id: "u1", actives: true, nouveau_dic: false, frais: true, risque: false, seuil_baisse: 10 });
  assert.equal(n.appels[0].url, "https://projet.supabase.co/rest/v1/preferences_alertes");
  assert.equal(n.appels[0].options.headers.Prefer, "return=minimal,resolution=merge-duplicates");
  for (const [seuil, attendu] of [[5, 5], ["20", 20], ["", null], [15, null]]) {
    await n.Compte.enregistrerPreferences({ actives: true, nouveau_dic: true, frais: true, risque: true, seuil_baisse: seuil });
    assert.equal(n.appels.at(-1).corps.seuil_baisse, attendu, String(seuil));
  }
});

test("enregistrerReglagesFiche : seuls les réglages de la fiche sont envoyés", async () => {
  const n = navigateur([{ statut: 201 }]);
  await n.Compte.enregistrerReglagesFiche({ pays: { orange: 30, rouge: 45 } });
  assert.deepEqual(n.appels[0].corps, { user_id: "u1", reglages_fiche: { pays: { orange: 30, rouge: 45 } } });
  assert.equal(n.appels[0].options.headers.Prefer, "return=minimal,resolution=merge-duplicates");
});

// ---------- Bouton de la fiche (js/fiche-auto.js) ----------

const FICHE = ["js/glossaire.js", "js/outils.js", "js/affichage.js", "js/geco.js", "js/fiche-auto.js"];
function fiche(hote, compte) {
  const ctx = vm.createContext({ console, modeSite, location: { hostname: hote, href: "" }, RACINE_SITE: "", Compte: compte,
    document: { querySelectorAll: () => ctx._boutons || [] } });
  for (const f of FICHE) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}
// Faux bouton rendu par boutonSuivi, avec sa zone de message
function fauxBouton(cle) {
  const message = { textContent: "" };
  const attributs = { "aria-pressed": "false" };
  return { dataset: { suivre: cle }, textContent: "☆ Suivre ce fonds", disabled: false, message,
    getAttribute: n => attributs[n], setAttribute: (n, v) => { attributs[n] = String(v); },
    parentNode: { querySelector: () => message } };
}

test("bouton Suivre : absent en mode gratuit", () => {
  for (const hote of ["cleante-f.github.io", "decrypte-ton-fonds.pages.dev"]) {
    const c = fiche(hote, { session: () => ({ user: { id: "u1" } }) });
    assert.equal(c.boutonSuivi("FR0011871128"), "", hote);
  }
  assert.match(lire("js/fiche-auto.js"), /<div class="actions-fiche">[\s\S]*?\$\{boutonSuivi\(cleEntree\(e, isin\)\)\}[\s\S]*?<\/div>/);
});

test("bouton Suivre : sans session, lien vers la connexion (retour sur la fiche)", () => {
  const html = fiche("localhost", { session: () => null }).boutonSuivi("FR0011871128");
  assert.match(html, /^<a [^>]*data-seulement="comptes"/);
  assert.match(html, /href="connexion\.html\?vue=connexion&amp;retour=decrypte\.html%23FR0011871128"/);
  assert.match(html, /☆ Suivre ce fonds/);
});

test("bouton Suivre : avec session, suivreFonds puis « ★ Suivi » ; un second clic ne suit plus", async () => {
  const appels = [];
  const c = fiche("comptes.decrypte-ton-fonds.pages.dev", { session: () => ({ user: { id: "u1" } }),
    suivreFonds: async cle => appels.push(["suivre", cle]), nePlusSuivre: async cle => appels.push(["neplus", cle]) });
  const html = c.boutonSuivi("FR0011871128");
  assert.match(html, /<button type="button" [^>]*data-seulement="comptes"[^>]*data-suivre="FR0011871128"[^>]*>☆ Suivre ce fonds<\/button>/);
  const b = fauxBouton("FR0011871128");
  c._boutons = [b];
  await c.cliquerSuivi(b);
  assert.deepEqual(appels, [["suivre", "FR0011871128"]]);
  assert.equal(b.textContent, "★ Suivi");
  assert.equal(b.getAttribute("aria-pressed"), "true");
  assert.match(c.boutonSuivi("FR0011871128"), />★ Suivi<\/button>/);   // la fiche redessinée garde l'état
  await c.cliquerSuivi(b);
  assert.deepEqual(appels.at(-1), ["neplus", "FR0011871128"]);
  assert.equal(b.textContent, "☆ Suivre ce fonds");
});

test("bouton Suivre : limite de 30 fonds → message, bouton inchangé", async () => {
  const c = fiche("localhost", { session: () => ({ user: { id: "u1" } }),
    suivreFonds: async () => { throw Object.assign(new Error(LIMITE), { code: "limite_fonds_suivis" }); } });
  const b = fauxBouton("LU1681043599");
  c._boutons = [b];
  await c.cliquerSuivi(b);
  assert.equal(b.message.textContent, LIMITE);
  assert.equal(b.textContent, "☆ Suivre ce fonds");
  assert.equal(b.disabled, false);
});

test("chargerSuivis : lit la liste une fois connecté, rien en mode gratuit ni sans session", async () => {
  let lu = 0;
  const compte = s => ({ session: () => s, fondsSuivis: async () => { lu++; return ["FR0011871128"]; } });
  await fiche("cleante-f.github.io", compte({ user: {} })).chargerSuivis();
  await fiche("localhost", compte(null)).chargerSuivis();
  assert.equal(lu, 0);
  const c = fiche("localhost", compte({ user: {} }));
  const b = fauxBouton("FR0011871128");
  c._boutons = [b];
  await c.chargerSuivis();
  assert.equal(lu, 1);
  assert.equal(b.textContent, "★ Suivi");
});

// ---------- Mon compte (js/espace-compte.js) ----------

function element(id) {
  const ecouteurs = {};
  return { id, ecouteurs, addEventListener: (t, fn) => { ecouteurs[t] = fn; }, querySelector: () => element(), querySelectorAll: () => [],
    hidden: false, textContent: "", className: "", innerHTML: "", value: "", checked: false, dataset: {} };
}
async function monCompte({ suivis = ["FR0011871128"], preferences, entrees = {} } = {}) {
  const els = {}, appels = [];
  const el = id => (els[id] ||= element(id));
  const Compte = {
    session: () => ({ user: { id: "u1" } }), droits: async () => ({ offertes_restantes: 3 }), simulations: async () => [],
    utilisateur: async () => ({ email: "a@exemple.fr" }), fondsSuivis: async () => suivis,
    preferencesAlertes: async () => preferences || { actives: true, nouveau_dic: true, frais: true, risque: true, seuil_baisse: null, reglages_fiche: {} },
    nePlusSuivre: async cle => { appels.push(["nePlusSuivre", cle]); suivis = suivis.filter(c => c !== cle); },
    enregistrerPreferences: async p => appels.push(["enregistrerPreferences", p])
  };
  const ctx = vm.createContext({
    console, URLSearchParams, modeSite, Compte, CONFIG_COMPTE: { simulationsOffertes: 3 },
    esc: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    location: { hostname: "localhost", search: "", replace() {}, href: "" },
    entreeParCle: async cle => entrees[cle] || null, adresseFonds: e => e.page || null, chargerScript: async () => {}, zoneDeCle: () => "europe",
    ANNUAIRE: [],
    document: { getElementById: el, querySelector: el, addEventListener: (t, fn) => { el("document").ecouteurs[t] = fn; } }
  });
  vm.runInContext(lire("js/espace-compte.js"), ctx, { filename: "js/espace-compte.js" });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return { els, appels, ctx };
}

test("Mon compte : fonds suivis listés, nom échappé, lien vers la page du fonds sinon decrypte.html#", async () => {
  const { els } = await monCompte({ suivis: ["FR0011871128", "S000002839", "X1"], entrees: {
    FR0011871128: { nom: "AMUNDI <PEA> S&P 500", page: "fonds/amundi-pea-s-p-500-FR0011871128.html" },
    S000002839: { nom: "VANGUARD 500" } } });
  const html = els["liste-suivis"].innerHTML;
  assert.ok(html.includes("AMUNDI &lt;PEA&gt; S&amp;P 500"), html);
  assert.ok(!html.includes("<PEA>"));
  assert.ok(html.includes('href="fonds/amundi-pea-s-p-500-FR0011871128.html"'));
  assert.ok(html.includes('href="decrypte.html#S000002839"'));
  assert.ok(html.includes('href="decrypte.html#X1"'), "fonds introuvable : sa clé, avec un lien vers la fiche");
  assert.equal((html.match(/data-ne-plus-suivre/g) || []).length, 3);
  assert.equal((html.match(/Ne plus suivre/g) || []).length, 3);
});

test("Mon compte : aucun fonds suivi → explication", async () => {
  const { els } = await monCompte({ suivis: [] });
  assert.match(els["liste-suivis"].innerHTML, /Aucun fonds suivi/);
});

test("Mon compte : « Ne plus suivre » retire le fonds et met la liste à jour", async () => {
  const { els, appels } = await monCompte({ suivis: ["FR0011871128"], entrees: { FR0011871128: { nom: "AMUNDI" } } });
  const li = { dataset: { cle: "FR0011871128" } };
  await els.document.ecouteurs.click({ target: { id: "", matches: s => s === "[data-ne-plus-suivre]", closest: s => (s === "[data-cle]" ? li : null) } });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(appels, [["nePlusSuivre", "FR0011871128"]]);
  assert.match(els["liste-suivis"].innerHTML, /Aucun fonds suivi/);
});

test("Mon compte : préférences affichées puis enregistrées (seuil 5/10/20 ou aucun)", async () => {
  const { els, appels, ctx } = await monCompte({ preferences: { actives: false, nouveau_dic: true, frais: false, risque: true, seuil_baisse: 20, reglages_fiche: {} } });
  const form = els["form-alertes"];
  assert.match(form.innerHTML, /name="actives"(?![^>]*checked)/);
  assert.match(form.innerHTML, /name="nouveau_dic"[^>]*checked/);
  assert.match(form.innerHTML, /name="frais"(?![^>]*checked)/);
  assert.match(form.innerHTML, /<option value="20" selected>/);
  for (const v of ["", "5", "10", "20"]) assert.ok(form.innerHTML.includes(`<option value="${v}"`), v);
  ctx.FormData = class { constructor() {} get(n) { return { actives: "on", nouveau_dic: null, frais: "on", risque: "on", seuil_baisse: "5" }[n]; } };
  await form.ecouteurs.submit({ preventDefault() {}, target: form });
  assert.deepEqual(JSON.parse(JSON.stringify(appels)), [["enregistrerPreferences", { actives: true, nouveau_dic: false, frais: true, risque: true, seuil_baisse: 5 }]]);
  assert.equal(els["message-compte"].textContent, "Préférences d'alertes enregistrées.");
});

test("compte.html : sections « Mes fonds suivis » et « Alertes par e-mail » en mode comptes, scripts de l'annuaire avant espace-compte.js", () => {
  const html = lire("compte.html");
  const bloc = html.slice(html.indexOf('<div data-seulement="comptes">'), html.indexOf('<section class="carte" data-seulement="gratuit">'));
  assert.ok(bloc.includes("<h2>Mes fonds suivis</h2>") && bloc.includes('id="liste-suivis"'));
  assert.ok(bloc.includes("<h2>Alertes par e-mail</h2>") && bloc.includes('id="form-alertes"'));
  const place = s => html.indexOf(`<script src="${s}"></script>`);
  for (const s of ["js/geco.js", "js/zones.js", "js/adresses.js"]) {
    assert.ok(place(s) > place("js/outils.js") && place(s) < place("js/espace-compte.js"), s);
  }
  assert.equal(place("data/annuaire.js"), -1, "annuaire chargé seulement s'il y a des fonds suivis");
});

// ---------- Réglages des alertes de la fiche (js/config.js) ----------

test("réglages du compte : l'emportent sur ceux du navigateur, valeurs invalides ignorées, rien d'écrit dans le navigateur", () => {
  const ecrits = [];
  const ctx = vm.createContext({ localStorage: { getItem: () => JSON.stringify({ pays: { orange: 10, rouge: 20 } }), setItem: (k, v) => ecrits.push(k), removeItem() {} } });
  vm.runInContext(lire("js/config.js"), ctx);
  assert.equal(ctx.chargerSeuils().pays.rouge, 20);
  ctx.appliquerSeuilsCompte({});
  assert.equal(ctx.chargerSeuils().pays.rouge, 20, "compte sans réglages : ceux du navigateur restent");
  ctx.appliquerSeuilsCompte({ pays: { orange: 30, rouge: 45 }, secteur: { orange: "x", rouge: 500 }, inconnu: { orange: 1, rouge: 2 } });
  const s = ctx.chargerSeuils();
  assert.deepEqual([s.pays.orange, s.pays.rouge], [30, 45]);
  assert.deepEqual([s.secteur.orange, s.secteur.rouge], [25, 30]);
  assert.equal(s.inconnu, undefined);
  assert.deepEqual(ecrits, []);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.reglagesPourCompte(s))).pays, { orange: 30, rouge: 45 });
});

test("app.js : réglages enregistrés aussi dans le compte, et suivis lus, quand on est connecté en mode comptes", () => {
  const js = lire("js/app.js");
  assert.ok(js.includes("Compte.enregistrerReglagesFiche("));
  assert.ok(js.includes("Compte.preferencesAlertes()"));
  assert.ok(js.includes("chargerSuivis()"));
  assert.ok(js.includes("cliquerSuivi("));
  assert.match(js, /function connecteEnModeComptes\(\)[\s\S]*?modeSite\(location\.hostname\) === "comptes"[\s\S]*?Compte\.session\(\)/);
});

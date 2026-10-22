// Tâche quotidienne des alertes (scripts/alertes.mjs) : détection, regroupement, contenu des e-mails, jeton de désinscription
// et déroulé complet avec des dépendances simulées (aucun appel réseau : ni Supabase, ni Brevo, ni GECO).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { detecter, regrouper, courriel, jetonDesinscription, principal, variationSurUnMois, BASE_SITE, envoyerBrevo }
  from "../scripts/alertes.mjs";

const TOUT = { actives: true, nouveau_dic: true, frais: true, risque: true, seuil_baisse: 10 };
const ANCIEN = { date_dic: "2026-01-15", frais: 0.5, sri: 4, valeur: 100, date_valeur: "2026-10-01",
  historique: [["2026-09-01", 100], ["2026-10-01", 100]] };
const types = alertes => alertes.map(a => a.type).sort();

// ---------- detecter ----------

test("detecter : premier passage (pas d'état précédent) → aucune alerte", () => {
  assert.deepEqual(detecter(null, { ...ANCIEN, date_dic: "2026-10-20", frais: 2, sri: 7 }, TOUT), []);
  assert.deepEqual(detecter(undefined, ANCIEN, TOUT), []);
});

test("detecter : rien n'a changé → aucune alerte", () => {
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN }, TOUT), []);
});

test("detecter : nouveau DIC = date de DIC différente", () => {
  const a = detecter(ANCIEN, { ...ANCIEN, date_dic: "2026-10-20" }, TOUT);
  assert.deepEqual(a, [{ type: "nouveau_dic", date: "2026-10-20" }]);
  // DIC absent cette fois (lecture sans résultat) : pas d'alerte
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN, date_dic: null }, TOUT), []);
});

test("detecter : frais courants en hausse seulement", () => {
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN, frais: 0.65 }, TOUT), [{ type: "frais", avant: 0.5, apres: 0.65 }]);
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN, frais: 0.3 }, TOUT), []);
  assert.deepEqual(detecter({ ...ANCIEN, frais: null }, { ...ANCIEN, frais: 0.65 }, TOUT), []);
});

test("detecter : SRI modifié, en hausse comme en baisse", () => {
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN, sri: 5 }, TOUT), [{ type: "risque", avant: 4, apres: 5 }]);
  assert.deepEqual(detecter(ANCIEN, { ...ANCIEN, sri: 3 }, TOUT), [{ type: "risque", avant: 4, apres: 3 }]);
});

test("variationSurUnMois : valeur la plus récente contre la dernière valeur au moins 30 jours avant", () => {
  const pts = [["2026-09-01", 100], ["2026-09-10", 95], ["2026-10-05", 90], ["2026-10-12", 88]];
  // 12/10 − 30 jours = 12/09 → valeur du 10/09 (95)
  assert.equal(Math.round(variationSurUnMois(pts) * 100) / 100, Math.round((88 / 95 - 1) * 10000) / 100);
  assert.equal(variationSurUnMois([["2026-10-01", 100], ["2026-10-12", 80]]), null);   // pas un mois d'historique
  // série mensuelle (fonds américains) : le point précédent
  assert.equal(variationSurUnMois([["2026-01-31", 100], ["2026-02-28", 90]], { mensuel: true }), -10);
});

test("detecter : baisse au-delà du seuil sur un mois, une seule fois", () => {
  const nouveau = { ...ANCIEN, valeur: 85, date_valeur: "2026-10-12", historique: [["2026-09-01", 100], ["2026-10-01", 100], ["2026-10-12", 85]] };
  const a = detecter(ANCIEN, nouveau, TOUT);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "baisse");
  assert.equal(Math.round(a[0].variation), -15);
  assert.equal(a[0].date, "2026-10-12");
  // seuil 20 % : pas d'alerte ; seuil 5 % : alerte
  assert.deepEqual(detecter(ANCIEN, nouveau, { ...TOUT, seuil_baisse: 20 }), []);
  assert.equal(detecter(ANCIEN, nouveau, { ...TOUT, seuil_baisse: 5 }).length, 1);
  // baisse déjà signalée (le seuil était déjà franchi à l'état précédent) : pas de nouvelle alerte
  const suivant = { ...nouveau, valeur: 84, date_valeur: "2026-10-13", historique: [...nouveau.historique, ["2026-10-13", 84]] };
  assert.deepEqual(detecter(nouveau, suivant, TOUT), []);
  // pas de nouvelle valeur : rien
  assert.deepEqual(detecter(nouveau, { ...nouveau }, TOUT), []);
});

test("detecter : préférences (alertes décochées, seuil null, alertes désactivées)", () => {
  const nouveau = { ...ANCIEN, date_dic: "2026-10-20", frais: 0.7, sri: 5, valeur: 80, date_valeur: "2026-10-12",
    historique: [["2026-09-01", 100], ["2026-10-01", 100], ["2026-10-12", 80]] };
  assert.deepEqual(types(detecter(ANCIEN, nouveau, TOUT)), ["baisse", "frais", "nouveau_dic", "risque"]);
  assert.deepEqual(types(detecter(ANCIEN, nouveau, { ...TOUT, seuil_baisse: null })), ["frais", "nouveau_dic", "risque"]);
  assert.deepEqual(types(detecter(ANCIEN, nouveau, { ...TOUT, frais: false, risque: false })), ["baisse", "nouveau_dic"]);
  assert.deepEqual(types(detecter(ANCIEN, nouveau, { ...TOUT, nouveau_dic: false })), ["baisse", "frais", "risque"]);
  assert.deepEqual(detecter(ANCIEN, nouveau, { ...TOUT, actives: false }), []);
});

// ---------- regrouper ----------

const FONDS_A = { cle: "FR0000000001", nom: "Fonds A", lien: BASE_SITE + "fonds/fonds-a-FR0000000001.html" };
const FONDS_B = { cle: "S000002839", nom: "Fonds B", lien: BASE_SITE + "decrypte.html#S000002839" };

test("regrouper : un e-mail par personne, qui regroupe les alertes de ses fonds selon ses préférences", () => {
  const alertesParFonds = {
    FR0000000001: { fonds: FONDS_A, alertes: [{ type: "frais", avant: 0.5, apres: 0.7 }, { type: "nouveau_dic", date: "2026-10-20" }] },
    S000002839: { fonds: FONDS_B, alertes: [{ type: "baisse", variation: -12, variationAvant: -2, date: "2026-09-30" }] }
  };
  const abonnes = [
    { user_id: "u1", email: "a@exemple.fr", prefs: TOUT, fonds: ["FR0000000001", "S000002839"] },
    { user_id: "u2", email: "b@exemple.fr", prefs: { ...TOUT, frais: false, seuil_baisse: 20 }, fonds: ["FR0000000001", "S000002839"] },
    { user_id: "u3", email: "c@exemple.fr", prefs: { ...TOUT, actives: false }, fonds: ["FR0000000001"] },
    { user_id: "u4", email: "d@exemple.fr", prefs: TOUT, fonds: ["LU0000000002"] }
  ];
  const r = regrouper(alertesParFonds, abonnes);
  assert.equal(r.length, 2);
  assert.equal(r[0].email, "a@exemple.fr");
  assert.equal(r[0].user_id, "u1");
  assert.deepEqual(r[0].alertes.map(a => [a.cle, a.type]), [["FR0000000001", "frais"], ["FR0000000001", "nouveau_dic"], ["S000002839", "baisse"]]);
  assert.equal(r[0].alertes[0].nom, "Fonds A");
  assert.equal(r[0].alertes[0].lien, FONDS_A.lien);
  assert.deepEqual(r[1].alertes.map(a => a.type), ["nouveau_dic"]);
});

// ---------- courriel ----------

test("courriel : sujet, texte et HTML avec liens ; nom de fonds échappé dans le HTML", () => {
  const alertes = [
    { cle: "FR0000000001", nom: "Fonds <b>A</b> & Cie", lien: FONDS_A.lien, type: "frais", avant: 0.5, apres: 0.75 },
    { cle: "FR0000000001", nom: "Fonds <b>A</b> & Cie", lien: FONDS_A.lien, type: "risque", avant: 4, apres: 5 },
    { cle: "S000002839", nom: "Fonds B", lien: FONDS_B.lien, type: "baisse", variation: -12.34, date: "2026-09-30" },
    { cle: "FR0000000001", nom: "Fonds <b>A</b> & Cie", lien: FONDS_A.lien, type: "nouveau_dic", date: "2026-10-20" }
  ];
  const lien = "https://exemple.supabase.co/functions/v1/alertes-desinscription?jeton=abc";
  const c = courriel("a@exemple.fr", alertes, lien);
  assert.match(c.sujet, /4 alertes/);
  assert.ok(!c.html.includes("<b>A</b>"));
  assert.ok(c.html.includes("Fonds &lt;b&gt;A&lt;/b&gt; &amp; Cie"));
  assert.ok(c.texte.includes("Fonds <b>A</b> & Cie"));
  for (const t of [c.texte, c.html]) {
    assert.ok(t.includes(FONDS_A.lien) && t.includes(FONDS_B.lien));
    assert.ok(t.includes(lien.replace(/&/g, t === c.html ? "&amp;" : "&")));
    assert.match(t, /0,5 %/);
    assert.match(t, /0,75 %/);
    assert.match(t, /12,3 %/);
    assert.match(t, /20\/10\/2026/);
  }
  // le nom du fonds n'apparaît qu'une fois par fonds (alertes regroupées sous le fonds)
  assert.equal(c.texte.split("Fonds <b>A</b> & Cie").length - 1, 1);
  assert.match(courriel("a@exemple.fr", alertes.slice(0, 1), lien).sujet, /1 alerte\b/);
});

// ---------- jeton de désinscription ----------

test("jetonDesinscription : « userId.date.signature », signature HMAC-SHA256 de « userId.date » en base64url", () => {
  const j = jetonDesinscription("1b4e28ba-2fa1-11d2-883f-0016d3cca427", "secret-de-test", "2026-10-22");
  const [u, d, s] = j.split(".");
  assert.equal(u, "1b4e28ba-2fa1-11d2-883f-0016d3cca427");
  assert.equal(d, "2026-10-22");
  assert.equal(s, createHmac("sha256", "secret-de-test").update(`${u}.${d}`).digest("base64url"));
  assert.notEqual(jetonDesinscription(u, "autre", d), j);
  assert.notEqual(jetonDesinscription("autre", "secret-de-test", d).split(".")[2], s);
  assert.throws(() => jetonDesinscription(u, "", d));
});

// ---------- envoi par Brevo ----------

test("envoyerBrevo : requête de l'API Brevo ; 429 et 402 → quota dépassé ; autre erreur → exception", async () => {
  const appels = [];
  const ok = async (url, init) => { appels.push({ url, init }); return { ok: true, status: 201 }; };
  await envoyerBrevo({ email: "a@exemple.fr", sujet: "S", texte: "T", html: "<p>H</p>" }, "cle-brevo", ok);
  assert.equal(appels[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(appels[0].init.method, "POST");
  assert.equal(appels[0].init.headers["api-key"], "cle-brevo");
  const corps = JSON.parse(appels[0].init.body);
  assert.deepEqual(corps.sender, { email: "contact@decrypte-ton-fonds.fr", name: "Décrypte ton fonds" });
  assert.deepEqual(corps.to, [{ email: "a@exemple.fr" }]);
  assert.equal(corps.subject, "S");
  assert.equal(corps.htmlContent, "<p>H</p>");
  assert.equal(corps.textContent, "T");
  for (const status of [429, 402]) {
    await assert.rejects(envoyerBrevo({ email: "a@exemple.fr", sujet: "S", texte: "T", html: "H" }, "k", async () => ({ ok: false, status })),
      e => e.quota === true);
  }
  await assert.rejects(envoyerBrevo({ email: "a@exemple.fr", sujet: "S", texte: "T", html: "H" }, "k", async () => ({ ok: false, status: 500 })),
    e => !e.quota && /500/.test(e.message));
});

// ---------- principal ----------

function monde({ etat = {}, fonds = {}, envoi } = {}) {
  const journal = { envois: [], ecrit: null, avertissements: [] };
  const deps = {
    lireSuivis: async () => [
      { user_id: "u1", email: "a@exemple.fr", prefs: TOUT, fonds: ["FR0000000001", "FR0000000002"] },
      { user_id: "u2", email: "b@exemple.fr", prefs: TOUT, fonds: ["FR0000000002"] },
      { user_id: "u3", email: "c@exemple.fr", prefs: { ...TOUT, actives: false }, fonds: ["FR0000000001"] }
    ],
    lireEtat: async cles => Object.fromEntries(cles.filter(c => etat[c]).map(c => [c, etat[c]])),
    lireFonds: async cle => { const f = fonds[cle]; if (f instanceof Error) throw f; return f; },
    envoyer: async m => { if (envoi) await envoi(m); journal.envois.push(m); },
    ecrireEtat: async lignes => { journal.ecrit = lignes; },
    lienDesinscription: userId => `https://exemple.supabase.co/functions/v1/alertes-desinscription?jeton=${userId}`,
    avertir: t => journal.avertissements.push(t),
    maintenant: new Date("2026-10-22T05:05:00Z")
  };
  return { deps, journal };
}
const LU = (extra = {}) => ({ nom: "Fonds", adresse: null, date_dic: "2026-01-15", frais: 0.5, sri: 4,
  historique: [["2026-09-01", 100], ["2026-10-01", 100]], ...extra });

test("principal : premier passage → aucun e-mail, état écrit pour chaque fonds", async () => {
  const { deps, journal } = monde({ fonds: { FR0000000001: LU(), FR0000000002: LU() } });
  const r = await principal(deps);
  assert.equal(journal.envois.length, 0);
  assert.deepEqual(journal.ecrit.map(l => l.cle_fonds).sort(), ["FR0000000001", "FR0000000002"]);
  const l = journal.ecrit.find(x => x.cle_fonds === "FR0000000001");
  assert.equal(l.date_dic, "2026-01-15");
  assert.equal(l.frais, 0.5);
  assert.equal(l.sri, 4);
  assert.equal(l.valeur, 100);
  assert.equal(l.date_valeur, "2026-10-01");
  assert.ok(Array.isArray(l.historique));
  assert.equal(l.maj, "2026-10-22T05:05:00.000Z");
  assert.equal(r.envoyes, 0);
});

test("principal : un e-mail par personne qui regroupe ses fonds, lien de désinscription, puis état écrit", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = {
    FR0000000001: LU({ nom: "Premier <fonds>", adresse: "fonds/premier-FR0000000001.html", frais: 0.6 }),
    FR0000000002: LU({ nom: "Second", date_dic: "2026-10-20" })
  };
  const { deps, journal } = monde({ etat, fonds });
  const r = await principal(deps);
  assert.equal(journal.envois.length, 2);
  const [a, b] = journal.envois;
  assert.equal(a.email, "a@exemple.fr");
  assert.match(a.sujet, /2 alertes/);
  assert.ok(a.html.includes("Premier &lt;fonds&gt;"));
  assert.ok(a.texte.includes(BASE_SITE + "fonds/premier-FR0000000001.html"));
  assert.ok(a.texte.includes(BASE_SITE + "decrypte.html#FR0000000002"));
  assert.ok(a.texte.includes("jeton=u1"));
  assert.equal(b.email, "b@exemple.fr");
  assert.ok(b.texte.includes("jeton=u2"));
  assert.equal(journal.ecrit.find(l => l.cle_fonds === "FR0000000002").date_dic, "2026-10-20");
  assert.equal(r.envoyes, 2);
});

test("principal : échec d'un envoi → état non écrit", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = { FR0000000001: LU({ frais: 0.6 }), FR0000000002: LU({ frais: 0.6 }) };
  const { deps, journal } = monde({ etat, fonds, envoi: async () => { throw new Error("Brevo 500"); } });
  const r = await principal(deps);
  assert.equal(journal.ecrit, null);
  assert.equal(r.etatEcrit, false);
  assert.ok(journal.avertissements.length > 0);
});

test("principal : quota Brevo dépassé → arrêt immédiat, état non écrit", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = { FR0000000001: LU({ frais: 0.6 }), FR0000000002: LU({ frais: 0.6 }) };
  let essais = 0;
  const { deps, journal } = monde({ etat, fonds,
    envoi: async () => { essais++; throw Object.assign(new Error("quota"), { quota: true }); } });
  const r = await principal(deps);
  assert.equal(essais, 1);
  assert.equal(journal.ecrit, null);
  assert.equal(r.raison, "quota");
  assert.ok(journal.avertissements.some(t => /quota/i.test(t)));
});

test("principal : GECO en maintenance (418) → rien envoyé, état inchangé", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = { FR0000000001: LU({ frais: 0.9 }),
    FR0000000002: Object.assign(new Error("la base GECO de l'AMF est en maintenance (HTTP 418)"), { maintenance: true }) };
  const { deps, journal } = monde({ etat, fonds });
  const r = await principal(deps);
  assert.equal(journal.envois.length, 0);
  assert.equal(journal.ecrit, null);
  assert.equal(r.raison, "maintenance");
  assert.ok(journal.avertissements.some(t => /maintenance/i.test(t)));
});

test("principal : erreur de lecture d'un fonds → pas d'alerte ni de mise à jour pour lui, les autres continuent", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = { FR0000000001: new Error("GECO a répondu 500"), FR0000000002: LU({ sri: 6 }) };
  const { deps, journal } = monde({ etat, fonds });
  await principal(deps);
  assert.equal(journal.envois.length, 2);
  assert.deepEqual(journal.ecrit.map(l => l.cle_fonds), ["FR0000000002"]);
  assert.ok(journal.envois.every(m => !m.texte.includes("FR0000000001")));
});

test("principal : une valeur absente cette fois garde l'ancienne (pas de fausse alerte au retour)", async () => {
  const etat = { FR0000000001: { ...ANCIEN }, FR0000000002: { ...ANCIEN } };
  const fonds = { FR0000000001: LU({ date_dic: null, frais: null, sri: null, historique: [] }), FR0000000002: LU() };
  const { deps, journal } = monde({ etat, fonds });
  await principal(deps);
  assert.equal(journal.envois.length, 0);
  const l = journal.ecrit.find(x => x.cle_fonds === "FR0000000001");
  assert.equal(l.date_dic, "2026-01-15");
  assert.equal(l.frais, 0.5);
  assert.equal(l.sri, 4);
  assert.equal(l.valeur, 100);
});

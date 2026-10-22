// Pages fixes des fonds (js/adresses.js et scripts/construire_pages.mjs → fonds/, classements/, sitemap*.xml).
// Petites données inventées sur le modèle de data/annuaire.js ; les fichiers sont écrits dans un dossier temporaire.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageFonds, pagesClassement, sitemaps, ecrireSiChange, supprimerDisparues, fondsDesPages, BASE } from "../scripts/construire_pages.mjs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// js/adresses.js est un script classique du navigateur : on le charge comme le navigateur (variables globales)
const site = vm.createContext({});
for (const f of ["js/geco.js", "js/adresses.js"]) vm.runInContext(lire(f), site, { filename: f });
const { fondsAvecPage, slugFonds, adresseFonds, lireEntree } = ["fondsAvecPage", "slugFonds", "adresseFonds", "lireEntree"]
  .reduce((o, n) => ({ ...o, [n]: vm.runInContext(n, site) }), {});

// Lignes de l'annuaire : vraies (Carmignac, Amundi) ou inventées sur leur modèle (ISIN inventés avec une clé de contrôle valide)
const CARMIGNAC = ["G", 28771, 28771, "CARMIGNAC PATRIMOINE", "CARMIGNAC GESTION", "Fonds mixtes", "FCP", "FR0010135103 FR0010306142", "2004-11-08", "FR", "", "", "", 0, 1];
const SP500 = ["G", 49843, 49843, "AMUNDI PEA S&P 500 UCITS ETF", "AMUNDI ASSET MANAGEMENT", "Actions internationales", "FCP", "FR0011871128 FR0011871136", "2014-04-17", "FR", "PSP5", "", "", 1, 1];
const CW8 = ["E", 0, 0, "Amundi MSCI World Swap UCITS ETF EUR Acc", "", "", "", "LU1681043599", "", "LU", "CW8", "Paris", "EUR", 1, 1];
const BIZARRE = ["G", 7, 7, 'A<b>&"', "SOCIETE <X>", "Fonds mixtes", "FCP", "FR0000000002", "", "FR", "", "", "", 0, 1];
const PEA_EURO = ["E", 0, 0, "Amundi PEA Euro Stoxx 50 UCITS ETF", "", "", "", "IE0000000004", "", "IE", "", "", "EUR", 1, 1];
const PEA_CHER = ["E", 0, 0, "Autre PEA S&P 500 ETF", "", "", "", "LU0000000009", "", "LU", "", "", "EUR", 1, 1];
const ligne = (source, nom, isins, extra = {}) =>
  [source, 1, 1, nom, extra.gest ?? "SOCIETE", "", extra.nature ?? "FCP", isins, "", "FR", "", "", "", 0, extra.pub ?? 1];

const RESUMES = { maj: "2026-10-20", fonds: {
  FR0010135103: [1.5, 3, "3 ans", "Surperformer son indicateur de référence sur 3 ans.", "2026-02-15", "2026-10-20"],
  FR0011871128: [0.12, 4, "5 ans", "Répliquer l'indice S&P 500.", "2026-08-06", "2026-10-19"]
}, essais: { FR0000000002: "2026-10-20" } };
const ALT = { "LU1681043599": { frais: 0.38, dateDic: "2026-03-01", releve: "2026-10-21" }, "LU0000000009": { frais: 0.5, dateDic: "", releve: "2026-10-21" } };

const titre = html => html.match(/<title>([^<]*)<\/title>/)[1];

test("slugFonds : minuscules sans accents, « - » entre les mots, 60 caractères au plus", () => {
  assert.equal(slugFonds("CARMIGNAC PATRIMOINE"), "carmignac-patrimoine");
  assert.equal(slugFonds("Éléphant Été Œuvre"), "elephant-ete-oeuvre");
  assert.equal(slugFonds("AMUNDI PEA S&P 500 UCITS ETF"), "amundi-pea-s-p-500-ucits-etf");
  assert.equal(slugFonds("L'Europe d'abord"), "l-europe-d-abord");
  assert.equal(slugFonds("  --A<b>&\"--  "), "a-b");
  const long = slugFonds("Fonds ".repeat(20));
  assert.ok(long.length <= 60 && !long.endsWith("-") && !long.startsWith("-"), long);
  assert.equal(slugFonds("%%%"), "fonds");
});

test("fondsAvecPage : G public avec ISIN, hors FCPE, HSBC et réservés ; ETF E ; jamais S, R, U", () => {
  const e = l => lireEntree(l);
  assert.equal(fondsAvecPage(e(CARMIGNAC)), true);
  assert.equal(fondsAvecPage(e(CW8)), true);
  assert.equal(fondsAvecPage(e(ligne("G", "FCPE", "FR0000000010", { nature: "FCPE" }))), false);
  assert.equal(fondsAvecPage(e(ligne("G", "HSBC", "FR0000000010", { gest: "HSBC ASSET MANAGEMENT (FRANCE)" }))), false);
  assert.equal(fondsAvecPage(e(ligne("G", "Réservé", "FR0000000010", { pub: 0 }))), false);
  assert.equal(fondsAvecPage(e(ligne("G", "Sans ISIN", ""))), false);
  assert.equal(fondsAvecPage(e(ligne("G", "ISIN masqué", "XXXXXXXXXXXX"))), false);
  assert.equal(fondsAvecPage(e(ligne("G", "ISIN factice", "FR0000000000"))), false);   // clé de contrôle fausse
  for (const s of ["S", "R", "U", "N"]) assert.equal(fondsAvecPage(e(ligne(s, "Étranger", "LU0000000009"))), false, s);
  assert.equal(fondsAvecPage(null), false);
});

test("adresseFonds : fonds/<slug>-<ISIN de la première part>.html ; deux fonds au même nom ont deux adresses", () => {
  assert.equal(adresseFonds(lireEntree(CARMIGNAC)), "fonds/carmignac-patrimoine-FR0010135103.html");
  assert.equal(adresseFonds(lireEntree(ligne("G", "FCPE", "FR0000000010", { nature: "FCPE" }))), null);
  const a = adresseFonds(lireEntree(ligne("G", "Même nom", "FR0000000010")));
  const b = adresseFonds(lireEntree(ligne("G", "Même nom", "FR0000000028")));
  assert.notEqual(a, b);
});

test("fondsDesPages : une page par ISIN, la première ligne gardée, fonds sans page écartés", () => {
  const doublon = [...CARMIGNAC]; doublon[3] = "CARMIGNAC PATRIMOINE BIS";
  const f = fondsDesPages([CARMIGNAC, doublon, CW8, ligne("G", "FCPE", "FR0000000010", { nature: "FCPE" })]);
  assert.deepEqual(f.map(e => e.nom), ["CARMIGNAC PATRIMOINE", "Amundi MSCI World Swap UCITS ETF EUR Acc"]);
});

test("page d'un fonds : titre, description, canonique, résumé du DIC et source datée", () => {
  const html = pageFonds(lireEntree(CARMIGNAC), RESUMES.fonds.FR0010135103);
  assert.equal(titre(html), "CARMIGNAC PATRIMOINE : frais 1,5 %, risque 3/7 · Décrypte ton fonds");
  assert.match(html, /<meta name="description" content="CARMIGNAC PATRIMOINE \(FR0010135103\)[^"]*frais courants 1,5 %[^"]*">/i);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}fonds/carmignac-patrimoine-FR0010135103.html">`));
  assert.equal(BASE, "https://cleante-f.github.io/decrypte-ton-fonds/");
  const resume = html.match(/<section class="fiche-entete resume-fixe"[\s\S]*?<\/section>/)[0];
  for (const t of ["<h1>CARMIGNAC PATRIMOINE</h1>", "FR0010135103", "CARMIGNAC GESTION", "Fonds mixtes", "08/11/2004", "France",
    "1,5 %", "3/7", "3 ans", "Surperformer son indicateur de référence sur 3 ans.",
    "AMF – DIC (base GECO), relevé du 20/10/2026", "DIC du 15/02/2026"]) assert.ok(resume.includes(t), t);
  // le résumé est dans <main>, avant la zone de résultat
  const main = html.match(/<main>[\s\S]*<\/main>/)[0];
  assert.ok(main.indexOf("resume-fixe") >= 0 && main.indexOf("resume-fixe") < main.indexOf('id="resultat"'));
  // liens vers les classements utiles, en chemins relatifs
  assert.ok(resume.includes('href="../classements/categorie-fonds-mixtes.html"'));
  assert.ok(resume.includes('href="../classements/lettre-c.html"'));
  assert.ok(!html.includes("undefined") && !html.includes("null"));
});

test("page d'un fonds : nom avec < & \" échappé partout", () => {
  const html = pageFonds(lireEntree(BIZARRE), null);
  assert.equal(titre(html), "A&lt;b&gt;&amp;&quot; · Décrypte ton fonds");
  assert.ok(!html.includes("A<b>") && !html.includes("<X>"));
  assert.ok(html.includes("<h1>A&lt;b&gt;&amp;&quot;</h1>"));
  assert.ok(html.includes("SOCIETE &lt;X&gt;"));
  assert.ok(html.includes('href="https://cleante-f.github.io/decrypte-ton-fonds/fonds/a-b-FR0000000002.html"'));
});

test("page d'un fonds sans DIC lu : identité seule, sans « undefined »", () => {
  const html = pageFonds(lireEntree(BIZARRE), undefined);
  assert.ok(!/undefined|null|NaN/.test(html));
  assert.ok(!html.includes("relevé du"));
  assert.ok(!html.includes("/7") && !html.includes("Frais courants"), "aucun chiffre du DIC");
});

test("page d'un ETF étranger : identité et frais de la liste des alternatives", () => {
  const html = pageFonds(lireEntree(CW8), null, { alternative: ALT.LU1681043599 });
  assert.equal(titre(html), "Amundi MSCI World Swap UCITS ETF EUR Acc : frais 0,38 % · Décrypte ton fonds");
  assert.ok(html.includes("Luxembourg") && html.includes("MSCI World") && html.includes("ETF"));
  assert.ok(html.includes("AMF – DIC (base GECO), relevé du 21/10/2026"));
  assert.ok(html.includes('href="../classements/indice-msci-world.html"'));
  assert.ok(!/undefined|null|NaN/.test(html));
});

test("page d'un fonds : mêmes scripts que decrypte.html, en ../, et réglage du fonds de la page juste avant app.js", () => {
  const html = pageFonds(lireEntree(SP500), RESUMES.fonds.FR0011871128);
  const scripts = h => [...h.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts(html), scripts(lire("decrypte.html")).map(s => "../" + s));
  assert.ok(html.includes('<link rel="stylesheet" href="../css/style.css">'));
  assert.ok(html.includes('<link rel="icon" href="../favicon.svg"'));
  assert.ok(html.includes('href="../index.html" class="logo"'));
  assert.ok(html.includes('data-page="../performances.html"'));
  assert.ok(html.includes('href="../mentions-legales.html"'));
  assert.ok(html.includes('<script>var FICHE_FIXE = "FR0011871128";</script>\n  <script src="../js/app.js"></script>'));
  assert.ok(!/(src|href)="(js|css|data|fonts)\//.test(html));
  assert.ok(html.includes("Éligible au PEA (d&#39;après le nom)"));
  assert.ok(html.includes('href="../classements/etf-pea.html"') && html.includes('href="../classements/indice-s-p-500.html"'));
});

test("classements : PEA par indice trié par frais, page par indice, par catégorie avec SRI, index A–Z", () => {
  const fonds = fondsDesPages([CARMIGNAC, SP500, CW8, BIZARRE, PEA_EURO, PEA_CHER]);
  const pages = pagesClassement(fonds, RESUMES, ALT);
  const pea = pages["classements/etf-pea.html"];
  assert.ok(pea, Object.keys(pages).join(" "));
  // section S&P 500 : Amundi (0,12 %) avant l'autre (0,5 %) ; Euro Stoxx 50 sans frais connus figure aussi
  const sp = pea.match(/<h2[^>]*>S&amp;P 500<\/h2>[\s\S]*?<\/table>/)[0];
  assert.ok(sp.indexOf("AMUNDI PEA S&amp;P 500") < sp.indexOf("Autre PEA S&amp;P 500"));
  assert.ok(pea.includes("Euro Stoxx 50"));
  assert.ok(!pea.includes("CARMIGNAC") && !pea.includes("MSCI World Swap"), "seuls les ETF éligibles au PEA");
  assert.ok(pea.includes('href="../fonds/amundi-pea-s-p-500-ucits-etf-FR0011871128.html"'));
  assert.ok(pages["classements/indice-s-p-500.html"].includes("Autre PEA S&amp;P 500"));
  assert.ok(pages["classements/indice-msci-world.html"].includes("Amundi MSCI World Swap"));
  const mixtes = pages["classements/categorie-fonds-mixtes.html"];
  assert.ok(mixtes.indexOf("CARMIGNAC PATRIMOINE") < mixtes.indexOf("A&lt;b&gt;"), "frais connus d'abord");
  assert.ok(mixtes.includes("3/7") && mixtes.includes("1,5 %"));
  assert.ok(pages["classements/lettre-c.html"].includes("CARMIGNAC PATRIMOINE"));
  assert.ok(pages["classements/lettre-a.html"].includes("A&lt;b&gt;&amp;&quot;"));
  assert.ok(!pages["classements/lettre-a.html"].includes("CARMIGNAC"));
  const index = pages["classements/index.html"];
  for (const lien of ["etf-pea.html", "indice-s-p-500.html", "categorie-fonds-mixtes.html", "lettre-a.html", "lettre-c.html"])
    assert.ok(index.includes(`href="${lien}"`), lien);
  assert.ok(!index.includes('href="lettre-b.html"'), "pas de page pour une lettre sans fonds");
  for (const [chemin, html] of Object.entries(pages)) {
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}${chemin}">`), chemin);
    assert.ok(html.includes('href="../css/style.css"') && !/undefined|NaN/.test(html), chemin);
  }
});

test("sitemaps : index + fichiers de 50 000 adresses au plus, adresses absolues", () => {
  const adresses = Array.from({ length: 50001 }, (_, i) => ({ chemin: `fonds/f-${i}.html`, lastmod: "2026-10-20" }));
  const s = sitemaps(["", { chemin: "decrypte.html" }, ...adresses], BASE);
  assert.deepEqual(Object.keys(s).sort(), ["sitemap-1.xml", "sitemap-2.xml", "sitemap.xml"]);
  assert.equal((s["sitemap-1.xml"].match(/<url>/g) || []).length, 50000);
  assert.equal((s["sitemap-2.xml"].match(/<url>/g) || []).length, 3);
  assert.ok(s["sitemap-1.xml"].startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(s["sitemap-1.xml"].includes(`<loc>${BASE}</loc>`));
  assert.ok(s["sitemap-1.xml"].includes(`<url><loc>${BASE}fonds/f-0.html</loc><lastmod>2026-10-20</lastmod></url>`));
  assert.ok(s["sitemap.xml"].includes("<sitemapindex"));
  assert.ok(s["sitemap.xml"].includes(`<loc>${BASE}sitemap-2.xml</loc>`));
  assert.ok(!/<loc>(?!https:\/\/)/.test(s["sitemap-1.xml"]));
  assert.ok(sitemaps([{ chemin: "a&b.html" }], BASE)["sitemap-1.xml"].includes("a&amp;b.html"));
});

test("ecrireSiChange : écrit une page nouvelle ou changée, laisse intacte une page identique", () => {
  const dossier = mkdtempSync(join(tmpdir(), "pages-"));
  try {
    const f = join(dossier, "fonds", "a.html");
    assert.equal(ecrireSiChange(f, "<p>1</p>"), true);
    assert.equal(readFileSync(f, "utf8"), "<p>1</p>");
    const avant = statSync(f).mtimeMs;
    writeFileSync(join(dossier, "temoin"), "");   // laisse passer le temps
    assert.equal(ecrireSiChange(f, "<p>1</p>"), false);
    assert.equal(statSync(f).mtimeMs, avant);
    assert.equal(ecrireSiChange(f, "<p>2</p>"), true);
    assert.equal(readFileSync(f, "utf8"), "<p>2</p>");
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test("supprimerDisparues : les pages des fonds sortis de l'annuaire sont supprimées, les autres fichiers gardés", () => {
  const dossier = mkdtempSync(join(tmpdir(), "pages-"));
  try {
    mkdirSync(join(dossier, "fonds"));
    for (const n of ["garde-FR0010135103.html", "parti-FR0000000002.html", "lisez-moi.txt"]) writeFileSync(join(dossier, "fonds", n), "x");
    const supprimees = supprimerDisparues(join(dossier, "fonds"), new Set(["garde-FR0010135103.html"]));
    assert.deepEqual(supprimees, ["parti-FR0000000002.html"]);
    assert.deepEqual(readdirSync(join(dossier, "fonds")).sort(), ["garde-FR0010135103.html", "lisez-moi.txt"]);
    assert.deepEqual(supprimerDisparues(join(dossier, "absent"), new Set()), []);
    assert.ok(!existsSync(join(dossier, "absent")));
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

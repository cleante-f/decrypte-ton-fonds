// Fondations de la feuille de style : palette vert sapin, contrastes lisibles, police hébergée avec le site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const RACINE = new URL("../", import.meta.url);
const CSS = readFileSync(new URL("css/style.css", RACINE), "utf8");
const DEBUTS = { clair: ":root {", sombreMedia: ':root:not([data-theme="light"]) {', sombre: ':root[data-theme="dark"] {' };

// Bloc qui suit la première occurrence de « debut » : [indice de début, indice de fin (accolade fermante)]
function bornes(css, debut) {
  const i = css.indexOf(debut);
  assert.ok(i >= 0, `bloc introuvable : ${debut}`);
  return [i, css.indexOf("}", i + debut.length)];
}
function variables(css, debut) {
  const [i, fin] = bornes(css, debut);
  const v = {};
  for (const [, nom, valeur] of css.slice(i + debut.length, fin).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) v[nom] = valeur.trim();
  return v;
}
const CLAIR = variables(CSS, DEBUTS.clair);
const SOMBRE = { ...CLAIR, ...variables(CSS, DEBUTS.sombre) };
const THEMES = { clair: CLAIR, sombre: SOMBRE };

function valeur(theme, nom) {
  const v = theme[nom];
  assert.ok(v, `variable absente : ${nom}`);
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
  return ref ? valeur(theme, ref[1]) : v.toLowerCase();
}
function luminance(hex) {
  const h = hex.replace("#", "");
  const p = (h.length === 3 ? h.split("").map(c => c + c).join("") : h).match(/../g).map(x => parseInt(x, 16) / 255);
  const [r, g, b] = p.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function verifierPaires(paires, minimum) {
  for (const [nomTheme, theme] of Object.entries(THEMES))
    for (const [texte, fond] of paires) {
      const r = contraste(valeur(theme, texte), valeur(theme, fond));
      assert.ok(r >= minimum, `${nomTheme} : ${texte} sur ${fond} = ${r.toFixed(2)} (minimum ${minimum})`);
    }
}

test("vert sapin : valeurs du spec", () => {
  const attendu = {
    clair: { "--fond": "#f6f7f6", "--carte": "#ffffff", "--texte": "#14201b", "--texte-2": "#4d5a54", "--bordure": "#dfe4e0",
      "--bordure-forte": "#7f8c86", "--accent": "#1e5b45", "--accent-fond": "#e7f0ec", "--sur-accent": "#ffffff" },
    sombre: { "--fond": "#0d1311", "--carte": "#141c19", "--texte": "#edf2ef", "--texte-2": "#a5b3ad", "--bordure": "#24302b",
      "--bordure-forte": "#64746d", "--accent": "#5fbf97", "--accent-fond": "#16271f", "--sur-accent": "#0d1311" }
  };
  for (const [nomTheme, valeurs] of Object.entries(attendu))
    for (const [nom, hex] of Object.entries(valeurs)) assert.equal(valeur(THEMES[nomTheme], nom), hex, `${nomTheme} ${nom}`);
});

test("thème sombre : les deux définitions sont identiques", () => {
  assert.deepEqual(variables(CSS, DEBUTS.sombreMedia), variables(CSS, DEBUTS.sombre));
});

test("contrastes du texte ≥ 4,5 dans les deux thèmes", () => {
  const paires = [];
  for (const texte of ["--texte", "--texte-2", "--accent"]) for (const fond of ["--fond", "--carte"]) paires.push([texte, fond]);
  paires.push(["--sur-accent", "--accent"], ["--accent", "--accent-fond"], ["--texte-2", "--accent-fond"],
    ["--vert-texte", "--vert-fond"], ["--orange-texte", "--orange-fond"], ["--rouge-texte", "--rouge-fond"],
    ["--texte", "--vert-fond"], ["--texte", "--orange-fond"], ["--texte", "--rouge-fond"]);
  verifierPaires(paires, 4.5);
});

test("contours de champ et courbes ≥ 3", () => {
  const paires = [];
  for (const trait of ["--bordure-forte", "--serie-0", "--serie-1", "--serie-2"]) for (const fond of ["--carte", "--fond"]) paires.push([trait, fond]);
  verifierPaires(paires, 3);
  for (const theme of Object.values(THEMES)) {
    const series = ["--serie-0", "--serie-1", "--serie-2"].map(n => valeur(theme, n));
    assert.equal(new Set(series).size, 3, `séries identiques : ${series}`);
  }
});

test("aucune couleur en dur hors des variables", () => {
  const exclus = Object.values(DEBUTS).map(d => bornes(CSS, d));
  const debutCreateur = CSS.indexOf("/* ---------- Bouton « Créateur » et son animation ---------- */");
  assert.ok(debutCreateur >= 0);
  exclus.push([debutCreateur, CSS.indexOf("/* ----------", debutCreateur + 10)]);
  let reste = CSS;
  for (const [i, fin] of exclus.sort((a, b) => b[0] - a[0])) reste = reste.slice(0, i) + reste.slice(fin + 1);
  reste = reste.replace(/\/\*[\s\S]*?\*\//g, "");
  const trouvees = reste.split("\n").filter(l => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(l));
  assert.deepEqual(trouvees, []);
});

test("police hébergée avec le site", () => {
  const blocs = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.equal(blocs.length, 3);
  for (const b of blocs) {
    assert.match(b, /font-family:\s*"IBM Plex Sans"/);
    assert.match(b, /font-display:\s*swap/);
    const url = b.match(/url\("\.\.\/(fonts\/[^"]+\.woff2)"\)/);
    assert.ok(url, "src sans fichier woff2 du dossier fonts/");
    assert.ok(existsSync(new URL(url[1], RACINE)), `fichier absent : ${url[1]}`);
  }
  const pages = readdirSync(RACINE).filter(f => f.endsWith(".html")).map(f => readFileSync(new URL(f, RACINE), "utf8"));
  for (const texte of [CSS, ...pages]) assert.doesNotMatch(texte, /fonts\.googleapis|fonts\.gstatic/);
});

test("focus visible et mouvement réduit", () => {
  const regles = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const focus = regles.find(([, selecteur, corps]) =>
    ["a", "button", "input", "select", "summary"].every(el => new RegExp(`(^|[\\s,])${el}:focus-visible`).test(selecteur))
    && /outline:[^;]*var\(--focus\)/.test(corps));
  assert.ok(focus, "règle :focus-visible commune absente");
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});

// ---- Relecture finale : règles qui contournent les variables ----
const debutCreateur = CSS.indexOf("/* ---------- Bouton « Créateur » et son animation ---------- */");
const HORS_CREATEUR = (CSS.slice(0, debutCreateur) + CSS.slice(CSS.indexOf("/* ----------", debutCreateur + 10))).replace(/\/\*[\s\S]*?\*\//g, "");
const REGLES = [...HORS_CREATEUR.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selecteur, corps]) => ({ selecteur: selecteur.trim(), corps }));

test("champs de saisie : contour lisible (--bordure-forte), jamais --bordure", () => {
  const fautives = REGLES.filter(({ selecteur, corps }) =>
    selecteur.split(",").some(s => /^(input|select|textarea)\b/.test(s.trim().split(/[\s>+~]+/).pop()))
    && /border(-color)?\s*:[^;]*var\(--bordure\)/.test(corps)).map(r => r.selecteur);
  assert.deepEqual(fautives, []);
});

test("couleurs de trait (vert, orange, rouge) jamais utilisées pour du texte", () => {
  const fautives = REGLES.filter(({ corps }) => /(^|[;\s])color:\s*var\(--(vert|orange|rouge|statut-[a-z]+)\)/.test(corps)).map(r => r.selecteur);
  assert.deepEqual(fautives, []);
});

test("aucun focus masqué (outline: none sur :focus)", () => {
  const fautives = REGLES.filter(({ selecteur, corps }) => selecteur.includes(":focus") && /outline:\s*none/.test(corps)).map(r => r.selecteur);
  assert.deepEqual(fautives, []);
});

test("téléphone : cibles tactiles d'au moins 44 px", () => {
  let mobile = "";
  for (let i = CSS.indexOf("@media (max-width: 760px) {"); i >= 0; i = CSS.indexOf("@media (max-width: 760px) {", i + 1)) {
    let j = CSS.indexOf("{", i) + 1;
    for (let n = 1; n > 0; j++) n += CSS[j] === "{" ? 1 : CSS[j] === "}" ? -1 : 0;
    mobile += CSS.slice(CSS.indexOf("{", i) + 1, j - 1);
  }
  mobile = mobile.replace(/\/\*[\s\S]*?\*\//g, "");
  const regles = [...mobile.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , corps]) => /min-height:\s*44px/.test(corps))
    .flatMap(([, selecteur]) => selecteur.split(",").map(s => s.trim()));
  for (const cible of [".onglets a", ".lien-bouton", ".btn-link", ".periodes button", ".chip-comparer", ".onglets-simu button",
    ".btn-onglet", ".puce", ".puce-radio span"]) assert.ok(regles.includes(cible), `${cible} : pas de min-height 44px sur téléphone`);
});

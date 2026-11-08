/*
 * Langue du site : français (par défaut) ou anglais, avec le bouton « FR | EN » de l'en-tête.
 *
 * Chargé par js/mode-site.js (premier script de chaque page, y compris les fiches et classements générés), pendant la lecture du <head>.
 * Langue choisie : ?lang=en|fr dans l'adresse, sinon la clé localStorage « langue-v1 » (posée seulement quand le visiteur clique
 * sur le bouton ou ouvre un lien ?lang=… ; décrite sur confidentialite.html et listée dans CLES_STOCKAGE_SITE, js/outils.js), sinon le français.
 *
 * En français, ce fichier ne fait qu'ajouter le bouton : le site reste exactement le même.
 * En anglais, il charge le dictionnaire js/langue-en.js (LANGUE_EN), puis traduit les textes et les attributs de la page
 * et tout ce qui apparaît ensuite (MutationObserver). Les éléments marqués data-pas-traduire (et leur contenu) ne sont jamais traduits :
 * noms de fonds et de sociétés, ISIN, extraits des DIC (ces derniers reçoivent la mention data-extrait-dic, voir plus bas).
 *
 * Pour le code qui écrit ailleurs que dans la page (canvas, alert, confirm) : t("texte français") rend la traduction en anglais,
 * le texte inchangé en français. LANGUE vaut "fr" ou "en". LOCALE_SITE vaut "fr-FR" ou "en-US" (formats des nombres et des dates).
 */
(function () {
  const CLE = "langue-v1";
  let deLAdresse = null;
  try { const p = new URLSearchParams(location.search).get("lang"); if (p === "en" || p === "fr") deLAdresse = p; } catch (e) { /* adresse illisible */ }
  let memorisee = null;
  try { memorisee = localStorage.getItem(CLE); } catch (e) { /* stockage indisponible */ }
  const langue = deLAdresse || (memorisee === "en" ? "en" : "fr");
  // Enregistre la langue choisie ; faux si le navigateur refuse le stockage
  function memoriser(code) { try { localStorage.setItem(CLE, code); return true; } catch (e) { return false; } }
  // Un lien ?lang=en vaut choix du visiteur (comme un clic sur le bouton) : retenu pour les pages suivantes et les redirections.
  // ?lang=fr n'enregistre rien, sauf pour remplacer un « en » déjà enregistré (le français est la langue par défaut).
  let memorise = memorisee === langue;
  if (deLAdresse && deLAdresse !== memorisee && (deLAdresse === "en" || memorisee)) memorise = memoriser(deLAdresse);
  globalThis.LANGUE = langue;
  globalThis.LOCALE_SITE = langue === "en" ? "en-US" : "fr-FR";

  // Normalisation des clés du dictionnaire : espaces insécables et suites d'espaces → un espace, sans espaces autour
  const norm = s => s.replace(/[  \s]+/g, " ").trim();
  globalThis.normaliserTexteLangue = norm;

  let textes = null, modeles = [], selProteger = "", selExtraits = "";
  function chargerDico() {
    if (textes || typeof LANGUE_EN === "undefined") return !!textes;
    textes = new Map();
    for (const [fr, en] of Object.entries(LANGUE_EN.textes || {})) textes.set(norm(fr), en);
    modeles = (LANGUE_EN.modeles || []).map(([re, en]) => [re, en]);
    // sélecteurs invalides ignorés un par un (un seul mauvais sélecteur ne doit pas tout bloquer)
    const valides = l => (l || []).filter(sel => { try { document.querySelector(sel); return true; } catch (e) { return false; } }).join(",");
    if (typeof document !== "undefined") { selProteger = valides(LANGUE_EN.proteger); selExtraits = valides(LANGUE_EN.extraits); }
    return true;
  }

  // Traduction d'un texte (déjà normalisé ou non) ; null si inconnu
  function traduire(brut) {
    if (!chargerDico()) return null;
    const s = norm(brut);
    if (!s || !/[A-Za-zÀ-ÿ]/.test(s)) return null;
    const exact = textes.get(s);
    if (exact !== undefined) return exact;
    for (const [re, en] of modeles) {
      re.lastIndex = 0;
      if (re.test(s)) { re.lastIndex = 0; return s.replace(re, typeof en === "function" ? (...m) => en(...m) : en); }
    }
    return null;
  }

  globalThis.t = function (s) {
    if (langue !== "en" || typeof s !== "string") return s;
    const r = traduire(s);
    if (r === null) return s;
    // garder les espaces de début et de fin du texte d'origine
    const debut = s.match(/^[\s ]*/)[0], fin = s.match(/[\s ]*$/)[0];
    return debut + r + fin;
  };

  // Bouton FR | EN (dans .entete-actions, sinon à la fin de l'en-tête)
  function poserBouton() {
    if (document.getElementById("choix-langue")) return;
    const hote = document.querySelector(".site-header .entete-actions") || document.querySelector(".site-header");
    if (!hote) return;
    const g = document.createElement("div");
    g.id = "choix-langue";
    g.className = "choix-langue";
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", langue === "en" ? "Language" : "Langue");
    g.setAttribute("data-pas-traduire", "");
    for (const [code, lib, titre] of [["fr", "FR", "Français"], ["en", "EN", "English"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = lib;
      b.title = titre;
      b.lang = code;
      b.setAttribute("aria-pressed", String(code === langue));
      b.addEventListener("click", () => changerLangue(code));
      g.appendChild(b);
    }
    hote.prepend(g);
  }

  function changerLangue(code) {
    if (code === langue && !deLAdresse) return;
    const ok = memoriser(code); // sinon (stockage refusé) la langue passe par l'adresse
    let url;
    try { url = new URL(location.href); url.searchParams.delete("lang"); if (!ok) url.searchParams.set("lang", code); } catch (e) { url = null; }
    // même adresse (ou seul le # diffère) : replace() ne rechargerait pas la page
    if (url && url.toString().split("#")[0] !== location.href.split("#")[0]) location.replace(url.toString()); else location.reload();
  }

  if (typeof document === "undefined") return;

  if (langue !== "en") {
    document.addEventListener("DOMContentLoaded", poserBouton);
    return;
  }

  // ---------- Anglais ----------
  const ici = document.currentScript && document.currentScript.src;
  if (ici && document.readyState === "loading") document.write('<script src="' + ici.replace(/langue\.js(\?.*)?$/, "langue-en.js") + '"><\/script>');
  document.documentElement.lang = "en";
  // Page masquée jusqu'à la première traduction (au plus 1,5 s), pour éviter un éclair de français
  document.documentElement.classList.add("langue-attente");
  const st = document.createElement("style");
  st.textContent = "html.langue-attente body{visibility:hidden}";
  document.head.appendChild(st);
  setTimeout(() => document.documentElement.classList.remove("langue-attente"), 1500);

  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const SAUTER = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "svg:style"]);
  const faits = new WeakMap(); // nœud texte → dernière valeur écrite par nous

  function protege(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hasAttribute("data-pas-traduire") || e.isContentEditable || SAUTER.has(e.tagName)) return true;
      if (selProteger && e.matches(selProteger)) return true;
      if (e.hasAttribute("data-extrait-dic") || (selExtraits && e.matches(selExtraits))) return true;
    }
    return false;
  }

  // Fiches fixes (scripts/construire_pages.mjs) : « <strong>Objectif (extrait du DIC) :</strong> texte du DIC » dans un même <p> :
  // le texte qui suit ce libellé est un extrait du DIC, gardé en français
  const apresLibelleDic = n => { const p = n.previousSibling; return !!(p && p.nodeType === 1 && p.tagName === "STRONG" && /^(Objectif \(extrait du DIC\)|Objective \(original French excerpt)/.test(p.textContent.trim())); };

  function traduireTexte(n) {
    const v = n.nodeValue;
    if (!v || faits.get(n) === v || apresLibelleDic(n)) return;
    const r = t(v);
    if (r !== v) { faits.set(n, r); n.nodeValue = r; }
  }

  // seulementMarques : élément protégé (nom de fonds, extrait…) : son texte reste tel quel, mais ses infobulles (title, aria-label…)
  // passent quand même par le dictionnaire (les modèles gardent les noms tels quels) ; le bouton de langue est exclu
  function traduireAttrs(el, seulementMarques) {
    if (!seulementMarques || el.id !== "choix-langue" && !el.closest("#choix-langue")) for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const r = t(v); if (r !== v) el.setAttribute(a, r); }
    }
    if (!seulementMarques && el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) { const r = t(el.value); if (r !== el.value) el.value = r; }
    if (el.hasAttribute("data-seulement-en")) el.hidden = false;
    if (selExtraits && !el.hasAttribute("data-extrait-dic") && el.matches(selExtraits)) el.setAttribute("data-extrait-dic", "");
    if (el.hasAttribute("data-extrait-dic") && !el.hasAttribute("data-mention-dic")) {
      el.setAttribute("data-mention-dic", "");
      el.title = "Original French excerpt from the official KID (Key Information Document)";
      const m = document.createElement("span");
      m.className = "mention-dic";
      m.textContent = " (original French excerpt from the official KID)";
      el.after(m);
    }
  }

  function parcourir(racine) {
    if (racine.nodeType === 3) { if (!protege(racine.parentElement)) traduireTexte(racine); return; }
    if (racine.nodeType !== 1) return;
    if (protege(racine)) { traduireAttrs(racine, true); return; }
    traduireAttrs(racine);
    const w = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.hasAttribute("data-pas-traduire") || SAUTER.has(n.tagName) || n.isContentEditable || (selProteger && n.matches(selProteger)) || n.hasAttribute("data-extrait-dic") || (selExtraits && n.matches(selExtraits))) { traduireAttrs(n, true); return NodeFilter.FILTER_REJECT; }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) traduireTexte(n); else traduireAttrs(n); }
  }

  function traduireTete() {
    const tt = t(document.title); if (tt !== document.title) document.title = tt;
    document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').forEach(m => {
      const c = m.getAttribute("content"); if (c) { const r = t(c); if (r !== c) m.setAttribute("content", r); }
    });
  }

  // Garder ?lang=en sur les liens internes quand la langue vient de l'adresse et n'a pas pu être enregistrée (stockage refusé)
  function garderLangueDansLiens() {
    if (deLAdresse !== "en") return;
    document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      try { const u = new URL(a.href, location.href); if (u.origin === location.origin && !u.searchParams.has("lang")) { u.searchParams.set("lang", "en"); a.href = u.toString(); } } catch (err) { /* lien illisible */ }
    }, true);
  }

  function demarrer() {
    chargerDico();
    poserBouton();
    traduireTete();
    parcourir(document.body);
    document.documentElement.classList.remove("langue-attente");
    new MutationObserver(liste => {
      for (const m of liste) {
        if (m.type === "characterData") { if (!protege(m.target.parentElement)) traduireTexte(m.target); }
        else if (m.type === "attributes") { if (!protege(m.target)) traduireAttrs(m.target); }
        else m.addedNodes.forEach(parcourir);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["value"]) });
    new MutationObserver(traduireTete).observe(document.head, { childList: true, subtree: true, characterData: true });
    if (!memorise) garderLangueDansLiens();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
})();

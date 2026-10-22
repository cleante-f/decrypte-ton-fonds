/*
 * Adresses des pages fixes des fonds (fonds/<nom-en-minuscules>-<ISIN>.html), faites pour être trouvées par Google.
 * Une seule règle pour le site et pour les scripts : ce fichier est un script classique du navigateur (variables globales),
 * que scripts/construire_resumes.mjs et scripts/construire_pages.mjs chargent aussi avec node:vm.
 *
 * Fonds avec une page : fonds français (GECO, lignes « G ») ouverts à tous, avec un ISIN, hors FCPE et hors HSBC
 * (données interdites sans accord écrit) ; ETF cotés en Europe (lignes « E »). La page porte l'ISIN de la première part.
 * Le fonds est une entrée de l'annuaire lue par lireEntree (js/geco.js).
 *
 * Une page par ISIN : celle de la ligne que le site ouvre pour cet ISIN (lignesParIsin, js/geco.js). La fiche affichée sous
 * le résumé de la page (FICHE_FIXE, js/app.js) est donc celle du même fonds. Les autres lignes au même ISIN n'ont pas de page.
 */

// ISIN : 2 lettres, 9 caractères, 1 chiffre de contrôle (formule de Luhn sur les lettres converties en nombres A=10…Z=35).
// Écarte les ISIN masqués (« XXXXXXXXXXXX ») et factices (« FR0000000000 ») de l'annuaire.
function isinValide(isin) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin || "")) return false;
  const chiffres = isin.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let somme = 0;
  for (let i = chiffres.length - 1, double = false; i >= 0; i--, double = !double) {
    let n = Number(chiffres[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
  }
  return somme % 10 === 0;
}

function fondsAvecPage(e) {
  if (!e || !e.isins || !isinValide(e.isins[0])) return false;
  if (e.source === "E") return true;
  return e.source === "G" && e.public === true && !/FCPE/i.test(e.nature || "") && !/HSBC/i.test(e.gestionnaire || "");
}

// Premiers mots qui font bloquer un fichier par les bloqueurs de publicité (même liste que le vérificateur de publication)
const DEBUTS_BLOQUES = /^(analyse|analyses|analytics|analytic|tracking|tracker|track|ads|ad|advert|adverts|advertising|pub|pubs|banner|banners|pixel|beacon|stats|statistics|counter|telemetry|metrics)(-|$)/;

// Nom en minuscules, sans accents, « - » à la place de tout autre caractère, 60 caractères au plus, sans tiret au bout ;
// « fonds- » devant un nom qui commence comme un fichier de publicité (« ads-… », « tracker-… »)
function slugFonds(nom) {
  const slug = String(nom || "").replace(/[œŒ]/g, "oe").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
  if (!slug) return "fonds";
  return DEBUTS_BLOQUES.test(slug) ? ("fonds-" + slug).slice(0, 60).replace(/-+$/, "") : slug;
}

// Fonds qui ont une page (entrées lireEntree), dans l'ordre de l'annuaire. Sert à scripts/construire_pages.mjs.
function fondsDesPages(lignes) {
  const parIsin = lignesParIsin(lignes), res = [];
  lignes.forEach((l, i) => {
    const e = lireEntree(l);
    if (fondsAvecPage(e) && parIsin.get(e.isins[0]) === i) res.push(e);
  });
  return res;
}

// Deux entrées lues de la même ligne de l'annuaire (lireEntree crée un nouvel objet à chaque lecture)
function memeLigne(a, b) {
  return !!a && !!b && a.source === b.source && a.cmpId === b.cmpId && a.prdId === b.prdId && a.nom === b.nom
    && a.isins.join(" ") === b.isins.join(" ");
}

// Chemin de la page, relatif à la racine du site, ou null si le fonds n'a pas de page.
// Dans le site (annuaire chargé), null aussi pour une ligne qui ne possède pas la page de son ISIN (voir fondsDesPages).
// Les scripts, sans annuaire global, ne demandent que l'adresse des fonds de fondsDesPages.
function adresseFonds(e) {
  if (!fondsAvecPage(e)) return null;
  if (typeof ANNUAIRE !== "undefined" && !memeLigne(annuaireParIsin(e.isins[0]), e)) return null;
  return `fonds/${slugFonds(e.nom)}-${e.isins[0]}.html`;
}

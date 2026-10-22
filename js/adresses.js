/*
 * Adresses des pages fixes des fonds (fonds/<nom-en-minuscules>-<ISIN>.html), faites pour être trouvées par Google.
 * Une seule règle pour le site et pour les scripts : ce fichier est un script classique du navigateur (variables globales),
 * que scripts/construire_resumes.mjs et scripts/construire_pages.mjs chargent aussi avec node:vm.
 *
 * Fonds avec une page : fonds français (GECO, lignes « G ») ouverts à tous, avec un ISIN, hors FCPE et hors HSBC
 * (données interdites sans accord écrit) ; ETF cotés en Europe (lignes « E »). La page porte l'ISIN de la première part.
 * Le fonds est une entrée de l'annuaire lue par lireEntree (js/geco.js).
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

// Nom en minuscules, sans accents, « - » à la place de tout autre caractère, 60 caractères au plus, sans tiret au bout
function slugFonds(nom) {
  const slug = String(nom || "").replace(/[œŒ]/g, "oe").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
  return slug || "fonds";
}

// Chemin de la page, relatif à la racine du site, ou null si le fonds n'a pas de page
function adresseFonds(e) {
  return fondsAvecPage(e) ? `fonds/${slugFonds(e.nom)}-${e.isins[0]}.html` : null;
}

/*
 * Mode du site : décide, d'après l'adresse, si cette copie du site garde les comptes (mode « comptes ») ou les cache (mode « gratuit »).
 * Un seul code sert les deux sites : GitHub Pages et l'adresse principale de Cloudflare sont en mode gratuit ;
 * le domaine (decrypte-ton-fonds.fr et www.decrypte-ton-fonds.fr), l'aperçu « comptes » de Cloudflare et localhost gardent les comptes.
 * Toute adresse inconnue est en mode gratuit. Sur le domaine, les comptes sont gratuits tant que le paiement est coupé :
 * l'interrupteur est CONFIG_COMPTE.paiementActif (js/config-compte.js), à remettre à true pour rouvrir l'abonnement
 * (avec, dans la base, reglages_site.paiement_actif : voir supabase/migrations/20261023000000_paiement.sql).
 *
 * Pour passer un nouveau domaine en mode comptes, il faut l'ajouter à HOTES_COMPTES : c'est la seule liste des adresses
 * en mode comptes. Il faut aussi ajouter l'adresse à ORIGINES dans .github/workflows/supabase.yml (adresses autorisées à appeler
 * les fonctions Supabase ; la première sert de lien vers le site dans les e-mails).
 *
 * Paiement : CONFIG_COMPTE.paiementActif (js/config-compte.js, chargé en fin de page) dit si l'abonnement existe. Coupé, les comptes
 * sont gratuits : une fois la page lue, <html data-paiement="coupe"> ; les éléments data-si-paiement="actif" et le lien CGV
 * du pied de page sont cachés, et abonnement.html / cgv.html renvoient vers compte.html (le contrôle d'accès de Cloudflare
 * le fait aussi, avant même d'envoyer la page).
 *
 * Ce fichier est chargé en premier dans le <head> de chaque page (script classique, avant tout autre script),
 * et importé par serveur/acces.js (contrôle d'accès de Cloudflare), qui y lit la même règle. Pas d'export/import ici :
 * tout est rangé dans globalThis pour fonctionner dans les deux cas.
 *
 * Dans un navigateur seulement, il marque aussi la page (<html data-site="gratuit|comptes" data-heberge-par="github|cloudflare">),
 * en mode gratuit, renvoie les pages de compte vers l'accueil et, une fois la page lue, pose l'attribut « hidden » sur les éléments
 * de l'autre mode et de l'autre hébergeur (pour le mode lecture, qui ignore la feuille de style).
 */
(function () {
  // Adresses en mode comptes (en minuscules). Toute autre adresse est en mode gratuit.
  const HOTES_COMPTES = ["decrypte-ton-fonds.fr", "www.decrypte-ton-fonds.fr", "comptes.decrypte-ton-fonds.pages.dev", "localhost"];

  // Adresse officielle du site. Quand REDIRIGER_VERS_DOMAINE est vrai, une page ouverte sur GitHub Pages
  // (cleante-f.github.io/decrypte-ton-fonds/…) renvoie vers la même page sur ce domaine : Google ne voit qu'un seul site.
  const DOMAINE_SITE = "https://decrypte-ton-fonds.fr/";
  const REDIRIGER_VERS_DOMAINE = true;
  const CHEMIN_GITHUB = "/decrypte-ton-fonds";

  // Pages qui n'existent qu'en mode comptes : nom de fichier sans « .html ».
  // GitHub les sert avec « .html » (connexion.html), Cloudflare sans (connexion).
  const PAGES_COMPTE = ["connexion", "compte", "abonnement", "cgv", "alertes-desactivees"];
  // Pages de compte qui n'existent que si le paiement est actif
  const PAGES_PAYANTES = ["abonnement", "cgv"];

  function enMinuscules(texte) {
    return String(texte || "").toLowerCase();
  }

  // "comptes" seulement si l'adresse est dans HOTES_COMPTES ; "gratuit" pour tout le reste (y compris vide ou absente).
  // Les espaces autour et UN point final (nom de domaine absolu : « comptes.decrypte-ton-fonds.pages.dev. ») sont retirés
  // avant la comparaison : sinon une requête écrite avec le point final sauterait le contrôle d'accès de Cloudflare.
  function modeSite(hote) {
    const nom = enMinuscules(hote).trim().replace(/\.$/, "");
    return HOTES_COMPTES.includes(nom) ? "comptes" : "gratuit";
  }

  // "github" pour *.github.io, "cloudflare" pour tout le reste (pages.dev, localhost…).
  function hebergeurSite(hote) {
    return enMinuscules(hote).endsWith(".github.io") ? "github" : "cloudflare";
  }

  // Vrai si le chemin est celui d'une page de compte, avec ou sans « .html » et quel que soit le dossier devant
  // (/decrypte-ton-fonds/compte.html sur GitHub, /connexion sur Cloudflare). Jamais vrai pour l'accueil.
  const nomDePage = chemin => enMinuscules(chemin).split("/").pop().replace(/\.html$/, "");
  function estPageCompte(chemin) {
    return PAGES_COMPTE.includes(nomDePage(chemin));
  }
  function estPagePayante(chemin) {
    return PAGES_PAYANTES.includes(nomDePage(chemin));
  }

  // Paiement actif ? Faux si le site l'a coupé (CONFIG_COMPTE.paiementActif === false) ou si la base le dit coupé
  // (« droits » : réponse de droit_acces, champ paiement_actif). Réglage absent : actif, comme dans la base
  // (jamais d'accès gratuit par accident).
  function paiementActif(droits) {
    const config = globalThis.CONFIG_COMPTE;
    if (config && config.paiementActif === false) return false;
    return !(droits && droits.paiement_actif === false);
  }

  // Même page sur DOMAINE_SITE (recherche et # gardés) pour une page de GitHub Pages de ce site ; sinon null.
  function adresseSurDomaine(loc) {
    if (hebergeurSite(loc.hostname) !== "github" || enMinuscules(loc.hostname) !== "cleante-f.github.io") return null;
    const chemin = String(loc.pathname || "");
    if (chemin !== CHEMIN_GITHUB && !chemin.startsWith(CHEMIN_GITHUB + "/")) return null;
    return DOMAINE_SITE + chemin.slice(CHEMIN_GITHUB.length).replace(/^\//, "") + (loc.search || "") + (loc.hash || "");
  }

  globalThis.HOTES_COMPTES = HOTES_COMPTES;
  globalThis.DOMAINE_SITE = DOMAINE_SITE;
  globalThis.adresseSurDomaine = adresseSurDomaine;
  globalThis.modeSite = modeSite;
  globalThis.hebergeurSite = hebergeurSite;
  globalThis.estPageCompte = estPageCompte;
  globalThis.estPagePayante = estPagePayante;
  globalThis.paiementActif = paiementActif;

  // Racine du site vue de la page : "" pour les pages de la racine, "../" pour les pages rangées dans un dossier (fonds/…,
  // classements/…). Déduite du chemin de ce script, écrit « js/mode-site.js » ou « ../js/mode-site.js » dans la page.
  // Les scripts du site la placent devant les chemins qu'ils construisent (data/…, pages du site). Jamais une autre adresse.
  globalThis.RACINE_SITE = "";
  if (typeof document !== "undefined" && document.currentScript) {
    const m = String(document.currentScript.getAttribute("src") || "").match(/^((?:\.\.\/)*)js\/mode-site\.js(?:[?#].*)?$/);
    if (m) globalThis.RACINE_SITE = m[1];
  }

  // Effets dans un navigateur seulement (ni document ni location côté serveur ni dans les tests sans page simulée).
  if (typeof document !== "undefined") {
    const ailleurs = REDIRIGER_VERS_DOMAINE ? adresseSurDomaine(location) : null;
    if (ailleurs) { location.replace(ailleurs); return; }
    const mode = modeSite(location.hostname);
    const hebergeur = hebergeurSite(location.hostname);
    document.documentElement.dataset.site = mode;
    document.documentElement.dataset.hebergePar = hebergeur;
    // Page de compte en mode gratuit : retour à l'accueil, sans garder la page dans l'historique.
    if (mode === "gratuit" && estPageCompte(location.pathname)) location.replace("index.html");

    // Le mode lecture des navigateurs ignore la feuille de style : il afficherait les deux versions des pages légales.
    // L'attribut « hidden », qu'il respecte, cache donc aussi les éléments de l'autre mode et de l'autre hébergeur.
    // Jamais retiré : un élément de ce mode peut être caché pour une autre raison.
    const masquerAutreVersion = () => {
      document.querySelectorAll("[data-seulement]").forEach(el => { if (el.getAttribute("data-seulement") !== mode) el.hidden = true; });
      document.querySelectorAll("[data-si-hebergeur]").forEach(el => { if (el.getAttribute("data-si-hebergeur") !== hebergeur) el.hidden = true; });
      // Paiement : lu seulement maintenant, js/config-compte.js étant chargé en fin de page
      const paiement = paiementActif() ? "actif" : "coupe";
      document.documentElement.dataset.paiement = paiement;
      if (mode === "comptes" && paiement === "coupe" && estPagePayante(location.pathname)) {
        location.replace(globalThis.RACINE_SITE + "compte.html");
        return;
      }
      document.querySelectorAll("[data-si-paiement]").forEach(el => { if (el.getAttribute("data-si-paiement") !== paiement) el.hidden = true; });
      // Lien « CGV » du pied de page (pages générées comprises) : caché avec son séparateur
      if (paiement === "coupe") {
        document.querySelectorAll("a[href]").forEach(a => {
          if (nomDePage(a.getAttribute("href")) !== "cgv" || !a.closest(".liens-pied")) return;
          const parent = a.parentElement;
          (parent && parent.hasAttribute("data-seulement") ? parent : a).hidden = true;
        });
      }
    };
    // Ce script est lu dans le <head>, avant le contenu de la page : on attend qu'elle soit lue en entier.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", masquerAutreVersion);
    else masquerAutreVersion();
  }
})();

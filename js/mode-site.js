/*
 * Mode du site : décide, d'après l'adresse, si cette copie du site garde les comptes (mode « comptes ») ou les cache (mode « gratuit »).
 * Un seul code sert les deux sites : GitHub Pages et l'adresse principale de Cloudflare sont en mode gratuit,
 * seuls l'aperçu « comptes » de Cloudflare et localhost gardent les comptes. Toute adresse inconnue est en mode gratuit.
 *
 * Pour passer un nouveau domaine en mode comptes (par exemple le vrai domaine au lancement payant), il faut
 * l'ajouter à HOTES_COMPTES : c'est la seule liste des adresses en mode comptes. Au lancement payant, il faut aussi ajouter
 * l'adresse EN PREMIÈRE position de ORIGINES dans .github/workflows/supabase.yml (adresses autorisées à appeler les fonctions
 * Supabase ; la première sert de lien vers le site dans les e-mails).
 *
 * Ce fichier est chargé en premier dans le <head> de chaque page (script classique, avant tout autre script),
 * et importé par serveur/acces.js (contrôle d'accès de Cloudflare), qui y lit la même règle. Pas d'export/import ici :
 * tout est rangé dans globalThis pour fonctionner dans les deux cas.
 *
 * Dans un navigateur seulement, il marque aussi la page (<html data-site="gratuit|comptes" data-heberge-par="github|cloudflare">)
 * et, en mode gratuit, renvoie les pages de compte vers l'accueil.
 */
(function () {
  // Adresses en mode comptes (en minuscules). Toute autre adresse est en mode gratuit.
  const HOTES_COMPTES = ["comptes.decrypte-ton-fonds.pages.dev", "localhost"];

  // Pages qui n'existent qu'en mode comptes : nom de fichier sans « .html ».
  // GitHub les sert avec « .html » (connexion.html), Cloudflare sans (connexion).
  const PAGES_COMPTE = ["connexion", "compte", "abonnement", "cgv"];

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
  function estPageCompte(chemin) {
    const dernier = enMinuscules(chemin).split("/").pop();
    return PAGES_COMPTE.includes(dernier.replace(/\.html$/, ""));
  }

  globalThis.HOTES_COMPTES = HOTES_COMPTES;
  globalThis.modeSite = modeSite;
  globalThis.hebergeurSite = hebergeurSite;
  globalThis.estPageCompte = estPageCompte;

  // Effets dans un navigateur seulement (ni document ni location côté serveur ni dans les tests sans page simulée).
  if (typeof document !== "undefined") {
    const mode = modeSite(location.hostname);
    document.documentElement.dataset.site = mode;
    document.documentElement.dataset.hebergePar = hebergeurSite(location.hostname);
    // Page de compte en mode gratuit : retour à l'accueil, sans garder la page dans l'historique.
    if (mode === "gratuit" && estPageCompte(location.pathname)) location.replace("index.html");
  }
})();

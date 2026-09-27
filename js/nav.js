/*
 * Onglets du site : le fonds consulté (dans l'adresse, après #) suit l'utilisateur d'un onglet à l'autre.
 * Ex. sur decrypte.html#FR0010135103, l'onglet « Performances » pointe vers performances.html#FR0010135103.
 */
(function () {
  function majOnglets() {
    const cle = decodeURIComponent(location.hash.slice(1));
    const fonds = /^[A-Z0-9]{5,}$/i.test(cle) ? "#" + encodeURIComponent(cle) : "";
    document.querySelectorAll(".onglets a[data-fonds]").forEach(a => {
      a.href = a.dataset.page + fonds;
    });
  }
  window.addEventListener("hashchange", majOnglets);
  majOnglets();
})();

// Lit une recherche transmise par la page d'accueil (?q=…)
function rechercheDansAdresse() {
  try { return new URLSearchParams(location.search).get("q") || ""; } catch (e) { return ""; }
}

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

// Si un fichier du site n'a pas pu être chargé (bloqueur de publicités, connexion coupée),
// on le dit clairement au lieu de laisser une recherche qui ne répond pas
window.addEventListener("load", () => {
  if (!document.getElementById("form-recherche")) return;
  if (typeof ANNUAIRE !== "undefined" && typeof normaliser === "function" && typeof esc === "function") return;
  const p = document.createElement("p");
  p.className = "note";
  p.innerHTML = "<strong>Le site n'a pas pu charger tous ses fichiers.</strong> Recharge la page. Si le problème continue, un bloqueur de publicités en est peut-être la cause : autorise ce site dans ton bloqueur (il n'affiche aucune publicité et ne suit pas ses visiteurs).";
  document.querySelector("main").prepend(p);
});

// Lit une recherche transmise par la page d'accueil (?q=…)
function rechercheDansAdresse() {
  try { return new URLSearchParams(location.search).get("q") || ""; } catch (e) { return ""; }
}

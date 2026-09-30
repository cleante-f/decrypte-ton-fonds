/*
 * Page « Confidentialité et mentions légales » : montre ce que le site garde dans ce navigateur et permet de l'effacer.
 * Seules les clés du site sont touchées (voir CLES_STOCKAGE_SITE dans js/outils.js).
 */
(function () {
  const bouton = document.getElementById("effacer-donnees");
  const etat = document.getElementById("etat-donnees");
  const afficher = () => {
    const n = clesStockageSite().length;
    etat.textContent = n ? `${n} élément${n > 1 ? "s" : ""} enregistré${n > 1 ? "s" : ""} par ce site sur cet appareil.` : "Aucune donnée de ce site n'est enregistrée sur cet appareil.";
    bouton.disabled = !n;
  };
  bouton.addEventListener("click", () => {
    const cles = clesStockageSite();
    cles.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } });
    afficher();
    etat.textContent = `C'est fait : ${cles.length} élément${cles.length > 1 ? "s" : ""} effacé${cles.length > 1 ? "s" : ""}. ` + etat.textContent;
  });
  afficher();
})();

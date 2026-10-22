/*
 * Page « alertes-desactivees.html » : résultat du lien de désinscription des e-mails d'alerte
 * (supabase/functions/_partage/alertes.js y redirige). ?etat=invalide ou ?etat=erreur choisit le message ;
 * sans paramètre (ou sans JavaScript), le message de réussite reste affiché. Rien n'est enregistré.
 */
(function () {
  const etat = new URLSearchParams(location.search).get("etat");
  if (etat !== "invalide" && etat !== "erreur") return;
  document.querySelectorAll("[data-etat]").forEach(el => { el.hidden = el.getAttribute("data-etat") !== etat; });
})();

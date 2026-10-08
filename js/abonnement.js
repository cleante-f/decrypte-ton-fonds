// Page abonnement.html : présentation du simulateur, création de compte ou abonnement Stripe.
const zoneOffre = document.getElementById("offre"), msgAbo = document.getElementById("message-compte");
const prix = esc(CONFIG_COMPTE.prixAffiche);

function offreSansCompte() {
  return `<h2>Commence gratuitement</h2>
    <p>Crée ton compte : ${CONFIG_COMPTE.simulationsOffertes} simulations offertes, sans carte bancaire. Ensuite, l'abonnement coûte <strong>${prix}</strong>, résiliable à tout moment.</p>
    <p class="actions-compte"><a class="btn" href="connexion.html?vue=inscription&retour=simulateur.html">Créer mon compte</a>
      <a class="btn btn-secondaire" href="connexion.html?vue=connexion&retour=simulateur.html">J'ai déjà un compte</a></p>`;
}
function offreAbonnement(d) {
  return `<h2>Abonnement : ${prix}</h2>
    <p>Simulations illimitées. Résiliable en quelques clics depuis « Mon compte » : l'accès reste ouvert jusqu'à la fin de la période payée.
      ${d.offertes_restantes > 0 ? `Il te reste encore ${d.offertes_restantes} simulation${d.offertes_restantes > 1 ? "s" : ""} offerte${d.offertes_restantes > 1 ? "s" : ""}.` : ""}</p>
    <label class="case"><input type="checkbox" id="execution-immediate"> Je demande l'accès immédiat au simulateur. Je sais qu'en cas de rétractation
      dans les 14 jours, je paierai la part de l'abonnement déjà utilisée (<a href="cgv.html" target="_blank">CGV</a>).</label>
    <p class="actions-compte"><button type="button" class="btn" id="sabonner" disabled>M'abonner</button></p>
    <p class="aide">Paiement sécurisé par Stripe : tes données de carte ne passent jamais par ce site.</p>`;
}

async function afficherOffre() {
  if (!Compte.session()) { zoneOffre.innerHTML = offreSansCompte(); return; }
  try {
    const d = await Compte.droits();
    zoneOffre.innerHTML = d.abonne
      ? `<h2>Ton abonnement est actif</h2><p class="actions-compte"><a class="btn" href="simulateur.html">Ouvrir le simulateur</a> <a class="btn btn-secondaire" href="compte.html">Mon compte</a></p>`
      : offreAbonnement(d);
  } catch (err) {
    if (err.code === "non_connecte") zoneOffre.innerHTML = offreSansCompte(); else { msgAbo.hidden = false; msgAbo.textContent = err.message; }
  }
}

zoneOffre.addEventListener("change", e => { if (e.target.id === "execution-immediate") document.getElementById("sabonner").disabled = !e.target.checked; });
zoneOffre.addEventListener("click", async e => {
  if (e.target.id !== "sabonner") return;
  e.target.disabled = true;
  try {
    await Compte.demanderExecutionImmediate();
    location.href = (await Compte.fonction("paiement")).url;
  } catch (err) {
    msgAbo.hidden = false;
    msgAbo.className = "note note-erreur";
    msgAbo.textContent = err.code === "deja_abonne" ? "Tu es déjà abonné : recharge la page." : `Paiement impossible pour l'instant : ${err.message}`;
    e.target.disabled = false;
  }
});
// Démarrage, en mode comptes seulement (en mode gratuit, js/mode-site.js renvoie cette page vers l'accueil, mais pas immédiatement).
if (modeSite(location.hostname) === "comptes") {
  afficherOffre();
}

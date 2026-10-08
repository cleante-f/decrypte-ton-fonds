// Page compte.html : état de l'accès, simulations enregistrées, e-mail, mot de passe, export, déconnexion, suppression du compte.
const msg = document.getElementById("message-compte");
const dateCourte = iso => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
function annoncer(texte, erreur) { msg.hidden = !texte; msg.textContent = texte || ""; msg.className = erreur ? "note note-erreur" : "note"; }
// « protege » affiche l'erreur éventuelle ; « action » annule en plus l'effet normal (envoi du formulaire).
// Les clics de toute la page passent par « protege » seulement : sinon plus aucun lien ni bouton d'envoi ne marcherait.
const protege = fn => async e => { try { await fn(e); } catch (err) { annoncer(err.message, true); } };
const action = fn => protege(e => { e.preventDefault(); return fn(e); });

function blocAcces(d) {
  if (d.abonne) {
    return `<h2>Abonnement actif</h2>
      <p>${d.abonnement_statut === "resilie_fin_periode" ? `Résilié : ton accès reste ouvert jusqu'au <strong>${dateCourte(d.abonnement_fin)}</strong>.`
        : `Prochain renouvellement le <strong>${dateCourte(d.abonnement_fin)}</strong>.`}</p>
      <p class="actions-compte"><a class="btn" href="simulateur.html">Ouvrir le simulateur</a>
        <button type="button" class="btn btn-secondaire" id="portail">Gérer ou résilier mon abonnement</button></p>`;
  }
  const r = d.offertes_restantes;
  return `<h2>Compte gratuit</h2>
    <p>${r > 0 ? `Il te reste <strong>${r} simulation${r > 1 ? "s" : ""} offerte${r > 1 ? "s" : ""}</strong> sur ${CONFIG_COMPTE.simulationsOffertes}.`
      : "Tes simulations offertes sont utilisées : tu peux rouvrir et modifier celles que tu as enregistrées."}</p>
    ${d.abonnement_statut === "impaye" ? `<p class="note note-erreur">Le dernier paiement de ton abonnement a échoué : mets à jour ta carte pour retrouver l'accès.</p>` : ""}
    <p class="actions-compte">${r > 0 ? `<a class="btn" href="simulateur.html">Lancer une simulation</a>` : ""}
      <a class="${r > 0 ? "btn btn-secondaire" : "btn"}" href="abonnement.html">Voir l'abonnement</a>
      ${d.abonnement_statut === "impaye" ? `<button type="button" class="btn btn-secondaire" id="portail">Mettre à jour ma carte</button>` : ""}</p>`;
}

function ligneSimulation(s) {
  return `<li data-id="${esc(s.id)}">
    <a href="simulateur.html?sim=${encodeURIComponent(s.id)}#${encodeURIComponent(s.fonds)}"><strong>${esc(s.nom)}</strong></a>
    <small>${esc(s.fonds)} · modifiée le ${dateCourte(s.maj_le)}${s.offerte ? " · offerte" : ""}</small>
    <span class="actions-ligne"><button type="button" class="lien-bouton" data-renommer>Renommer</button>
      <button type="button" class="lien-bouton" data-supprimer-sim>Supprimer</button></span></li>`;
}

async function rafraichirEspace() {
  const [d, sims, u] = await Promise.all([Compte.droits(), Compte.simulations(), Compte.utilisateur()]);
  document.getElementById("bloc-acces").innerHTML = blocAcces(d);
  document.getElementById("liste-simulations").innerHTML = sims.length ? sims.map(ligneSimulation).join("")
    : `<li>Aucune simulation enregistrée pour l'instant.</li>`;
  document.querySelector("#form-email [name=email]").value = u.email || "";
}

document.addEventListener("click", protege(async e => {
  if (e.target.id === "portail") { const r = await Compte.fonction("portail"); location.href = r.url; return; }
  const li = e.target.closest("[data-id]");
  if (li && e.target.matches("[data-renommer]")) {
    const nom = prompt("Nouveau nom de la simulation :", li.querySelector("strong").textContent);
    if (nom && nom.trim()) { await Compte.renommerSimulation(li.dataset.id, nom.trim()); await rafraichirEspace(); }
  }
  if (li && e.target.matches("[data-supprimer-sim]") && confirm("Supprimer cette simulation ? Elle ne sera pas rendue comme simulation offerte.")) {
    await Compte.supprimerSimulation(li.dataset.id); await rafraichirEspace();
  }
}));
document.getElementById("form-email").addEventListener("submit", action(async e => {
  await Compte.changerEmail(new FormData(e.target).get("email"));
  annoncer("Un lien de confirmation a été envoyé à la nouvelle adresse (et un avis à l'ancienne).");
}));
document.getElementById("form-mdp").addEventListener("submit", action(async e => {
  await Compte.changerMotDePasse(new FormData(e.target).get("mdp")); e.target.reset(); annoncer("Mot de passe changé.");
}));
document.getElementById("exporter").addEventListener("click", action(async () => {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([await Compte.exporterDonnees()], { type: "application/json" }));
  lien.download = `decrypte-ton-fonds-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
  lien.click();
  URL.revokeObjectURL(lien.href);
}));
document.getElementById("deconnecter").addEventListener("click", action(async () => { await Compte.deconnecter(); location.href = "index.html"; }));
document.getElementById("supprimer").addEventListener("click", action(async () => {
  if (!confirm("Supprimer définitivement ton compte et tes simulations ? Un abonnement en cours sera arrêté immédiatement, sans remboursement de la période entamée.")) return;
  await Compte.fonction("supprimer-compte");
  await Compte.deconnecter();
  location.href = "index.html?compte=supprime";
}));

// Démarrage, en mode comptes seulement (en mode gratuit, js/mode-site.js renvoie cette page vers l'accueil, mais pas immédiatement) :
// sans session, renvoi vers la connexion ; puis lecture de l'accès, des simulations et de l'adresse e-mail.
if (modeSite(location.hostname) === "comptes") {
  if (!Compte.session()) location.replace("connexion.html?vue=connexion&retour=compte.html");
  if (new URLSearchParams(location.search).get("bienvenue")) annoncer("Bienvenue ! Ton compte est activé : tes 3 simulations offertes t'attendent.");
  rafraichirEspace().catch(err => { if (err.code === "non_connecte") location.replace("connexion.html?vue=connexion&retour=compte.html"); else annoncer(err.message, true); });
}

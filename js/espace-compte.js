// Page compte.html : état de l'accès, simulations enregistrées, fonds suivis, alertes par e-mail, e-mail, mot de passe, export, déconnexion, suppression du compte.
const msg = document.getElementById("message-compte");
const dateCourte = iso => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
function annoncer(texte, erreur) { msg.hidden = !texte; msg.textContent = texte || ""; msg.className = erreur ? "note note-erreur" : "note"; }
// « protege » affiche l'erreur éventuelle ; « action » annule en plus l'effet normal (envoi du formulaire).
// Les clics de toute la page passent par « protege » seulement : sinon plus aucun lien ni bouton d'envoi ne marcherait.
const protege = fn => async e => { try { await fn(e); } catch (err) { annoncer(err.message, true); } };
const action = fn => protege(e => { e.preventDefault(); return fn(e); });

// Paiement coupé (réglage du site, ou base : champ paiement_actif de droit_acces) : comptes gratuits, simulateur ouvert,
// ni simulations offertes ni abonnement, et pas de bouton du portail Stripe (même pour un ancien abonné) : dans cet état,
// la page Confidentialité ne mentionne pas Stripe, donc la page ne doit pas y mener.
const PAIEMENT_SITE = CONFIG_COMPTE.paiementActif !== false;
function blocAcces(d) {
  if (!PAIEMENT_SITE || d.paiement_actif === false) {
    return `<h2>Compte gratuit</h2>
      <p>Avec ton compte, le simulateur est ouvert : tes simulations sont enregistrées ici, retrouvables sur tous tes appareils.</p>
      <p class="actions-compte"><a class="btn" href="simulateur.html">Lancer une simulation</a></p>`;
  }
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
    <small>${esc(s.fonds)} · modifiée le ${dateCourte(s.maj_le)}${s.offerte && PAIEMENT_SITE ? " · offerte" : ""}</small>
    <span class="actions-ligne"><button type="button" class="lien-bouton" data-renommer>Renommer</button>
      <button type="button" class="lien-bouton" data-supprimer-sim>Supprimer</button></span></li>`;
}

// ---------- Mes fonds suivis ----------
// Nom et adresse de chaque fonds : annuaire du site (data/annuaire.js, chargé seulement s'il y a des fonds suivis ;
// zones États-Unis et registre européen chargées au besoin par entreeParCle, js/zones.js). Fonds introuvable : sa clé.
async function entreeSuivie(cle) {
  try {
    if (typeof ANNUAIRE === "undefined" && zoneDeCle(cle) === "europe") await chargerScript("data/annuaire.js");
    return await entreeParCle(cle);
  } catch (e) { return null; }
}
// Dernières valeurs connues : résumés publics des DIC (data/resumes.js, chargé seulement s'il y a des fonds suivis),
// RESUMES.fonds[ISIN] = [frais, sri, durée, objectif, date du DIC, date de lecture]. Aucun autre accès à la base.
async function chargerResumes() {
  try { if (typeof RESUMES === "undefined") await chargerScript("data/resumes.js"); } catch (e) { /* valeurs non affichées */ }
}
const dateJma = iso => String(iso).slice(0, 10).split("-").reverse().join("/");
function valeursSuivi(cle) {
  const r = typeof RESUMES !== "undefined" && RESUMES && RESUMES.fonds && Object.prototype.hasOwnProperty.call(RESUMES.fonds, cle) ? RESUMES.fonds[cle] : null;
  const sansDic = zoneDeCle(cle) !== "europe" ? "Fonds hors GECO (pas de DIC lu)" : "Pas de DIC publié sur GECO";
  if (!r) return sansDic;
  const parties = [];
  if (typeof r[0] === "number") parties.push(`Frais ${pct(r[0], 2)}`);
  if (typeof r[1] === "number") parties.push(`Risque ${r[1]}/7`);
  if (/^\d{4}-\d{2}-\d{2}/.test(r[4] || "")) parties.push(`DIC du ${dateJma(r[4])}`);
  return parties.length ? parties.join(" · ") : sansDic;
}
function ligneSuivi(cle, e) {
  const lien = (e && adresseFonds(e)) || `decrypte.html#${encodeURIComponent(cle)}`;
  return `<li data-cle="${esc(cle)}">
    <a href="${esc(lien)}"><strong>${esc(e ? e.nom : cle)}</strong></a>
    <small>${esc(cle)}${e && e.gestionnaire ? ` · ${esc(e.gestionnaire)}` : ""}</small>
    <small>${esc(valeursSuivi(cle))}</small>
    <span class="actions-ligne"><button type="button" class="lien-bouton" data-ne-plus-suivre>Ne plus suivre</button></span></li>`;
}
async function rafraichirSuivis() {
  const cles = await Compte.fondsSuivis();
  const [entrees] = await Promise.all([Promise.all(cles.map(entreeSuivie)), cles.length ? chargerResumes() : null]);
  const nom = i => (entrees[i] ? entrees[i].nom : cles[i]);
  const ordre = cles.map((c, i) => i).sort((a, b) => nom(a).localeCompare(nom(b), "fr"));   // par nom de fonds
  document.getElementById("liste-suivis").innerHTML = cles.length ? ordre.map(i => ligneSuivi(cles[i], entrees[i])).join("")
    : `<li>Aucun fonds suivi pour l'instant. Ouvre la fiche d'un fonds et clique sur « ☆ Suivre ce fonds ».</li>`;
}

// ---------- Alertes par e-mail ----------
const case_ = (nom, texte, coche) => `<label class="case"><input type="checkbox" name="${nom}"${coche ? " checked" : ""}> ${texte}</label>`;
function formulaireAlertes(p) {
  const options = [["", "désactivée"], ["5", "5 %"], ["10", "10 %"], ["20", "20 %"]]
    .map(([v, t]) => `<option value="${v}"${String(p.seuil_baisse ?? "") === v ? " selected" : ""}>${t}</option>`).join("");
  return `${case_("actives", "Recevoir les alertes de mes fonds suivis par e-mail (un e-mail par jour au plus)", p.actives)}
    <fieldset><legend>Me prévenir quand un fonds suivi…</legend>
      ${case_("nouveau_dic", "publie un nouveau DIC", p.nouveau_dic)}
      ${case_("frais", "augmente ses frais courants", p.frais)}
      ${case_("risque", "change de niveau de risque (SRI)", p.risque)}
      <label>baisse de plus de… sur un mois <select name="seuil_baisse">${options}</select></label>
    </fieldset>
    <p><button type="submit" class="btn btn-secondaire">Enregistrer mes alertes</button></p>`;
}
async function rafraichirAlertes() {
  document.getElementById("form-alertes").innerHTML = formulaireAlertes(await Compte.preferencesAlertes());
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
  const suivi = e.target.closest("[data-cle]");
  if (suivi && e.target.matches("[data-ne-plus-suivre]")) { await Compte.nePlusSuivre(suivi.dataset.cle); await rafraichirSuivis(); return; }
  const li = e.target.closest("[data-id]");
  if (li && e.target.matches("[data-renommer]")) {
    const nom = prompt("Nouveau nom de la simulation :", li.querySelector("strong").textContent);
    if (nom && nom.trim()) { await Compte.renommerSimulation(li.dataset.id, nom.trim()); await rafraichirEspace(); }
  }
  if (li && e.target.matches("[data-supprimer-sim]") && confirm(PAIEMENT_SITE ? "Supprimer cette simulation ? Elle ne sera pas rendue comme simulation offerte." : "Supprimer cette simulation ?")) {
    await Compte.supprimerSimulation(li.dataset.id); await rafraichirEspace();
  }
}));
document.getElementById("form-email").addEventListener("submit", action(async e => {
  await Compte.changerEmail(new FormData(e.target).get("email"));
  annoncer("Un lien de confirmation a été envoyé à la nouvelle adresse (et un avis à l'ancienne).");
}));
document.getElementById("form-alertes").addEventListener("submit", action(async e => {
  const d = new FormData(e.target);
  await Compte.enregistrerPreferences({ actives: !!d.get("actives"), nouveau_dic: !!d.get("nouveau_dic"), frais: !!d.get("frais"),
    risque: !!d.get("risque"), seuil_baisse: d.get("seuil_baisse") ? Number(d.get("seuil_baisse")) : null });
  annoncer("Préférences d'alertes enregistrées.");
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
  if (!confirm(PAIEMENT_SITE ? "Supprimer définitivement ton compte et tes simulations ? Un abonnement en cours sera arrêté immédiatement, sans remboursement de la période entamée."
    : "Supprimer définitivement ton compte et tes simulations ?")) return;
  await Compte.fonction("supprimer-compte");
  await Compte.deconnecter();
  location.href = "index.html?compte=supprime";
}));

// Démarrage, en mode comptes seulement (en mode gratuit, js/mode-site.js renvoie cette page vers l'accueil, mais pas immédiatement) :
// sans session, renvoi vers la connexion ; puis lecture de l'accès, des simulations et de l'adresse e-mail.
if (modeSite(location.hostname) === "comptes") {
  if (!Compte.session()) location.replace("connexion.html?vue=connexion&retour=compte.html");
  if (new URLSearchParams(location.search).get("bienvenue")) annoncer(PAIEMENT_SITE ? "Bienvenue ! Ton compte est activé : tes 3 simulations offertes t'attendent."
    : "Bienvenue ! Ton compte est activé : le simulateur t'attend.");
  rafraichirEspace().catch(err => { if (err.code === "non_connecte") location.replace("connexion.html?vue=connexion&retour=compte.html"); else annoncer(err.message, true); });
  // Fonds suivis et alertes : à part, pour qu'une erreur ici ne cache pas le reste de la page
  rafraichirSuivis().catch(err => { document.getElementById("liste-suivis").innerHTML = `<li class="note-erreur">${esc(err.message)}</li>`; });
  rafraichirAlertes().catch(err => { document.getElementById("form-alertes").innerHTML = `<p class="note note-erreur">${esc(err.message)}</p>`; });
}

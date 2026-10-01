/*
 * Compte utilisateur (Supabase), sans bibliothèque : appels directs aux API d'authentification (/auth/v1) et de la base (/rest/v1).
 * La session est gardée dans ce navigateur (clé « compte-session-v1 ») et le jeton d'accès est recopié dans le cookie « dtf_session »,
 * lu par le serveur (functions/_middleware.js) pour autoriser le simulateur. Les deux sont strictement nécessaires (pas de consentement).
 * Aucun appel réseau au chargement : les pages gratuites ne contactent pas Supabase.
 */
const Compte = (() => {
  const CLE_SESSION = "compte-session-v1", COOKIE = "dtf_session";
  const MESSAGES = {
    invalid_credentials: "E-mail ou mot de passe incorrect.",
    email_not_confirmed: "Confirme d'abord ton adresse : clique sur le lien reçu par e-mail.",
    user_already_exists: "Un compte existe déjà avec cet e-mail. Connecte-toi, ou utilise « Mot de passe oublié ».",
    email_exists: "Un compte existe déjà avec cet e-mail. Connecte-toi, ou utilise « Mot de passe oublié ».",
    weak_password: "Mot de passe trop faible : au moins 10 caractères, avec des lettres et des chiffres.",
    over_email_send_rate_limit: "Trop d'e-mails envoyés à cette adresse. Réessaie dans une heure.",
    over_request_rate_limit: "Trop de tentatives. Patiente quelques minutes.",
    captcha_failed: "La vérification anti-robot a échoué. Réessaie.",
    same_password: "Choisis un mot de passe différent de l'ancien.",
    quota_atteint: "Tes 3 simulations offertes sont utilisées. Abonne-toi pour en lancer de nouvelles.",
    email_non_confirme: "Confirme d'abord ton adresse e-mail.",
    limite_simulations: "Tu as atteint 200 simulations enregistrées : supprimes-en avant d'en créer de nouvelles.",
    non_connecte: "Ta session a expiré : reconnecte-toi."
  };

  class ErreurCompte extends Error {
    constructor(code, message, statut) { super(MESSAGES[code] || message); this.code = code; this.statut = statut; }
  }

  const base = () => CONFIG_COMPTE.supabaseUrl.replace(/\/$/, "");
  const secondes = () => Math.floor(Date.now() / 1000);
  const urlPage = page => new URL(page, location.href).href;

  function session() {
    try { return JSON.parse(localStorage.getItem(CLE_SESSION) || "null"); } catch (e) { return null; }
  }
  function ecrireSession(s) {
    try { if (s) localStorage.setItem(CLE_SESSION, JSON.stringify(s)); else localStorage.removeItem(CLE_SESSION); } catch (e) { /* stockage indisponible */ }
    document.cookie = s ? `${COOKIE}=${s.access_token}; Path=/; Max-Age=${Math.max(0, s.expires_at - secondes())}; Secure; SameSite=Lax`
      : `${COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  }
  function depuisJeton(r, ancien) {
    const user = r.user || (ancien && ancien.user) || {};
    return { access_token: r.access_token, refresh_token: r.refresh_token,
      expires_at: r.expires_at || secondes() + Number(r.expires_in || 3600), user: { id: user.id, email: user.email } };
  }

  async function requete(chemin, { methode = "GET", corps, jeton, entetes = {} } = {}) {
    const h = { apikey: CONFIG_COMPTE.supabaseCle, ...entetes };
    if (corps !== undefined) h["Content-Type"] = "application/json";
    if (jeton) h.Authorization = `Bearer ${jeton}`;
    const r = await fetch(base() + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) });
    const texte = await r.text();
    let json = null;
    try { json = texte ? JSON.parse(texte) : null; } catch (e) { /* réponse non JSON */ }
    if (!r.ok) {
      // Auth : {error_code, msg} ; fonctions SQL : {code: "P0001", message: "quota_atteint"} ; anciens formats : {error, error_description}
      let code = json && (json.error_code || json.code || json.error);
      if (code === "P0001" && json.message) code = json.message;
      throw new ErreurCompte(String(code || r.status), (json && (json.msg || json.message || json.error_description)) || `Erreur ${r.status}`, r.status);
    }
    return json;
  }

  async function rafraichir(s) {
    try {
      const r = await requete("/auth/v1/token?grant_type=refresh_token", { methode: "POST", corps: { refresh_token: s.refresh_token } });
      const nouvelle = depuisJeton(r, s);
      ecrireSession(nouvelle);
      return nouvelle.access_token;
    } catch (e) {
      if (e.statut >= 400 && e.statut < 500) ecrireSession(null);   // jeton de rafraîchissement refusé : il faut se reconnecter
      return null;
    }
  }

  async function jetonValide(forcer = false) {
    const s = session();
    if (!s) return null;
    if (!forcer && s.expires_at - secondes() > 60) return s.access_token;
    return rafraichir(s);
  }

  // Appel authentifié : rafraîchit la session si besoin, et réessaie une fois après un 401
  async function avecJeton(appel) {
    let j = await jetonValide();
    if (!j) throw new ErreurCompte("non_connecte", "Session expirée", 401);
    try { return await appel(j); } catch (e) {
      if (e.statut !== 401) throw e;
      j = await jetonValide(true);
      if (!j) throw new ErreurCompte("non_connecte", "Session expirée", 401);
      return appel(j);
    }
  }
  const rpc = (nom, params) => avecJeton(j => requete(`/rest/v1/rpc/${nom}`, { methode: "POST", corps: params || {}, jeton: j }));
  const rest = (chemin, options = {}) => avecJeton(j => requete(`/rest/v1/${chemin}`, { ...options, jeton: j }));
  const nettoyer = email => String(email || "").trim().toLowerCase();

  async function inscrire(email, motDePasse, captcha) {
    const r = await requete(`/auth/v1/signup?redirect_to=${encodeURIComponent(urlPage("connexion.html"))}`, { methode: "POST", corps: {
      email: nettoyer(email), password: motDePasse,
      data: { majeur: true, cgv_version: CONFIG_COMPTE.versionCgv },
      gotrue_meta_security: { captcha_token: captcha } } });
    if (r && r.access_token) ecrireSession(depuisJeton(r));   // si la confirmation par e-mail était désactivée
    return { confirmationEnvoyee: !(r && r.access_token) };
  }
  async function connecter(email, motDePasse, captcha) {
    const r = await requete("/auth/v1/token?grant_type=password", { methode: "POST",
      corps: { email: nettoyer(email), password: motDePasse, gotrue_meta_security: { captcha_token: captcha } } });
    ecrireSession(depuisJeton(r));
    majNavigation();
  }
  async function deconnecter() {
    const s = session();
    try { if (s) await requete("/auth/v1/logout", { methode: "POST", jeton: s.access_token }); } catch (e) { /* on se déconnecte quand même */ }
    ecrireSession(null);
    majNavigation();
  }
  const motDePasseOublie = (email, captcha) => requete(`/auth/v1/recover?redirect_to=${encodeURIComponent(urlPage("connexion.html"))}`,
    { methode: "POST", corps: { email: nettoyer(email), gotrue_meta_security: { captcha_token: captcha } } });
  const changerMotDePasse = mdp => avecJeton(j => requete("/auth/v1/user", { methode: "PUT", corps: { password: mdp }, jeton: j }));
  const changerEmail = email => avecJeton(j => requete(`/auth/v1/user?redirect_to=${encodeURIComponent(urlPage("compte.html"))}`,
    { methode: "PUT", corps: { email: nettoyer(email) }, jeton: j }));
  const utilisateur = () => avecJeton(j => requete("/auth/v1/user", { jeton: j }));

  // Après un clic dans un e-mail (confirmation, mot de passe oublié, changement d'e-mail) : jetons ou erreur dans l'adresse (#…)
  async function lireRetourEmail() {
    const p = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    const nettoyerAdresse = () => history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error_code") || p.get("error")) {
      nettoyerAdresse();
      return { erreur: p.get("error_code") === "otp_expired" ? "Ce lien a expiré ou a déjà servi. Demande un nouvel e-mail."
        : `Lien refusé : ${p.get("error_description") || p.get("error")}.` };
    }
    if (!p.get("access_token")) return null;
    const s = depuisJeton({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: p.get("expires_in"), expires_at: Number(p.get("expires_at")) || undefined });
    ecrireSession(s);
    nettoyerAdresse();
    try { const u = await requete("/auth/v1/user", { jeton: s.access_token }); ecrireSession({ ...s, user: { id: u.id, email: u.email } }); } catch (e) { /* e-mail lu plus tard */ }
    majNavigation();
    return { type: p.get("type") || "" };
  }

  const droits = () => rpc("droit_acces");
  const demarrerSimulation = (fonds, nom) => rpc("demarrer_simulation", { p_fonds: fonds, p_nom: nom });
  const demanderExecutionImmediate = () => rpc("demander_execution_immediate");
  const simulations = () => rest("simulations?select=id,nom,fonds,offerte,cree_le,maj_le&order=maj_le.desc");
  const simulation = async id => (await rest(`simulations?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null;
  const enregistrerSimulation = (id, etat) => rest(`simulations?id=eq.${encodeURIComponent(id)}`, { methode: "PATCH", corps: { etat }, entetes: { Prefer: "return=minimal" } });
  const renommerSimulation = (id, nom) => rest(`simulations?id=eq.${encodeURIComponent(id)}`, { methode: "PATCH", corps: { nom: String(nom).slice(0, 80) }, entetes: { Prefer: "return=minimal" } });
  const supprimerSimulation = id => rest(`simulations?id=eq.${encodeURIComponent(id)}`, { methode: "DELETE", entetes: { Prefer: "return=minimal" } });
  const profil = async () => (await rest("profils?select=*"))[0] || null;

  async function exporterDonnees() {
    const [u, p, sims] = await Promise.all([utilisateur(), profil(), rest("simulations?select=*&order=cree_le.asc")]);
    return JSON.stringify({ exporte_le: new Date().toISOString(), site: "Décrypte ton fonds",
      compte: { id: u.id, email: u.email, cree_le: u.created_at, derniere_connexion: u.last_sign_in_at }, profil: p, simulations: sims }, null, 2);
  }

  // Fonctions serveur Supabase (paiement, portail, supprimer-compte)
  const fonction = (nom, corps = {}) => avecJeton(j => requete(`/functions/v1/${nom}`, { methode: "POST", corps, jeton: j }));

  // Bouton « Mon compte » / « Se connecter » de la barre du haut (aucun appel réseau)
  function majNavigation() {
    const lien = document.getElementById("lien-compte");
    if (!lien) return;
    const connecte = !!session();
    lien.textContent = connecte ? "Mon compte" : "Se connecter";
    lien.href = connecte ? "compte.html" : "connexion.html";
  }

  return { ErreurCompte, session, jetonValide, inscrire, connecter, deconnecter, motDePasseOublie, changerMotDePasse, changerEmail,
    lireRetourEmail, utilisateur, droits, demarrerSimulation, demanderExecutionImmediate, simulations, simulation, enregistrerSimulation,
    renommerSimulation, supprimerSimulation, profil, exporterDonnees, fonction, majNavigation };
})();

Compte.majNavigation();

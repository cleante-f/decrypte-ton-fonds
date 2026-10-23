// Page connexion.html : inscription, connexion, mot de passe oublié et nouveau mot de passe (après le lien reçu par e-mail).
// Vérification anti-robot Cloudflare Turnstile, chargée seulement sur cette page et seulement en mode comptes.
const jetonsCaptcha = new Map();
const message = document.getElementById("message-compte");
// Adresse de retour après connexion : une page du site seulement (jamais une autre adresse, pour qu'un lien piégé ne renvoie pas
// ailleurs). « page.html » ou l'adresse propre « simulateur » de Cloudflare, avec paramètres (?sim=…) et ancre (#ISIN) éventuels.
// Le chemin commence par une lettre : ni « // », ni « \ », ni « https: » ou « javascript: » ; le reste ne peut être qu'après ? ou #.
function retourSur(r) {
  r = String(r || "");
  if (/[\\\u0000-\u0020]/.test(r)) return "compte.html";   // barre oblique inverse, espace ou caractère de contrôle : refusé
  return /^\/?([a-z-]+\.html|simulateur)([?#].*)?$/.test(r) ? r.replace(/^\//, "") : "compte.html";
}
const retour = retourSur(new URLSearchParams(location.search).get("retour"));

function afficher(texte, type = "info") {
  message.hidden = !texte;
  message.textContent = texte || "";
  message.className = type === "erreur" ? "note note-erreur" : "note";
}
// Une seule vue à la fois, comme des pages séparées : titre, onglet du navigateur et adresse (?vue=…) suivent la vue
const TITRES = { inscription: "Créer un compte", connexion: "Se connecter", oubli: "Mot de passe oublié", "nouveau-mdp": "Nouveau mot de passe" };
function vue(nom) {
  document.querySelectorAll("form[data-vue]").forEach(f => { f.hidden = f.dataset.vue !== nom; });
  document.getElementById("titre-compte").textContent = TITRES[nom];
  document.title = `${TITRES[nom]} · Décrypte ton fonds`;
  if (nom === "inscription" || nom === "connexion") {
    const p = new URLSearchParams(location.search);
    p.set("vue", nom);
    history.replaceState(null, "", `?${p}`);
  }
}

// Turnstile : un widget par formulaire ; chaque jeton ne sert qu'une fois
window.captchaPret = () => {
  document.querySelectorAll("[data-captcha]").forEach(zone => {
    const id = turnstile.render(zone, { sitekey: CONFIG_COMPTE.turnstileCle, language: "fr",
      callback: jeton => jetonsCaptcha.set(zone.closest("form").id, jeton) });
    zone.dataset.widget = id;
  });
};
// Le script Turnstile n'est ajouté qu'en mode comptes : en mode gratuit, aucun appel à challenges.cloudflare.com.
// En mode gratuit, js/mode-site.js renvoie déjà cette page vers l'accueil ; ce test garde la règle même si ce renvoi échouait.
// Même adresse qu'avant, sans empreinte (integrity) : Cloudflare met ce fichier à jour sans changer son adresse.
function chargerTurnstile() {
  if (modeSite(location.hostname) === "comptes") {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=captchaPret";
    s.async = true;
    document.head.appendChild(s);
  }
}
chargerTurnstile();
// Paiement coupé : pas de CGV à accepter. La case est retirée de la page : simplement cachée, elle resterait obligatoire
// et bloquerait l'envoi du formulaire. La case « J'ai 18 ans ou plus » reste.
if (CONFIG_COMPTE.paiementActif === false) {
  const caseCgv = document.querySelector("#form-inscription [name=cgv]");
  if (caseCgv) caseCgv.closest("label").remove();
}
function captcha(form) {
  const jeton = jetonsCaptcha.get(form.id);
  if (!jeton) throw new Compte.ErreurCompte("captcha_absent", "Patiente une seconde : la vérification anti-robot se charge.");
  jetonsCaptcha.delete(form.id);
  const zone = form.querySelector("[data-captcha]");
  if (window.turnstile && zone.dataset.widget) turnstile.reset(zone.dataset.widget);
  return jeton;
}

async function soumettre(form, action) {
  const bouton = form.querySelector("button[type=submit]");
  bouton.disabled = true;
  try { await action(new FormData(form)); } catch (e) { afficher(e.message, "erreur"); } finally { bouton.disabled = false; }
}

document.addEventListener("click", e => { const b = e.target.closest("[data-vers]"); if (b) { afficher(""); vue(b.dataset.vers); } });

document.getElementById("form-inscription").addEventListener("submit", e => {
  e.preventDefault();
  soumettre(e.target, async d => {
    const r = await Compte.inscrire(d.get("email"), d.get("mdp"), captcha(e.target));
    if (r.confirmationEnvoyee) { afficher(`C'est presque fini : clique sur le lien envoyé à ${d.get("email").trim()} pour activer ton compte (pense à regarder les indésirables).`); e.target.reset(); }
    else location.href = retour;
  });
});
document.getElementById("form-connexion").addEventListener("submit", e => {
  e.preventDefault();
  soumettre(e.target, async d => { await Compte.connecter(d.get("email"), d.get("mdp"), captcha(e.target)); location.href = retour; });
});
document.getElementById("form-oubli").addEventListener("submit", e => {
  e.preventDefault();
  soumettre(e.target, async d => {
    await Compte.motDePasseOublie(d.get("email"), captcha(e.target));
    afficher("Si un compte existe avec cette adresse, un e-mail vient de partir. Le lien est valable une heure.");
  });
});
document.getElementById("form-nouveau-mdp").addEventListener("submit", e => {
  e.preventDefault();
  soumettre(e.target, async d => { await Compte.changerMotDePasse(d.get("mdp")); afficher("Mot de passe changé. Redirection…"); setTimeout(() => { location.href = "compte.html"; }, 1200); });
});

// Démarrage, en mode comptes seulement. En mode gratuit, js/mode-site.js renvoie cette page vers l'accueil, mais pas immédiatement :
// sans ce test, le retour d'un e-mail (#access_token=…) serait lu et la session écrite (avec son cookie) sur une adresse gratuite.
if (modeSite(location.hostname) === "comptes") {
  (async () => {
    const r = await Compte.lireRetourEmail();
    if (r && r.erreur) { afficher(r.erreur, "erreur"); vue("connexion"); return; }
    if (r && r.type === "recovery") { vue("nouveau-mdp"); return; }
    if (r && r.type === "signup") { location.href = "compte.html?bienvenue=1"; return; }
    const p = new URLSearchParams(location.search);
    if (Compte.session()) {   // déjà connecté (ou session rafraîchissable) : retour direct
      // Arrivée avec vue=connexion et un retour : le serveur (functions/_middleware.js) a refusé le jeton que le navigateur croit
      // valable (session révoquée…). Sans jeton neuf, on repartirait vers le simulateur, refusé de nouveau : boucle sans fin.
      // Le jeton est donc renouvelé de force ; si c'est impossible, la session est effacée et le formulaire de connexion affiché.
      const refuseParServeur = p.get("vue") === "connexion" && p.has("retour");
      if (await Compte.jetonValide(refuseParServeur)) { location.replace(retour); return; }
      if (refuseParServeur) await Compte.deconnecter();
    }
    vue(p.get("vue") === "inscription" ? "inscription" : "connexion");
  })();
}

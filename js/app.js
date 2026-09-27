/*
 * Chef d'orchestre : recherche, navigation (#ISIN dans l'adresse), réglages et infobulles.
 */
let seuils = chargerSeuils();

const champ = document.getElementById("champ-recherche");
const zoneResultat = document.getElementById("resultat");
const panneau = document.getElementById("panneau-reglages");
const btnReglages = document.getElementById("btn-reglages");

// Exemples cliquables : quelques fonds de l'annuaire
const EXEMPLES_REELS = [
  ["FR0010135103", "Carmignac Patrimoine"], ["FR0011871128", "Amundi PEA S&P 500"],
  ["LU1681043599", "Amundi MSCI World Swap (CW8)"], ["FR0000447039", "AXA PEA Régularité"]
].filter(([isin]) => annuaireParIsin(isin));
document.getElementById("exemples").innerHTML =
  `<span>${ANNUAIRE.length.toLocaleString("fr-FR")} fonds référencés. Exemples :</span> ` +
  EXEMPLES_REELS.map(([isin, nom]) => `<a href="#${isin}" class="chip">${esc(nom)}</a>`).join(" ");

// ---------- Recherche et navigation ----------

function lancerRecherche(texte) {
  const reels = rechercherAnnuaire(texte);
  if (reels.length === 1) {
    location.hash = cleEntree(reels[0], reels[0].isins.includes(texte.trim().toUpperCase()) ? texte.trim().toUpperCase() : null);
  } else {
    zoneResultat.innerHTML = afficherListe(texte, reels);
  }
}

document.getElementById("form-recherche").addEventListener("submit", e => {
  e.preventDefault();
  lancerRecherche(champ.value);
});

let affichageEnCours = 0; // évite qu'une ancienne réponse lente écrase une fiche plus récente

async function afficherDepuisAdresse() {
  const cle = decodeURIComponent(location.hash.slice(1));
  const numero = ++affichageEnCours;
  document.title = "Décrypte ton fonds";
  if (!cle) { zoneResultat.innerHTML = ""; return; }

  // Fonds de l'annuaire (fiche générée automatiquement)
  const entree = annuaireParIsin(cle) || annuaireParCle(cle);
  if (!entree) {
    zoneResultat.innerHTML = afficherListe(cle, []);
    return;
  }
  const isin = entree.isins.includes(cle) ? cle : entree.isins[0];
  document.title = `${entree.nom} · Décrypte ton fonds`;
  const enGeco = entree.source === "G";
  zoneResultat.innerHTML = afficherFicheAuto(entree, isin, null, enGeco);
  zoneResultat.scrollIntoView({ behavior: "smooth", block: "start" });

  let donnees = { erreurs: [] };
  const rendre = () => {
    if (numero !== affichageEnCours) return; // l'utilisateur a changé de fonds entre-temps
    const y = window.scrollY;
    try {
      zoneResultat.innerHTML = afficherFicheAuto(entree, isin, donnees, false);
      activerGraphiqueVL(zoneResultat, donnees.historique);
    } catch (err) {
      console.error("Erreur d'affichage de la fiche :", err); // on garde l'affichage précédent
    }
    window.scrollTo(0, y);
  };
  const progression = (p, n) => {
    const el = document.getElementById("progression-compo");
    if (el && numero === affichageEnCours) el.textContent = `Lecture de l'inventaire du rapport : page ${p} sur ${n}…`;
  };

  if (enGeco) {
    try {
      donnees = await chargerDonneesGeco(entree, isin);
    } catch (err) {
      donnees = { erreurs: ["connexion à GECO impossible (" + err.message + ")"] };
    }
    donnees.composition = { fini: false, progression: "Analyse des rendements du fonds…" };
    rendre();
    // Pour l'analyse des rendements, il faut au moins un an d'historique : sinon on prend la part la plus ancienne du fonds
    let historiqueStyle = donnees.historique, cleStyle = isin;
    if ((!historiqueStyle || historiqueStyle.valeurs.length < 150) && donnees.parts && donnees.parts.length > 1) {
      const doyenne = donnees.parts.filter(p => p.isin !== isin && p.parDateCreation).sort((a, b) => a.parDateCreation.localeCompare(b.parDateCreation))[0];
      if (doyenne) {
        try {
          const h = await gecoJson(`/funds/chart/${doyenne.idInterne}?startDate=${dateIso(ilYa(4))}`);
          if (h.x && h.x.length >= 150) {
            historiqueStyle = historiqueDepuisGeco(h);
            cleStyle = doyenne.isin;
          }
        } catch (e) { /* ignoré */ }
      }
    }
    await analyserComposition(donnees, entree.nom, cleStyle, historiqueStyle, donnees.documents, donnees.part, progression, rendre);
    return;
  }

  // ETF étrangers et fonds sans données : on passe par un fonds français qui suit le même indice
  donnees.composition = { fini: false, progression: "Recherche d'un fonds français qui suit le même indice…" };
  rendre();
  const jumeau = trouverJumeau(entree.nom);
  if (!jumeau) { donnees.composition = { fini: true, c: null }; rendre(); return; }
  donnees.composition.jumeau = jumeau;
  let dj = null;
  try { dj = await chargerHistoriqueEtDocuments(jumeau.fonds); } catch (err) { /* ignoré */ }
  if (!dj) { donnees.composition = { fini: true, c: null, jumeau }; rendre(); return; }
  await analyserComposition(donnees, jumeau.fonds.nom, jumeau.fonds.isins[0], dj.historique, dj.documents, null, progression, rendre, jumeau);
}

// Lance les deux moteurs : d'abord les rendements (rapide), puis l'inventaire (lecture du rapport, plus long)
async function analyserComposition(donnees, nomFonds, cleStyle, historique, documents, part, progression, rendre, jumeau) {
  let st = null, inv = null;
  try { st = await styleAvecCache(cleStyle, historique); } catch (e) { /* ignoré */ }
  donnees.composition = { fini: false, jumeau, progression: "Lecture de l'inventaire du rapport annuel…", c: st ? assemblerComposition(null, st, part) : null };
  rendre();
  // Un fonds jumeau à réplication synthétique détient un panier sans rapport avec l'indice : inutile de lire son inventaire
  const jumeauSynthetique = jumeau && (() => { const n = indicesDuNom(jumeau.fonds.nom); return n.synthetique || (n.pea && n.horsEurope); })();
  if (!jumeauSynthetique) {
    try { inv = await inventaireAvecCache(documents, nomFonds, progression, st); } catch (e) { /* ignoré */ }
  }
  const c = assemblerComposition(inv, st, part);
  if (c && jumeau) {
    // Pour un fonds jumeau à réplication synthétique, ses titres détenus ne disent rien de l'ETF analysé
    if (c.notes.some(n => n.type === "synthetique")) c.top10 = [];
    c.notes = c.notes.filter(n => n.type !== "synthetique");
  }
  donnees.composition = { fini: true, jumeau, c };
  rendre();
}

window.addEventListener("hashchange", afficherDepuisAdresse);
afficherDepuisAdresse();

// Recherche venue de la page d'accueil (decrypte.html?q=…)
const rechercheAccueil = rechercheDansAdresse();
if (rechercheAccueil && !location.hash) { champ.value = rechercheAccueil; lancerRecherche(rechercheAccueil); }

// ---------- Réglages des seuils ----------

btnReglages.addEventListener("click", () => {
  const ouvert = panneau.hidden;
  panneau.hidden = !ouvert;
  btnReglages.setAttribute("aria-expanded", String(ouvert));
  if (ouvert) panneau.innerHTML = afficherReglages(seuils);
});

panneau.addEventListener("submit", e => {
  e.preventDefault();
  const donnees = new FormData(e.target);
  for (const cle in seuils) {
    let orange = Number(donnees.get(`${cle}-orange`));
    let rouge = Number(donnees.get(`${cle}-rouge`));
    if (orange > rouge) [orange, rouge] = [rouge, orange]; // l'orange doit rester sous le rouge
    seuils[cle].orange = orange;
    seuils[cle].rouge = rouge;
  }
  sauverSeuils(seuils);
  panneau.hidden = true;
  btnReglages.setAttribute("aria-expanded", "false");
  afficherDepuisAdresse();
});

panneau.addEventListener("click", e => {
  if (e.target.id === "btn-reinit") {
    reinitialiserSeuils();
    seuils = chargerSeuils();
    panneau.innerHTML = afficherReglages(seuils);
    afficherDepuisAdresse();
  }
});

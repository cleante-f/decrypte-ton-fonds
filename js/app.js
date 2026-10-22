/*
 * Chef d'orchestre : recherche, navigation (#ISIN dans l'adresse), réglages et infobulles.
 *
 * Page fixe d'un fonds (fonds/…, scripts/construire_pages.mjs) : la page définit FICHE_FIXE (ISIN du fonds) juste avant ce script.
 * Sans « # » dans l'adresse, elle ouvre ce fonds sous son résumé ; un « # » l'emporte. Une recherche qui trouve un autre fonds
 * mène à decrypte.html#… (le résumé de la page ne parle que de son fonds).
 */
let seuils = chargerSeuils();
const ficheFixe = typeof FICHE_FIXE === "string" ? FICHE_FIXE : "";
const titreInitial = document.title;   // titre de la page fixe, fait pour Google : gardé tant que son fonds est affiché

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
  // tout le site (annuaire européen et zones) d'après data/resume.js ; à défaut, l'annuaire européen seul
  `<span>${(typeof RESUME_ANNUAIRE !== "undefined" ? RESUME_ANNUAIRE.total : ANNUAIRE.length).toLocaleString("fr-FR")} fonds référencés. Exemples :</span> ` +
  EXEMPLES_REELS.map(([isin, nom]) => `<a href="${esc(lienAutreFonds(isin))}" class="chip">${esc(nom)}</a>`).join(" ");

// ---------- Recherche et navigation ----------

let rechercheEnCours = 0; // évite qu'une ancienne recherche lente écrase une plus récente
let affichageEnCours = 0; // évite qu'une ancienne réponse lente écrase une fiche plus récente

async function lancerRecherche(texte) {
  const recherche = ++rechercheEnCours, affichage = affichageEnCours;
  const avant = [...zoneResultat.childNodes];
  zoneResultat.innerHTML = `<div class="carte"><p class="chargement">Recherche dans tous les pays…</p></div>`;
  const reels = await rechercherPartout(texte);
  if (recherche !== rechercheEnCours || affichage !== affichageEnCours) return; // autre recherche, ou autre fonds ouvert entre-temps
  if (reels.length === 1) {
    const adresse = location.hash;
    const cle = cleEntree(reels[0], reels[0].isins.includes(texte.trim().toUpperCase()) ? texte.trim().toUpperCase() : null);
    if (ficheFixe && cle !== cleAffichee()) { location.href = `${racineSite()}decrypte.html#${encodeURIComponent(cle)}`; return; }
    if (!ficheFixe || location.hash) location.hash = cle;
    if (location.hash === adresse) zoneResultat.replaceChildren(...avant); // fonds déjà ouvert : l'adresse ne change pas, on remet sa fiche
  } else {
    zoneResultat.innerHTML = afficherListe(texte, reels, lienFiche);
  }
}

document.getElementById("form-recherche").addEventListener("submit", e => {
  e.preventDefault();
  lancerRecherche(champ.value);
});

// Fonds à afficher : celui de l'adresse (#…), sinon celui de la page fixe
function cleAffichee() {
  return decodeURIComponent(location.hash.slice(1)) || ficheFixe;
}

async function afficherDepuisAdresse() {
  const cle = cleAffichee();
  const fondsDeLaPage = !!ficheFixe && !location.hash;   // page fixe ouverte sans « # » : son titre et sa position restent
  const numero = ++affichageEnCours;
  document.title = fondsDeLaPage ? titreInitial : "Décrypte ton fonds";
  if (!cle) { zoneResultat.innerHTML = ""; return; }

  // Fonds de l'annuaire (fiche générée automatiquement). Un fonds d'une autre zone (États-Unis…) charge d'abord sa liste.
  if (zoneDeCle(cle) !== "europe") zoneResultat.innerHTML = `<div class="carte"><p class="chargement">Chargement du fonds…</p></div>`;
  let entree;
  try {
    entree = await entreeParCle(cle);
  } catch (err) {
    if (numero !== affichageEnCours) return;
    zoneResultat.innerHTML = `<div class="carte"><p class="non-dispo">Impossible de charger cette liste de fonds : recharge la page.</p></div>`;
    return;
  }
  if (numero !== affichageEnCours) return; // l'utilisateur a changé de fonds entre-temps
  if (!entree) {
    zoneResultat.innerHTML = afficherListe(cle, []);
    return;
  }
  const isin = entree.isins.includes(cle) ? cle : entree.isins[0];
  if (!fondsDeLaPage) document.title = `${entree.nom} · Décrypte ton fonds`;
  const enGeco = entree.source === "G";
  const avecSec = entree.source === "S" || (!enGeco && !!serieSecDe(entree, isin));   // fonds américain, ou fonds européen qui est aussi une série américaine
  const avecRegistre = entree.source === "R";   // fonds européen du registre de l'ESMA (hors France) : ses informations se chargent à l'ouverture
  zoneResultat.innerHTML = afficherFicheAuto(entree, isin, null, enGeco || avecSec || avecRegistre);
  if (!fondsDeLaPage) zoneResultat.scrollIntoView({ behavior: "smooth", block: "start" });   // page fixe : son résumé reste en vue

  let donnees = { erreurs: [] };
  const rendre = () => {
    if (numero !== affichageEnCours) return; // l'utilisateur a changé de fonds entre-temps
    const y = window.scrollY;
    try {
      zoneResultat.innerHTML = afficherFicheAuto(entree, isin, donnees, false);
      // Graphiques interactifs : le premier de la page suit la première source qui a un historique (GECO, SEC, cours en bourse) ;
      // quand un fonds américain coté en Europe a les deux derniers, le second graphique est celui du cours
      const historiqueSec = donnees.sec && donnees.sec.historique, historiqueCours = donnees.cours && donnees.cours.historique;
      activerGraphiqueVL(zoneResultat, donnees.historique || historiqueSec || historiqueCours);
      if (!donnees.historique && historiqueSec && historiqueCours) activerGraphiqueVL(zoneResultat, historiqueCours, 1);
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

  // Fonds américain (SEC) : tout vient des données déclarées à la SEC (js/etats-unis.js), ni cours en bourse ni fonds français comparable.
  // La fiche affichée pendant le chargement dit « Chargement des données… » ; on ne la remplace qu'une fois les données là.
  if (entree.source === "S") {
    try {
      donnees.sec = await donneesSec(entree, isin);
    } catch (err) {
      donnees.erreurs.push("données de la SEC indisponibles (" + err.message + ")");
    }
    if (numero !== affichageEnCours) return;
    donnees.composition = { fini: true, c: donnees.sec && donnees.sec.compo };
    rendre();
    await completerAlternatives(entree, donnees, rendre, numero);
    return;
  }

  // Fonds du registre de l'ESMA (source R) : LEI, pays de commercialisation, politique, taille et parapluie sont dans un fichier chargé
  // à l'ouverture de la fiche. S'il manque, l'identité reste affichée (société de gestion, type) et l'erreur est signalée en bas de fiche.
  if (entree.source === "R") {
    try {
      const promesse = chargerScript("data/registres-ue-infos.js");
      await promesse;
      if (typeof REGISTRES_UE_INFOS === "undefined") {
        if (_scriptsCharges.get("data/registres-ue-infos.js") === promesse) _scriptsCharges.delete("data/registres-ue-infos.js");   // fichier inattendu : la prochaine fiche le recharge
        throw new Error("fichier sans les informations attendues");
      }
    } catch (err) {
      donnees.erreurs.push("informations du registre ESMA indisponibles (" + err.message + ")");
    }
    if (numero !== affichageEnCours) return;
  }

  // Fonds étrangers : cours relevés chaque jour sur Xetra et à Francfort (js/cours.js), chargés en parallèle.
  // Un fonds du registre de l'ESMA n'a pas d'ISIN, donc pas de cours à chercher.
  if (entree.source !== "R" && typeof chargerCours === "function") {
    chargerCours(isin)
      .then(c => { donnees.cours = c; donnees.coursFini = true; })
      .catch(() => { donnees.coursFini = true; })
      .then(rendre);
  }

  // Fonds européen qui est aussi une série américaine : ses données de la SEC (composition, rendements en euros, frais) se chargent
  // en même temps que le cours. Si la SEC donne la composition, elle remplace la recherche d'un fonds jumeau.
  donnees.composition = { fini: false, progression: avecSec ? "Lecture des données de la SEC…" : "Recherche d'un fonds français qui suit le même indice…" };
  rendre();
  if (avecSec) {
    try {
      donnees.sec = await donneesSec(entree, isin);
    } catch (err) {
      donnees.erreurs.push("données de la SEC indisponibles (" + err.message + ")");
    }
    if (numero !== affichageEnCours) return;
    if (donnees.sec && donnees.sec.compo) {
      donnees.composition = { fini: true, c: donnees.sec.compo };
      rendre();
      await completerAlternatives(entree, donnees, rendre, numero);
      return;
    }
    donnees.composition = { fini: false, progression: "Recherche d'un fonds français qui suit le même indice…" };
    rendre();
  }

  // ETF étrangers et fonds sans données : on passe par un fonds français qui suit le même indice
  const jumeau = trouverJumeau(entree.nom);
  if (!jumeau) { donnees.composition = { fini: true, c: null }; rendre(); await completerAlternatives(entree, donnees, rendre, numero); return; }
  donnees.composition.jumeau = jumeau;
  let dj = null;
  try { dj = await chargerHistoriqueEtDocuments(jumeau.fonds); } catch (err) { /* ignoré */ }
  if (!dj) { donnees.composition = { fini: true, c: null, jumeau }; rendre(); await completerAlternatives(entree, donnees, rendre, numero); return; }
  await analyserComposition(donnees, jumeau.fonds.nom, jumeau.fonds.isins[0], dj.historique, dj.documents, null, progression, rendre, jumeau);
  await completerAlternatives(entree, donnees, rendre, numero);
}

// Fonds non achetable en France (États-Unis, hors EEE, non notifié) : candidats pour l'alternative moins chère, qui ne figurent pas
// dans data/alternatives.js : fonds américains de la zone « etats-unis » (frais lus à la SEC) et ETF européens notifiés de l'annuaire
// (frais inconnus). Résultat dans donnees.alternativesAutres (3 au plus), puis rendre().
async function completerAlternatives(entree, donnees, rendre, numero) {
  try {
    if (typeof achetableEnFrance !== "function" || achetableEnFrance(entree)) return;
    let indice = indiceDuNom(entree.nom || "");
    if (!indice) {
      const c = compositionPourAlternatives(donnees);
      indice = c ? indicePourExposition(c.zones, c.classes) : null;
    }
    if (!indice) return;
    const moi = new Set(entree.isins || []);
    const cleMoi = cleEntree(entree);
    const us = [];
    const zone = typeof ANNUAIRE_ZONES !== "undefined" ? ANNUAIRE_ZONES["etats-unis"] : null;
    // Limite connue : on retient les 8 premiers candidats dans l'ordre du fichier, avant de connaître leurs frais ;
    // un fonds américain moins cher placé plus loin dans l'annuaire n'est donc pas proposé.
    for (const l of zone ? zone.lignes : []) {
      if (us.length >= 8) break;
      if (indiceDuNom(l[3] || "") !== indice) continue;
      const x = lireEntree(l);
      if (cleEntree(x) !== cleMoi) us.push(x);
    }
    const avecFrais = await Promise.all(us.map(async x => {
      let frais = null;
      try {
        const detail = await chargerDetailSec(cleEntree(x));
        const part = detail ? partSec(detail, x) : null;
        const f = part ? fraisSec(part) : null;
        frais = f && Number.isFinite(f.retenu) ? f.retenu : null;
      } catch (err) { /* frais inconnus */ }
      return { cle: cleEntree(x), nom: x.nom, frais, pea: false, etf: x.etf };
    }));
    avecFrais.sort((a, b) => (a.frais === null) - (b.frais === null) || a.frais - b.frais);
    const autres = avecFrais.slice(0, 3);
    for (const l of typeof ANNUAIRE !== "undefined" ? ANNUAIRE : []) {
      if (autres.length >= 3) break;
      if (l[0] !== "E" || indiceDuNom(l[3] || "") !== indice) continue;
      const x = lireEntree(l);
      if (!x.isins.length || x.isins.some(i => moi.has(i)) || !achetableEnFrance(x)) continue;
      autres.push({ cle: x.isins[0], nom: x.nom, frais: null, pea: false, etf: x.etf });
    }
    if (numero !== affichageEnCours) return;
    donnees.alternativesAutres = autres;
    rendre();
  } catch (err) {
    console.error("Alternatives moins chères indisponibles :", err);   // la fiche reste affichée sans elles
  }
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

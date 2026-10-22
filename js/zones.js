/*
 * Annuaire par zone : les fonds américains (SEC) et les fonds européens du registre de l'ESMA (hors France) ne sont pas dans
 * data/annuaire.js (chargé avec chaque page).
 * Chacune de ces zones a son propre fichier, data/annuaire-<zone>.js, que le navigateur ne télécharge que quand il en a besoin :
 * à la première recherche par nom, ou à l'ouverture d'un fonds de la zone. Chaque fichier ajoute sa zone à ANNUAIRE_ZONES,
 * avec des lignes au même format que ANNUAIRE (voir lireEntree dans geco.js).
 *
 * Pour ajouter une zone : un fichier de données, et une entrée dans ZONES (dans l'ordre où la recherche les parcourt).
 *
 * Ne pas renommer ce fichier avec un nom que les bloqueurs de publicités connaissent (analyse.js, tracking.js…).
 */

const ANNUAIRE_ZONES = {};   // rempli par data/annuaire-<zone>.js : { <zone>: { maj, lignes, … } }

// nom : clé dans ANNUAIRE_ZONES ; fichier : adresse du fichier de données ; motif : reconnaît la clé d'un fonds de la zone
// (celle de cleEntree, dans l'adresse de la page) ; origine : texte affiché dans les listes de résultats
const ZONES = [
  { nom: "registres-ue", fichier: "data/annuaire-registres-ue.js", motif: /^R\d+$/, origine: "Fonds européen (registre ESMA)" },
  { nom: "etats-unis", fichier: "data/annuaire-etats-unis.js", motif: /^S\d{9}$/, origine: "Fonds américain (SEC)" }
];

// ---------- Chargement ----------

// Un seul <script> par fichier, même si plusieurs appels se suivent. Après un échec (réseau coupé, fichier bloqué) ou un
// délai dépassé (le serveur ne répond pas), la promesse est retirée : le prochain appel réessaie. Le premier événement
// (chargé, en erreur, délai) l'emporte ; un fichier qui arrive après le délai ne ressuscite rien.
// src est relatif à la racine du site (« data/… ») : racineSite() (js/outils.js) est placé devant pour une page rangée dans un dossier.
let DELAI_CHARGEMENT = 20000;   // millisecondes ; une variable pour que les tests puissent le raccourcir
const _scriptsCharges = new Map();
function chargerScript(src) {
  if (_scriptsCharges.has(src)) return _scriptsCharges.get(src);
  const promesse = new Promise((ok, ko) => {
    const s = document.createElement("script");
    let fini = false;
    const finir = suite => { if (fini) return; fini = true; clearTimeout(minuteur); suite(); };
    const minuteur = setTimeout(() => finir(() => ko(new Error(`${src} : délai dépassé`))), DELAI_CHARGEMENT);
    s.onload = () => finir(ok);
    s.onerror = () => finir(() => ko(new Error(`${src} non chargé`)));
    s.src = racineSite() + src;
    document.head.appendChild(s);
  });
  _scriptsCharges.set(src, promesse);
  promesse.catch(() => { if (_scriptsCharges.get(src) === promesse) _scriptsCharges.delete(src); });
  return promesse;
}

// Données d'une zone ({ maj, lignes, … }), chargées au besoin. Rejette si le fichier manque ou ne définit pas la zone.
async function chargerZone(nom) {
  const zone = ZONES.find(z => z.nom === nom);
  if (!zone) throw new Error(`zone inconnue : ${nom}`);
  if (!ANNUAIRE_ZONES[nom]) {
    const promesse = chargerScript(zone.fichier);
    await promesse;
    if (!ANNUAIRE_ZONES[nom]) {
      if (_scriptsCharges.get(zone.fichier) === promesse) _scriptsCharges.delete(zone.fichier);   // fichier inattendu : le prochain appel le recharge
      throw new Error(`${zone.fichier} ne définit pas la zone ${nom}`);
    }
  }
  return ANNUAIRE_ZONES[nom];
}

// ---------- Clés et ouverture d'un fonds ----------

// Zone d'une clé d'adresse : « etats-unis » pour S000002839, « registres-ue » pour R90728 (numéro de la fiche ESMA),
// « europe » pour tout le reste (ISIN, N12345…)
function zoneDeCle(cle) {
  const zone = ZONES.find(z => z.motif.test(cle));
  return zone ? zone.nom : "europe";
}

// Fonds de l'annuaire d'après la clé de l'adresse, ou null. Europe : tout de suite, sans rien charger.
// Autre zone : charge d'abord sa liste (rejette si elle ne se charge pas).
async function entreeParCle(cle) {
  const nom = zoneDeCle(cle);
  if (nom === "europe") return annuaireParIsin(cle) || annuaireParCle(cle);
  const zone = await chargerZone(nom);
  const numero = Number(cle.slice(1));
  const ligne = zone.lignes.find(l => l[0] === cle[0] && l[1] === numero);
  return ligne ? lireEntree(ligne) : null;
}

// ---------- Recherche ----------

// Index d'une zone, construit une seule fois : tickers (en majuscules, car les données en ont en minuscules)
// et « nom + gestionnaire » normalisés. Une ligne peut n'avoir ni ticker ni gestionnaire.
const _indexZones = {};
function indexZone(nom) {
  if (_indexZones[nom]) return _indexZones[nom];
  const parTicker = new Map(), noms = [];
  ANNUAIRE_ZONES[nom].lignes.forEach((l, i) => {
    for (const t of (l[10] ? l[10].split(" ") : [])) if (t && !parTicker.has(t.toUpperCase())) parTicker.set(t.toUpperCase(), i);
    noms.push(normaliser((l[3] || "") + " " + (l[4] || "")));
  });
  return (_indexZones[nom] = { parTicker, noms });
}

// Fonds d'une zone déjà chargée dont un ticker est exactement `code` (en majuscules, sans espace), ou null
function tickerDeZone(nom, code) {
  if (!ANNUAIRE_ZONES[nom]) return null;
  const i = indexZone(nom).parTicker.get(code);
  return i === undefined ? null : lireEntree(ANNUAIRE_ZONES[nom].lignes[i]);
}

// Fonds d'une zone déjà chargée dont le nom ou le gestionnaire contient tous les mots de la requête, dans l'ordre du
// fichier de la zone (au plus `max`)
function motsDeZone(nom, requete, max) {
  if (!ANNUAIRE_ZONES[nom]) return [];
  const mots = normaliser(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return [];
  const { noms } = indexZone(nom), lignes = ANNUAIRE_ZONES[nom].lignes, trouves = [];
  for (let i = 0; i < noms.length && trouves.length < max; i++) {
    if (mots.every(m => noms[i].includes(m))) trouves.push(lireEntree(lignes[i]));
  }
  return trouves;
}

// Recherche dans une zone déjà chargée (voir chargerZone) : un ticker exact donne ce seul fonds, sinon il faut que
// tous les mots de la requête soient dans le nom ou le gestionnaire. Même ordre que le fichier de la zone.
function rechercherZone(nom, requete, max = 50) {
  if (!ANNUAIRE_ZONES[nom]) return [];
  const exact = tickerDeZone(nom, requete.replace(/\s/g, "").toUpperCase());
  return exact ? [exact] : motsDeZone(nom, requete, max);
}

// Recherche dans l'Europe puis dans chaque zone. Renvoie un tableau de fonds auquel s'ajoute `incomplet` : les noms des
// zones qui n'ont pas pu être chargées (tableau vide si tout va bien), dont les fonds manquent peut-être au résultat.
//  1. un ISIN ou un ticker exact en Europe donne ce fonds, sans charger aucune zone ;
//  2. sinon les zones sont chargées en parallèle ; si la recherche européenne ne donne rien et qu'un ticker exact existe
//     dans l'une d'elles, ce fonds est le seul résultat. Dès que l'Europe répond, ses résultats restent en tête : un ticker
//     américain qui est aussi un mot courant (« esg », « fcpi », « index »…) ne doit pas cacher les fonds européens ;
//  3. sinon les fonds européens, puis ceux de chaque zone (dans l'ordre de ZONES, le fonds au ticker exact en premier),
//     sans les séries américaines que l'Europe propose déjà sous leur ISIN (ETATS_UNIS_ISIN), jusqu'à `max`.
async function rechercherPartout(requete, max = 50) {
  const code = requete.replace(/\s/g, "").toUpperCase();
  const idx = indexAnnuaire();
  if (idx.parIsin.has(code) || idx.parTicker.has(code)) return Object.assign(rechercherAnnuaire(requete, max), { incomplet: [] });
  if (!normaliser(requete)) return Object.assign([], { incomplet: [] });

  const chargements = Promise.allSettled(ZONES.map(z => chargerZone(z.nom)));   // en route pendant la recherche européenne
  const europe = rechercherAnnuaire(requete, max);
  const etats = await chargements;
  const incomplet = [], chargees = [];
  ZONES.forEach((z, i) => (etats[i].status === "fulfilled" ? chargees : incomplet).push(z.nom));

  if (!europe.length) {
    for (const nom of chargees) {
      const exact = tickerDeZone(nom, code);
      if (exact) return Object.assign([exact], { incomplet });
    }
  }

  const dejaEnEurope = new Set();   // clés des séries américaines que l'Europe propose déjà
  if (typeof ETATS_UNIS_ISIN !== "undefined") {
    for (const e of europe) for (const isin of e.isins) if (ETATS_UNIS_ISIN[isin]) dejaEnEurope.add(ETATS_UNIS_ISIN[isin]);
  }
  const resultats = europe.slice();
  for (const nom of chargees) {
    const exact = tickerDeZone(nom, code), vus = new Set(dejaEnEurope);
    for (const e of (exact ? [exact] : []).concat(motsDeZone(nom, requete, max + dejaEnEurope.size + 1))) {
      if (!vus.has(cleEntree(e))) { vus.add(cleEntree(e)); resultats.push(e); }
    }
  }
  return Object.assign(resultats.slice(0, max), { incomplet });
}

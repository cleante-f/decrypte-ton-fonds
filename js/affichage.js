/*
 * Outils d'affichage partagés : échappement, infobulles, pastilles, graphiques en barres, échelle SRI,
 * liste des résultats de recherche et panneau de réglages.
 */

// Protège le texte avant de l'insérer dans la page
function esc(texte) {
  return String(texte ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mot technique + infobulle
function terme(cle, texte) {
  if (!GLOSSAIRE[cle]) return esc(texte);
  return `<button type="button" class="terme" data-terme="${cle}">${esc(texte)}</button>`;
}

function dateFr(iso) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "n.d.";
}

function source(src) {
  if (!src) return "";
  return `<p class="source">Source : ${esc(src.document)} · données du ${dateFr(src.date)}</p>`;
}

const PASTILLES = {
  vert: { icone: "✓", texte: "OK" }, orange: { icone: "!", texte: "À surveiller" }, rouge: { icone: "!!", texte: "Concentration forte" },
  info: { icone: "i", texte: "Info" }, attention: { icone: "!", texte: "Attention" }, alerte: { icone: "!!", texte: "Important" }
};

function pastille(niveau) {
  const p = PASTILLES[niveau];
  return `<span class="pastille pastille-${niveau}"><span aria-hidden="true">${p.icone}</span> ${p.texte}</span>`;
}

// ---------- Fonds détenus par un fonds : lien vers leur propre fiche ----------

// Nom réduit à l'essentiel, pour comparer « AMUNDI IND EURO CORP SRI UCITS ETF DRC » (nom abrégé d'un rapport)
// et « AMUNDI INDEX SOLUTIONS - AMUNDI INDEX EURO CORPORATE SRI » (nom de l'annuaire) : abréviations développées,
// mentions de part et de forme juridique retirées. Renvoie les variantes (nom complet, et nom sans le compartiment parent).
const ABREVIATIONS_FONDS = { ind: "index", idx: "index", corp: "corporate", govt: "government", gov: "government", intl: "international",
  oblig: "obligations", oblig_: "obligations", act: "actions", eq: "equity", uci: "", icav: "" };
const MOTS_SANS_IMPORTANCE = /^(part|parts|share|shares|class|classe|units?|acc|dis|dist|distribution|capitalisation|cap|capi|dr|drc|eur|usd|chf|gbp|hedged|sicav|fcp|ucits|etf|fund|fonds|\d?[a-z])$/;
function variantesNomFonds(nom) {
  const reduire = n => {
    const mots = normaliser(n).replace(/&/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .map(m => ABREVIATIONS_FONDS[m] !== undefined ? ABREVIATIONS_FONDS[m] : m)
      .filter(m => m && !MOTS_SANS_IMPORTANCE.test(m));
    return mots.filter((m, i) => m !== mots[i - 1]).join(" ");   // « amundi amundi msci… » → « amundi msci… »
  };
  const variantes = new Set([reduire(nom)]);
  const morceaux = String(nom).split(/\s+-\s+/);
  if (morceaux.length > 1) { variantes.add(reduire(morceaux[morceaux.length - 1])); variantes.add(reduire(morceaux[0])); }
  return [...variantes].filter(v => v.length >= 6);
}
function simplifierNomFonds(nom) { return variantesNomFonds(nom)[0] || ""; }

// Index des noms réduits de tout l'annuaire (construit une seule fois, à la première recherche)
let _indexNomsFonds = null;
function indexNomsFonds() {
  if (_indexNomsFonds) return _indexNomsFonds;
  _indexNomsFonds = new Map();
  if (typeof ANNUAIRE === "undefined") return _indexNomsFonds;
  ANNUAIRE.forEach((l, i) => {
    for (const v of variantesNomFonds(l[3])) {
      if (!_indexNomsFonds.has(v)) _indexNomsFonds.set(v, []);
      _indexNomsFonds.get(v).push(i);
    }
  });
  return _indexNomsFonds;
}

// Fonds de l'annuaire dont le nom correspond exactement (une fois réduit) à celui d'une ligne d'inventaire
function fondsParNom(nom) {
  if (typeof lireEntree !== "function") return null;
  const index = indexNomsFonds();
  const trouves = new Set();
  for (const v of variantesNomFonds(nom)) for (const i of index.get(v) || []) trouves.add(i);
  if (!trouves.size) return null;
  // Parmi les parts d'un même fonds : de préférence celle dont le nom colle (couverte ou non, distribution ou non),
  // avec un ISIN (fiche plus complète) et ouverte au public
  const n = String(nom).toUpperCase();
  const couvert = /HEDGED|COUVERT/.test(n), distrib = /\b(DIS|DIST|D)\b/.test(n);
  const rang = e => (/\b(DIS|DIST)\b|\(D\)/i.test(e.nom) !== distrib ? 1 : 0) + (e.isins.length ? 0 : 2) + (e.public ? 0 : 1);
  // une part couverte contre le change n'est pas la même chose qu'une part non couverte : dans le doute, pas de lien
  return [...trouves].map(i => lireEntree(ANNUAIRE[i])).filter(e => /HEDGED|COUVERT/i.test(e.nom) === couvert).sort((a, b) => rang(a) - rang(b))[0] || null;
}

// Fonds de l'annuaire correspondant à une ligne d'inventaire (par ISIN, sinon par nom exact), sinon null
function fondsDetenuDansAnnuaire(ligne) {
  if (!ligne || typeof annuaireParIsin !== "function") return null;
  const isin = ligne.isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(ligne.isin) ? ligne.isin : null;
  let e = isin ? annuaireParIsin(isin) : null;
  if (!e && (ligne.classe === "Fonds (OPC)" || /\b(FCP|SICAV|UCITS|ETF|FUND|FONDS|OPCVM)\b/i.test(ligne.nom))) e = fondsParNom(ligne.nom);
  return e ? { e, isin: isin && e.isins.includes(isin) ? isin : null } : null;
}

// Places de cotation Euronext (code MIC) : page officielle de l'ETF sur le site de la Bourse
const MIC_EURONEXT = { "Paris": "XPAR", "Amsterdam": "XAMS", "Brussels": "XBRU", "ETF Plus": "ETFP", "Lisbon": "XLIS", "Dublin": "XMSM", "Oslo Børs": "XOSL" };

/*
 * Où envoyer l'utilisateur quand il clique sur un fonds détenu :
 *   - notre fiche, si elle est bien fournie (fonds français suivi par l'AMF, ou ETF dont l'indice est reconnu) ;
 *   - sinon la page officielle du fonds : fiche de l'AMF (GECO) pour un fonds étranger commercialisé en France,
 *     page de la Bourse (Euronext ou Deutsche Börse) pour un ETF ;
 *   - sinon rien (pas de lien plutôt qu'une page vide).
 */
function destinationFonds(e, isin) {
  if (!e) return null;
  if (e.source === "G" && e.isins.length) return { type: "fiche", url: `decrypte.html#${encodeURIComponent(cleEntree(e, isin))}` };
  if (e.source === "E" && typeof trouverJumeau === "function" && trouverJumeau(e.nom)) return { type: "fiche", url: `decrypte.html#${encodeURIComponent(cleEntree(e, isin))}` };
  if (e.source === "U" && e.isins.length) return { type: "fiche", url: `decrypte.html#${encodeURIComponent(cleEntree(e, isin))}` };
  if (e.source === "G" || e.source === "N") return { type: "officielle", url: `https://geco.amf-france.org/produit-d-epargne/c${e.cmpId}`, site: "AMF" };
  if (e.source === "E" && e.isins.length) {
    const places = (e.marches || "").split(",").map(m => m.trim());
    const place = places.find(m => MIC_EURONEXT[m]);
    if (place) return { type: "officielle", url: `https://live.euronext.com/fr/product/etfs/${e.isins[0]}-${MIC_EURONEXT[place]}`, site: "Euronext" };
    if (places.includes("Xetra")) return { type: "officielle", url: `https://www.boerse-frankfurt.de/etf/${e.isins[0].toLowerCase()}`, site: "Deutsche Börse" };
  }
  return null;
}
function destinationFondsDetenu(ligne) {
  const t = fondsDetenuDansAnnuaire(ligne);
  return t ? destinationFonds(t.e, t.isin) : null;
}

// Lien vers un fonds (notre fiche ou sa page officielle), toujours dans un nouvel onglet
function lienFonds(dest, texte, classe = "") {
  const officielle = dest.type === "officielle";
  const titre = officielle ? `Ouvrir la page officielle de ${texte} (${dest.site}) dans un nouvel onglet` : `Ouvrir la fiche de ${texte} sur ce site dans un nouvel onglet`;
  // page officielle : petite étiquette (AMF, Euronext…) placée avant le nom, pour rester visible même si le nom est coupé
  return `<a class="${classe}${officielle ? " lien-officiel" : ""}" href="${esc(dest.url)}" target="_blank" rel="noopener" title="${esc(titre)}">${officielle ? `<span class="etiquette-officielle" aria-hidden="true">${esc(dest.site)} ↗</span>` : ""}${esc(texte)}${officielle ? "" : `<span class="lien-nouvelle-fenetre" aria-hidden="true"> ↗</span>`}<span class="sr-only"> (${officielle ? `page officielle ${esc(dest.site)}, ` : ""}nouvel onglet)</span></a>`;
}

// Phrase d'aide sous une liste de fonds détenus, selon les liens présents
function aideLiensFonds(destinations) {
  const d = destinations.filter(Boolean);
  if (!d.length) return "";
  const fiches = d.some(x => x.type === "fiche"), officielles = d.some(x => x.type === "officielle");
  return `<p class="aide">Les fonds soulignés s'ouvrent dans un nouvel onglet${fiches && officielles ? " : sur leur fiche de ce site, ou sur leur page officielle (AMF ou Bourse) quand nous n'avons pas assez de données publiques pour eux"
    : officielles ? ", sur leur page officielle (AMF ou Bourse) : nous n'avons pas assez de données publiques pour leur faire une fiche complète" : ", sur leur fiche de ce site"}.</p>`;
}

// Graphique en barres horizontales. `seuil` (optionnel) dessine un repère vertical.
// `echelle` : valeur qui correspond à une barre pleine (100 % par défaut).
// Un élément peut avoir un `lien` (destination : voir destinationFonds) : son nom devient cliquable.
function barres(items, seuil, echelle = 100) {
  if (!items || !items.length) return `<p class="vide">Donnée non disponible.</p>`;
  const tries = [...sansAutres(items)].sort((a, b) => b.poids - a.poids)
    .concat(items.filter(e => normaliser(e.nom).startsWith("autres")));
  const lignes = tries.map(e => {
    const depasse = seuil && !normaliser(e.nom).startsWith("autres") && e.poids > seuil;
    return `<li class="barre${depasse ? " barre-depasse" : ""}" title="${esc(e.nom)} : ${pct(e.poids)}">
      ${e.lien ? lienFonds(e.lien, e.nom, "barre-nom barre-lien") : `<span class="barre-nom">${esc(e.nom)}</span>`}
      <span class="barre-piste">
        <span class="barre-remplie" style="width:${Math.min(e.poids / echelle * 100, 100)}%"></span>
        ${seuil ? `<span class="barre-seuil" style="left:${seuil}%" aria-hidden="true"></span>` : ""}
      </span>
      <span class="barre-valeur">${pct(e.poids)}</span>
    </li>`;
  }).join("");
  let legende = seuil ? `<p class="legende-seuil"><span class="repere" aria-hidden="true"></span> seuil d'alerte : ${seuil} %</p>` : "";
  if (echelle !== 100) legende += `<p class="legende-seuil">Barre pleine = ${echelle} % du fonds</p>`;
  return `<ul class="barres">${lignes}</ul>${legende}`;
}

// Graduations « rondes » d'un axe (0, 20, 40… ou 0, 2 500, 5 000…)
function graduations(min, max, cible = 5) {
  const etendue = max - min || 1;
  const brut = etendue / cible;
  const puissance = Math.pow(10, Math.floor(Math.log10(brut)));
  const pas = [1, 2, 2.5, 5, 10].map(x => x * puissance).find(x => etendue / x <= cible + 1);
  const res = [];
  for (let v = Math.ceil(min / pas) * pas; v <= max + 1e-9; v += pas) res.push(Math.round(v * 1e6) / 1e6);
  return res;
}

function echelleSri(sri) {
  let cases = "";
  for (let i = 1; i <= 7; i++) {
    cases += `<span class="sri-case${i === sri ? " sri-actif" : ""}" aria-hidden="true">${i}</span>`;
  }
  return `<div class="sri" role="img" aria-label="Indicateur de risque ${sri} sur 7">${cases}</div>
    <div class="sri-legende"><span>Risque plus faible</span><span>Risque plus élevé</span></div>`;
}

function afficherListe(requete, reels) {
  if (!reels.length) {
    return `<div class="carte"><p>Aucun fonds trouvé pour « ${esc(requete)} ».</p>
      <p class="aide">L'annuaire contient ${ANNUAIRE.length.toLocaleString("fr-FR")} fonds : tous les fonds de droit français (base GECO de l'AMF),
      les fonds étrangers commercialisés en France, et tous les ETF et fonds cotés en bourse dans l'Union européenne. Essaie avec l'ISIN, le ticker ou quelques mots du nom.</p></div>`;
  }
  const origine = e => (e.source === "E" ? "ETF" : e.source === "N" ? "Fonds étranger" : e.source === "U" ? "Fonds coté en Europe"
    : e.etf ? "ETF · France" : "Fonds français") + (horsEee(e) ? ` · ${PAYS[e.pays] || e.pays}, hors Europe` : "");
  const lignes = reels.map(e => {
    const cle = cleEntree(e);
    return `<li><a href="#${esc(cle)}">${esc(e.nom)}</a>
      <small>${esc(e.isins[0] || "ISIN non publié")} · ${esc(origine(e))}${e.gestionnaire ? " · " + esc(e.gestionnaire) : ""}${e.classification ? " · " + esc(e.classification) : ""}${e.public ? "" : " · réservé"}</small></li>`;
  }).join("");
  return `<div class="carte"><h2>${reels.length >= 50 ? "Plus de 50" : reels.length} fonds trouvés</h2>
    ${reels.length >= 50 ? `<p class="aide">Seuls les 50 premiers sont affichés : précise ta recherche.</p>` : ""}
    <ul class="similaires resultats">${lignes}</ul></div>`;
}

function afficherReglages(seuils) {
  const lignes = Object.entries(seuils).map(([cle, s]) => `
    <fieldset>
      <legend>${esc(s.libelle)}</legend>
      <label>Orange au-delà de <input type="number" min="0" max="100" step="1" name="${cle}-orange" value="${s.orange}"> %</label>
      <label>Rouge au-delà de <input type="number" min="0" max="100" step="1" name="${cle}-rouge" value="${s.rouge}"> %</label>
    </fieldset>`).join("");
  return `<form id="form-reglages" class="carte">
    <h2>Réglages des alertes</h2>
    ${lignes}
    <div class="boutons">
      <button type="submit" class="btn">Enregistrer</button>
      <button type="button" class="btn btn-secondaire" id="btn-reinit">Valeurs par défaut</button>
    </div>
  </form>`;
}

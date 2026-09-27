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

// Graphique en barres horizontales. `seuil` (optionnel) dessine un repère vertical.
// `echelle` : valeur qui correspond à une barre pleine (100 % par défaut).
function barres(items, seuil, echelle = 100) {
  if (!items || !items.length) return `<p class="vide">Donnée non disponible.</p>`;
  const tries = [...sansAutres(items)].sort((a, b) => b.poids - a.poids)
    .concat(items.filter(e => normaliser(e.nom).startsWith("autres")));
  const lignes = tries.map(e => {
    const depasse = seuil && !normaliser(e.nom).startsWith("autres") && e.poids > seuil;
    return `<li class="barre${depasse ? " barre-depasse" : ""}" title="${esc(e.nom)} : ${pct(e.poids)}">
      <span class="barre-nom">${esc(e.nom)}</span>
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
      les ETF cotés sur Euronext et Xetra, et les fonds étrangers commercialisés en France. Essaie avec l'ISIN, le ticker ou quelques mots du nom.</p></div>`;
  }
  const origine = e => e.source === "E" ? "ETF" : e.source === "N" ? "Fonds étranger" : e.etf ? "ETF · France" : "Fonds français";
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

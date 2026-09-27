/*
 * Fiche générée automatiquement pour les fonds de l'annuaire (data/annuaire.js).
 *
 * - Fonds français (source "G") : données en direct depuis GECO + lecture du DIC (voir geco.js)
 * - ETF étrangers (source "E")  : identité seulement (Euronext / Xetra) + indices tirés du nom
 * - Fonds étrangers sans ISIN (source "N") : identité seulement (GECO)
 *
 * Tout ce qui ne peut pas être obtenu automatiquement est signalé comme « non disponible » : on n'invente rien.
 */

const LIENS = {
  geco: e => `https://geco.amf-france.org/produit-d-epargne/c${e.cmpId}`,
  document: d => `${GECO_API}/document/download/${d.idInterne}`,
  justetf: isin => `https://www.justetf.com/fr/etf-profile.html?isin=${isin}`
};

const PAYS = {
  FR: "France", IE: "Irlande", LU: "Luxembourg", DE: "Allemagne", NL: "Pays-Bas", AT: "Autriche", BE: "Belgique",
  SE: "Suède", FI: "Finlande", IT: "Italie", ES: "Espagne", NO: "Norvège", DK: "Danemark", PT: "Portugal"
};

// Ce que chaque classification AMF implique (définitions réglementaires simplifiées)
const CLASSIFICATIONS = {
  "Actions françaises": "Au moins 60 % du fonds est investi en actions françaises.",
  "Actions de pays de la zone euro": "Au moins 60 % du fonds est investi en actions de la zone euro.",
  "Actions des pays de l'Union Européenne": "Au moins 60 % du fonds est investi en actions de l'Union européenne.",
  "Actions internationales": "Au moins 60 % du fonds est investi en actions, sans contrainte géographique.",
  "Obligations et/ou titres de créances libellés en euros": "Fonds investi en obligations et titres de dette libellés en euros.",
  "Obligations et/ou titres de créances internationaux": "Fonds investi en obligations de différents pays et devises.",
  "Fonds mixtes": "Fonds qui mélange actions, obligations et placements monétaires, dans des proportions variables.",
  "Fonds à formule": "Le résultat dépend d'une formule de calcul fixée à l'avance, souvent avec une échéance et des conditions de sortie.",
  "Garanti ou assorti d'une protection": "Le capital est garanti ou protégé, en général seulement à une date précise et sous conditions.",
  "Fonds commun à risques": "Fonds de capital-investissement (entreprises non cotées) : argent bloqué plusieurs années, risque de perte élevé.",
  "Fonds commun de placement à innovation": "FCPI : fonds de capital-investissement dans des PME innovantes non cotées, argent bloqué 7 à 10 ans.",
  "Fonds d'investissement de proximité": "FIP : fonds de capital-investissement dans des PME régionales non cotées, argent bloqué 7 à 10 ans.",
  "Investis en titres de l’entreprise": "Fonds d'épargne salariale investi en actions de votre entreprise.",
  "Fonds monétaire à valeur liquidative variable (VNAV) standard": "Placement de trésorerie à très faible risque, rendement proche des taux courts.",
  "Fonds monétaire à valeur liquidative variable (VNAV) court terme": "Placement de trésorerie à très faible risque, rendement proche des taux courts.",
  "Fonds Immobilier": "Fonds investi dans l'immobilier : la revente de vos parts peut prendre du temps.",
  "Fonds de multigestion alternative": "Fonds investi dans des fonds « alternatifs » aux stratégies complexes.",
  "Fonds spéculatifs": "Fonds aux stratégies complexes, avec levier possible : réservé aux investisseurs avertis."
};

// ---------- Indices tirés du nom (utile surtout pour les ETF) ----------

function indicesDuNom(nom) {
  const n = " " + nom.toUpperCase() + " ";
  return {
    synthetique: /\bSWAP\b/.test(n),
    couvert: /HEDGED|\bHDG\b|\bH\b.*\bEUR\b|COUVERT/.test(n),
    levier: /LEVERAG|\b[2-5]X\b|\(2X\)|\(3X\)|\bDAILY\b.*\b(SHORT|LONG)\b|\bSHORT\b|LEVIER|\bINVERSE\b/.test(n),
    distribution: /\bDIST\b|\bDIS\b|\bDISTRIBUTING\b|\bD\b(?=\s*$)|\bINC\b/.test(n),
    capitalisation: /\bACC\b|\bACCUMULATING\b|\bCAPI\b|\bC\b(?=\s*$)/.test(n),
    pea: /\bPEA\b/.test(n),
    indiciel: /\bETF\b|\bINDEX\b|\bINDICE\b|TRACKER|\bMSCI\b|S&P|STOXX|\bCAC\b|FTSE|NASDAQ|RUSSELL/.test(n),
    horsEurope: /S&P|NASDAQ|\bUSA?\b|\bWORLD\b|\bMONDE\b|EMERG|JAPAN|JAPON|\bASIA|CHINA|CHINE|\bINDIA|INDE\b|MSCI ACWI|ALL COUNTRY/.test(n),
    usa: /S&P 500|S&P500|NASDAQ|\bUSA?\b|RUSSELL|DOW JONES/.test(n)
  };
}

// Un ETF éligible au PEA qui suit un indice hors Europe est forcément à réplication synthétique
function estSynthetique(e, nom, dic) {
  return nom.synthetique || (nom.pea && nom.horsEurope) || !!(dic && dic.synthetique && (e.etf || nom.indiciel));
}

// ---------- Détection des pièges (fonds automatiques) ----------

function detecterPiegesAuto(e, d) {
  const p = [];
  const nom = indicesDuNom(e.nom);
  const dic = d && d.dic;
  const k = e.classification;

  // Structure du fonds
  if (/formule/i.test(k)) p.push({ niveau: "alerte", terme: "formule", titre: "Fonds à formule",
    texte: "Le gain dépend d'une formule fixée à l'avance et n'est acquis qu'à l'échéance. Une sortie anticipée se fait au prix du jour, souvent pénalisée. Lisez la formule dans le DIC." });
  if (/Garanti|protection/i.test(k)) p.push({ niveau: "attention", terme: "formule", titre: "Capital garanti ou protégé… sous conditions",
    texte: "La garantie ne vaut en général qu'à une date précise, et dépend de la solidité de la banque garante." });
  if (/risques|innovation|proximit/i.test(k)) p.push({ niveau: "alerte", terme: "risque_liquidite", titre: "Capital-investissement : argent bloqué plusieurs années",
    texte: "Ces fonds investissent dans des entreprises non cotées. Votre argent est généralement bloqué 7 à 10 ans et le risque de perte en capital est élevé. Les frais sont souvent importants." });
  if (/sp[ée]culatif|alternative/i.test(k)) p.push({ niveau: "alerte", terme: "derives", titre: "Stratégies complexes",
    texte: "Ce type de fonds peut utiliser le levier et des produits dérivés. Il est réservé à des investisseurs avertis." });
  if (/Immobilier/i.test(k)) p.push({ niveau: "attention", terme: "risque_liquidite", titre: "Fonds immobilier : revente parfois lente",
    texte: "En cas de nombreuses demandes de sortie, le remboursement de vos parts peut prendre du temps ou être suspendu." });
  if (/FCPE/.test(e.nature)) p.push({ niveau: "info", terme: "liquidite", titre: "Épargne salariale (FCPE)",
    texte: "Les sommes sont en général bloquées 5 ans (PEE) ou jusqu'à la retraite (PERCO/PERECO), sauf cas de déblocage anticipé prévus par la loi." });
  if (/titres de l.entreprise/i.test(k)) p.push({ niveau: "alerte", terme: "top10", titre: "Investi dans une seule entreprise : la vôtre",
    texte: "Si l'entreprise traverse des difficultés, vous risquez de perdre à la fois une partie de votre épargne et votre emploi. C'est une concentration extrême." });
  if (!e.public) p.push({ niveau: "info", terme: "opcvm", titre: "Fonds réservé",
    texte: "Ce fonds est réservé à une catégorie d'investisseurs (institutionnels, salariés d'une entreprise, 20 porteurs au plus…)." });

  // Informations lues dans le DIC
  if (dic) {
    if (dic.nourricier) p.push({ niveau: "alerte", terme: "nourricier", titre: "Fonds nourricier : une couche de frais en plus",
      texte: `Le DIC indique que ce fonds investit dans un fonds « maître »${dic.maitre ? ` (${dic.maitre})` : ""}. Il ajoute ses propres frais : comparez ses frais avec ceux du fonds maître, qui est parfois accessible directement.` });
    if (dic.fondsDeFonds) p.push({ niveau: "attention", terme: "fonds_de_fonds", titre: "Fonds de fonds : double niveau de frais",
      texte: "Le DIC indique que ce fonds investit une grande partie de son actif dans d'autres fonds, qui prélèvent aussi leurs frais." });
    const courants = (dic.gestion || 0) + (dic.transaction || 0);
    if (dic.gestion !== null && dic.gestion !== undefined) {
      if (courants >= SEUILS_FRAIS.rouge) p.push({ niveau: "alerte", terme: "frais_courants", titre: `Frais annuels élevés : ${pct(courants, 2)}`,
        texte: `Sur 10 000 € placés 10 ans à 5 % brut par an, ces frais coûteraient environ ${euros(valeurFinale(10000, 5, 10) - valeurFinale(10000, 5 - courants, 10))}. Un ETF comparable coûte souvent moins de 0,3 % par an.` });
      else if (courants >= SEUILS_FRAIS.orange) p.push({ niveau: "attention", terme: "frais_courants", titre: `Frais annuels assez élevés : ${pct(courants, 2)}`,
        texte: `Sur 10 000 € placés 10 ans à 5 % brut par an, ces frais coûteraient environ ${euros(valeurFinale(10000, 5, 10) - valeurFinale(10000, 5 - courants, 10))}.` });
    }
    if (dic.entree > 0) p.push({ niveau: "attention", terme: "frais_entree", titre: `Droits d'entrée jusqu'à ${pct(dic.entree)}`,
      texte: `Sur 10 000 € investis, jusqu'à ${euros(100 * dic.entree)} peuvent être prélevés dès le départ. Souvent négociables, voire nuls en assurance-vie en ligne.` });
    if (dic.sortie > 0) p.push({ niveau: "attention", terme: "frais_sortie", titre: `Frais de sortie jusqu'à ${pct(dic.sortie)}`,
      texte: `Revendre vos parts peut vous coûter jusqu'à ${pct(dic.sortie)} du montant retiré.` });
    if (dic.performance) p.push({ niveau: "attention", terme: "surperformance", titre: "Commission de surperformance",
      texte: `Extrait du DIC : « ${dic.performance.slice(0, 220)}${dic.performance.length > 220 ? "…" : ""} ». Les bonnes années, elle s'ajoute aux frais annuels.` });
    if (dic.levier) p.push({ niveau: "attention", terme: "levier", titre: "Effet de levier possible",
      texte: "Le DIC mentionne un effet de levier : les gains comme les pertes peuvent être amplifiés." });
  }

  // Révélé par l'inventaire (moteur 1)
  const compo = e.source === "G" && d && d.composition && d.composition.c;
  const inv = compo && compo.inventaire;
  if (inv && inv.swapsPct >= 50 && !estSynthetique(e, nom, dic)) {
    const panier = (inv.top10 || []).slice(0, 3).map(l => l.nom).join(", ");
    p.push({ niveau: "attention", terme: "replication_synthetique", titre: "Réplication synthétique révélée par l'inventaire",
      texte: `Le rapport annuel montre un contrat d'échange (swap) couvrant environ ${Math.round(inv.swapsPct)} % de l'actif. Le fonds détient en réalité d'autres titres (${panier}…) et échange leur performance contre celle de son objectif. Si la banque contrepartie faisait défaut, le fonds pourrait perdre une partie de sa valeur (risque limité à 10 % de l'actif par la réglementation UCITS).` });
  }
  if (inv && inv.partFonds >= 50 && !(dic && (dic.nourricier || dic.fondsDeFonds))) {
    const premier = (inv.top10 || [])[0];
    if (premier && premier.poids >= 80) p.push({ niveau: "alerte", terme: "nourricier", titre: "Fonds nourricier (révélé par l'inventaire)",
      texte: `${pct(premier.poids)} de l'actif est placé dans un seul autre fonds : « ${premier.nom} ». Ce fonds ajoute ses propres frais à ceux du fonds qu'il détient. Vérifiez si ce fonds sous-jacent est accessible directement, avec moins de frais.` });
    else p.push({ niveau: "attention", terme: "fonds_de_fonds", titre: "Fonds de fonds (révélé par l'inventaire)",
      texte: `Environ ${Math.round(inv.partFonds)} % de l'actif est placé dans d'autres fonds, qui prélèvent aussi leurs propres frais : vous payez deux niveaux de frais.` });
  }

  // Indices tirés du nom
  if (nom.levier) p.push({ niveau: "alerte", terme: "levier", titre: "Produit à effet de levier ou inversé",
    texte: "Le nom indique un levier ou une position « short ». Ces produits sont conçus pour du très court terme : sur la durée, leur performance peut fortement s'écarter de celle de l'indice." });
  if (estSynthetique(e, nom, dic)) p.push({ niveau: "attention", terme: "replication_synthetique", titre: "Réplication synthétique (via swap)",
    texte: "Le fonds obtient la performance de l'indice grâce à un contrat avec une banque. Si cette banque faisait défaut, le fonds pourrait perdre une partie de sa valeur (risque limité à 10 % de l'actif par la réglementation UCITS)." +
      (nom.pea && nom.horsEurope ? " C'est ce mécanisme qui rend éligible au PEA un fonds qui suit un indice hors Europe." : "") });

  // Données de marché
  if (d && d.stats && d.stats.frequence !== "quotidienne") p.push({ niveau: "attention", terme: "liquidite", titre: `Valeur calculée de façon ${d.stats.frequence}`,
    texte: "Vous ne pouvez acheter ou vendre qu'aux dates de calcul de la valeur liquidative, pas n'importe quel jour." });
  if (d && d.encours && !d.encours.horsEuro && d.encours.montant < 50) p.push({ niveau: "attention", terme: "encours", titre: `Petit fonds : ${d.encours.montant.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`,
    texte: "Les petits fonds sont plus souvent fermés ou fusionnés, ce qui peut vous obliger à vendre au mauvais moment." });

  // Informations
  const part = d && d.part;
  if (part && part.parAffctnRevnuLib) p.push({ niveau: "info", terme: /distrib/i.test(part.parAffctnRevnuLib) ? "distribution" : "capitalisation",
    titre: part.parAffctnRevnuLib, texte: /distrib/i.test(part.parAffctnRevnuLib) ? "Les revenus vous sont versés régulièrement." : "Les revenus sont réinvestis automatiquement dans le fonds." });
  else if (nom.distribution || nom.capitalisation) p.push({ niveau: "info", terme: nom.distribution ? "distribution" : "capitalisation",
    titre: nom.distribution ? "Part distribuante (d'après le nom)" : "Part capitalisante (d'après le nom)", texte: "" });
  if (nom.couvert) p.push({ niveau: "info", terme: "couverture_change", titre: "Part couverte contre le risque de change (d'après le nom)", texte: "" });
  if (nom.pea) p.push({ niveau: "info", terme: "pea", titre: "Éligible au PEA (d'après le nom)", texte: "" });
  return p;
}

// ---------- Rendu ----------

function badgeSource(texte) {
  return `<span class="badge-source">${esc(texte)}</span>`;
}

function listeInfos(infos) {
  return `<dl class="grille-infos">${infos.filter(Boolean).map(([t, v, large]) =>
    `<div${large ? ' class="large"' : ""}><dt>${t}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function nonDispo(texte) {
  return `<p class="non-dispo">${texte}</p>`;
}

// Petit graphique de la valeur liquidative (SVG), avec info au survol
function graphiqueVL(h) {
  if (!h) return "";
  const n = h.valeurs.length, L = 640, H = 180, marge = 4;
  const min = Math.min(...h.valeurs), max = Math.max(...h.valeurs);
  const x = i => marge + (i / (n - 1)) * (L - 2 * marge);
  const y = v => H - marge - ((v - min) / (max - min || 1)) * (H - 2 * marge);
  let chemin = "";
  const pas = Math.max(1, Math.floor(n / 600)); // on allège les longues séries
  for (let i = 0; i < n; i += pas) chemin += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(h.valeurs[i]).toFixed(1);
  chemin += "L" + x(n - 1).toFixed(1) + " " + y(h.valeurs[n - 1]).toFixed(1);
  const fmt = d => d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
  return `<figure class="graphique-vl" data-n="${n}">
    <figcaption>Valeur liquidative de la part, du ${h.dates[0].toLocaleDateString("fr-FR")} au ${h.dates[n - 1].toLocaleDateString("fr-FR")}</figcaption>
    <div class="graphique-zone">
      <svg viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" role="img" aria-label="Évolution de la valeur liquidative">
        <path d="${chemin}" class="ligne-vl" vector-effect="non-scaling-stroke"/>
        <line class="curseur-vl" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke" visibility="hidden"/>
      </svg>
      <div class="bulle-vl" hidden></div>
    </div>
    <div class="axe-vl"><span>${fmt(h.dates[0])}</span><span>min ${min.toLocaleString("fr-FR")} · max ${max.toLocaleString("fr-FR")}</span><span>${fmt(h.dates[n - 1])}</span></div>
  </figure>`;
}

function activerGraphiqueVL(racine, h) {
  const fig = racine.querySelector(".graphique-vl");
  if (!fig || !h) return;
  const zone = fig.querySelector(".graphique-zone"), curseur = fig.querySelector(".curseur-vl"), bulle = fig.querySelector(".bulle-vl");
  const n = h.valeurs.length;
  const bouger = ev => {
    const r = zone.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width;
    const i = Math.min(n - 1, Math.max(0, Math.round(px * (n - 1))));
    const xSvg = 4 + (i / (n - 1)) * (640 - 8);
    curseur.setAttribute("x1", xSvg); curseur.setAttribute("x2", xSvg); curseur.setAttribute("visibility", "visible");
    bulle.hidden = false;
    bulle.textContent = `${h.dates[i].toLocaleDateString("fr-FR")} : ${h.valeurs[i].toLocaleString("fr-FR")}`;
    bulle.style.left = Math.min(Math.max(0, px * r.width - 60), r.width - 130) + "px";
  };
  const cacher = () => { curseur.setAttribute("visibility", "hidden"); bulle.hidden = true; };
  zone.addEventListener("mousemove", bouger);
  zone.addEventListener("touchmove", bouger, { passive: true });
  zone.addEventListener("mouseleave", cacher);
  zone.addEventListener("touchend", cacher);
}

// ---------- Sections 2 et 3 : composition calculée ----------

function badgeQualite(q) {
  return q ? `<span class="pastille pastille-${q.niveau === "vert" ? "vert" : q.niveau === "orange" ? "orange" : "rouge"}">${esc(q.texte)}</span>` : "";
}

function blocStyle(st, q) {
  if (!st) return "";
  const dollar = st.r2 < 0.8 ? "" : st.dollar.couche <= -10 && st.dollar.actions >= 15 ? `<p class="note">Couche « dollar » négative (${st.dollar.couche} %) : le fonds semble <strong>couvrir</strong> une partie de son exposition au dollar.</p>`
    : st.dollar.couche >= 10 ? `<p class="note">Couche « dollar » positive (+${st.dollar.couche} %) : le fonds semble détenir des actifs en dollars en plus de ses actions américaines (obligations ou liquidités en dollars).</p>` : "";
  return `
    <h3>${terme("analyse_style", "Ce que révèlent les rendements")} ${badgeQualite(q)}</h3>
    <p class="aide">Mélange de références qui reproduit le mieux les variations hebdomadaires du fonds, du ${st.debut.toLocaleDateString ? st.debut.toLocaleDateString("fr-FR") : dateFr(st.debut)} au ${st.fin.toLocaleDateString ? st.fin.toLocaleDateString("fr-FR") : dateFr(st.fin)}
      (${st.semaines} semaines, ${terme("r2", "R²")} = ${pct(st.r2 * 100, 0)}, écart résiduel ${pct(st.ecartSuivi)} par an).</p>
    ${barres(st.expositions.map(x => ({ nom: x.nom, poids: x.poids })))}
    ${dollar}`;
}

function sectionRepartitionAuto(e, isin, d, dic, docsHtml, srcDic, chargement) {
  const objectif = dic && dic.objectif ? `<h3>Objectif et politique d'investissement <small>(extrait du DIC)</small></h3><blockquote class="extrait">${esc(dic.objectif)}</blockquote>` : "";
  const docs = docsHtml ? `<details class="documents-details"><summary>Documents officiels</summary>${docsHtml}</details>` : "";
  const compo = d && d.composition;
  const c = compo && compo.c;
  let corps = "";

  if (chargement) corps = `<p class="chargement">Chargement des données…</p>`;
  else if (compo && compo.jumeau) corps += `<p class="note">Pas de données publiques pour ce fonds étranger. Estimation à partir d'un fonds français qui suit le <strong>même indice (${esc(compo.jumeau.indice)})</strong> :
      <a href="#${esc(compo.jumeau.fonds.isins[0])}">${esc(compo.jumeau.fonds.nom)}</a>${/ESG|SRI|SCREENED|CLIMATE|PAB|CTB|SELECTION|PARIS/i.test(compo.jumeau.fonds.nom) ? " (version ESG ou climat de l'indice : la composition peut légèrement différer)" : ""}. Les frais et la méthode de réplication peuvent différer.</p>`;

  if (!chargement && c && c.principale) {
    const seuils = chargerSeuils();
    const methodes = {
      inventaire: () => `calculée par nos soins à partir des <strong>${c.inventaire.nbLignes} lignes</strong> de l'${terme("inventaire", "inventaire")} publié dans le ${esc(c.inventaire.document.docTypeLib.toLowerCase())} du ${dateFr(c.inventaire.document.dateEffet)}`,
      tableaux: () => `lue dans les tableaux de répartition du ${esc(c.inventaire.document.docTypeLib.toLowerCase())} du ${dateFr(c.inventaire.document.dateEffet)}`,
      style: () => `estimée par l'${terme("analyse_style", "analyse des rendements")} (fiabilité : ${esc(c.qualite ? c.qualite.texte : "n.d.")})`
    };
    const methode = methodes[c.principale]();
    const top = (c.top10 || []).slice(0, 10);
    const totalTop = top.reduce((t, l) => t + l.poids, 0);
    const synth = c.notes.some(n => n.type === "synthetique");
    corps += `
      <p class="methode">Répartition ${methode}.</p>
      ${c.notes.map(n => `<p class="note">${esc(n.texte)}</p>`).join("")}
      <div class="deux-colonnes">
        ${c.pays && c.pays.length ? `<div><h3>Par pays${c.principale === "style" ? " <small>(pays identifiables)</small>" : c.inventaire && c.inventaire.sourcePays === "tableau" ? " <small>(principaux pays publiés)</small>" : c.inventaire && c.inventaire.sourcePays === "devise" ? " <small>(déduit de la devise de cotation)</small>" : ""}</h3>${barres(c.pays, seuils.pays.rouge)}</div>` : ""}
        ${c.zones && c.zones.length ? `<div><h3>Par zone</h3>${barres(c.zones)}</div>` : ""}
        ${c.secteurs && c.secteurs.length ? `<div><h3>Par secteur</h3>${barres(c.secteurs, seuils.secteur.rouge)}</div>` : ""}
        ${c.classes && c.classes.length ? `<div><h3>Par ${terme("classe_actifs", "classe d'actifs")}</h3>${barres(c.classes)}</div>` : ""}
        ${c.devises && c.devises.length ? `<div><h3>Par devise</h3>${barres(c.devises)}</div>` : ""}
      </div>
      ${top.length ? `<h3>${terme("top10", synth ? "Titres détenus (panier de substitution)" : c.lignesSontDesFonds ? "Principaux fonds détenus" : "Principales lignes")} <span class="total">(${pct(totalTop)} du fonds)</span></h3>
        ${barres(top.map(l => ({ nom: l.nom, poids: l.poids })), null, Math.min(100, Math.ceil(Math.max(...top.map(l => l.poids), 1) / 10) * 10))}` : ""}
      ${c.principale !== "style" && c.style ? blocStyle(c.style, c.qualite) : c.principale === "style" ? blocStyle(c.style, c.qualite) : ""}`;
  } else if (!chargement && compo && compo.fini) {
    corps += nonDispo(e.source === "G"
      ? "Composition non calculable : aucun rapport annuel lisible dans GECO et historique de valeurs liquidatives insuffisant."
      : "Composition non calculable : aucune donnée publique gratuite pour ce fonds et aucun fonds français ne suit un indice reconnu dans son nom.");
  }
  if (!chargement && compo && !compo.fini) {
    corps += `<p class="chargement" id="progression-compo">${esc(compo.progression || "Analyse de la composition en cours…")}</p>`;
  }
  if (!chargement && !compo && e.source !== "G") corps += `<p class="chargement">Recherche d'un fonds français comparable…</p>`;

  const sources = [];
  if (c && c.inventaire && c.inventaire.document) sources.push(`<a href="${GECO_API}/document/download/${c.inventaire.document.idInterne}" target="_blank" rel="noopener">${esc(c.inventaire.document.docTypeLib)} du ${dateFr(c.inventaire.document.dateEffet)}</a> (AMF – GECO)`);
  if (c && c.style) sources.push("valeurs liquidatives (AMF – GECO) et taux de la Banque centrale européenne");
  return `<section class="carte"><h2>2. Où est investi l'argent ?</h2>
    ${objectif}${corps}
    ${sources.length ? `<p class="source">Données brutes : ${sources.join(" ; ")}. Calculs : ce site.</p>` : ""}
    ${srcDic ? source(srcDic) : ""}
    ${docs}
  </section>`;
}

function sectionConcentrationAuto(e, d, chargement) {
  const c = d && d.composition && d.composition.c;
  const alertes = [];
  if (c && c.principale) {
    const seuils = chargerSeuils();
    const brutes = alertesConcentration(pseudoFonds(c), seuils);
    for (const a of brutes) {
      // Avec l'analyse des rendements, seuls les États-Unis et le Japon sont identifiables comme pays
      if (a.cle === "pays" && c.principale === "style" && a.niveau === "vert") {
        // on juge la concentration géographique sur la seule partie actions
        const za = c.style && c.style.zonesActions;
        const z = za && za.zones[0];
        if (z && za.total >= 20) alertes.push({ niveau: z.poids > seuils.pays.rouge ? "orange" : "vert",
          titre: z.poids > seuils.pays.rouge ? `Actions concentrées sur une zone : ${z.nom} (${pct(z.poids, 0)} des actions)` : "Actions réparties entre plusieurs zones",
          explication: z.poids > seuils.pays.rouge ? `La partie actions (≈ ${za.total} % du fonds) dépend surtout d'une seule grande zone géographique : si ses marchés chutent, cette partie du fonds baisse d'un bloc.` : `La première zone (${z.nom}) représente ${pct(z.poids, 0)} de la partie actions.` });
        continue;
      }
      if (a.cle === "secteur" && c.principale === "style") continue;
      if ((a.cle === "top10" || a.cle === "ligne") && (!c.top10 || !c.top10.length)) continue;
      if (a.cle === "top10" && a.niveau === "info" && c.notes.some(n => n.type === "synthetique")) {
        alertes.push({ ...a, titre: "Lignes détenues = panier de substitution",
          explication: "Les titres détenus ne servent que de garantie au swap : leur poids ne mesure pas la concentration réelle, qui est celle de l'indice suivi." });
        continue;
      }
      if (a.cle === "secteur" && (!c.secteurs || !c.secteurs.length)) continue;
      alertes.push(a);
    }
    if (c.style && c.style.techUs > seuils.secteur.orange) alertes.push({ niveau: c.style.techUs > seuils.secteur.rouge ? "rouge" : "orange",
      titre: `Forte dépendance aux valeurs technologiques américaines (≈ ${pct(c.style.techUs, 0)})`,
      explication: "Les rendements du fonds suivent de près ceux du Nasdaq-100 : en cas de chute des grandes valeurs technologiques, le fonds serait fortement touché." });
  } else {
    if (/françaises/i.test(e.classification)) alertes.push({ niveau: "rouge", titre: "Concentré sur un seul pays : la France",
      explication: "D'après sa classification AMF, au moins 60 % du fonds est investi en actions françaises." });
    if (/zone euro|Union Europ/i.test(e.classification)) alertes.push({ niveau: "orange", titre: "Concentré sur une seule zone géographique",
      explication: "D'après sa classification AMF, au moins 60 % des actions viennent d'une même zone (Europe)." });
  }
  if (/titres de l.entreprise/i.test(e.classification)) alertes.push({ niveau: "rouge", titre: "Une seule entreprise",
    explication: "Le fonds est investi dans l'entreprise qui vous emploie : concentration maximale." });

  const enCours = !chargement && d && d.composition && !d.composition.fini;
  return `
  <section class="carte">
    <h2>3. Surexposition et concentration</h2>
    ${c && c.principale ? `<p class="aide">Alertes calculées sur la composition ci-dessus. Seuils modifiables dans « Réglages des alertes ».</p>` : ""}
    ${alertes.length ? `<ul class="liste-alertes">${alertes.map(a => `<li class="alerte alerte-${a.niveau}">${pastille(a.niveau)}<div><strong>${esc(a.titre)}</strong><p>${esc(a.explication)}</p></div></li>`).join("")}</ul>` : ""}
    ${chargement || enCours ? `<p class="chargement">Calcul en attente de la composition…</p>` : !(c && c.principale) ? nonDispo("Composition non disponible : les alertes ci-dessus (s'il y en a) sont déduites de la classification AMF.") : ""}
  </section>`;
}

function afficherFicheAuto(e, isin, d, chargement) {
  const nomIdx = indicesDuNom(e.nom);
  const dic = d && d.dic;
  const part = d && d.part;
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const srcGeco = { document: "AMF – base GECO (en direct)", date: aujourdHui };
  const srcAnnuaire = { document: e.source === "E" ? "Listes des ETF Euronext et Xetra" : "AMF – base GECO", date: ANNUAIRE_DATE };
  const srcDic = dic ? { document: `DIC « ${dic.document.docName} »${dic.autrePart ? ` (part ${dic.autrePart})` : ""}`, date: dic.document.dateEffet } : null;

  // Types
  const types = [];
  if (e.etf) types.push(["etf", "ETF"]);
  if (nomIdx.indiciel || e.etf) types.push(["indiciel", "Indiciel (probable)"]);
  if (dic && dic.nourricier) types.push(["nourricier", "Fonds nourricier"]);
  if (dic && dic.fondsDeFonds) types.push(["fonds_de_fonds", "Fonds de fonds"]);
  if (/formule/i.test(e.classification)) types.push(["formule", "Fonds à formule"]);

  const docsHtml = d && d.documents && d.documents.length
    ? `<ul class="documents">${d.documents.slice(0, 8).map(doc =>
        `<li><a href="${LIENS.document(doc)}" target="_blank" rel="noopener">${esc(doc.docTypeLib)}</a> <small>du ${dateFr(doc.dateEffet)}</small></li>`).join("")}</ul>`
    : "";

  const entete = `
    <p class="bandeau-auto">Fiche générée <strong>automatiquement</strong> à partir de sources publiques.
      Les éléments non disponibles sont signalés : vérifie toujours le DIC officiel.</p>
    <header class="fiche-entete">
      <h1>${esc(e.nom)}</h1>
      <p>${esc(isin || "ISIN non publié")}${part ? ` · part « ${esc(part.parNom)} »` : ""}${e.gestionnaire ? ` · ${esc(e.gestionnaire)}` : ""}</p>
      <div class="actions-fiche">
        <a class="btn-onglet" href="performances.html#${esc(cleEntree(e, isin))}">Voir le graphique des performances →</a>
      </div>
    </header>`;

  // ----- 1. Identité -----
  const identite = `
  <section class="carte">
    <h2>1. Identité du fonds</h2>
    <div class="etiquettes">${types.map(([k, t]) => `<span class="etiquette">${terme(k, t)}</span>`).join("")}</div>
    ${listeInfos([
      [terme("isin", "ISIN"), esc(isin || "non publié")],
      e.tickers.length && [terme("ticker", "Ticker(s)"), esc(e.tickers.slice(0, 6).join(", "))],
      e.marches && ["Cotation", esc(e.marches)],
      e.gestionnaire && [terme("societe_gestion", "Société de gestion"), esc(e.gestionnaire)],
      [terme("domicile", "Domiciliation"), esc(PAYS[e.pays] || e.pays || "n.d.")],
      [`Devise${part ? " de la part" : ""}`, esc((part && part.parRefDevCode) || e.devise || "n.d.")],
      e.nature && ["Forme juridique", esc(e.nature)],
      d && d.encours ? [terme("encours", "Encours"), `${d.encours.montant.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} M€ <small>au ${dateFr(d.encours.date)}${d.encours.horsEuro ? ", parts en euros uniquement" : ""}</small>`]
        : e.source === "G" && [terme("encours", "Encours"), chargement ? "chargement…" : "non disponible"],
      e.dateCreation && [e.source === "N" ? "Commercialisé en France depuis" : "Création", dateFr(e.dateCreation)],
      d && d.parts && d.parts.length > 1 && [terme("part", "Parts du fonds"), `${d.parts.length} parts (voir section 6)`],
      e.classification && [terme("classification_amf", "Classification AMF"), `${esc(e.classification)}${CLASSIFICATIONS[e.classification] ? `<br><small>${esc(CLASSIFICATIONS[e.classification])}</small>` : ""}`, true]
    ])}
    ${e.source === "G" ? `<p class="aide"><a href="${LIENS.geco(e)}" target="_blank" rel="noopener">Voir la fiche officielle sur GECO (AMF)</a></p>` : ""}
    ${source(srcAnnuaire)}
  </section>`;

  // ----- 2 et 3. Composition calculée par nos deux moteurs (voir composition.js) -----
  const sectionRepartition = sectionRepartitionAuto(e, isin, d, dic, docsHtml, srcDic, chargement);
  const sectionConcentration = sectionConcentrationAuto(e, d, chargement);

  // ----- 4. Risque -----
  let sectionRisque;
  if (e.source !== "G") {
    sectionRisque = `<section class="carte"><h2>4. Risque</h2>
      ${nonDispo("L'indicateur SRI, la volatilité et la perte maximale ne sont pas disponibles gratuitement pour ce fonds de droit étranger. Consulte son DIC sur le site de la société de gestion.")}
      ${nomIdx.levier ? `<p class="resume">Produit à levier ou inversé : réservé à des investisseurs très avertis, sur de courtes durées.</p>` : ""}</section>`;
  } else if (chargement) {
    sectionRisque = `<section class="carte"><h2>4. Risque</h2><p class="chargement">Calcul à partir de l'historique des valeurs liquidatives…</p></section>`;
  } else {
    const s = d.stats;
    const sri = dic && dic.sri;
    const duree = dic && dic.duree;
    const profil = sri ? `Ce fonds est adapté à un profil ${PROFILS_SRI[sri]}${s && s.maxDrawdown.valeur < -1 ? `, prêt à voir son placement baisser temporairement d'environ ${pct(Math.abs(s.maxDrawdown.valeur), 0)}` : ""}${duree ? ` et à rester investi au moins ${duree}` : ""}.` : null;
    const deviseEtr = part && part.parRefDevCode && part.parRefDevCode !== "EUR";
    const compo = d.composition && d.composition.c && d.composition.c.principale ? d.composition.c : null;
    const horsEuroCalc = compo && compo.devises && compo.devises.length ? compo.devises.filter(x => x.nom !== "EUR").reduce((t, x) => t + x.poids, 0) : null;
    const change = deviseEtr ? { niveau: "élevé", texte: `Part libellée en ${part.parRefDevCode}.` }
      : compo && compo.couvertureChange ? { niveau: "faible", texte: "Couverture de change détectée (part « hedged », contrats de change à terme ou analyse des rendements)." }
      : horsEuroCalc !== null ? { niveau: horsEuroCalc < 10 ? "faible" : horsEuroCalc < 50 ? "moyen" : "élevé", texte: `${pct(horsEuroCalc, 0)} des actifs en devises hors euro, d'après notre analyse de la composition.` }
      : nomIdx.couvert || /hedged/i.test(part && part.parNom || "") ? { niveau: "faible", texte: "Part couverte contre le risque de change." }
      : nomIdx.usa ? { niveau: "élevé", texte: "D'après le nom, le fonds suit des actions américaines en dollars, sans couverture de change." }
      : nomIdx.horsEurope ? { niveau: "élevé", texte: "D'après le nom, le fonds est exposé à des devises hors euro, sans couverture de change." }
      : /internationa|mixte/i.test(e.classification) ? { niveau: "moyen", texte: "Probable : le fonds peut investir hors zone euro (composition non disponible)." }
      : /euro|françaises|monétaire/i.test(e.classification) ? { niveau: "faible", texte: "Fonds investi principalement en euros (d'après sa classification)." }
      : { niveau: "non déterminé", texte: "Composition non disponible." };
    const liquidite = s ? (s.frequence === "quotidienne" ? { niveau: "faible", texte: "Valeur calculée chaque jour." } : { niveau: "élevé", texte: `Valeur calculée de façon ${s.frequence}.` })
      : { niveau: "non déterminé", texte: "Historique non disponible." };
    const credit = /Obligations|obligations|monétaire/.test(e.classification) ? { niveau: "moyen", texte: "Fonds obligataire ou monétaire : dépend de la qualité des emprunteurs." }
      : /mixte/i.test(e.classification) ? { niveau: "moyen", texte: "Partie obligataire probable." }
      : /Actions/.test(e.classification) ? { niveau: "non concerné", texte: "Fonds principalement investi en actions." }
      : { niveau: "non déterminé", texte: "" };
    const ligne = (cle, lib, x) => `<div><dt>${terme(cle, lib)}</dt><dd><span class="niveau niveau-${normaliser(x.niveau).replace(/\s/g, "-")}">${esc(x.niveau)}</span> ${esc(x.texte)}</dd></div>`;
    sectionRisque = `
    <section class="carte">
      <h2>4. Risque</h2>
      ${profil ? `<p class="resume">${esc(profil)}</p>` : ""}
      ${sri ? `<h3>Indicateur de risque ${terme("sri", "SRI")} : ${sri}/7</h3>${echelleSri(sri)}` : nonDispo(dic ? "SRI non lisible dans le DIC (il est probablement affiché sous forme d'image)." : "SRI non disponible : aucun DIC n'est publié dans GECO pour ce fonds.")}
      ${s ? listeInfos([
        [terme("volatilite", "Volatilité") + " 1 an", pct(s.volatilite.a1)],
        [terme("volatilite", "Volatilité") + " 3 ans", pct(s.volatilite.a3)],
        [terme("volatilite", "Volatilité") + " 5 ans", pct(s.volatilite.a5)],
        [terme("max_drawdown", "Perte maximale"), `${pct(s.maxDrawdown.valeur)} <small>(${esc(s.maxDrawdown.periode)})</small>`],
        [terme("performance_annualisee", "Perf. annualisée") + " 1 an", pct(s.perf.a1)],
        [terme("performance_annualisee", "Perf. annualisée") + " 3 ans", pct(s.perf.a3)],
        [terme("performance_annualisee", "Perf. annualisée") + " 5 ans", pct(s.perf.a5)],
        [terme("performance_annualisee", "Perf. annualisée") + " 10 ans", pct(s.perf.a10)],
        duree && [terme("duree_recommandee", "Durée conseillée"), esc(duree)]
      ]) : nonDispo("Historique des valeurs liquidatives non disponible dans GECO.")}
      ${s && s.frequence !== "quotidienne" && s.frequence !== "hebdomadaire" ? `<p class="note">Valeur calculée de façon ${s.frequence} : la volatilité n'est pas calculée car elle ne serait pas significative.</p>` : ""}
      ${graphiqueVL(d.historique)}
      ${d.historique ? `<p class="aide"><a href="performances.html#${esc(cleEntree(e, isin))}">Ouvrir le graphique interactif (périodes, comparaisons, performances par année) →</a></p>` : ""}
      <p class="note">Performances calculées sur la ${terme("valeur_liquidative", "valeur liquidative")}, frais de gestion déduits. Pour une part distribuante, les revenus versés ne sont pas inclus. Les performances passées ne préjugent pas des performances futures.</p>
      <dl class="grille-risques">
        ${ligne("risque_change", "Risque de change", change)}
        ${ligne("risque_liquidite", "Risque de liquidité", liquidite)}
        ${ligne("risque_credit", "Risque de crédit", credit)}
      </dl>
      ${source(srcGeco)}${srcDic ? source(srcDic) : ""}
    </section>`;
  }

  // ----- 5. Pièges -----
  let sectionPiegesHtml;
  if (chargement) sectionPiegesHtml = `<section class="carte carte-pieges"><h2>5. Conditions particulières et pièges</h2><p class="chargement">Analyse en cours…</p></section>`;
  else {
    const pieges = detecterPiegesAuto(e, d);
    const importants = pieges.filter(p => p.niveau !== "info"), infos = pieges.filter(p => p.niveau === "info");
    const rendu = p => `<li class="alerte alerte-${p.niveau}">${pastille(p.niveau)}<div><strong>${terme(p.terme, p.titre)}</strong>${p.texte ? `<p>${esc(p.texte)}</p>` : ""}</div></li>`;
    const frais = dic ? listeInfos([
      [terme("frais_courants", "Frais de gestion"), dic.gestion !== null && dic.gestion !== undefined ? pct(dic.gestion, 2) + " / an" : "non lu"],
      [terme("frais_transaction", "Frais de transaction"), dic.transaction !== null && dic.transaction !== undefined ? pct(dic.transaction, 2) + " / an" : "non lu"],
      [terme("frais_entree", "Droits d'entrée"), dic.entree === 0 ? "aucun" : dic.entree ? "jusqu'à " + pct(dic.entree) : "non lu"],
      [terme("frais_sortie", "Frais de sortie"), dic.sortie === 0 ? "aucun" : dic.sortie ? "jusqu'à " + pct(dic.sortie) : "non lu"],
      [terme("surperformance", "Surperformance"), dic.performance ? "oui" : "aucune détectée"]
    ]) : nonDispo(e.source === "G" ? "Frais non disponibles : aucun DIC publié dans GECO pour ce fonds." : "Frais non disponibles automatiquement pour ce fonds étranger : consulte son DIC.");
    const analyseLimitee = !dic ? `<p class="note">Analyse limitée : sans DIC, les pièges liés aux frais, à la structure (fonds nourricier, fonds de fonds) et au levier ne peuvent pas être vérifiés.</p>` : "";
    sectionPiegesHtml = `
    <section class="carte carte-pieges">
      <h2>5. Conditions particulières et pièges</h2>
      ${importants.length ? `<ul class="liste-alertes">${importants.map(rendu).join("")}</ul>`
        : `<p class="rien">✓ Rien de particulier détecté${dic ? "" : " dans les informations disponibles"}.</p>`}
      ${analyseLimitee}
      <h3>Frais${dic ? " (lus dans le DIC)" : ""}</h3>
      ${frais}
      ${infos.length ? `<ul class="liste-alertes liste-infos">${infos.map(rendu).join("")}</ul>` : ""}
      ${srcDic ? source(srcDic) : ""}
    </section>`;
  }

  // ----- 6. Comparaison : autres parts du même fonds -----
  let comparaison = nonDispo("La comparaison automatique avec des fonds similaires n'est pas encore disponible pour les fiches automatiques.");
  if (d && d.parts && d.parts.length > 1) {
    comparaison = `<p>Ce fonds existe en <strong>${d.parts.length} parts</strong>. Elles ont le même portefeuille, mais des frais, des devises ou des montants minimums différents. Une autre part est parfois moins chère ou accessible dans ton contrat.</p>
      <ul class="similaires">${d.parts.map(pa => `<li>${pa.isin === (part && part.isin) ? "<strong>" : `<a href="#${esc(pa.isin)}">`}${esc(pa.parNom)} — ${esc(pa.isin)}${pa.isin === (part && part.isin) ? " (cette part)</strong>" : "</a>"}
        <small>${esc(pa.parRefDevCode || "")} ${pa.parAffctnRevnuLib ? "· " + esc(pa.parAffctnRevnuLib) : ""} ${pa.parStatutCode && pa.parStatutCode !== "VIV" ? "· fermée" : ""}</small></li>`).join("")}</ul>` + comparaison;
  }
  const sectionComparaison = `<section class="carte"><h2>6. Comparaison</h2>${comparaison}</section>`;

  const erreurs = d && d.erreurs && d.erreurs.length ? `<p class="aide">Informations manquantes : ${esc(d.erreurs.join(" ; "))}.</p>` : "";

  return `<article class="fiche">${entete}${identite}${sectionRepartition}${sectionConcentration}${sectionRisque}${sectionPiegesHtml}${sectionComparaison}${erreurs}
    <p class="rappel-legal">Information pédagogique, pas un conseil en investissement. Vérifie le DIC officiel avant toute décision.</p></article>`;
}

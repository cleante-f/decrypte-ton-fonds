/*
 * Données en direct depuis la base GECO de l'AMF (fonds de droit français).
 * Le navigateur interroge directement l'API publique de GECO (elle autorise les appels depuis n'importe quel site).
 *
 * Ce qu'on en tire automatiquement :
 *   - les parts du fonds (ISIN, devise, capitalisation/distribution)
 *   - l'historique des valeurs liquidatives (10 ans) → performance, volatilité, perte maximale, fréquence de cotation
 *   - l'encours (taille du fonds)
 *   - les documents officiels (DIC, prospectus, rapports) → le DIC est lu pour extraire SRI, frais, durée, objectif
 */
const GECO_API = "https://geco.amf-france.org/back-office";
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

// ---------- Annuaire (data/annuaire.js) ----------

// Transforme une ligne compacte de l'annuaire en objet lisible
function lireEntree(l) {
  return {
    source: l[0], cmpId: l[1], prdId: l[2], nom: l[3], gestionnaire: l[4], classification: l[5], nature: l[6],
    isins: l[7] ? l[7].split(" ") : [], dateCreation: l[8], pays: l[9], tickers: l[10] ? l[10].split(" ") : [],
    marches: l[11], devise: l[12], etf: l[13] === 1, public: l[14] === 1
  };
}

let _indexAnnuaire = null;
function indexAnnuaire() {
  if (_indexAnnuaire) return _indexAnnuaire;
  const parIsin = new Map(), parTicker = new Map(), noms = [];
  ANNUAIRE.forEach((l, i) => {
    for (const isin of (l[7] ? l[7].split(" ") : [])) parIsin.set(isin, i);
    for (const t of (l[10] ? l[10].split(" ") : [])) if (!parTicker.has(t)) parTicker.set(t, i);
    noms.push(normaliser(l[3] + " " + l[4]));
  });
  _indexAnnuaire = { parIsin, parTicker, noms };
  return _indexAnnuaire;
}

function annuaireParIsin(isin) {
  const i = indexAnnuaire().parIsin.get(isin);
  return i === undefined ? null : lireEntree(ANNUAIRE[i]);
}

function annuaireParCle(cle) { // "N12345" pour les fonds étrangers sans ISIN
  const l = ANNUAIRE.find(l => l[0] === cle[0] && l[1] === Number(cle.slice(1)));
  return l ? lireEntree(l) : null;
}

function rechercherAnnuaire(requete, max = 50) {
  const idx = indexAnnuaire();
  const code = requete.replace(/\s/g, "").toUpperCase();
  if (idx.parIsin.has(code)) return [lireEntree(ANNUAIRE[idx.parIsin.get(code)])];
  if (idx.parTicker.has(code)) return [lireEntree(ANNUAIRE[idx.parTicker.get(code)])];
  const mots = normaliser(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return [];
  const trouves = [];
  idx.noms.forEach((nom, i) => { if (mots.every(m => nom.includes(m))) trouves.push(lireEntree(ANNUAIRE[i])); });
  // Priorité : fonds ouverts à tous avec ISIN, puis ETF, puis le reste
  const rang = e => (e.isins.length ? 0 : 2) + (e.public ? 0 : 1);
  return trouves.sort((a, b) => rang(a) - rang(b)).slice(0, max);
}

// Clé utilisée dans l'adresse de la page (#...)
function cleEntree(e, isin) {
  return isin || e.isins[0] || e.source + e.cmpId;
}

// ---------- Appels GECO ----------

// ---------- Historique des valeurs liquidatives : lecture et nettoyage ----------

// Les valeurs publiées ne sont pas ajustées des divisions de parts (ex. une part de 8 730 € devient 10 parts de 873 €).
// Sans correction, le graphique montrerait une chute de -90 % qui n'a jamais existé.
const FACTEURS_DIVISION = [...Array(19)].map((_, i) => i + 2).concat([25, 40, 50, 100, 200, 500, 1000]);

function historiqueDepuisGeco(h) {
  const dates = (h.x || []).map(d => { const [j, m, a] = d.split("-"); return new Date(`${a}-${m}-${j}T00:00:00`); });
  let valeurs = (h.y || []).slice();
  const corrections = [];
  // 1. pics isolés : un point qui s'écarte de plus de 20 % de ses deux voisins, qui eux sont cohérents
  for (let i = 1; i < valeurs.length - 1; i++) {
    const a = valeurs[i - 1], b = valeurs[i], c = valeurs[i + 1];
    if (a > 0 && c > 0 && Math.abs(c / a - 1) < 0.1 && (Math.abs(b / a - 1) > 0.2 && Math.abs(b / c - 1) > 0.2)) {
      valeurs[i] = (a + c) / 2;
      corrections.push({ date: dates[i], type: "point aberrant" });
    }
  }
  // 2. divisions (ou regroupements) de parts : variation d'un jour égale, à 2 % près, à un facteur rond
  for (let i = 1; i < valeurs.length; i++) {
    const r = valeurs[i] / valeurs[i - 1];
    if (!(r < 0.6 || r > 1.6)) continue;
    const f = r < 1 ? 1 / r : r;
    const rond = FACTEURS_DIVISION.find(x => Math.abs(f / x - 1) < 0.015);
    if (!rond) continue;
    // un vrai -50 % reste possible entre deux valorisations espacées (fonds non cotés) : petits facteurs sur 7 jours au plus
    if (rond < 10 && (dates[i] - dates[i - 1]) / 864e5 > 7) continue;
    const ajust = r < 1 ? 1 / rond : rond;
    for (let k = 0; k < i; k++) valeurs[k] *= ajust;
    corrections.push({ date: dates[i], type: r < 1 ? `division par ${rond}` : `regroupement par ${rond}` });
  }
  return { dates, valeurs, corrections };
}

// Pas plus de 4 requêtes simultanées vers GECO (le serveur de l'AMF limite les rafales), et une seconde tentative si besoin
let _requetesEnCours = 0;
const _fileAttente = [];
async function limiter(fn) {
  while (_requetesEnCours >= 4) await new Promise(ok => _fileAttente.push(ok));
  _requetesEnCours++;
  try { return await fn(); } finally { _requetesEnCours--; const suivant = _fileAttente.shift(); if (suivant) suivant(); }
}

async function gecoFetch(url) {
  return limiter(async () => {
    for (let essai = 0; ; essai++) {
      const r = await fetch(url);
      if (r.ok) return r;
      // 418 : c'est le code que la base GECO renvoie pendant ses opérations de maintenance
      if (r.status === 418) throw new Error("la base GECO de l'AMF est momentanément en maintenance, réessaie un peu plus tard");
      if (essai >= 1 || ![429, 502, 503].includes(r.status)) throw new Error(`GECO a répondu ${r.status}`);
      await new Promise(ok => setTimeout(ok, 2500));
    }
  });
}

async function gecoJson(chemin) {
  return (await gecoFetch(GECO_API + chemin)).json();
}

function dateIso(d) { return d.toISOString().slice(0, 10); }
function ilYa(annees) { const d = new Date(); d.setFullYear(d.getFullYear() - annees); return d; }

async function chargerDonneesGeco(entree, isinDemande) {
  const res = { erreurs: [] };
  const parts = await gecoJson(`/funds/compartment/c${entree.cmpId}/shares`);
  res.parts = parts;
  res.part = parts.find(p => p.isin === isinDemande) || parts.find(p => p.isin === entree.isins[0]) || parts[0];
  if (!res.part) throw new Error("Aucune part trouvée dans GECO");

  // Historique, encours et documents en parallèle
  const [histo, encours, documents] = await Promise.allSettled([
    gecoJson(`/funds/chart/${res.part.idInterne}?startDate=${dateIso(ilYa(10))}`),
    chargerEncours(parts),
    gecoJson(`/document/byCompartAndProduct?compartCode=c${entree.cmpId}&prdCode=p${entree.prdId}`)
  ]);
  if (histo.status === "fulfilled" && histo.value.x && histo.value.x.length > 1) {
    res.historique = historiqueDepuisGeco(histo.value);
    res.stats = statistiques(res.historique);
  } else res.erreurs.push("historique des valeurs liquidatives indisponible");
  if (encours.status === "fulfilled") res.encours = encours.value;

  const docsPart = (res.part.documentEsEntities || []);
  res.documents = docsPart.concat(documents.status === "fulfilled" ? documents.value : [])
    .sort((a, b) => (b.dateEffet || "").localeCompare(a.dateEffet || ""));

  // Lecture du DIC : celui de la part, sinon celui du fonds, sinon celui d'une autre part (signalé)
  const estDic = d => /DIC|KID/i.test(d.docTypeLib + " " + d.docName);
  let dic = docsPart.find(estDic), autrePart = null;
  if (!dic) dic = (documents.status === "fulfilled" ? documents.value : []).find(estDic);
  if (!dic) {
    autrePart = parts.find(p => (p.documentEsEntities || []).some(estDic));
    if (autrePart) dic = autrePart.documentEsEntities.find(estDic);
  }
  if (dic) {
    try {
      res.dic = extraireDic(await texteDuPdf(`${GECO_API}/document/download/${dic.idInterne}`));
      res.dic.document = dic;
      res.dic.autrePart = autrePart ? `${autrePart.parNom} (${autrePart.isin})` : null;
    } catch (e) { res.erreurs.push("lecture du DIC impossible (" + e.message + ")"); }
  } else res.erreurs.push("aucun DIC publié dans GECO pour ce fonds");
  return res;
}

// Historique (4 ans) et documents d'un fonds de l'annuaire, sans lire son DIC (utilisé pour les fonds « jumeaux »)
async function chargerHistoriqueEtDocuments(entree) {
  const parts = await gecoJson(`/funds/compartment/c${entree.cmpId}/shares`);
  const part = parts.find(p => p.isin === entree.isins[0]) || parts[0];
  const [h, docs] = await Promise.all([
    gecoJson(`/funds/chart/${part.idInterne}?startDate=${dateIso(ilYa(4))}`),
    gecoJson(`/document/byCompartAndProduct?compartCode=c${entree.cmpId}&prdCode=p${entree.prdId}`).catch(() => [])
  ]);
  if (!h.x || h.x.length < 60) return null;
  const historique = historiqueDepuisGeco(h);
  return { historique, documents: docs, part };
}

// Encours = somme des dernières valeurs de chaque part en euros (GECO les donne en milliers)
async function chargerEncours(parts) {
  const debut = dateIso(new Date(Date.now() - 30 * 864e5));
  const partsEur = parts.filter(p => p.parStatutCode === "VIV").slice(0, 15);
  const reponses = await Promise.all(partsEur.map(p =>
    gecoJson(`/funds/vlsCouponsAndOst/${p.parId}?startDate=${debut}&endDate=${dateIso(new Date())}`).catch(() => null)));
  let total = 0, date = null, horsEuro = false;
  for (const r of reponses) {
    const vl = r && r.netAssetValueDTO && r.netAssetValueDTO[r.netAssetValueDTO.length - 1];
    if (!vl) continue;
    if (vl.quotationCurrency !== "EUR") { horsEuro = true; continue; }
    total += (vl.assetUnderManagementK || vl.assetUnderManagement || 0) / 1000; // → M€
    if (!date || vl.valuationDate > date) date = vl.valuationDate;
  }
  return total > 0 ? { montant: total, date, horsEuro } : null;
}

// ---------- Calculs à partir de l'historique ----------

function statistiques(h) {
  const n = h.valeurs.length;
  const fin = h.dates[n - 1];
  const debutFenetre = annees => new Date(fin.getTime() - annees * 365.25 * 864e5);

  // Fréquence de cotation (écart médian entre deux valeurs)
  const ecarts = [];
  for (let i = Math.max(1, n - 60); i < n; i++) ecarts.push((h.dates[i] - h.dates[i - 1]) / 864e5);
  ecarts.sort((a, b) => a - b);
  const median = ecarts[Math.floor(ecarts.length / 2)] || 1;
  const frequence = median <= 3 ? "quotidienne" : median <= 8 ? "hebdomadaire" : median <= 17 ? "bimensuelle" : "mensuelle";
  const parAn = { quotidienne: 252, hebdomadaire: 52, bimensuelle: 24, mensuelle: 12 }[frequence];

  function fenetre(annees) {
    const debut = debutFenetre(annees);
    const i0 = h.dates.findIndex(d => d >= debut);
    if (i0 < 0 || (h.dates[i0] - debut) / 864e5 > 20) return null; // historique trop court
    return i0;
  }
  function volatilite(annees) {
    // Avec moins d'une valeur par semaine, la volatilité n'est pas significative
    if (parAn < 52) return null;
    const i0 = fenetre(annees);
    if (i0 === null) return null;
    const r = [];
    for (let i = i0 + 1; i < n; i++) r.push(Math.log(h.valeurs[i] / h.valeurs[i - 1]));
    const moy = r.reduce((s, x) => s + x, 0) / r.length;
    const variance = r.reduce((s, x) => s + (x - moy) ** 2, 0) / (r.length - 1);
    return Math.sqrt(variance * parAn) * 100;
  }
  function perfAnnualisee(annees) {
    const i0 = fenetre(annees);
    if (i0 === null) return null;
    const duree = (fin - h.dates[i0]) / (365.25 * 864e5);
    return (Math.pow(h.valeurs[n - 1] / h.valeurs[i0], 1 / duree) - 1) * 100;
  }
  // Perte maximale sur tout l'historique disponible
  let sommet = h.valeurs[0], iSommet = 0, pire = 0, iPireSommet = 0, iPireCreux = 0;
  for (let i = 1; i < n; i++) {
    if (h.valeurs[i] > sommet) { sommet = h.valeurs[i]; iSommet = i; }
    const baisse = h.valeurs[i] / sommet - 1;
    if (baisse < pire) { pire = baisse; iPireSommet = iSommet; iPireCreux = i; }
  }
  const moisAn = d => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return {
    frequence,
    volatilite: { a1: volatilite(1), a3: volatilite(3), a5: volatilite(5) },
    perf: { a1: perfAnnualisee(1), a3: perfAnnualisee(3), a5: perfAnnualisee(5), a10: perfAnnualisee(10) },
    maxDrawdown: { valeur: pire * 100, periode: `${moisAn(h.dates[iPireSommet])} → ${moisAn(h.dates[iPireCreux])}` },
    depuis: h.dates[0], jusqua: fin, derniereVL: h.valeurs[n - 1]
  };
}

// ---------- Lecture du DIC (PDF) ----------

let _pdfjs = null;
function chargerPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = PDFJS + "pdf.min.js";
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(pdfjsLib); };
    s.onerror = () => ko(new Error("pdf.js non chargé"));
    document.head.appendChild(s);
  });
  return _pdfjs;
}

async function texteDuPdf(url) {
  const lib = await chargerPdfJs();
  const donnees = await (await gecoFetch(url)).arrayBuffer();
  const pdf = await lib.getDocument({ data: donnees }).promise;
  let texte = "";
  for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
    const contenu = await (await pdf.getPage(p)).getTextContent();
    texte += contenu.items.map(i => i.str).join(" ") + "\n";
  }
  return texte;
}

function nombreFr(s) { return s === undefined ? null : parseFloat(s.replace(",", ".")); }

// Les DIC PRIIPs suivent un modèle réglementaire : on cherche les formulations standard (et leurs variantes)
function extraireDic(brut) {
  const t = brut.normalize("NFC").replace(/[  ]/g, " ").replace(/[’`]/g, "'").replace(/\s+/g, " ");
  const chercher = (...res) => { for (const re of res) { const m = t.match(re); if (m) return m[1]; } return undefined; };
  const pctApres = (...libelles) => {
    // premier pourcentage dans les 250 caractères qui suivent le libellé
    for (const libelle of libelles) {
      const m = t.match(new RegExp(libelle + "[^%]{0,250}?(\\d{1,2}(?:[.,]\\d{1,3})?)\\s?%", "i"));
      if (m) return nombreFr(m[1]);
    }
    return null;
  };
  const r = { texte: t };
  r.sri = nombreFr(chercher(/classe de risque\s*(\d)\s*sur\s*7/i, /risque\s*(\d)\s*sur\s*7/i, /\b([1-7])\s*sur\s*7\b/i));
  r.duree = chercher(
    /p[ée]riode de d[ée]tention recommand[ée]e(?:\s*\(RHP\))?\s*:?\s*(\d+\s*ans?|\d+\s*mois|\d+\s*jours?)/i,
    /(?:dur[ée]e|horizon) (?:de placement |d'investissement )?(?:minimum |minimale )?recommand[ée]e?\s*(?:est )?(?:de |:)?\s*(\d+\s*ans?)/i,
    /(?:dur[ée]e|horizon) de placement recommand[ée]e?\s*(?:est )?(?:sup[ée]rieure? [àa] |de |:)?\s*(\d+\s*ans?)/i,
    /(?:dur[ée]e|horizon) de placement recommand[ée]e?\s*\((?:au )?minimum\s*(?:de )?(\d+\s*ans?)\)/i);
  r.entree = /(pas de|aucun|ne facturons pas de) (frais|co[uû]ts?) d'entr[ée]e/i.test(t) ? 0 : pctApres("Co[uû]ts d'entr[ée]e");
  r.sortie = /(pas de|aucun|ne facturons pas de) (frais|co[uû]ts?) de sortie/i.test(t) ? 0 : pctApres("Co[uû]ts de sortie");
  r.gestion = pctApres("Frais de gestion et autres (?:frais|co[uû]ts) administratifs(?: et d'exploitation)?", "Autres co[uû]ts r[ée]currents", "Frais de gestion");
  r.transaction = pctApres("Co[uû]ts de transaction");

  // Commission de surperformance : le DIC donne souvent un taux de partage (« 20 % de la surperformance »),
  // pas un coût annuel. On garde donc la description telle quelle.
  const perf = t.match(/(?:Commissions? li[ée]es? aux r[ée]sultats|Commissions? de (?:sur)?performance)(?: et commission d'int[ée]ressement)?\s*(.{0,300}?)(?=\s?(?:Le montant r[ée]el|L'estimation|L'impact|Co[uû]ts accessoires|Sc[ée]narios)|$)/i);
  const sansPerf = /(aucune|pas de) commission (li[ée]e aux r[ée]sultats|de (sur)?performance)/i;
  r.performance = !perf || sansPerf.test(t) || /^(aucune|n[ée]ant|pas de|0(?:[.,]0+)?\s?%)/i.test(perf[1].trim()) ? null : perf[1].trim();

  // Objectif : dans la section « En quoi consiste ce produit ? »
  const iSection = t.search(/En quoi consiste ce produit\s?\?/i);
  const suite = iSection >= 0 ? t.slice(iSection) : t;
  const iObj = suite.search(/Objectifs?\s*(?:et politique d'investissement)?\s*:?/i);
  if (iObj >= 0) {
    let texte = suite.slice(iObj).replace(/^Objectifs?\s*(?:et politique d'investissement)?\s*:?\s*/i, "");
    const fin = texte.search(/\s(?:Investisseurs? (?:de d[ée]tail )?vis[ée]s?|INVESTISSEURS|Quels sont les risques|QUELS SONT LES RISQUES|Informations pratiques|D[ée]positaire\s*:)/i);
    if (fin > 0) texte = texte.slice(0, fin);
    if (texte.length > 700) texte = texte.slice(0, 700).replace(/\s\S*$/, "") + "…";
    if (texte.length > 40) r.objectif = texte.trim();
  }
  r.nourricier = /\bnourricier\b|\bfeeder\b|\bfonds ma[iî]tre\b|\bOPCVM ma[iî]tre\b/i.test(t);
  const maitre = t.match(/(?:nourricier|feeder)\s+(?:de\s+l'|du\s+|de\s+la\s+)?(?:OPCVM|FIA|fonds|compartiment|part)?\s*(?:ma[iî]tre\s+)?[«"]?\s*([A-Z][^»",;.()]{3,80})/);
  r.maitre = maitre ? maitre[1].trim() : null;
  r.synthetique = /r[ée]plication (synth[ée]tique|indirecte)|contrat d'[ée]change|\bswap\b/i.test(t);
  r.levier = /effet de levier (maximum|maximal|jusqu)/i.test(t);
  r.fondsDeFonds = /(plus de|jusqu'à|au-delà de) (50|75|90|100)\s?% (de (son|l')actif )?(net )?(en|dans des?) (parts ou actions d')?(OPC|OPCVM|fonds)/i.test(t);
  return r;
}

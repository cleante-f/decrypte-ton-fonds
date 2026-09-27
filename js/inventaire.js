/*
 * MOTEUR 1 — Lecture de l'inventaire du portefeuille
 *
 * Les fonds français publient dans leur rapport annuel (ou semestriel) la liste complète de leurs positions :
 * c'est une obligation comptable. Ces rapports sont déposés dans GECO. On lit le PDF et on reconstitue
 * nous-mêmes le portefeuille ligne par ligne, puis on calcule les répartitions.
 *
 * Aucun chiffre n'est repris d'une analyse toute faite : on part des positions brutes (nom, devise, montant, % de l'actif net).
 *
 * Formats gérés :
 *  - nouveau format réglementaire (exercices ouverts depuis 2024) : positions regroupées par secteur (ICB) avec sous-totaux,
 *    + tableaux « exposition directe … ventilation par pays »
 *  - anciens formats : positions regroupées par pays (« TOTAL ALLEMAGNE ») et/ou avec le code ISIN de chaque ligne
 */

const DEVISES_ISO = new Set(("EUR USD GBP CHF JPY SEK NOK DKK CAD AUD HKD CNY CNH SGD KRW TWD INR BRL MXN ZAR PLN CZK HUF " +
  "TRY ILS NZD IDR THB MYR PHP SAR AED CLP COP PEN KWD QAR RUB RON ISK").split(" "));

// Pays : noms tels qu'écrits dans les rapports (en majuscules sans accents) → code ISO
const PAYS_NOMS = {
  "ALLEMAGNE": "DE", "AUTRICHE": "AT", "BELGIQUE": "BE", "ESPAGNE": "ES", "FINLANDE": "FI", "FRANCE": "FR", "GRECE": "GR",
  "IRLANDE": "IE", "ITALIE": "IT", "LUXEMBOURG": "LU", "PAYS-BAS": "NL", "PAYS BAS": "NL", "PORTUGAL": "PT", "ROYAUME-UNI": "GB",
  "ROYAUME UNI": "GB", "SUISSE": "CH", "SUEDE": "SE", "NORVEGE": "NO", "DANEMARK": "DK", "ETATS-UNIS": "US", "ETATS UNIS": "US",
  "ETATS-UNIS D'AMERIQUE": "US", "CANADA": "CA", "JAPON": "JP", "CHINE": "CN", "HONG KONG": "HK", "HONG-KONG": "HK", "TAIWAN": "TW",
  "COREE DU SUD": "KR", "COREE": "KR", "INDE": "IN", "BRESIL": "BR", "MEXIQUE": "MX", "AUSTRALIE": "AU", "SINGAPOUR": "SG",
  "AFRIQUE DU SUD": "ZA", "POLOGNE": "PL", "ISRAEL": "IL", "JERSEY": "JE", "GUERNESEY": "GG", "BERMUDES": "BM", "ILES CAIMANS": "KY",
  "ILES CAYMANS": "KY", "CAIMANES": "KY", "CURACAO": "CW", "ISLE OF MAN": "IM", "ILE DE MAN": "IM", "SLOVENIE": "SI", "SLOVAQUIE": "SK",
  "ESTONIE": "EE", "LETTONIE": "LV", "LITUANIE": "LT", "CHYPRE": "CY", "MALTE": "MT", "HONGRIE": "HU", "REPUBLIQUE TCHEQUE": "CZ",
  "ROUMANIE": "RO", "CROATIE": "HR", "BULGARIE": "BG", "ISLANDE": "IS", "NOUVELLE-ZELANDE": "NZ", "INDONESIE": "ID", "THAILANDE": "TH",
  "MALAISIE": "MY", "PHILIPPINES": "PH", "CHILI": "CL", "COLOMBIE": "CO", "PEROU": "PE", "ARABIE SAOUDITE": "SA", "EMIRATS ARABES UNIS": "AE",
  "QATAR": "QA", "KOWEIT": "KW", "TURQUIE": "TR", "SUPRANATIONAL": "XS", "SUPRANATIONAUX": "XS", "SUPRANATIONAUX": "XS"
};
function codePays(texte) {
  const t = normaliser(String(texte).replace(/[\u2010-\u2015]/g, "-").replace(/\+\/-/g, "")).toUpperCase().trim();
  return PAYS_NOMS[t] || null;
}

const NOMS_PAYS = {
  DE: "Allemagne", AT: "Autriche", BE: "Belgique", ES: "Espagne", FI: "Finlande", FR: "France", GR: "Grèce", IE: "Irlande", IT: "Italie",
  LU: "Luxembourg", NL: "Pays-Bas", PT: "Portugal", GB: "Royaume-Uni", CH: "Suisse", SE: "Suède", NO: "Norvège", DK: "Danemark",
  US: "États-Unis", CA: "Canada", JP: "Japon", CN: "Chine", HK: "Hong Kong", TW: "Taïwan", KR: "Corée du Sud", IN: "Inde", BR: "Brésil",
  MX: "Mexique", AU: "Australie", SG: "Singapour", ZA: "Afrique du Sud", PL: "Pologne", IL: "Israël", JE: "Jersey", GG: "Guernesey",
  BM: "Bermudes", KY: "Îles Caïmans", CW: "Curaçao", IM: "Île de Man", SI: "Slovénie", SK: "Slovaquie", EE: "Estonie", LV: "Lettonie",
  LT: "Lituanie", CY: "Chypre", MT: "Malte", HU: "Hongrie", CZ: "Tchéquie", RO: "Roumanie", HR: "Croatie", BG: "Bulgarie", IS: "Islande",
  NZ: "Nouvelle-Zélande", ID: "Indonésie", TH: "Thaïlande", MY: "Malaisie", PH: "Philippines", CL: "Chili", CO: "Colombie", PE: "Pérou",
  SA: "Arabie saoudite", AE: "Émirats arabes unis", QA: "Qatar", KW: "Koweït", TR: "Turquie", XS: "Supranational / international",
  VG: "Îles Vierges", PA: "Panama", UY: "Uruguay", AR: "Argentine"
};
const ZONE_PAR_PAYS = code => {
  if (["US", "CA", "BM"].includes(code)) return "Amérique du Nord";
  if (["DE", "AT", "BE", "ES", "FI", "FR", "GR", "IE", "IT", "LU", "NL", "PT", "SI", "SK", "EE", "LV", "LT", "CY", "MT", "HR"].includes(code)) return "Zone euro";
  if (["GB", "CH", "SE", "NO", "DK", "PL", "HU", "CZ", "RO", "BG", "IS", "JE", "GG", "IM"].includes(code)) return "Europe hors zone euro";
  if (["JP", "AU", "NZ", "SG", "HK"].includes(code)) return "Asie-Pacifique développée";
  if (["CN", "TW", "KR", "IN", "BR", "MX", "ZA", "ID", "TH", "MY", "PH", "CL", "CO", "PE", "SA", "AE", "QA", "KW", "TR", "KY", "AR", "UY"].includes(code)) return "Pays émergents";
  return "Autres";
};

// Secteurs ICB détaillés (tels qu'écrits dans les inventaires) → 11 grands secteurs
const REGLES_SECTEURS = [
  [/immobili|foncier|FPI|REIT|SIIC/i, "Immobilier"],
  [/holding|fds d invest|fonds d.invest|march[ée]s de capitaux/i, "Finance"],
  [/sciences biologiques|sciences de la vie/i, "Santé"],
  [/[ée]quipements de communication/i, "Technologie"],
  [/vente par correspondance|grands magasins|biens de consommation durables|services client[èe]le|grossistes|biens de consommation/i, "Consommation discrétionnaire"],
  [/produits domestiques|produits m[ée]nagers/i, "Consommation de base"],
  [/chimi/i, "Matériaux"],
  [/services aux professionnels/i, "Industrie"],
  [/pain|p[âa]tisserie|boulang|viande|lait|laiti|[ée]levage|volaille|sucre|caf[ée]|chocolat|biscuit|conserve|p[êe]che/i, "Consommation de base"],
  [/sport|blanchisserie|services? aux personnes|coiffure|carrosserie|remorque|caravane|comm(erce)?\.? (de )?d[ée]tail|v[ée]hicules? de loisirs/i, "Consommation discrétionnaire"],
  [/moteurs?|g[ée]n[ée]ratrice|transfo|scientifiques?|[ée]tudes techniques|conseil (de gestion|pour les affaires)|nettoyage|int[ée]rim|travail temporaire/i, "Industrie"],
  [/logiciel|informatique|semi.?conduct|technolog|[ée]lectroniques?|internet|mat[ée]riel.*TI|TI\b|ordinateur|composants/i, "Technologie"],
  [/t[ée]l[ée]com/i, "Télécommunications"],
  [/banque|assurance|financ|bourse|gestion d.actifs|cr[ée]dit|investissement|placement|expert en finance|r[ée]assurance|services d.investissement/i, "Finance"],
  [/pharma|biotech|m[ée]dic|sant[ée]|soins de sant|h[ôo]pita|diagnosti/i, "Santé"],
  [/[ée]lectricit|services aux collectivit|\beau\b|distribution de gaz|multiservices|[ée]nergies? renouvelables?/i, "Services aux collectivités"],
  [/p[ée]trol|gaz|[ée]nergie|charbon|carburant|forage|oléoduc/i, "Énergie"],
  [/chimie|m[ée]taux|mines?|minier|minerai|acier|sid[ée]rurg|papier|for[êe]t|engrais|mat[ée]riaux|aluminium|or et|m[ée]taux pr[ée]cieux|cuivre/i, "Matériaux"],
  [/alimenta|boisson|brasseur|distillat|viticult|tabac|produits m[ée]nagers|soins personnels|cosm[ée]t|agricult|[ée]picerie|grossistes alimentation/i, "Consommation de base"],
  [/automobile|[ée]quipementiers auto|pneu|distribut|habillement|chaussure|v[êe]tement|loisir|h[ôo]tel|restaura|voyage|tourisme|m[ée]dia|audiovisuel|[ée]dition|divertissement|articles personnels|luxe|maison|jouet|casino|jeux|[ée]ducation|meubles|biens durables|commerce|e-commerce|publicit/i, "Consommation discrétionnaire"],
  [/a[ée]rospatial|d[ée]fense|construction|industri|transport|machine|[ée]quipements? [ée]lectriques?|ing[ée]nierie|services aux entreprises|conteneur|emballage|fret|ferroviaire|livraison|travaux|compagnies a[ée]riennes|logistique|s[ée]curit[ée]|b[âa]timent|outillage|services professionnels|conglom[ée]rat/i, "Industrie"]
];
function grandSecteur(libelle) {
  for (const [re, s] of REGLES_SECTEURS) if (re.test(libelle)) return s;
  return "Autres";
}

// Grandes classes d'actifs à partir des intitulés de rubriques (toujours en début de ligne)
function classeDeRubrique(t) {
  t = t.replace(/^[IVX]+\s*[-–.]\s*/, "").trim();
  if (/^(Titres? de cr[ée]ances? n[ée]gociables?|TCN|Instruments? du march[ée] mon[ée]taire|Certificats? de d[ée]p[ôo]t|Billets? de tr[ée]sorerie|Titres? de cr[ée]ances? .*march[ée] mon[ée]taire)/i.test(t)) return "Monétaire";
  if (/^(Titres? d.OPC|Parts? d.OPC|Actions? d.OPC|Parts? ou actions d.OPC|Autres OPC|OPC\b|OPCVM|FIA\b|Organismes? de placement|Titres? d.organismes|Parts? d.organismes)/i.test(t)) return "Fonds (OPC)";
  if (/^(Actions?\b|Titres? de capital|Valeurs? mobili[èe]res? .*actions?)/i.test(t)) return "Actions";
  if (/^(Obligations?\b|Titres? de cr[ée]ances?|Emprunts?|Obligation convertible)/i.test(t)) return "Obligations";
  return null;
}

// ---------- Outils de lecture ----------

function nombreInv(s) {
  let t = String(s).replace(/[\s\u00a0\u202f']/g, "");
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(t)) return null;
  t = t.replace(/[.,]$/, "");                       // « 3,000,000. »
  const virgule = t.lastIndexOf(","), point = t.lastIndexOf(".");
  if (virgule >= 0 && point >= 0) {                 // les deux : le dernier est le séparateur décimal
    t = virgule > point ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (virgule >= 0) {                        // seulement des virgules
    t = (t.match(/,/g).length > 1 || /,\d{3}$/.test(t) && t.replace("-", "").indexOf(",") > 3) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (point >= 0 && t.match(/\./g).length > 1) {
    t = t.replace(/\./g, "");
  }
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}
const estNombre = s => nombreInv(s) !== null && /\d/.test(s);
const estIsin = s => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s);
const estDevise = s => DEVISES_ISO.has(s);
const MOTS_STATUT = /^(PROPRE|PRET|PR[ÊE]T|EMPRUNT|GARANTIE|PENSION|NANTI|DEPOT|D[ÉE]P[ÔO]T)$/i;

// Reconstitue les lignes d'une page à partir des positions (x, y) des morceaux de texte
function lignesDePage(items) {
  const lignes = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = it.transform[5];
    let l = lignes.find(l => Math.abs(l.y - y) <= 2.5);
    if (!l) { l = { y, cellules: [] }; lignes.push(l); }
    l.cellules.push({ x: it.transform[4], fin: it.transform[4] + (it.width || 0), s: it.str, taille: Math.abs(it.transform[0]) || 8 });
  }
  lignes.sort((a, b) => b.y - a.y);
  return lignes.map(l => {
    const c = l.cellules.sort((a, b) => a.x - b.x);
    // recolle les morceaux de texte qui se touchent (ligatures « ti », « fi », mots coupés par le PDF)
    const fusion = [];
    for (const m of c) {
      const prec = fusion[fusion.length - 1];
      if (prec && m.x - prec.fin < Math.max(1.2, prec.taille * 0.18)) { prec.s += m.s; prec.fin = m.fin; }
      else fusion.push({ ...m });
    }
    return fusion.map(m => m.s.replace(/\s+/g, " ").trim()).filter(Boolean);
  });
}

// Lit les pages du PDF. `assez(pages)` est consulté régulièrement : s'il répond oui, on arrête la lecture
// (utile pour les rapports de SICAV à compartiments qui dépassent parfois 1 000 pages).
async function pagesDuPdf(url, surProgression, assez) {
  const lib = await chargerPdfJs();
  const donnees = await (await gecoFetch(url)).arrayBuffer();
  const pdf = await lib.getDocument({ data: donnees }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    pages.push(lignesDePage((await (await pdf.getPage(p)).getTextContent()).items));
    if (surProgression && p % 10 === 0) surProgression(p, pdf.numPages);
    if (assez && p % 40 === 0 && p < pdf.numPages && assez(pages)) break;
  }
  return pages;
}

// Vrai si un inventaire correspondant au fonds a été entièrement lu
function inventaireComplet(pages, nomFonds, actionsAttendues) {
  const blocs = lireInventaires(pages);
  if (!blocs.length) return false;
  const b = choisirBloc(blocs, nomFonds, actionsAttendues);
  if (!b || scoreBloc(b, nomFonds) < 0.6) return false;
  const i = blocs.indexOf(b);
  return i < blocs.length - 1 || pages.length - b.positions[b.positions.length - 1].page > 15;
}

// ---------- Analyse d'une ligne ----------

const DEVISES_NOMS = { "EURO": "EUR", "US DOLLAR": "USD", "DOLLAR US": "USD", "DOLLAR AMERICAIN": "USD", "LIVRE STERLING": "GBP",
  "FRANC SUISSE": "CHF", "YEN": "JPY", "YEN JAPONAIS": "JPY", "COURONNE SUEDOISE": "SEK", "COURONNE NORVEGIENNE": "NOK",
  "COURONNE DANOISE": "DKK", "DOLLAR CANADIEN": "CAD", "DOLLAR AUSTRALIEN": "AUD", "DOLLAR DE HONG KONG": "HKD", "DOLLAR HONG KONG": "HKD" };

function analyserLigne(cellules) {
  // découpe les cellules qui contiennent plusieurs éléments séparés par de grands espaces
  const t = cellules.flatMap(c => c.split(/\s{3,}/)).map(c => c.trim()).filter(Boolean);
  const res = { texte: [], nombres: [], devise: null, isin: null };
  for (let c of t) {
    const avecIsin = c.match(/^([A-Z]{2}[A-Z0-9]{9}\d)\s+(.+)$/);   // « XS3215470280 ADID AG 2.75 11-30 »
    if (avecIsin && !estNombre(avecIsin[2])) { res.isin = res.isin || avecIsin[1]; c = avecIsin[2]; }
    const devQte = c.match(/^[A-Z]{1,2}\s+([A-Z]{3})$/);             // « M EUR » (expression de la quantité)
    if (devQte && estDevise(devQte[1])) { res.devise = res.devise || devQte[1]; continue; }
    if (estIsin(c)) res.isin = res.isin || c;
    else if (estDevise(c)) res.devise = res.devise || c;
    else if (estNombre(c)) res.nombres.push(nombreInv(c));
    else if (MOTS_STATUT.test(c) || c === "-" || c === "+/-") continue;
    else res.texte.push(c);
  }
  res.complet = res.texte.join(" ").replace(/\s+/g, " ").trim();
  res.libelle = (res.texte[0] || "").replace(/\s+/g, " ").trim();
  return res;
}

// ---------- Lecture complète d'un rapport (inventaire ligne par ligne) ----------

// Rubriques comptables qui ne sont pas des placements (ou qui répètent des lignes déjà comptées)
const RUBRIQUES_IGNOREES = /^(Op[ée]rations temporaires|Titres? (financiers )?(pr[êe]t[ée]s|emprunt[ée]s|donn[ée]s en (pension|garantie)|re[çc]us en (pension|garantie))|Cr[ée]ances|Dettes|Comptes financiers|Indemnit[ée]s|Acomptes|Disponibilit[ée]s|Frais de gestion|Autres actifs|Autres passifs|Appels de marge|Hors[- ]bilan|Liquidit[ée]s|Banque ou attente|Vente(s)? diff)/i;

// Un document peut contenir plusieurs inventaires (plusieurs compartiments d'une SICAV, ou l'exercice précédent).
// On les lit tous, chacun dans un « bloc », puis on garde celui qui correspond au fonds.
function lireInventaires(pages) {
  const blocs = [];
  let bloc = null, paysTableau = {};
  // Lignes répétées en haut de page (en-têtes) : on les ignore partout
  const frequence = new Map();
  for (const lignes of pages) for (const l of lignes.slice(0, 2)) { const t = l.join(" "); frequence.set(t, (frequence.get(t) || 0) + 1); }
  const enTetes = new Set([...frequence.entries()].filter(([, n]) => n >= 3).map(([t]) => t));
  // Pieds de page répétés (le numéro de page change : on remplace les chiffres par #)
  const cleBas = t => t.replace(/\d+/g, "#");
  const freqBas = new Map();
  for (const lignes of pages) for (const l of lignes.slice(-2)) { const t = cleBas(l.join(" ")); freqBas.set(t, (freqBas.get(t) || 0) + 1); }
  const piedsDePage = new Set([...freqBas.entries()].filter(([, n]) => n >= 3).map(([t]) => t));
  const textesPage = pages.map(() => []);   // lignes de texte court de chaque page (pour retrouver le nom du compartiment)
  let etat = "avant", classe = null, secteur = null, pays = null, nomEnAttente = "", portefeuille = null;
  let ignoreMajuscule = false; // une section ignorée écrite EN MAJUSCULES ne se termine qu'à la prochaine rubrique EN MAJUSCULES
  const enMajuscules = t => t === t.toUpperCase() && /[A-Z]{4}/.test(t);
  const changerClasse = (c, texte) => {
    if (classe === "__ignore__" && ignoreMajuscule && !enMajuscules(texte)) return false;
    classe = c; secteur = null; return true;
  };
  const ignorer = texte => { classe = "__ignore__"; ignoreMajuscule = enMajuscules(texte); };

  const nouveauBloc = (ip, il) => {
    const lignes = pages[ip];
    const entete = (lignes[0] || []).join(" ");
    bloc = { positions: [], rubriques: [], paysTableau, swaps: 0, changeATerme: 0, noms: [entete], page: ip };
    blocs.push(bloc);
    paysTableau = {};
    classe = null; secteur = null; pays = null; nomEnAttente = ""; ignoreMajuscule = false;
  };

  for (let ip = 0; ip < pages.length; ip++) {
    const lignes = pages[ip];
    for (let il = 0; il < lignes.length; il++) {
      const brut = lignes[il].join(" ");
      if (brut.length > 4 && brut.length < 120 && !/\d{3}/.test(brut)) textesPage[ip].push(brut);
      // Un nouvel inventaire qui commence après une interruption (autre compartiment d'une SICAV) : nouveau bloc
      if (etat !== "avant" && bloc && bloc.positions.length && bloc.positions[bloc.positions.length - 1].page < ip - 1
          && /inventaire|portefeuille-titres|portefeuille titres/i.test(brut) && !/nombre de parts|valeur nette d.inventaire|synth[èe]se|r[ée]sum[ée]|instruments financiers [àa] terme|terme de devises/i.test(brut)) {
        etat = "avant";
      }
      if (il < 2 && enTetes.has(brut) && etat !== "avant") continue;
      if (il >= lignes.length - 2 && piedsDePage.has(cleBas(brut)) && etat !== "avant") continue;
      if (etat !== "avant" && /^(Rapport (annuel|semestriel)|Exercice clos|Page \d)/i.test(brut)) continue;

      // Tableaux « ventilation par pays » (nouveau format, avant chaque inventaire)
      if (etat === "avant" && /Exposition directe sur le march[ée] (actions|de taux)/i.test(brut)) {
        for (let k = il + 1; k < Math.min(lignes.length, il + 14); k++) {
          const codes = lignes[k].map(codePays).filter(Boolean);
          if (codes.length < 1) continue;
          for (let m = k + 1; m < Math.min(lignes.length, k + 6); m++) {
            const a = analyserLigne(lignes[m]);
            if (/^(Actions|Obligations|Titres|Total)/i.test(a.complet) && a.nombres.length >= codes.length) {
              const vals = a.nombres.slice(a.nombres.length - codes.length);
              codes.forEach((code, j) => { if (vals[j] > 0) paysTableau[code] = (paysTableau[code] || 0) + vals[j]; });
              break;
            }
          }
          break;
        }
      }

      // Format CACEIS : « PORTEFEUILLE : 141204 NOM DU FONDS »
      const pf = brut.match(/^PORTEFEUILLE\s*:\s*\d+\s+(.+?)(?:\s+VL VALIDEE|\s+Devise du portefeuille|$)/i);
      if (pf) {
        portefeuille = pf[1].trim();
        if (etat !== "avant" && bloc) {
          if (!bloc.portefeuille && !bloc.positions.length) { bloc.portefeuille = portefeuille; bloc.noms.unshift(portefeuille); }
          else if (bloc.portefeuille !== portefeuille) { nouveauBloc(ip, il); bloc.portefeuille = portefeuille; bloc.noms.unshift(portefeuille); }
        }
      }

      // Début d'un inventaire : un vrai tableau (colonnes devise + quantité + % de l'actif), pas une ligne du sommaire
      if (etat === "avant") {
        if (/inventaire|portefeuille-titres|portefeuille titres/i.test(brut) && !/nombre de parts|valeur nette d.inventaire|synth[èe]se|instruments financiers [àa] terme|terme de devises|^Inventaire des IFT/i.test(brut)) {
          const suite = lignes.slice(il, il + 10).map(l => l.join(" ")).join(" ");
          if (/(%\s*AN\b|% ?Actif|Actif net|ACT NET|de l.actif|PRCT)/i.test(suite) && /(Devise|\bDEV\b)/i.test(suite) && /(Quantit|Qt[ée]|Nominal)/i.test(suite)) {
            etat = "positions";
            nouveauBloc(ip, il);
            if (portefeuille) { bloc.portefeuille = portefeuille; bloc.noms.unshift(portefeuille); }
          }
        }
        continue;
      }

      // Fin d'un inventaire (le suivant éventuel sera un autre bloc)
      if (/^Synth[èe]se de l.inventaire|Total\s*=\s*actif net/i.test(brut)) { etat = "avant"; continue; }
      if (/^(Inventaires? des IFT|Inventaire des (instruments financiers [àa] terme|op[ée]rations [àa] terme)|E\d\w?\.\s*Inventaire des (instruments|op[ée]rations)|Instruments financiers [àa] terme|Hors[- ]bilan)/i.test(brut)) { etat = "ift"; continue; }

      const a = analyserLigne(lignes[il]);
      if (/SWAP|TOTAL RETURN|\bTRS\b|contrat d.[ée]change/i.test(a.complet) && a.nombres.length) {
        bloc.swaps = Math.max(bloc.swaps, ...a.nombres.map(Math.abs));
        continue;
      }
      if (etat === "ift") {
        if (/change [àa] terme|achat [àa] terme|vente [àa] terme|forward|devises [àa] (recevoir|livrer)/i.test(a.complet) && a.nombres.length)
          bloc.changeATerme += Math.max(...a.nombres.map(Math.abs));
        continue;
      }

      const rubrique = a.complet.replace(/^[IVX]+\s*[-–.]\s*/, "").replace(/^(Total|CUMUL)\s*(\(\w+\))?\s*/i, "");
      const estTotal = /^(Total|CUMUL|Sous.total)\b/i.test(a.complet);

      // Ligne sans nombre : titre de rubrique, pays, ou début d'un nom écrit sur deux lignes
      if (a.nombres.length === 0) {
        if (!a.complet || /^(Instruments|Devise|Quantit|Montant|%AN|Code valeur|Libell|Statut|Valeur|D[ée]signation|Nominal|V ¦|DEVISE VALEUR|SOUS TOTAL|\(\*\))/i.test(a.complet)) continue;
        if (RUBRIQUES_IGNOREES.test(rubrique)) { ignorer(a.complet); nomEnAttente = ""; continue; }
        const c = classeDeRubrique(rubrique);
        const p = codePays(a.complet);
        if (c) { changerClasse(c, a.complet); nomEnAttente = ""; }
        else if (p) { pays = p; nomEnAttente = ""; }
        else nomEnAttente = (nomEnAttente + " " + a.complet).trim().slice(-120);
        continue;
      }

      const pct = a.nombres[a.nombres.length - 1];
      if (Math.abs(pct) > 150) { nomEnAttente = ""; continue; } // pas un % de l'actif net
      const montant = a.nombres.length >= 2 ? a.nombres[a.nombres.length - 2] : null;

      if (!a.devise && !a.isin) {
        // Sous-total d'une rubrique
        if (RUBRIQUES_IGNOREES.test(rubrique)) { if (!estTotal) ignorer(a.complet); nomEnAttente = ""; continue; }
        const c = classeDeRubrique(rubrique);
        const p = codePays(rubrique);
        if (c) { if (!estTotal) changerClasse(c, a.complet); bloc.rubriques.push({ type: "classe", nom: c, poids: pct }); }
        else if (p) { bloc.rubriques.push({ type: "pays", nom: p, poids: pct }); if (!estTotal) pays = p; }
        else if (rubrique && !estTotal && !/n[ée]goci[ée]es|march[ée] r[ée]glement|assimil|^non |^\(|^[A-Z]{3}$/i.test(rubrique)) {
          secteur = rubrique; bloc.rubriques.push({ type: "secteur", nom: rubrique, poids: pct, classe });
        }
        nomEnAttente = "";
        continue;
      }

      // Position
      if (classe === "__ignore__") { nomEnAttente = ""; continue; }
      const nom = (a.libelle && !/^\(/.test(a.libelle) ? a.libelle : nomEnAttente || "(sans nom)").slice(0, 80);
      nomEnAttente = "";
      if (/^(Total|Sous.total|CUMUL)/i.test(nom)) continue;
      const classePos = classe || (/\b(FCP|SICAV|UCITS|ETF|FUND|FONDS|OPCVM)\b/i.test(nom) ? "Fonds (OPC)" : null);
      bloc.positions.push({
        nom, devise: a.devise, isin: a.isin, montant, poids: pct, page: ip,
        classe: classePos || "Autres", secteur, pays: a.isin && classePos !== "Fonds (OPC)" ? a.isin.slice(0, 2) : pays
      });
    }
  }
  const pleins = blocs.filter(b => b.positions.length > 0);
  // Indices pour retrouver le compartiment de chaque bloc :
  //  - forts : nom de portefeuille explicite, en-tête de page, lignes « COMPARTIMENT … » (avant ou pendant le bloc)
  //  - faibles : texte lu entre la fin du bloc précédent et le début de celui-ci
  const derniere = b => b.positions[b.positions.length - 1].page;
  pleins.forEach((b, i) => {
    const debut = Math.max(i > 0 ? derniere(pleins[i - 1]) + 1 : 0, b.page - 40);
    const fin = i < pleins.length - 1 ? pleins[i + 1].page : pages.length;
    const labels = textesPage.slice(debut, fin).flat().filter(t => /^(COMPARTIMENT|Compartiment|Nom du compartiment|D[ée]nomination)\b/.test(t));
    b.nomsForts = b.portefeuille ? [b.portefeuille] : b.noms.concat(labels);
    b.nomsFaibles = b.portefeuille ? [] : textesPage.slice(debut, b.page).flat();
  });
  return pleins;
}

// Choisit le bloc qui correspond au fonds : nom le plus ressemblant, sinon le premier (exercice le plus récent)
function scoreTextes(textes, nomFonds) {
  const mots = normaliser(nomFonds).split(/[^a-z0-9]+/).filter(m => m.length > 1 && !["fcp", "sicav", "fonds", "part", "de", "du", "la", "le", "les", "et"].includes(m));
  return Math.max(0, ...(textes || []).map(n => { const nn = normaliser(n); return mots.filter(m => nn.includes(m)).length / (mots.length || 1); }));
}
function scoreBloc(bloc, nomFonds) {
  return Math.max(scoreTextes(bloc.nomsForts || bloc.noms, nomFonds), 0.9 * scoreTextes(bloc.nomsFaibles, nomFonds));
}
const partActions = b => b.positions.filter(p => p.classe === "Actions").reduce((s, p) => s + p.poids, 0);

// Choisit le bloc qui correspond au fonds. `actionsAttendues` (en %, tiré de l'analyse des rendements) départage
// les compartiments quand le nom apparaît près de plusieurs inventaires.
function choisirBloc(blocs, nomFonds, actionsAttendues) {
  if (!blocs.length) return null;
  if (blocs.length === 1) return blocs[0];
  const notes = blocs.map(b => scoreBloc(b, nomFonds));
  const max = Math.max(...notes);
  if (max >= 0.6) {
    const candidats = blocs.filter((b, i) => notes[i] >= Math.max(0.6, max - 0.15));
    if (candidats.length > 1 && typeof actionsAttendues === "number") {
      return candidats.slice().sort((a, b) => Math.abs(partActions(a) - actionsAttendues) - Math.abs(partActions(b) - actionsAttendues))[0];
    }
    return blocs[notes.indexOf(max)];                     // le premier des meilleurs = le plus récent
  }
  if (notes.every(n => n === max)) return blocs[0];      // tous pareils (en-têtes identiques) : le premier
  return null;                                            // plusieurs fonds, aucun ne correspond : on ne devine pas
}

// ---------- Repli 1 : tableaux « Répartition du portefeuille par devise / secteur / pays » ----------

function lireTableauxRepartition(pages) {
  const tables = { devise: new Map(), secteur: new Map(), pays: new Map() };
  const classes = new Map();
  let type = null, classe = null, trouve = false;
  for (const lignes of pages) {
    for (const cel of lignes) {
      const brut = cel.join(" ");
      const titre = brut.match(/R[ée]partition (?:du portefeuille|des actifs[^a-z]*(?:a\),? b\),? c\)[^a-z]*d\))?)\s*par\s*(devise|secteur|pays|zone)/i);
      if (titre) { type = { devise: "devise", secteur: "secteur", pays: "pays", zone: "pays" }[titre[1].toLowerCase()]; classe = null; continue; }
      if (!type) continue;
      if (/^(Mouvements|Etat du patrimoine|Valeur liquidative|Sommaire|Rapport)/i.test(brut) || /R[ée]partition .* par /i.test(brut) && !titre) { type = null; continue; }
      const a = analyserLigne(cel);
      if (!a.nombres.length) {
        if (/titres de capital|actions/i.test(a.complet)) classe = "Actions";
        else if (/titres de cr[ée]ance|obligations/i.test(a.complet)) classe = "Obligations";
        else if (/OPC|placements collectifs|FIA/i.test(a.complet)) classe = "Fonds (OPC)";
        continue;
      }
      let lib = (a.devise || a.complet || "").replace(/^-\s*/, "").trim();
      if (!lib || /^(Total|% ?Actif|Pourcentage)/i.test(lib) || /%/.test(lib)) continue;
      const pct = a.nombres.length >= 2 ? a.nombres[a.nombres.length - 2] : a.nombres[0];
      if (!(pct > 0 && pct <= 100)) continue;
      if (type === "devise") lib = DEVISES_NOMS[normaliser(lib).toUpperCase()] || lib.toUpperCase();
      if (type === "pays") { const code = codePays(lib); if (code) lib = code; }
      tables[type].set(lib, (tables[type].get(lib) || 0) + pct);
      if (type === "devise" && classe) classes.set(classe, (classes.get(classe) || 0) + pct);
      trouve = true;
    }
  }
  if (!trouve) return null;
  const liste = m => [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);
  return { devises: liste(tables.devise), secteurs: liste(tables.secteur), pays: liste(tables.pays), classes: liste(classes) };
}

// ---------- Repli 2 : « État du patrimoine » (grandes classes d'actifs, en milliers) ----------

function lireEtatPatrimoine(pages) {
  const val = {};
  let actifNet = null, dans = false;
  for (const lignes of pages) {
    for (const cel of lignes) {
      const brut = cel.join(" ");
      if (/^Etat du patrimoine/i.test(brut)) dans = true;
      if (!dans) continue;
      const a = analyserLigne(cel);
      if (!a.nombres.length) continue;
      const v = a.nombres[a.nombres.length - 1];
      if (/titres de capital/i.test(a.complet)) val.Actions = (val.Actions || 0) + v;
      else if (/titres de cr[ée]ance/i.test(a.complet)) val.Obligations = (val.Obligations || 0) + v;
      else if (/Parts ou actions d.OPC/i.test(a.complet)) val["Fonds (OPC)"] = (val["Fonds (OPC)"] || 0) + v;
      else if (/instruments du march[ée] mon[ée]taire/i.test(a.complet)) val["Monétaire"] = (val["Monétaire"] || 0) + v;
      else if (/Avoirs bancaires|D[ée]p[ôo]ts/i.test(a.complet)) val["Liquidités et autres"] = (val["Liquidités et autres"] || 0) + v;
      else if (/Valeur nette d.inventaire/i.test(a.complet)) { actifNet = v; dans = false; }
    }
    if (actifNet) break;
  }
  if (!actifNet) return null;
  return Object.entries(val).filter(([, v]) => v > 0).map(([nom, v]) => ({ nom, poids: Math.round(v / actifNet * 10000) / 100 }))
    .sort((a, b) => b.poids - a.poids);
}

// ---------- Calcul des répartitions ----------

function sommerPar(positions, cle, libelleDe) {
  const m = new Map();
  for (const p of positions) {
    const k = p[cle];
    if (!k) continue;
    const nom = libelleDe ? libelleDe(k) : k;
    m.set(nom, (m.get(nom) || 0) + p.poids);
  }
  return [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);
}

// Regroupe les petites valeurs dans « Autres » pour garder des graphiques lisibles
function regrouper(liste, max = 10) {
  if (liste.length <= max) return liste;
  const tete = liste.slice(0, max - 1);
  const reste = liste.slice(max - 1).reduce((s, e) => s + e.poids, 0);
  return tete.concat([{ nom: "Autres", poids: Math.round(reste * 100) / 100 }]);
}

function compositionDepuisInventaire(inv) {
  const pos = inv.positions.filter(p => p.poids > 0);
  const total = pos.reduce((s, p) => s + p.poids, 0);
  // Actif net (en euros) déduit des lignes : médiane de montant / % de l'actif net
  const ratios = pos.filter(p => p.montant > 0 && p.poids > 0.3).map(p => p.montant / (p.poids / 100)).sort((a, b) => a - b);
  const actifNet = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;

  // Classes d'actifs
  const classes = sommerPar(pos, "classe");
  const liquidites = Math.round((100 - total) * 100) / 100;
  if (liquidites > 0.5) classes.push({ nom: "Liquidités et autres", poids: liquidites });

  // Secteurs : rubrique sectorielle de chaque ligne (nouveau format), regroupée en grands secteurs.
  // On ne classe que les actions et obligations d'entreprises : un fonds détenu n'a pas de secteur unique.
  const m = new Map();
  for (const p of pos) {
    if (!p.secteur || p.classe === "Fonds (OPC)") continue;
    const g = /[ée]tat|souverain|gouvernement|tr[ée]sor|supranational|collectivit[ée]s? (publiques|locales)|agences? (publiques|gouvernementales)|administrations? publiques/i.test(p.secteur)
      ? "Emprunts d'État et publics" : grandSecteur(p.secteur);
    m.set(g, (m.get(g) || 0) + p.poids);
  }
  const secteurs = [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);

  // Pays : 1) ISIN ou rubriques pays de chaque ligne  2) sinon tableau « ventilation par pays »
  let pays = sommerPar(pos.filter(p => p.classe !== "Fonds (OPC)"), "pays", c => NOMS_PAYS[c] || c);
  let sourcePays = "lignes";
  const couverturePays = pays.reduce((s, p) => s + p.poids, 0);
  if (couverturePays < total * 0.5 && Object.keys(inv.paysTableau).length && actifNet) {
    pays = Object.entries(inv.paysTableau).map(([c, k]) => ({ nom: NOMS_PAYS[c] || c, code: c, poids: Math.round(k * 1000 / actifNet * 10000) / 100 }))
      .filter(p => p.poids > 0 && p.poids <= 150).sort((a, b) => b.poids - a.poids);
    const connu = pays.reduce((s, p) => s + p.poids, 0);
    if (connu < total - 1) pays.push({ nom: "Autres pays (non détaillés)", poids: Math.round((total - connu) * 100) / 100 });
    sourcePays = "tableau";
  }
  // Dernier recours : pays déduit de la devise de cotation de chaque ligne (hors euro), le reste en « zone euro non précisée »
  if (!pays.length) {
    const PAYS_DEVISE = { USD: "US", GBP: "GB", CHF: "CH", SEK: "SE", NOK: "NO", DKK: "DK", JPY: "JP", CAD: "CA", AUD: "AU", HKD: "HK", PLN: "PL", CZK: "CZ", HUF: "HU" };
    const m = new Map();
    for (const p of pos.filter(x => x.classe === "Actions" || x.classe === "Obligations")) {
      const code = PAYS_DEVISE[p.devise];
      const nom = code ? NOMS_PAYS[code] : p.devise === "EUR" ? "Autres pays de la zone euro (non précisés)" : null;
      if (nom) m.set(nom, (m.get(nom) || 0) + p.poids);
    }
    pays = [...m.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);
    if (pays.length) sourcePays = "devise";
  }
  const codePays = nom => nom.startsWith("Autres pays de la zone euro") ? "FR" : Object.keys(NOMS_PAYS).find(c => NOMS_PAYS[c] === nom);
  const zonesMap = new Map();
  for (const p of pays) {
    const code = p.code || codePays(p.nom);
    const z = code ? ZONE_PAR_PAYS(code) : "Autres";
    zonesMap.set(z, (zonesMap.get(z) || 0) + p.poids);
  }
  const zones = [...zonesMap.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);

  const devises = sommerPar(pos, "devise");
  const top10 = [...pos].sort((a, b) => b.poids - a.poids).slice(0, 10).map(p => ({ nom: p.nom, poids: p.poids, devise: p.devise, classe: p.classe }));
  const partFonds = pos.filter(p => p.classe === "Fonds (OPC)").reduce((s, p) => s + p.poids, 0);

  return {
    source: "inventaire",
    nbLignes: pos.length,
    totalLu: Math.round(total * 10) / 10,
    actifNet,
    classes, secteurs, pays: regrouper(pays, 12), sourcePays, zones, devises: regrouper(devises, 8), top10,
    partFonds,
    swapsPct: actifNet && inv.swaps ? Math.round(inv.swaps / actifNet * 1000) / 10 : 0,
    changeATermePct: actifNet && inv.changeATerme ? Math.round(inv.changeATerme / actifNet * 1000) / 10 : 0,
    positions: pos
  };
}

// Composition à partir des tableaux de répartition (rapports semestriels et anciens formats)
function compositionDepuisTableaux(t, classesEtat) {
  const secteursMap = new Map();
  for (const r of t.secteurs) { const g = grandSecteur(r.nom); secteursMap.set(g, (secteursMap.get(g) || 0) + r.poids); }
  const secteurs = [...secteursMap.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids);
  const pays = t.pays.map(p => ({ nom: NOMS_PAYS[p.nom] || p.nom, code: NOMS_PAYS[p.nom] ? p.nom : null, poids: p.poids }));
  const zonesMap = new Map();
  for (const p of pays) { const z = p.code ? ZONE_PAR_PAYS(p.code) : "Autres"; zonesMap.set(z, (zonesMap.get(z) || 0) + p.poids); }
  return {
    source: "tableaux",
    classes: classesEtat && classesEtat.length ? classesEtat : t.classes,
    secteurs, pays: regrouper(pays, 12), sourcePays: "tableau",
    zones: [...zonesMap.entries()].map(([nom, poids]) => ({ nom, poids: Math.round(poids * 100) / 100 })).sort((a, b) => b.poids - a.poids),
    devises: regrouper(t.devises, 8), top10: [], nbLignes: null, swapsPct: 0, changeATermePct: 0, partFonds: 0, positions: []
  };
}

// Point d'entrée : lit les rapports les plus récents et renvoie la meilleure composition trouvée (ou null)
async function analyserInventaire(documents, nomFonds, surProgression, actionsAttendues) {
  const rapports = (documents || []).filter(d => /Rapport|Comptes annuels/i.test(d.docTypeLib))
    .sort((a, b) => (b.dateEffet || "").localeCompare(a.dateEffet || ""));
  let repli = null;
  for (const doc of rapports.slice(0, 3)) {
    try {
      const pages = await pagesDuPdf(`${GECO_API}/document/download/${doc.idInterne}`, surProgression, p => inventaireComplet(p, nomFonds, actionsAttendues));
      const inv = choisirBloc(lireInventaires(pages), nomFonds, actionsAttendues);
      if (inv && inv.positions.length) {
        const compo = compositionDepuisInventaire(inv);
        if (compo.totalLu >= 40 && compo.totalLu <= 130) {
          compo.document = doc;
          // Si le rapport ligne à ligne est nettement plus ancien que le tableau de repli, on complète avec les tableaux récents
          if (repli) compo.plusRecent = repli;
          return compo;
        }
      }
      if (!repli) {
        const tables = lireTableauxRepartition(pages);
        const etat = lireEtatPatrimoine(pages);
        if (tables || etat) {
          repli = compositionDepuisTableaux(tables || { devises: [], secteurs: [], pays: [], classes: [] }, etat);
          repli.document = doc;
        }
      }
    } catch (e) { /* on essaie le rapport suivant */ }
  }
  return repli;
}

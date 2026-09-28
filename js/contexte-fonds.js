/*
 * CONTEXTE D'UN FONDS — ce qui peut l'influencer, d'après ce qu'il contient.
 *
 * Tout part de l'exposition du fonds (analyse des rendements et, quand il est lisible, inventaire du rapport annuel),
 * croisée avec des données publiques datées (data/contexte.js, mis à jour chaque jour) :
 *   - facteurs économiques pertinents pour CE fonds (taux, inflation, change, croissance…)
 *   - risques géopolitiques et politiques, illustrés par des titres de presse récents (date, source, lien)
 *   - exposition aux grandes tendances technologiques (opportunité / risque, sans recommandation)
 *   - tableau de bord des risques (faible / modéré / élevé) avec la raison de chaque niveau
 *
 * Rien n'est prédit : on décrit des sensibilités. Les scénarios politiques ne sont jamais inventés ;
 * seuls des titres d'actualité réels, datés et sourcés sont affichés.
 */

// ---------- Profil d'exposition (en % du fonds) ----------

function profilDuFonds(A) {
  const expo = A.expo || [];
  const total = expo.reduce((s, x) => s + x.poids, 0) || 100;
  const w = cle => expo.filter(x => x.cle === cle).reduce((s, x) => s + x.poids, 0) / total * 100;
  const c = A.compo && A.compo.principale ? A.compo : null;
  const p = {
    actions: w("usa") + w("tech") + w("euro") + w("europe") + w("japon") + w("emergents"),
    obligLongues: w("oblig10"), obligCourtes: w("oblig3"), monetaire: w("monetaire"),
    usa: w("usa") + w("tech"), tech: w("tech"), euro: w("euro"), europe: w("europe"), japon: w("japon"), emergents: w("emergents"),
    source: A.sourceExpo
  };
  // L'inventaire (quand il décrit bien l'exposition) précise les classes, les pays et les secteurs
  if (c && (c.principale === "inventaire" || c.principale === "tableaux")) {
    const cl = nom => (c.classes || []).filter(x => new RegExp(nom, "i").test(x.nom)).reduce((s, x) => s + x.poids, 0);
    // on ne remplace la répartition estimée que si l'inventaire identifie vraiment les classes d'actifs
    // (pas quand il se limite à « Fonds (OPC) », sans dire ce que contiennent ces fonds)
    if (cl("^Actions") + cl("^Obligations") + cl("Monétaire|Liquidités") >= 50) {
      p.actions = cl("^Actions");
      const oblig = cl("^Obligations");
      const partLongue = p.obligLongues + p.obligCourtes > 0 ? p.obligLongues / (p.obligLongues + p.obligCourtes) : 0.5;
      p.obligLongues = oblig * partLongue; p.obligCourtes = oblig * (1 - partLongue);
      p.monetaire = cl("Monétaire|Liquidités");
    }
    const zone = nom => (c.zones || []).filter(x => x.nom === nom).reduce((s, x) => s + x.poids, 0);
    if ((c.zones || []).length) {
      p.usa = zone("Amérique du Nord"); p.euro = zone("Zone euro"); p.europe = zone("Europe hors zone euro");
      p.japon = zone("Asie-Pacifique développée"); p.emergents = zone("Pays émergents");
    }
  }
  const pays = c && c.pays && c.principale !== "style" ? c.pays : [];
  const poidsPays = re => pays.filter(x => re.test(x.nom)).reduce((s, x) => s + x.poids, 0);
  p.chine = pays.length ? poidsPays(/^Chine|Hong Kong/) : null;
  p.taiwan = pays.length ? poidsPays(/Taïwan|Taiwan/) : null;
  p.france = pays.length ? poidsPays(/^France/) : (/françaises/i.test(A.entree.classification || "") ? 60 : null);
  p.pays = pays;
  // Devises : composition si disponible, sinon estimation d'après les zones
  p.couvert = !!((c && c.couvertureChange) || /hedged|couvert/i.test((A.part && A.part.parNom) || "") || /HEDGED|\bHDG\b/i.test(A.entree.nom));
  if (c && c.devises && c.devises.length) p.horsEuro = c.devises.filter(d => d.nom !== "EUR").reduce((s, d) => s + d.poids, 0);
  else p.horsEuro = p.usa + p.japon + p.emergents + p.europe * 0.8;
  if (A.part && A.part.parRefDevCode && A.part.parRefDevCode !== "EUR") p.deviseDeLaPart = A.part.parRefDevCode;
  // Secteurs
  p.secteurs = c && c.secteurs && c.secteurs.length ? c.secteurs.filter(s => !/Emprunts d'État/.test(s.nom)) : null;
  const tech = p.secteurs ? p.secteurs.filter(s => /Technolog/i.test(s.nom)).reduce((s, x) => s + x.poids, 0) : null;
  p.secteurTech = Math.max(tech || 0, p.tech);
  p.premierSecteur = p.secteurs && p.secteurs.length ? [...p.secteurs].filter(s => !/^Autres/i.test(s.nom)).sort((a, b) => b.poids - a.poids)[0] : null;
  // Lignes détenues (pas le panier d'un fonds à réplication synthétique)
  const synth = c && c.notes && c.notes.some(n => n.type === "synthetique");
  p.top10 = c && c.top10 && c.top10.length && !synth && !c.lignesSontDesFonds ? c.top10.slice(0, 10) : null;
  p.top10Total = p.top10 ? p.top10.reduce((s, l) => s + l.poids, 0) : null;
  // Lignes à afficher : aussi quand ce sont des fonds (un fonds de fonds), mais pas le panier d'un fonds synthétique
  p.lignesDetenues = c && c.top10 && c.top10.length && !synth ? c.top10.slice(0, 10) : null;
  p.lignesSontDesFonds = !!(c && c.lignesSontDesFonds);
  p.synthetique = !!(synth || A.synthetique);
  return p;
}

// ---------- Sensibilités (phrases simples) ----------

function sensibilites(A, p) {
  const s = [];
  const pc = v => Math.round(v);
  if (p.tech >= 15) s.push(`Environ ${pc(p.tech)} % du fonds se comporte comme les grandes valeurs technologiques américaines (Nasdaq-100) : son évolution peut être particulièrement sensible à ce secteur.`);
  else if (p.secteurTech >= 20) s.push(`La technologie pèse environ ${pc(p.secteurTech)} % du fonds : son évolution dépend beaucoup de ce secteur.`);
  if (p.usa >= 40) s.push(`Environ ${pc(p.usa)} % est exposé aux actions américaines : la santé de l'économie des États-Unis, la politique de la Fed et le cours du dollar comptent beaucoup.`);
  if (p.euro >= 40) s.push(`Environ ${pc(p.euro)} % est investi en zone euro : croissance européenne, décisions de la BCE et situation des finances publiques (France, Italie…) sont déterminantes.`);
  if (p.emergents >= 15) s.push(`Environ ${pc(p.emergents)} % est exposé aux pays émergents : plus de croissance potentielle, mais aussi plus de risques politiques, de change et de réglementation (Chine notamment).`);
  if (p.japon >= 15) s.push(`Environ ${pc(p.japon)} % est exposé au Japon : le yen et la politique de la Banque du Japon jouent un rôle important.`);
  if (p.obligLongues >= 25) s.push(`Environ ${pc(p.obligLongues)} % se comporte comme des obligations d'État à long terme : le fonds baisse quand les taux d'intérêt montent, et monte quand ils baissent.`);
  if (p.monetaire >= 50) s.push(`Le fonds se comporte surtout comme un placement monétaire : son rendement suit de près le taux de la BCE.`);
  if (!p.couvert && p.horsEuro >= 30) s.push(`Environ ${pc(p.horsEuro)} % des actifs sont en devises étrangères, sans couverture : une baisse de ces devises face à l'euro réduit la performance.`);
  if (p.premierSecteur && p.premierSecteur.poids >= 25 && !/Technolog/i.test(p.premierSecteur.nom)) s.push(`Le secteur « ${p.premierSecteur.nom} » pèse ${pc(p.premierSecteur.poids)} % : le fonds est sensible à la conjoncture de ce secteur.`);
  if (p.top10Total >= 40) s.push(`Les 10 premières lignes représentent ${pc(p.top10Total)} % du fonds : quelques entreprises font l'essentiel du résultat.`);
  return s;
}

// ---------- Tendances technologiques ----------

const THEMES_TECHNO = {
  ia: { nom: "Intelligence artificielle",
    opportunite: "Si l'adoption de l'IA continue de s'étendre, les entreprises qui fournissent la puissance de calcul, les logiciels et les services associés peuvent voir leurs revenus progresser.",
    risque: "Les attentes sont élevées et souvent déjà intégrées dans les prix. Une adoption plus lente que prévu, des investissements très coûteux, une concurrence accrue ou des règles plus strictes peuvent faire fortement baisser les cours." },
  semi: { nom: "Semi-conducteurs",
    opportunite: "Les puces sont indispensables à l'IA, aux centres de données, à l'automobile et aux objets connectés : ces usages soutiennent la demande sur le long terme.",
    risque: "Secteur très cyclique (alternance de pénuries et de surcapacités), très concentré géographiquement (Taïwan, Corée, Pays-Bas) et exposé aux restrictions d'exportation entre les États-Unis et la Chine." },
  cloud: { nom: "Cloud et centres de données",
    opportunite: "Les entreprises continuent de déplacer leurs logiciels et leurs données vers le cloud : des revenus récurrents, souvent sous forme d'abonnements.",
    risque: "Investissements considérables (centres de données, énergie), concurrence entre quelques géants, enquêtes sur la concurrence et règles sur la protection des données." },
  cyber: { nom: "Cybersécurité",
    opportunite: "Les cyberattaques se multiplient et les obligations réglementaires se renforcent : ces dépenses sont difficiles à réduire pour les entreprises.",
    risque: "Entreprises souvent valorisées cher et concurrence intense ; une faille dans ses propres produits peut ruiner la confiance des clients." },
  robotique: { nom: "Robotique et automatisation",
    opportunite: "Le manque de main-d'œuvre et la recherche de productivité poussent à automatiser usines, entrepôts et blocs opératoires.",
    risque: "Les investissements industriels sont cycliques : en cas de ralentissement économique, les commandes de machines baissent vite." },
  energie: { nom: "Transition énergétique",
    opportunite: "Les objectifs climatiques et la sécurité énergétique soutiennent les investissements dans les renouvelables, les réseaux, les batteries et les véhicules électriques.",
    risque: "Projets très coûteux, donc sensibles aux taux d'intérêt ; dépendance aux subventions et aux décisions politiques, qui peuvent changer ; forte concurrence chinoise sur les prix." },
  tech: { nom: "Technologie (au sens large)",
    opportunite: "Les grandes entreprises technologiques ont fortement augmenté leurs bénéfices ; leurs innovations peuvent continuer d'élargir leurs marchés.",
    risque: "Valorisations souvent élevées, forte sensibilité aux taux d'intérêt, poids de quelques géants dans les indices et enquêtes antitrust en Europe comme aux États-Unis." }
};

// Grandes entreprises et tendances auxquelles leur activité est liée
const ENTREPRISES_THEMES = [
  [/NVIDIA/, ["ia", "semi"]], [/TAIWAN SEMI|\bTSMC\b/, ["semi", "ia"]], [/\bASML\b/, ["semi"]], [/BROADCOM/, ["semi", "ia"]],
  [/ADVANCED MICRO|\bAMD\b/, ["semi", "ia"]], [/\bINTEL\b/, ["semi"]], [/QUALCOMM/, ["semi"]], [/TEXAS INSTR/, ["semi"]], [/MICRON/, ["semi"]],
  [/APPLIED MAT/, ["semi"]], [/LAM RESEARCH/, ["semi"]], [/\bKLA\b/, ["semi"]], [/INFINEON/, ["semi"]], [/STMICRO/, ["semi"]],
  [/SAMSUNG ELEC/, ["semi"]], [/SK HYNIX/, ["semi"]], [/\bARM HOLDINGS/, ["semi"]], [/MARVELL/, ["semi"]], [/TOKYO ELECTRON/, ["semi"]],
  [/MICROSOFT/, ["cloud", "ia"]], [/AMAZON/, ["cloud", "ia"]], [/ALPHABET|GOOGLE/, ["cloud", "ia"]], [/\bMETA PLATFORMS|FACEBOOK/, ["ia"]],
  [/ORACLE/, ["cloud", "ia"]], [/SALESFORCE/, ["cloud"]], [/\bSAP\b/, ["cloud"]], [/SERVICENOW/, ["cloud"]], [/ADOBE/, ["cloud"]],
  [/SNOWFLAKE/, ["cloud"]], [/ALIBABA/, ["cloud"]], [/TENCENT/, ["cloud"]], [/PALANTIR/, ["ia"]],
  [/CROWDSTRIKE|PALO ALTO|FORTINET|ZSCALER|CHECK POINT|CLOUDFLARE|\bOKTA\b|SENTINELONE/, ["cyber"]],
  [/SCHNEIDER|SIEMENS(?! ENERGY| HEALTH)|\bABB\b|FANUC|KEYENCE|ROCKWELL|YASKAWA|INTUITIVE SURGICAL|TERADYNE|DASSAULT SYST/, ["robotique"]],
  [/TESLA/, ["energie", "robotique"]],
  [/IBERDROLA|\bENEL\b|NEXTERA|VESTAS|ORSTED|FIRST SOLAR|ENPHASE|SIEMENS ENERGY|EDP RENOV|NORDEX|\bBYD\b|CONTEMPORARY AMPEREX|SOLAREDGE|\bRWE\b/, ["energie"]]
];

const THEMES_PAR_NOM = [
  [/\bAI\b|ARTIFICIAL|INTELLIGENCE ARTIF|\bIA\b|BIG DATA/, "ia"], [/SEMICONDUCTOR|SEMI-?CONDUCT|\bCHIP/, "semi"], [/CLOUD|DIGITAL|DIGITALI|NUMERIQUE|INTERNET|SOFTWARE/, "cloud"],
  [/CYBER|SECURITY|SECURITE NUM/, "cyber"], [/ROBOT|AUTOMATION|AUTOMATIS/, "robotique"],
  [/CLEAN ENERGY|RENEWABLE|RENOUVEL|CLIMAT|CLIMATE|TRANSITION|HYDROGEN|HYDROGENE|ELECTRIC VEHICLE|BATTER|SOLAR|SOLAIRE|WIND|ENVIRONNEMENT|GREEN/, "energie"],
  [/NASDAQ|TECHNOLOG|TECH\b|INFORMATION TECH|INNOVATION/, "tech"]
];

function themesTechnologiques(A, p) {
  const nom = (A.entree.nom || "").toUpperCase();
  const res = {};
  const ajouter = (cle, poids, preuve) => {
    res[cle] = res[cle] || { cle, ...THEMES_TECHNO[cle], poids: 0, preuves: [] };
    res[cle].poids += poids || 0;
    if (preuve && !res[cle].preuves.includes(preuve)) res[cle].preuves.push(preuve);
  };
  for (const [re, cle] of THEMES_PAR_NOM) if (re.test(nom)) ajouter(cle, 0, "le nom du fonds");
  if (p.top10) for (const l of p.top10) {
    const n = normaliser(l.nom).toUpperCase();
    for (const [re, cles] of ENTREPRISES_THEMES) if (re.test(n)) cles.forEach(c => ajouter(c, l.poids, `${l.nom} (${pct(l.poids)})`));
  }
  if (p.tech >= 5) {
    ["tech", "ia", "semi", "cloud"].forEach(c => ajouter(c, c === "tech" ? p.tech : 0, `comportement proche du Nasdaq-100 pour ≈ ${Math.round(p.tech)} % du fonds`));
  }
  if (p.secteurs) {
    const t = p.secteurs.filter(s => /Technolog/i.test(s.nom)).reduce((s, x) => s + x.poids, 0);
    if (t >= 5) ajouter("tech", Math.max(0, t - (res.tech ? res.tech.poids : 0)), `secteur technologie : ${pct(t)} du fonds`);
    const e = p.secteurs.filter(s => /Services aux collectivités/i.test(s.nom)).reduce((s, x) => s + x.poids, 0);
    if (e >= 10) ajouter("energie", 0, `secteur services aux collectivités (électricité…) : ${pct(e)}`);
  }
  const liste = Object.values(res).map(t => {
    const parNom = t.preuves.includes("le nom du fonds");
    t.niveau = parNom || t.poids >= 20 ? "forte" : t.poids >= 7 || t.preuves.length >= 2 ? "notable" : "faible";
    return t;
  }).filter(t => t.niveau !== "faible").sort((a, b) => (b.niveau === "forte") - (a.niveau === "forte") || b.poids - a.poids);
  return liste;
}

// ---------- Contexte économique : indicateurs pertinents pour ce fonds ----------

function indicateurCtx(cle) { return typeof CONTEXTE !== "undefined" && CONTEXTE.indicateurs ? CONTEXTE.indicateurs[cle] : null; }

// Une donnée est « ancienne » quand sa date dépasse le délai habituel de publication
function donneeAncienne(ind) {
  if (!ind) return false;
  const d = ind.date;
  let date;
  if (/^\d{4}-Q\d$/.test(d)) date = new Date(Number(d.slice(0, 4)), Number(d.slice(6)) * 3, 0);
  else if (/^\d{4}-\d{2}$/.test(d)) date = new Date(Number(d.slice(0, 4)), Number(d.slice(5)), 0);
  else date = new Date(d);
  const jours = (Date.now() - date) / 864e5;
  const limite = { quotidienne: 10, décision: 200, mensuelle: 75, trimestrielle: 200 }[ind.frequence] || 60;
  return jours > limite;
}

function facteursMacro(A, p) {
  const f = [];
  const ajouter = (cle, pourquoi) => { const ind = indicateurCtx(cle); if (ind && !f.some(x => x.cle === cle)) f.push({ cle, ind, pourquoi }); };
  const obligs = p.obligLongues + p.obligCourtes;
  ajouter("inflation_euro", "L'inflation réduit le pouvoir d'achat de ton épargne et influence les décisions de la BCE sur les taux.");
  ajouter("bce_depot", obligs >= 20 || p.monetaire >= 20 ? "Le taux de la BCE guide le rendement des placements monétaires et, en partie, celui des obligations détenues par le fonds."
    : "Des taux élevés rendent le crédit plus cher pour les entreprises et les placements sans risque plus attractifs face aux actions.");
  if (obligs >= 15) {
    ajouter("taux10_euro", "Quand les taux à 10 ans montent, la valeur des obligations déjà détenues baisse (et inversement). C'est aussi le rendement que l'on peut attendre de ces obligations sur la durée.");
    ajouter("taux3_euro", "Taux des emprunts d'État à échéance courte : ils réagissent vite aux décisions de la BCE.");
    ajouter("dette_euro", "Une dette publique élevée peut faire monter les taux d'emprunt des États concernés, ce qui pèse sur la valeur de leurs obligations.");
  }
  if (p.monetaire >= 30) ajouter("estr", "Le rendement d'un placement monétaire suit de très près ce taux au jour le jour.");
  if (p.euro >= 15 || p.france >= 15) {
    ajouter("croissance_euro", "La croissance de l'économie européenne soutient les bénéfices des entreprises de la zone euro.");
    ajouter("chomage_euro", "Le chômage renseigne sur la santé de l'économie et la consommation des ménages européens.");
    if (!f.some(x => x.cle === "taux10_euro")) ajouter("taux10_euro", "Des taux d'emprunt plus élevés pèsent sur la valorisation des entreprises et sur leurs coûts de financement.");
  }
  if (p.usa >= 15) {
    ajouter("fed", "La politique de la Fed influence toute l'économie américaine et la valorisation des actions (surtout technologiques).");
    ajouter("taux10_us", "Le taux à 10 ans américain sert de référence mondiale : sa hausse pèse souvent sur les actions de croissance.");
    ajouter("inflation_us", "Une inflation américaine élevée peut conduire la Fed à maintenir des taux hauts plus longtemps.");
    ajouter("chomage_us", "L'emploi américain renseigne sur la vigueur de l'économie des États-Unis.");
  }
  if (!p.couvert && p.usa >= 15) ajouter("eurusd", "Tu investis en euros dans des actifs en dollars : si le dollar baisse face à l'euro (EUR/USD monte), ta performance en euros baisse.");
  if (!p.couvert && p.europe >= 10) { ajouter("eurgbp", "Une partie des actifs est en livres sterling : une baisse de la livre face à l'euro réduit la performance."); ajouter("eurchf", "Une partie des actifs est en francs suisses : leur évolution face à l'euro compte."); }
  if (!p.couvert && p.japon >= 10) ajouter("eurjpy", "Une partie des actifs est en yens : si le yen baisse face à l'euro (EUR/JPY monte), la performance en euros baisse.");
  if (!p.couvert && (p.emergents >= 10 || p.chine >= 5)) ajouter("eurcny", "Les devises émergentes (dont le yuan chinois) influencent la performance en euros.");
  if (p.actions >= 30 || (p.premierSecteur && /Énergie/.test(p.premierSecteur.nom))) ajouter("inflation_energie", "Les prix de l'énergie pèsent sur les coûts des entreprises et le pouvoir d'achat des ménages ; ils profitent en revanche aux producteurs d'énergie.");
  ajouter("anticipations_inflation", "Inflation attendue sur le long terme par les prévisionnistes interrogés par la BCE : c'est l'hypothèse d'inflation utilisée par défaut dans la simulation.");
  ajouter("stress_euro", "Indicateur de la BCE qui mesure les tensions sur les marchés financiers (0 = calme, plus de 0,3 ≈ forte tension, plus de 0,6 ≈ crise majeure comme en 2008).");
  return f;
}

// Croissance par grande région (FMI) : zones utiles pour ce fonds
function zonesFmiPertinentes(p) {
  const z = ["WEOWORLD"];
  if (p.usa >= 10) z.push("USA");
  if (p.euro >= 10 || p.france >= 10 || p.obligLongues + p.obligCourtes >= 10) z.push("EURO");
  if (p.france >= 15) z.push("FRA");
  if (p.europe >= 10) z.push("GBR");
  if (p.japon >= 5) z.push("JPN");
  if (p.emergents >= 5) z.push("OEMDC", "CHN", "IND");
  return z;
}

// ---------- Géopolitique et politique ----------

function risquesGeopolitiques(A, p, themes) {
  const actions = p.actions;
  // Semi-conducteurs : exposition forte (≥ 15 % ou tech US marquée) ou simple présence (≥ 5 %, ex. une ligne ASML)
  const poidsSemi = (themes.find(t => t.cle === "semi") || { poids: 0 }).poids;
  const semi = poidsSemi >= 15 || p.tech >= 15;
  const semiPresent = semi || poidsSemi >= 5;
  const r = [];
  const theme = (cle, niveau, pourquoi) => r.push({ cle, niveau, pourquoi,
    nom: (typeof CONTEXTE !== "undefined" && CONTEXTE.actualites && CONTEXTE.actualites[cle] ? CONTEXTE.actualites[cle].nom : cle),
    articles: (typeof CONTEXTE !== "undefined" && CONTEXTE.actualites && CONTEXTE.actualites[cle] ? CONTEXTE.actualites[cle].articles : []) });
  if (actions >= 20) theme("commerce",
    p.emergents >= 20 || (p.usa >= 30 && p.euro + p.europe >= 20) || semi ? "Élevé" : "Modéré",
    "Les droits de douane renchérissent les échanges : ils pèsent sur les entreprises exportatrices, sur les chaînes d'approvisionnement mondiales et peuvent relancer l'inflation.");
  if (p.emergents >= 10 || p.chine >= 5 || themes.some(t => t.cle === "energie")) theme("sanctions", p.emergents >= 20 ? "Modéré" : "Faible",
    "Des sanctions peuvent bloquer l'accès à certains marchés, geler des actifs ou perturber l'énergie et les matières premières.");
  if (p.usa >= 20 || p.euro + p.europe >= 20 || p.france >= 10 || p.obligLongues + p.obligCourtes >= 20) theme("elections", "Modéré",
    "Une élection peut changer la politique budgétaire, fiscale ou commerciale d'un pays. Les obligations d'État réagissent aux inquiétudes sur la dette publique.");
  if (semiPresent || p.chine >= 5 || p.taiwan >= 3 || p.emergents >= 15 || p.usa >= 40) theme("puissances", semi || p.taiwan >= 3 ? "Élevé" : "Modéré",
    "Les rivalités entre les États-Unis et la Chine (Taïwan, technologies, restrictions d'exportation) touchent directement les semi-conducteurs, la tech et les marchés asiatiques.");
  if (actions >= 20 || p.emergents >= 10) theme("conflits", p.euro + p.europe >= 30 || p.emergents >= 20 ? "Modéré" : "Faible",
    "Les conflits peuvent faire flamber l'énergie et les matières premières, désorganiser le commerce et provoquer des baisses brutales des marchés.");
  if (semiPresent || themes.some(t => t.cle === "energie")) theme("industrie", "Modéré",
    "Subventions et politiques industrielles (puces, énergies propres, véhicules électriques) peuvent favoriser ou pénaliser certaines entreprises selon leur pays.");
  if (p.secteurTech >= 15 || p.euro >= 30) theme("regl_europe", p.secteurTech >= 25 ? "Modéré" : "Faible",
    "Les règles européennes (concurrence, numérique, IA, finance durable) encadrent l'activité des grandes entreprises, avec des amendes possibles.");
  if (p.usa >= 30 || p.secteurTech >= 15) theme("regl_usa", p.secteurTech >= 25 ? "Modéré" : "Faible",
    "Enquêtes antitrust, contrôles des exportations de technologies et décisions des autorités américaines peuvent peser sur certaines entreprises.");
  if (p.emergents >= 10 || p.chine >= 5) theme("regl_chine", p.chine >= 15 || p.emergents >= 25 ? "Élevé" : "Modéré",
    "Les autorités chinoises peuvent changer brutalement les règles d'un secteur (technologie, éducation, immobilier ces dernières années).");
  if (p.obligLongues + p.obligCourtes + p.monetaire >= 30) theme("banques_centrales", "Modéré",
    "Les décisions des banques centrales déterminent le niveau des taux, donc la valeur des obligations et le rendement du monétaire.");
  else if (actions >= 20) theme("banques_centrales", "Faible", "Les décisions des banques centrales influencent les taux d'intérêt, donc la valorisation des actions.");
  return r;
}

// ---------- Tableau de bord des risques ----------

const NIVEAUX_RISQUE = ["Faible", "Modéré", "Élevé"];

function tableauDeBordRisques(A, p, themes, geo) {
  const r = [];
  const sri = A.dic && A.dic.sri;
  const vol = A.modele ? A.modele.sigma * 100 : null;
  const perte = A.statsH ? A.statsH.perteMax.valeur * 100 : null;
  // Marché
  {
    const n = vol === null ? null : vol < 4 ? 0 : vol < 12 ? 1 : 2;
    const nSri = sri ? (sri <= 2 ? 0 : sri <= 4 ? 1 : 2) : null;
    const niveau = n === null ? nSri : nSri === null ? n : Math.max(n, nSri);
    r.push({ cle: "marche", nom: "Risque de marché", niveau,
      explication: niveau === 2 ? "La valeur du fonds peut fortement varier, à la hausse comme à la baisse, d'une année à l'autre."
        : niveau === 1 ? "Des baisses temporaires notables sont possibles, mais le fonds reste moins agité qu'un fonds 100 % actions."
        : "Les variations de valeur sont faibles.",
      base: [vol !== null && `volatilité ${pct(vol)} par an`, perte !== null && `pire baisse ${pct(perte, 0)}`, sri && `SRI ${sri}/7`].filter(Boolean).join(" · ") });
  }
  // Géopolitique
  {
    const eleves = geo.filter(g => g.niveau === "Élevé").length, moderes = geo.filter(g => g.niveau === "Modéré").length;
    const niveau = p.actions < 15 && p.emergents < 5 ? 0 : eleves >= 2 || p.emergents >= 25 ? 2 : eleves || moderes >= 2 ? 1 : 0;
    r.push({ cle: "geopolitique", nom: "Risque géopolitique", niveau,
      explication: niveau === 2 ? "Le fonds est exposé à des régions ou des secteurs au cœur des tensions internationales (Chine, Taïwan, semi-conducteurs, pays émergents)."
        : niveau === 1 ? "Comme la plupart des fonds actions internationaux, il peut réagir aux crises géopolitiques et aux tensions commerciales."
        : "Le fonds est surtout investi dans des actifs européens peu exposés aux tensions internationales.",
      base: `pays émergents ≈ ${Math.round(p.emergents)} %${p.chine !== null ? ` · Chine ${pct(p.chine, 0)}` : ""}${p.taiwan ? ` · Taïwan ${pct(p.taiwan, 0)}` : ""}` });
  }
  // Change
  {
    const niveau = p.deviseDeLaPart ? 2 : p.couvert ? 0 : p.horsEuro < 10 ? 0 : p.horsEuro < 40 ? 1 : 2;
    r.push({ cle: "change", nom: "Risque de change", niveau,
      explication: p.deviseDeLaPart ? `La part est libellée en ${p.deviseDeLaPart} : sa valeur en euros varie avec cette devise.`
        : p.couvert ? "La part est couverte contre les variations des devises face à l'euro."
        : niveau === 2 ? "Une grande partie des actifs est en devises étrangères non couvertes : leurs variations face à l'euro s'ajoutent à celles des marchés."
        : niveau === 1 ? "Une partie des actifs est en devises étrangères." : "Le fonds est investi presque entièrement en euros.",
      base: p.couvert ? "part couverte (hedged)" : `≈ ${Math.round(p.horsEuro)} % hors euro` });
  }
  // Sectoriel
  {
    const thematique = themes.some(t => t.preuves.includes("le nom du fonds"));
    const premier = p.premierSecteur ? p.premierSecteur.poids : null;
    const niveau = thematique || p.secteurTech >= 30 || premier >= 30 ? 2 : p.secteurTech >= 20 || premier >= 20 ? 1 : p.actions >= 15 && premier === null && p.tech < 5 ? 0 : 0;
    r.push({ cle: "sectoriel", nom: "Risque sectoriel", niveau,
      explication: thematique ? "Fonds thématique : il dépend d'un seul secteur ou d'une seule tendance."
        : niveau === 2 ? "Un secteur pèse très lourd : une crise de ce secteur toucherait fortement le fonds."
        : niveau === 1 ? "Un secteur pèse assez lourd dans le fonds." : "Pas de secteur dominant d'après les données disponibles.",
      base: premier !== null ? `1er secteur : ${p.premierSecteur.nom} ${pct(premier, 0)}` : p.tech >= 5 ? `tech US ≈ ${Math.round(p.tech)} %` : "secteurs non détaillés (analyse des rendements)" });
  }
  // Concentration
  {
    const niveau = p.top10Total === null ? null : p.top10Total >= 40 ? 2 : p.top10Total >= 25 ? 1 : 0;
    r.push({ cle: "concentration", nom: "Risque de concentration", niveau,
      explication: niveau === null ? (p.synthetique ? "Fonds à réplication synthétique : les titres détenus ne reflètent pas l'exposition réelle ; la concentration est celle de l'indice suivi." : "Composition détaillée non disponible : concentration non mesurée.")
        : niveau === 2 ? "Quelques titres font l'essentiel du fonds : si l'un d'eux chute, tout le fonds le ressent."
        : niveau === 1 ? "Les 10 premières lignes pèsent assez lourd." : "Le fonds est réparti entre de nombreux titres.",
      base: p.top10Total !== null ? `10 premières lignes : ${pct(p.top10Total, 0)}` : "non mesuré" });
  }
  // Taux
  {
    const niveau = p.obligLongues >= 30 ? 2 : p.obligLongues + p.obligCourtes >= 15 || p.tech >= 30 ? 1 : 0;
    r.push({ cle: "taux", nom: "Risque de taux", niveau,
      explication: niveau === 2 ? "Le fonds se comporte en bonne partie comme des obligations à long terme : une hausse des taux ferait baisser sa valeur."
        : niveau === 1 ? (p.obligLongues + p.obligCourtes >= 15 ? "Une partie obligataire rend le fonds sensible aux mouvements de taux." : "Les actions de croissance (tech) sont sensibles à la hausse des taux.")
        : "Peu sensible aux mouvements de taux d'intérêt.",
      base: `obligations ≈ ${Math.round(p.obligLongues + p.obligCourtes)} % (dont long terme ≈ ${Math.round(p.obligLongues)} %)` });
  }
  // Réglementaire
  {
    const causes = [];
    if (p.synthetique) causes.push("réplication synthétique (contrat d'échange avec une banque)");
    if (p.secteurTech >= 25) causes.push("forte exposition aux géants de la tech (antitrust, IA, numérique)");
    if (p.emergents >= 15 || p.chine >= 5) causes.push("exposition à la Chine et aux émergents");
    if (/\bPEA\b/i.test(A.entree.nom) && p.usa + p.japon + p.emergents >= 50) causes.push("éligibilité au PEA obtenue par un montage (règles modifiables)");
    const niveau = causes.length >= 2 ? 2 : causes.length ? 1 : 0;
    r.push({ cle: "reglementaire", nom: "Risque réglementaire", niveau,
      explication: niveau ? "Des changements de règles pourraient affecter le fonds ou ses entreprises : " + causes.join(" ; ") + "."
        : "Pas de facteur réglementaire particulier identifié.", base: causes.length ? `${causes.length} facteur(s) identifié(s)` : "aucun facteur identifié" });
  }
  return r;
}

// ---------- Réduire le risque : diagnostic et fonds complémentaires ----------

// Fonds indiciels français à long historique (données complètes dans GECO), un par grand type de placement
const COMPLEMENTS = {
  europe: { isin: "FR0010261198", libelle: "actions européennes", zones: { euro: 50, europe: 50 } },
  zone_euro: { isin: "FR0012739431", libelle: "actions de la zone euro", zones: { euro: 100 } },
  monde_hors_euro: { isin: "FR0010756114", libelle: "actions mondiales hors zone euro", zones: { usa: 76, europe: 12, japon: 7 } },
  monde: { isin: "FR0010315770", libelle: "actions mondiales (pays développés)", zones: { usa: 70, euro: 10, europe: 10, japon: 6 } },
  usa: { isin: "FR0011871128", libelle: "actions américaines", zones: { usa: 100 } },
  japon: { isin: "FR0010245514", libelle: "actions japonaises", zones: { japon: 100 } },
  emergents: { isin: "FR0010429068", libelle: "actions des pays émergents", zones: { emergents: 100 } },
  oblig_3_5: { isin: "FR0007457114", libelle: "obligations d'État de la zone euro à 3-5 ans", zones: {} },
  monetaire: { isin: "FR0010510800", libelle: "placement monétaire en euros", zones: {} }
};
// Pour une zone trop présente : des fonds du même type (actions) qui n'y investissent pas, du plus proche au plus spécialisé
const COMPLEMENTS_PAR_ZONE = {
  usa: ["europe", "zone_euro", "japon"],
  euro: ["monde_hors_euro", "usa", "japon"],
  europe: ["usa", "zone_euro", "japon"],
  japon: ["europe", "monde_hors_euro", "usa"],
  emergents: ["monde", "europe"]
};
const NOM_ZONE = { usa: "les États-Unis", euro: "la zone euro", europe: "l'Europe hors zone euro", japon: "le Japon", emergents: "les pays émergents" };
const A_ZONE = { usa: "aux États-Unis", euro: "à la zone euro", europe: "à l'Europe hors zone euro", japon: "au Japon", emergents: "aux pays émergents" };
const EN_ZONE = { usa: "aux États-Unis", euro: "en zone euro", europe: "en Europe hors zone euro", japon: "au Japon", emergents: "dans les pays émergents" };
const SANS_ZONE = { usa: "sans les États-Unis", euro: "sans la zone euro", europe: "sans l'Europe hors zone euro", japon: "sans le Japon", emergents: "sans les pays émergents" };

// Quelle est la principale concentration du fonds, et quels fonds « du même type » pourraient la réduire ?
function diagnosticRisque(A, p) {
  const zones = { usa: p.usa, euro: p.euro, europe: p.europe, japon: p.japon, emergents: p.emergents };
  const total = Object.values(zones).reduce((s, v) => s + v, 0);
  const obligs = p.obligLongues + p.obligCourtes;
  if (p.monetaire >= 70) return { type: "faible", texte: "Ce fonds se comporte comme un placement monétaire : son risque est déjà très faible. Aucun fonds complémentaire ne le réduirait vraiment." };
  // Fonds mixte : ajouter des actions augmenterait le risque ; seul un placement plus stable le réduit
  if (p.actions >= 30 && p.actions < 60) return { type: "mixte", candidats: ["oblig_3_5", "monetaire"],
    texte: `Ce fonds mélange déjà actions (environ ${Math.round(p.actions)} %) et placements plus stables. Pour réduire encore son risque, il faut renforcer la partie stable (obligations à court terme ou monétaire), au prix d'un rendement attendu plus faible.` };
  if (p.actions >= 60 && total > 0) {
    const [zone, part] = Object.entries(zones).sort((a, b) => b[1] - a[1])[0];
    const partRel = part / total;
    if (partRel >= 0.5) return { type: "zone", zone, part, candidats: COMPLEMENTS_PAR_ZONE[zone],
      texte: `Environ ${Math.round(partRel * 100)} % des actions de ce fonds sont exposées ${A_ZONE[zone]}${zone === "usa" && p.tech >= 15 ? ", dont une bonne part aux grandes valeurs technologiques" : ""} : sa valeur dépend beaucoup d'une seule région. Un fonds du même type (des actions), ${SANS_ZONE[zone]}, répartit ce risque.` };
    return { type: "diversifie", candidats: ["oblig_3_5", "monetaire"],
      texte: "Les actions de ce fonds sont déjà réparties entre plusieurs régions. Pour réduire encore le risque, il faut ajouter un placement plus stable (obligations ou monétaire), au prix d'un rendement attendu plus faible." };
  }
  if (obligs >= 40 && p.obligLongues >= 20) return { type: "taux", candidats: ["oblig_3_5", "monetaire"],
    texte: "Ce fonds est surtout investi en obligations à long terme : il baisse quand les taux d'intérêt montent. Des obligations à échéance plus courte, ou un placement monétaire, y sont beaucoup moins sensibles." };
  return { type: "faible", texte: "Ce fonds est déjà peu risqué (obligations à court terme ou placements monétaires) : aucun fonds complémentaire ne réduirait nettement son risque." };
}

// ---------- Niveau de risque accepté par l'utilisateur ----------

const PROFILS_RISQUE = {
  prudent: { nom: "Prudent", baisseMax: 0.10, sriMax: 2, texte: "je supporte mal de voir mon épargne baisser" },
  equilibre: { nom: "Équilibré", baisseMax: 0.20, sriMax: 4, texte: "j'accepte des baisses temporaires modérées" },
  dynamique: { nom: "Dynamique", baisseMax: 0.35, sriMax: 5, texte: "j'accepte des baisses marquées pour viser plus" },
  offensif: { nom: "Offensif", baisseMax: 0.50, sriMax: 7, texte: "j'accepte de fortes baisses temporaires" }
};

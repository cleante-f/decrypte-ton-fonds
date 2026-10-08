"""
Entreprises dont on suit l'actualité : celles qu'on retrouve le plus souvent parmi les premières lignes des fonds
(indices mondiaux, américains, européens et émergents). Une seule liste pour les deux sources d'actualités.

  cle : (nom affiché, mot cherché dans les titres par NewsData, symboles MarketAux, repère des lignes de fonds)
Les symboles MarketAux ont été vérifiés un par un le 30/09/2026 (symbols=…&filter_entities=true).
MarketAux a été retiré le 01/10/2026 (usage commercial interdit) : ces symboles ne servent plus, ils restent pour mémoire.
Le repère est une expression régulière (syntaxe commune à Python et JavaScript) appliquée au nom des lignes
d'un fonds en majuscules, par exemple « NVIDIA CORP » ou « ASML HOLDING NV ».
"""

ENTREPRISES = {
    "nvidia": ("NVIDIA", "NVIDIA", ["NVDA"], r"\bNVIDIA\b"),
    "apple": ("Apple", "Apple", ["AAPL"], r"\bAPPLE\b"),
    "microsoft": ("Microsoft", "Microsoft", ["MSFT"], r"\bMICROSOFT\b"),
    "amazon": ("Amazon", "Amazon", ["AMZN"], r"\bAMAZON\b"),
    "alphabet": ("Alphabet (Google)", "Google", ["GOOGL", "GOOG"], r"\bALPHABET\b|\bGOOGLE\b"),
    "meta": ("Meta Platforms", "Meta", ["META"], r"\bMETA PLATFORMS\b"),
    "broadcom": ("Broadcom", "Broadcom", ["AVGO"], r"\bBROADCOM\b"),
    "tesla": ("Tesla", "Tesla", ["TSLA"], r"\bTESLA\b"),
    "lilly": ("Eli Lilly", "Eli Lilly", ["LLY"], r"\bLILLY\b"),
    "jpmorgan": ("JPMorgan Chase", "JPMorgan", ["JPM"], r"\bJP ?MORGAN\b"),
    "asml": ("ASML", "ASML", ["ASML"], r"\bASML\b"),
    "sap": ("SAP", "SAP", ["SAP"], r"^SAP\b|\bSAP SE\b"),
    "lvmh": ("LVMH", "LVMH", ["MC.PA"], r"\bLVMH\b|MOET HENNESSY"),
    "totalenergies": ("TotalEnergies", "TotalEnergies", ["TTE"], r"\bTOTALENERGIES\b|^TOTAL SE\b"),
    "schneider": ("Schneider Electric", "Schneider Electric", ["SU.PA"], r"\bSCHNEIDER ELEC"),
    "siemens": ("Siemens", "Siemens", ["SIE.DE"], r"^SIEMENS (AG|N)\b|^SIEMENS$"),
    "airbus": ("Airbus", "Airbus", ["EADSY"], r"\bAIRBUS\b"),
    "sanofi": ("Sanofi", "Sanofi", ["SAN.PA", "SNY"], r"\bSANOFI\b"),
    "novonordisk": ("Novo Nordisk", "Novo Nordisk", ["NVO"], r"\bNOVO NORDISK\b"),
    "nestle": ("Nestlé", "Nestle", ["NESN.SW"], r"\bNESTL[EÉ]"),
    "tsmc": ("TSMC", "TSMC", ["TSM", "2330.TW"], r"TAIWAN SEMICONDUCTOR|\bTSMC\b"),
    "samsung": ("Samsung Electronics", "Samsung", ["005930.KS"], r"\bSAMSUNG ELECTRONICS\b"),
    "tencent": ("Tencent", "Tencent", ["TCEHY", "0700.HK"], r"\bTENCENT\b"),
}

# Titres générés automatiquement sans intérêt pour un épargnant : déclarations de positions de fonds, formulaires SEC,
# comparaisons et « prévisions » automatiques, communiqués d'études de marché
BRUIT = (r"^Form \d|\b(Reduces|Raises|Increases|Decreases|Trims|Lifts|Boosts|Cuts|Sells|Buys|Acquires|Takes|Grows|Lowers|Adds)\b"
         r".*\b(Stake|Position|Holdings|Shares)\b|\bShares (Sold|Bought|Acquired|Purchased) by\b|^[\d,.]+ Shares (of|in)\b"
         r"|\b(Critical|Financial|Head to Head|Head-To-Head) Comparison\b|\bStock Price (Expected|Forecast)\b"
         r"|\bMarket (to Reach|Set to Surpass|Expected to Reach|Size|Share)\b|\bCAGR\b"
         r"|\bConsensus Rating\b|\bNew 52-Week (Low|High)\b")
# Sites qui publient surtout des articles générés automatiquement (constaté dans les réponses du 30/09/2026)
SOURCES_BRUIT = r"^(Defenseworld Net|Ticker Report|Zolmax|Americanbankingnew|Bbns|Watch List News|Openpr\.com|The Lincolnian)"
# Mots ambigus : le titre doit contenir le nom écrit exactement ainsi (« rising yields sap appetite » n'est pas SAP)
CASSE_EXACTE = {"sap": r"\bSAP\b"}

ARTICLES_PAR_ENTREPRISE = 3

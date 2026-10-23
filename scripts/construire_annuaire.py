"""
Construit l'annuaire de tous les fonds trouvables gratuitement → data/annuaire.js (+ data/resume.js et data/firds.js)

Sources (publiques, gratuites et réutilisables) :
  1. GECO (AMF)       : tous les fonds de droit français + fonds étrangers commercialisés en France (OPCVM, et FIA réservés
                        aux investisseurs professionnels)
  2. FIRDS (ESMA)     : registre européen des instruments cotés : ETF cotés sur les places Euronext (Paris, Amsterdam,
                        Bruxelles, Lisbonne, Milan, Dublin, Oslo), identité officielle, places de cotation, ISIN des
                        fonds étrangers retrouvés par leur nom, et tous les autres fonds cotés dans l'Union européenne
                        (non commercialisés en France). Réutilisation autorisée en citant la source (avis juridique de l'ESMA).
  3. Xetra            : liste des instruments négociables à Francfort (Deutsche Börse)
  4. OpenFIGI         : symboles boursiers (CW8, IWDA, CSPX…) des ETF sur les bourses européennes (identifiants du domaine public)
  5. ISO 10383        : noms des places de marché (codes MIC)
  6. GLEIF            : nom officiel et fonds parapluie des fonds cotés non commercialisés en France (licence CC0)
La liste des ETF d'Euronext n'est plus utilisée : ses conditions interdisent de compiler des répertoires sans accord écrit
(vérifié le 01/10/2026).

Lancement (depuis le dossier analyse-fonds) :
    python3 scripts/construire_annuaire.py
Compter environ une heure (OpenFIGI limite les requêtes sans clé : 10 ISIN par requête, 25 requêtes par minute). Uniquement la bibliothèque standard de Python.
À relancer de temps en temps (une fois par mois suffit) pour mettre la liste à jour.
"""
import collections
import csv
import io
import json
import re
import time
import unicodedata
from construire_identite import fiches_gleif, liens_gleif
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

GECO = "https://geco.amf-france.org/back-office"
FIRDS = "https://registers.esma.europa.eu/solr/esma_registers_firds/select"
XETRA = "https://www.xetra.com/resource/blob/1528/fd276b284c2590e4645b8be8e1e5e601/data/t7-xetr-allTradableInstruments.csv"
OPENFIGI = "https://api.openfigi.com/v3/mapping"
ISO_MIC = "https://www.iso20022.org/sites/default/files/ISO10383_MIC/ISO10383_MIC.csv"
DATA = Path(__file__).resolve().parent.parent / "data"
SORTIE = DATA / "annuaire.js"
ENTETES = {"User-Agent": "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://decrypte-ton-fonds.fr/)"}

# Natures GECO réservées aux professionnels ou sans intérêt pour un particulier
NATURES_EXCLUES = {"FCT", "ST", "SFS", "FFS", "SLP", "SPPPICAV"}

# Pays de domiciliation des fonds (les ISIN XS, JE, CH… sont des ETN/ETC, pas des fonds)
PAYS_FONDS = {"IE", "LU", "FR", "DE", "NL", "AT", "BE", "SE", "FI", "IT", "ES", "NO", "DK", "PT"}

# Places Euronext (code MIC du segment dans FIRDS) → libellé utilisé par le site (js/affichage.js, MIC_EURONEXT)
# Dublin (XMSM) est exclu : FIRDS n'y donne que le nom de la structure faîtière (« … ICAV »), sans le nom du fonds ni symbole.
PLACES_EURONEXT = {"XPAR": "Paris", "XAMS": "Amsterdam", "XBRU": "Brussels", "XLIS": "Lisbon", "ETFP": "ETF Plus", "XMLI": "Milan",
                   "XOSL": "Oslo Børs"}
PRIORITE_PLACES = ["XPAR", "XAMS", "XBRU", "XMIL", "XETR", "XLIS", "XOSL", "XMSM", "XDUB"]
# Codes de place OpenFIGI des bourses européennes (vus dans les réponses d'OpenFIGI le 14/10/2026) : Euronext (Paris FP, Amsterdam NA,
# Bruxelles BB, Lisbonne PL, Milan IM, Dublin ID, Oslo NO), Londres LN, SIX Suisse SW et SE, Allemagne GR (toutes ses places),
# Vienne AV, Madrid SM, Stockholm SS, Helsinki FH, Copenhague DC, Varsovie PW, Prague CP, Budapest HB.
# Les plateformes multilatérales (B2, B3, EB, E1, ER, X…) sont écartées : leurs symboles portent des suffixes de devise ou de
# segment (« CSPXCZK », « CSSPXM ») qu'aucun épargnant ne tape.
BOURSES_FIGI = {"FP", "NA", "BB", "PL", "IM", "ID", "NO", "LN", "SW", "SE", "GR", "AV", "SM", "SS", "FH", "DC", "PW", "CP", "HB"}
# Noms courts des grandes places (code MIC opérateur) ; les autres prennent le nom de la liste ISO 10383
NOMS_PLACES = {"XPAR": "Euronext Paris", "XAMS": "Euronext Amsterdam", "XBRU": "Euronext Bruxelles", "XLIS": "Euronext Lisbonne",
               "XMSM": "Euronext Dublin", "XDUB": "Euronext Dublin", "XOSL": "Euronext Oslo", "XMIL": "Borsa Italiana (Euronext Milan)",
               "XETR": "Xetra (Deutsche Börse)", "XFRA": "Börse Frankfurt", "XMUN": "Börse München (gettex)", "XHAM": "Börse Hamburg",
               "XDUS": "Börse Düsseldorf", "XBER": "Börse Berlin", "XSTU": "Börse Stuttgart", "TGAT": "Tradegate",
               "XWBO": "Wiener Börse", "XMAD": "Bolsa de Madrid", "BMEX": "BME (Espagne)", "XSTO": "Nasdaq Stockholm",
               "XHEL": "Nasdaq Helsinki", "XCSE": "Nasdaq Copenhague", "XWAR": "Bourse de Varsovie", "EQTB": "Equiduct"}


def telecharger(url, donnees=None, json_body=None, essais=4):
    entetes = dict(ENTETES)
    corps = None
    if json_body is not None:
        corps = json.dumps(json_body).encode()
        entetes["Content-Type"] = "application/json"
    elif donnees is not None:
        corps = urllib.parse.urlencode(donnees).encode()
    for essai in range(essais):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=corps, headers=entetes), timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:   # trop de requêtes ou serveur surchargé : on patiente
                attente = int(e.headers.get("Retry-After") or 0) or 15 * (essai + 1)
                print(f"    ({e.code}, nouvel essai dans {attente} s)")
                time.sleep(attente)
                continue
            raise
        except OSError:
            if essai == essais - 1:
                raise
            time.sleep(10 * (essai + 1))
    raise RuntimeError(f"pas de réponse : {url[:80]}")


def geco(type_produit):
    """Récupère toute la liste GECO par pages de 1000."""
    resultats, debut, total = [], 0, None
    while total is None or debut < total:
        url = f"{GECO}/funds/getCompartmentsBycriteria?productType={type_produit}&idThirdParty=0"
        page = json.loads(telecharger(url, json_body={"first": debut, "rows": 1000, "sortOrder": 1, "filters": {}}))
        total = page["total"]
        resultats += page.get("compartmentDtos", [])
        debut += 1000
        print(f"  GECO {type_produit} : {min(debut, total)}/{total}")
        time.sleep(0.5)  # politesse envers le serveur de l'AMF
    return resultats


def firds(prefixe_cfi):
    """Toutes les cotations actives (non retirées) d'une famille de CFI : CE = ETF, CI = autres fonds."""
    requete = f"gnr_cfi_code:{prefixe_cfi}* AND type_s:parent AND latest_received_flag:1 AND -status:TERM"
    champs = "isin,mic,gnr_full_name,gnr_notional_curr_code,lei"
    docs, debut, total = [], 0, None
    while total is None or debut < total:
        params = urllib.parse.urlencode({"q": requete, "wt": "json", "rows": 2000, "start": debut, "sort": "id asc", "fl": champs})
        page = json.loads(telecharger(f"{FIRDS}?{params}"))["response"]
        total = page["numFound"]
        docs += page["docs"]
        debut += 2000
        print(f"  FIRDS {prefixe_cfi} : {min(debut, total)}/{total}")
        time.sleep(0.5)
    return docs


def xetra():
    lignes = list(csv.reader(io.StringIO(telecharger(XETRA).decode("utf-8", "replace")), delimiter=";"))
    entete = lignes[2]
    donnees = [dict(zip(entete, l)) for l in lignes[3:]]
    return [d for d in donnees if d.get("Instrument Type") == "ETF"]


def places_iso():
    """Code MIC (segment) → (MIC opérateur, nom, pays, réglementé)."""
    lignes = csv.DictReader(io.StringIO(telecharger(ISO_MIC).decode("utf-8", "replace")))
    brut = {l["MIC"]: l for l in lignes}
    res = {}
    for mic, l in brut.items():
        operateur = l["OPERATING MIC"] or mic
        o = brut.get(operateur, l)
        nom = NOMS_PLACES.get(operateur) or o["MARKET NAME-INSTITUTION DESCRIPTION"].title()
        res[mic] = (operateur, nom, o["ISO COUNTRY CODE (ISO 3166)"], 1 if l["MARKET CATEGORY CODE"] == "RMKT" else 0)
    return res


def symboles_europeens(data):
    """Symboles d'une part sur les bourses européennes (BOURSES_FIGI), triés et sans doublon, d'après la liste `data` d'OpenFIGI."""
    return sorted({d["ticker"] for d in data if d.get("exchCode") in BOURSES_FIGI and d.get("ticker")})


def symboles_openfigi(isins):
    """Symboles boursiers des ETF sur les bourses européennes (sans clé : 10 ISIN par requête, 25 requêtes par minute)."""
    res = {}
    liste = sorted(isins)
    for i in range(0, len(liste), 10):
        lot = liste[i:i + 10]
        reponse = json.loads(telecharger(OPENFIGI, json_body=[{"idType": "ID_ISIN", "idValue": x} for x in lot]))
        for isin, r in zip(lot, reponse):
            res[isin] = symboles_europeens(r.get("data", []))
        if i // 10 % 25 == 24:
            print(f"  OpenFIGI : {i + 10}/{len(liste)}")
        time.sleep(2.6)
    return res


def isins_etf(fonds):
    """ISIN de toutes les parts d'ETF de l'annuaire (ETF étrangers et ETF français de GECO), triés."""
    return sorted({i for f in fonds.values() if f.get("etf") for i in f["i"]})


def ajouter_symboles(fonds, symboles):
    """Ajoute à chaque ETF les symboles de ses parts ({ISIN: [symboles]}), sans retirer ceux qu'il a déjà (Xetra)."""
    for f in fonds.values():
        if f.get("etf"):
            f["tk"] = sorted(set(f["tk"]).union(*(symboles.get(i, []) for i in f["i"])))


# ---------- Fonds étrangers sans ISIN : correspondance prudente par le nom avec FIRDS ----------
# Tous les mots significatifs du nom AMF doivent figurer dans un nom FIRDS, qui ne peut contenir en plus que des mentions
# de part (A2, Acc, EUR…). Une devise citée dans le nom AMF (« MONEY MARKET GBP ») doit être la même.
ABREV = {"fds": "funds", "fd": "fund", "gl": "global", "glb": "global", "glob": "global", "gbl": "global", "intl": "international",
         "int": "international", "mkts": "markets", "mkt": "markets", "eq": "equity", "equ": "equity", "equities": "equity",
         "bd": "bond", "bds": "bonds", "opp": "opportunities", "opps": "opportunities", "sust": "sustainable", "inv": "investment",
         "dyn": "dynamic", "str": "strategic", "sel": "select", "em": "emerging", "eur": "euro", "europ": "europe",
         "tech": "technology", "techn": "technology", "sm": "small", "cos": "companies", "co": "companies",
         "infra": "infrastructure", "corp": "corporate", "govt": "government", "gov": "government", "hy": "high yield",
         "flex": "flexible", "alloc": "allocation", "ass": "asset", "assets": "asset", "bonds": "bond"}
VIDES = {"funds", "fund", "sicav", "sa", "s", "plc", "lux", "luxembourg", "ucits", "the", "of", "and", "et", "de", "du", "des", "la",
         "le", "icav", "fcp", "sub", "subfund", "compartment", "investment", "investments", "i", "ii", "iii", "ltd", "ag", "kvg", "gmbh",
         "selection", "fonds", "series", "portfolio", "portfolios"}
PART = re.compile(r"^(eur|usd|gbp|chf|jpy|sek|nok|dkk|pln|czk|huf|aud|cad|sgd|hkd|cny|rmb|zar|acc|accumulating|accumulation|dis|dist|"
                  r"distributing|distribution|inc|hedged|hdg|h|shares|share|sh|shs|reg|registered|class|cl|cap|capitalisation|units|unit|"
                  r"glob|cert|o|n|on|ord|thes|aussch|inh|namens|anteile|anteil|thesaurierend|ausschuttend|ausschuettend|nom|"
                  r"[a-z]|[a-z]{0,3}\d{1,3}[a-z]{0,3}|ptg|pf|ac|ad|ic|id|rc|rd|zc|zd|mdis|qdis|mdist|qdist|ydis)$")
DEVISES = {"eur", "usd", "gbp", "chf", "jpy", "sek", "nok", "dkk", "pln", "czk", "huf", "aud", "cad", "sgd", "hkd", "cny", "rmb", "zar"}


def mots(nom):
    t = unicodedata.normalize("NFD", nom.lower())
    t = re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn"))
    return [x for m in t.split() for x in ABREV.get(m, m).split()]


def significatifs(nom):
    return {m for m in mots(nom) if m not in VIDES and not PART.match(m)}


def correspondances(fonds_n, cotations_ci):
    noms = collections.defaultdict(set)
    for d in cotations_ci:
        noms[d["isin"]].add(d["gnr_full_name"])
    index, jeux = collections.defaultdict(set), {}
    for isin, ns in noms.items():
        jeux[isin] = [set(mots(n)) for n in ns]
        for n in ns:
            for m in significatifs(n):
                index[m].add(isin)
    trouves = {}
    for cle, nom in fonds_n.items():
        g = significatifs(nom)
        if len(g) < 2:
            continue
        devises_nom = {m for m in mots(nom) if m in DEVISES}
        res = []
        for isin in set.intersection(*(index.get(m, set()) for m in g)):
            for jeu in jeux[isin]:
                if devises_nom and not (devises_nom <= jeu and not (jeu & DEVISES) - devises_nom):
                    continue
                if not {m for m in jeu if m not in g and m not in VIDES and not PART.match(m)}:
                    res.append(isin)
                    break
        if res:
            trouves[cle] = sorted(res)
    # un ISIN rattaché à plusieurs fonds est ambigu : on l'écarte
    compte = collections.Counter(i for v in trouves.values() for i in v)
    return {k: [i for i in v if compte[i] == 1] for k, v in trouves.items() if any(compte[i] == 1 for i in v)}


def isin_retrouves_par_nom(fonds, cotations_ci, par_isin):
    """Étape 4 : ISIN des fonds étrangers vendus en France (GECO) retrouvés par leur nom dans FIRDS. Un ISIN que GECO donne
    déjà à un fonds français n'est jamais proposé : sinon « CARMIGNAC PORTFOLIO - PATRIMOINE » (Luxembourg) recevait
    FR0010135103, l'ISIN de Carmignac Patrimoine, coté à Stuttgart sous le nom « Carmignac Patrimoine »."""
    etrangers = {k: f["n"] for k, f in fonds.items() if f["s"] == "N"}
    return correspondances(etrangers, [d for d in cotations_ci if d["isin"] not in par_isin])


# Fonds réservés aux investisseurs avertis, reconnaissables à leur nom (même règle dans js/fiche-auto.js)
RESERVE_AVERTIS = re.compile(r"\bSIF\b|\bRAIF\b|Specialist Investment Fund|Spezial-?(AIF|fonds|sondervermögen)", re.I)


def plus_lisible(noms):
    """Nom le plus lisible parmi ceux des places de cotation : en casse mixte de préférence, sinon le plus long."""
    return sorted(noms, key=lambda n: (n.isupper(), -len(n), n))[0]


def ajouter_fonds_cotes(fonds, cotations_ce, cotations_ci):
    """Ajoute à l'annuaire les fonds cotés dans l'UE qui n'y sont pas encore (hors ISIN français, que GECO couvre déjà) :
    les ETF une part par entrée (comme les autres ETF), les autres fonds regroupés par compartiment (un LEI = un compartiment,
    sauf si le LEI est celui d'un fonds parapluie). Une part dont le LEI est celui d'un fonds étranger déjà connu par GECO
    est rattachée à ce fonds ; un fonds de GECO encore sans ISIN est rapproché par son nom (même règle prudente que l'étape 4).
    Renvoie les fonds de GECO qui ont reçu des ISIN par leur nom."""
    connus = {i for f in fonds.values() for i in f["i"]}
    lei_de = {d["isin"]: d.get("lei") or "" for d in cotations_ce + cotations_ci}
    noms = collections.defaultdict(set)
    devise = {}
    for d in cotations_ce + cotations_ci:
        noms[d["isin"]].add(d["gnr_full_name"])
        devise.setdefault(d["isin"], d.get("gnr_notional_curr_code", ""))
    nouveaux = lambda docs: sorted({d["isin"] for d in docs if d["isin"] not in connus and not d["isin"].startswith("FR")})

    etf = nouveaux(cotations_ce)
    for isin in etf:
        fonds["E" + isin] = {"s": "E", "n": plus_lisible(noms[isin]), "i": [isin], "pays": isin[:2], "tk": [], "m": [],
                             "dev": devise[isin], "etf": True, "pub": True}
    connus |= set(etf)

    autres = [i for i in nouveaux(cotations_ci) if i not in connus]
    gecos = {}   # LEI → fonds étranger commercialisé en France (GECO) déjà présent
    for cle, f in fonds.items():
        if f["s"] == "N":
            for i in f["i"]:
                if lei_de.get(i):
                    gecos.setdefault(lei_de[i], cle)
    leis = {lei_de[i] for i in autres if lei_de[i]}
    liens, _, parapluies = liens_gleif(leis)
    fiches = fiches_gleif(leis | {l["parapluie"] for l in liens.values() if "parapluie" in l})

    def nom_officiel(lei):
        f = fiches.get(lei)
        if not f or f.get("statut") != "ISSUED":   # LEI non renouvelé : le nom peut être périmé
            return ""
        p = fiches.get(liens.get(lei, {}).get("parapluie", ""), {}).get("nom", "")
        marque = significatifs(p)
        # « Emerging Europe » → « Schroder International Selection Fund – Emerging Europe »
        return f"{p} – {f['nom']}" if p and not marque & significatifs(f["nom"]) else f["nom"]

    groupes, rattaches = collections.defaultdict(list), 0
    for isin in autres:
        lei = lei_de[isin]
        if lei and lei in gecos:
            fonds[gecos[lei]]["i"].append(isin)
            rattaches += 1
        else:
            groupes[lei if lei and lei not in parapluies else "isin:" + isin].append(isin)
    officiels = {cle: "" if cle.startswith("isin:") else nom_officiel(cle) for cle in groupes}

    # Fonds étrangers vendus en France (GECO) encore sans ISIN : rapprochement par le nom officiel (GLEIF) ou ceux des bourses
    candidats = [{"isin": cle, "gnr_full_name": n} for cle, isins in groupes.items()
                 for n in {n for i in isins for n in noms[i]} | ({officiels[cle]} - {""})]
    sans_isin = {k: f["n"] for k, f in fonds.items() if f["s"] == "N" and not f["i"]}
    par_nom = correspondances(sans_isin, candidats)
    for cle_n, cles in par_nom.items():
        fonds[cle_n]["i"] = sorted((i for c in cles for i in groupes.pop(c)), key=lambda i: (devise[i] != "EUR", i))

    for cle, isins in groupes.items():
        isins.sort(key=lambda i: (devise[i] != "EUR", i))   # parts en euros d'abord
        nom = officiels[cle] or plus_lisible(noms[isins[0]])
        fonds["U" + isins[0]] = {"s": "U", "n": nom, "i": isins, "pays": isins[0][:2], "tk": [], "dev": devise[isins[0]],
                                 "pub": not RESERVE_AVERTIS.search(nom)}
    print(f"  {len(etf)} ETF et {len(groupes)} autres fonds ajoutés ; {rattaches} parts rattachées par leur LEI et "
          f"{sum(len(fonds[k]['i']) for k in par_nom)} parts par le nom ({len(par_nom)} fonds) à des fonds étrangers vendus en France")
    return par_nom


# Labels européens des FIA étrangers dans GECO (champs cmpLbl…), dans l'ordre où ils l'emportent ; sinon le FIA est un « FIA »
LABELS_FIA = [("cmpLblEltif", "ELTIF"), ("cmpLblEuveca", "EuVECA"), ("cmpLblEusef", "EuSEF")]


def entree_etrangere(c):
    """Entrée de l'annuaire pour un fonds étranger commercialisé en France (GECO, NON_FR), ou None s'il n'est plus vivant.
    Les OPCVM sont ouverts à tous ; les FIA (famille OFIA de GECO) sont gardés mais marqués réservés (pub False) : leur
    commercialisation en France vise les investisseurs professionnels. Leur type (FIA, ELTIF, EuVECA, EuSEF) va dans « t »."""
    if c.get("cmpStatutCode") != "VIV":
        return None
    entree = {"s": "N", "c": num(c["cmpId"]), "n": c["cmpNom"].strip(), "g": c.get("gestionnaire", ""),
              "pays": c.get("prdDomcltn", ""), "d": c.get("cmpDateCreation") or "", "i": [], "tk": [], "pub": True}
    if c.get("prdFaml") != "OPCVM":
        entree["t"] = next((libelle for champ, libelle in LABELS_FIA if c.get(champ)), "FIA")
        entree["pub"] = False
    return entree


def _lignes_zone(fichier):
    """Lignes d'un fichier de données du site (annuaire ou zone), ou [] s'il n'existe pas."""
    if not fichier.exists():
        return []
    texte = fichier.read_text(encoding="utf-8")
    m = re.search(r"const ANNUAIRE = (\[.*\]);\n", texte, re.S)
    if m:
        return json.loads(m.group(1))
    return json.loads(re.search(r"ANNUAIRE_ZONES\[\"[^\"]+\"\] = (\{.*\});\n", texte, re.S).group(1))["lignes"]


def ecrire_resume(dossier=DATA):
    """Petit résumé pour la page d'accueil (qui ne charge ni l'annuaire ni les zones) : nombre de fonds de tout le site, annuaire
    européen et zones (SEC, registre ESMA). Appelé à la fin de chaque script qui réécrit l'un de ces fichiers."""
    dossier = Path(dossier)
    lignes = _lignes_zone(dossier / "annuaire.js")
    compte = {s: sum(1 for l in lignes if l[0] == s) for s in "GENU"}
    etats_unis, registres = len(_lignes_zone(dossier / "annuaire-etats-unis.js")), len(_lignes_zone(dossier / "annuaire-registres-ue.js"))
    date_annuaire = re.search(r'ANNUAIRE_DATE = "([^"]+)"', (dossier / "annuaire.js").read_text(encoding="utf-8")).group(1)
    resume = {"total": len(lignes) + etats_unis + registres, "francais": compte["G"], "etf": compte["E"], "etrangers": compte["N"],
              "europe": compte["U"], "etats_unis": etats_unis, "registres_ue": registres, "date": date_annuaire}
    (dossier / "resume.js").write_text(
        "/* Généré par scripts/construire_annuaire.py (ecrire_resume) : chiffres affichés sur la page d'accueil (sans charger l'annuaire). */\n"
        f"const RESUME_ANNUAIRE = {json.dumps(resume)};\n", encoding="utf-8")


def num(identifiant):
    """'c28771' → 28771 (plus compact dans le fichier)."""
    return int(identifiant[1:]) if identifiant else 0


def main():
    fonds = {}      # clé → entrée
    par_isin = {}   # ISIN → clé

    print("1/7 GECO – fonds français…")
    for c in geco("FR"):
        if c.get("prdSsNature") in NATURES_EXCLUES or c.get("cmpStatutCode") != "VIV":
            continue
        isins = [i for i in (c.get("sharesIsins") or []) if i]
        principale = c.get("cmpCodeParPrincp")
        if principale:  # la part principale (souvent la plus ancienne) passe en premier
            isins = [principale] + [i for i in isins if i != principale]
        cle = "G" + str(num(c["cmpId"]))
        fonds[cle] = {
            "s": "G", "c": num(c["cmpId"]), "p": num(c["prdId"]),
            "n": c["cmpNom"].strip(), "g": c.get("gestionnaire", ""),
            "k": c.get("cmpClssFndAmfLib") or "", "t": c.get("prdSsNature") or c.get("prdNature") or "",
            "i": isins, "d": c.get("cmpDateCreation") or "", "pays": "FR",
            "pub": c.get("cmpSouscrDedCode") in ("TOUS", None), "tk": [],
        }
        for i in isins:
            par_isin[i] = cle

    print("2/7 FIRDS (ESMA) – ETF et autres fonds cotés dans l'Union européenne…")
    cotations_ce, cotations_ci = firds("CE"), firds("CI")
    iso = places_iso()

    print("3/7 ETF des places Euronext (FIRDS) et de Xetra…")
    etf = {}
    for d in cotations_ce:
        isin, place = d["isin"], PLACES_EURONEXT.get(d["mic"].upper())
        if not place or isin[:2] not in PAYS_FONDS:
            continue
        x = etf.setdefault(isin, {"noms": set(), "tk": set(), "m": set(), "dev": d.get("gnr_notional_curr_code", "")})
        x["noms"].add(d["gnr_full_name"])
        x["m"].add(place)
    print(f"  {len(etf)} ETF cotés sur une place Euronext")
    for e in xetra():
        isin = e.get("ISIN", "")
        if isin[:2] not in PAYS_FONDS:
            continue
        x = etf.setdefault(isin, {"noms": {e["Instrument"]}, "tk": set(), "m": set(), "dev": e.get("Settlement Currency", "")})
        x["tk"].add(e["Mnemonic"])
        x["m"].add("Xetra")
    for isin, x in etf.items():
        # nom le plus lisible : en casse mixte de préférence (Paris, Amsterdam), sinon le plus long
        nom = plus_lisible(x["noms"])
        if isin in par_isin:  # ETF de droit français déjà présent via GECO : on ajoute juste ses symboles
            f = fonds[par_isin[isin]]
            f["tk"] = sorted(set(f["tk"]) | x["tk"])
            f["etf"] = True
            continue
        fonds["E" + isin] = {
            "s": "E", "n": nom, "i": [isin], "pays": isin[:2], "tk": sorted(x["tk"]),
            "m": sorted(x["m"]), "dev": x["dev"], "etf": True, "pub": True,
        }

    print("4/7 GECO – fonds étrangers commercialisés en France (OPCVM et FIA), et leurs ISIN retrouvés dans FIRDS…")
    for c in geco("NON_FR"):
        entree = entree_etrangere(c)
        if entree:
            fonds["N" + str(entree["c"])] = entree
    par_nom = isin_retrouves_par_nom(fonds, cotations_ci, par_isin)
    for cle, isins in par_nom.items():
        fonds[cle]["i"] = isins
    print(f"  ISIN retrouvés pour {len(par_nom)} fonds étrangers ({sum(len(v) for v in par_nom.values())} parts)")

    print("5/7 Fonds cotés dans l'Union européenne mais non commercialisés en France (FIRDS + GLEIF)…")
    par_nom.update(ajouter_fonds_cotes(fonds, cotations_ce, cotations_ci))

    a_chercher = isins_etf(fonds)
    print(f"6/7 Symboles boursiers des ETF sur les bourses européennes (OpenFIGI, {len(a_chercher)} parts)…")
    ajouter_symboles(fonds, symboles_openfigi(a_chercher))

    print("7/7 Écriture des fichiers…")
    # Format compact : un tableau par fonds, pour garder un fichier léger
    # [source, idCompartiment, idProduit, nom, gestionnaire, classification, nature, isins, date, pays, tickers, marchés, devise, etf, public]
    lignes = []
    for f in fonds.values():
        lignes.append([
            f["s"], f.get("c", 0), f.get("p", 0), f["n"], f.get("g", ""), f.get("k", ""), f.get("t", ""),
            " ".join(f["i"]), f.get("d", ""), f.get("pays", ""), " ".join(f.get("tk", [])),
            ", ".join(f.get("m", [])), f.get("dev", ""), 1 if f.get("etf") else 0, 1 if f.get("pub") else 0,
        ])
    lignes.sort(key=lambda l: l[3].lower())
    SORTIE.write_text(
        "/* Généré automatiquement par scripts/construire_annuaire.py — ne pas modifier à la main.\n"
        " * Sources : AMF (base GECO), ESMA (registre FIRDS), Deutsche Börse (Xetra), OpenFIGI. */\n"
        f"const ANNUAIRE_DATE = \"{date.today().isoformat()}\";\n"
        "const ANNUAIRE = " + json.dumps(lignes, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    compte = {s: sum(1 for l in lignes if l[0] == s) for s in "GENU"}
    ecrire_resume()

    # Identité officielle (ESMA) des fonds étrangers de l'annuaire : LEI, devise, places de cotation dans l'UE
    par_isin_firds = collections.defaultdict(list)
    for d in cotations_ce + cotations_ci:
        par_isin_firds[d["isin"]].append(d)
    utiles = {i for f in fonds.values() if f["s"] in "ENU" for i in f["i"]}
    places_utilisees, fiches = {}, {}
    for isin in sorted(utiles & set(par_isin_firds)):
        cot = par_isin_firds[isin]
        operateurs = collections.Counter()
        for d in cot:
            p = iso.get(d["mic"].upper())
            if p:
                operateurs[p[0]] += 1
                places_utilisees[p[0]] = [p[1], p[2], max(p[3], places_utilisees.get(p[0], [0, 0, 0])[2])]
        lei = next((d.get("lei") for d in cot if d.get("lei")), "")
        # 6 places au plus et leur nombre total (fichier plus léger) : d'abord celles qui parlent à un épargnant français
        # (Euronext Paris, les autres places Euronext, Xetra), puis les autres marchés réglementés, puis les plus actives
        classees = sorted(operateurs, key=lambda m: (PRIORITE_PLACES.index(m) if m in PRIORITE_PLACES else len(PRIORITE_PLACES),
                                                     -places_utilisees[m][2], -operateurs[m]))
        fiches[isin] = [lei, cot[0].get("gnr_notional_curr_code", ""), classees[:6], len(classees)]
    (DATA / "firds.js").write_text(
        "/* Généré par scripts/construire_annuaire.py — ne pas modifier à la main.\n"
        " * Registre FIRDS de l'ESMA (réutilisation autorisée en citant la source) et liste ISO 10383 des places de marché.\n"
        " * fonds : ISIN → [LEI, devise, 6 principales places (MIC opérateur, marchés réglementés d'abord), nombre total de places]\n"
        " * places : MIC → [nom, pays, marché réglementé (1) ou plateforme (0)] ; parNom : fonds dont l'ISIN vient du nom */\n"
        "const FIRDS = " + json.dumps({"maj": date.today().isoformat(), "fonds": fiches, "places": places_utilisees,
                                       "parNom": sorted(par_nom)}, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8")
    print(f"\n✓ {len(lignes)} fonds écrits dans {SORTIE.name} ({SORTIE.stat().st_size / 1e6:.1f} Mo)")
    print(f"  français (GECO) : {compte['G']} · ETF étrangers : {compte['E']} · étrangers vendus en France : {compte['N']}"
          f" · autres fonds cotés en Europe : {compte['U']}")
    print(f"✓ identité ESMA de {len(fiches)} ISIN dans firds.js ({(DATA / 'firds.js').stat().st_size / 1e3:.0f} Ko)")


if __name__ == "__main__":
    main()

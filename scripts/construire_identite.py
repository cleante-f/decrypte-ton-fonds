"""
Complète l'identité des fonds étrangers de l'annuaire → data/identite.js

Sources (publiques, gratuites et réutilisables) :
  1. BCE – liste des fonds d'investissement de la zone euro (mensuelle) : ETF ou non, politique d'investissement
     (actions, obligations…), conformité UCITS, taille de l'encours (par tranche), société de gestion.
     Réutilisation libre en citant la BCE (avis « Disclaimer & copyright » de la BCE).
  2. GLEIF – registre mondial des identifiants LEI (licence CC0, sans restriction) : fonds parapluie dont le fonds est
     un compartiment, fonds maître d'un fonds nourricier, date de création de l'entité.
  3. ESMA – registre FITRS des calculs de transparence MiFID (réutilisation autorisée en citant la source) :
     montant moyen échangé chaque jour en bourse dans l'Union européenne et caractère « liquide ».
  4. ESMA – registre de la commercialisation transfrontière des OPCVM et FIA (réutilisation autorisée en citant la source) :
     pays où chaque fonds est notifié.
  5. AMF – liste des sociétés de gestion de portefeuille agréées (data.gouv.fr, Licence Ouverte 2.0) → data/societes.js
Le lien se fait par le LEI de chaque part, lu dans data/firds.js (scripts/construire_annuaire.py).

Lancement (depuis le dossier analyse-fonds, après construire_annuaire.py) :
    python3 scripts/construire_identite.py
Compter 3 à 5 minutes (deux gros fichiers : BCE ~70 Mo, GLEIF ~25 Mo). Uniquement la bibliothèque standard de Python.
À relancer une fois par mois (tâche .github/workflows/identite.yml).
"""
import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
SORTIE = DATA / "identite.js"
SORTIE_SOCIETES = DATA / "societes.js"
ENTETES = {"User-Agent": "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)"}
BCE_PAGE = "https://www.ecb.europa.eu/stats/financial_corporations/list_of_financial_institutions/html/index.en.html"
GLEIF_COPIES = "https://leidata-preview.gleif.org/api/v2/golden-copies/publishes/latest"
GLEIF_API = "https://api.gleif.org/api/v1/lei-records"
FITRS = "https://registers.esma.europa.eu/solr/esma_registers_fitrs_equities/select"
ESMA_CBDIF = "https://registers.esma.europa.eu/solr/esma_registers_funds_cbdif/select"
SGP_FICHE = "https://www.data.gouv.fr/api/1/datasets/liste-des-societes-de-gestion-de-portefeuille-sgp-agreees-par-lamf/"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Codes courts (le site les traduit en français : js/fiche-auto.js)
POLITIQUES = {"Equities": "A", "Bonds": "O", "Mixed": "M", "Real estate": "I", "Loan/credit": "C", "Hedge": "H",
              "Infrastracture": "N", "Infrastructure": "N", "Commodity": "P", "Other": "X"}
TRANCHES = ["0 - 1.000.000", "1.000.001 - 5.000.000", "5.000.001 - 50.000.000", "50.000.001 - 100.000.000",
            "100.000.001 - 500.000.000", "500.000.001 - 1.000.000.000", "1.000.000.001 - 5.000.000.000", ">5.000.000.001"]
MOTS_MAJUSCULES = {"SICAV", "ICAV", "UCITS", "ETF", "MSCI", "ESG", "SRI", "USA", "US", "UK", "EUR", "USD", "AXA", "BNP", "DWS",
                   "UBS", "HSBC", "JPM", "SPDR", "ETFS", "AM", "FTSE", "SICAF", "SA", "AG", "SE", "NV", "BV", "KVG", "LU", "IE",
                   "SSGA", "PIMCO", "FIL", "KBC", "ING", "SEB", "DNB", "LGIM", "CPR", "OFI", "LFDE", "ODDO", "BHF", "GAM", "EFG",
                   "AB", "GS", "JP", "BCV", "ABN", "AMRO", "CM", "CIC", "BPCE", "LBPAM", "LO", "SARL", "SCA", "PLC", "LLC", "LP",
                   "IMI", "REIT", "SIF", "RAIF", "UCI", "AI", "EMU", "ETC", "UBAM", "MFS", "CT", "DB", "KBI", "NN", "BL", "CS"}
ROMAINS = re.compile(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$")
MARQUES = {"ISHARES": "iShares", "BLACKROCK": "BlackRock", "JPMORGAN": "JPMorgan", "WISDOMTREE": "WisdomTree", "VANECK": "VanEck",
           "HANETF": "HANetf", "GLOBALX": "Global X", "FRANKLINTEMPLETON": "Franklin Templeton"}


def telecharger(url, essais=4):
    for essai in range(essais):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=ENTETES), timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            attente = int(e.headers.get("Retry-After") or 0) or 15 * (essai + 1)
            print(f"    ({e.code}, nouvel essai dans {attente} s)")
            time.sleep(attente)
        except OSError:
            if essai == essais - 1:
                raise
            time.sleep(10 * (essai + 1))
    raise RuntimeError(f"pas de réponse : {url[:80]}")


def lire_js(fichier, variable):
    texte = (DATA / fichier).read_text(encoding="utf-8")
    return json.loads(re.search(rf"const {variable} = (.*?);\n", texte, re.S).group(1))


def joli(nom):
    """« ISHARES III PUBLIC LIMITED COMPANY » → « Ishares III Public Limited Company » (les noms GLEIF sont souvent en capitales)."""
    if not nom or not nom.isupper():
        return nom or ""
    def partie(m):
        nu = re.sub(r"[^A-Z]", "", m)
        if nu in MARQUES:
            return m.replace(nu, MARQUES[nu])
        if nu in MOTS_MAJUSCULES or ROMAINS.match(nu) or "." in m or "&" in m:   # sigles, chiffres romains, « S.A. », « S&P »
            return m
        # première lettre en majuscule, même après une parenthèse : « (LUXEMBOURG) » → « (Luxembourg) »
        return re.sub(r"[a-zà-ÿ]", lambda x: x.group(0).upper(), m.lower(), count=1)

    # chaque partie d'un mot composé à part : « SICAV-SIF » reste en capitales, « NON-FINANCIAL » → « Non-Financial »
    mots = ["-".join(partie(x) for x in m.split("-")) for m in nom.split()]
    return re.sub(r" (PLC|Public Limited Company)$", " plc", " ".join(mots))


def cle_societe(nom):
    """Clé commune de normalisation des noms de sociétés de gestion : accents retirés, majuscules, [A-Z0-9] uniquement.
    « Société Générale » → « SOCIETEGENERALE », None → « »."""
    s = unicodedata.normalize("NFD", nom or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


# ---------- 1. BCE : liste des fonds d'investissement ----------
def liste_bce():
    page = telecharger(BCE_PAGE).decode("utf-8", "replace")
    annees = sorted(set(re.findall(r"/stats/pdf/money/ecb\.ifd_overview_(\d{4})\.en\.zip", page)))
    url = f"https://www.ecb.europa.eu/stats/pdf/money/ecb.ifd_overview_{annees[-1]}.en.zip"
    print(f"  {url.rsplit('/', 1)[1]}…")
    archive = zipfile.ZipFile(io.BytesIO(telecharger(url)))
    xlsx = sorted(n for n in archive.namelist() if n.endswith(".xlsx"))[-1]   # le mois le plus récent
    classeur = zipfile.ZipFile(io.BytesIO(archive.read(xlsx)))
    chaines = []
    for _, el in ET.iterparse(classeur.open("xl/sharedStrings.xml")):
        if el.tag == NS + "si":
            chaines.append("".join(t.text or "" for t in el.iter(NS + "t")))
            el.clear()

    def colonne(ref):
        n = 0
        for ch in ref:
            if not ch.isalpha():
                break
            n = n * 26 + ord(ch) - 64
        return n - 1

    entete, fonds = None, {}
    for _, el in ET.iterparse(classeur.open("xl/worksheets/sheet1.xml")):
        if el.tag != NS + "row":
            continue
        ligne = {}
        for c in el.iter(NS + "c"):
            v, t = c.find(NS + "v"), c.get("t")
            if t == "s" and v is not None:
                x = chaines[int(v.text)]
            elif t == "inlineStr":
                x = "".join(e.text or "" for e in c.iter(NS + "t"))
            else:
                x = v.text if v is not None else ""
            ligne[colonne(c.get("r"))] = x
        el.clear()
        if entete is None:
            entete = {v: k for k, v in ligne.items()}
            continue
        champ = lambda nom: ligne.get(entete[nom], "").strip()
        lei = champ("LEI")
        if lei:
            fonds[lei] = {
                "etf": champ("Type of investment fund").startswith("Exchange traded"),
                "politique": POLITIQUES.get(champ("Investment policy"), ""),
                "ucits": champ("UCITS compliance") == "UCITS compliant",
                "tranche": TRANCHES.index(champ("Net Asset Value size class")) + 1 if champ("Net Asset Value size class") in TRANCHES else 0,
                "date": champ("Net Asset Value date"),
                "gestion": joli(champ("Management company name")),
            }
    print(f"  {len(fonds)} fonds de la zone euro ({xlsx.rsplit('/', 1)[1]})")
    return fonds


# ---------- 2. GLEIF : liens entre entités (parapluie, maître) et dates de création ----------
def liens_gleif(leis):
    """Liens actifs des LEI donnés ({LEI: {parapluie, maitre, gestion}}), date du fichier, et ensemble de tous les fonds parapluies."""
    meta = json.loads(telecharger(GLEIF_COPIES))["data"]
    url = meta["rr"]["full_file"]["csv"]["url"]
    print(f"  fichier des relations du {meta['publish_date'][:10]}…")
    archive = zipfile.ZipFile(io.BytesIO(telecharger(url)))
    liens, parapluies = {}, set()
    with archive.open(archive.namelist()[0]) as f:
        for l in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
            if l["Relationship.RelationshipStatus"] != "ACTIVE":
                continue
            if l["Relationship.RelationshipType"] == "IS_SUBFUND_OF":
                parapluies.add(l["Relationship.EndNode.NodeID"])
            debut = l["Relationship.StartNode.NodeID"]
            if debut not in leis:
                continue
            type_lien = {"IS_SUBFUND_OF": "parapluie", "IS_FEEDER_TO": "maitre", "IS_FUND-MANAGED_BY": "gestion"}.get(
                l["Relationship.RelationshipType"])
            if type_lien:
                liens.setdefault(debut, {})[type_lien] = l["Relationship.EndNode.NodeID"]
    return liens, meta["publish_date"][:10], parapluies


def fiches_gleif(leis):
    """Nom, date de création et statut de chaque LEI (200 par requête)."""
    res, liste = {}, sorted(leis)
    for i in range(0, len(liste), 200):
        lot = liste[i:i + 200]
        params = urllib.parse.urlencode({"filter[lei]": ",".join(lot), "page[size]": 200})
        for r in json.loads(telecharger(f"{GLEIF_API}?{params}"))["data"]:
            e = r["attributes"]["entity"]
            res[r["id"]] = {"nom": joli(e["legalName"]["name"]), "creation": (e.get("creationDate") or "")[:10],
                            "statut": r["attributes"]["registration"].get("status", "")}
        time.sleep(1.2)   # l'API GLEIF accepte 60 requêtes par minute
    return res


# ---------- 3. ESMA FITRS : liquidité en bourse ----------
def liquidite(isins):
    res, liste = {}, sorted(isins)
    for i in range(0, len(liste), 50):
        lot = liste[i:i + 50]
        params = urllib.parse.urlencode({
            "q": f"isin:({' OR '.join(lot)}) AND methodology:YEAR", "wt": "json", "rows": 1000,
            "fl": "isin,liquidity_flag,adt,calculation_period_to,non_applicable_flag"})
        for d in json.loads(telecharger(f"{FITRS}?{params}"))["response"]["docs"]:
            annee = int(d["calculation_period_to"][:4])
            if d.get("non_applicable_flag") == "T" or d.get("adt") is None or annee <= res.get(d["isin"], [0, 0, 0])[2]:
                continue
            res[d["isin"]] = [float(f"{d['adt'] / 1e6:.3g}"), 1 if d.get("liquidity_flag") == "Liquid" else 0, annee]
        time.sleep(0.5)
        if i // 50 % 20 == 19:
            print(f"  FITRS : {i + 50}/{len(liste)}")
    return res


# ---------- 4. ESMA : commercialisation transfrontière (pays où chaque fonds est notifié) ----------
def notifies_france(docs):
    """LEI des fonds dont la liste des pays d'accueil contient la France (documents du registre ESMA)."""
    return {d["funds_lei"] for d in docs if d.get("funds_lei") and "FR" in (d.get("funds_host_country_codes") or [])}


def commercialisation(leis):
    """LEI notifiés pour la commercialisation en France, parmi les LEI donnés (100 par requête).
    Un LEI absent du registre ou sans « FR » n'est pas retenu : on ne sait rien de plus."""
    res, liste = set(), sorted(leis)
    for i in range(0, len(liste), 100):
        lot = liste[i:i + 100]
        params = urllib.parse.urlencode({
            "q": f"funds_lei:({' OR '.join(lot)})", "wt": "json", "rows": 1000,
            "fl": "funds_lei,funds_host_country_codes"})
        res |= notifies_france(json.loads(telecharger(f"{ESMA_CBDIF}?{params}"))["response"]["docs"])
        time.sleep(0.5)
        if i // 100 % 20 == 19:
            print(f"  ESMA : {i + 100}/{len(liste)}")
    return res


# ---------- 5. AMF : sociétés de gestion de portefeuille agréées ----------
def site_propre(texte):
    """Adresse de site internet saisie par l'AMF, ou « » si ce n'en est pas une (« NA », e-mail, « Under%20construction »…)."""
    texte = (texte or "").strip()
    return texte if re.match(r"^(https?://)?[A-Za-z0-9._-]+\.[A-Za-z]{2,}(/\S*)?$", texte) else ""


def lire_sgp(texte):
    """Lit le CSV de l'AMF (texte déjà décodé). Renvoie ({clé du nom: [n° AMF, début d'autorisation, site, statut]}, date de publication).
    Une entrée par n° AMF (première ligne gardée) ; si deux n° AMF ont le même nom normalisé, celui qui est « Vivant » l'emporte."""
    lecteur = csv.DictReader(io.StringIO(texte), delimiter=";")
    if "no_amf" not in (lecteur.fieldnames or []):
        raise ValueError("format du fichier AMF inattendu : colonne no_amf absente")
    vus, societes, publication = set(), {}, ""
    for l in lecteur:
        publication = max(publication, l.get("date_de_publication") or "")
        no = l["no_amf"]
        cle = cle_societe(l.get("entite_nom"))
        if no in vus or not cle:
            continue
        vus.add(no)
        fiche = [no, l.get("date_debut_autorisation") or "", site_propre(l.get("site_internet")), l.get("statut") or ""]
        if cle not in societes or (societes[cle][3] != "Vivant" and fiche[3] == "Vivant"):
            societes[cle] = fiche
    return societes, publication


def societes_amf():
    """Liste des sociétés de gestion agréées publiée sur data.gouv.fr → (sociétés, date de publication)."""
    fiche = json.loads(telecharger(SGP_FICHE))
    url = next((r["url"] for r in fiche["resources"] if r.get("format") == "csv"), None)
    if not url:
        raise ValueError("aucune ressource CSV dans la fiche data.gouv.fr")
    return lire_sgp(telecharger(url).decode("utf-8-sig"))


def ecrire_societes(societes, publication, fichier=SORTIE_SOCIETES):
    contenu = {"maj": date.today().isoformat(), "publication": publication, "societes": societes}
    fichier.write_text(
        "/* Généré par scripts/construire_identite.py — ne pas modifier à la main.\n"
        " * Source : AMF – liste des sociétés de gestion de portefeuille agréées, data.gouv.fr (Licence Ouverte 2.0).\n"
        " * societes : clé du nom (cle_societe) → [n° AMF, début d'autorisation, site internet, statut] */\n"
        "const SOCIETES = " + json.dumps(contenu, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + ";\n", encoding="utf-8")


def mettre_a_jour_societes(fichier=SORTIE_SOCIETES):
    """Réécrit la liste des sociétés agréées. Quoi qu'il arrive (panne de data.gouv.fr, fichier au format changé, liste trop courte…),
    l'ancien fichier est gardé et l'erreur seulement signalée : une panne de l'AMF ne doit jamais empêcher d'écrire identite.js."""
    try:
        societes, publication = societes_amf()
        if len(societes) < 300:
            raise ValueError(f"seulement {len(societes)} sociétés")
        ecrire_societes(societes, publication, fichier)
        print(f"✓ {len(societes)} sociétés de gestion (publication AMF du {publication}) → {fichier.name} "
              f"({fichier.stat().st_size / 1e3:.0f} Ko)")
    except Exception as e:
        print(f"! liste AMF non mise à jour ({e}) : ancien fichier gardé", file=sys.stderr)


def main():
    annuaire = lire_js("annuaire.js", "ANNUAIRE")
    firds = lire_js("firds.js", "FIRDS")
    isins = {i for l in annuaire if l[0] in "ENU" for i in (l[7] or "").split()}
    lei_de = {i: f[0] for i, f in firds["fonds"].items() if i in isins and f[0]}
    leis = set(lei_de.values())
    print(f"{len(isins)} parts de fonds étrangers, {len(leis)} LEI distincts")

    print("1/5 BCE – liste des fonds d'investissement…")
    bce = liste_bce()
    print("2/5 GLEIF – fonds parapluies, fonds maîtres, dates de création…")
    liens, date_gleif, _ = liens_gleif(leis)
    autres = {x for l in liens.values() for x in l.values()}
    fiches = fiches_gleif(leis | autres)
    print("3/5 ESMA FITRS – montants échangés en bourse…")
    liq = liquidite(isins)
    print("4/5 ESMA – commercialisation transfrontière des fonds…")
    notif = commercialisation(leis)

    # Table des noms (sociétés de gestion, parapluies, maîtres) pour alléger le fichier
    noms, index_noms = [], {}

    def nom_id(nom):
        if not nom:
            return -1
        if nom not in index_noms:
            index_noms[nom] = len(noms)
            noms.append(nom)
        return index_noms[nom]

    fonds = {}
    for lei in sorted(leis):
        b, l, g = bce.get(lei), liens.get(lei, {}), fiches.get(lei, {})
        if not (b or l or g):
            continue
        gestion = (b or {}).get("gestion") or fiches.get(l.get("gestion"), {}).get("nom", "")
        fonds[lei] = [
            nom_id(gestion), nom_id(fiches.get(l.get("parapluie"), {}).get("nom", "")),
            (b or {}).get("politique", ""), 1 if b and b["etf"] else 0, 1 if b and b["ucits"] else 0,
            (b or {}).get("tranche", 0), g.get("creation", ""), nom_id(fiches.get(l.get("maitre"), {}).get("nom", "")),
        ]
    dates_bce = sorted({b["date"] for b in bce.values() if b["date"]})
    # année de calcul FITRS la plus fréquente : notée une fois, et seulement pour les parts qui en diffèrent
    annees = [v[2] for v in liq.values()]
    annee_fitrs = max(set(annees), key=annees.count) if annees else 0
    liq = {i: v if v[2] != annee_fitrs else v[:2] for i, v in liq.items()}
    contenu = {"maj": date.today().isoformat(), "bce": dates_bce[-1] if dates_bce else "", "gleif": date_gleif, "fitrs": annee_fitrs,
               "esma": date.today().isoformat(), "noms": noms, "fonds": fonds, "liquidite": {i: v for i, v in sorted(liq.items())},
               "notifFR": sorted(notif)}
    SORTIE.write_text(
        "/* Généré par scripts/construire_identite.py — ne pas modifier à la main.\n"
        " * Sources : BCE (liste des fonds d'investissement), GLEIF (licence CC0), ESMA (registre FITRS).\n"
        " * fonds : LEI → [société de gestion, fonds parapluie, fonds maître (index dans noms) : voir l'ordre ci-dessous]\n"
        " *   [gestion, parapluie, politique (A actions, O obligations, M mixte, I immobilier, C crédit, H alternatif,\n"
        " *    N infrastructures, P matières premières, X autre), ETF (1/0), UCITS (1/0), tranche d'encours (1 à 8), création, maître]\n"
        " * liquidite : ISIN → [montant moyen échangé par jour en bourse dans l'UE (M€), liquide (1/0), année du calcul si ≠ fitrs]\n"
        " * notifFR : LEI notifiés pour la commercialisation en France (ESMA, registre de la commercialisation transfrontière) ; esma : date du relevé */\n"
        "const IDENTITE = " + json.dumps(contenu, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"\n✓ {len(fonds)} fonds (BCE : {sum(1 for x in leis if x in bce)}, parapluie GLEIF : "
          f"{sum(1 for x in leis if 'parapluie' in liens.get(x, {}))}, nourriciers : {sum(1 for x in leis if 'maitre' in liens.get(x, {}))}), "
          f"liquidité de {len(liq)} parts, {len(notif)} notifiés pour la France (ESMA) → {SORTIE.name} ({SORTIE.stat().st_size / 1e3:.0f} Ko)")

    print("5/5 AMF – sociétés de gestion agréées…")
    mettre_a_jour_societes()


if __name__ == "__main__":
    main()

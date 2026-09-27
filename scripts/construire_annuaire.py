"""
Construit l'annuaire de tous les fonds trouvables gratuitement → data/annuaire.js

Sources (toutes publiques et gratuites) :
  1. GECO (AMF)  : tous les fonds de droit français + fonds étrangers commercialisés en France
  2. Euronext    : liste des ETF cotés (Paris, Amsterdam, Bruxelles, Milan, Dublin, Lisbonne, Oslo)
  3. Xetra       : liste des ETF cotés à Francfort

Lancement (depuis le dossier analyse-fonds) :
    python3 scripts/construire_annuaire.py

Uniquement la bibliothèque standard de Python : rien à installer.
À relancer de temps en temps (une fois par mois suffit) pour mettre la liste à jour.
"""
import csv
import io
import json
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

GECO = "https://geco.amf-france.org/back-office"
EURONEXT = "https://live.euronext.com/en/product_directory/data/etf-all-markets/download"
XETRA = "https://www.xetra.com/resource/blob/1528/fd276b284c2590e4645b8be8e1e5e601/data/t7-xetr-allTradableInstruments.csv"
SORTIE = Path(__file__).resolve().parent.parent / "data" / "annuaire.js"
ENTETES = {"User-Agent": "Mozilla/5.0 (projet personnel d'analyse de fonds)"}

# Natures GECO réservées aux professionnels ou sans intérêt pour un particulier
NATURES_EXCLUES = {"FCT", "ST", "SFS", "FFS", "SLP", "SPPPICAV"}

# Pays de domiciliation des fonds (les ISIN XS, JE, CH… sont des ETN/ETC, pas des fonds)
PAYS_FONDS = {"IE", "LU", "FR", "DE", "NL", "AT", "BE", "SE", "FI", "IT", "ES", "NO", "DK", "PT"}


def telecharger(url, donnees=None, json_body=None):
    entetes = dict(ENTETES)
    corps = None
    if json_body is not None:
        corps = json.dumps(json_body).encode()
        entetes["Content-Type"] = "application/json"
    elif donnees is not None:
        corps = urllib.parse.urlencode(donnees).encode()
    req = urllib.request.Request(url, data=corps, headers=entetes)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


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


def euronext():
    marches = "ETFP,XPAR,XAMS,XBRU,XLIS,XMLI,XDUB,XOSL,ETLX"
    brut = telecharger(f"{EURONEXT}?mics={urllib.parse.quote(marches)}",
                       donnees={"args[fe_type]": "csv", "args[fe_layout]": "ver",
                                "args[fe_decimal_separator]": ".", "args[fe_date_format]": "d/m/Y"})
    lignes = list(csv.reader(io.StringIO(brut.decode("utf-8-sig")), delimiter=";"))
    entete = lignes[0]
    return [dict(zip(entete, l)) for l in lignes[1:] if len(l) == len(entete)]


def xetra():
    lignes = list(csv.reader(io.StringIO(telecharger(XETRA).decode("utf-8", "replace")), delimiter=";"))
    entete = lignes[2]
    donnees = [dict(zip(entete, l)) for l in lignes[3:]]
    return [d for d in donnees if d.get("Instrument Type") == "ETF"]


def num(identifiant):
    """'c28771' → 28771 (plus compact dans le fichier)."""
    return int(identifiant[1:]) if identifiant else 0


def main():
    fonds = {}      # clé → entrée
    par_isin = {}   # ISIN → clé

    print("1/3 GECO – fonds français…")
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

    print("2/3 Euronext + Xetra – ETF…")
    etf = {}
    for e in euronext():
        isin = e.get("ISIN", "")
        if isin[:2] not in PAYS_FONDS:
            continue
        x = etf.setdefault(isin, {"n": e["Instrument Fullname"], "tk": set(), "m": set(), "dev": e.get("Currency", "")})
        x["tk"].add(e["Symbol"])
        x["m"].add(e["Market"].replace("Euronext ", ""))
    for e in xetra():
        isin = e.get("ISIN", "")
        if isin[:2] not in PAYS_FONDS:
            continue
        x = etf.setdefault(isin, {"n": e["Instrument"], "tk": set(), "m": set(), "dev": e.get("Settlement Currency", "")})
        x["tk"].add(e["Mnemonic"])
        x["m"].add("Xetra")
    for isin, x in etf.items():
        if isin in par_isin:  # ETF de droit français déjà présent via GECO : on ajoute juste ses tickers
            f = fonds[par_isin[isin]]
            f["tk"] = sorted(set(f["tk"]) | x["tk"])
            f["etf"] = True
            continue
        fonds["E" + isin] = {
            "s": "E", "n": x["n"], "i": [isin], "pays": isin[:2], "tk": sorted(x["tk"]),
            "m": sorted(x["m"]), "dev": x["dev"], "etf": True, "pub": True,
        }

    print("3/3 GECO – fonds étrangers commercialisés en France (sans ISIN)…")
    for c in geco("NON_FR"):
        if c.get("cmpStatutCode") != "VIV" or c.get("prdFaml") != "OPCVM":
            continue
        fonds["N" + str(num(c["cmpId"]))] = {
            "s": "N", "c": num(c["cmpId"]), "n": c["cmpNom"].strip(), "g": c.get("gestionnaire", ""),
            "pays": c.get("prdDomcltn", ""), "d": c.get("cmpDateCreation") or "", "i": [], "tk": [], "pub": True,
        }

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

    contenu = (
        "/* Généré automatiquement par scripts/construire_annuaire.py — ne pas modifier à la main.\n"
        " * Sources : AMF (base GECO), Euronext, Deutsche Börse (Xetra). */\n"
        f"const ANNUAIRE_DATE = \"{date.today().isoformat()}\";\n"
        "const ANNUAIRE = " + json.dumps(lignes, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    SORTIE.write_text(contenu, encoding="utf-8")
    compte = {s: sum(1 for l in lignes if l[0] == s) for s in "GEN"}
    # Petit résumé pour la page d'accueil (qui ne charge pas tout l'annuaire)
    resume = {"total": len(lignes), "francais": compte["G"], "etf": compte["E"], "etrangers": compte["N"], "date": date.today().isoformat()}
    (SORTIE.parent / "resume.js").write_text(
        "/* Généré par scripts/construire_annuaire.py : chiffres affichés sur la page d'accueil (sans charger tout l'annuaire). */\n"
        f"const RESUME_ANNUAIRE = {json.dumps(resume)};\n", encoding="utf-8")
    print(f"\n✓ {len(lignes)} fonds écrits dans {SORTIE.name} ({SORTIE.stat().st_size / 1e6:.1f} Mo)")
    print(f"  français (GECO) : {compte['G']} · ETF étrangers : {compte['E']} · étrangers sans ISIN : {compte['N']}")


if __name__ == "__main__":
    main()

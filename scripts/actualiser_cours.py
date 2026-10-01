"""
Relève chaque jour le cours de clôture des fonds étrangers de l'annuaire → data/cours/

Source : Deutsche Börse, données « différées » publiées gratuitement 15 minutes après chaque transaction (MiFIR art. 13)
sur https://mfs.deutsche-boerse.com (Xetra et Börse Frankfurt). Licence gratuite tant que les données ne sont ni revendues
ni intégrées à un service payant (conditions d'utilisation des « Delayed Data », acceptées le 01/10/2026).
Le fichier quotidien n'est disponible que jusqu'au lendemain : l'historique se construit donc jour après jour.

Cours retenu pour une journée :
  - Xetra : prix de l'enchère de clôture (vers 17 h 35), sinon dernière transaction de la séance principale,
    sinon dernière transaction de la journée ;
  - Börse Frankfurt (fonds absents de Xetra) : dernière transaction de la journée.
Seuls les prix en euros sont gardés.

Fichiers écrits (lus par js/cours.js) :
  data/cours/index.json          {"maj": dernier jour relevé, "annees": [...], "parts": nombre de parts suivies}
  data/cours/AAAA/NN.json        {"jours": [...], "c": {ISIN: [cours ou null, aligné sur jours]}, "l": {ISIN: "XXF-…"}}
                                 (NN = somme des codes des caractères de l'ISIN modulo 32 ; l : X Xetra, F Francfort, - aucun)

Lancement (depuis le dossier analyse-fonds) :
    python3 scripts/actualiser_cours.py
Uniquement la bibliothèque standard de Python. Lancé chaque jour par .github/workflows/cours.yml.
"""
import gzip
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DOSSIER = DATA / "cours"
API = "https://mfs.deutsche-boerse.com/api"
SOURCES = [("X", "DETR-posttrade"), ("F", "DFRA-posttrade")]   # Xetra d'abord, puis Börse Frankfurt
FRAGMENTS = 32
ENTETES = {"User-Agent": "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)"}


def telecharger(url, essais=4):
    for essai in range(essais):
        try:
            # le téléchargement redirige vers une adresse signée valable quelques secondes : urllib la suit aussitôt
            with urllib.request.urlopen(urllib.request.Request(url, headers=ENTETES), timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 0) or 15 * (essai + 1))
        except OSError:
            if essai == essais - 1:
                raise
            time.sleep(10 * (essai + 1))
    raise RuntimeError(f"pas de réponse : {url[:80]}")


def fragment(isin):
    return f"{sum(ord(c) for c in isin) % FRAGMENTS:02d}"


def isins_suivis():
    texte = (DATA / "annuaire.js").read_text(encoding="utf-8")
    annuaire = json.loads(re.search(r"const ANNUAIRE = (.*?);\n", texte, re.S).group(1))
    return {i for l in annuaire if l[0] in "EN" for i in (l[7] or "").split()}


def fichiers_quotidiens(prefixe):
    """Fichiers quotidiens consolidés encore en ligne : {jour: nom}."""
    liste = json.loads(telecharger(f"{API}/{prefixe}"))["CurrentFiles"]
    return {m.group(1): f for f in liste if (m := re.search(r"-daily-(\d{4}-\d{2}-\d{2})\.json\.gz$", f))}


def cours_du_jour(nom_fichier, isins, lieu):
    """ISIN → cours retenu pour la journée (voir l'en-tête du fichier)."""
    brut = telecharger(f"{API}/download/{nom_fichier}")
    meilleurs = {}   # ISIN → (rang, heure, prix) ; on garde le rang le plus élevé, puis la dernière heure
    with gzip.open(io.BytesIO(brut), "rt", encoding="utf-8") as f:
        for ligne in f:
            t = json.loads(ligne)
            isin = t.get("instrumentIdentificationCode")
            if isin not in isins or t.get("priceCurrency") != "EUR" or t.get("mmtModificationInd") == "C" or not t.get("price"):
                continue
            mode = t.get("mmtTradingMode")
            rang = (2 if mode == "K" else 1 if mode != "4" else 0) if lieu == "X" else 0
            cle = (rang, t["tradingDateAndTime"])
            if isin not in meilleurs or cle > meilleurs[isin][:2]:
                meilleurs[isin] = (rang, t["tradingDateAndTime"], float(t["price"]))
    return {i: v[2] for i, v in meilleurs.items()}


def lire_annee(annee):
    """{ISIN: {jour: (cours, lieu)}} pour une année déjà enregistrée."""
    res = {}
    for f in (DOSSIER / str(annee)).glob("*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        for isin, valeurs in d["c"].items():
            lieux = d["l"].get(isin, "")
            for k, v in enumerate(valeurs):
                if v is not None:
                    res.setdefault(isin, {})[d["jours"][k]] = (v, lieux[k] if k < len(lieux) else "-")
    return res


def ecrire_annee(annee, donnees):
    dossier = DOSSIER / str(annee)
    dossier.mkdir(parents=True, exist_ok=True)
    par_fragment = {}
    for isin, jours in donnees.items():
        par_fragment.setdefault(fragment(isin), {})[isin] = jours
    for nn, fonds in par_fragment.items():
        jours = sorted({j for v in fonds.values() for j in v})
        contenu = {"jours": jours, "c": {}, "l": {}}
        for isin in sorted(fonds):
            contenu["c"][isin] = [fonds[isin][j][0] if j in fonds[isin] else None for j in jours]
            contenu["l"][isin] = "".join(fonds[isin][j][1] if j in fonds[isin] else "-" for j in jours)
        (dossier / f"{nn}.json").write_text(json.dumps(contenu, separators=(",", ":")), encoding="utf-8")


def main():
    isins = isins_suivis()
    index_fichier = DOSSIER / "index.json"
    index = json.loads(index_fichier.read_text(encoding="utf-8")) if index_fichier.exists() else {"annees": []}
    print(f"{len(isins)} parts de fonds étrangers suivies")

    disponibles = {lieu: fichiers_quotidiens(prefixe) for lieu, prefixe in SOURCES}
    jours = sorted({j for d in disponibles.values() for j in d})
    annees_lues, nouveaux = {}, 0
    for jour in jours:
        annee = int(jour[:4])
        if annee not in annees_lues:
            annees_lues[annee] = lire_annee(annee)
        donnees = annees_lues[annee]
        if any(jour in v for v in donnees.values()):
            print(f"  {jour} : déjà enregistré")
            continue
        releves = {}
        for lieu, _ in SOURCES:
            if jour in disponibles[lieu]:
                for isin, prix in cours_du_jour(disponibles[lieu][jour], isins, lieu).items():
                    releves.setdefault(isin, (prix, lieu))   # Xetra a la priorité sur Francfort
        for isin, v in releves.items():
            donnees.setdefault(isin, {})[jour] = v
        nouveaux += 1
        print(f"  {jour} : {len(releves)} cours ({sum(1 for v in releves.values() if v[1] == 'X')} Xetra, "
              f"{sum(1 for v in releves.values() if v[1] == 'F')} Francfort)")

    if not nouveaux:
        print("Aucun nouveau jour de cotation.")
        return
    for annee, donnees in annees_lues.items():
        ecrire_annee(annee, donnees)
    tous = {j for d in annees_lues.values() for v in d.values() for j in v}
    index = {"maj": max(tous | {index.get("maj", "")}), "annees": sorted(set(index["annees"]) | set(annees_lues)),
             "parts": len({i for d in annees_lues.values() for i in d}), "releve": date.today().isoformat()}
    index_fichier.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"✓ cours enregistrés dans data/cours/ (dernier jour : {index['maj']})")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:   # une panne de Deutsche Börse ne doit pas faire échouer la mise à jour quotidienne
        print(f"Cours indisponibles : {e}", file=sys.stderr)
        sys.exit(1)

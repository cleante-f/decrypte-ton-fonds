"""
Fonds américains (SEC) → zone « États-Unis » de l'annuaire, composition des fonds, rendements mensuels en euros et frais.

Sources (fichiers publics de la SEC, https://www.sec.gov) :
  1. Liste « Investment Company Series and Class Information » (CSV annuel) et company_tickers_mf.json :
     séries, parts (classes), sociétés de gestion et tickers des fonds américains.
  2. Jeux de données trimestriels « Form N-PORT » (DERA) : inventaire des positions, actif net, LEI et rendements mensuels
     de chaque part, à partir du 4e trimestre 2019. Archives de 400 à 500 Mo lues par plages d'octets (ZipDistant),
     sans les télécharger en entier.
  3. Jeux de données « Mutual Fund Prospectus Risk/Return Summary » (DERA) : frais des prospectus.
  4. BCE – taux de change mensuels dollar/euro (conversion des montants et des rendements en euros).

Conditions de la SEC (sec.gov, « Website Dissemination ») :
  - « Information presented on sec.gov is considered public information and may be copied or further distributed by users
    of the web site without the SEC's permission. »
  - « Please do not use the SEC seal or any of the other logos or artwork from this site. »
  - « no more than 10 requests per second » : ce script en fait au plus 5 par seconde (pause de 0,2 s avant chaque requête).
  - « The SEC does not allow "unclassified" bots or automated tools to crawl the site. » : toutes les requêtes portent un
    User-Agent qui nomme le site et donne un contact (UA).
  Les pages des jeux de données ajoutent que les données peuvent contenir des erreurs et que « Investors should review the
  full Commission filings before making any investment decision ». Le site le rappelle et cite la source
  (« Source : SEC – EDGAR · données du … ») ; il n'utilise ni logo ni image de la SEC.

Lancement (depuis le dossier analyse-fonds) :
    python3 scripts/construire_etats_unis.py            # nouveau trimestre seulement (tâche mensuelle)
    python3 scripts/construire_etats_unis.py --complet  # tout depuis le 4e trimestre 2019 (long)
Uniquement la bibliothèque standard de Python.
"""
from __future__ import annotations

import csv
import heapq
import io
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator
from pathlib import Path

UA = "Decrypte ton fonds contact@decrypte-ton-fonds.fr"
SEC = "https://www.sec.gov"
NPORT = SEC + "/files/dera/data/form-n-port-data-sets/{t}_nport.zip"
RR = SEC + "/files/dera/data/mutual-fund-prospectus-risk/return-summary-data-sets/{t}_rr1.zip"
TICKERS = SEC + "/files/company_tickers_mf.json"
LISTE = SEC + "/files/investment/data/other/investment-company-series-class-information/investment-company-series-class-{annee}.csv"
PREMIER_TRIMESTRE = "2019q4"
MORCEAUX = 64   # nombre de fichiers de détails : data/etats-unis/00.js … 63.js
DERIVES = {"DCO", "DCR", "DE", "DFE", "DIR", "DO"}   # catégories N-PORT des produits dérivés : écartées de la composition
DATA = Path(__file__).resolve().parent.parent / "data"

PAUSE = 0.2   # secondes avant chaque requête : 5 par seconde au plus (limite de la SEC : 10)
TAMPON = 8 << 20   # octets demandés à chaque requête par plage
MOIS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


# ---------- Téléchargement ----------
def _requete(url: str, plage: tuple[int, int] | None = None, essais: int = 4) -> tuple[bytes, object]:
    """Corps et en-têtes de la réponse. Nouvel essai (attente croissante) sur 429, 5xx et erreurs réseau ; les autres codes remontent."""
    entetes = {"User-Agent": UA}
    if plage:
        entetes["Range"] = f"bytes={plage[0]}-{plage[1]}"
    derniere = None
    for essai in range(essais):
        time.sleep(PAUSE)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=entetes), timeout=300) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            consigne = (e.headers.get("Retry-After") or "") if e.headers else ""
            derniere, attente = e, int(consigne) if consigne.isdigit() else 15 * (essai + 1)
        except OSError as e:   # délai dépassé, connexion coupée…
            derniere, attente = e, 10 * (essai + 1)
        if essai < essais - 1:
            print(f"    ({derniere}, nouvel essai dans {attente} s)")
            time.sleep(attente)
    raise RuntimeError(f"pas de réponse après {essais} essais : {url[:100]}") from derniere


def telecharger(url: str, plage: tuple[int, int] | None = None) -> bytes:
    """Contenu de l'adresse, ou des octets `plage` = (début, fin inclus) seulement (en-tête Range)."""
    return _requete(url, plage)[0]


def taille_distante(url: str) -> int:
    """Taille d'un fichier distant, lue dans l'en-tête Content-Range de la réponse à une requête « bytes=0-0 »."""
    m = re.fullmatch(r"bytes 0-0/(\d+)", _requete(url, (0, 0))[1].get("Content-Range") or "")
    if not m:
        raise RuntimeError(f"taille inconnue (pas de Content-Range) : {url[:100]}")
    return int(m.group(1))


class ZipDistant(io.RawIOBase):
    """Fichier en lecture seule qui lit l'adresse `url` par plages d'octets : permet d'ouvrir une archive zip de plusieurs
    centaines de Mo en ne téléchargeant que les fichiers dont on a besoin. `lire_plage(url, debut, fin)` renvoie les octets
    de debut à fin inclus (par défaut : `telecharger`). Sans `taille`, elle est demandée au serveur."""

    def __init__(self, url: str, lire_plage=None, taille: int | None = None):
        super().__init__()
        self.url = url
        self.lire_plage = lire_plage or (lambda u, debut, fin: telecharger(u, (debut, fin)))
        self.taille = taille if taille is not None else taille_distante(url)
        self.position = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, decalage, origine=io.SEEK_SET):
        if origine == io.SEEK_SET:
            cible = decalage
        elif origine == io.SEEK_CUR:
            cible = self.position + decalage
        elif origine == io.SEEK_END:
            cible = self.taille + decalage
        else:
            raise ValueError(f"origine inconnue : {origine}")
        if cible < 0:
            raise ValueError(f"position négative : {cible}")
        self.position = cible
        return cible

    def readinto(self, tampon):
        fin = min(self.position + len(tampon), self.taille) - 1
        if fin < self.position:
            return 0
        octets = self.lire_plage(self.url, self.position, fin)
        if not octets:
            raise OSError(f"réponse vide pour les octets {self.position}-{fin} : {self.url[:100]}")
        tampon[:len(octets)] = octets
        self.position += len(octets)
        return len(octets)


def ouvrir_zip(url: str, lire_plage=None, taille: int | None = None) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(ZipDistant(url, lire_plage, taille), TAMPON))


# ---------- Lecture des fichiers ----------
def lire_tsv(source: zipfile.ZipFile | Path, nom: str) -> Iterator[dict]:
    """Lignes d'un fichier TSV de la SEC (dossier de fichiers ou archive zip), en dictionnaires. Aucun guillemet dans ces fichiers."""
    with (source.open(nom) if isinstance(source, zipfile.ZipFile) else open(Path(source) / nom, "rb")) as brut, \
            io.TextIOWrapper(brut, encoding="utf-8-sig", errors="replace", newline="") as texte:
        yield from csv.DictReader(texte, delimiter="\t", quoting=csv.QUOTE_NONE)


def date_sec(texte: str) -> str:
    """« 31-JUL-2026 » → « 2026-07-31 ». Texte vide → texte vide ; autre format → ValueError (la SEC a changé de format)."""
    texte = texte.strip()
    if not texte:
        return ""
    m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", texte)
    if not m or m.group(2).upper() not in MOIS:
        raise ValueError(f"date SEC inattendue : {texte!r}")
    return f"{m.group(3)}-{MOIS[m.group(2).upper()]:02d}-{int(m.group(1)):02d}"


def depots_retenus(soumissions: Iterable[dict], infos: Iterable[dict]) -> dict[str, str]:
    """Série → numéro du dépôt N-PORT à lire : celui du rapport (REPORT_DATE) le plus récent ; à rapport égal, le plus récent
    FILING_DATE (un amendement plus tardif l'emporte). Les séries sans identifiant sont ignorées."""
    classement = {}
    for s in soumissions:
        rapport = date_sec(s.get("REPORT_DATE") or "")
        if rapport:
            classement[s["ACCESSION_NUMBER"]] = (rapport, date_sec(s.get("FILING_DATE") or ""), s["ACCESSION_NUMBER"])
    retenus = {}
    for i in infos:
        serie, depot = i.get("SERIES_ID"), i.get("ACCESSION_NUMBER")
        if serie and depot in classement and (serie not in retenus or classement[depot] > classement[retenus[serie]]):
            retenus[serie] = depot
    return retenus


# ---------- Composition ----------
def classe_actif(cat: str, emetteur: str) -> str | None:
    """Classe d'une position N-PORT (catégorie ASSET_CAT et type d'émetteur ISSUER_TYPE) ; None pour un produit dérivé."""
    cat, emetteur = cat or "", emetteur or ""
    if cat in DERIVES:
        return None
    if emetteur in {"RF", "PF"} and cat != "STIV":   # parts d'un autre fonds (RF : fonds enregistré, PF : fonds privé)
        return "Fonds (OPC)"
    if cat in {"EC", "EP"}:
        return "Actions"
    if cat in {"DBT", "LON", "SN"} or cat.startswith("ABS-"):
        return "Obligations"
    if cat in {"STIV", "RA"}:
        return "Monétaire"
    return "Autres"


def _nombre(texte: str | None) -> float:
    try:
        return float(texte)
    except (TypeError, ValueError):
        return 0.0


def _trier(poids: dict[str, float]) -> list[list]:
    """[[clé, poids arrondi à 2 décimales]…] par poids décroissant puis clé."""
    return sorted(([cle, round(v, 2)] for cle, v in poids.items()), key=lambda c: (-c[1], c[0]))


def resumer_positions(positions: Iterable[dict], accessions: set[str]) -> dict[str, dict]:
    """Composition de chaque dépôt de `accessions`, en une seule lecture de FUND_REPORTED_HOLDING :
    {lignes, exclu, top, pays, classes, devises}. Les produits dérivés et les positions courtes (PAYOFF_PROFILE « Short »)
    sont exclus de la composition ; leur poids (en valeur absolue) s'ajoute à `exclu`. `top` : les 10 plus grosses positions
    retenues [nom, poids, HOLDING_ID]. Poids en % de l'actif net. Un dépôt sans aucune position n'apparaît pas."""
    etats = {}
    for ordre, p in enumerate(positions):
        depot = p.get("ACCESSION_NUMBER")
        if depot not in accessions:
            continue
        e = etats.setdefault(depot, {"lignes": 0, "exclu": 0.0, "tas": [], "pays": {}, "classes": {}, "devises": {}})
        poids = _nombre(p.get("PERCENTAGE"))
        classe = classe_actif(p.get("ASSET_CAT"), p.get("ISSUER_TYPE"))
        if classe is None or p.get("PAYOFF_PROFILE") == "Short":
            e["exclu"] += abs(poids)
            continue
        e["lignes"] += 1
        e["classes"][classe] = e["classes"].get(classe, 0.0) + poids
        for groupe, cle in (("pays", p.get("INVESTMENT_COUNTRY")), ("devises", p.get("CURRENCY_CODE"))):
            if cle:
                e[groupe][cle] = e[groupe].get(cle, 0.0) + poids
        # tas des 10 plus grosses positions ; à poids égal, la première lue passe devant (-ordre)
        position = (poids, -ordre, p.get("ISSUER_NAME") or "", p.get("HOLDING_ID") or "")
        if len(e["tas"]) < 10:
            heapq.heappush(e["tas"], position)
        else:
            heapq.heappushpop(e["tas"], position)
    return {depot: {"lignes": e["lignes"], "exclu": round(e["exclu"], 2),
                    "top": [[nom, round(poids, 2), identifiant] for poids, _, nom, identifiant in sorted(e["tas"], reverse=True)],
                    "pays": _trier(e["pays"]), "classes": _trier(e["classes"]), "devises": _trier(e["devises"])}
            for depot, e in etats.items()}


def isins_des_lignes(identifiants: Iterable[dict], holding_ids: set[str]) -> dict[str, str]:
    """HOLDING_ID → premier IDENTIFIER_ISIN non vide, pour les positions demandées (fichier IDENTIFIERS)."""
    isins = {}
    for i in identifiants:
        if i.get("HOLDING_ID") in holding_ids and i.get("IDENTIFIER_ISIN"):
            isins.setdefault(i["HOLDING_ID"], i["IDENTIFIER_ISIN"])
    return isins

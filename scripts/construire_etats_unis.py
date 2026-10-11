"""
Fonds américains (SEC) → zone « États-Unis » de l'annuaire, composition des fonds, rendements mensuels en euros et frais.

Sources (fichiers publics de la SEC, https://www.sec.gov) :
  1. Liste « Investment Company Series and Class Information » (CSV annuel) et company_tickers_mf.json :
     séries, parts (classes), sociétés de gestion et tickers des fonds américains.
  2. Jeux de données trimestriels « Form N-PORT » (DERA) : inventaire des positions, actif net, LEI et rendements mensuels
     de chaque part, à partir du 4e trimestre 2019, et tableau de prêt de titres (SECURITIES_LENDING.tsv : positions qui réinvestissent
     des garanties reçues en espèces, retirées de la composition). Archives de 400 à 500 Mo lues par plages d'octets (ZipDistant),
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
    python3 scripts/construire_etats_unis.py --forcer   # même sans nouveau trimestre (annuaire, frais, correspondances ISIN)
Uniquement la bibliothèque standard de Python.
"""
from __future__ import annotations

import argparse
import csv
import heapq
import http.client
import io
import itertools
import json
import math
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator
from datetime import date
from pathlib import Path

from actualiser_contexte import lire_serie_bce, telecharger as telecharger_bce

UA = "Decrypte ton fonds contact@decrypte-ton-fonds.fr"
SEC = "https://www.sec.gov"
NPORT = SEC + "/files/dera/data/form-n-port-data-sets/{t}_nport.zip"
RR = SEC + "/files/dera/data/mutual-fund-prospectus-risk/return-summary-data-sets/{t}_rr1.zip"
TICKERS = SEC + "/files/company_tickers_mf.json"
LISTE = SEC + "/files/investment/data/other/investment-company-series-class-information/investment-company-series-class-{annee}.csv"
BCE_USD = "https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.E?format=csvdata&detail=dataonly&startPeriod=2019-09"
PREMIER_TRIMESTRE = "2019q4"
TRIMESTRES_FRAIS = 8   # nombre de trimestres de prospectus lus (le plus récent l'emporte)
MORCEAUX = 64   # nombre de fichiers de détails : data/etats-unis/00.js … 63.js
DERIVES = {"DCO", "DCR", "DE", "DFE", "DIR", "DO"}   # catégories N-PORT des produits dérivés : écartées de la composition
DATA = Path(__file__).resolve().parent.parent / "data"
# étiquettes XBRL des prospectus → position dans [brut, net, gestion, entrée, sortie, date]
ETIQUETTES_FRAIS = {"ExpensesOverAssets": 0, "NetExpensesOverAssets": 1, "ManagementFeesOverAssets": 2,
                    "MaximumSalesChargeImposedOnPurchasesOverOfferingPrice": 3, "MaximumDeferredSalesChargeOverOther": 4}

PAUSE = 0.2   # secondes avant chaque requête : 5 par seconde au plus (limite de la SEC : 10)
TAMPON = 8 << 20   # octets demandés à chaque requête par plage
MOIS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


# ---------- Téléchargement ----------
def _requete(url: str, plage: tuple[int, int] | None = None, essais: int = 4, methode: str = "GET") -> tuple[bytes, object]:
    """Corps et en-têtes de la réponse. Nouvel essai (attente croissante) sur 429, 5xx, erreurs réseau et réponses coupées
    (http.client.HTTPException, par exemple IncompleteRead) ; les autres codes remontent."""
    entetes = {"User-Agent": UA}
    if plage:
        entetes["Range"] = f"bytes={plage[0]}-{plage[1]}"
    derniere = None
    for essai in range(essais):
        time.sleep(PAUSE)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=entetes, method=methode), timeout=300) as r:
                return r.read(), r.headers
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            consigne = (e.headers.get("Retry-After") or "") if e.headers else ""
            derniere, attente = e, int(consigne) if consigne.isdigit() else 15 * (essai + 1)
        except (OSError, http.client.HTTPException) as e:   # délai dépassé, connexion coupée, réponse incomplète…
            derniere, attente = e, 10 * (essai + 1)
        if essai < essais - 1:
            print(f"    ({derniere}, nouvel essai dans {attente} s)")
            time.sleep(attente)
    raise RuntimeError(f"pas de réponse après {essais} essais : {url[:100]}") from derniere


def telecharger(url: str, plage: tuple[int, int] | None = None) -> bytes:
    """Contenu de l'adresse, ou des octets `plage` = (début, fin inclus) seulement (en-tête Range)."""
    return _requete(url, plage)[0]


def url_existe(url: str) -> bool:
    """True si l'adresse répond (requête HEAD, avec le User-Agent et la pause habituels), False sur une erreur 404 ; toute autre erreur remonte."""
    try:
        _requete(url, methode="HEAD")
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


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


def garanties_en_especes(lignes: Iterable[dict]) -> dict[str, float | None]:
    """HOLDING_ID → valeur en dollars de la part de la position qui réinvestit des garanties reçues en espèces contre des titres
    prêtés, d'après SECURITIES_LENDING.tsv (case IS_CASH_COLLATERAL = « Y » : « Does any amount of this investment represent
    reinvestment of cash collateral received for loaned securities » ; CASH_COLLATERAL_AMOUNT : « value of the investment
    representing cash collateral »). None si le montant est vide ou illisible. Les titres prêtés par le fonds (IS_LOAN_BY_FUND) sont
    des positions du fonds : ils ne sont pas concernés."""
    return {l["HOLDING_ID"]: _decimal(l.get("CASH_COLLATERAL_AMOUNT")) for l in lignes if l.get("IS_CASH_COLLATERAL") == "Y" and l.get("HOLDING_ID")}


def _part_de_garantie(position: dict, montant: float | None) -> float:
    """Part (de 0 à 1) d'une position qui réinvestit des garanties en espèces : montant déclaré / valeur de la position (CURRENCY_VALUE,
    en dollars). Toute la position si le montant est inconnu, si la valeur est nulle ou si le montant atteint 98 % de la valeur."""
    valeur = _decimal(position.get("CURRENCY_VALUE"))
    if montant is None or valeur is None or valeur <= 0:
        return 1.0
    part = max(0.0, montant / valeur)
    return 1.0 if part >= 0.98 else part


def resumer_positions(positions: Iterable[dict], accessions: set[str], garanties: dict[str, float | None] | None = None) -> dict[str, dict]:
    """Composition de chaque dépôt de `accessions`, en une seule lecture de FUND_REPORTED_HOLDING :
    {lignes, exclu, garanties, garanties_lignes, top, pays, classes, devises}. Les produits dérivés et les positions courtes
    (PAYOFF_PROFILE « Short ») sont exclus de la composition ; leur poids (en valeur absolue) s'ajoute à `exclu`.
    `garanties` (garanties_en_especes) : le réinvestissement des garanties en espèces reçues contre des titres prêtés n'est ni une
    exposition ni un dérivé, mais un placement de l'argent du prêt, déjà compté dans l'actif net en plus des titres prêtés : il est retiré
    de la composition (pays, classes, devises, top 10) sans aller dans `exclu`. `garanties` : poids retiré (en % de l'actif net) ;
    `garanties_lignes` : nombre de positions concernées (en entier ou en partie : une position dont une part seulement réinvestit des
    garanties garde le reste de son poids). `top` : les 10 plus grosses positions retenues [nom, poids, HOLDING_ID]. Poids en % de
    l'actif net. Un dépôt sans aucune position n'apparaît pas."""
    garanties = garanties or {}
    etats = {}
    for ordre, p in enumerate(positions):
        depot = p.get("ACCESSION_NUMBER")
        if depot not in accessions:
            continue
        e = etats.setdefault(depot, {"lignes": 0, "exclu": 0.0, "garanties": 0.0, "garanties_lignes": 0, "tas": [], "pays": {}, "classes": {}, "devises": {}})
        poids = _nombre(p.get("PERCENTAGE"))
        classe = classe_actif(p.get("ASSET_CAT"), p.get("ISSUER_TYPE"))
        if classe is None or p.get("PAYOFF_PROFILE") == "Short":
            e["exclu"] += abs(poids)
            continue
        if p.get("HOLDING_ID") in garanties:
            part = _part_de_garantie(p, garanties[p["HOLDING_ID"]])
            e["garanties"] += poids * part
            e["garanties_lignes"] += 1
            if part == 1.0:   # toute la position réinvestit des garanties : elle n'est plus une ligne du fonds
                continue
            poids -= poids * part
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
    return {depot: {"lignes": e["lignes"], "exclu": round(e["exclu"], 2), "garanties": round(e["garanties"], 2), "garanties_lignes": e["garanties_lignes"],
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


# ---------- Rendements mensuels et change ----------
def _decimal(texte: str | None) -> float | None:
    """Nombre lu dans un fichier de la SEC ; None si la case est vide ou n'est pas un nombre fini."""
    try:
        valeur = float(texte)
    except (TypeError, ValueError):
        return None
    return valeur if math.isfinite(valeur) else None


def _mois_decale(mois: str, decalage: int) -> str:
    """« 2026-04 », -1 → « 2026-03 » (passe d'une année à l'autre)."""
    rang = int(mois[:4]) * 12 + int(mois[5:7]) - 1 + decalage
    return f"{rang // 12:04d}-{rang % 12 + 1:02d}"


def mois_du_rapport(date_iso: str) -> list[str]:
    """Les trois mois couverts par un rapport N-PORT, du plus ancien au plus récent : « 2026-06-30 » → 2026-04, 2026-05, 2026-06."""
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])-\d{2}", date_iso):
        raise ValueError(f"date de rapport inattendue : {date_iso!r}")
    mois = date_iso[:7]
    return [_mois_decale(mois, -2), _mois_decale(mois, -1), mois]


def ajouter_rendements(cumul: dict, serie_de: dict, soumissions: Iterable[dict], infos: Iterable[dict],
                       retours: Iterable[dict]) -> None:
    """Ajoute à `cumul` les rendements mensuels (en % et en dollars, tels que lus) d'un trimestre de jeux N-PORT :
    cumul[clé][« AAAA-MM »] = (rendement, date de dépôt « AAAA-MM-JJ »). `clé` = CLASS_ID de la part, ou SERIES_ID si la case est
    vide (ligne ignorée si les deux manquent) ; `serie_de[clé]` = SERIES_ID. MONTHLY_TOTAL_RETURN1, 2 et 3 sont les mois
    de `mois_du_rapport(REPORT_DATE)`. Une case vide est ignorée. Pour un même mois, le dépôt au FILING_DATE le plus récent
    l'emporte, y compris sur les valeurs ajoutées par un appel précédent (à date égale : le dernier lu). `soumissions` (SUBMISSION),
    `infos` (FUND_REPORTED_INFO) et `retours` (MONTHLY_TOTAL_RETURN) sont lus une seule fois, dans cet ordre."""
    rapports = {}
    for s in soumissions:
        rapport = date_sec(s.get("REPORT_DATE") or "")
        if rapport:
            rapports[s["ACCESSION_NUMBER"]] = (mois_du_rapport(rapport), date_sec(s.get("FILING_DATE") or ""))
    series = {i["ACCESSION_NUMBER"]: i.get("SERIES_ID") or "" for i in infos}
    for r in retours:
        depot = r.get("ACCESSION_NUMBER")
        if depot not in rapports:
            continue
        mois, depose = rapports[depot]
        serie = series.get(depot, "")
        cle = r.get("CLASS_ID") or serie
        if not cle:
            continue
        if serie:
            serie_de[cle] = serie
        for m, colonne in zip(mois, ("MONTHLY_TOTAL_RETURN1", "MONTHLY_TOTAL_RETURN2", "MONTHLY_TOTAL_RETURN3")):
            valeur = _decimal(r.get(colonne))
            if valeur is None:
                continue
            retenus = cumul.setdefault(cle, {})
            if m not in retenus or depose >= retenus[m][1]:
                retenus[m] = (valeur, depose)


def taux_mensuels(texte_csv: str) -> dict[str, float]:
    """Taux de change de fin de mois de la BCE (CSV de l'API, série EXR/M.USD.EUR.SP00.E) : « AAAA-MM » → dollars pour un euro."""
    return dict(lire_serie_bce(texte_csv))


def en_euros(r_usd: float, mois: str, taux: dict) -> float | None:
    """Rendement en % d'un mois, converti de dollars en euros : (1 + r/100) × taux(mois précédent) / taux(mois) − 1, arrondi à
    2 décimales. None si le taux du mois ou celui du mois précédent manque."""
    avant, apres = taux.get(_mois_decale(mois, -1)), taux.get(mois)
    if not avant or not apres:
        return None
    return round(((1 + r_usd / 100) * avant / apres - 1) * 100, 2) + 0.0   # + 0.0 : « -0.0 » devient « 0.0 »


# ---------- Frais des prospectus ----------
def _date_compacte(texte: str) -> str:
    """« 20250924 » → « 2025-09-24 ». Texte vide → texte vide ; autre format → ValueError (la SEC a changé de format)."""
    texte = texte.strip()
    if not texte:
        return ""
    if not re.fullmatch(r"\d{8}", texte):
        raise ValueError(f"date de dépôt inattendue : {texte!r}")
    return f"{texte[:4]}-{texte[4:6]}-{texte[6:]}"


def frais_prospectus(num: Iterable[dict], sub: Iterable[dict], classes_par_serie: dict[str, list[str]]) -> dict[str, list]:
    """Frais des prospectus (jeux « Risk/Return Summary » : `num` = num.tsv, `sub` = sub.tsv), en % :
    {classe: [brut, net, gestion, entrée, sortie, date du dépôt « AAAA-MM-JJ »]}, None pour une étiquette absente.
    La part d'une ligne est le « Class= » de `otherdims`, sinon la colonne `series` si elle commence par « C », sinon toutes
    les parts de la série (`classes_par_serie`) ; une ligne sans part ni série est ignorée. Pour chaque (part, étiquette), le dépôt
    au `filed` le plus récent l'emporte (à date égale : le dernier lu) ; la date renvoyée est la plus récente des valeurs gardées."""
    depots = {}
    for s in sub:
        depose = _date_compacte(s.get("filed") or "")
        if depose:
            depots[s["adsh"]] = depose
    retenus = {}   # (part, position) → (date de dépôt, valeur en %)
    for n in num:
        position = ETIQUETTES_FRAIS.get(n.get("tag"))
        depose = depots.get(n.get("adsh"))
        valeur = _decimal(n.get("value"))
        if position is None or not depose or valeur is None:
            continue
        serie = (n.get("series") or "").strip()
        dimension = re.search(r"Class=([^;]+)", n.get("otherdims") or "")
        if dimension:
            classes = [dimension.group(1).strip()]
        elif serie.startswith("C"):
            classes = [serie]
        else:
            classes = classes_par_serie.get(serie, []) if serie else []
        for classe in classes:
            if (classe, position) not in retenus or depose >= retenus[(classe, position)][0]:
                retenus[(classe, position)] = (depose, round(valeur * 100, 2))
    frais = {}
    for (classe, position), (depose, valeur) in retenus.items():
        ligne = frais.setdefault(classe, [None] * 5 + [""])
        ligne[position] = valeur
        ligne[5] = max(ligne[5], depose)
    return frais


# ---------- Trimestres ----------
def _rang_trimestre(t: str) -> int:
    m = re.fullmatch(r"(\d{4})q([1-4])", t)
    if not m:
        raise ValueError(f"trimestre inattendu : {t!r} (attendu : « 2026q3 »)")
    return int(m.group(1)) * 4 + int(m.group(2)) - 1


def _trimestre_du_rang(rang: int) -> str:
    return f"{rang // 4}q{rang % 4 + 1}"


def trimestre_suivant(t: str) -> str:
    return _trimestre_du_rang(_rang_trimestre(t) + 1)


def trimestres(debut: str, fin: str) -> list[str]:
    """Trimestres de `debut` à `fin` inclus (« 2025q3 », « 2026q2 » → 2025q3, 2025q4, 2026q1, 2026q2) ; liste vide si fin < debut."""
    return [_trimestre_du_rang(r) for r in range(_rang_trimestre(debut), _rang_trimestre(fin) + 1)]


def dernier_trimestre(modele: str, existe=None, aujourd_hui: date | None = None) -> str | None:
    """Trimestre le plus récent dont le fichier existe : on essaie le trimestre en cours puis les 4 précédents. `modele` : adresse
    avec `{t}` (NPORT ou RR) ; `existe(adresse) -> bool` (par défaut `url_existe` : requête HEAD). None si aucun n'existe."""
    existe = existe or url_existe
    aujourd_hui = aujourd_hui or date.today()
    rang = aujourd_hui.year * 4 + (aujourd_hui.month - 1) // 3
    for r in range(rang, rang - 5, -1):
        t = _trimestre_du_rang(r)
        if existe(modele.format(t=t)):
            return t
    return None


# ---------- Annuaire ----------
COLONNES_LISTE = ("Series ID", "Series Name", "Entity Name", "Class ID", "Class Name", "Class Ticker")


def lire_liste(texte: str) -> dict[str, dict]:
    """Liste annuelle « Investment Company Series and Class Information » (CSV, BOM UTF-8 possible) :
    série → {nom, entite, classes: [[classe, nom de la part, ticker]…]} (parts dans l'ordre du fichier, sans doublon).
    Les lignes sans série (sociétés sans fonds) sont ignorées. Colonnes manquantes → ValueError (la SEC a changé de format)."""
    lecteur = csv.DictReader(io.StringIO(texte.lstrip("﻿"), newline=""))
    manquantes = [c for c in COLONNES_LISTE if c not in (lecteur.fieldnames or [])]
    if manquantes:
        raise ValueError(f"colonnes absentes de la liste des séries de la SEC : {', '.join(manquantes)}")
    series = {}
    for ligne in lecteur:
        serie = (ligne["Series ID"] or "").strip()
        if not serie:
            continue
        s = series.setdefault(serie, {"nom": (ligne["Series Name"] or "").strip(), "entite": (ligne["Entity Name"] or "").strip(), "classes": []})
        classe = (ligne["Class ID"] or "").strip()
        if classe and all(c[0] != classe for c in s["classes"]):
            s["classes"].append([classe, (ligne["Class Name"] or "").strip(), (ligne["Class Ticker"] or "").strip()])
    return series


def lignes_annuaire(tickers_mf: dict, liste: dict, noms_nport: dict[str, str], series_en_plus: Iterable[str] = frozenset()) -> list[list]:
    """Lignes de la zone « etats-unis », au format de ANNUAIRE : séries de company_tickers_mf.json et de `series_en_plus`.
    Nom : celui de la liste, sinon celui de N-PORT (`noms_nport`), sinon la série est ignorée. Tickers : dans l'ordre de
    company_tickers_mf.json (pour une série absente de ce fichier : ceux de la liste), séparés par une espace. `etf` = 1 si le mot
    « ETF » figure dans le nom de la série ou d'une part. Lignes triées par nom (sans tenir compte de la casse)."""
    champs = {c: i for i, c in enumerate(tickers_mf["fields"])}
    tickers = {}
    for ligne in tickers_mf["data"]:
        serie, symbole = ligne[champs["seriesId"]], ligne[champs["symbol"]]
        symboles = tickers.setdefault(serie, [])
        if symbole and symbole not in symboles:
            symboles.append(symbole)
    lignes = []
    for serie in list(tickers) + sorted(s for s in set(series_en_plus) if s not in tickers):
        if not re.fullmatch(r"S\d{9}", serie or ""):
            continue
        fiche = liste.get(serie, {})
        nom = fiche.get("nom") or noms_nport.get(serie)
        if not nom:
            continue
        symboles = tickers[serie] if serie in tickers else [c[2] for c in fiche.get("classes", []) if c[2]]
        etf = any(re.search(r"\bETF\b", n, re.IGNORECASE) for n in [nom] + [c[1] for c in fiche.get("classes", [])])
        n = int(serie[1:])
        lignes.append(["S", n, n, nom, fiche.get("entite", ""), "", "", "", "", "US", " ".join(symboles), "", "USD", 1 if etf else 0, 1])
    lignes.sort(key=lambda l: (l[3].lower(), l[1]))
    return lignes


def classes_des_tickers(tickers_mf: dict) -> dict[str, list]:
    """Série → [[classe, "", ticker]…] d'après company_tickers_mf.json (pour une série absente de la liste : parts sans nom)."""
    champs = {c: i for i, c in enumerate(tickers_mf["fields"])}
    classes = {}
    for ligne in tickers_mf["data"]:
        classes.setdefault(ligne[champs["seriesId"]], []).append([ligne[champs["classId"]], "", ligne[champs["symbol"]]])
    return classes


def lire_js(texte: str):
    """Objet JSON d'un fichier de données du site : ce qui suit la première affectation (« = ») et précède le dernier « ; ».
    Un commentaire d'en-tête éventuel (/* … */) est ignoré."""
    texte = texte.lstrip("﻿").lstrip()
    if texte.startswith("/*"):
        texte = texte[texte.index("*/") + 2:]
    return json.loads(texte[texte.index("= ") + 2:texte.rindex(";")])


def pays_des_isin(texte_annuaire: str) -> dict[str, set[str]]:
    """ISIN → pays des lignes de data/annuaire.js (colonnes 7 et 9) qui portent cet ISIN. Les lignes sans ISIN ou sans pays sont ignorées."""
    debut = texte_annuaire.index("const ANNUAIRE = ") + len("const ANNUAIRE = ")
    pays = {}
    for ligne in json.loads(texte_annuaire[debut:texte_annuaire.rindex(";")]):
        if ligne[7] and ligne[9]:
            pays.setdefault(ligne[7], set()).add(ligne[9])
    return pays


def correspondance_isin(texte_firds: str, lei_par_serie: dict[str, str], pays_par_isin: dict[str, set[str]] | None = None) -> dict[str, str]:
    """ISIN → série, pour les fonds du registre FIRDS (data/firds.js : FIRDS.fonds[isin][0] = LEI) dont le LEI est celui d'une
    série américaine. Un LEI partagé par plusieurs séries est écarté (rapprochement douteux). `pays_par_isin` (pays_des_isin) : un ISIN
    dont la ligne d'annuaire n'est pas américaine (un fonds irlandais qui partage le LEI d'une société américaine, ou la ligne d'un fonds
    européen qui porte un ISIN américain) est écarté ; un ISIN sans ligne d'annuaire reste."""
    series_par_lei = {}
    for serie, lei in lei_par_serie.items():
        if lei:
            series_par_lei.setdefault(lei, set()).add(serie)
    isin_serie = {}
    for isin, fiche in lire_js(texte_firds)["fonds"].items():
        series = series_par_lei.get(fiche[0], ())
        if len(series) == 1 and (pays_par_isin is None or pays_par_isin.get(isin, {"US"}) == {"US"}):
            isin_serie[isin] = next(iter(series))
    return isin_serie


# ---------- Lecture des sorties existantes ----------
FICHIER_ZONE = "annuaire-etats-unis.js"
FICHIER_ISIN = "etats-unis-isin.js"
DOSSIER_DETAILS = "etats-unis"


def lire_zone_existante(dossier: Path) -> dict | None:
    """Zone déjà écrite ({maj, trimestre, lignes}), ou None s'il n'y en a pas."""
    chemin = Path(dossier) / FICHIER_ZONE
    return lire_js(chemin.read_text(encoding="utf-8")) if chemin.exists() else None


def lire_details_existants(dossier: Path) -> dict[str, dict]:
    """Tous les détails déjà écrits (data/etats-unis/NN.js) : série → détail."""
    details = {}
    for chemin in sorted((Path(dossier) / DOSSIER_DETAILS).glob("*.js")):
        details.update(lire_js(chemin.read_text(encoding="utf-8")))
    return details


# ---------- Assemblage des détails ----------
CHAMPS_COMPOSITION = ("date", "actif", "lignes", "exclu", "top", "pays", "classes", "devises")
COMPOSITION_VIDE = {"date": None, "actif": None, "lignes": 0, "exclu": 0, "top": [], "pays": [], "classes": [], "devises": []}


def _lei(texte: str | None) -> str:
    """LEI en majuscules, ou texte vide si la case ne contient pas un LEI (20 caractères ; N-PORT écrit parfois « N/A »)."""
    texte = (texte or "").strip().upper()
    return texte if re.fullmatch(r"[A-Z0-9]{20}", texte) else ""


def infos_retenues(soumissions: Iterable[dict], infos: Iterable[dict], retenus: dict[str, str]) -> dict[str, dict]:
    """Série → ligne FUND_REPORTED_INFO de son dépôt retenu (`retenus` = depots_retenus), avec REPORT_DATE (lue dans SUBMISSION) en ISO."""
    depots = set(retenus.values())
    rapports = {s["ACCESSION_NUMBER"]: date_sec(s.get("REPORT_DATE") or "") for s in soumissions if s.get("ACCESSION_NUMBER") in depots}
    return {i["SERIES_ID"]: dict(i, REPORT_DATE=rapports.get(i["ACCESSION_NUMBER"], ""))
            for i in infos if i.get("SERIES_ID") and retenus.get(i["SERIES_ID"]) == i.get("ACCESSION_NUMBER")}


def rendements_en_euros(cumul: dict, taux: dict) -> dict[str, dict[str, float]]:
    """cumul (ajouter_rendements : clé → mois → (rendement en dollars, date de dépôt)) → clé → mois → rendement en euros.
    Les mois sans taux de change sont écartés ; une clé sans aucun mois convertible n'apparaît pas."""
    resultat = {}
    for cle, mois in cumul.items():
        euros = {m: r for m, (valeur, _) in mois.items() if (r := en_euros(valeur, m, taux)) is not None}
        if euros:
            resultat[cle] = euros
    return resultat


def fusionner_rendements(ancien: list | None, nouveaux: dict[str, float]) -> list:
    """Rendements déjà écrits `[début « AAAA-MM », [valeurs]]` + nouveaux rendements {mois: valeur} (les nouveaux remplacent) →
    `[début, valeurs]` sur des mois consécutifs, les trous valant None, sans None au début ni à la fin ; `[None, None]` si rien."""
    valeurs = {}
    if ancien and ancien[0]:
        valeurs.update({_mois_decale(ancien[0], i): v for i, v in enumerate(ancien[1] or []) if v is not None})
    valeurs.update({m: v for m, v in nouveaux.items() if v is not None})
    if not valeurs:
        return [None, None]
    debut, fin = min(valeurs), max(valeurs)
    nombre = (int(fin[:4]) - int(debut[:4])) * 12 + int(fin[5:7]) - int(debut[5:7]) + 1
    return [debut, [valeurs.get(_mois_decale(debut, i)) for i in range(nombre)]]


def detail_serie(serie: str, classes: list, resume: dict | None, isins: dict, info: dict | None, rendements_eur: dict, frais: dict,
                 taux: dict, ancien: dict | None, nom_liste: str = "") -> dict | None:
    """Détail d'une série (contrat Python → JavaScript : voir data/etats-unis/NN.js), ou None s'il n'y a ni composition, ni rendements, ni frais.
    classes : [[classe, nom, ticker]…] dans l'ordre d'affichage ; resume : résumé N-PORT du dépôt retenu (resumer_positions) ou None ;
    isins : HOLDING_ID → ISIN ; info : ligne FUND_REPORTED_INFO du dépôt retenu, REPORT_DATE en ISO (infos_retenues) ; rendements_eur :
    clé (part, ou série si N-PORT ne donne pas la part) → mois → rendement en euros ; frais : part → [brut, net, gestion, entrée, sortie, date] ;
    taux : taux BCE mensuels ; ancien : détail déjà écrit. Sans `resume`, la composition (date, actif, lignes, exclu, top, pays, classes,
    devises) est reprise de `ancien` ; les rendements nouveaux s'ajoutent à ceux de `ancien`. nom : celui de N-PORT, sinon celui de
    `ancien` (le nom N-PORT d'un lancement précédent ne change pas selon que la série a déposé ou non ce trimestre), sinon `nom_liste` ;
    lei : celui de N-PORT, sinon celui de `ancien` (texte vide si inconnu)."""
    ancien, info = ancien or {}, info or {}
    if resume and info:
        net, cours = _decimal(info.get("NET_ASSETS")), taux.get((info.get("REPORT_DATE") or "")[:7])
        composition = {"date": info.get("REPORT_DATE") or None, "actif": round(net / cours) if net is not None and cours else None,
                       "lignes": resume["lignes"], "exclu": resume["exclu"],
                       "top": [[nom, poids, isins.get(identifiant)] for nom, poids, identifiant in resume["top"]],
                       "pays": resume["pays"], "classes": resume["classes"], "devises": resume["devises"]}
    else:
        composition = {c: ancien.get(c, COMPOSITION_VIDE[c]) for c in CHAMPS_COMPOSITION}
    anciennes_parts = {p[0]: [p[3], p[4]] for p in ancien.get("parts", [])}
    parts = []
    for classe, nom, ticker in classes:
        nouveaux = rendements_eur.get(classe) or (rendements_eur.get(serie) if len(classes) == 1 else None) or {}
        debut, valeurs = fusionner_rendements(anciennes_parts.get(classe), nouveaux)
        parts.append([classe, nom, ticker, debut, valeurs, frais.get(classe)])
    if not (composition["date"] or composition["lignes"] or any(p[3] for p in parts) or any(p[5] for p in parts)):
        return None
    return {"nom": info.get("SERIES_NAME") or ancien.get("nom") or nom_liste or "", "lei": _lei(info.get("SERIES_LEI")) or _lei(ancien.get("lei")),
            **composition, "parts": parts}


# ---------- Écriture ----------
ENTETE = ("/* Généré par scripts/construire_etats_unis.py — ne pas modifier à la main.\n"
          " * Données publiques de la SEC (EDGAR), réutilisables sans autorisation. {contenu} */\n")


def _json(valeur) -> str:
    """JSON compact ; NaN et infini (qui ne sont pas du JSON) font échouer l'écriture au lieu de produire un fichier douteux."""
    return json.dumps(valeur, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def ecrire_sorties(dossier: Path, lignes: list, details: dict[str, dict], isin_serie: dict[str, str], maj: str, trimestre: str) -> None:
    """Écrit dans `dossier` les 64 morceaux de détails (etats-unis/00.js … 63.js, même vides), etats-unis-isin.js, puis, en dernier
    (une écriture interrompue n'avance pas le trimestre), annuaire-etats-unis.js. Fichiers identiques d'un lancement à l'autre
    si les données sont identiques (séries et ISIN triés)."""
    dossier = Path(dossier)
    (dossier / DOSSIER_DETAILS).mkdir(parents=True, exist_ok=True)
    morceaux = [{} for _ in range(MORCEAUX)]
    for serie in sorted(details):
        morceaux[int(serie[1:]) % MORCEAUX][serie] = details[serie]
    entete = ENTETE.format(contenu="Détails des fonds (composition N-PORT, rendements mensuels en euros, frais des prospectus).")
    for k, morceau in enumerate(morceaux):
        (dossier / DOSSIER_DETAILS / f"{k:02d}.js").write_text(f"{entete}ETATS_UNIS_DETAILS[{k}] = {_json(morceau)};\n", encoding="utf-8")
    (dossier / FICHIER_ISIN).write_text(
        ENTETE.format(contenu="ISIN des fonds européens qui sont aussi des séries américaines (même LEI) : ISIN → série.")
        + f"const ETATS_UNIS_ISIN = {_json(dict(sorted(isin_serie.items())))};\n", encoding="utf-8")
    (dossier / FICHIER_ZONE).write_text(
        ENTETE.format(contenu="Annuaire des fonds américains, au format de ANNUAIRE.")
        + f"ANNUAIRE_ZONES[\"etats-unis\"] = {_json({'maj': maj, 'trimestre': trimestre, 'lignes': lignes})};\n", encoding="utf-8")


# ---------- Programme principal ----------
COL_SOUMISSION = ("ACCESSION_NUMBER", "FILING_DATE", "REPORT_DATE")
COL_INFO = ("ACCESSION_NUMBER", "SERIES_NAME", "SERIES_ID", "SERIES_LEI", "NET_ASSETS")
COL_NUM = ("adsh", "tag", "series", "otherdims", "value")


def _colonnes(lignes: Iterable[dict], colonnes: Iterable[str]) -> list[dict]:
    """Lignes réduites aux colonnes utiles (les fichiers de la SEC ont de nombreuses colonnes : la mémoire reste raisonnable)."""
    return [{c: l.get(c) or "" for c in colonnes} for l in lignes]


def telecharger_liste(annee: int) -> dict[str, dict]:
    """Liste des séries et parts de l'année ; si elle n'est pas encore publiée (404), celle de l'année précédente."""
    try:
        octets = telecharger(LISTE.format(annee=annee))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        print(f"  (liste {annee} absente, liste {annee - 1} utilisée)")
        octets = telecharger(LISTE.format(annee=annee - 1))
    return lire_liste(octets.decode("utf-8-sig", errors="replace"))


def main(argv=None, dossier: Path = DATA, aujourd_hui: date | None = None) -> int:
    parseur = argparse.ArgumentParser(description="Fonds américains (SEC) : annuaire, composition, rendements en euros et frais.")
    parseur.add_argument("--complet", action="store_true", help="tout recalculer depuis le 4e trimestre 2019 (long)")
    parseur.add_argument("--forcer", action="store_true", help="écrire les fichiers même sans nouveau trimestre (annuaire, frais et ISIN remis à jour)")
    options = parseur.parse_args(argv)
    aujourd_hui = aujourd_hui or date.today()

    existant = lire_zone_existante(dossier)
    dernier = dernier_trimestre(NPORT, aujourd_hui=aujourd_hui)
    if dernier is None:
        print("Erreur : aucun jeu de données N-PORT trouvé sur le site de la SEC (adresse changée ?).")
        return 1
    if existant and existant["trimestre"] >= dernier and not (options.complet or options.forcer):
        print(f"Rien de nouveau : le trimestre {dernier} est déjà dans les données.")
        return 0
    a_lire = trimestres(PREMIER_TRIMESTRE if options.complet or not existant else trimestre_suivant(existant["trimestre"]), dernier)
    anciens = {} if options.complet else lire_details_existants(dossier)
    print(f"Dernier trimestre N-PORT : {dernier}. À lire : {', '.join(a_lire) if a_lire else 'aucun'}.")

    print("1/5 Taux de change dollar/euro (BCE)…")
    taux = taux_mensuels(telecharger_bce(BCE_USD).decode("utf-8"))

    print("2/5 Séries, parts et tickers (liste de la SEC)…")
    tickers_mf = json.loads(telecharger(TICKERS))
    liste = telecharger_liste(aujourd_hui.year)
    classes_mf = classes_des_tickers(tickers_mf)
    classes_de = lambda serie: (liste.get(serie) or {}).get("classes") or classes_mf.get(serie, [])   # absente de la liste : parts de company_tickers_mf.json
    classes_par_serie = {s: [c[0] for c in classes_de(s)] for s in set(liste) | set(classes_mf)}

    print(f"3/5 Rapports N-PORT : rendements mensuels et composition ({len(a_lire)} trimestres)…")
    cumul, serie_de, retenus, infos_serie, resumes, isins = {}, {}, {}, {}, {}, {}
    for t in a_lire:
        print(f"  {t}")
        archive = ouvrir_zip(NPORT.format(t=t))
        soumissions = _colonnes(lire_tsv(archive, "SUBMISSION.tsv"), COL_SOUMISSION)
        infos = _colonnes(lire_tsv(archive, "FUND_REPORTED_INFO.tsv"), COL_INFO)
        ajouter_rendements(cumul, serie_de, soumissions, infos, lire_tsv(archive, "MONTHLY_TOTAL_RETURN.tsv"))
        if t == a_lire[-1]:   # composition : dernier trimestre seulement
            retenus = depots_retenus(soumissions, infos)
            infos_serie = infos_retenues(soumissions, infos, retenus)
            garanties = garanties_en_especes(lire_tsv(archive, "SECURITIES_LENDING.tsv"))
            resumes = resumer_positions(lire_tsv(archive, "FUND_REPORTED_HOLDING.tsv"), set(retenus.values()), garanties)
            retirees = [r for r in resumes.values() if r["garanties_lignes"]]
            print(f"    {sum(r['garanties_lignes'] for r in retirees)} positions de réinvestissement de garanties en espèces (prêt de titres) "
                  f"retirées de la composition de {len(retirees)} fonds (comptées à part, pas avec les dérivés).")
            lignes_du_top = {identifiant for r in resumes.values() for _, _, identifiant in r["top"] if identifiant}
            isins = isins_des_lignes(lire_tsv(archive, "IDENTIFIERS.tsv"), lignes_du_top)
    rendements = rendements_en_euros(cumul, taux)

    print(f"4/5 Frais des prospectus ({TRIMESTRES_FRAIS} derniers trimestres)…")
    dernier_rr = dernier_trimestre(RR, aujourd_hui=aujourd_hui)
    if dernier_rr is None:
        print("Erreur : aucun jeu de données « Risk/Return Summary » trouvé sur le site de la SEC (adresse changée ?).")
        return 1
    nums, subs = [], []
    for t in trimestres(_trimestre_du_rang(_rang_trimestre(dernier_rr) - TRIMESTRES_FRAIS + 1), dernier_rr):
        print(f"  {t}")
        archive = ouvrir_zip(RR.format(t=t))
        nums.append(_colonnes((n for n in lire_tsv(archive, "num.tsv") if n.get("tag") in ETIQUETTES_FRAIS), COL_NUM))
        subs.append(_colonnes(lire_tsv(archive, "sub.tsv"), ("adsh", "filed")))
    # un seul appel pour tous les trimestres, du plus ancien au plus récent : le dépôt le plus récent l'emporte pour chaque valeur
    frais = frais_prospectus(itertools.chain.from_iterable(nums), itertools.chain.from_iterable(subs), classes_par_serie)

    print("5/5 Assemblage et écriture…")
    lei_par_serie = {s: d["lei"] for s, d in anciens.items() if d.get("lei")}
    lei_par_serie.update({s: lei for s, i in infos_serie.items() if (lei := _lei(i.get("SERIES_LEI")))})
    chemin_firds, chemin_annuaire = Path(dossier) / "firds.js", Path(dossier) / "annuaire.js"
    if chemin_firds.exists():
        pays_par_isin = pays_des_isin(chemin_annuaire.read_text(encoding="utf-8")) if chemin_annuaire.exists() else None
        if pays_par_isin is None:
            print(f"  Avertissement : {chemin_annuaire} introuvable, les ISIN européens ne sont pas écartés.")
        isin_serie = correspondance_isin(chemin_firds.read_text(encoding="utf-8"), lei_par_serie, pays_par_isin)
    else:
        print(f"  Avertissement : {chemin_firds} introuvable, aucun ISIN rapproché.")
        isin_serie = {}
    noms_nport = {s: d["nom"] for s, d in anciens.items() if d.get("nom")}
    noms_nport.update({s: i["SERIES_NAME"] for s, i in infos_serie.items() if i.get("SERIES_NAME")})
    lignes = lignes_annuaire(tickers_mf, liste, noms_nport, set(isin_serie.values()))
    dans_la_zone = {f"S{l[1]:09d}" for l in lignes}
    isin_serie = {isin: serie for isin, serie in isin_serie.items() if serie in dans_la_zone}
    details = {}
    for ligne in lignes:
        serie = f"S{ligne[1]:09d}"
        detail = detail_serie(serie, classes_de(serie), resumes.get(retenus.get(serie)), isins, infos_serie.get(serie), rendements, frais,
                              taux, anciens.get(serie), nom_liste=ligne[3])
        if detail:
            details[serie] = detail
    ecrire_sorties(dossier, lignes, details, isin_serie, aujourd_hui.isoformat(), dernier)
    taille = sum(p.stat().st_size for p in (Path(dossier) / DOSSIER_DETAILS).glob("*.js")) + sum(
        (Path(dossier) / f).stat().st_size for f in (FICHIER_ZONE, FICHIER_ISIN))
    print(f"Terminé : {len(lignes)} séries dans la zone, {len(details)} détails, {len(isin_serie)} ISIN rapprochés, {taille / 1e6:.1f} Mo écrits "
          f"(trimestre {dernier}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

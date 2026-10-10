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
import math
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator
from pathlib import Path

from actualiser_contexte import lire_serie_bce

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
# étiquettes XBRL des prospectus → position dans [brut, net, gestion, entrée, sortie, date]
ETIQUETTES_FRAIS = {"ExpensesOverAssets": 0, "NetExpensesOverAssets": 1, "ManagementFeesOverAssets": 2,
                    "MaximumSalesChargeImposedOnPurchasesOverOfferingPrice": 3, "MaximumDeferredSalesChargeOverOther": 4}

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
